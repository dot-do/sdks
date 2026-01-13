// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, RpcPayload, PropertyPath, PromiseDelegatingStubHook } from "./core.js";

// EmbargoedStubHook wraps a resolution that is under embargo due to pending pipelined calls.
// It maintains e-order by ensuring that calls made through this hook during the embargo period
// are queued and delivered after the embargo lifts, preserving the order relative to pipelined
// calls that are still in flight.
//
// The embargo ensures that:
// 1. Calls made before the embargo lifts are queued and delivered in order
// 2. Once the embargo lifts, new calls go directly to the resolution
// 3. Queued calls are delivered before direct calls to preserve e-order
//
// RACE CONDITION FIX: We use a synchronous resolution check pattern.
// Instead of a boolean flag set via .then(), we store the lifted hook directly.
// The #liftedHook field is set in the same microtask as the promise resolution callback,
// and we check it synchronously. This eliminates the race window where the promise is
// resolved but the flag hasn't been set yet.
export class EmbargoedStubHook extends StubHook {
  #embargoPromise: Promise<StubHook>;
  #resolution: StubHook;
  // Stores the lifted hook synchronously when the embargo promise resolves.
  // undefined means embargo is not yet lifted. This is set in the .then() callback,
  // which runs in the same microtask as the promise resolution.
  #liftedHook: StubHook | undefined = undefined;

  constructor(embargoPromise: Promise<StubHook>, resolution: StubHook) {
    super();
    this.#embargoPromise = embargoPromise;
    this.#resolution = resolution;

    // Set #liftedHook synchronously when the embargo lifts.
    // This runs in the same microtask as the promise resolution, so there's no
    // race window between "promise resolved" and "flag set".
    this.#embargoPromise.then(
      (hook) => { this.#liftedHook = hook; },
      () => {
        // Embargo was aborted, but we still have the resolution.
        // Use the resolution directly since we can't get the hook from the rejected promise.
        this.#liftedHook = this.#resolution;
      }
    );
  }

  // Synchronously check if the embargo has lifted by testing if #liftedHook is set.
  // This avoids the race condition where the promise is resolved but we haven't
  // processed the .then() callback yet - that can't happen because the .then()
  // callback runs in the same microtask as the resolution.
  #isLifted(): boolean {
    return this.#liftedHook !== undefined;
  }

  call(path: PropertyPath, args: RpcPayload): StubHook {
    if (this.#isLifted()) {
      // Embargo has lifted, forward directly to the lifted hook
      return this.#liftedHook!.call(path, args);
    }

    // During embargo, we need to ensure e-order by waiting for the embargo to lift
    // before forwarding the call. This is similar to how PromiseStubHook works.
    // We must deep-copy args since we can't serialize them yet.
    args.ensureDeepCopied();

    return new EmbargoedCallStubHook(
      this.#embargoPromise.then(hook => hook.call(path, args))
    );
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    if (this.#isLifted()) {
      return this.#liftedHook!.map(path, captures, instructions);
    }

    return new EmbargoedCallStubHook(
      this.#embargoPromise.then(
        hook => hook.map(path, captures, instructions),
        err => {
          for (let cap of captures) {
            cap.dispose();
          }
          throw err;
        }
      )
    );
  }

  get(path: PropertyPath): StubHook {
    if (this.#isLifted()) {
      return this.#liftedHook!.get(path);
    }

    return new EmbargoedCallStubHook(
      this.#embargoPromise.then(hook => hook.get(path))
    );
  }

  dup(): StubHook {
    if (this.#isLifted()) {
      return this.#liftedHook!.dup();
    }
    // During embargo, we need to dup the underlying resolution
    // but maintain embargo semantics for the duplicate
    return new EmbargoedStubHook(this.#embargoPromise, this.#resolution.dup());
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    // Pull is not subject to e-order concerns, so we can use the resolution directly
    return this.#resolution.pull();
  }

  ignoreUnhandledRejections(): void {
    this.#resolution.ignoreUnhandledRejections();
  }

  dispose(): void {
    this.#resolution.dispose();
  }

  onBroken(callback: (error: unknown) => void): void {
    this.#resolution.onBroken(callback);
  }
}

// EmbargoedCallStubHook wraps a call made during an embargo period.
// It waits for the embargo to lift before delivering the call result.
//
// Extends PromiseDelegatingStubHook which implements the synchronous resolution
// check pattern to eliminate race conditions between promise resolution and flag setting.
export class EmbargoedCallStubHook extends PromiseDelegatingStubHook {
  constructor(promise: Promise<StubHook>) {
    super(promise);
  }

  protected createDelegatingHook(promise: Promise<StubHook>): PromiseDelegatingStubHook {
    return new EmbargoedCallStubHook(promise);
  }
}
