export { CapabilityError, CapnwebError, ConnectionError, ErrorCode, ErrorCodeName, ErrorCodeType, RpcError, SerializationError, TimeoutError, createError, isErrorCode, wrapError } from '@dotdo/capnweb';

/**
 * RPC Protocol Types
 *
 * These types define the wire protocol for RPC communication.
 * They are used by both the client and any server implementation.
 */
/**
 * Pipeline operation for sequential execution
 */
interface PipelineOp$1 {
    type: 'call' | 'get';
    method?: string;
    args?: unknown[];
    property?: string;
}
/**
 * RPC request message
 */
interface RpcRequest {
    id: number;
    method: string;
    target?: number;
    args: unknown[];
    pipeline?: PipelineOp$1[];
}
/**
 * RPC response message
 */
interface RpcResponse {
    id: number;
    result?: unknown;
    error?: {
        type: string;
        message: string;
    };
    capabilityId?: number;
}
/**
 * RPC map request for server-side transformations
 */
interface RpcMapRequest {
    id: number;
    target: number;
    expression: string;
    captures: Record<string, number>;
}
/**
 * Extended request for pipelined calls
 */
interface PipelinedRequest {
    id: number;
    steps: Array<{
        method: string;
        target?: number | string;
        args: unknown[];
        as?: string;
    }>;
}
/**
 * Interface for mock server implementations used in testing.
 *
 * This interface defines the minimal contract that a mock server
 * must implement to work with RpcClient in test mode.
 */
interface MockServerInterface {
    /** Process a batch of requests (single round trip) */
    processBatch(requests: RpcRequest[]): RpcResponse[];
    /** Process a pipelined request (single round trip for entire pipeline) */
    processPipeline(request: PipelinedRequest): Record<string, RpcResponse>;
    /** Process a map request */
    processMapRequest(request: RpcMapRequest): RpcResponse;
    /** Register a capability and return its ID */
    registerCapability(cap: unknown): number;
    /** Get a capability by ID */
    getCapability(id: number): unknown;
    /** Process a call and map in a single round trip */
    processCallAndMap(request: RpcRequest, expression: string, captures: Record<string, number>): RpcResponse;
}

/**
 * RpcPromise - A Promise with pipelining support
 *
 * Enables chaining method calls without waiting for previous results,
 * allowing multiple operations to be batched into a single round trip.
 */

/**
 * Operation type for pipeline
 */
interface PipelineOp {
    type: 'call' | 'get';
    method?: string;
    property?: string;
    args?: unknown[];
}
/**
 * A promise that supports pipelining operations
 */
declare class RpcPromise<T> extends Promise<T> {
    private _client;
    private _ops;
    private _capabilityId?;
    constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void, client: RpcClient<unknown>, ops?: PipelineOp[], capabilityId?: number);
    /**
     * Get a property from the result
     */
    get<K extends keyof T>(key: K): RpcPromise<T[K]>;
    /**
     * Call a method on the result
     */
    call(method: string, ...args: unknown[]): RpcPromise<unknown>;
    /**
     * Server-side map operation
     * Maps a function over an array on the server, avoiding N round trips
     */
    map<U>(fn: (item: T extends (infer I)[] ? I : T) => U): RpcPromise<U[]>;
    /**
     * Get the pipeline operations
     */
    getPipelineOps(): PipelineOp[];
    /**
     * Get the capability ID if this promise represents a capability
     */
    getCapabilityId(): number | undefined;
    /**
     * Create an RpcPromise from a regular promise
     */
    static from<T>(promise: Promise<T>, client: RpcClient<unknown>, ops?: PipelineOp[], capId?: number): RpcPromise<T>;
}
/**
 * Pipeline builder for batching multiple operations
 */
declare class PipelineBuilder {
    private _client;
    private _steps;
    private _lastAs?;
    constructor(client: RpcClient<unknown>);
    /**
     * Add a method call to the pipeline
     */
    call(method: string, ...args: unknown[]): this;
    /**
     * Call a method on a previously named result
     */
    callOn(targetName: string, method: string, ...args: unknown[]): this;
    /**
     * Name the result of the previous step
     */
    as(name: string): this;
    /**
     * Execute the pipeline
     */
    execute(): Promise<Record<string, unknown> & {
        __last: unknown;
    }>;
}

/**
 * RpcClient - The main RPC client with WebSocket transport
 *
 * Supports both real WebSocket connections and mock servers for testing.
 */

