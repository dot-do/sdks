/**
 * MockRpcClient - A mock RPC client for testing the $ proxy pattern
 *
 * This provides a mock implementation that supports the $ proxy pattern
 * used in Kafka and other SDKs.
 */

import type { RpcClient, RpcClientFactory, CallLogEntry } from './types.js';

/**
 * Options for creating a mock RPC client
 */
export interface MockRpcClientOptions {
  /** Default response for unhandled methods */
  defaultResponse?: unknown;
  /** Custom method handlers */
  handlers?: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
  /** Enable call logging */
  enableCallLog?: boolean;
}

/**
 * Create a mock RPC client with the $ proxy pattern
 */
export function createMockRpcClient(options: MockRpcClientOptions = {}): RpcClient & {
  callLog: CallLogEntry[];
  clearCallLog: () => void;
  on: (method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => void;
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>();
  const callLog: CallLogEntry[] = [];
  const enableCallLog = options.enableCallLog ?? true;

  // Register initial handlers
  if (options.handlers) {
    for (const [method, handler] of Object.entries(options.handlers)) {
      handlers.set(method, handler);
    }
  }

  const $proxy = new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get: (_target, method: string) => {
      return async (...args: unknown[]): Promise<unknown> => {
        if (enableCallLog) {
          callLog.push({
            method,
            args,
            timestamp: Date.now(),
          });
        }

        const handler = handlers.get(method);
        if (handler) {
          return handler(...args);
        }

        return options.defaultResponse ?? {};
      };
    },
  });

  return {
    $: $proxy,
    close: async () => {},
    callLog,
    clearCallLog: () => {
      callLog.length = 0;
    },
    on: (method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => {
      handlers.set(method, handler);
    },
  };
}

/** Extended mock RPC client type */
export type MockRpcClientExtended = RpcClient & {
  callLog: CallLogEntry[];
  clearCallLog: () => void;
  on: (method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => void;
};

/** Extended factory type with tracking */
export interface MockRpcClientFactoryExtended {
  (url: string): MockRpcClientExtended;
  clients: Map<string, MockRpcClientExtended>;
  getClient: (url: string) => MockRpcClientExtended | undefined;
}

/**
 * Create a mock RPC client factory
 *
 * @example
 * ```typescript
 * const mockFactory = createMockRpcClientFactory({
 *   handlers: {
 *     'produce': async (topic, messages) => ({ offsets: [{ partition: 0, offset: '0' }] }),
 *   },
 * });
 *
 * setRpcClientFactory(mockFactory);
 * ```
 */
export function createMockRpcClientFactory(
  options: MockRpcClientOptions = {}
): MockRpcClientFactoryExtended {
  const clients = new Map<string, MockRpcClientExtended>();

  const factory: MockRpcClientFactoryExtended = Object.assign(
    (url: string): MockRpcClientExtended => {
      const client = createMockRpcClient(options);
      clients.set(url, client);
      return client;
    },
    {
      clients,
      getClient: (url: string) => clients.get(url),
    }
  );

  return factory;
}
