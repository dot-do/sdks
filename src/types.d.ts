// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// This file borrows heavily from `types/defines/rpc.d.ts` in workerd.

// =============================================================================
// Branded types for identifying `WorkerEntrypoint`/`DurableObject`/`Target`s.
// =============================================================================
// TypeScript uses *structural* typing meaning anything with the same shape as type `T` is a `T`.
// For the classes exported by `cloudflare:workers` we want *nominal* typing (i.e. we only want to
// accept `WorkerEntrypoint` from `cloudflare:workers`, not any other class with the same shape)
export const __RPC_STUB_BRAND: '__RPC_STUB_BRAND';
export const __RPC_TARGET_BRAND: '__RPC_TARGET_BRAND';
export interface RpcTargetBranded {
  [__RPC_TARGET_BRAND]: never;
}

// Types that can be used through `Stub`s
export type Stubable = RpcTargetBranded | ((...args: any[]) => any);

// Types that can be passed over RPC
// The reason for using a generic type here is to build a serializable subset of structured
//   cloneable composite types. This allows types defined with the "interface" keyword to pass the
//   serializable check as well. Otherwise, only types defined with the "type" keyword would pass.
export type RpcCompatible<T> =
  // Structured cloneables
  | BaseType
  // Structured cloneable composites
  | Map<
      T extends Map<infer U, unknown> ? RpcCompatible<U> : never,
      T extends Map<unknown, infer U> ? RpcCompatible<U> : never
    >
  | Set<T extends Set<infer U> ? RpcCompatible<U> : never>
  | Array<T extends Array<infer U> ? RpcCompatible<U> : never>
  | ReadonlyArray<T extends ReadonlyArray<infer U> ? RpcCompatible<U> : never>
  | {
      [K in keyof T]: K extends number | string ? RpcCompatible<T[K]> : never;
    }
  | Promise<T extends Promise<infer U> ? RpcCompatible<U> : never>
  // Special types
  | Stub<Stubable>
  // Serialized as stubs, see `Stubify`
  | Stubable;

// Base type for all RPC stubs, including common memory management methods.
// `T` is used as a marker type for unwrapping `Stub`s later.
// Note: Relaxed constraint to prevent circular reference errors.
interface StubBase<T> extends Disposable {
  [__RPC_STUB_BRAND]: T;
  dup(): this;
  onRpcBroken(callback: (error: unknown) => void): void;
}

// Stub type with Provider for method pipelining
// Simplified to avoid deep recursion - uses PipelineProxy directly for object types
// instead of Provider<T> which could cause infinite expansion.
export type Stub<T extends RpcCompatible<T>> =
    T extends object ? PipelineProxy & StubBase<T> : StubBase<T>;

type TypedArray =
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigUint64Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

// This represents all the types that can be sent as-is over an RPC boundary
type BaseType =
  | void
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | TypedArray
  | ArrayBuffer
  | DataView
  | Date
  | Error
  | RegExp
  | ReadableStream<Uint8Array>
  | WritableStream<Uint8Array>
  | Request
  | Response
  | Headers;

// Recursively rewrite all `Stubable` types with `Stub`s, and resolve promises.
// SIMPLIFIED: To prevent deep recursion, we limit the recursion depth by not
// recursively Stubifying object properties. The type transformation happens at
// runtime; here we just mark Stubable types as Stubs.
// prettier-ignore
export type Stubify<T> =
  T extends Stubable ? Stub<T>
  : T extends Promise<infer U> ? Stubify<U>
  : T extends StubBase<any> ? T
  : T extends BaseType ? T
  // For complex types (arrays, objects), just return T directly
  // The runtime Stubify will handle the transformation
  : T;

// Recursively rewrite all `Stub<T>`s with the corresponding `T`s.
// SIMPLIFIED: To prevent deep recursion, we limit the depth by not recursively
// processing object properties. Just extract the inner type from StubBase.
// prettier-ignore
type UnstubifyInner<T> =
  T extends StubBase<infer V> ? (T | V)  // can provide either stub or local RpcTarget
  : T extends BaseType ? T
  : T;

