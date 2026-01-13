/**
 * @dotdo/capnweb - Cap'n Proto over WebTransport
 * Core protocol types and low-level primitives
 */
/**
 * Unique identifier for a capability
 */
type CapabilityId = number;
/**
 * Message ID for request/response correlation
 */
type MessageId = number;
/**
 * Segment of a Cap'n Proto message
 */
interface Segment {
    readonly data: ArrayBuffer;
    readonly byteLength: number;
}
/**
 * A Cap'n Proto message consisting of segments
 */
interface Message {
    readonly segments: readonly Segment[];
    readonly totalSize: number;
}
/**
 * Reference to a remote capability
 */
interface CapabilityRef {
    readonly id: CapabilityId;
    readonly interfaceId: bigint;
    readonly methodCount: number;
}
/**
 * Promise for a capability that may not yet be resolved
 */
interface CapabilityPromise {
    readonly id: CapabilityId;
    readonly resolved: boolean;
    resolve(ref: CapabilityRef): void;
    reject(error: Error): void;
}
declare const enum RpcMessageType {
    Call = 0,
    Return = 1,
    Finish = 2,
    Resolve = 3,
    Release = 4,
    Disembargo = 5,
    Bootstrap = 6,
    Abort = 7
}
/**
 * Method call request
 */
interface CallMessage {
    readonly type: RpcMessageType.Call;
    readonly questionId: MessageId;
    readonly target: CapabilityId;
    readonly interfaceId: bigint;
    readonly methodId: number;
    readonly params: Message;
}
/**
 * Method call response
 */
interface ReturnMessage {
    readonly type: RpcMessageType.Return;
    readonly answerId: MessageId;
    readonly result: Message | Error;
    readonly releaseParamCaps: boolean;
}
/**
 * Finish a question (release answer)
 */
interface FinishMessage {
    readonly type: RpcMessageType.Finish;
    readonly questionId: MessageId;
    readonly releaseResultCaps: boolean;
}
/**
 * Resolve a promise capability
 */
interface ResolveMessage {
    readonly type: RpcMessageType.Resolve;
    readonly promiseId: CapabilityId;
    readonly resolution: CapabilityRef | Error;
}
/**
 * Release a capability reference
 */
interface ReleaseMessage {
    readonly type: RpcMessageType.Release;
    readonly id: CapabilityId;
    readonly referenceCount: number;
}
/**
 * Bootstrap request for initial capability
 */
interface BootstrapMessage {
    readonly type: RpcMessageType.Bootstrap;
    readonly questionId: MessageId;
}
/**
 * Abort the connection
 */
interface AbortMessage {
    readonly type: RpcMessageType.Abort;
    readonly reason: string;
}
type RpcMessage = CallMessage | ReturnMessage | FinishMessage | ResolveMessage | ReleaseMessage | BootstrapMessage | AbortMessage;
/**
 * Transport state
 */
declare const enum TransportState {
    Connecting = "connecting",
    Connected = "connected",
    Disconnected = "disconnected",
    Failed = "failed"
}
/**
 * Transport events
 */
interface TransportEvents {
    message: (message: RpcMessage) => void;
    connected: () => void;
    disconnected: (reason?: string) => void;
    error: (error: Error) => void;
}
/**
 * Low-level transport interface for Cap'n Proto messages
 */
interface Transport {
    readonly state: TransportState;
    readonly url: string;
    send(message: RpcMessage): Promise<void>;
    close(reason?: string): Promise<void>;
    on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;
    off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;
}
/**
 * Options for establishing a connection
 */
interface ConnectionOptions {
    /** Target URL (webtransport:// or https://) */
    url: string;
    /** Connection timeout in milliseconds */
    timeout?: number;
    /** Enable automatic reconnection */
    autoReconnect?: boolean;
    /** Maximum reconnection attempts */
    maxReconnectAttempts?: number;
    /** Base delay for reconnection backoff (ms) */
    reconnectDelay?: number;
}
/**
 * Connection statistics
 */
interface ConnectionStats {
    readonly messagesIn: number;
    readonly messagesOut: number;
    readonly bytesIn: number;
    readonly bytesOut: number;
    readonly latencyMs: number;
    readonly uptime: number;
}
/**
 * A connection to a Cap'n Proto server
 */
interface Connection {
    readonly state: TransportState;
    readonly stats: ConnectionStats;
    bootstrap<T>(): Promise<T>;
    close(reason?: string): Promise<void>;
}
/**
 * Encode an RPC message to bytes
 */
