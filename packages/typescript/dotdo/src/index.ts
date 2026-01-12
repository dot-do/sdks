/**
 * dotdo - DotDo Platform SDK
 * Managed connections to .do services with authentication, pooling, and retry logic
 */

import {
  connect,
  createConnection,
  type RpcProxy,
  type $,
  type RpcConnectionOptions,
  type Connection,
  type Recording,
  type MapOptions,
  type RecordedCall,
} from '@dotdo/rpc';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authentication options for DotDo services
 */
export interface AuthOptions {
  /** API key for authentication */
  apiKey?: string;
  /** OAuth access token */
  accessToken?: string;
  /** Custom authentication headers */
  headers?: Record<string, string>;
}

/**
 * Connection pool configuration
 */
export interface PoolOptions {
  /** Minimum number of connections to maintain */
  minConnections?: number;
  /** Maximum number of connections allowed */
  maxConnections?: number;
  /** Time in ms before an idle connection is closed */
  idleTimeout?: number;
  /** Time in ms to wait for an available connection */
  acquireTimeout?: number;
}

/**
 * Retry configuration
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Base delay in ms between retries */
  baseDelay?: number;
  /** Maximum delay in ms between retries */
  maxDelay?: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier?: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatuses?: number[];
  /** Error codes that should trigger a retry */
  retryableErrors?: string[];
}

/**
 * Full DotDo client configuration
 */
export interface DotDoOptions {
  /** API key for authentication */
  apiKey?: string;
  /** Full authentication options */
  auth?: AuthOptions;
  /** Connection pool settings */
  pool?: PoolOptions;
  /** Retry behavior settings */
  retry?: RetryOptions;
  /** Default timeout for requests in ms */
  timeout?: number;
  /** Base URL override (default: https://{service}.do) */
  baseUrl?: string;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================================
// Connection Pool
// ============================================================================

interface PooledConnection {
  connection: Connection;
  proxy: RpcProxy;
  lastUsed: number;
  inUse: boolean;
}

/**
 * Connection pool manager
 */
class ConnectionPool {
  private connections: Map<string, PooledConnection[]> = new Map();
  private readonly options: Required<PoolOptions>;

  constructor(options: PoolOptions = {}) {
    this.options = {
      minConnections: options.minConnections ?? 1,
      maxConnections: options.maxConnections ?? 10,
      idleTimeout: options.idleTimeout ?? 30000,
      acquireTimeout: options.acquireTimeout ?? 5000,
    };
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(
    url: string,
    connectionOptions: RpcConnectionOptions
  ): Promise<{ connection: Connection; proxy: RpcProxy }> {
    let pool = this.connections.get(url);
    if (!pool) {
      pool = [];
      this.connections.set(url, pool);
    }

    // Try to find an available connection
    for (const pooled of pool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        return { connection: pooled.connection, proxy: pooled.proxy };
      }
    }

    // Create a new connection if under limit
    if (pool.length < this.options.maxConnections) {
      const { connection, proxy } = createConnection(connectionOptions);
      const pooled: PooledConnection = {
        connection,
        proxy,
        lastUsed: Date.now(),
        inUse: true,
      };
      pool.push(pooled);
      return { connection, proxy };
    }

    // Wait for an available connection
    const startTime = Date.now();
    while (Date.now() - startTime < this.options.acquireTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      for (const pooled of pool) {
        if (!pooled.inUse) {
          pooled.inUse = true;
          pooled.lastUsed = Date.now();
          return { connection: pooled.connection, proxy: pooled.proxy };
        }
      }
    }

    throw new Error(`Connection pool timeout for ${url}`);
  }

  /**
   * Release a connection back to the pool
   */
  release(url: string, connection: Connection): void {
    const pool = this.connections.get(url);
    if (!pool) return;

    for (const pooled of pool) {
      if (pooled.connection === connection) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        return;
      }
    }
  }

