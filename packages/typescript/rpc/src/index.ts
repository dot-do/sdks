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
export { RpcClient, ConnectOptions, CapabilityRef, isCapabilityRef, PipelineStep, createRpcPromise } from './client.js';

// Promise with pipelining
export { RpcPromise, PipelineBuilder, PipelineOp } from './promise.js';

// Proxy access
export {
  CapabilityProxy,
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

// Map operations
export {
  RecordedCall,
  Recording,
  MapSpec,
  MapResult,
  MapOptions,
  RpcRecorder,
  RpcReplayer,
  serverMap,
  createServerMap,
  serializeFunction,
  deserializeFunction,
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

/**
 * Error types
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export class ConnectionError extends RpcError {
  constructor(message: string, data?: unknown) {
    super(message, 'CONNECTION_ERROR', data);
    this.name = 'ConnectionError';
  }
}

export class CapabilityError extends RpcError {
  constructor(message: string, public readonly capabilityId?: number) {
    super(message, 'CAPABILITY_ERROR', { capabilityId });
    this.name = 'CapabilityError';
  }
}

export class TimeoutError extends RpcError {
  constructor(message: string = 'Request timed out') {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}
