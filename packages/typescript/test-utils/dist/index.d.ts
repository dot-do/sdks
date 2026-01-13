/**
 * Shared type definitions for test utilities
 */
/**
 * Generic document type for mock databases
 */
type Document = Record<string, unknown>;
/**
 * RPC transport interface - abstracts the underlying RPC client
 */
interface RpcTransport {
    call(method: string, ...args: unknown[]): Promise<unknown>;
    close(): Promise<void>;
}
/**
 * RPC client interface for the $ proxy pattern
 */
interface RpcClient {
    $: {
        [method: string]: (...args: unknown[]) => Promise<unknown>;
    };
    close(): Promise<void>;
}
/**
 * RPC client factory type
 */
type RpcClientFactory = (url: string) => RpcClient;
/**
 * Call log entry for tracking mock transport calls
 */
interface CallLogEntry {
    method: string;
    args: unknown[];
    timestamp: number;
}
/**
 * Mock response configuration
 */
interface MockResponse {
    result?: unknown;
    error?: Error;
    delay?: number;
}
/**
 * Mock transport options
 */
interface MockTransportOptions {
    /** Default delay for responses in milliseconds */
    defaultDelay?: number;
    /** Enable call logging */
    enableCallLog?: boolean;
    /** Custom method handlers */
    handlers?: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
}

/**
 * MockRpcTransport - A reusable mock RPC transport for testing
 *
 * This class provides a flexible mock implementation of the RpcTransport interface
 * that can be used across different SDK tests. It supports:
 * - Call logging for verification
 * - Custom method handlers
 * - Response delays for async testing
 * - Error simulation
 */

/**
 * Base mock RPC transport for testing
 *
 * @example
 * ```typescript
 * const transport = new MockRpcTransport();
 *
 * // Register a custom handler
 * transport.on('myMethod', (arg1, arg2) => ({ result: arg1 + arg2 }));
 *
 * // Make a call
 * const result = await transport.call('myMethod', 1, 2);
 *
 * // Verify calls
 * expect(transport.callLog).toHaveLength(1);
 * expect(transport.callLog[0].method).toBe('myMethod');
 * ```
 */
declare class MockRpcTransport implements RpcTransport {
    private _closed;
    private _callLog;
    private _handlers;
    private _mockResponses;
    private _options;
    constructor(options?: MockTransportOptions);
    /**
     * Register default handlers for common methods
     */
    private _registerDefaultHandlers;
    /**
     * Get the call log
     */
    get callLog(): readonly CallLogEntry[];
    /**
     * Check if the transport is closed
     */
    get isClosed(): boolean;
    /**
     * Clear the call log
     */
    clearCallLog(): void;
    /**
     * Register a method handler
     */
    on(method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): this;
    /**
     * Remove a method handler
     */
    off(method: string): this;
    /**
     * Queue a mock response for a method
     * Responses are consumed in FIFO order
     */
    mockResponse(method: string, response: MockResponse): this;
    /**
     * Queue an error response for a method
     */
    mockError(method: string, error: Error, delay?: number): this;
    /**
     * Make an RPC call
     */
    call(method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Close the transport
     */
    close(): Promise<void>;
    /**
     * Reset the transport to initial state
     */
    reset(): void;
    /**
     * Helper to create a delay
     */
    private _delay;
    /**
     * Get calls for a specific method
     */
    getCallsForMethod(method: string): CallLogEntry[];
    /**
     * Check if a method was called
     */
    wasMethodCalled(method: string): boolean;
    /**
     * Get the last call for a method
     */
    getLastCall(method: string): CallLogEntry | undefined;
}

/**
 * MockMongoTransport - A MongoDB-specific mock transport with in-memory storage
 *
 * This provides a full in-memory MongoDB implementation for testing MongoDB SDK code
 * without needing a real database connection.
 */

/**
 * MongoDB-specific mock transport with in-memory storage
 */
declare class MockMongoTransport extends MockRpcTransport {
    private _data;
    private _nextId;
    constructor();
    /**
     * Register MongoDB-specific method handlers
     */
    private _registerMongoHandlers;
    /**
     * Get all data (for debugging)
     */
    getData(): Map<string, Map<string, Document[]>>;
    /**
     * Clear all data
     */
    clearData(): void;
    /**
     * Seed data for testing
     */
    seedData(dbName: string, collName: string, documents: Document[]): void;
    private _getOrCreateDb;
    private _getOrCreateCollection;
    private _getCollection;
    private _matchesFilter;
    private _getFieldValue;
    private _setFieldValue;
    private _compareValues;
    private _sortDocs;
    private _applyProjection;
    private _applyUpdate;
    private _groupDocs;
    private _evaluateExpression;
}

/**
 * MockRpcClient - A mock RPC client for testing the $ proxy pattern
 *
 * This provides a mock implementation that supports the $ proxy pattern
 * used in Kafka and other SDKs.
 */

/**
 * Options for creating a mock RPC client
 */
interface MockRpcClientOptions {
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
declare function createMockRpcClient(options?: MockRpcClientOptions): RpcClient & {
    callLog: CallLogEntry[];
    clearCallLog: () => void;
    on: (method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => void;
};
/** Extended mock RPC client type */
type MockRpcClientExtended = RpcClient & {
    callLog: CallLogEntry[];
    clearCallLog: () => void;
    on: (method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>) => void;
};
/** Extended factory type with tracking */
interface MockRpcClientFactoryExtended {
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
declare function createMockRpcClientFactory(options?: MockRpcClientOptions): MockRpcClientFactoryExtended;

export { type CallLogEntry, type Document, MockMongoTransport, type MockResponse, type MockRpcClientExtended, type MockRpcClientFactoryExtended, type MockRpcClientOptions, MockRpcTransport, type MockTransportOptions, type RpcClient, type RpcClientFactory, type RpcTransport, createMockRpcClient, createMockRpcClientFactory };
