// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook } from "./stub-hook.js";
import { typeForRpc, isRpcCallOptions } from "./types.js";
import type { PropertyPath, LocatedPromise, RpcCallOptions } from "./types.js";
import { RpcTarget, disposeRpcTarget } from "./target.js";
import { RAW_STUB } from "./utils.js";

// Use registry pattern to break circular dependencies
import {
  registry,
  getRpcStub,
  getRpcPromise,
  getTargetStubHook,
  getPayloadStubHook,
  getUnwrapStubTakingOwnership,
  getUnwrapStubAndDup,
  getUnwrapStubNoProperties,
  getUnwrapStubOrParent,
  type RpcStubConstructor,
  type RpcPromiseConstructor,
  type TargetStubHookConstructor,
  type PayloadStubHookConstructor,
  type UnwrapStubTakingOwnershipFn,
  type UnwrapStubAndDupFn,
  type UnwrapStubNoPropertiesFn,
  type UnwrapStubOrParentFn,
  type RpcStubInstance,
  type RpcPromiseInstance,
} from "./registry.js";

// Forward declarations - populated from registry by ensureImports()
let RpcStub: RpcStubConstructor;
let RpcPromise: RpcPromiseConstructor;
let unwrapStubTakingOwnership: UnwrapStubTakingOwnershipFn;
let unwrapStubAndDup: UnwrapStubAndDupFn;
let unwrapStubNoProperties: UnwrapStubNoPropertiesFn;
let unwrapStubOrParent: UnwrapStubOrParentFn;
let TargetStubHook: TargetStubHookConstructor;
let PayloadStubHook: PayloadStubHookConstructor;

// Initialize the lazy imports - uses registry which is populated when stub.ts and promise.ts load
function ensureImports() {
  if (!RpcStub) {
    // Get values from registry - these will throw helpful errors if not populated
    RpcStub = getRpcStub();
    RpcPromise = getRpcPromise();
    TargetStubHook = getTargetStubHook();
    PayloadStubHook = getPayloadStubHook();
    unwrapStubTakingOwnership = getUnwrapStubTakingOwnership();
    unwrapStubAndDup = getUnwrapStubAndDup();
    unwrapStubNoProperties = getUnwrapStubNoProperties();
    unwrapStubOrParent = getUnwrapStubOrParent();
  }
}

