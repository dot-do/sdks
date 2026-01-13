// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, DISPOSED_HOOK, getCallHandler } from "./stub-hook.js";
import { RpcPayload } from "./payload.js";
import { RpcTarget } from "./target.js";
import { RAW_STUB } from "./utils.js";
import { mapImpl } from "./map-impl.js";
import { registry, getRpcPromise, getPayloadStubHook, getTargetStubHook } from "./registry.js";
import type { PropertyPath } from "./types.js";

export interface RpcStub extends Disposable {
  // Declare magic `RAW_STUB` key that unwraps the proxy.
  [RAW_STUB]: this;
}

const PROXY_HANDLERS: ProxyHandler<{raw: RpcStub}> = {
  apply(target: {raw: RpcStub}, thisArg: any, argumentsList: any[]) {
    const RpcPromise = getRpcPromise();
    let stub = target.raw;
    return new RpcPromise(getCallHandler()(stub.hook,
        stub.pathIfPromise || [], RpcPayload.fromAppParams(argumentsList)), []);
  },

  get(target: {raw: RpcStub}, prop: string | symbol, receiver: any) {
    const RpcPromise = getRpcPromise();
    let stub = target.raw;
    if (prop === RAW_STUB) {
      return stub;
    } else if (prop in RpcPromise.prototype) {
      // Any method or property declared on RpcPromise (including inherited from RpcStub or
      // Object) should pass through to the target object, as trying to turn these into RPCs will
      // likely be problematic.
      //
      // Note we don't just check `prop in target` because we intentionally want to hide the
      // properties `hook` and `path`.
      return (<any>stub)[prop];
    } else if (typeof prop === "string") {
      // Return promise for property.
      return new RpcPromise(stub.hook,
          stub.pathIfPromise ? [...stub.pathIfPromise, prop] : [prop]);
    } else if (prop === Symbol.dispose &&
          (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      // We only advertise Symbol.dispose on stubs and root promises, not properties.
      return () => {
        stub.hook.dispose();
        stub.hook = DISPOSED_HOOK;
      };
    } else {
      return undefined;
    }
  },

  has(target: {raw: RpcStub}, prop: string | symbol) {
    const RpcPromise = getRpcPromise();
    let stub = target.raw;
    if (prop === RAW_STUB) {
      return true;
    } else if (prop in RpcPromise.prototype) {
      return prop in stub;
    } else if (typeof prop === "string") {
      return true;
    } else if (prop === Symbol.dispose &&
          (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      return true;
    } else {
      return false;
    }
  },

  construct(target: {raw: RpcStub}, args: any) {
    throw new Error("An RPC stub cannot be used as a constructor.");
  },

  defineProperty(target: {raw: RpcStub}, property: string | symbol, attributes: PropertyDescriptor)
      : boolean {
    throw new Error("Can't define properties on RPC stubs.");
  },

  deleteProperty(target: {raw: RpcStub}, p: string | symbol): boolean {
    throw new Error("Can't delete properties on RPC stubs.");
  },

  getOwnPropertyDescriptor(target: {raw: RpcStub}, p: string | symbol): PropertyDescriptor | undefined {
    // Treat all properties as prototype properties. That's probably fine?
    return undefined;
  },

  getPrototypeOf(target: {raw: RpcStub}): object | null {
    return Object.getPrototypeOf(target.raw);
  },

  isExtensible(target: {raw: RpcStub}): boolean {
    return false;
  },

  ownKeys(target: {raw: RpcStub}): ArrayLike<string | symbol> {
    return [];
  },

  preventExtensions(target: {raw: RpcStub}): boolean {
    // Extensions are not possible anyway.
    return true;
  },

  set(target: {raw: RpcStub}, p: string | symbol, newValue: any, receiver: any): boolean {
    throw new Error("Can't assign properties on RPC stubs.");
  },

  setPrototypeOf(target: {raw: RpcStub}, v: object | null): boolean {
    throw new Error("Can't override prototype of RPC stubs.");
  },
};

// Implementation of RpcStub.
//
// Note that the in the public API, we override the type of RpcStub to reflect the interface
// exposed by the proxy. That happens in index.ts. But for internal purposes, it's easier to just
// omit the type parameter.
export class RpcStub extends RpcTarget {
  // Although `hook` and `path` are declared `public` here, they are effectively hidden by the
  // proxy.
  constructor(hook: StubHook, pathIfPromise?: PropertyPath) {
    super();

    if (!(hook instanceof StubHook)) {
      // Application invoked the constructor to explicitly construct a stub backed by some value
      // (usually an RpcTarget). (Note we override the types as seen by the app, which is why
      // the app can pass something that isn't a StubHook -- within the implementation, though,
      // we always pass StubHook.)
      let value = <any>hook;
      if (value instanceof RpcTarget || value instanceof Function) {
        const TargetStubHook = getTargetStubHook();
        hook = TargetStubHook.create(value, undefined);
      } else {
        // We adopt the value with "return" semantics since we want to take ownership of any stubs
        // within.
        const PayloadStubHook = getPayloadStubHook();
        hook = new PayloadStubHook(RpcPayload.fromAppReturn(value));
      }

      // Don't let app set this.
      if (pathIfPromise) {
        throw new TypeError("RpcStub constructor expected one argument, received two.");
      }
    }

    this.hook = hook;
    this.pathIfPromise = pathIfPromise;

    // Proxy has an unfortunate rule that it will only be considered callable if the underlying
    // `target` is callable, i.e. a function. So our target *must* be callable. So we use a
    // dummy function.
    let func: any = () => {};
    func.raw = this;
    return new Proxy(func, PROXY_HANDLERS);
  }

  public hook: StubHook;
  public pathIfPromise?: PropertyPath;

  dup(): RpcStub {
    // Unfortunately the method will be invoked with `this` being the Proxy, not the `RpcPromise`
    // itself, so we have to unwrap it.

    // Note dup() intentionally resets the path to empty and turns the result into a stub.
    // Design decision: dup() always returns RpcStub (not RpcPromise) to match Workers RPC behavior.
    // This is intentional because the duplicate represents a new reference to the target,
    // not a promise of a value. Users can await the stub if they need promise behavior.
    let target = this[RAW_STUB];
    if (target.pathIfPromise) {
      return new RpcStub(target.hook.get(target.pathIfPromise));
    } else {
      return new RpcStub(target.hook.dup());
    }
  }

  onRpcBroken(callback: (error: unknown) => void) {
    this[RAW_STUB].hook.onBroken(callback);
  }

  map(func: (value: any) => unknown): any {
    let {hook, pathIfPromise} = this[RAW_STUB];
    return mapImpl.sendMap(hook, pathIfPromise || [], func);
  }

  toString() {
    return "[object RpcStub]";
  }
}

// Given a stub (still wrapped in a Proxy), extract the underlying `StubHook`.
//
// The caller takes ownership, meaning it's expected that the original stub will never be disposed
// itself, but the caller is responsible for calling `dispose()` on the returned hook.
//
// However, if the stub points to a property of some other stub or promise, then no ownership is
// "transferred" because properties do not actually have disposers. However, the returned hook is
// a new hook that aliases that property, but does actually need to be disposed.
//
// The result is a promise (i.e. can be pull()ed) if and only if the input is a promise.
export function unwrapStubTakingOwnership(stub: RpcStub): StubHook {
  let {hook, pathIfPromise} = stub[RAW_STUB];

  if (pathIfPromise && pathIfPromise.length > 0) {
    return hook.get(pathIfPromise);
  } else {
    return hook;
  }
}

// Given a stub (still wrapped in a Proxy), extract the underlying `StubHook`, and duplicate it,
// returning the duplicate.
//
// The caller is responsible for disposing the returned hook, but the original stub also still
// needs to be disposed by its owner (unless it is a property, which never needs disposal).
//
// The result is a promise (i.e. can be pull()ed) if and only if the input is a promise. Note that
// this differs from the semantics of the actual `dup()` method.
export function unwrapStubAndDup(stub: RpcStub): StubHook {
  let {hook, pathIfPromise} = stub[RAW_STUB];

  if (pathIfPromise) {
    return hook.get(pathIfPromise);
  } else {
    return hook.dup();
  }
}

// Unwrap a stub returning the underlying `StubHook`, returning `undefined` if it is a property
// stub.
//
// This function is agnostic to ownership transfer. Exactly one of `stub` or the return `hook` must
// eventually be disposed (unless `undefined` is returned, in which case neither need to be
// disposed, as properties are not normally disposable).
export function unwrapStubNoProperties(stub: RpcStub): StubHook | undefined {
  let {hook, pathIfPromise} = stub[RAW_STUB];

  if (pathIfPromise && pathIfPromise.length > 0) {
    return undefined;
  }

  return hook;
}

// Unwrap a stub returning the underlying `StubHook`. If it's a property, return the `StubHook`
// representing the stub or promise of which is is a property.
//
// This function is agnostic to ownership transfer. Exactly one of `stub` or the return `hook` must
// eventually be disposed.
export function unwrapStubOrParent(stub: RpcStub): StubHook {
  return stub[RAW_STUB].hook;
}

// Given a stub (still wrapped in a Proxy), extract the `hook` and `pathIfPromise` properties.
//
// This function is agnostic to ownership transfer. Exactly one of `stub` or the return `hook` must
// eventually be disposed.
export function unwrapStubAndPath(stub: RpcStub): {hook: StubHook, pathIfPromise?: PropertyPath} {
  return stub[RAW_STUB];
}

// Register with the registry
// Type assertions are needed because the registry uses interface types to avoid circular deps,
// while the actual classes have additional implementation details
registry.RpcStub = RpcStub as unknown as typeof registry.RpcStub;
registry.unwrapStubTakingOwnership = unwrapStubTakingOwnership as typeof registry.unwrapStubTakingOwnership;
registry.unwrapStubAndDup = unwrapStubAndDup as typeof registry.unwrapStubAndDup;
registry.unwrapStubNoProperties = unwrapStubNoProperties as typeof registry.unwrapStubNoProperties;
registry.unwrapStubOrParent = unwrapStubOrParent as typeof registry.unwrapStubOrParent;
registry.unwrapStubAndPath = unwrapStubAndPath as typeof registry.unwrapStubAndPath;

// Re-export RAW_STUB for use in other modules
export { RAW_STUB };
