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
 * Base error class for capnweb errors
 */
export class CapnwebError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CapnwebError';
  }
}

/**
 * Connection-related errors
 */
export class ConnectionError extends CapnwebError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

/**
 * RPC call errors
 */
export class RpcError extends CapnwebError {
  constructor(message: string, public readonly methodId?: number) {
    super(message, 'RPC_ERROR');
    this.name = 'RpcError';
  }
}

/**
 * Capability resolution errors
 */
export class CapabilityError extends CapnwebError {
  constructor(message: string, public readonly capabilityId?: CapabilityId) {
    super(message, 'CAPABILITY_ERROR');
    this.name = 'CapabilityError';
  }
}