// Represents the params to an RPC call, or the resolution of an RPC promise, as it passes
// through the system.
//
// `RpcPayload` is a linear type -- it is passed to or returned from a call, ownership is being
// transferred. The payload in turn owns all the stubs within it. Disposing the payload disposes
// the stubs.
//
// Hypothetically, when an `RpcPayload` is first constructed from a message structure passed from
// the app, it ought to be deep-copied, for a few reasons:
// - To ensure subsequent modifications of the data structure by the app aren't reflected in the
//   already-sent message.
// - To find all stubs in the message tree, to take ownership of them.
// - To find all RpcTargets in the message tree, to wrap them in stubs.
//
// However, most payloads are immediately serialized to send across the wire. Said serialization
// *also* has to make a deep copy, and takes ownership of all stubs found within. In the case that
// the payload is immediately serialized, then making a deep copy first is wasteful.
//
// So, as an optimization, RpcPayload does not necessarily make a copy right away. Instead, it
// keeps track of whether it's still pointing at the message structure received directly from the
// app. In that case, the serializer can operate on the original structure directly, making it
// more efficient.
//
// On the receiving end, when an RpcPayload is deserialized from the wire, the payload can safely
// be delivered directly to the app without a copy. However, if the app makes a loopback call to
// itself, the payload may never cross the wire. In this case, a deep copy must be made before
// delivering the final message to the app. There are really two reasons for this copy:
// - We obviously don't want the caller and callee sharing in-memory mutable data structures, as
//   this would lead to vasty different behavior than what you'd see when doing RPC across a
//   network connection.
// - Before delivering the message to the application, all promises embedded in the message must
//   be resolved. This is what makes pipelining possible: the sender of a message can place
//   `RpcPromise`s in it that refer back to values in the recipient's process. These will be filled
//   in just before delivering the message to the recipient, so that there's no need to transmit
//   these values back and forth across the wire. It would be unreasonable to expect the
//   application itself to check the message for promises and resolve them all, so instead the
//   system automatically resolves all promises upfront, replacing them with their resolutions.
//   This modifies the payload in-place -- but this of course requires that the payload is
//   operating on a copy of the message, not the original provided from the sending app.
//
// For both the purposes of disposal and substituting promises with their resolutions, it is
// necessary at some point to make a list of all the stubs (including promise stubs) present in
// the message. Again, `RpcPayload` tries to minimize the number of times that the whole message
// needs to be walked, so it implements the following policy:
// * When constructing a payload from an app-provided message object, the message is not walked
//   upfront. We do not know yet what stubs it contains.
// * When deserializing a payload from the wire, we build a list of stubs as part of the
//   deserialization process.
// * If we need to deep-copy an app-provided message, we make a list of stubs then.
// * Hence, we have a list of stubs if and only if the message structure was NOT provided directly
//   by the application.
// * If an app-provided payload is serialized, the serializer finds the stubs. (It also typically
//   takes ownership of the stubs, effectively consuming the payload, so there's no need to build
//   a list of the stubs.)
// * If an app-provided payload is disposed, then we have to walk the message at that time to
//   dispose all stubs within. But, note that when a payload is serialized -- with the serializer
//   taking ownership of stubs -- then the payload will NOT be disposed explicitly, so this step
//   will not be needed.
export class RpcPayload {
  // Create a payload from a value passed as params to an RPC from the app.
  //
  // The payload does NOT take ownership of any stubs in `value`, and but promises not to modify
  // `value`. If the payload is delivered locally, `value` will be deep-copied first, so as not
  // to have the sender and recipient end up sharing the same mutable object. `value` will not be
  // touched again after the call returns synchronously (returns a promise) -- by that point,
  // the value has either been copied or serialized to the wire.
  //
  // If `value` is an array and the last element is an RpcCallOptions object (has only a `timeout`
  // property), it is extracted and stored separately as call options.
  public static fromAppParams(value: unknown): RpcPayload {
    let callOptions: RpcCallOptions | undefined;

    // Check if value is an array and the last element is RpcCallOptions
    if (Array.isArray(value) && value.length > 0) {
      const lastArg = value[value.length - 1];
      if (isRpcCallOptions(lastArg)) {
        // Extract the call options and remove from args
        callOptions = lastArg;
        value = value.slice(0, -1);
      }
    }

    const payload = new RpcPayload(value, "params");
    payload.callOptions = callOptions;
    return payload;
  }

  // Create a payload from a value return from an RPC implementation by the app.
  //
  // Unlike fromAppParams(), in this case the payload takes ownership of all stubs in `value`, and
  // may hold onto `value` for an arbitrarily long time (e.g. to serve pipelined requests). It
  // will still avoid modifying `value` and will make a deep copy if it is delivered locally.
  public static fromAppReturn(value: unknown): RpcPayload {
    return new RpcPayload(value, "return");
  }

  // Combine an array of payloads into a single payload whose value is an array. Ownership of all
  // stubs is transferred from the inputs to the outputs, hence if the output is disposed, the
  // inputs should not be. (In case of exception, nothing is disposed, though.)
  public static fromArray(array: RpcPayload[]): RpcPayload {
    ensureImports();

    let stubs: RpcStubInstance[] = [];
    let promises: LocatedPromise[] = [];

    let resultArray: unknown[] = [];

    for (let payload of array) {
      payload.ensureDeepCopied();
      for (let stub of payload.stubs!) {
        stubs.push(stub);
      }
      for (let promise of payload.promises!) {
        if (promise.parent === payload) {
          // This promise is the root of the source payload. We need to reparent it to its proper
          // location in the result array.
          promise = {
            parent: resultArray,
            property: resultArray.length,
            promise: promise.promise
          };
        }
        promises.push(promise);
      }
      resultArray.push(payload.value);
    }

    return new RpcPayload(resultArray, "owned", stubs, promises);
  }

  // Create a payload from a value parsed off the wire using Evaluator.evaluate().
  //
  // A payload is constructed with a null value and the given stubs and promises arrays. The value
  // is expected to be filled in by the evaluator, and the stubs and promises arrays are expected
  // to be extended with stubs found during parsing. (This weird usage model is necessary so that
  // if the root value turns out to be a promise, its `parent` in `promises` can be the payload
  // object itself.)
  //
  // When done, the payload takes ownership of the final value and all the stubs within. It may
  // modify the value in preparation for delivery, and may deliver the value directly to the app
  // without copying.
  public static forEvaluate(stubs: RpcStubInstance[], promises: LocatedPromise[]) {
    return new RpcPayload(null, "owned", stubs, promises);
  }

