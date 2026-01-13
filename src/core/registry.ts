// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// This file provides a registry to break circular dependencies between core modules.
// Each module registers its exports here, and other modules access them through this registry.
// This allows proper ESM imports while avoiding the issues with require() in ESM modules.

import type { StubHook } from "./stub-hook.js";
import type { PropertyPath } from "./types.js";
import type { RpcPayload } from "./payload.js";
import type { RpcTarget } from "./target.js";

// =============================================================================
// Type-only interfaces for registry entries
// These interfaces describe the shape of classes/functions without causing
// circular dependencies, since they use `import type`.
// =============================================================================

/**
 * Interface for RpcStub instances (the proxied objects exposed to the application).
 * This represents the shape of an RpcStub after it's wrapped in a Proxy.
 */
export interface RpcStubInstance extends Disposable {
  hook: StubHook;
  pathIfPromise?: PropertyPath;
  dup(): RpcStubInstance;
  onRpcBroken(callback: (error: unknown) => void): void;
  map(func: (value: unknown) => unknown): unknown;
}

/**
 * Interface for RpcPromise instances (extends RpcStub with Promise-like methods).
 */
export interface RpcPromiseInstance extends RpcStubInstance {
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<unknown | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<unknown>;
}

/**
 * Constructor type for RpcStub class.
 */
export interface RpcStubConstructor {
  new (hook: StubHook, pathIfPromise?: PropertyPath): RpcStubInstance;
  prototype: RpcStubInstance;
}

/**
 * Constructor type for RpcPromise class.
 */
export interface RpcPromiseConstructor {
  new (hook: StubHook, pathIfPromise: PropertyPath): RpcPromiseInstance;
  prototype: RpcPromiseInstance;
}

/**
 * Constructor type for PayloadStubHook class.
 */
export interface PayloadStubHookConstructor {
  new (payload: RpcPayload): StubHook;
}

/**
 * Interface for TargetStubHook's static factory method.
 */
export interface TargetStubHookConstructor {
  create(value: RpcTarget | Function, parent: object | undefined): StubHook;
}

/**
 * Function type for unwrapping a stub and taking ownership.
 */
export type UnwrapStubTakingOwnershipFn = (stub: RpcStubInstance) => StubHook;

/**
 * Function type for unwrapping a stub and duplicating it.
 */
export type UnwrapStubAndDupFn = (stub: RpcStubInstance) => StubHook;

/**
 * Function type for unwrapping a stub without properties.
 */
export type UnwrapStubNoPropertiesFn = (stub: RpcStubInstance) => StubHook | undefined;

/**
 * Function type for unwrapping a stub or parent.
 */
export type UnwrapStubOrParentFn = (stub: RpcStubInstance) => StubHook;

/**
 * Function type for unwrapping a stub and getting the path.
 */
export type UnwrapStubAndPathFn = (stub: RpcStubInstance) => { hook: StubHook; pathIfPromise?: PropertyPath };

/**
 * The registry type with properly typed entries.
 */
export interface RegistryType {
  RpcStub: RpcStubConstructor | null;
  RpcPromise: RpcPromiseConstructor | null;
  PayloadStubHook: PayloadStubHookConstructor | null;
  TargetStubHook: TargetStubHookConstructor | null;
  unwrapStubTakingOwnership: UnwrapStubTakingOwnershipFn | null;
  unwrapStubAndDup: UnwrapStubAndDupFn | null;
  unwrapStubNoProperties: UnwrapStubNoPropertiesFn | null;
  unwrapStubOrParent: UnwrapStubOrParentFn | null;
  unwrapStubAndPath: UnwrapStubAndPathFn | null;
}

// Registry for classes that have circular dependencies
export const registry: RegistryType = {
  RpcStub: null,
  RpcPromise: null,
  PayloadStubHook: null,
  TargetStubHook: null,
  unwrapStubTakingOwnership: null,
  unwrapStubAndDup: null,
  unwrapStubNoProperties: null,
  unwrapStubOrParent: null,
  unwrapStubAndPath: null,
};

// Accessor functions that throw helpful errors if registry not populated
export function getRpcStub(): RpcStubConstructor {
  if (!registry.RpcStub) {
    throw new Error("RpcStub not registered. Import core/index.js first.");
  }
  return registry.RpcStub;
}

export function getRpcPromise(): RpcPromiseConstructor {
  if (!registry.RpcPromise) {
    throw new Error("RpcPromise not registered. Import core/index.js first.");
  }
  return registry.RpcPromise;
}

export function getPayloadStubHook(): PayloadStubHookConstructor {
  if (!registry.PayloadStubHook) {
    throw new Error("PayloadStubHook not registered. Import core/index.js first.");
  }
  return registry.PayloadStubHook;
}

export function getTargetStubHook(): TargetStubHookConstructor {
  if (!registry.TargetStubHook) {
    throw new Error("TargetStubHook not registered. Import core/index.js first.");
  }
  return registry.TargetStubHook;
}

export function getUnwrapStubTakingOwnership(): UnwrapStubTakingOwnershipFn {
  if (!registry.unwrapStubTakingOwnership) {
    throw new Error("unwrapStubTakingOwnership not registered. Import core/index.js first.");
  }
  return registry.unwrapStubTakingOwnership;
}

export function getUnwrapStubAndDup(): UnwrapStubAndDupFn {
  if (!registry.unwrapStubAndDup) {
    throw new Error("unwrapStubAndDup not registered. Import core/index.js first.");
  }
  return registry.unwrapStubAndDup;
}

export function getUnwrapStubNoProperties(): UnwrapStubNoPropertiesFn {
  if (!registry.unwrapStubNoProperties) {
    throw new Error("unwrapStubNoProperties not registered. Import core/index.js first.");
  }
  return registry.unwrapStubNoProperties;
}

export function getUnwrapStubOrParent(): UnwrapStubOrParentFn {
  if (!registry.unwrapStubOrParent) {
    throw new Error("unwrapStubOrParent not registered. Import core/index.js first.");
  }
  return registry.unwrapStubOrParent;
}

export function getUnwrapStubAndPath(): UnwrapStubAndPathFn {
  if (!registry.unwrapStubAndPath) {
    throw new Error("unwrapStubAndPath not registered. Import core/index.js first.");
  }
  return registry.unwrapStubAndPath;
}