  /**
   * Clean up idle connections
   */
  cleanup(): void {
    const now = Date.now();
    for (const [url, pool] of this.connections) {
      const active = pool.filter((p) => {
        if (p.inUse) return true;
        if (now - p.lastUsed > this.options.idleTimeout) {
          p.connection.close('idle timeout');
          return false;
        }
        return true;
      });
      if (active.length === 0) {
        this.connections.delete(url);
      } else {
        this.connections.set(url, active);
      }
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    for (const pool of this.connections.values()) {
      for (const pooled of pool) {
        await pooled.connection.close('pool shutdown');
      }
    }
    this.connections.clear();
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'CONNECTION_ERROR'],
};

/**
 * Calculate delay for retry attempt using exponential backoff with jitter
 */
function calculateRetryDelay(attempt: number, options: Required<RetryOptions>): number {
  const exponentialDelay = options.baseDelay * Math.pow(options.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelay);
  // Add jitter (0-25% of delay)
  const jitter = cappedDelay * Math.random() * 0.25;
  return cappedDelay + jitter;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, options: Required<RetryOptions>): boolean {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code && options.retryableErrors.includes(code)) {
      return true;
    }
  }
  return false;
}

/**
 * Execute a function with retry logic
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: Required<RetryOptions>,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < options.maxAttempts - 1 && isRetryableError(error, options)) {
        const delay = calculateRetryDelay(attempt, options);
        onRetry?.(attempt + 1, error);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

// ============================================================================
// DotDo Client
// ============================================================================

/**
 * DotDo Platform Client
 *
 * Provides managed connections to .do services with:
 * - Authentication (API key, OAuth, custom headers)
 * - Connection pooling
 * - Automatic retry with exponential backoff
 * - Request timeout handling
 *
 * @example
 * ```ts
 * // Create a client with API key
 * const dotdo = new DotDo({ apiKey: 'your-api-key' });
 *
 * // Connect to a service
 * const ai = await dotdo.connect<AIService>('ai');
 * const result = await ai.generate({ prompt: 'Hello!' });
 *
 * // Or use the full URL
 * const custom = await dotdo.connect('https://custom.example.do');
 * ```
 */
