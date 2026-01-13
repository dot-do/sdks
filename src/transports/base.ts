// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { RpcTransport } from "../rpc.js";

/**
 * Transport connection lifecycle states.
 *
 * State transitions:
 * - Connecting -> Connected (on successful connection)
 * - Connecting -> Error (on connection failure)
 * - Connected -> Draining (when graceful shutdown initiated)
 * - Connected -> Disconnecting (when immediate close requested)
 * - Connected -> Error (on unexpected error)
 * - Draining -> Disconnecting (after drain completes or timeout)
 * - Draining -> Error (on error during drain)
 * - Disconnecting -> Disconnected (after cleanup completes)
 * - Error -> Disconnected (after error handling completes)
 *
 * Note: State transitions are one-way; once in Error or Disconnected state,
 * the transport cannot be reused.
 */
export type TransportState =
  | "connecting"     // Initial state, establishing connection
  | "connected"      // Connection established, ready for send/receive
  | "draining"       // Graceful shutdown, processing remaining messages
  | "disconnecting"  // Actively closing the connection
  | "disconnected"   // Connection closed, terminal state
  | "error";         // Error state, terminal state

/**
 * Callback type for transport state change notifications.
 */
export type TransportStateCallback = (
  newState: TransportState,
  previousState: TransportState,
  reason?: unknown
) => void;

/**
 * Abstract base class for RPC transports that provides common queue management
 * and error handling patterns.
 *
 * Subclasses must implement:
 * - `doSend(message: string): Promise<void>` - actually send the message
 * - `doAbort(reason: unknown): void` - perform transport-specific abort/close logic
 *
 * Subclasses should call state transition methods appropriately:
 * - `transitionToConnected()` - when connection is established
 * - `transitionToError(reason)` - when an error occurs
 * - `transitionToDraining()` - when starting graceful shutdown
 * - `transitionToDisconnecting()` - when starting to close
 * - `transitionToDisconnected()` - when fully closed
 */
export abstract class BaseTransport implements RpcTransport {
  protected receiveQueue: string[] = [];
  protected receiveResolver?: (msg: string) => void;
  protected receiveRejecter?: (err: unknown) => void;
  protected error?: unknown;

  // State machine
  #state: TransportState = "connecting";
  #stateCallbacks: TransportStateCallback[] = [];

  /**
   * Get the current transport state.
   */
  getState(): TransportState {
    return this.#state;
  }

