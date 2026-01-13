// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Re-export utilities and polyfills
export { RAW_STUB } from "./utils.js";

// Re-export types
export type { TypeForRpc, PropertyPath, RpcCallOptions, LocatedPromise } from "./types.js";
export { typeForRpc, isRpcCallOptions } from "./types.js";

// Re-export RpcTarget and disposeRpcTarget
export { RpcTarget, disposeRpcTarget } from "./target.js";

// Re-export StubHook classes
export { StubHook, ErrorStubHook, DISPOSED_HOOK, withCallInterceptor, getCallHandler } from "./stub-hook.js";

// Re-export map implementation hook
export type { MapImpl } from "./map-impl.js";
export { mapImpl } from "./map-impl.js";

// Re-export RpcPayload
export { RpcPayload } from "./payload.js";

// Re-export RpcStub and unwrap functions
export {
  RpcStub,
  unwrapStubTakingOwnership,
  unwrapStubAndDup,
  unwrapStubNoProperties,
  unwrapStubOrParent,
  unwrapStubAndPath
} from "./stub.js";

// Re-export RpcPromise
export { RpcPromise } from "./promise.js";

// Re-export StubHook implementations
export { ValueStubHook, PayloadStubHook, PromiseStubHook } from "./payload-hook.js";
export { TargetStubHook } from "./target-hook.js";
