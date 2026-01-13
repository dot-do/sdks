// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, RpcPayload, RpcStub, PropertyPath, PayloadStubHook, ErrorStubHook, unwrapStubAndPath } from "./core.js";
import { Devaluator, Evaluator, ExportId, ImportId, Exporter, Importer } from "./serialize.js";
import {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  negotiateVersion,
  createHelloMessage,
  createHelloAckMessage,
  createHelloRejectMessage,
  isHandshakeMessage,
  formatVersion,
  type HandshakeMessage,
  type HandshakeAckMessage,
  type HandshakeRejectMessage,
} from "./version.js";
import { VersionMismatchError, ConnectionError, TimeoutError, BackpressureError, CapnwebError } from "./errors.js";
import { validateMessage, checkMessageSize, checkRecursionDepth } from "./message-validation.js";
import {
  ExportTableEntry,
  ImportTableEntry,
  RpcImportHook,
  RpcMainHook,
  ImportExportSession,
  DeferredImportHook,
} from "./import-export.js";

// ============================================================================
// RPC Message Types
// ============================================================================

/**
 * Serialized expression type used in RPC messages.
 * Represents any JSON-serializable value that can be sent over the wire.
 */
type Expression = unknown;

/**
 * Payload for handshake messages.
 */
type HandshakePayload = { type: string; [key: string]: unknown };

/**
 * Discriminated union of all RPC message types.
 * Each message is a tuple where the first element identifies the message type.
 */
export type RpcMessage =
  | ['push', Expression]
  | ['pull', ImportId]
  | ['resolve', ExportId, Expression]
  | ['reject', ExportId, Expression]
  | ['release', ExportId, number]
  | ['abort', Expression]
  | HandshakePayload;

/**
 * Interface for an RPC transport, which is a simple bidirectional message stream. Implement this
 * interface if the built-in transports (e.g. for HTTP batch and WebSocket) don't meet your needs.
 */
export interface RpcTransport {
  /**
   * Sends a message to the other end.
   */
  send(message: string): Promise<void>;

  /**
   * Receives a message sent by the other end.
   *
   * If and when the transport becomes disconnected, this will reject. The thrown error will be
   * propagated to all outstanding calls and future calls on any stubs associated with the session.
   * If there are no outstanding calls (and none are made in the future), then the error does not
   * propagate anywhere -- this is considered a "clean" shutdown.
   */
  receive(): Promise<string>;

  /**
   * Optional: Try to receive a message synchronously if one is immediately available.
   * Returns the message if available, or undefined if the transport would need to wait.
   * This is an optimization to allow batch processing of queued messages.
   */
  tryReceiveSync?(): string | undefined;

  /**
   * Indicates that the RPC system has suffered an error that prevents the session from continuing.
   * The transport should ideally try to send any queued messages if it can, and then close the
   * connection. (It's not strictly necessary to deliver queued messages, but the last message sent
   * before abort() is called is often an "abort" message, which communicates the error to the
   * peer, so if that is dropped, the peer may have less information about what happened.)
   */
  abort?(reason: unknown): void;

  /**
   * Optional: If set to a truthy value, indicates the transport has encountered an error.
   * This allows the session to detect transport errors synchronously before attempting sends,
   * preventing race conditions where sends could occur between the error occurring and
   * the abort being processed.
   *
   * Transports should set this property immediately when they detect an error, before
   * rejecting any pending receive() promises.
   */
  error?: unknown;
}

// ============================================================================
// Session Options
// ============================================================================

/**
 * Options to customize behavior of an RPC session. All functions which start a session should
 * optionally accept this.
 */
export type RpcSessionOptions = {
  /**
   * If provided, this function will be called whenever an `Error` object is serialized (for any
   * reason, not just because it was thrown). This can be used to log errors, and also to redact
   * them.
   *
   * If `onSendError` returns an Error object, than object will be substituted in place of the
   * original. If it has a stack property, the stack will be sent to the client.
   *
   * If `onSendError` doesn't return anything (or is not provided at all), the default behavior is
   * to serialize the error with the stack omitted.
   */
  onSendError?: (error: Error) => Error | void;

  /**
   * If provided, this function will be called when an internal error occurs that cannot be
   * propagated through normal RPC mechanisms. This includes:
   * - Errors when sending abort messages to the peer
   * - Errors during JSON serialization of messages
   * - Other internal errors that would otherwise be silently suppressed
   *
   * This is useful for logging and debugging purposes. If not provided, such errors are
   * silently ignored (though they still trigger appropriate abort behavior).
   */
  onInternalError?: (error: Error) => void;

  /**
   * If true, perform protocol version negotiation handshake at session start.
   * This enables version negotiation between client and server.
   * Default: false (no handshake for backwards compatibility)
   */
  enableVersionHandshake?: boolean;

  /**
   * Identifier for this client/server, sent during handshake for debugging purposes.
   */
  peerId?: string;

  /**
   * Called when version negotiation completes successfully.
   * @param version - The negotiated protocol version
   * @param isLatest - Whether this is the latest supported version
   */
  onVersionNegotiated?: (version: string, isLatest: boolean) => void;

  /**
   * Called when there's a version mismatch warning (compatible but not optimal).
   * @param warning - Description of the version mismatch
   */
  onVersionWarning?: (warning: string) => void;

  /**
   * Default timeout in milliseconds for RPC calls.
   * If set to 0, no timeout is applied.
   * Individual calls can override this with per-call timeout options.
   */
  timeout?: number;

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

  /**
   * Maximum message size in bytes for incoming messages.
   * Messages larger than this will be rejected with a SerializationError before parsing.
   * Must be a positive integer (>= 1).
   * Default: 10MB (10 * 1024 * 1024 bytes)
   */
  maxMessageSize?: number;

  /**
   * Maximum recursion depth for nested objects/arrays in messages.
   * Messages with deeper nesting will be rejected with a SerializationError.
   * Must be a positive integer (>= 1).
   * Default: 100 levels
   */
  maxRecursionDepth?: number;
};