  /**
   * Register a callback to be notified of state changes.
   * @param callback Function to call when state changes
   * @returns A function to unregister the callback
   */
  onStateChange(callback: TransportStateCallback): () => void {
    this.#stateCallbacks.push(callback);
    return () => {
      const index = this.#stateCallbacks.indexOf(callback);
      if (index >= 0) {
        this.#stateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Transition to a new state if the transition is valid.
   * @param newState The target state
   * @param reason Optional reason for the transition (used for error state)
   * @returns true if transition occurred, false if invalid or already in that state
   */
  #transitionTo(newState: TransportState, reason?: unknown): boolean {
    const previousState = this.#state;

    // No-op if already in the target state
    if (previousState === newState) {
      return false;
    }

    // Validate transition
    if (!this.#isValidTransition(previousState, newState)) {
      return false;
    }

    this.#state = newState;

    // Notify callbacks
    for (const callback of this.#stateCallbacks) {
      try {
        callback(newState, previousState, reason);
      } catch {
        // Ignore callback errors to prevent cascading failures
      }
    }

    return true;
  }

  /**
   * Check if a state transition is valid according to the state machine rules.
   */
  #isValidTransition(from: TransportState, to: TransportState): boolean {
    // Terminal states cannot transition to anything
    if (from === "disconnected") {
      return false;
    }

    // Error state can only transition to disconnected
    if (from === "error") {
      return to === "disconnected";
    }

    switch (from) {
      case "connecting":
        return to === "connected" || to === "error" || to === "disconnected";
      case "connected":
        return to === "draining" || to === "disconnecting" || to === "error";
      case "draining":
        return to === "disconnecting" || to === "error";
      case "disconnecting":
        return to === "disconnected" || to === "error";
      default:
        return false;
    }
  }

  /**
   * Transition to 'connected' state.
   * Valid from: connecting
   */
  protected transitionToConnected(): boolean {
    return this.#transitionTo("connected");
  }

  /**
   * Transition to 'draining' state (graceful shutdown).
   * Valid from: connected
   */
  protected transitionToDraining(): boolean {
    return this.#transitionTo("draining");
  }

  /**
   * Transition to 'disconnecting' state.
   * Valid from: connected, draining
   */
  protected transitionToDisconnecting(): boolean {
    return this.#transitionTo("disconnecting");
  }

  /**
   * Transition to 'disconnected' state.
   * Valid from: connecting, disconnecting, error
   */
  protected transitionToDisconnected(): boolean {
    return this.#transitionTo("disconnected");
  }

  /**
   * Transition to 'error' state.
   * Valid from: connecting, connected, draining, disconnecting
   * @param reason The error that caused the transition
   */
  protected transitionToError(reason: unknown): boolean {
    return this.#transitionTo("error", reason);
  }

  /**
   * Check if the transport is in a state that can send messages.
   */
  protected canSend(): boolean {
    return this.#state === "connected" || this.#state === "draining";
  }

  /**
   * Check if the transport is in a state that can receive messages.
   */
  protected canReceive(): boolean {
    return this.#state === "connected" || this.#state === "draining" || this.#state === "connecting";
  }

  /**
   * Check if the transport is in a terminal state.
   */
  isTerminated(): boolean {
    return this.#state === "disconnected" || this.#state === "error";
  }

  // ==========================================================================
  // Transport-level backpressure signaling (optional)
  // ==========================================================================

  #hasBackpressure: boolean = false;
  #backpressureCallbacks: ((hasBackpressure: boolean) => void)[] = [];

  /**
   * Check if the transport is currently experiencing backpressure.
   * This is a hint to callers that they should slow down sending.
   */
  hasBackpressure(): boolean {
    return this.#hasBackpressure;
  }

  /**
   * Register a callback to be notified when backpressure state changes.
   * @param callback Function to call when backpressure state changes
   * @returns A function to unregister the callback
   */
  onBackpressureChange(callback: (hasBackpressure: boolean) => void): () => void {
    this.#backpressureCallbacks.push(callback);
    return () => {
      const index = this.#backpressureCallbacks.indexOf(callback);
      if (index >= 0) {
        this.#backpressureCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Set the backpressure state (for use by subclasses).
   * Notifies registered callbacks when state changes.
   * @param hasBackpressure Whether the transport is under backpressure
   */
  protected setBackpressure(hasBackpressure: boolean): void {
    if (this.#hasBackpressure !== hasBackpressure) {
      this.#hasBackpressure = hasBackpressure;
      for (const callback of this.#backpressureCallbacks) {
        try {
          callback(hasBackpressure);
        } catch {
          // Ignore callback errors to prevent cascading failures
        }
      }
    }
  }

  /**
   * Actually send a message over the transport.
   * Subclasses implement this with transport-specific logic.
   */
  protected abstract doSend(message: string): Promise<void>;

  /**
   * Perform transport-specific cleanup when aborting.
   * Called by abort() after setting the error state.
   */
  protected abstract doAbort(reason: unknown): void;

  /**
   * Send a message over the transport.
   * Throws if the transport is in an error state.
   */
  async send(message: string): Promise<void> {
    if (this.error) {
      throw this.error;
    }
    return this.doSend(message);
  }

  /**
   * Receive the next message from the transport.
   * Returns immediately if a message is queued, otherwise waits for one.
   * Throws if the transport is in an error state (after queue is drained).
   */
  async receive(): Promise<string> {
    if (this.receiveQueue.length > 0) {
      return this.receiveQueue.shift()!;
    } else if (this.error) {
      throw this.error;
    } else {
      return new Promise<string>((resolve, reject) => {
        this.receiveResolver = resolve;
        this.receiveRejecter = reject;
      });
    }
  }

  /**
   * Try to receive a message synchronously if one is immediately available.
   * Returns the message if available, or undefined if the transport would need to wait.
   * This is an optimization to allow batch processing of queued messages.
   */
  tryReceiveSync(): string | undefined {
    if (this.receiveQueue.length > 0) {
      return this.receiveQueue.shift();
    }
    return undefined;
  }

  /**
   * Abort the transport with the given reason.
   * Sets the error state and performs transport-specific cleanup.
   */
  abort(reason: unknown): void {
    // Transition to disconnecting, then let doAbort handle cleanup
    this.transitionToDisconnecting();

    this.doAbort(reason);

    if (!this.error) {
      this.error = reason;
      // No need to call receiveRejecter(); RPC implementation will stop listening anyway.
    }

    // Transition to disconnected after cleanup
    this.transitionToDisconnected();
  }

  /**
   * Enqueue a received message.
   * If there's a pending receive(), resolve it immediately.
   * Otherwise, add to the queue.
   */
  protected enqueue(message: string): void {
    if (this.receiveResolver) {
      this.receiveResolver(message);
      this.receiveResolver = undefined;
      this.receiveRejecter = undefined;
    } else {
      this.receiveQueue.push(message);
    }
  }

  /**
   * Set the transport into an error state.
   * If there's a pending receive(), reject it.
   * Future receives will throw this error.
   */
  protected setError(error: unknown): void {
    if (!this.error) {
      this.error = error;

      // Transition state machine to error state
      this.transitionToError(error);

      if (this.receiveRejecter) {
        this.receiveRejecter(error);
        this.receiveResolver = undefined;
        this.receiveRejecter = undefined;
      }
    }
  }
}
