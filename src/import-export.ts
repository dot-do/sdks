// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, RpcPayload, PropertyPath, ErrorStubHook } from "./core.js";
import { ExportId, ImportId } from "./serialize.js";
import { EmbargoedStubHook } from "./embargo.js";

// ============================================================================
// Session Interface
// ============================================================================

/**
 * Interface for the session that ImportTableEntry and RpcImportHook need to interact with.
 * This allows import-export.ts to not depend directly on the full RpcSessionImpl.
 */
export interface ImportExportSession {
  // Callbacks that fire when the connection is broken
  onBrokenCallbacks: ((error: unknown) => void)[];

  // Throws if the session is aborted (synchronous check for abort/transport error)
  throwIfAborted(): void;

  // Send a pull message to request resolution of a promise
  sendPull(importId: ImportId): void;

  // Send a release message to tell the peer we're done with an import
  sendRelease(importId: ImportId, remoteRefcount: number): void;

  // Send a call through the session (returns an import hook for the result)
  // May return a DeferredImportHook if blocking on backpressure
  sendCall(importId: ImportId, path: PropertyPath, args?: RpcPayload, callTimeoutMs?: number): StubHook;

  // Send a map operation through the session
  sendMap(importId: ImportId, path: PropertyPath, captures: StubHook[], instructions: unknown[]): RpcImportHook;

  // Shutdown the session (called when main stub is disposed)
  shutdown(): void;
}

// ============================================================================
// Export Table
// ============================================================================

/**
 * Entry on the exports table.
 */
export type ExportTableEntry = {
  hook: StubHook,
  refcount: number,
  pull?: Promise<void>
};

// ============================================================================
// Import Table
// ============================================================================

/**
 * Entry on the imports table.
 */
export class ImportTableEntry {
  constructor(public session: ImportExportSession, public importId: number, pulling: boolean) {
    if (pulling) {
      this.#activePull = Promise.withResolvers<void>();
    }
  }

  public localRefcount: number = 0;
  public remoteRefcount: number = 1;

  #activePull?: PromiseWithResolvers<void>;
  public resolution?: StubHook;

  // Timeout tracking
  #timeoutId?: ReturnType<typeof setTimeout>;
  #timeoutStartTime?: number;

  /**
   * Start a timeout timer. When the timeout fires, onTimeout is called.
   * @param ms - Timeout duration in milliseconds
   * @param onTimeout - Callback invoked when timeout fires
   */
  startTimeout(ms: number, onTimeout: () => void): void {
    if (ms <= 0) return; // 0 or negative means no timeout
    this.#timeoutStartTime = Date.now();
    this.#timeoutId = setTimeout(onTimeout, ms);
  }

