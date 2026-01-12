/**
 * rpc.do - Promise Pipelining RPC for .do services
 *
 * Zero-schema, type-safe RPC with promise pipelining that eliminates
 * N+1 round trips through server-side .map() operations.
 *
 * @example
 * ```typescript
 * import { connect } from 'rpc.do'
 *
 * // Connect to a .do service
 * const client = connect('wss://api.example.do')
 *
 * // Call methods directly via proxy
 * const result = await client.$.square(5)
 *
 * // Use capabilities
 * const counter = await client.$.makeCounter(10)
 * const value = await counter.increment(5)
 *
 * // Server-side map (single round trip!)
 * const numbers = await client.$.generateFibonacci(10)
 * const squared = await client.serverMap(numbers, 'x => self.square(x)', { self: client.getSelf() })
 * ```
 *
 * @packageDocumentation
 */

// Core client
export { RpcClient, isCapabilityRef, createRpcPromise } from './client.js';
export type { ConnectOptions, CapabilityRef, PipelineStep } from './client.js';

// Promise with pipelining
export { RpcPromise, PipelineBuilder } from './promise.js';
export type { PipelineOp } from './promise.js';

// Proxy access
export {
  createProxy,
  createCapabilityProxy,
  isCapabilityProxy,
  getCapabilityRef,
  getClient,
  typed,
  CAPABILITY_REF,
  CLIENT_REF,
  PATH_REF,
} from './proxy.js';
export type { CapabilityProxy } from './proxy.js';

// Map operations
export {
  RpcRecorder,
  RpcReplayer,
  serverMap,
  createServerMap,
  serializeFunction,
  deserializeFunction,
} from './map.js';
export type {
  RecordedCall,
  Recording,
  MapSpec,
  MapResult,
  MapOptions,
} from './map.js';

// Import for the connect function
import { RpcClient, ConnectOptions } from './client.js';
import type { MockServer } from '../tests/test-server.js';

/**
 * Connect to an RPC service
 *
 * @param serverOrUrl - Either a WebSocket URL or a MockServer for testing
 * @param options - Connection options
 * @returns An RpcClient instance
 *
 * @example
 * ```typescript
 * // Connect to a real service
 * const client = connect('wss://api.example.do')
 *
 * // Connect with authentication
 * const client = connect('wss://api.example.do', {
 *   token: 'your-api-key'
 * })
 *
 * // Connect to mock server (testing)
 * const server = new MockServer()
 * const client = connect(server)
 * ```
 */
export function connect<T = unknown>(
  serverOrUrl: MockServer | string,
  options?: ConnectOptions
): RpcClient<T> {
  return new RpcClient<T>(serverOrUrl, options);
}

/**
 * Type helper for defining service interfaces
 *
 * @example
 * ```typescript
 * interface MyService {
 *   square(x: number): Promise<number>
 *   makeCounter(initial: number): Promise<Counter>
 * }
 *
 * interface Counter {
 *   value(): Promise<number>
 *   increment(by: number): Promise<number>
 * }
 *
 * const client = connect<MyService>('wss://my.service.do')
 * const result = await client.$.square(5)  // TypeScript knows this returns Promise<number>
 * ```
 */
export type ServiceInterface<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K] extends object
    ? ServiceInterface<T[K]>
    : T[K];
};

// ============================================================================
// Error Types - Re-exported from @dotdo/capnweb (single source of truth)
// ============================================================================

/**
 * Error types are re-exported from @dotdo/capnweb to ensure a single source
 * of truth and consistent instanceof checks across all packages.
 *
 * Error Hierarchy:
 * - CapnwebError (base) - defined in @dotdo/capnweb
 *   - ConnectionError - Connection failures
 *   - RpcError - Method call failures
 *   - CapabilityError - Capability resolution failures
 *   - TimeoutError - Request timeout
 *
 * @see {@link CapnwebError} for catching all RPC-related errors
 */
export {
  CapnwebError,
  ConnectionError,
  RpcError,
  CapabilityError,
  TimeoutError,
} from '@dotdo/capnweb';