  // Deep-copy the given value, including dup()ing all stubs.
  //
  // If `value` is a function, it should be bound to `oldParent` as its `this`.
  //
  // If deep-copying from a branch of some other RpcPayload, it must be provided, to make sure
  // RpcTargets found within don't get duplicate stubs.
  public static deepCopyFrom(
      value: unknown, oldParent: object | undefined, owner: RpcPayload | null): RpcPayload {
    let result = new RpcPayload(null, "owned", [], []);
    result.value = result.deepCopy(value, oldParent, "value", result, /*dupStubs=*/true, owner);
    return result;
  }

  // Private constructor; use factory functions above to construct.
  private constructor(
    // The payload value.
    public value: unknown,

    // What is the provenance of `value`?
    // "params": It came from the app, in params to a call. We must dupe any stubs within.
    // "return": It came from the app, returned from a call. We take ownership of all stubs within.
    // "owned": This value belongs fully to us, either because it was deserialized from the wire
    //   or because we deep-copied a value from the app.
    private source: "params" | "return" | "owned",

    // `stubs` and `promises` are filled in only if `value` belongs to us (`source` is "owned") and
    // so can safely be delivered to the app. If `value` came from then app in the first place,
    // then it cannot be delivered back to the app nor modified by us without first deep-copying
    // it. `stubs` and `promises` will be computed as part of the deep-copy.

    // All non-promise stubs found in `value`. Provided so that they can easily be disposed.
    private stubs?: RpcStubInstance[],

    // All promises found in `value`. The locations of each promise are provided to allow
    // substitutions later.
    private promises?: LocatedPromise[]
  ) {}

  // Call options extracted from the params, if any. Only applicable for "params" source payloads.
  public callOptions?: RpcCallOptions;

  // For `source === "return"` payloads only, this tracks any StubHooks created around RpcTargets
  // found in the payload at the time that it is serialized (or deep-copied) for return, so that we
  // can make sure they are not disposed before the pipeline ends.
  //
  // This is initialized on first use.
  private rpcTargets?: Map<RpcTarget | Function, StubHook>;

  // Get the StubHook representing the given RpcTarget found inside this payload.
  public getHookForRpcTarget(target: RpcTarget | Function, parent: object | undefined,
                             dupStubs: boolean = true): StubHook {
    ensureImports();

    if (this.source === "params") {
      if (dupStubs) {
        // We aren't supposed to take ownership of stubs appearing in params -- we're supposed to
        // dupe them. But an RpcTarget isn't a stub. If we create a stub around it, the stub takes
        // ownership.
        //
        // Usually, people passing raw RpcTargets into functions actually want the call to take
        // ownership -- that is, they want to have the disposer called later.
        //
        // But, if the RpcTarget happens to implement a `dup()` method, we will go ahead and call
        // that method, and wrap whatever it returns instead. This method wouldn't actually be
        // available over RPC anyway (since calling `dup()` on the client-side stub just dupes the
        // stub), so if an `RpcTarget` implements this, it must intend for us to use it.
        //
        // This is particularly important for the case of workerd-native RpcStubs, that is, stubs
        // from the built-in RPC system, rather than the pure-JS implementation of Cap'n Web.
        // We treat those stubs as RpcTargets. But, we do need to dup() them, just like we would
        // our own stubs.

        const dupable = target as { dup?: () => RpcTarget | Function };
        if (typeof dupable.dup === "function") {
          target = dupable.dup();
        }
      }

      return TargetStubHook.create(target, parent);
    } else if (this.source === "return") {
      // If dupStubs is true, we want to both make sure the map contains the stub, and also return
      // a dup of that stub.
      //
      // If dupStubs is false, then we are being called as part of ensureDeepCopy(), i.e. replacing
      // ourselves with a deep copy. In this case we actually want the copy to end up owning all
      // the hooks, and the map to be left empty. So what we do in this case is:
      // * If the target is not in the map, we just create it, but don't populate the map.
      // * If the target *is* in the map, we *remove* the hook from the map, and return it.

      const existingHook = this.rpcTargets?.get(target);
      if (existingHook) {
        if (dupStubs) {
          return existingHook.dup();
        } else {
          this.rpcTargets?.delete(target);
          return existingHook;
        }
      } else {
        const newHook = TargetStubHook.create(target, parent);
        if (dupStubs) {
          if (!this.rpcTargets) {
            this.rpcTargets = new Map;
          }
          this.rpcTargets.set(target, newHook);
          return newHook.dup();
        } else {
          return newHook;
        }
      }
    } else {
      throw new Error("owned payload shouldn't contain raw RpcTargets");
    }
  }