declare function encodeMessage(_message: RpcMessage): ArrayBuffer;
/**
 * Decode bytes to an RPC message
 */
declare function decodeMessage(_data: ArrayBuffer): RpcMessage;
/**
 * Create a new message builder
 */
declare function createMessageBuilder(): MessageBuilder;
/**
 * Builder for constructing Cap'n Proto messages
 */
declare class MessageBuilder {
    private segments;
    addSegment(data: ArrayBuffer): this;
    build(): Message;
    clear(): this;
}
/**
 * Standard error codes used across all DotDo SDK implementations.
 * These codes are consistent across TypeScript, Python, Rust, and Go.
 *
 * Error Code Ranges:
 * - 1xxx: Connection errors
 * - 2xxx: RPC errors
 * - 3xxx: Timeout errors
 * - 4xxx: Capability errors
 * - 5xxx: Serialization errors
 */
declare const ErrorCode: {
    /** Connection-related errors (network, transport) */
    readonly CONNECTION_ERROR: 1001;
    /** RPC method call failures */
    readonly RPC_ERROR: 2001;
    /** Request timeout exceeded */
    readonly TIMEOUT_ERROR: 3001;
    /** Capability resolution or access errors */
    readonly CAPABILITY_ERROR: 4001;
    /** Serialization/deserialization errors */
    readonly SERIALIZATION_ERROR: 5001;
};
type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
/**
 * Maps error codes to their string names
 */
declare const ErrorCodeName: Record<ErrorCodeType, string>;
/**
 * Base error class for all capnweb/RPC errors.
 *
 * All error types in the DotDo ecosystem extend this class, allowing you to
 * catch all RPC-related errors with a single catch block.
 *
 * Error Hierarchy:
 * - CapnwebError (base)
 *   - ConnectionError: Connection failures, disconnections
 *   - RpcError: Method call failures, server errors
 *   - CapabilityError: Capability resolution failures
 *   - TimeoutError: Request timeout exceeded
 *   - SerializationError: Encoding/decoding failures
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('someMethod');
 * } catch (error) {
 *   if (error instanceof CapnwebError) {
 *     console.log(`RPC error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
declare class CapnwebError extends Error {
    readonly code: ErrorCodeType;
    readonly codeName: string;
    /**
     * Creates a new CapnwebError.
     * @param message - Human-readable error message
     * @param code - Numeric error code (e.g., 1001, 2001)
     * @param codeName - String name of the error code (e.g., 'CONNECTION_ERROR')
     */
    constructor(message: string, code: ErrorCodeType, codeName: string);
    /**
     * Returns a JSON representation of the error.
     */
    toJSON(): {
        name: string;
        message: string;
        code: number;
        codeName: string;
    };
}
/**
 * Error thrown when a connection cannot be established or is unexpectedly lost.
 *
 * Error Code: 1001 (CONNECTION_ERROR)
 *
 * Common causes:
 * - Network unreachable or server down
 * - TLS/certificate errors
 * - Connection timeout during handshake
 * - Server closed connection unexpectedly
 *
 * @example
 * ```typescript
 * try {
 *   await connect('wss://api.example.do');
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     console.log('Failed to connect:', error.message);
 *     // Retry logic here
 *   }
 * }
 * ```
 */
declare class ConnectionError extends CapnwebError {
    /**
     * Creates a new ConnectionError.
     * @param message - Description of the connection failure
     */
    constructor(message: string);
}
/**
 * Error thrown when an RPC method call fails.
 *
 * Error Code: 2001 (RPC_ERROR)
 *
 * Common causes:
 * - Method not found on the remote server
 * - Invalid arguments passed to the method
 * - Server-side exception during method execution
 * - Permission denied for the requested operation
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('processData', data);
 * } catch (error) {
 *   if (error instanceof RpcError) {
 *     console.log(`RPC call failed: ${error.message}`);
 *     if (error.methodId !== undefined) {
 *       console.log(`Method ID: ${error.methodId}`);
 *     }
 *   }
 * }
 * ```
 */
