// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { PropertyPath } from "./types.js";
import type { RpcPayload } from "./payload.js";
import { StubHook } from "./stub-hook.js";

/**
 * Abstract base class for StubHooks that delegate to a promise for another StubHook.
 *
 * This implements the synchronous resolution check pattern used by:
 * - EmbargoedCallStubHook: Wraps calls made during embargo periods
 * - DeferredImportHook: Wraps calls blocked by backpressure
 *
 * The pattern works as follows:
 * 1. Operations check if the inner hook has resolved synchronously via isResolved()
 * 2. If resolved, operations forward directly to the resolved hook
 * 3. If not resolved, operations chain through the promise
 *
 * RACE CONDITION FIX: We store the resolved hook directly in a field that is set
 * in the .then() callback. Since .then() callbacks run in the same microtask as
 * promise resolution, there's no race window between "promise resolved" and "flag set".
 */
export abstract class PromiseDelegatingStubHook extends StubHook {
  #promise: Promise<StubHook>;
  // Stores the resolved hook synchronously when the promise resolves.
  // undefined means not yet resolved. This is set in the .then() callback.
  #resolvedHook: StubHook | undefined = undefined;

  constructor(promise: Promise<StubHook>) {
    super();
    // Chain the promise to set the resolved hook synchronously
    this.#promise = promise.then(res => { this.#resolvedHook = res; return res; });
  }

  /**
   * Get the underlying promise. Subclasses may need this for chaining.
   */
  protected get innerPromise(): Promise<StubHook> {
    return this.#promise;
  }

  /**
   * Synchronously check if the promise has resolved.
   */
  protected isResolved(): boolean {
    return this.#resolvedHook !== undefined;
  }

  /**
   * Get the resolved hook. Only call this if isResolved() returns true.
   */
  protected getResolvedHook(): StubHook {
    return this.#resolvedHook!;
  }

  /**
   * Create a new delegating hook of the same type.
   * Subclasses must implement this to return the appropriate type.
   */
  protected abstract createDelegatingHook(promise: Promise<StubHook>): PromiseDelegatingStubHook;

  call(path: PropertyPath, args: RpcPayload): StubHook {
    if (this.isResolved()) {
      return this.getResolvedHook().call(path, args);
    }
    // Chain calls through the promise to maintain e-order
    args.ensureDeepCopied();
    return this.createDelegatingHook(this.#promise.then(hook => hook.call(path, args)));
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    if (this.isResolved()) {
      return this.getResolvedHook().map(path, captures, instructions);
    }
    return this.createDelegatingHook(this.#promise.then(
      hook => hook.map(path, captures, instructions),
      err => {
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }
    ));
  }

  get(path: PropertyPath): StubHook {
    if (this.isResolved()) {
      return this.getResolvedHook().get(path);
    }
    return this.createDelegatingHook(this.#promise.then(hook => hook.get(path)));
  }

  dup(): StubHook {
    if (this.isResolved()) {
      return this.getResolvedHook().dup();
    }
    return this.createDelegatingHook(this.#promise.then(hook => hook.dup()));
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    if (this.isResolved()) {
      return this.getResolvedHook().pull();
    }
    return this.#promise.then(hook => hook.pull());
  }

  ignoreUnhandledRejections(): void {
    if (this.isResolved()) {
      this.getResolvedHook().ignoreUnhandledRejections();
    } else {
      this.#promise.then(res => res.ignoreUnhandledRejections(), () => {});
    }
  }

  dispose(): void {
    if (this.isResolved()) {
      this.getResolvedHook().dispose();
    } else {
      this.#promise.then(hook => hook.dispose(), () => {});
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    if (this.isResolved()) {
      this.getResolvedHook().onBroken(callback);
    } else {
      this.#promise.then(hook => hook.onBroken(callback), callback);
    }
  }
}
