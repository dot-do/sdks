// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, ErrorStubHook } from "./stub-hook.js";
import { RpcPayload } from "./payload.js";
import { typeForRpc } from "./types.js";
import type { PropertyPath } from "./types.js";
import { mapImpl } from "./map-impl.js";

// Use registry pattern to break circular dependencies
import {
  registry,
  getRpcStub,
  getRpcPromise,
  getUnwrapStubAndPath,
  type RpcStubConstructor,
  type RpcPromiseConstructor,
  type UnwrapStubAndPathFn,
  type RpcStubInstance,
} from "./registry.js";

// Forward declarations - populated from registry by ensureImports()
let RpcStub: RpcStubConstructor;
let RpcPromise: RpcPromiseConstructor;
let unwrapStubAndPath: UnwrapStubAndPathFn;

function ensureImports() {
  if (!RpcStub) {
    // Get values from registry - these will throw helpful errors if not populated
    RpcStub = getRpcStub();
    RpcPromise = getRpcPromise();
    unwrapStubAndPath = getUnwrapStubAndPath();
  }
}

// Result of followPath().
type FollowPathResult = {
  // Path led to a regular value.

  value: unknown,              // the value
  parent: object | undefined,  // the immediate parent (useful as `this` if making a call)
  owner: RpcPayload | null,    // RpcPayload that owns the value, if any

  hook?: never,
  remainingPath?: never,
} | {
  // Path leads into another stub, which needs to be called recursively.

  hook: StubHook,               // StubHook of the inner stub.
  remainingPath: PropertyPath,  // Path to pass to `hook` when recursing.

  value?: never,
  parent?: never,
  owner?: never,
};

function followPath(value: unknown, parent: object | undefined,
                    path: PropertyPath, owner: RpcPayload | null): FollowPathResult {
  ensureImports();

  for (let i = 0; i < path.length; i++) {
    parent = <object>value;

    let part = path[i];
    if (part in Object.prototype) {
      // Don't allow messing with Object.prototype properties over RPC. We block these even if
      // the specific object has overridden them for consistency with the deserialization code,
      // which will refuse to deserialize an object containing such properties. Anyway, it's
      // impossible for a normal client to even request these because accessing Object prototype
      // properties on a stub will resolve to the local prototype property, not making an RPC at
      // all.
      value = undefined;
      continue;
    }

    let kind = typeForRpc(value);
    switch (kind) {
      case "object":
      case "function":
        // Must be own property, NOT inherited from a prototype.
        if (Object.hasOwn(<object>value, part)) {
          value = (<any>value)[part];
        } else {
          value = undefined;
        }
        break;

      case "array":
        // For arrays, restrict specifically to numeric indexes, to be consistent with
        // serialization, which only sends a flat list.
        if (Number.isInteger(part) && <number>part >= 0) {
          value = (<any>value)[part];
        } else {
          value = undefined;
        }
        break;

      case "rpc-target":
      case "rpc-thenable": {
        // Must be prototype property, and must NOT be inherited from `Object`.
        if (Object.hasOwn(<object>value, part)) {
          // We throw an error in this case, rather than return undefined, because otherwise
          // people tend to get confused about this. If you don't want it to be possible to
          // probe the existence of your instance properties, make them properly private (prefix
          // with #).
          throw new TypeError(
              `Attempted to access property '${part}', which is an instance property of the ` +
              `RpcTarget. To avoid leaking private internals, instance properties cannot be ` +
              `accessed over RPC. If you want to make this property available over RPC, define ` +
              `it as a method or getter on the class, instead of an instance property.`);
        } else {
          value = (<any>value)[part];
        }

        // Since we're descending into the RpcTarget, the rest of the path is not "owned" by any
        // RpcPayload.
        owner = null;
        break;
      }

      case "stub":
      case "rpc-promise": {
        let {hook: hook, pathIfPromise} = unwrapStubAndPath(value as RpcStubInstance);
        return { hook, remainingPath:
            pathIfPromise ? pathIfPromise.concat(path.slice(i)) : path.slice(i) };
      }

      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
        // These have no properties that can be accessed remotely.
        value = undefined;
        break;

      case "undefined":
        // Intentionally produce TypeError.
        value = (value as any)[part];
        break;

      case "unsupported": {
        if (i === 0) {
          throw new TypeError(`RPC stub points at a non-serializable type.`);
        } else {
          let prefix = path.slice(0, i).join(".");
          let remainder = path.slice(0, i).join(".");
          throw new TypeError(
              `'${prefix}' is not a serializable type, so property ${remainder} cannot ` +
              `be accessed.`);
        }
      }

      default:
        kind satisfies never;
        throw new TypeError("unreachable");
    }
  }

  // If we reached a promise, we actually want the caller to forward to the promise, not return
  // the promise itself.
  if (value instanceof RpcPromise) {
    let {hook: hook, pathIfPromise} = unwrapStubAndPath(value as RpcStubInstance);
    return { hook, remainingPath: pathIfPromise || [] };
  }

  // We don't validate the final value itself because we don't know the intended use yet. If it's
  // for a call, any callable is valid. If it's for get(), then any serializable value is valid.
  return {
    value,
    parent,
    owner,
  };
}

