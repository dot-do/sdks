// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { RpcTransport } from "../rpc.js";

/**
 * Abstract base class for RPC transports that provides common queue management
 * and error handling patterns.
 *
 * Subclasses must implement:
 * - `doSend(message: string): Promise<void>` - actually send the message
 * - `doAbort(reason: unknown): void` - perform transport-specific abort/close logic
 */
export abstract class BaseTransport implements RpcTransport {
  protected receiveQueue: string[] = [];
  protected receiveResolver?: (msg: string) => void;
  protected receiveRejecter?: (err: unknown) => void;
  protected error?: unknown;

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
    this.doAbort(reason);

    if (!this.error) {
      this.error = reason;
      // No need to call receiveRejecter(); RPC implementation will stop listening anyway.
    }
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
      if (this.receiveRejecter) {
        this.receiveRejecter(error);
        this.receiveResolver = undefined;
        this.receiveRejecter = undefined;
      }
    }
  }
}