// ============================================================================
// Session Implementation
// ============================================================================

class RpcSessionImpl implements Importer, Exporter, ImportExportSession {
  #exports: Array<ExportTableEntry> = [];
  #reverseExports: Map<StubHook, ExportId> = new Map();
  #imports: Array<ImportTableEntry> = [];
  #abortReason?: unknown;
  #cancelReadLoop: (error: unknown) => void;

  // We assign positive numbers to imports we initiate, and negative numbers to exports we
  // initiate. So the next import ID is just `imports.length`, but the next export ID needs
  // to be tracked explicitly.
  #nextExportId = -1;

  // If set, call this when all incoming calls are complete.
  #onBatchDone?: Omit<PromiseWithResolvers<void>, "promise">;

  // How many promises is our peer expecting us to resolve?
  #pullCount = 0;

  // Sparse array of onBrokenCallback registrations. Items are strictly appended to the end but
  // may be deleted from the middle (hence leaving the array sparse).
  onBrokenCallbacks: ((error: unknown) => void)[] = [];

  // Protocol version negotiation state
  #negotiatedVersion: string = PROTOCOL_VERSION;
  #handshakeComplete: boolean = false;
  #handshakeResolver?: PromiseWithResolvers<void>;
  #isInitiator: boolean;

  // Session lifecycle state
  #closed: boolean = false;
  #closeReason?: Error;
  #onClosedResolver: PromiseWithResolvers<Error | undefined>;

  // Backpressure state
  #pendingCallCount: number = 0;
  #drainResolvers: (() => void)[] = [];
  #blockedSenders: PromiseWithResolvers<void>[] = [];

  #transport: RpcTransport;
  #options: RpcSessionOptions;

