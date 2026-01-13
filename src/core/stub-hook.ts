// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { PropertyPath } from "./types.js";
import type { RpcPayload } from "./payload.js";

// Inner interface backing an RpcStub or RpcPromise.
//
// A hook may eventually resolve to a "payload".
//
// Declared as `abstract class` to allow `instanceof StubHook`, used by `RpcStub` constructor.
//
// This is conceptually similar to the Cap'n Proto C++ class `ClientHook`.
export abstract class StubHook {
  // Call a function at the given property path with the given arguments. Returns a hook for the
  // promise for the result.
  abstract call(path: PropertyPath, args: RpcPayload): StubHook;

  // Apply a map operation.
  //
  // `captures` is a list of external stubs which are used as part of the mapper function.
  // NOTE: The callee takes ownership of `captures`.
  //
  // `instructions` is a JSON-serializable value describing the mapper function as a series of
  // steps. Each step is an expression to evaluate, in the usual RPC expression format. The last
  // instruction is the return value.
  //
  // Each instruction can refer to the results of any of the instructions before it, as well as to
  // the captures, as if they were imports on the import table. In particular:
  // * The value 0 is the input to the mapper function (e.g. one element of the array being mapped).
  // * Positive values are 1-based indexes into the instruction table, representing the results of
  //   previous instructions.
  // * Negative values are -1-based indexes into the capture list.
  abstract map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook;

  // Read the property at the given path. Returns a StubHook representing a promise for that
  // property. This behaves very similarly to call(), except that no actual function is invoked
  // on the remote end, the property is simply returned. (Well, if the property has a getter, then
  // that will be invoked...)
  //
  // (In the case that this stub is a promise with a resolution payload, get() implies cloning
  // a branch of the payload, making a deep copy of any pass-by-value content.)
  abstract get(path: PropertyPath): StubHook;

  // Create a clone of this StubHook, which can be disposed independently.
  //
  // The returned hook is NOT considered a promise, so will not resolve to a payload (you can use
  // `get([])` to get a promise for a cloned payload).
  abstract dup(): StubHook;

  // Requests resolution of a StubHook that represents a promise, and eventually produces the
  // payload.
  //
  // pull() should not be called on capabilities that aren't promises. It may never resolve or it
  // may throw an exception.
  //
  // If pull() is never called (on a remote promise), the RPC system will not transmit the
  // resolution at all. This allows a promise to be used strictly for pipelining.
  //
  // If the payload is already available, pull() returns it immediately, instead of returning a
  // promise. This allows the caller to skip the microtask queue which is sometimes necessary to
  // maintain e-order guarantees.
  //
  // The returned RpcPayload is the same one backing the StubHook itself. If the caller delivers
  // or disposes the payload directly, then it should not call dispose() on the hook. If the caller
  // does not intend to consume the StubHook, the caller must take responsibility for cloning the
  // payload.
  //
  // You can call pull() multiple times, but it will return the same RpcPayload every time, and
  // that payload should only be disposed once.
  //
  // If pull() returns a promise which rejects, the StubHook does not need to be disposed.
  abstract pull(): RpcPayload | Promise<RpcPayload>;

  // Called to prevent this stub from generating unhandled rejection events if it throws without
  // having been pulled. Without this, if a client "push"es a call that immediately throws before
  // the client manages to "pull" it or use it in a pipeline, this may be treated by the system as
  // an unhandled rejection. Unfortunately, this unhandled rejection would be reported in the
  // callee rather than the caller, possibly causing the callee to crash or log spurious errors,
  // even though it's really up to the caller to deal with the exception!
  abstract ignoreUnhandledRejections(): void;

  // Attempts to cancel any outstanding promise backing this hook, and disposes the payload that
  // pull() would return (if any). If a pull() promise is outstanding, it may still resolve (with
  // a disposed payload) or it may reject. It's safe to call dispose() multiple times.
  abstract dispose(): void;

  abstract onBroken(callback: (error: unknown) => void): void;
}

export class ErrorStubHook extends StubHook {
  constructor(private error: unknown) { super(); }

  call(path: PropertyPath, args: RpcPayload): StubHook { return this; }
  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook { return this; }
  get(path: PropertyPath): StubHook { return this; }
  dup(): StubHook { return this; }
  pull(): RpcPayload | Promise<RpcPayload> { return Promise.reject(this.error); }
  ignoreUnhandledRejections(): void {}
  dispose(): void {}
  onBroken(callback: (error: unknown) => void): void {
    try {
      callback(this.error);
    } catch (err) {
      // Don't throw back into the RPC system. Treat this as an unhandled rejection.
      Promise.resolve(err);
    }
  }
}

// Sentinel hook for disposed stubs
export const DISPOSED_HOOK: StubHook = new ErrorStubHook(
    new Error("Attempted to use RPC stub after it has been disposed."));

// A call interceptor can be used to intercept all RPC stub invocations within some synchronous
// scope. This is used to implement record/replay
type CallInterceptor = (hook: StubHook, path: PropertyPath, params: RpcPayload) => StubHook;
let doCall: CallInterceptor = (hook: StubHook, path: PropertyPath, params: RpcPayload) => {
  return hook.call(path, params);
}

export function withCallInterceptor<T>(interceptor: CallInterceptor, callback: () => T): T {
  let oldValue = doCall;
  doCall = interceptor;
  try {
    return callback();
  } finally {
    doCall = oldValue;
  }
}

// Get the current call handler (for use by the stub proxy)
export function getCallHandler(): CallInterceptor {
  return doCall;
}
