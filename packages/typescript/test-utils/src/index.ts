/**
 * @dotdo/test-utils - Shared test utilities for DotDo SDK packages
 *
 * This package provides mock implementations and test helpers that can be
 * reused across different SDK packages for consistent testing.
 *
 * @packageDocumentation
 */

// Types
export type {
  Document,
  RpcTransport,
  RpcClient,
  RpcClientFactory,
  CallLogEntry,
  MockResponse,
  MockTransportOptions,
} from './types.js';

// Base mock transport
export { MockRpcTransport } from './mock-rpc-transport.js';

// MongoDB-specific mock transport
export { MockMongoTransport } from './mock-mongo-transport.js';

// Mock RPC client (for $ proxy pattern)
export {
  createMockRpcClient,
  createMockRpcClientFactory,
  type MockRpcClientOptions,
  type MockRpcClientExtended,
  type MockRpcClientFactoryExtended,
} from './mock-rpc-client.js';
