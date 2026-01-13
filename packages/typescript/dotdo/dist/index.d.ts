import { RpcClient, ConnectOptions, CapnwebError } from 'rpc.do';
export { CapabilityError, CapnwebError, ConnectionError, ErrorCode, ErrorCodeName, ErrorCodeType, RpcClient, RpcError, SerializationError, TimeoutError, connect, createError, isErrorCode, wrapError } from 'rpc.do';
export { ConnectionOptions, ConnectionStats, TransportState } from '@dotdo/capnweb';

/**
 * dotdo - DotDo Platform SDK
 * Managed connections to .do services with authentication, pooling, and retry logic
 */

type RpcProxy<T = unknown> = RpcClient<T>;
type $ = unknown;
type RpcConnectionOptions = ConnectOptions & {
    url?: string;
    headers?: Record<string, string>;
    apiKey?: string;
    timeout?: number;
    signal?: AbortSignal;
};
interface Connection {
    close(reason?: string): Promise<void>;
}
interface Recording {
    calls: RecordedCall[];
}
interface MapOptions {
    captures?: Record<string, unknown>;
}
interface RecordedCall {
    method: string;
    args: unknown[];
    result?: unknown;
}

/**
 * Authentication options for DotDo services
 */
interface AuthOptions {
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
interface PoolOptions {
    /** Minimum number of connections to maintain */
    minConnections?: number;
    /** Maximum number of connections allowed */
    maxConnections?: number;
    /** Time in ms before an idle connection is closed */
    idleTimeout?: number;
    /** Time in ms to wait for an available connection (default: 30000) */
    acquireTimeout?: number;
}
/**
 * Options for acquiring a connection from the pool
 */
interface AcquireOptions {
    /** Timeout in milliseconds for acquiring a connection (default: 30000) */
    timeout?: number;
    /** Optional AbortSignal to cancel the acquire operation */
    signal?: AbortSignal;
}
/**
 * Retry configuration
 */
interface RetryOptions {
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
    /** Timeout in ms for the entire retry operation (default: no timeout) */
    timeout?: number;
    /** Optional AbortSignal to cancel retry operation */
    signal?: AbortSignal;
}
/**
 * Full DotDo client configuration
 */
interface DotDoOptions {
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
declare class DotDo {
    private readonly options;
    private readonly pool;
    private readonly retryOptions;
    private cleanupInterval?;
    constructor(options?: DotDoOptions);
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
    connect<T = $>(service: string): Promise<RpcProxy<T>>;
    /**
     * Create a one-off connection without pooling
     *
     * @param service - Service name or full URL
     * @returns Connection and proxy
     */
    connectOnce<T = $>(service: string): RpcProxy<T>;
    /**
     * Get authentication headers for the current configuration
     */
    getAuthHeaders(): Record<string, string>;
    /**
     * Close all connections and clean up resources
     */
    close(): Promise<void>;
    /**
     * Resolve a service name to a full URL
     */
    private resolveUrl;
    /**
     * Build connection options with auth
     */
    private buildConnectionOptions;
    /**
     * Wrap a proxy with retry logic
     */
    private wrapWithRetry;
}
/**
 * Get or create the default DotDo client
 *
 * @param options - Options for creating the client (only used on first call)
 */
declare function getClient(options?: DotDoOptions): DotDo;
/**
 * Configure the default client
 *
 * @param options - Client options
 */
declare function configure(options: DotDoOptions): DotDo;
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
declare function to<T = $>(service: string, options?: DotDoOptions): Promise<RpcProxy<T>>;

/**
 * Pool-specific error code (extends the base error code ranges)
 * Uses 6xxx range for pool-related errors
 */
declare const PoolErrorCode: {
    /** Pool acquisition timeout */
    readonly POOL_TIMEOUT_ERROR: 6001;
};
type PoolErrorCodeType = (typeof PoolErrorCode)[keyof typeof PoolErrorCode];
/**
 * Error thrown when acquiring a connection from the pool times out
 *
 * Error Code: 6001 (POOL_TIMEOUT_ERROR)
 */
declare class PoolTimeoutError extends CapnwebError {
    readonly url: string;
    readonly timeout: number;
    constructor(message: string, url: string, timeout: number);
}
/**
 * Test server configuration for SDK conformance testing
 */
interface TestServerConfig {
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
interface TestServerInstance {
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
declare function createTestServer(_config?: TestServerConfig): Promise<TestServerInstance>;
/**
 * Test client options for connecting to a test server
 */
interface TestClientOptions extends DotDoOptions {
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
declare function createTestClient(options: TestClientOptions): DotDo;

export { type $, type AcquireOptions, type AuthOptions, type Connection, DotDo, type DotDoOptions, type MapOptions, PoolErrorCode, type PoolErrorCodeType, type PoolOptions, PoolTimeoutError, type RecordedCall, type Recording, type RetryOptions, type RpcConnectionOptions, type RpcProxy, type TestClientOptions, type TestServerConfig, type TestServerInstance, configure, createTestClient, createTestServer, getClient, to };