// Shared base class for PayloadStubHook and TargetStubHook.
export abstract class ValueStubHook extends StubHook {
  protected abstract getValue(): {value: unknown, owner: RpcPayload | null};

  call(path: PropertyPath, args: RpcPayload): StubHook {
    try {
      let {value, owner} = this.getValue();
      let followResult = followPath(value, undefined, path, owner);

      if (followResult.hook) {
        return followResult.hook.call(followResult.remainingPath, args);
      }

      // It's a local function.
      if (typeof followResult.value != "function") {
        throw new TypeError(`'${path.join('.')}' is not a function.`);
      }
      let promise = args.deliverCall(followResult.value, followResult.parent);
      return new PromiseStubHook(promise.then(payload => {
        return new PayloadStubHook(payload);
      }));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    try {
      let followResult: FollowPathResult;
      try {
        let {value, owner} = this.getValue();
        followResult = followPath(value, undefined, path, owner);;
      } catch (err) {
        // Oops, we need to dispose the captures of which we took ownership.
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }

      if (followResult.hook) {
        return followResult.hook.map(followResult.remainingPath, captures, instructions);
      }

      return mapImpl.applyMap(
          followResult.value, followResult.parent, followResult.owner, captures, instructions);
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }

  get(path: PropertyPath): StubHook {
    try {
      let {value, owner} = this.getValue();

      if (path.length === 0 && owner === null) {
        // The only way this happens is if someone sends "pipeline" and references a
        // TargetStubHook, but they shouldn't do that, because TargetStubHook never backs a
        // promise, and a non-promise cannot be converted to a promise.
        //
        // Note on rpc-thenable: This check is still correct for rpc-thenables. An rpc-thenable
        // is an RpcTarget that also has a `then()` method, but it's still fundamentally backed
        // by a TargetStubHook. The thenable behavior only affects how it's treated when found
        // in a payload (wrapped as RpcPromise instead of RpcStub), not the underlying hook type.
        // If we reach this code path with an rpc-thenable, it means something tried to send a
        // pipeline message to an already-resolved thenable, which is still invalid.
        throw new Error("Can't dup an RpcTarget stub as a promise.");
      }

      let followResult = followPath(value, undefined, path, owner);

      if (followResult.hook) {
        return followResult.hook.get(followResult.remainingPath);
      }

      // Note that if `followResult.owner` is null, then we've descended into the contents of an
      // RpcTarget. In that case, if this deep copy discovers an RpcTarget embedded in the result,
      // it will create a new stub for it. If that RpcTarget has a disposer, it'll be disposed when
      // that stub is disposed. If the same RpcTarget is returned in *another* get(), it create
      // *another* stub, which calls the disposer *another* time. This can be quite weird -- the
      // disposer may be called any number of times, including zero if the property is never read
      // at all. Unfortunately, that's just the way it is. The application can avoid this problem by
      // wrapping the RpcTarget in an RpcStub itself, proactively, and using that as the property --
      // then, each time the property is get()ed, a dup() of that stub is returned.
      return new PayloadStubHook(RpcPayload.deepCopyFrom(
          followResult.value, followResult.parent, followResult.owner));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
}

// StubHook wrapping an RpcPayload in local memory.
//
// This is used for:
// - Resolution of a promise.
//   - Initially on the server side, where it can be pull()ed and used in pipelining.
//   - On the client side, after pull() has transmitted the payload.
// - Implementing RpcTargets, on the server side.
//   - Since the payload's root is an RpcTarget, pull()ing it will just duplicate the stub.
export class PayloadStubHook extends ValueStubHook {
  constructor(payload: RpcPayload) {
    super();
    this.payload = payload;
  }

  private payload?: RpcPayload;  // cleared when disposed

  private getPayload(): RpcPayload {
    if (this.payload) {
      return this.payload;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }

  protected getValue() {
    let payload = this.getPayload();
    return {value: payload.value, owner: payload};
  }

  dup(): StubHook {
    // Although dup() is documented as not copying the payload, what this really means is that
    // you aren't expected to be able to pull() from a dup()ed hook if it is remote. However,
    // PayloadStubHook already has the value locally, and there's nothing we can do except clone
    // it here.
    //
    // Note on pull() from clones: The clone is wrapped as RpcStub (not RpcPromise) in the public
    // API, which naturally prevents pull() from being called by application code. The type system
    // enforces this by only exposing pull() on RpcPromise. If internal code tries to pull() from
    // a dup'd hook, it will still work correctly (returning a deep copy of the payload), which
    // is actually the desired behavior for internal use cases like serialization.
    let thisPayload = this.getPayload();
    return new PayloadStubHook(RpcPayload.deepCopyFrom(
        thisPayload.value, undefined, thisPayload));
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    // Reminder: pull() intentionally returns the hook's own payload and not a clone. The caller
    // only needs to dispose one of the hook or the payload. It is the caller's responsibility
    // to not dispose the payload if they intend to keep the hook around.
    return this.getPayload();
  }

  ignoreUnhandledRejections(): void {
    if (this.payload) {
      this.payload.ignoreUnhandledRejections();
    }
  }

  dispose(): void {
    if (this.payload) {
      this.payload.dispose();
      this.payload = undefined;
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    ensureImports();

    if (this.payload) {
      const value = this.payload.value;
      if (value instanceof RpcStub) {
        // Payload is a single stub, we should forward onRpcBroken to it.
        //
        // Design note on PayloadStubHook wrapping a single stub: While we could theoretically
        // require using the underlying stub's hook directly, wrapping in PayloadStubHook provides
        // important benefits:
        // 1. Uniform handling - all returned values go through the same code path
        // 2. Proper disposal semantics - PayloadStubHook manages the stub's lifecycle
        // 3. Promise resolution support - the payload can be awaited and resolved
        // The onRpcBroken forwarding here ensures callbacks still work correctly.
        //
        // Cast to RpcStubInstance which has the onRpcBroken method defined
        const stub = value as RpcStubInstance;
        stub.onRpcBroken(callback);
      }

      // Note on native stubs (workerd-native RpcStubs): Native stubs implement their own
      // onRpcBroken mechanism through the Workers runtime. When a native stub is contained
      // in a payload, we treat it as an RpcTarget and wrap it in TargetStubHook, which
      // doesn't expose onRpcBroken. This is acceptable because:
      // 1. Native stubs manage their own connection lifecycle
      // 2. The wrapping stub will propagate errors when the native connection breaks
      // 3. Applications using native stubs can register callbacks directly on them
    }
  }
}

// StubHook derived from a Promise for some other StubHook. Waits for the promise and then
// forward calls, being careful to honor e-order.
export class PromiseStubHook extends StubHook {
  private promise: Promise<StubHook>;
  private resolution: StubHook | undefined;

  constructor(promise: Promise<StubHook>) {
    super();

    this.promise = promise.then(res => { this.resolution = res; return res; });
  }

  call(path: PropertyPath, args: RpcPayload): StubHook {
    // Note: We can't use `resolution` even if it's available because it could technically break
    //   e-order: A call() that arrives just after the resolution could be delivered faster than
    //   a call() that arrives just before. Keeping the promise around and always waiting on it
    //   avoids the problem.
    //
    // Design note on e-order optimization: We cannot safely bypass the promise chain even when
    // resolution is available, because JavaScript's microtask scheduling doesn't guarantee that
    // calls made "just before" resolution will be queued before calls made "just after". The
    // promise chain provides the necessary serialization. Potential optimizations (like tracking
    // call ordering explicitly) would add complexity without significant benefit, since the
    // overhead of the extra await is minimal compared to actual RPC latency.

    // Once call() returns (synchronously), we can no longer touch the original args. Since we
    // can't serialize them yet, we have to deep-copy them now.
    args.ensureDeepCopied();

    return new PromiseStubHook(this.promise.then(hook => hook.call(path, args)));
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    return new PromiseStubHook(this.promise.then(
        hook => hook.map(path, captures, instructions),
        err => {
          for (let cap of captures) {
            cap.dispose();
          }
          throw err;
        }));
  }

  get(path: PropertyPath): StubHook {
    // Note: e-order matters for get(), just like call(), in case the property has a getter.
    return new PromiseStubHook(this.promise.then(hook => hook.get(path)));
  }

  dup(): StubHook {
    if (this.resolution) {
      return this.resolution.dup();
    } else {
      return new PromiseStubHook(this.promise.then(hook => hook.dup()));
    }
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    // Luckily, resolutions are not subject to e-order, so it's safe to use `this.resolution`
    // here. In fact, it is required to maintain e-order elsewhere: If this promise is being used
    // as the input to some other local call (via promise pipelining), we need to make sure that
    // other call is not delayed at all when this promise is already resolved.
    if (this.resolution) {
      return this.resolution.pull();
    } else {
      return this.promise.then(hook => hook.pull());
    }
  }

  ignoreUnhandledRejections(): void {
    if (this.resolution) {
      this.resolution.ignoreUnhandledRejections();
    } else {
      this.promise.then(res => {
        res.ignoreUnhandledRejections();
      }, err => {
        // Ignore the error!
      });
    }
  }

  dispose(): void {
    if (this.resolution) {
      this.resolution.dispose();
    } else {
      this.promise.then(hook => {
        hook.dispose();
      }, err => {
        // nothing to dispose
      });
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    if (this.resolution) {
      this.resolution.onBroken(callback);
    } else {
      this.promise.then(hook => {
        hook.onBroken(callback);
      }, callback);
    }
  }
}

// Register PayloadStubHook with the registry
registry.PayloadStubHook = PayloadStubHook;
