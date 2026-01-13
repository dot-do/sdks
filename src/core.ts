// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// This file re-exports everything from the core/ modules for backwards compatibility.
// The implementation has been split into separate files under src/core/:
//
// - core/utils.ts: Polyfills and RAW_STUB symbol
// - core/types.ts: TypeForRpc, PropertyPath, RpcCallOptions, LocatedPromise, typeForRpc, isRpcCallOptions
// - core/target.ts: RpcTarget class and disposeRpcTarget function
// - core/stub-hook.ts: StubHook abstract class, ErrorStubHook, DISPOSED_HOOK, withCallInterceptor
// - core/map-impl.ts: MapImpl type and mapImpl hook
// - core/payload.ts: RpcPayload class
// - core/stub.ts: RpcStub class and unwrap functions
// - core/promise.ts: RpcPromise class
// - core/payload-hook.ts: ValueStubHook, PayloadStubHook, PromiseStubHook
// - core/target-hook.ts: TargetStubHook

export {
  // utils.ts
  RAW_STUB,

  // types.ts
  typeForRpc,
  isRpcCallOptions,

  // target.ts
  RpcTarget,
  disposeRpcTarget,

  // stub-hook.ts
  StubHook,
  ErrorStubHook,
  DISPOSED_HOOK,
  withCallInterceptor,
  getCallHandler,

  // map-impl.ts
  mapImpl,

  // payload.ts
  RpcPayload,

  // stub.ts
  RpcStub,
  unwrapStubTakingOwnership,
  unwrapStubAndDup,
  unwrapStubNoProperties,
  unwrapStubOrParent,
  unwrapStubAndPath,

  // promise.ts
  RpcPromise,

  // payload-hook.ts
  ValueStubHook,
  PayloadStubHook,
  PromiseStubHook,

  // target-hook.ts
  TargetStubHook,

  // promise-delegating-hook.ts
  PromiseDelegatingStubHook,
} from "./core/index.js";

export type {
  // types.ts
  TypeForRpc,
  PropertyPath,
  RpcCallOptions,
  LocatedPromise,

  // map-impl.ts
  MapImpl,
} from "./core/index.js";