  constructor(transport: RpcTransport, mainHook: StubHook,
      options: RpcSessionOptions, isInitiator: boolean = true) {
    this.#transport = transport;
    this.#options = options;

    // Export zero is automatically the bootstrap object.
    this.#exports.push({hook: mainHook, refcount: 1});

    // Import zero is the other side's bootstrap object.
    this.#imports.push(new ImportTableEntry(this, 0, false));

    this.#isInitiator = isInitiator;

    // Initialize onClosed resolver
    this.#onClosedResolver = Promise.withResolvers<Error | undefined>();

    let rejectFunc: (error: unknown) => void;
    let abortPromise = new Promise<never>((resolve, reject) => { rejectFunc = reject; });
    this.#cancelReadLoop = rejectFunc!;

    if (options.enableVersionHandshake) {
      // Set up handshake resolver
      this.#handshakeResolver = Promise.withResolvers<void>();
    } else {
      // Skip handshake, mark as complete immediately
      this.#handshakeComplete = true;
    }

    this.#readLoop(abortPromise).catch(err => {
      // Preserve any CapnwebError subclass (SerializationError, etc.)
      // Only wrap raw errors in ConnectionError for transport failures
      const error = err instanceof CapnwebError
        ? err
        : new ConnectionError(err instanceof Error ? err.message : String(err));
      this.abort(error);
    });

    // If we're the initiator and handshake is enabled, send hello message
    if (options.enableVersionHandshake && isInitiator) {
      this.#sendHello();
    }
  }

  /**
   * Get the negotiated protocol version.
   */
  getNegotiatedVersion(): string {
    return this.#negotiatedVersion;
  }

  /**
   * Check if the handshake has completed.
   */
  isHandshakeComplete(): boolean {
    return this.#handshakeComplete;
  }

  /**
   * Wait for the handshake to complete.
   */
  async waitForHandshake(): Promise<void> {
    if (this.#handshakeComplete) {
      return;
    }
    if (this.#handshakeResolver) {
      await this.#handshakeResolver.promise;
    }
  }

  /**
   * Send a hello message to initiate version negotiation.
   */
  #sendHello(): void {
    const hello = createHelloMessage(this.#options.peerId);
    this.#send(hello);
  }

  /**
   * Complete the handshake with a negotiated version.
   * This method consolidates the common logic between handleHello and handleHelloAck.
   */
  #completeHandshake(negotiatedVersion: string): void {
    this.#negotiatedVersion = negotiatedVersion;
    this.#handshakeComplete = true;

    // Notify callbacks
    const isLatest = negotiatedVersion === PROTOCOL_VERSION;
    this.#options.onVersionNegotiated?.(negotiatedVersion, isLatest);

    if (!isLatest) {
      this.#options.onVersionWarning?.(
        `Negotiated protocol version ${formatVersion(negotiatedVersion)} is not the latest ` +
        `(${formatVersion(PROTOCOL_VERSION)}). Some features may not be available.`
      );
    }

    // Resolve handshake promise
    this.#handshakeResolver?.resolve();
    this.#handshakeResolver = undefined;
  }

  /**
   * Handle a received hello message.
   */
  #handleHello(msg: HandshakeMessage): void {
    const negotiated = negotiateVersion(msg.versions);

    if (!negotiated) {
      // No compatible version found
      const reject = createHelloRejectMessage(
        `No compatible protocol version. Peer supports: ${msg.versions.join(", ")}. ` +
        `This implementation supports: ${SUPPORTED_VERSIONS.join(", ")}.`
      );
      this.#send(reject);
      this.abort(new VersionMismatchError(
        `Protocol version mismatch: peer supports ${msg.versions.join(", ")}, ` +
        `but this implementation supports ${SUPPORTED_VERSIONS.join(", ")}`,
        [...SUPPORTED_VERSIONS],
        msg.versions
      ), false);
      return;
    }

    // Send acknowledgment
    const ack = createHelloAckMessage(negotiated, this.#options.peerId);
    this.#send(ack);

    // Complete handshake with negotiated version
    this.#completeHandshake(negotiated);
  }

  /**
   * Handle a received hello acknowledgment message.
   */
  #handleHelloAck(msg: HandshakeAckMessage): void {
    // Verify the selected version is one we support
    const selected = msg.selectedVersion;
    const negotiated = negotiateVersion([selected]);

    if (!negotiated) {
      this.abort(new VersionMismatchError(
        `Server selected unsupported protocol version: ${selected}`,
        [...SUPPORTED_VERSIONS],
        [selected]
      ), false);
      return;
    }

    // Complete handshake with selected version
    this.#completeHandshake(selected);
  }

  /**
   * Handle a received hello rejection message.
   */
  #handleHelloReject(msg: HandshakeRejectMessage): void {
    this.abort(new VersionMismatchError(
      `Server rejected connection: ${msg.reason}`,
      [...SUPPORTED_VERSIONS],
      msg.supportedVersions
    ), false);
  }

  /**
   * Close the session gracefully.
   * @param reason Optional error to propagate as the close reason
   */
  close(reason?: Error): void {
    if (this.#closed) {
      return;  // Already closed, no-op
    }

    this.#closed = true;
    this.#closeReason = reason;

    // Create a ConnectionError for pending operations
    const closeError = new ConnectionError(
      reason?.message || "Session closed"
    );

    // Abort the session with our close error
    this.abort(closeError, false);

    // Resolve the onClosed promise
    this.#onClosedResolver.resolve(reason);
  }

  /**
   * Returns a promise that resolves when the session closes.
   * Resolves with undefined for normal close, or Error for abnormal close.
   */
  onClosed(): Promise<Error | undefined> {
    return this.#onClosedResolver.promise;
  }

  /**
   * Returns true if the session has been closed.
   */
  getIsClosed(): boolean {
    return this.#closed;
  }

  // ==========================================================================
  // Backpressure methods
  // ==========================================================================

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
   * @returns A function to decrement the count when the call resolves,
   *          or a Promise that resolves to such a function if blocking is needed.
   */
  #incrementPendingCall(): (() => void) | Promise<() => void> {
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
   * Actually increment the pending call count and return the decrement function.
   */
  #doIncrement(): () => void {
    const maxCalls = this.#options.maxPendingCalls;
    this.#pendingCallCount++;

    // Return a function to decrement the count
    let decremented = false;
    return () => {
      if (decremented) return;
      decremented = true;
      this.#decrementPendingCall();
    };
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

  /**
   * Reset backpressure state on abort.
   */
  #resetBackpressureState(): void {
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
      sender.reject(this.#abortReason);
    }
  }

  // Should only be called once immediately after construction.
  getMainImport(): RpcImportHook {
    return new RpcMainHook(this.#imports[0]);
  }

  shutdown(): void {
    // Note: A "clean shutdown" mechanism (e.g., waiting for pending calls to complete) could be
    // added in the future, but the current abort-based approach is sufficient for most use cases
    // and ensures resources are released promptly.
    if (!this.#closed) {
      this.#closed = true;
      this.#onClosedResolver.resolve(undefined);
    }
    // Send abort message to peer so they can dispose their exported targets
    // Wrap in ConnectionError for consistent error types
    this.abort(new ConnectionError("RPC session was shut down by disposing the main stub"), true);
  }

  exportStub(hook: StubHook): ExportId {
    if (this.#abortReason) throw this.#abortReason;

    let existingExportId = this.#reverseExports.get(hook);
    if (existingExportId !== undefined) {
      ++this.#exports[existingExportId].refcount;
      return existingExportId;
    } else {
      let exportId = this.#nextExportId--;
      this.#exports[exportId] = { hook, refcount: 1 };
      this.#reverseExports.set(hook, exportId);
      // Note: We could use onBroken() to automatically unexport stubs when their underlying
      // connection breaks. Currently, stubs are cleaned up when the session aborts, which
      // handles the common case. Per-stub broken notifications would be a future enhancement.
      return exportId;
    }
  }

  exportPromise(hook: StubHook): ExportId {
    if (this.#abortReason) throw this.#abortReason;

    // Promises always use a new ID because otherwise the recipient could miss the resolution.
    let exportId = this.#nextExportId--;
    this.#exports[exportId] = { hook, refcount: 1 };
    this.#reverseExports.set(hook, exportId);

    // Automatically start resolving any promises we send.
    this.#ensureResolvingExport(exportId);
    return exportId;
  }

  unexport(ids: Array<ExportId>): void {
    for (let id of ids) {
      this.#releaseExport(id, 1);
    }
  }

  #releaseExport(exportId: ExportId, refcount: number) {
    let entry = this.#exports[exportId];
    if (!entry) {
      throw new Error(`no such export ID: ${exportId}`);
    }
    if (entry.refcount < refcount) {
      throw new Error(`refcount would go negative: ${entry.refcount} < ${refcount}`);
    }
    entry.refcount -= refcount;
    if (entry.refcount === 0) {
      delete this.#exports[exportId];
      this.#reverseExports.delete(entry.hook);
      entry.hook.dispose();
    }
  }

  onSendError(error: Error): Error | void {
    if (this.#options.onSendError) {
      return this.#options.onSendError(error);
    }
  }

  /**
   * Report an internal error that cannot be propagated through normal RPC mechanisms.
   * Calls the onInternalError callback if provided, otherwise falls back to console.error.
   * The context is attached to the error as the `rpcContext` property.
   *
   * @param error - The error that occurred
   * @param context - A string describing where the error occurred (e.g., 'serialization', 'send', 'abort')
   */
  #reportInternalError(error: unknown, context: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    // Attach context to the error
    (err as any).rpcContext = context;

    if (this.#options.onInternalError) {
      try {
        this.#options.onInternalError(err);
      } catch {
        // Ignore errors from the callback itself to prevent infinite loops
      }
    } else {
      // Fall back to console.error if no callback provided
      console.error(`RPC internal error (${context}):`, err);
    }
  }

  #ensureResolvingExport(exportId: ExportId) {
    let exp = this.#exports[exportId];
    if (!exp) {
      throw new Error(`no such export ID: ${exportId}`);
    }
    if (!exp.pull) {
      let resolve = async () => {
        let hook = exp.hook;
        for (;;) {
          let payload = await hook.pull();
          if (payload.value instanceof RpcStub) {
            let {hook: inner, pathIfPromise} = unwrapStubAndPath(payload.value);
            if (pathIfPromise && pathIfPromise.length == 0) {
              if (this.getImport(hook) === undefined) {
                // Optimization: The resolution is just another promise, and it is not a promise
                // pointing back to the peer. So if we send a resolve message, it's just going to
                // resolve to another new promise export, which is just going to have to wait for
                // another resolve message later. This intermediate resolve message gives the peer
                // no useful information, so let's skip it and just wait for the chained
                // resolution.
                hook = inner;
                continue;
              }
            }
          }

          return payload;
        }
      };

      ++this.#pullCount;
      exp.pull = resolve().then(
        payload => {
          // We don't transfer ownership of stubs in the payload since the payload
          // belongs to the hook which sticks around to handle pipelined requests.
          let value = Devaluator.devaluate(payload.value, undefined, this, payload);
          this.#send(["resolve", exportId, value]);
        },
        error => {
          this.#send(["reject", exportId, Devaluator.devaluate(error, undefined, this)]);
        }
      ).catch(
        error => {
          // If serialization failed, report the serialization error via onInternalError
          this.#reportInternalError(error, 'serialization');
          // Also try to send a rejection with the serialization error
          try {
            this.#send(["reject", exportId, Devaluator.devaluate(error, undefined, this)]);
          } catch (error2) {
            // Even the error couldn't be serialized - report that too
            this.#reportInternalError(error2, 'serialization');
            this.abort(error2);
          }
        }
      ).finally(() => {
        if (--this.#pullCount === 0) {
          if (this.#onBatchDone) {
            this.#onBatchDone.resolve();
          }
        }
      });
    }
  }

  getImport(hook: StubHook): ImportId | undefined {
    if (hook instanceof RpcImportHook && hook.entry && hook.entry.session === this) {
      return hook.entry.importId;
    } else {
      return undefined;
    }
  }

  importStub(idx: ImportId): RpcImportHook {
    if (this.#abortReason) throw this.#abortReason;

    let entry = this.#imports[idx];
    if (!entry) {
      entry = new ImportTableEntry(this, idx, false);
      this.#imports[idx] = entry;
    }
    return new RpcImportHook(/*isPromise=*/false, entry);
  }

  importPromise(idx: ImportId): StubHook {
    if (this.#abortReason) throw this.#abortReason;

    if (this.#imports[idx]) {
      // Can't reuse an existing ID for a promise!
      return new ErrorStubHook(new Error(
          "Bug in RPC system: The peer sent a promise reusing an existing export ID."));
    }

    // Create an already-pulling hook.
    let entry = new ImportTableEntry(this, idx, true);
    this.#imports[idx] = entry;
    return new RpcImportHook(/*isPromise=*/true, entry);
  }

  getExport(idx: ExportId): StubHook | undefined {
    return this.#exports[idx]?.hook;
  }

  #send(msg: RpcMessage) {
    if (this.#abortReason !== undefined) {
      // Ignore sends after we've aborted.
      return;
    }

    // Check if the transport has detected an error synchronously.
    // This prevents sends from occurring after the transport encounters an error
    // but before the session's abort() is called.
    if (this.#transport.error !== undefined) {
      // Wrap transport errors in ConnectionError for consistent error types
      const connectionError = this.#transport.error instanceof ConnectionError
        ? this.#transport.error
        : new ConnectionError(
            this.#transport.error instanceof Error
              ? this.#transport.error.message
              : String(this.#transport.error)
          );
      this.abort(connectionError, false);
      return;
    }

    let msgText: string;
    try {
      msgText = JSON.stringify(msg);
    } catch (err) {
      // If JSON stringification failed, there's something wrong with the devaluator, as it should
      // not allow non-JSONable values to be injected in the first place.
      this.#reportInternalError(err, 'serialization');
      try {
        this.abort(err);
      } catch (err2) {
        // Abort failed - report via onInternalError callback
        this.#reportInternalError(err2, 'serialization');
      }
      throw err;
    }

    this.#transport.send(msgText)
        // If send fails, report the error and abort the connection, but don't try to send
        // an abort message since that'll probably also fail.
        .catch(err => {
          this.#reportInternalError(err, 'send');
          this.abort(err, false);
        });
  }

  /**
   * Throws if the session is aborted or the transport has an error.
   * This provides a synchronous check for abort/error status.
   */
  throwIfAborted(): void {
    if (this.#abortReason) throw this.#abortReason;

    // Check for transport error synchronously to prevent race conditions
    if (this.#transport.error !== undefined) {
      // Preserve any CapnwebError subclass (SerializationError, etc.)
      // Only wrap raw errors in ConnectionError for transport failures
      const error = this.#transport.error instanceof CapnwebError
        ? this.#transport.error
        : new ConnectionError(
            this.#transport.error instanceof Error
              ? this.#transport.error.message
              : String(this.#transport.error)
          );
      this.abort(error, false);
      throw this.#abortReason;
    }
  }

  sendCall(id: ImportId, path: PropertyPath, args?: RpcPayload, callTimeoutMs?: number): StubHook {
    this.throwIfAborted();

    // Check backpressure limit before making the call
    const decrementPendingResult = this.#incrementPendingCall();

    // Get timeout setting
    const timeoutMs = callTimeoutMs !== undefined ? callTimeoutMs : this.#options.timeout;

    // If blocking on backpressure, return a DeferredImportHook
    if (decrementPendingResult instanceof Promise) {
      // Create a deferred hook that will resolve when we can actually send
      const hookPromise = this.#createBlockedCallPromise(
        decrementPendingResult,
        id, path, args, timeoutMs
      );
      return new DeferredImportHook(hookPromise);
    }

    // Not blocking - send immediately
    return this.#doSendCall(id, path, args, timeoutMs, decrementPendingResult);
  }

  /**
   * Create a promise that resolves to the actual import hook once blocking is resolved.
   * Handles timeout for blocked calls.
   */
  #createBlockedCallPromise(
    decrementPendingPromise: Promise<() => void>,
    id: ImportId,
    path: PropertyPath,
    args: RpcPayload | undefined,
    timeoutMs: number | undefined
  ): Promise<StubHook> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;  // Track if promise has been resolved or rejected
    const startTime = Date.now();

    // Create a promise that handles both unblocking and timeout
    return new Promise<StubHook>((resolve, reject) => {
      // Set up timeout if configured - timeout starts immediately when blocked
      if (timeoutMs && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (settled) return;  // Already resolved via capacity
          settled = true;

          const elapsed = Date.now() - startTime;
          const error = new TimeoutError(
            `RPC call timeout after ${timeoutMs}ms (blocked waiting for capacity)`,
            timeoutMs,
            elapsed
          );
          reject(error);
        }, timeoutMs);
      }

      // Wait for capacity
      decrementPendingPromise.then(
        decrementPending => {
          if (settled) {
            // Already timed out - release the capacity we just acquired
            decrementPending();
            return;
          }
          settled = true;

          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          // Check if session was aborted while waiting
          if (this.#abortReason) {
            decrementPending();
            reject(this.#abortReason);
            return;
          }

          // Calculate remaining timeout for the actual call
          const elapsed = Date.now() - startTime;
          const remainingTimeout = timeoutMs ? Math.max(0, timeoutMs - elapsed) : undefined;

          // If timeout has already been exceeded while blocked, reject immediately
          if (timeoutMs && remainingTimeout === 0) {
            decrementPending();
            const error = new TimeoutError(
              `RPC call timeout after ${timeoutMs}ms (exceeded while waiting for capacity)`,
              timeoutMs,
              elapsed
            );
            reject(error);
            return;
          }

          // Now actually send the call
          try {
            const hook = this.#doSendCall(id, path, args, remainingTimeout, decrementPending);
            resolve(hook);
          } catch (err) {
            decrementPending();
            reject(err);
          }
        },
        error => {
          if (settled) return;
          settled = true;

          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          reject(error);
        }
      );
    });
  }

  /**
   * Actually send a call after backpressure check has passed.
   */
  #doSendCall(
    id: ImportId,
    path: PropertyPath,
    args: RpcPayload | undefined,
    timeoutMs: number | undefined,
    decrementPending: () => void
  ): RpcImportHook {
    let value: unknown[] = ["pipeline", id, path];
    if (args) {
      let devalue = Devaluator.devaluate(args.value, undefined, this, args);

      // The devaluator wraps arrays in an outer array to escape them in the wire format.
      // Since args is always an array, we unwrap the outer layer here to get the serialized args.
      // This is intentional and matches the deserialization logic in the Evaluator.
      value.push((devalue as unknown[])[0]);

      // Serializing the payload takes ownership of all stubs within, so the payload itself does
      // not need to be disposed.
    }
    this.#send(["push", value]);

    // Register this pipelined call with the parent import for embargo handling.
    // When the parent import resolves, the embargo will be held until all pipelined
    // calls (including this one) have been resolved.
    const parentEntry = this.#imports[id];
    let pipelineResolver: PromiseWithResolvers<void> | undefined;
    if (parentEntry && !parentEntry.resolution) {
      pipelineResolver = parentEntry.registerPipelinedCall();
    }

    let entry = new ImportTableEntry(this, this.#imports.length, false);
    this.#imports.push(entry);

    // Start timeout for this call (if we have remaining time)
    if (timeoutMs && timeoutMs > 0) {
      entry.startTimeout(timeoutMs, () => {
        const elapsed = entry.getElapsedTime() || timeoutMs;
        const error = new TimeoutError(
          `RPC call timeout after ${timeoutMs}ms`,
          timeoutMs,
          elapsed
        );
        entry.abort(error);
        // Clean up import table entry
        delete this.#imports[entry.importId];
      });
    }

    // When this pipelined call's result is resolved, signal the parent's embargo handler
    // and decrement the pending call count for backpressure
    entry.onResolved(() => {
      if (pipelineResolver) {
        pipelineResolver.resolve();
      }
      decrementPending();
    });

    return new RpcImportHook(/*isPromise=*/true, entry);
  }

  sendMap(id: ImportId, path: PropertyPath, captures: StubHook[], instructions: unknown[],
          callTimeoutMs?: number): RpcImportHook {
    if (this.#abortReason) {
      for (let cap of captures) {
        cap.dispose();
      }
      throw this.#abortReason;
    }

    let devaluedCaptures = captures.map(hook => {
      let importId = this.getImport(hook);
      if (importId !== undefined) {
        return ["import", importId];
      } else {
        return ["export", this.exportStub(hook)];
      }
    });

    let value = ["remap", id, path, devaluedCaptures, instructions];

    this.#send(["push", value]);

    // Register this pipelined call with the parent import for embargo handling.
    const parentEntry = this.#imports[id];
    let pipelineResolver: PromiseWithResolvers<void> | undefined;
    if (parentEntry && !parentEntry.resolution) {
      pipelineResolver = parentEntry.registerPipelinedCall();
    }

    let entry = new ImportTableEntry(this, this.#imports.length, false);
    this.#imports.push(entry);

    // Start timeout for this call
    const timeoutMs = callTimeoutMs !== undefined ? callTimeoutMs : this.#options.timeout;
    if (timeoutMs && timeoutMs > 0) {
      entry.startTimeout(timeoutMs, () => {
        const elapsed = entry.getElapsedTime() || timeoutMs;
        const error = new TimeoutError(
          `RPC call timeout after ${timeoutMs}ms`,
          timeoutMs,
          elapsed
        );
        entry.abort(error);
        // Clean up import table entry
        delete this.#imports[entry.importId];
      });
    }

    // When this pipelined call's result is resolved, signal the parent's embargo handler
    // Note: sendMap does not track backpressure since it's used for remapping operations
    // which are typically internal and not subject to the same flow control as user calls.
    if (pipelineResolver) {
      entry.onResolved(() => pipelineResolver!.resolve());
    }

    return new RpcImportHook(/*isPromise=*/true, entry);
  }

  sendPull(id: ImportId) {
    if (this.#abortReason) throw this.#abortReason;

    this.#send(["pull", id]);
  }

  sendRelease(id: ImportId, remoteRefcount: number) {
    if (this.#abortReason) return;

    this.#send(["release", id, remoteRefcount]);
    delete this.#imports[id];
  }

  abort(error: unknown, trySendAbortMessage: boolean = true) {
    // Don't double-abort.
    if (this.#abortReason !== undefined) return;

    this.#cancelReadLoop(error);

    if (trySendAbortMessage) {
      try {
        this.#transport.send(JSON.stringify(["abort", Devaluator
            .devaluate(error, undefined, this)]))
            .catch(err => {
              // Sending abort message failed - report via onInternalError with context
              this.#reportInternalError(err, 'abort');
            });
      } catch (err) {
        // Serialization failed - report via onInternalError with context
        // This probably means the error itself couldn't be serialized (e.g., circular reference)
        this.#reportInternalError(err, 'abort');
      }
    }

    // Store the abort reason, using a placeholder if it's undefined
    const abortReason = error === undefined ? "undefined" : error;

    this.#abortReason = abortReason;
    if (this.#onBatchDone) {
      this.#onBatchDone.reject(abortReason);
    }

    if (this.#transport.abort) {
      // Call transport's abort handler, but guard against buggy app code.
      try {
        this.#transport.abort(abortReason);
      } catch (err) {
        // Report errors from transport.abort - these indicate bugs in transport implementation
        this.#reportInternalError(err, 'transport.abort callback');
      }
    }

    // Mark session as closed if not already (e.g., transport disconnected)
    if (!this.#closed) {
      this.#closed = true;
      this.#closeReason = error instanceof Error ? error : new Error(String(error));
      this.#onClosedResolver.resolve(this.#closeReason);
    }

    // WATCH OUT: these are sparse arrays. `for/let/of` will iterate only positive indexes
    // including deleted indexes -- bad. We need to use `for/let/in` instead.
    for (let i in this.onBrokenCallbacks) {
      try {
        this.onBrokenCallbacks[i](error);
      } catch (err) {
        // Treat as unhandled rejection.
        Promise.resolve(err);
      }
    }

    // Wrap the error in ConnectionError for pending imports if it's not already one.
    // This ensures callers receive a consistent ConnectionError type when the connection breaks.
    let importAbortError: unknown;
    if (error instanceof ConnectionError) {
      importAbortError = error;
    } else if (error instanceof Error) {
      importAbortError = new ConnectionError(error.message);
    } else {
      importAbortError = new ConnectionError(String(error));
    }

    for (let i in this.#imports) {
      this.#imports[i].abort(importAbortError);
    }
    for (let i in this.#exports) {
      this.#exports[i].hook.dispose();
    }

    // Clear import and export tables
    this.#imports = [];
    this.#exports = [];
    this.#reverseExports.clear();
    this.onBrokenCallbacks = [];

    // Reset backpressure state
    this.#resetBackpressureState();
  }

  // Process a single raw message. Returns true if message was valid, false if error.
  #processMessage(rawMessage: string): boolean {
    // Check message size before parsing (use custom limit if specified)
    checkMessageSize(rawMessage, this.#options.maxMessageSize);

    let msg = JSON.parse(rawMessage);
    if (this.#abortReason) return true;  // abort in progress, skip processing

    // Check recursion depth after parsing (use custom limit if specified)
    checkRecursionDepth(msg, this.#options.maxRecursionDepth);

    // Handle handshake messages first
    if (isHandshakeMessage(msg)) {
      switch (msg.type) {
        case "hello":
          this.#handleHello(msg as HandshakeMessage);
          return true;
        case "hello-ack":
          this.#handleHelloAck(msg as HandshakeAckMessage);
          return true;
        case "hello-reject":
          this.#handleHelloReject(msg as HandshakeRejectMessage);
          return true;
      }
    }

    // If handshake is enabled but not complete, handle non-handshake messages
    if (!this.#handshakeComplete && this.#options.enableVersionHandshake) {
      // Allow messages from peers that don't support versioning (for backwards compatibility)
      // If we receive a regular RPC message before handshake, assume peer doesn't support it
      console.warn(
        `Received RPC message before handshake complete. ` +
        `Assuming peer does not support version negotiation.`
      );
      this.#handshakeComplete = true;
      this.#negotiatedVersion = PROTOCOL_VERSION; // Assume current version
      if (this.#handshakeResolver) {
        this.#handshakeResolver.resolve();
        this.#handshakeResolver = undefined;
      }
    }

    // Validate message structure (type, arity, argument types)
    validateMessage(msg);

    if (msg instanceof Array) {
      switch (msg[0]) {
        case "push":  // ["push", Expression]
          if (msg.length > 1) {
            let payload = new Evaluator(this).evaluate(msg[1]);
            let hook = new PayloadStubHook(payload);

            // It's possible for a rejection to occur before the client gets a chance to send
            // a "pull" message or to use the promise in a pipeline. We don't want that to be
            // treated as an unhandled rejection on our end.
            hook.ignoreUnhandledRejections();

            this.#exports.push({ hook, refcount: 1 });
            return true;
          }
          break;

        case "pull": {  // ["pull", ImportId]
          let exportId = msg[1];
          if (typeof exportId == "number") {
            this.#ensureResolvingExport(exportId);
            return true;
          }
          break;
        }

        case "resolve":   // ["resolve", ExportId, Expression]
        case "reject": {  // ["reject", ExportId, Expression]
          let importId = msg[1];
          if (typeof importId == "number" && msg.length > 2) {
            let imp = this.#imports[importId];
            if (imp) {
              if (msg[0] == "resolve") {
                imp.resolve(new PayloadStubHook(new Evaluator(this).evaluate(msg[2])));
              } else {
                // Error payloads are always simple values (no stubs) per the RPC protocol.
                // We evaluate to get the error value, then immediately dispose the payload
                // (which should be a no-op) and wrap the error in an ErrorStubHook.
                let payload = new Evaluator(this).evaluate(msg[2]);
                payload.dispose();  // no-op since errors don't contain stubs
                imp.resolve(new ErrorStubHook(payload.value));
              }
            } else {
              // Import ID is not found on the table. Probably we released it already, in which
              // case we do not care about the resolution, so whatever.

              if (msg[0] == "resolve") {
                // We need to evaluate the resolution and immediately dispose it so that we
                // release any stubs it contains.
                new Evaluator(this).evaluate(msg[2]).dispose();
              }
            }
            return true;
          }
          break;
        }

        case "release": {
          let exportId = msg[1];
          let refcount = msg[2];
          if (typeof exportId == "number" && typeof refcount == "number") {
            this.#releaseExport(exportId, refcount);
            return true;
          }
          break;
        }

        case "abort": {
          let payload = new Evaluator(this).evaluate(msg[1]);
          payload.dispose();  // just in case -- should be no-op
          // Extract the actual error value from the payload, not the payload itself
          this.abort(payload.value, false);
          return true;
        }
      }
    }

    return false;  // Invalid message
  }

  async #readLoop(abortPromise: Promise<never>) {
    while (!this.#abortReason) {
      // Wait for at least one message
      const rawMessage = await Promise.race([this.#transport.receive(), abortPromise]);
      if (this.#abortReason) break;

      if (!this.#processMessage(rawMessage)) {
        throw new Error(`bad RPC message: ${rawMessage}`);
      }

      // Batch process: if transport supports sync receive, process any immediately available messages
      // This reduces microtask overhead when many messages are queued
      if (this.#transport.tryReceiveSync) {
        let nextMsg: string | undefined;
        while (!this.#abortReason && (nextMsg = this.#transport.tryReceiveSync()) !== undefined) {
          if (!this.#processMessage(nextMsg)) {
            throw new Error(`bad RPC message: ${nextMsg}`);
          }
        }
      }
    }
  }

  async drain(): Promise<void> {
    if (this.#abortReason) {
      throw this.#abortReason;
    }

    if (this.#pullCount > 0) {
      let {promise, resolve, reject} = Promise.withResolvers<void>();
      this.#onBatchDone = {resolve, reject};
      await promise;
    }
  }

  getStats(): {imports: number, exports: number} {
    let result = {imports: 0, exports: 0};
    // We can't just use `.length` because the arrays can be sparse and can have negative indexes.
    for (let i in this.#imports) {
      ++result.imports;
    }
    for (let i in this.#exports) {
      ++result.exports;
    }
    return result;
  }
}

// ============================================================================
// Public RpcSession API
// ============================================================================

// Public interface that wraps RpcSession and hides private implementation details (even from
// JavaScript with no type enforcement).
export class RpcSession<T = unknown> {
  #session: RpcSessionImpl;
  #mainStub: RpcStub;
  #options: RpcSessionOptions;
  #transport: RpcTransport;
  #localMain: unknown;
  #isInitiator: boolean;

  // Reconnection state
  #state: SessionState = "active";
  #sessionId?: string;
  #reconnectAttempt: number = 0;
  #reconnectCancelled: boolean = false;

  // Expose options for testing
  options: RpcSessionOptions;

  constructor(transport: RpcTransport, localMain?: unknown, options: RpcSessionOptions = {},
              isInitiator: boolean = true) {
    // Validate maxMessageSize if provided
    if (options.maxMessageSize !== undefined) {
      if (!Number.isInteger(options.maxMessageSize) || options.maxMessageSize <= 0) {
        throw new Error(
          `maxMessageSize must be a positive integer, got ${options.maxMessageSize}`
        );
      }
    }

    // Validate maxRecursionDepth if provided
    if (options.maxRecursionDepth !== undefined) {
      if (!Number.isInteger(options.maxRecursionDepth) || options.maxRecursionDepth <= 0) {
        throw new Error(
          `maxRecursionDepth must be a positive integer, got ${options.maxRecursionDepth}`
        );
      }
    }

    this.#options = options;
    this.options = options;  // Expose for testing
    this.#transport = transport;
    this.#localMain = localMain;
    this.#isInitiator = isInitiator;
    this.#sessionId = options.sessionId;

    let mainHook: StubHook;
    if (localMain) {
      mainHook = new PayloadStubHook(RpcPayload.fromAppReturn(localMain));
    } else {
      mainHook = new ErrorStubHook(new Error("This connection has no main object."));
    }
    this.#session = new RpcSessionImpl(transport, mainHook, options, isInitiator);
    this.#mainStub = new RpcStub(this.#session.getMainImport());

    // Set up reconnection handling
    this.#setupReconnectionHandler();
  }

  #setupReconnectionHandler(): void {
    // Listen for session close and trigger reconnection if configured
    this.#session.onClosed().then(error => {
      if (this.#reconnectCancelled) {
        return;
      }
      if (this.#state === "closed") {
        return;
      }
      if (error && this.#options.reconnect) {
        this.#handleDisconnect(error);
      } else {
        this.#setState("closed");
      }
    });
  }

  async #handleDisconnect(error: Error): Promise<void> {
    if (this.#state === "closed" || this.#reconnectCancelled) {
      return;
    }

    this.#setState("reconnecting");
    this.#options.onReconnecting?.(error);

    const strategy = this.#options.reconnectionStrategy ?? {};
    const maxAttempts = strategy.maxAttempts ?? 3;
    const initialDelay = strategy.initialDelay ?? 100;
    const maxDelay = strategy.maxDelay ?? 30000;
    const backoffMultiplier = strategy.backoffMultiplier ?? 2;
    const jitter = strategy.jitter ?? 0;

    let attempt = 0;
    let delay = initialDelay;

    while (!this.#reconnectCancelled) {
      attempt++;
      this.#reconnectAttempt = attempt;

      let actualDelay = delay;
      if (jitter > 0) {
        const jitterAmount = delay * jitter;
        actualDelay = delay + (Math.random() * 2 - 1) * jitterAmount;
        actualDelay = Math.max(0, actualDelay);
      }

      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, actualDelay));
      }

      if (this.#reconnectCancelled) {
        break;
      }

      try {
        const newTransport = await this.#options.reconnect!(attempt, error);

        if (this.#reconnectCancelled) {
          break;
        }

        if (newTransport === null) {
          this.#setState("closed");
          return;
        }

        this.#transport = newTransport;
        let mainHook: StubHook;
        if (this.#localMain) {
          mainHook = new PayloadStubHook(RpcPayload.fromAppReturn(this.#localMain));
        } else {
          mainHook = new ErrorStubHook(new Error("This connection has no main object."));
        }
        this.#session = new RpcSessionImpl(newTransport, mainHook, this.#options, this.#isInitiator);
        this.#mainStub = new RpcStub(this.#session.getMainImport());

        this.#setupReconnectionHandler();

        this.#setState("active");
        this.#options.onReconnected?.(attempt);
        this.#reconnectAttempt = 0;

        return;
      } catch (reconnectError) {
        if (maxAttempts > 0 && attempt >= maxAttempts) {
          this.#setState("closed");
          return;
        }
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      }
    }

    this.#setState("closed");
  }

  #setState(newState: SessionState): void {
    if (this.#state !== newState) {
      this.#state = newState;
      this.#options.onStateChange?.(newState);
    }
  }

  getRemoteMain(): RpcStub {
    return this.#mainStub;
  }

  getStats(): {imports: number, exports: number} {
    return this.#session.getStats();
  }

  drain(): Promise<void> {
    return this.#session.drain();
  }

  /**
   * Get the negotiated protocol version for this session.
   * Returns the current protocol version if handshake was skipped.
   */
  getNegotiatedVersion(): string {
    return this.#session.getNegotiatedVersion();
  }

  /**
   * Check if the version handshake has completed.
   */
  isHandshakeComplete(): boolean {
    return this.#session.isHandshakeComplete();
  }

  /**
   * Wait for the version handshake to complete.
   * Resolves immediately if handshake was skipped or already complete.
   */
  waitForHandshake(): Promise<void> {
    return this.#session.waitForHandshake();
  }

  /**
   * Close the session gracefully.
   * @param reason Optional error to propagate as the close reason
   */
  close(reason?: Error): void {
    this.#reconnectCancelled = true;
    this.#setState("closed");
    this.#session.close(reason);
  }

  /**
   * Returns a promise that resolves when the session closes.
   * Resolves with undefined for normal close, or Error for abnormal close.
   */
  onClosed(): Promise<Error | undefined> {
    return this.#session.onClosed();
  }

  /**
   * Returns true if the session has been closed.
   */
  get isClosed(): boolean {
    return this.#session.getIsClosed();
  }

  // ==========================================================================
  // Session state methods
  // ==========================================================================

  /**
   * Get the current session state.
   */
  getState(): SessionState {
    return this.#state;
  }

  /**
   * Get the session ID if one was configured.
   */
  getSessionId(): string | undefined {
    return this.#sessionId;
  }

  // ==========================================================================
  // Backpressure methods
  // ==========================================================================

  /**
   * Returns the current number of pending (unresolved) RPC calls.
   */
  getPendingCallCount(): number {
    return this.#session.getPendingCallCount();
  }

  /**
   * Returns true if the session is under backpressure.
   * This is the case when the pending call count has reached the maxPendingCalls limit.
   */
  hasBackpressure(): boolean {
    return this.#session.hasBackpressure();
  }

  /**
   * Returns a promise that resolves when the pending call count drops below the limit.
   * If there's no backpressure, resolves immediately.
   */
  waitForDrain(): Promise<void> {
    return this.#session.waitForDrain();
  }
}
