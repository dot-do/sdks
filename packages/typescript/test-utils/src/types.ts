/**
 * Shared type definitions for test utilities
 */

/**
 * Generic document type for mock databases
 */
export type Document = Record<string, unknown>;

/**
 * RPC transport interface - abstracts the underlying RPC client
 */
export interface RpcTransport {
  call(method: string, ...args: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * RPC client interface for the $ proxy pattern
 */
export interface RpcClient {
  $: {
    [method: string]: (...args: unknown[]) => Promise<unknown>;
  };
  close(): Promise<void>;
}

/**
 * RPC client factory type
 */
export type RpcClientFactory = (url: string) => RpcClient;

/**
 * Call log entry for tracking mock transport calls
 */
export interface CallLogEntry {
  method: string;
  args: unknown[];
  timestamp: number;
}

/**
 * Mock response configuration
 */
export interface MockResponse {
  result?: unknown;
  error?: Error;
  delay?: number;
}

/**
 * Mock transport options
 */
export interface MockTransportOptions {
  /** Default delay for responses in milliseconds */
  defaultDelay?: number;
  /** Enable call logging */
  enableCallLog?: boolean;
  /** Custom method handlers */
  handlers?: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
}