/**
 * Connection options
 */
interface ConnectOptions {
    /** Authentication token */
    token?: string;
    /** Custom headers */
    headers?: Record<string, string>;
    /** Connection timeout in ms */
    timeout?: number;
    /** Enable auto-reconnect */
    autoReconnect?: boolean;
}
/**
 * Capability reference
 */
interface CapabilityRef {
    __capabilityId: number;
}
/**
 * Check if a value is a capability reference
 */
declare function isCapabilityRef(value: unknown): value is CapabilityRef;
/**
 * Pipeline step for batched execution
 */
interface PipelineStep {
    target?: string;
    method: string;
    args: unknown[];
    as?: string;
}
/**
 * RpcClient class
 */
declare class RpcClient<T> {
    private _nextRequestId;
    private _server;
    private _ws;
    private _url;
    private _pending;
    private _capabilities;
    private _exportedCallbacks;
    private _proxy;
    constructor(serverOrUrl: MockServerInterface | string, _options?: ConnectOptions);
    /**
     * Proxy for direct method access
     * Usage: client.$.methodName(args)
     */
    get $(): T;
    /**
     * Get self reference (capability ID 0)
     */
    getSelf(): CapabilityRef;
    /**
     * Export a callback function for server to call
     */
    exportCallback(name: string, fn: (x: number) => number): void;
    /**
     * Get an exported callback
     */
    getExportedCallback(name: string): ((x: number) => number) | undefined;
    /**
     * Make an RPC call
     */
    call(method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Call a method on a capability
     */
    callOnCapability(capability: unknown, method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Start building a pipeline
     */
    pipeline(): PipelineBuilder;
    /**
     * Execute a pipeline using the server's native pipeline support
     */
    executePipeline(steps: PipelineStep[]): Promise<Record<string, unknown> & {
        __last: unknown;
    }>;
    /**
     * Server-side map operation - executes in a single round trip
     */
    serverMap(value: unknown, expression: string, captures: Record<string, unknown>): Promise<unknown>;
    /**
     * Execute a method call and map operation in a single round trip
     */
    callAndMap(method: string, args: unknown[], mapExpression: string, captures: Record<string, unknown>): Promise<unknown>;
    /**
     * Close the connection
     */
    close(): Promise<void>;
    /**
     * Send a request and wait for response
     */
    private sendRequest;
    /**
     * Handle incoming WebSocket message
     */
    private handleMessage;
    /**
     * Serialize arguments, converting capability refs
     */
    private serializeArgs;
    /**
     * Resolve step arguments, converting named refs to capability IDs
     */
    private resolveStepArgs;
}
/**
 * Create an RpcPromise for a call
 */
declare function createRpcPromise<T>(client: RpcClient<unknown>, method: string, args: unknown[]): RpcPromise<T>;

/**
 * Proxy-based stub for zero-schema RPC access
 *
 * Enables natural method call syntax without predefined types:
 *   client.$.users.get({ id: 123 })
 */

/**
 * Proxy for a remote capability
 */
interface CapabilityProxy {
    [key: string]: CapabilityProxy | ((...args: unknown[]) => Promise<unknown>);
}
/**
 * Symbol for accessing the underlying capability ref
 */
declare const CAPABILITY_REF: unique symbol;
/**
 * Symbol for accessing the client
 */
declare const CLIENT_REF: unique symbol;
/**
 * Symbol for accessing the path
 */
declare const PATH_REF: unique symbol;
/**
 * Create a proxy for RPC method access
 *
 * @param client - The RPC client
 * @param path - Current path of property accesses
 * @param capabilityId - Optional capability ID for capability proxies
 */
declare function createProxy<T>(client: RpcClient<unknown>, path?: string[], capabilityId?: number): T;
/**
 * Create a proxy specifically for a capability
 */
declare function createCapabilityProxy(client: RpcClient<unknown>, capabilityId: number): CapabilityProxy & CapabilityRef;
/**
 * Check if a value is a capability proxy
 */
declare function isCapabilityProxy(value: unknown): value is CapabilityProxy;
/**
 * Get the capability reference from a proxy
 */
declare function getCapabilityRef(proxy: CapabilityProxy): CapabilityRef | undefined;
/**
 * Get the client from a proxy
 */
declare function getClient(proxy: CapabilityProxy): RpcClient<unknown> | undefined;
/**
 * Typed proxy creator for better IDE support
 */
declare function typed<T>(): <U extends RpcClient<T>>(client: U) => U;

/**
 * Server-side .map() with record/replay support
 *
 * The key feature that eliminates N+1 round trips by executing
 * map operations on the server.
 */

/**
 * Recorded RPC call for replay
 */
interface RecordedCall {
    readonly timestamp: number;
    readonly target: number;
    readonly method: string;
    readonly args: unknown[];
    readonly result?: unknown;
    readonly error?: string;
    readonly duration: number;
}
/**
 * Recording session containing multiple calls
 */
interface Recording {
    readonly id: string;
    readonly startTime: number;
    readonly endTime?: number;
    readonly calls: readonly RecordedCall[];
}
/**
 * Map operation specification sent to server
 */
interface MapSpec {
    /** JavaScript expression to execute for each item */
    expression: string;
    /** Captured variables (capability IDs) */
    captures: Record<string, number>;
}
/**
 * Result of server map operation
 */
interface MapResult<T> {
    /** The transformed array */
    results: T[];
    /** Number of round trips used */
    roundTrips: number;
    /** Any errors that occurred */
    errors?: Array<{
        index: number;
        error: string;
    }>;
}
/**
 * Options for the map operation
 */
interface MapOptions {
    /** Enable recording of the map operation */
    record?: boolean;
    /** Execute from recorded data instead of making real calls */
    replay?: Recording;
    /** Transform function applied to results */
    transform?: <T>(result: T, index: number) => T;
    /** Error handling mode */
    onError?: 'throw' | 'skip' | 'null';
}
/**
 * Recorder class for capturing RPC calls
 */
declare class RpcRecorder {
    private _recording;
    private _calls;
    private _startTime;
    /**
     * Start recording
     */
    start(): void;
    /**
     * Stop recording and return the recording
     */
    stop(): Recording;
    /**
     * Check if currently recording
     */
    get isRecording(): boolean;
    /**
     * Record a call
     */
    recordCall(call: Omit<RecordedCall, 'timestamp'>): void;
}
/**
 * Replayer class for executing from recorded data
 */
declare class RpcReplayer {
    private _recording;
    private _index;
    constructor(recording: Recording);
    /**
     * Get the next recorded call result
     */
    next(): RecordedCall | undefined;
    /**
     * Reset to the beginning
     */
    reset(): void;
    /**
     * Check if there are more calls
     */
    hasMore(): boolean;
}
/**
 * Execute a server-side map operation
 *
 * This is the core function that eliminates N+1 round trips by
 * sending the map expression to the server for execution.
 *
 * @param client - The RPC client
 * @param array - The array to map over (or promise of array)
 * @param fn - The mapping function
 * @param options - Map options
 */
declare function serverMap<T, U>(client: RpcClient<unknown>, array: T[] | Promise<T[]>, fn: (item: T) => U, options?: MapOptions): Promise<U[]>;
/**
 * Create a server map operation from a capability
 */
declare function createServerMap<T extends unknown[], U>(client: RpcClient<unknown>, capabilityId: number): {
    map<V>(fn: (item: T[number]) => V): Promise<V[]>;
};
/**
 * Serialize a function for transmission to server
 *
 * This extracts the function body and any captured variables.
 */
declare function serializeFunction(fn: Function): {
    expression: string;
    captures: string[];
};
/**
 * Deserialize a function from server
 */
declare function deserializeFunction(spec: {
    expression: string;
    captures: Record<string, unknown>;
}): Function;

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
declare function connect<T = unknown>(serverOrUrl: MockServerInterface | string, options?: ConnectOptions): RpcClient<T>;
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
type ServiceInterface<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<R> : T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K] extends object ? ServiceInterface<T[K]> : T[K];
};

export { CAPABILITY_REF, CLIENT_REF, type CapabilityProxy, type CapabilityRef, type ConnectOptions, type MapOptions, type MapResult, type MapSpec, type MockServerInterface, PATH_REF, PipelineBuilder, type PipelineOp, type PipelineStep, type PipelinedRequest, type PipelineOp$1 as ProtocolPipelineOp, type RecordedCall, type Recording, RpcClient, type RpcMapRequest, RpcPromise, RpcRecorder, RpcReplayer, type RpcRequest, type RpcResponse, type ServiceInterface, connect, createCapabilityProxy, createProxy, createRpcPromise, createServerMap, deserializeFunction, getCapabilityRef, getClient, isCapabilityProxy, isCapabilityRef, serializeFunction, serverMap, typed };