declare class RpcError extends CapnwebError {
    readonly methodId?: number | undefined;
    /**
     * Creates a new RpcError.
     * @param message - Description of the RPC failure
     * @param methodId - Optional method ID that failed (for debugging)
     */
    constructor(message: string, methodId?: number | undefined);
}
/**
 * Error thrown when an operation exceeds its timeout.
 *
 * Error Code: 3001 (TIMEOUT_ERROR)
 *
 * Common causes:
 * - Server is slow or overloaded
 * - Network latency issues
 * - Method taking longer than expected to complete
 * - Deadlock or infinite loop on the server
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('longRunningOperation', { timeout: 5000 });
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.log('Operation timed out:', error.message);
 *     // Consider retrying with a longer timeout
 *   }
 * }
 * ```
 */
declare class TimeoutError extends CapnwebError {
    readonly timeoutMs?: number | undefined;
    /**
     * Creates a new TimeoutError.
     * @param message - Description of what timed out (default: 'Request timed out')
     * @param timeoutMs - The timeout duration in milliseconds
     */
    constructor(message?: string, timeoutMs?: number | undefined);
}
/**
 * Error thrown when a capability cannot be resolved or is invalid.
 *
 * Error Code: 4001 (CAPABILITY_ERROR)
 *
 * Common causes:
 * - Capability reference expired or was garbage collected
 * - Capability was revoked by the server
 * - Invalid capability ID provided
 * - Capability not found in the import table
 *
 * @example
 * ```typescript
 * try {
 *   const counter = await client.call('getCounter');
 *   await counter.increment(1);
 * } catch (error) {
 *   if (error instanceof CapabilityError) {
 *     console.log(`Capability error: ${error.message}`);
 *     if (error.capabilityId !== undefined) {
 *       console.log(`Capability ID: ${error.capabilityId}`);
 *     }
 *   }
 * }
 * ```
 */
declare class CapabilityError extends CapnwebError {
    readonly capabilityId?: CapabilityId | undefined;
    /**
     * Creates a new CapabilityError.
     * @param message - Description of the capability error
     * @param capabilityId - Optional ID of the capability that caused the error
     */
    constructor(message: string, capabilityId?: CapabilityId | undefined);
}
/**
 * Error thrown when serialization or deserialization fails.
 *
 * Error Code: 5001 (SERIALIZATION_ERROR)
 *
 * Common causes:
 * - Invalid data format
 * - Schema mismatch between client and server
 * - Corrupted message data
 * - Unsupported data types
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('processData', complexObject);
 * } catch (error) {
 *   if (error instanceof SerializationError) {
 *     console.log('Serialization failed:', error.message);
 *   }
 * }
 * ```
 */
declare class SerializationError extends CapnwebError {
    readonly isDeserialize: boolean;
    /**
     * Creates a new SerializationError.
     * @param message - Description of the serialization failure
     * @param isDeserialize - Whether this was a deserialization (vs serialization) error
     */
    constructor(message: string, isDeserialize?: boolean);
}
/**
 * Checks if an error is a CapnwebError with a specific error code.
 *
 * @param error - The error to check
 * @param code - The error code to match
 * @returns true if the error matches the code
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('method');
 * } catch (error) {
 *   if (isErrorCode(error, ErrorCode.TIMEOUT_ERROR)) {
 *     // Handle timeout specifically
 *   }
 * }
 * ```
 */
declare function isErrorCode(error: unknown, code: ErrorCodeType): boolean;
/**
 * Creates an appropriate CapnwebError subclass from an error code and message.
 *
 * @param code - The error code
 * @param message - The error message
 * @returns An instance of the appropriate error class
 */
declare function createError(code: ErrorCodeType, message: string): CapnwebError;
/**
 * Wraps an unknown error into a CapnwebError.
 *
 * @param error - Any error or thrown value
 * @param defaultCode - The default error code if not a CapnwebError
 * @returns A CapnwebError instance
 */
declare function wrapError(error: unknown, defaultCode?: ErrorCodeType): CapnwebError;

export { type AbortMessage, type BootstrapMessage, type CallMessage, CapabilityError, type CapabilityId, type CapabilityPromise, type CapabilityRef, CapnwebError, type Connection, ConnectionError, type ConnectionOptions, type ConnectionStats, ErrorCode, ErrorCodeName, type ErrorCodeType, type FinishMessage, type Message, MessageBuilder, type MessageId, type ReleaseMessage, type ResolveMessage, type ReturnMessage, RpcError, type RpcMessage, RpcMessageType, type Segment, SerializationError, TimeoutError, type Transport, type TransportEvents, TransportState, createError, createMessageBuilder, decodeMessage, encodeMessage, isErrorCode, wrapError };