export class DotDo {
  private readonly options: DotDoOptions;
  private readonly pool: ConnectionPool;
  private readonly retryOptions: Required<RetryOptions>;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(options: DotDoOptions = {}) {
    this.options = options;
    this.pool = new ConnectionPool(options.pool);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.pool.cleanup(), 10000);
  }

  /**
   * Connect to a .do service
   *
   * @param service - Service name (e.g., 'ai') or full URL
   * @returns Typed RPC proxy for the service
   *
   * @example
   * ```ts
   * // Connect by service name
   * const ai = await dotdo.connect<AIService>('ai');
   *
   * // Connect by full URL
   * const api = await dotdo.connect('https://api.example.do');
   * ```
   */
  async connect<T = $>(service: string): Promise<RpcProxy<T>> {
    const url = this.resolveUrl(service);
    const connectionOptions = this.buildConnectionOptions(url);

    const { proxy } = await withRetry(
      () => this.pool.acquire(url, connectionOptions),
      this.retryOptions,
      this.options.debug ? (attempt, error) => {
        console.log(`[DotDo] Retry attempt ${attempt} for ${url}:`, error);
      } : undefined
    );

    return this.wrapWithRetry(proxy as RpcProxy<T>, url);
  }

  /**
   * Create a one-off connection without pooling
   *
   * @param service - Service name or full URL
   * @returns Connection and proxy
   */
  connectOnce<T = $>(service: string): RpcProxy<T> {
    const url = this.resolveUrl(service);
    const connectionOptions = this.buildConnectionOptions(url);
    return connect<T>(url, connectionOptions);
  }

  /**
   * Get authentication headers for the current configuration
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.options.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.auth?.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.auth.apiKey}`;
    }

    if (this.options.auth?.accessToken) {
      headers['Authorization'] = `Bearer ${this.options.auth.accessToken}`;
    }

    if (this.options.auth?.headers) {
      Object.assign(headers, this.options.auth.headers);
    }

    return headers;
  }

  /**
   * Close all connections and clean up resources
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    await this.pool.closeAll();
  }

  /**
   * Resolve a service name to a full URL
   */
  private resolveUrl(service: string): string {
    // If already a URL, use as-is
    if (service.includes('://')) {
      return service;
    }

    // If base URL is provided, use it
    if (this.options.baseUrl) {
      return `${this.options.baseUrl}/${service}`;
    }

    // Default to .do domain
    return `https://${service}.do`;
  }

  /**
   * Build connection options with auth
   */
  private buildConnectionOptions(url: string): RpcConnectionOptions {
    return {
      url,
      timeout: this.options.timeout,
      headers: this.getAuthHeaders(),
      apiKey: this.options.apiKey || this.options.auth?.apiKey,
    };
  }

  /**
   * Wrap a proxy with retry logic
   */
  private wrapWithRetry<T>(proxy: RpcProxy<T>, _url: string): RpcProxy<T> {
    // The proxy already handles individual call retries through the map() functionality
    // This is a hook point for adding connection-level retry logic
    return proxy;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultClient: DotDo | undefined;

/**
 * Get or create the default DotDo client
 *
 * @param options - Options for creating the client (only used on first call)
 */
export function getClient(options?: DotDoOptions): DotDo {
  if (!defaultClient) {
    defaultClient = new DotDo(options);
  }
  return defaultClient;
}

/**
 * Configure the default client
 *
 * @param options - Client options
 */
export function configure(options: DotDoOptions): DotDo {
  if (defaultClient) {
    defaultClient.close();
  }
  defaultClient = new DotDo(options);
  return defaultClient;
}

/**
 * Quick connect to a .do service using the default client
 *
 * @param service - Service name or URL
 * @param options - Override options for this connection
 *
 * @example
 * ```ts
 * import { to } from 'dotdo';
 *
 * const ai = await to<AIService>('ai');
 * const result = await ai.generate({ prompt: 'Hello!' });
 * ```
 */
export async function to<T = $>(
  service: string,
  options?: DotDoOptions
): Promise<RpcProxy<T>> {
  const client = options ? new DotDo(options) : getClient();
  return client.connect<T>(service);
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  connect,
  createConnection,
  type RpcProxy,
  type $,
  type RpcConnectionOptions,
  type Connection,
  type Recording,
  type MapOptions,
  type RecordedCall,
} from '@dotdo/rpc';

export type {
  TransportState,
  ConnectionOptions,
  ConnectionStats,
} from '@dotdo/capnweb';

export {
  CapnwebError,
  ConnectionError,
  RpcError,
  CapabilityError,
} from '@dotdo/rpc';

// ============================================================================
// Test Support
// ============================================================================

/**
 * Test server configuration for SDK conformance testing
 */
export interface TestServerConfig {
  /** Port to listen on (0 for ephemeral) */
  port?: number;
  /** API key requirement */
  apiKey?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom TestTarget implementation */
  target?: unknown;
}

/**
 * Test server instance returned by createTestServer
 */
export interface TestServerInstance {
  /** HTTP URL for batch RPC */
  url: string;
  /** WebSocket URL for streaming RPC */
  wsUrl: string;
  /** DotDo client connected to this server */
  client: DotDo;
  /** Shutdown the server */
  shutdown: () => Promise<void>;
  /** Server port */
  port: number;
}

/**
 * Create a test server for SDK conformance testing.
 *
 * This function is designed for use in test frameworks to spin up
 * a dotdo-backed test server for running conformance tests.
 *
 * @param config - Server configuration
 * @returns Test server instance
 *
 * @example
 * ```ts
 * import { createTestServer } from 'platform.do';
 *
 * // In test setup
 * const server = await createTestServer({ verbose: true });
 *
 * // Connect SDK to test server
 * const client = await server.client.connect('test');
 *
 * // Run tests...
 *
 * // In test teardown
 * await server.shutdown();
 * ```
 */
export async function createTestServer(config: TestServerConfig = {}): Promise<TestServerInstance> {
  // Dynamic import to avoid loading server dependencies in client-only environments
  const { setup } = await import('../../../test/server/dotdo-server.js');
  return setup(config);
}

/**
 * Test client options for connecting to a test server
 */
export interface TestClientOptions extends DotDoOptions {
  /** Test server URL */
  serverUrl: string;
}

/**
 * Create a DotDo client configured for testing.
 *
 * @param options - Test client options
 * @returns Configured DotDo client
 *
 * @example
 * ```ts
 * import { createTestClient } from 'platform.do';
 *
 * const client = createTestClient({
 *   serverUrl: 'http://localhost:8787',
 *   debug: true,
 * });
 *
 * const api = await client.connect('test');
 * ```
 */
export function createTestClient(options: TestClientOptions): DotDo {
  return new DotDo({
    ...options,
    baseUrl: options.serverUrl,
  });
}