  /**
   * Clear the timeout timer if one is active.
   */
  clearTimeout(): void {
    if (this.#timeoutId !== undefined) {
      clearTimeout(this.#timeoutId);
      this.#timeoutId = undefined;
    }
  }

  /**
   * Get the elapsed time since timeout was started.
   * Returns undefined if no timeout was started.
   */
  getElapsedTime(): number | undefined {
    if (this.#timeoutStartTime === undefined) return undefined;
    return Date.now() - this.#timeoutStartTime;
  }

  // List of integer indexes into session.onBrokenCallbacks which are callbacks registered on
  // this import. Initialized on first use (so `undefined` is the same as an empty list).
  #onBrokenRegistrations?: number[];

  // Tracks outstanding pipelined calls made on this import before resolution.
  // Each entry is a PromiseWithResolvers that will be resolved when the pipelined call's
  // result is resolved (or the import is aborted).
  #pendingPipelinedCalls?: PromiseWithResolvers<void>[];

  // Register a pipelined call and return a resolver to call when the call completes.
  // This is used to implement embargo handling - when resolve() is called, we wrap
  // the resolution in a hook that waits for all pending pipelined calls to complete.
  registerPipelinedCall(): PromiseWithResolvers<void> {
    if (!this.#pendingPipelinedCalls) {
      this.#pendingPipelinedCalls = [];
    }
    const resolver = Promise.withResolvers<void>();
    // Attach a no-op catch handler to prevent unhandled rejection warnings.
    // The actual handling is done via Promise.allSettled in resolve().
    resolver.promise.catch(() => {});
    this.#pendingPipelinedCalls.push(resolver);
    return resolver;
  }

  resolve(resolution: StubHook) {
    // Clear any active timeout since we got a response
    this.clearTimeout();

    // Embargo handling for promise pipelining:
    // When a promise resolves, calls that were pipelined through the introducer (the party
    // that held the promise) may still be in flight. We need to ensure these calls complete
    // before allowing direct calls to the resolved capability. This prevents race conditions
    // where a direct call could arrive before an earlier pipelined call.
    //
    // The embargo works as follows:
    // 1. Before resolution, pipelined calls are registered via registerPipelinedCall()
    // 2. When resolve() is called, if there are pending pipelined calls, we wrap the
    //    resolution in an EmbargoedStubHook that waits for all pending calls to complete
    // 3. The embargo is lifted when all pipelined calls have received their resolutions

    if (this.localRefcount == 0) {
      // Already disposed (canceled), so ignore the resolution and don't send a redundant release.
      resolution.dispose();
      return;
    }

    // If there are pending pipelined calls, wrap the resolution in an embargoed hook
    // that waits for all of them to complete before allowing direct calls.
    if (this.#pendingPipelinedCalls && this.#pendingPipelinedCalls.length > 0) {
      const embargoPromises = this.#pendingPipelinedCalls.map(r => r.promise);
      // Create a promise that resolves when all pending pipelined calls complete.
      // Use Promise.allSettled to handle cases where some pipelined calls may have been
      // aborted (e.g., if the import was disposed). We still proceed with the resolution
      // since the embargo is about ordering, not about success of the pipelined calls.
      const embargoPromise = Promise.allSettled(embargoPromises).then(() => resolution);
      // Wrap in EmbargoedStubHook which forwards calls through the promise until embargo lifts
      this.resolution = new EmbargoedStubHook(embargoPromise, resolution);
      this.#pendingPipelinedCalls = undefined;
    } else {
      this.resolution = resolution;
    }
    this.#sendRelease();

    if (this.#onBrokenRegistrations) {
      // Delete all our callback registrations from this session and re-register them on the
      // target stub.
      for (let i of this.#onBrokenRegistrations) {
        let callback = this.session.onBrokenCallbacks[i];
        let endIndex = this.session.onBrokenCallbacks.length;
        resolution.onBroken(callback);
        if (this.session.onBrokenCallbacks[endIndex] === callback) {
          // Oh, calling onBroken() just registered the callback back on this connection again.
          // But when the connection dies, we want all the callbacks to be called in the order in
          // which they were registered. So we don't want this one pushed to the back of the line
          // here. So, let's remove the newly-added registration and keep the original.
          //
          // Design note: We maintain callback ordering by detecting re-registration and
          // preserving the original position. This ensures predictable callback invocation order
          // when the connection breaks, which is important for cleanup sequencing.
          delete this.session.onBrokenCallbacks[endIndex];
        } else {
          // The callback is now registered elsewhere, so delete it from our session.
          delete this.session.onBrokenCallbacks[i];
        }
      }
      this.#onBrokenRegistrations = undefined;
    }

    if (this.#activePull) {
      this.#activePull.resolve();
      this.#activePull = undefined;
    }

    // Notify any registered resolution callbacks
    if (this.#onResolvedCallbacks) {
      for (const callback of this.#onResolvedCallbacks) {
        try {
          callback();
        } catch (e) {
          // Ignore errors in callbacks
        }
      }
      this.#onResolvedCallbacks = undefined;
    }
  }

  // Callbacks to invoke when this import is resolved. Used to signal the parent
  // import's embargo handler that this pipelined call has completed.
  #onResolvedCallbacks?: (() => void)[];

  // Register a callback to be called when this import is resolved.
  // Used by the embargo mechanism to track when pipelined calls complete.
  onResolved(callback: () => void): void {
    if (this.resolution) {
      // Already resolved, call immediately
      callback();
    } else {
      if (!this.#onResolvedCallbacks) {
        this.#onResolvedCallbacks = [];
      }
      this.#onResolvedCallbacks.push(callback);
    }
  }

  async awaitResolution(): Promise<RpcPayload> {
    // If already resolved (including abort/error cases), return immediately
    if (this.resolution) {
      return this.resolution.pull();
    }

    if (!this.#activePull) {
      this.session.sendPull(this.importId);
      this.#activePull = Promise.withResolvers<void>();
    }
    await this.#activePull.promise;
    return this.resolution!.pull();
  }

  dispose() {
    if (this.resolution) {
      this.resolution.dispose();
    } else {
      this.abort(new Error("RPC was canceled because the RpcPromise was disposed."));
      this.#sendRelease();
    }
  }

  abort(error: unknown) {
    // Clear any active timeout
    this.clearTimeout();

    if (!this.resolution) {
      this.resolution = new ErrorStubHook(error);

      if (this.#activePull) {
        this.#activePull.reject(error);
        this.#activePull = undefined;
      }

      // Reject all pending pipelined calls so they don't block forever.
      // Note: We reject rather than resolve because the calls won't complete successfully.
      if (this.#pendingPipelinedCalls) {
        for (const resolver of this.#pendingPipelinedCalls) {
          resolver.reject(error);
        }
        this.#pendingPipelinedCalls = undefined;
      }

      // Notify any registered resolution callbacks (even for errors, the import is now "resolved")
      if (this.#onResolvedCallbacks) {
        for (const callback of this.#onResolvedCallbacks) {
          try {
            callback();
          } catch (e) {
            // Ignore errors in callbacks
          }
        }
        this.#onResolvedCallbacks = undefined;
      }

      // The RpcSession itself will have called all our callbacks so we don't need to track the
      // registrations anymore.
      this.#onBrokenRegistrations = undefined;
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    if (this.resolution) {
      this.resolution.onBroken(callback);
    } else {
      let index = this.session.onBrokenCallbacks.length;
      this.session.onBrokenCallbacks.push(callback);

      if (!this.#onBrokenRegistrations) this.#onBrokenRegistrations = [];
      this.#onBrokenRegistrations.push(index);
    }
  }

  #sendRelease() {
    if (this.remoteRefcount > 0) {
      this.session.sendRelease(this.importId, this.remoteRefcount);
      this.remoteRefcount = 0;
    }
  }
}

// ============================================================================
// Import Hooks
// ============================================================================

export class RpcImportHook extends StubHook {
  public entry?: ImportTableEntry;  // undefined when we're disposed

  // `pulling` is true if we already expect that this import is going to be resolved later, and
  // null if this import is not allowed to be pulled (i.e. it's a stub not a promise).
  constructor(public isPromise: boolean, entry: ImportTableEntry) {
    super();
    ++entry.localRefcount;
    this.entry = entry;
  }

  collectPath(path: PropertyPath): RpcImportHook {
    return this;
  }

  getEntry(): ImportTableEntry {
    if (this.entry) {
      return this.entry;
    } else {
      // Shouldn't get here in practice since the holding stub should have replaced the hook when
      // disposed.
      throw new Error("This RpcImportHook was already disposed.");
    }
  }

  // -------------------------------------------------------------------------------------
  // implements StubHook

  call(path: PropertyPath, args: RpcPayload): StubHook {
    let entry = this.getEntry();
    // Always check abort status first, even if we have a resolution.
    // This ensures consistent synchronous error behavior.
    entry.session.throwIfAborted();

    if (entry.resolution) {
      return entry.resolution.call(path, args);
    } else {
      // Extract per-call timeout from call options if present
      const callTimeoutMs = args.callOptions?.timeout;
      return entry.session.sendCall(entry.importId, path, args, callTimeoutMs);
    }
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    let entry: ImportTableEntry;
    try {
      entry = this.getEntry();
    } catch (err) {
      for (let cap of captures) {
        cap.dispose();
      }
      throw err;
    }

    if (entry.resolution) {
      return entry.resolution.map(path, captures, instructions);
    } else {
      return entry.session.sendMap(entry.importId, path, captures, instructions);
    }
  }

  get(path: PropertyPath): StubHook {
    let entry = this.getEntry();
    if (entry.resolution) {
      return entry.resolution.get(path);
    } else {
      return entry.session.sendCall(entry.importId, path);
    }
  }

  dup(): RpcImportHook {
    return new RpcImportHook(false, this.getEntry());
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    let entry = this.getEntry();

    if (!this.isPromise) {
      throw new Error("Can't pull this hook because it's not a promise hook.");
    }

    if (entry.resolution) {
      return entry.resolution.pull();
    }

    return entry.awaitResolution();
  }

  ignoreUnhandledRejections(): void {
    // We don't actually have to do anything here because this method only has to ignore rejections
    // if pull() is *not* called, and if pull() is not called then we won't generate any rejections
    // anyway.
  }

  dispose(): void {
    let entry = this.entry;
    this.entry = undefined;
    if (entry) {
      if (--entry.localRefcount === 0) {
        entry.dispose();
      }
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    if (this.entry) {
      this.entry.onBroken(callback);
    }
  }
}

export class RpcMainHook extends RpcImportHook {
  #session?: ImportExportSession;

  constructor(entry: ImportTableEntry) {
    super(false, entry);
    this.#session = entry.session;
  }

  dispose(): void {
    if (this.#session) {
      let session = this.#session;
      this.#session = undefined;
      session.shutdown();
    }
  }
}

// ============================================================================
// Deferred Import Hook (for blocking backpressure)
// ============================================================================

/**
 * A StubHook that wraps a promise for another StubHook.
 * Used when a call is blocked due to backpressure and needs to wait for capacity.
 * All operations are deferred until the underlying hook is resolved.
 */
export class DeferredImportHook extends StubHook {
  #innerHookPromise: Promise<StubHook>;
  #innerHook?: StubHook;
  #disposed = false;
  #onBrokenCallbacks: ((error: unknown) => void)[] = [];
  #rejectHook?: (error: unknown) => void;

  constructor(innerHookPromise: Promise<StubHook>) {
    super();
    this.#innerHookPromise = innerHookPromise;

    // When the inner hook resolves, save it and register onBroken callbacks
    innerHookPromise.then(
      hook => {
        this.#innerHook = hook;
        // Register any pending onBroken callbacks
        for (const callback of this.#onBrokenCallbacks) {
          hook.onBroken(callback);
        }
        // If we were disposed while waiting, dispose the inner hook
        if (this.#disposed) {
          hook.dispose();
        }
      },
      error => {
        // If the hook promise rejects (e.g., session closed while waiting),
        // propagate to onBroken callbacks
        for (const callback of this.#onBrokenCallbacks) {
          try {
            callback(error);
          } catch {
            // Ignore callback errors
          }
        }
      }
    );
  }

  /**
   * Set a rejection handler that can be called to reject this deferred hook.
   * Used for timeout handling.
   */
  setRejectHandler(reject: (error: unknown) => void): void {
    this.#rejectHook = reject;
  }

  /**
   * Reject this hook with an error.
   */
  reject(error: unknown): void {
    if (this.#rejectHook) {
      this.#rejectHook(error);
    }
  }

  call(path: PropertyPath, args: RpcPayload): StubHook {
    // Create a deferred hook that waits for this hook to resolve, then calls on it
    return new DeferredImportHook(
      this.#innerHookPromise.then(hook => hook.call(path, args))
    );
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    return new DeferredImportHook(
      this.#innerHookPromise.then(hook => hook.map(path, captures, instructions))
    );
  }

  get(path: PropertyPath): StubHook {
    return new DeferredImportHook(
      this.#innerHookPromise.then(hook => hook.get(path))
    );
  }

  dup(): StubHook {
    return new DeferredImportHook(
      this.#innerHookPromise.then(hook => hook.dup())
    );
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    // Wait for the inner hook to resolve, then pull from it
    // If the inner hook promise rejects (e.g., timeout), the rejection propagates
    return this.#innerHookPromise.then(
      hook => hook.pull(),
      error => {
        // Re-throw the error to propagate it
        throw error;
      }
    );
  }

  ignoreUnhandledRejections(): void {
    // Will be called on inner hook when it resolves
    this.#innerHookPromise.then(hook => hook.ignoreUnhandledRejections()).catch(() => {});
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#innerHook) {
      this.#innerHook.dispose();
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    if (this.#innerHook) {
      this.#innerHook.onBroken(callback);
    } else {
      this.#onBrokenCallbacks.push(callback);
    }
  }
}
