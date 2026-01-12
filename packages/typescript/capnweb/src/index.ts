/**
 * @dotdo/capnweb - Cap'n Proto over WebTransport
 * Core protocol types and low-level primitives
 */

// ============================================================================
// Message Types
// ============================================================================

/**
 * Unique identifier for a capability
 */
export type CapabilityId = number;

/**
 * Message ID for request/response correlation
 */
export type MessageId = number;

/**
 * Segment of a Cap'n Proto message
 */
export interface Segment {
  readonly data: ArrayBuffer;
  readonly byteLength: number;
}

/**
 * A Cap'n Proto message consisting of segments
 */
export interface Message {
  readonly segments: readonly Segment[];
  readonly totalSize: number;
}

// ============================================================================
// Capability Types
// ============================================================================

/**
 * Reference to a remote capability
 */
export interface CapabilityRef {
  readonly id: CapabilityId;
  readonly interfaceId: bigint;
  readonly methodCount: number;
}

/**
 * Promise for a capability that may not yet be resolved
 */
export interface CapabilityPromise {
  readonly id: CapabilityId;
  readonly resolved: boolean;
  resolve(ref: CapabilityRef): void;
  reject(error: Error): void;
}

// ============================================================================
// RPC Message Types
// ============================================================================

export const enum RpcMessageType {
  Call = 0,
  Return = 1,
  Finish = 2,
  Resolve = 3,
  Release = 4,
  Disembargo = 5,
  Bootstrap = 6,
  Abort = 7,
}

/**
 * Method call request
 */
export interface CallMessage {
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
export interface ReturnMessage {
  readonly type: RpcMessageType.Return;
  readonly answerId: MessageId;
  readonly result: Message | Error;
  readonly releaseParamCaps: boolean;
}

/**
 * Finish a question (release answer)
 */
export interface FinishMessage {
  readonly type: RpcMessageType.Finish;
  readonly questionId: MessageId;
  readonly releaseResultCaps: boolean;
}

/**
 * Resolve a promise capability
 */
export interface ResolveMessage {
  readonly type: RpcMessageType.Resolve;
  readonly promiseId: CapabilityId;
  readonly resolution: CapabilityRef | Error;
}

/**
 * Release a capability reference
 */
export interface ReleaseMessage {
  readonly type: RpcMessageType.Release;
  readonly id: CapabilityId;
  readonly referenceCount: number;
}

/**
 * Bootstrap request for initial capability
 */
export interface BootstrapMessage {
  readonly type: RpcMessageType.Bootstrap;
  readonly questionId: MessageId;
}

/**
 * Abort the connection
 */
export interface AbortMessage {
  readonly type: RpcMessageType.Abort;
  readonly reason: string;
}

export type RpcMessage =
  | CallMessage
  | ReturnMessage
  | FinishMessage
  | ResolveMessage
  | ReleaseMessage
  | BootstrapMessage
  | AbortMessage;

// ============================================================================
// Transport Types
// ============================================================================

/**
 * Transport state
 */
export const enum TransportState {
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
  Failed = 'failed',
}

/**
 * Transport events
 */
export interface TransportEvents {
  message: (message: RpcMessage) => void;
  connected: () => void;
  disconnected: (reason?: string) => void;
  error: (error: Error) => void;
}

/**
 * Low-level transport interface for Cap'n Proto messages
 */
export interface Transport {
  readonly state: TransportState;
  readonly url: string;

  send(message: RpcMessage): Promise<void>;
  close(reason?: string): Promise<void>;

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;
  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void;
}

// ============================================================================
// Connection Types
// ============================================================================

/**
 * Options for establishing a connection
 */
export interface ConnectionOptions {
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
export interface ConnectionStats {
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
export interface Connection {
  readonly state: TransportState;
  readonly stats: ConnectionStats;

  bootstrap<T>(): Promise<T>;
  close(reason?: string): Promise<void>;
}

// ============================================================================
// Serialization Utilities
// ============================================================================

/**
 * Encode an RPC message to bytes
 */
export function encodeMessage(_message: RpcMessage): ArrayBuffer {
  // Stub implementation - actual implementation would use Cap'n Proto encoding
  throw new Error('Not implemented: encodeMessage');
}

/**
 * Decode bytes to an RPC message
 */
export function decodeMessage(_data: ArrayBuffer): RpcMessage {
  // Stub implementation - actual implementation would use Cap'n Proto decoding
  throw new Error('Not implemented: decodeMessage');
}

/**
 * Create a new message builder
 */
export function createMessageBuilder(): MessageBuilder {
  return new MessageBuilder();
}

/**
 * Builder for constructing Cap'n Proto messages
 */
export class MessageBuilder {
  private segments: Segment[] = [];

  addSegment(data: ArrayBuffer): this {
    this.segments.push({ data, byteLength: data.byteLength });
    return this;
  }

  build(): Message {
    const totalSize = this.segments.reduce((sum, seg) => sum + seg.byteLength, 0);
    return {
      segments: Object.freeze([...this.segments]),
      totalSize,
    };
  }

  clear(): this {
    this.segments = [];
    return this;
  }
}

// ============================================================================
// Error Types
// ============================================================================

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
export class CapnwebError extends Error {
  /**
   * Creates a new CapnwebError.
   * @param message - Human-readable error message
   * @param code - Machine-readable error code (e.g., 'CONNECTION_ERROR', 'RPC_ERROR')
   */
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CapnwebError';
  }
}

/**
 * Error thrown when a connection cannot be established or is unexpectedly lost.
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
export class ConnectionError extends CapnwebError {
  /**
   * Creates a new ConnectionError.
   * @param message - Description of the connection failure
   */
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown when an RPC method call fails.
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
export class RpcError extends CapnwebError {
  /**
   * Creates a new RpcError.
   * @param message - Description of the RPC failure
   * @param methodId - Optional method ID that failed (for debugging)
   */
  constructor(message: string, public readonly methodId?: number) {
    super(message, 'RPC_ERROR');
    this.name = 'RpcError';
  }
}

/**
 * Error thrown when a capability cannot be resolved or is invalid.
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
export class CapabilityError extends CapnwebError {
  /**
   * Creates a new CapabilityError.
   * @param message - Description of the capability error
   * @param capabilityId - Optional ID of the capability that caused the error
   */
  constructor(message: string, public readonly capabilityId?: CapabilityId) {
    super(message, 'CAPABILITY_ERROR');
    this.name = 'CapabilityError';
  }
}

/**
 * Error thrown when an operation exceeds its timeout.
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
export class TimeoutError extends CapnwebError {
  /**
   * Creates a new TimeoutError.
   * @param message - Description of what timed out (default: 'Request timed out')
   */
  constructor(message: string = 'Request timed out') {
    super(message, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}
