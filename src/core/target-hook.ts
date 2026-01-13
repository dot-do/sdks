// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook } from "./stub-hook.js";
import { RpcPayload } from "./payload.js";
import { RpcTarget, disposeRpcTarget } from "./target.js";
import { ValueStubHook } from "./payload-hook.js";
import { registry } from "./registry.js";

// Many TargetStubHooks could point at the same RpcTarget. We store a refcount in a separate
// object that they all share.
//
// We can't store the refcount on the RpcTarget itself because if the application chooses to pass
// the same RpcTarget into the RPC system multiple times, we need to call this disposer multiple
// times for consistency.
type BoxedRefcount = { count: number };

// StubHook which wraps an RpcTarget. This has similarities to PayloadStubHook (especially when
// the root of the payload happens to be an RpcTarget), but there can only be one RpcPayload
// pointing at an RpcTarget whereas there can be several TargetStubHooks pointing at it. Also,
// TargetStubHook cannot be pull()ed, because it always backs an RpcStub, not an RpcPromise.
export class TargetStubHook extends ValueStubHook {
  // Constructs a TargetStubHook that is not duplicated from an existing hook.
  //
  // If `value` is a function, `parent` is bound as its "this".
  static create(value: RpcTarget | Function, parent: object | undefined) {
    if (typeof value !== "function") {
      // If the target isn't callable, we don't need to pass a `this` to it, so drop `parent`.
      // NOTE: `typeof value === "function"` checks if the value is callable. This technically
      //   works even for `RpcTarget` implementations that are callable, not just plain functions.
      parent = undefined;
    }
    return new TargetStubHook(value, parent);
  }

  private constructor(target: RpcTarget | Function,
                      parent?: object | undefined,
                      dupFrom?: TargetStubHook) {
    super();
    this.target = target;
    this.parent = parent;
    if (dupFrom) {
      if (dupFrom.refcount) {
        this.refcount = dupFrom.refcount;
        ++this.refcount.count;
      }
    } else if (Symbol.dispose in target) {
      // Disposer present, so we need to refcount.
      this.refcount = {count: 1};
    }
  }

  private target?: RpcTarget | Function;  // cleared when disposed
  private parent?: object | undefined;  // `this` parameter when calling `target`
  private refcount?: BoxedRefcount;  // undefined if not needed (because target has no disposer)

  private getTarget(): RpcTarget | Function {
    if (this.target) {
      return this.target;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }

  protected getValue() {
    return {value: this.getTarget(), owner: null};
  }

  dup(): StubHook {
    return new TargetStubHook(this.getTarget(), this.parent, this);
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    let target = this.getTarget();
    if ("then" in target) {
      // If the target is itself thenable, we allow it to be treated as a promise. This is used
      // in particular to support wrapping a workerd-native RpcPromise or RpcProperty.
      return Promise.resolve(target).then(resolution => {
        return RpcPayload.fromAppReturn(resolution);
      });
    } else {
      // This shouldn't be called since RpcTarget always becomes RpcStub, not RpcPromise, and you
      // can only pull a promise.
      return Promise.reject(new Error("Tried to resolve a non-promise stub."));
    }
  }

  ignoreUnhandledRejections(): void {
    // Nothing to do.
  }

  dispose(): void {
    if (this.target) {
      if (this.refcount) {
        if (--this.refcount.count == 0) {
          disposeRpcTarget(this.target);
        }
      }

      this.target = undefined;
    }
  }

  onBroken(callback: (error: unknown) => void): void {
    // Note: RpcTargets are local objects and don't have a remote connection that can "break".
    // The onBroken callback is a no-op here. If an application needs to be notified of target
    // disposal, they should use Symbol.dispose on the RpcTarget itself.
  }
}

// Register TargetStubHook with the registry
registry.TargetStubHook = TargetStubHook;
