// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Backpressure Controller Module
 *
 * This module handles backpressure management for RPC sessions.
 * It tracks pending calls and manages blocking/rejecting behavior
 * when limits are exceeded.
 */

import { BackpressureError } from "./errors.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for backpressure behavior.
 */
export interface BackpressureOptions {
  /**
   * Maximum number of pending (unresolved) RPC calls allowed.
   * When this limit is reached, new calls will throw a BackpressureError.
   * If set to 0, no calls are allowed.
   * If undefined, no limit is applied.
   */
  maxPendingCalls?: number;

  /**
   * Maximum queue size for the transport buffer.
   * This is a hint to the session about when to signal backpressure.
   * If undefined, no queue size limit is applied.
   */
  maxQueueSize?: number;

  /**
   * Behavior when the queue is full.
   * - "reject": Throw a BackpressureError immediately (default)
   * - "block": Block until there's room in the queue
   */
  queueFullBehavior?: "reject" | "block";
}

// ============================================================================
// BackpressureController Class
// ============================================================================

/**
 * Controls backpressure for RPC sessions.
 *
 * This class manages:
 * - Tracking pending call count
 * - Enforcing pending call limits
 * - Blocking or rejecting new calls when limits are exceeded
 * - Notifying waiters when capacity becomes available
 */
export class BackpressureController {
  #pendingCallCount: number = 0;
  #drainResolvers: (() => void)[] = [];
  #blockedSenders: PromiseWithResolvers<void>[] = [];
  #options: BackpressureOptions;
  #abortReason?: unknown;

  /**
   * Creates a new BackpressureController.
   *
   * @param options - Backpressure configuration options
   */
  constructor(options: BackpressureOptions = {}) {
    this.#options = options;
  }

  /**
   * Returns the current number of pending (unresolved) RPC calls.
   */
  getPendingCallCount(): number {
    return this.#pendingCallCount;
  }

  /**
   * Returns true if the session is under backpressure.
   * This is the case when the pending call count has reached the limit.
   */
  hasBackpressure(): boolean {
    const maxCalls = this.#options.maxPendingCalls;
    if (maxCalls === undefined) {
      return false;
    }
    return this.#pendingCallCount >= maxCalls;
  }

  /**
   * Returns a promise that resolves when the pending call count drops below the limit.
   * If there's no backpressure, resolves immediately.
   */
  waitForDrain(): Promise<void> {
    if (!this.hasBackpressure()) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.#drainResolvers.push(resolve);
    });
  }

  /**
   * Increment the pending call count and check backpressure limits.
   * In reject mode: Throws BackpressureError if the limit is exceeded.
   * In block mode: Returns a Promise that waits for capacity.
   *
   * @returns A function to decrement the count when the call resolves,
   *          or a Promise that resolves to such a function if blocking is needed.
   * @throws BackpressureError if in reject mode and limit is exceeded
   */
  incrementPendingCall(): (() => void) | Promise<() => void> {
    const maxCalls = this.#options.maxPendingCalls;
    const queueFullBehavior = this.#options.queueFullBehavior ?? "reject";

    // Check if we're at or over the limit
    if (maxCalls !== undefined && this.#pendingCallCount >= maxCalls) {
      if (queueFullBehavior === "reject") {
        throw new BackpressureError(
          `Pending call limit exceeded: ${this.#pendingCallCount} calls pending, limit is ${maxCalls}`,
          this.#pendingCallCount,
          maxCalls
        );
      }

      // Block mode: wait for capacity
      const blocker = Promise.withResolvers<void>();
      this.#blockedSenders.push(blocker);

      // Return a promise that resolves to the decrement function once unblocked
      return blocker.promise.then(() => {
        // After unblocking, increment and return the decrement function
        return this.#doIncrement();
      });
    }

    return this.#doIncrement();
  }

  /**
   * Reset backpressure state on abort.
   * @param abortReason - The reason for the abort (used to reject blocked senders)
   */
  reset(abortReason?: unknown): void {
    this.#abortReason = abortReason;
    this.#pendingCallCount = 0;

    // Resolve all drain waiters
    const drainResolvers = this.#drainResolvers;
    this.#drainResolvers = [];
    for (const resolve of drainResolvers) {
      resolve();
    }

    // Reject all blocked senders
    const blockedSenders = this.#blockedSenders;
    this.#blockedSenders = [];
    for (const sender of blockedSenders) {
      sender.reject(abortReason);
    }
  }

  /**
   * Create a decrement function that can only be called once.
   * @returns A function that decrements the pending call count when called
   */
  createDecrementFn(): () => void {
    let decremented = false;
    return () => {
      if (decremented) return;
      decremented = true;
      this.#decrementPendingCall();
    };
  }

  /**
   * Actually increment the pending call count and return the decrement function.
   */
  #doIncrement(): () => void {
    this.#pendingCallCount++;
    return this.createDecrementFn();
  }

  /**
   * Decrement the pending call count and unblock waiters.
   */
  #decrementPendingCall(): void {
    const maxCalls = this.#options.maxPendingCalls;
    this.#pendingCallCount--;

    // Notify drain waiters if we're no longer at capacity
    if (maxCalls !== undefined && this.#pendingCallCount < maxCalls) {
      const resolvers = this.#drainResolvers;
      this.#drainResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }

    // Unblock any blocked senders (FIFO order)
    if (this.#blockedSenders.length > 0) {
      const sender = this.#blockedSenders.shift();
      if (sender) {
        sender.resolve();
      }
    }
  }
}