// You can put promises anywhere in the params and they'll be resolved before delivery.
// (This also covers RpcPromise, because it's defined as being a Promise.)
type Unstubify<T> = UnstubifyInner<T> | Promise<UnstubifyInner<T>>

type UnstubifyAll<A extends any[]> = { [I in keyof A]: Unstubify<A[I]> };

// Utility type for adding `Disposable`s to `object` types only.
// Note `unknown & T` is equivalent to `T`.
type MaybeDisposable<T> = T extends object ? Disposable : unknown;

// =============================================================================
// Result type - represents the return value of RPC calls
// =============================================================================
// Using a maximally simplified approach to prevent TS2589 "Type instantiation is
// excessively deep" errors. We avoid ALL conditional type checks on R to prevent
// TypeScript from deeply evaluating complex types like DurableObjectStub.
//
// The awaited result is typed as R directly. For Stubable types, the actual runtime
// result will be a stub, but we don't try to express that at the type level here
// to avoid triggering deep type expansion.
//
// Pipelining is provided via PipelineProxy which uses index signatures.
// We use ResultStubBase instead of StubBase<R> to avoid passing R to a generic
// which could trigger type evaluation.
// prettier-ignore
type Result<R> = Promise<R> & PipelineProxy & ResultStubBase & Disposable;

// Simplified StubBase for Result type - doesn't take a type parameter
// to avoid triggering deep type evaluation
interface ResultStubBase {
  [__RPC_STUB_BRAND]: unknown;
  dup(): ResultStubBase & Disposable;
  onRpcBroken(callback: (error: unknown) => void): void;
}

// =============================================================================
// MethodOrProperty type - wraps methods and properties for RPC
// =============================================================================
// For methods: unwrap Stubs in parameters, wrap return in Result
// For properties: wrap value in Result
//
// IMPORTANT: We check if V is already a Result/Promise-like to prevent re-wrapping
// and avoid infinite type recursion.
type MethodOrProperty<V> =
  // If V is already Result-like (has StubBase brand), don't re-wrap
  V extends StubBase<any> ? V
  // Regular method: wrap return in Result
  : V extends (...args: infer P) => infer R
    ? (...args: UnstubifyAll<P>) => Result<Awaited<R>>
  // Regular property: wrap in Result
  : Result<Awaited<V>>;

// Type for the callable part of a Provider if T is callable.
type MaybeCallableProvider<T> = T extends (...args: any[]) => any
  ? MethodOrProperty<T>
  : unknown;

// =============================================================================
// Provider type - provides RPC pipelining interface
// =============================================================================
// To prevent TS2589 "excessively deep" errors with complex nested types like
// NativeRpcStub<RpcStub<Counter>>, we use a fully index-signature based approach.
//
// This sacrifices some type precision (property names are not explicitly checked)
// in exchange for guaranteed type system termination. The runtime proxy will
// correctly handle any property/method access regardless of the static type.
//
// The Provider type extends PipelineProxy which provides:
// - Index signature allowing any property access
// - Each property is callable (for methods) and returns PipelineProxy (for chaining)
// - Proper Promise integration for await
//
// IMPORTANT: We explicitly type known methods from T using Pick & MethodOrProperty
// to maintain type inference for common cases, but fall back to PipelineProxy
// for any unmatched properties.
// prettier-ignore
export type Provider<T> = MaybeCallableProvider<T> & PipelineProxy & {
  map<V>(callback: (value: any) => V): Result<Array<V>>;
};

// =============================================================================
// PipelineProxy type - simplified type for pipelined RPC calls
// =============================================================================
// This provides a simplified interface for pipelined calls. Instead of fully
// typing all nested properties (which can cause infinite recursion with complex
// types like DurableObjectStub), we use an index signature that allows any
// property/method access.
//
// At runtime, the proxy correctly handles all method/property accesses.
// The simplification is that pipelined calls return `any` instead of precise types.
//
// We extend Disposable explicitly to ensure the Symbol.dispose is properly typed.
interface PipelineProxy extends Disposable {
  [key: string]: ((...args: any[]) => Promise<any> & PipelineProxy & Disposable) & Promise<any> & PipelineProxy & Disposable;
}