  private deepCopy(
      value: unknown, oldParent: object | undefined, property: string | number, parent: object,
      dupStubs: boolean, owner: RpcPayload | null): unknown {
    ensureImports();

    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
        // This will throw later on when someone tries to do something with it.
        return value;

      case "primitive":
      case "bigint":
      case "date":
      case "bytes":
      case "error":
      case "undefined":
        // These types are treated as immutable for RPC purposes:
        // - Primitives, bigint, undefined: truly immutable
        // - Date, Uint8Array: while mutable, RPC serialization creates new instances
        // - Error: while errors can have own properties, RPC only preserves standard fields
        //   (message, name, stack). Own properties are not copied because:
        //   1. They're typically debugging artifacts, not semantic data
        //   2. Copying them could inadvertently expose sensitive context
        //   3. Applications needing structured error data should use data objects
        return value;

      case "array": {
        // We have to construct the new array first, then fill it in, so we can pass it as the
        // parent.
        let array = <Array<unknown>>value;
        let len = array.length;
        let result = new Array(len);
        for (let i = 0; i < len; i++) {
          result[i] = this.deepCopy(array[i], array, i, result, dupStubs, owner);
        }
        return result;
      }

      case "object": {
        // Plain object. Unfortunately there's no way to pre-allocate the right shape.
        let result: Record<string, unknown> = {};
        let object = <Record<string, unknown>>value;
        for (let i in object) {
          result[i] = this.deepCopy(object[i], object, i, result, dupStubs, owner);
        }
        return result;
      }

      case "stub":
      case "rpc-promise": {
        const stub = value as RpcStubInstance;
        let hook: StubHook;
        if (dupStubs) {
          hook = unwrapStubAndDup(stub);
        } else {
          hook = unwrapStubTakingOwnership(stub);
        }
        if (value instanceof RpcPromise) {
          const promise = new RpcPromise(hook, []) as RpcPromiseInstance;
          this.promises!.push({parent, property, promise: promise as unknown as import("./promise.js").RpcPromise});
          return promise;
        } else {
          const newStub = new RpcStub(hook);
          this.stubs!.push(newStub);
          return newStub;
        }
      }

      case "function":
      case "rpc-target": {
        const target = <RpcTarget | Function>value;
        let newStub: RpcStubInstance;
        if (owner) {
          newStub = new RpcStub(owner.getHookForRpcTarget(target, oldParent, dupStubs));
        } else {
          newStub = new RpcStub(TargetStubHook.create(target, oldParent));
        }
        this.stubs!.push(newStub);
        return newStub;
      }

      case "rpc-thenable": {
        const target = <RpcTarget>value;
        let promise: RpcPromiseInstance;
        if (owner) {
          promise = new RpcPromise(owner.getHookForRpcTarget(target, oldParent, dupStubs), []);
        } else {
          promise = new RpcPromise(TargetStubHook.create(target, oldParent), []);
        }
        this.promises!.push({parent, property, promise: promise as unknown as import("./promise.js").RpcPromise});
        return promise;
      }

      default:
        kind satisfies never;
        throw new Error("unreachable");
    }
  }

  // Ensures that if the value originally came from an unowned source, we have replaced it with a
  // deep copy.
  public ensureDeepCopied() {
    if (this.source !== "owned") {
      // If we came from call params, we need to dupe any stubs. Otherwise (we came from a return),
      // we take ownership of all stubs.
      let dupStubs = this.source === "params";

      this.stubs = [];
      this.promises = [];

      // Deep-copy the value.
      try {
        this.value = this.deepCopy(this.value, undefined, "value", this, dupStubs, this);
      } catch (err) {
        // Roll back the change.
        this.stubs = undefined;
        this.promises = undefined;
        throw err;
      }

      // We now own the value.
      this.source = "owned";

      // `rpcTargets` should have been left empty. We can throw it out.
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in deep-copy?");
      }
      this.rpcTargets = undefined;
    }
  }

  // Resolve all promises in this payload and then assign the final value into `parent[property]`.
  private deliverTo(parent: object, property: string | number, promises: Promise<void>[]): void {
    ensureImports();

    this.ensureDeepCopied();

    if (this.value instanceof RpcPromise) {
      RpcPayload.deliverRpcPromiseTo(this.value, parent, property, promises);
    } else {
      (parent as Record<string | number, unknown>)[property] = this.value;

      for (let record of this.promises!) {
        // Note that because we already did ensureDeepCopied(), replacing each promise with its
        // resolution does not interfere with disposal later on -- disposal will be based on the
        // `promises` list, so will still properly dispose each promise, which in turn disposes
        // the promise's eventual payload.
        RpcPayload.deliverRpcPromiseTo(record.promise, record.parent, record.property, promises);
      }
    }
  }

  private static deliverRpcPromiseTo(
      promise: RpcStubInstance, parent: object, property: string | number,
      promises: Promise<void>[]): void {
    ensureImports();

    // deepCopy() should have replaced any property stubs with normal promise stubs.
    let hook = unwrapStubNoProperties(promise);
    if (!hook) {
      throw new Error("property promises should have been resolved earlier");
    }

    let inner = hook.pull();
    if (inner instanceof RpcPayload) {
      // Immediately resolved to payload.
      inner.deliverTo(parent, property, promises);
    } else {
      // It's a promise.
      promises.push(inner.then(async (payload) => {
        let subPromises: Promise<void>[] = [];
        payload.deliverTo(parent, property, subPromises);
        if (subPromises.length > 0) {
          await Promise.all(subPromises);
        }
      }));
    }
  }

  // Call the given function with the payload as an argument. The call is made synchronously if
  // possible, in order to maintain e-order. However, if any RpcPromises exist in the payload,
  // they are awaited and substituted before calling the function. The result of the call is
  // wrapped into another payload.
  //
  // After the call completes, the payload is disposed, releasing any stubs/promises that were
  // passed as params. If the receiver wants to keep a stub, it must call dup() on it before
  // returning. The caller should not call dispose() separately.
  public async deliverCall(func: Function, thisArg: object | undefined): Promise<RpcPayload> {
    ensureImports();

    try {
      let promises: Promise<void>[] = [];
      this.deliverTo(this, "value", promises);

      // WARNING: It is critical that if the promises list is empty, we do not await anything, so
      //   that the function is called immediately and synchronously. Otherwise, we might violate
      //   e-order.
      if (promises.length > 0) {
        await Promise.all(promises);
      }

      // Call the function.
      let result = Function.prototype.apply.call(func, thisArg, this.value);

      if (result instanceof RpcPromise) {
        // Special case: If the function immediately returns RpcPromise, we don't want to await it,
        // since that will actually wait for the promise. Instead we want to construct a payload
        // around it directly.
        return RpcPayload.fromAppReturn(result);
      } else {
        // In all other cases, await the result (which may or may not be a promise, but `await`
        // will just pass through non-promises).
        return RpcPayload.fromAppReturn(await result);
      }
    } finally {
      // Dispose the payload. This releases any stubs/promises that were passed as params.
      // If the receiver wants to keep a stub, it must call dup() on it before returning.
      this.dispose();
    }
  }

  // Produce a promise for this payload for return to the application. Any RpcPromises in the
  // payload are awaited and substituted with their results first.
  //
  // The returned object will have a disposer which disposes the payload. The caller should not
  // separately dispose it.
  public async deliverResolve(): Promise<unknown> {
    try {
      let promises: Promise<void>[] = [];
      this.deliverTo(this, "value", promises);

      if (promises.length > 0) {
        await Promise.all(promises);
      }

      let result = this.value;

      // Add disposer to result.
      if (result instanceof Object) {
        if (!(Symbol.dispose in result)) {
          // We want the disposer to be non-enumerable as otherwise it gets in the way of things
          // like unit tests trying to deep-compare the result to an object.
          Object.defineProperty(result, Symbol.dispose, {
            // NOTE: Using `this.dispose.bind(this)` here causes Playwright's build of
            //   Chromium 140.0.7339.16 to fail when the object is assigned to a `using` variable,
            //   with the error:
            //       TypeError: Symbol(Symbol.dispose) is not a function
            //   I cannot reproduce this problem in Chrome 140.0.7339.127 nor in Node or workerd,
            //   so maybe it was a short-lived V8 bug or something. To be safe, though, we use
            //   `() => this.dispose()`, which seems to always work.
            value: () => this.dispose(),
            writable: true,
            enumerable: false,
            configurable: true,
          });
        }
      }

      return result;
    } catch (err) {
      // Automatically dispose since the application will never receive the disposable...
      this.dispose();
      throw err;
    }
  }

  public dispose() {
    ensureImports();

    if (this.source === "owned") {
      // Oh good, we can just run through them.
      this.stubs!.forEach((stub: RpcStubInstance) => stub[Symbol.dispose]());
      this.promises!.forEach((record: LocatedPromise) => (record.promise as Disposable)[Symbol.dispose]());
    } else if (this.source === "return") {
      // Value received directly from app as a return value. We take ownership of all stubs, so we
      // must recursively scan it for things to dispose.
      this.disposeImpl(this.value, undefined);
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in disposeImpl()?");
      }
    } else {
      // this.source is "params". We don't own the stubs within.
    }

    // Make dispose() idempotent.
    this.source = "owned";
    this.stubs = [];
    this.promises = [];
  }

  // Recursive dispose, called only when `source` is "return".
  private disposeImpl(value: unknown, parent: object | undefined) {
    ensureImports();

    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
      case "undefined":
        return;

      case "array": {
        let array = <Array<unknown>>value;
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.disposeImpl(array[i], array);
        }
        return;
      }

      case "object": {
        let object = <Record<string, unknown>>value;
        for (let i in object) {
          this.disposeImpl(object[i], object);
        }
        return;
      }

      case "stub":
      case "rpc-promise": {
        const stub = value as RpcStubInstance;
        const hook = unwrapStubNoProperties(stub);
        if (hook) {
          hook.dispose();
        }
        return;
      }

      case "function":
      case "rpc-target": {
        let target = <RpcTarget | Function>value;
        let hook = this.rpcTargets?.get(target);
        if (hook) {
          // We created a hook around this target earlier. Dispose it now.
          hook.dispose();
          this.rpcTargets!.delete(target);
        } else {
          // There never was a stub pointing at this target. This could be because:
          // * The call was used only for promise pipelining, so the result was never serialized,
          //   so it never got added to `rpcTargets`.
          // * The same RpcTarget appears in the results twice, and we already disposed the hook
          //   when we saw it earlier. Note that it's intentional that we should call the disposer
          //   twice if the same object appears twice.
          disposeRpcTarget(target);
        }
        return;
      }

      case "rpc-thenable":
        // Since thenables are promises, we don't own them, so we don't dispose them.
        return;

      default:
        kind satisfies never;
        return;
    }
  }

  // Ignore unhandled rejections in all promises in this payload -- that is, all promises that
  // *would* be awaited if this payload were to be delivered. See the similarly-named method of
  // StubHook for explanation.
  ignoreUnhandledRejections(): void {
    ensureImports();

    if (this.stubs) {
      // Propagate to all stubs and promises.
      this.stubs.forEach((stub: RpcStubInstance) => {
        unwrapStubOrParent(stub).ignoreUnhandledRejections();
      });
      this.promises!.forEach(
          (record: LocatedPromise) => unwrapStubOrParent(record.promise as unknown as RpcStubInstance).ignoreUnhandledRejections());
    } else {
      // Ugh we have to walk the tree. Use a Set to track visited objects and avoid infinite
      // recursion on circular references.
      this.ignoreUnhandledRejectionsImpl(this.value, new Set());
    }
  }

  private ignoreUnhandledRejectionsImpl(value: unknown, seen: Set<object>) {
    ensureImports();

    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
      case "undefined":
      case "function":
      case "rpc-target":
        return;

      case "array": {
        let array = <Array<unknown>>value;
        if (seen.has(array)) return;  // Circular reference, already visited
        seen.add(array);
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.ignoreUnhandledRejectionsImpl(array[i], seen);
        }
        return;
      }

      case "object": {
        let object = <Record<string, unknown>>value;
        if (seen.has(object)) return;  // Circular reference, already visited
        seen.add(object);
        for (let i in object) {
          this.ignoreUnhandledRejectionsImpl(object[i], seen);
        }
        return;
      }

      case "stub":
      case "rpc-promise":
        unwrapStubOrParent(value as RpcStubInstance).ignoreUnhandledRejections();
        return;

      case "rpc-thenable":
        (value as PromiseLike<unknown>).then(() => {}, () => {});
        return;

      default:
        kind satisfies never;
        return;
    }
  }
}
