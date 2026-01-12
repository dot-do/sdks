# @dotdo/capnweb

Low-level Cap'n Proto protocol types and primitives for TypeScript.

```bash
npm install @dotdo/capnweb
```

## Overview

`@dotdo/capnweb` provides the foundational types and interfaces for implementing Cap'n Proto RPC over WebTransport. This is a **low-level protocol package** that other packages in the .do ecosystem depend on.

**Important:** This package (`@dotdo/capnweb`) is distinct from the main `capnweb` npm package (owned by Cloudflare). While `capnweb` provides the full Cap'n Web RPC implementation, `@dotdo/capnweb` specifically provides the protocol types and transport abstractions used by the .do platform services.

## Package Hierarchy

The .do ecosystem follows a layered architecture where each package builds on the primitives provided by lower layers:

```
Domain SDKs (ai.do, db.do, functions.do, etc.)
           │
           ▼
      platform.do  ─── Managed connections, authentication, service discovery
           │
           ▼
        rpc.do     ─── Promise pipelining, proxy generation, method calls
           │
           ▼
      @dotdo/capnweb   ─── Protocol types, message formats, transport interface
```

### Layer Responsibilities

| Package | Responsibility |
|---------|----------------|
| `@dotdo/capnweb` | Protocol primitives: message types, capability IDs, transport interface |
| `rpc.do` | RPC abstraction: promise pipelining, capability proxies, method invocation |
| `platform.do` | Platform features: connection pooling, auth, service discovery |
| Domain SDKs | Business logic: typed interfaces for specific .do services |

## Installation

```bash
# Using npm
npm install @dotdo/capnweb

# Using yarn
yarn add @dotdo/capnweb

# Using pnpm
pnpm add @dotdo/capnweb
```

## When to Use @dotdo/capnweb

### Use @dotdo/capnweb Directly When:

1. **Building custom transport implementations** - Creating a new transport layer (e.g., WebSocket fallback, HTTP/2)
2. **Implementing protocol-level features** - Building middleware that inspects or modifies RPC messages
3. **Creating debugging/monitoring tools** - Building protocol analyzers, message loggers, or testing utilities
4. **Low-level protocol integration** - Integrating with systems that need direct access to Cap'n Proto message structures

### Use Higher-Level Packages When:

1. **Calling .do services** - Use `rpc.do` or domain-specific SDKs for service calls
2. **Building applications** - Use `platform.do` for managed connections and authentication
3. **Standard RPC patterns** - Higher-level packages handle promise pipelining automatically

## Core Types

### CapabilityId

A unique numeric identifier for capabilities in the RPC system. Capabilities are references to remote objects that can receive method calls.

```typescript
import type { CapabilityId } from '@dotdo/capnweb';

// CapabilityId is a type alias for number
const rootCapability: CapabilityId = 0;
const userServiceCapability: CapabilityId = 42;

// Capabilities are typically assigned by the protocol
function handleNewCapability(id: CapabilityId): void {
  console.log(`Received new capability with ID: ${id}`);
}
```

### MessageId

A unique identifier for correlating RPC requests with their responses. Each request includes a `questionId`, and the corresponding response includes an `answerId` that matches.

```typescript
import type { MessageId } from '@dotdo/capnweb';

// MessageId is a type alias for number
let nextMessageId: MessageId = 0;

function generateMessageId(): MessageId {
  return nextMessageId++;
}

// Tracking pending requests
const pendingRequests = new Map<MessageId, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}>();

function sendRequest(questionId: MessageId): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pendingRequests.set(questionId, { resolve, reject });
  });
}

function handleResponse(answerId: MessageId, result: unknown): void {
  const pending = pendingRequests.get(answerId);
  if (pending) {
    pending.resolve(result);
    pendingRequests.delete(answerId);
  }
}
```

### Segment and Message

Cap'n Proto messages consist of one or more segments. The `Segment` interface represents a contiguous block of data, while `Message` represents the complete message.

```typescript
import type { Segment, Message } from '@dotdo/capnweb';

// A segment contains raw binary data
const segment: Segment = {
  data: new ArrayBuffer(64),
  byteLength: 64,
};

// A message contains one or more segments
const message: Message = {
  segments: [segment],
  totalSize: 64,
};

// Working with message segments
function processMessage(msg: Message): void {
  console.log(`Message contains ${msg.segments.length} segments`);
  console.log(`Total size: ${msg.totalSize} bytes`);

  for (const segment of msg.segments) {
    const view = new DataView(segment.data);
    // Process segment data...
  }
}
```

### CapabilityRef

A reference to a remote capability, including metadata about its interface.

```typescript
import type { CapabilityRef, CapabilityId } from '@dotdo/capnweb';

// A capability reference contains:
// - id: The capability ID for addressing
// - interfaceId: A bigint identifying the interface type
// - methodCount: Number of methods the interface exposes
const counterRef: CapabilityRef = {
  id: 5,
  interfaceId: 0x8e5322c1e9282534n, // Interface hash
  methodCount: 3, // increment, decrement, getValue
};

// Using capability references for method dispatch
function callMethod(
  ref: CapabilityRef,
  methodId: number,
  params: Message
): void {
  if (methodId >= ref.methodCount) {
    throw new Error(`Method ${methodId} not found on interface ${ref.interfaceId}`);
  }
  // Dispatch the call...
}
```

### CapabilityPromise

A promise for a capability that may not yet be resolved. This is used for promise pipelining, where you can make calls on a capability before it's fully resolved.

```typescript
import type { CapabilityPromise, CapabilityRef, CapabilityId } from '@dotdo/capnweb';

// Creating a capability promise
function createCapabilityPromise(id: CapabilityId): CapabilityPromise {
  let resolveRef: CapabilityRef | null = null;
  let rejectError: Error | null = null;
  let isResolved = false;

  return {
    id,
    get resolved() {
      return isResolved;
    },
    resolve(ref: CapabilityRef) {
      if (isResolved) throw new Error('Already resolved');
      resolveRef = ref;
      isResolved = true;
    },
    reject(error: Error) {
      if (isResolved) throw new Error('Already resolved');
      rejectError = error;
      isResolved = true;
    },
  };
}

// Promise pipelining allows calls before resolution
const promisedCapability = createCapabilityPromise(10);

// Queue calls that will be sent once the capability resolves
// (This is handled by higher-level packages)
```

## RPC Message Types

The `RpcMessageType` enum defines all message types in the Cap'n Proto RPC protocol.

```typescript
import { RpcMessageType } from '@dotdo/capnweb';

// All RPC message types
console.log(RpcMessageType.Call);       // 0 - Method call request
console.log(RpcMessageType.Return);     // 1 - Method call response
console.log(RpcMessageType.Finish);     // 2 - Release answer
console.log(RpcMessageType.Resolve);    // 3 - Resolve promise capability
console.log(RpcMessageType.Release);    // 4 - Release capability reference
console.log(RpcMessageType.Disembargo); // 5 - Remove message ordering restrictions
console.log(RpcMessageType.Bootstrap);  // 6 - Request initial capability
console.log(RpcMessageType.Abort);      // 7 - Abort connection
```

### CallMessage

A method call request sent to a remote capability.

```typescript
import type { CallMessage, Message, CapabilityId, MessageId } from '@dotdo/capnweb';
import { RpcMessageType, createMessageBuilder } from '@dotdo/capnweb';

// Creating a call message
function createCallMessage(
  questionId: MessageId,
  target: CapabilityId,
  interfaceId: bigint,
  methodId: number,
  params: Message
): CallMessage {
  return {
    type: RpcMessageType.Call,
    questionId,
    target,
    interfaceId,
    methodId,
    params,
  };
}

// Example: Calling a counter's increment method
const incrementCall: CallMessage = {
  type: RpcMessageType.Call,
  questionId: 1,
  target: 5,                        // The counter capability
  interfaceId: 0x8e5322c1e9282534n, // Counter interface ID
  methodId: 0,                      // increment method
  params: {
    segments: [],
    totalSize: 0,
  },
};

// Type guard for call messages
function isCallMessage(msg: unknown): msg is CallMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    (msg as { type: unknown }).type === RpcMessageType.Call
  );
}
```

### ReturnMessage

A response to a method call, containing either the result or an error.

```typescript
import type { ReturnMessage, Message, MessageId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Successful return
const successReturn: ReturnMessage = {
  type: RpcMessageType.Return,
  answerId: 1,
  result: {
    segments: [{ data: new ArrayBuffer(8), byteLength: 8 }],
    totalSize: 8,
  },
  releaseParamCaps: true,
};

// Error return
const errorReturn: ReturnMessage = {
  type: RpcMessageType.Return,
  answerId: 1,
  result: new Error('Method not found'),
  releaseParamCaps: true,
};

// Handling return messages
function handleReturn(msg: ReturnMessage): void {
  if (msg.result instanceof Error) {
    console.error(`Call ${msg.answerId} failed:`, msg.result.message);
  } else {
    console.log(`Call ${msg.answerId} succeeded with ${msg.result.totalSize} bytes`);
  }

  if (msg.releaseParamCaps) {
    // Release capabilities that were passed as parameters
  }
}
```

### FinishMessage

Sent to indicate that the caller is done with a question's answer and any capabilities it contains.

```typescript
import type { FinishMessage, MessageId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Finish a question and release result capabilities
const finishMsg: FinishMessage = {
  type: RpcMessageType.Finish,
  questionId: 1,
  releaseResultCaps: true, // Release any capabilities in the result
};

// Finish but keep capabilities
const keepCapsFinish: FinishMessage = {
  type: RpcMessageType.Finish,
  questionId: 2,
  releaseResultCaps: false, // Keep capabilities for later use
};
```

### ResolveMessage

Resolves a promise capability to either a concrete capability or an error.

```typescript
import type { ResolveMessage, CapabilityRef, CapabilityId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Successful resolution
const resolveSuccess: ResolveMessage = {
  type: RpcMessageType.Resolve,
  promiseId: 10,
  resolution: {
    id: 15,
    interfaceId: 0x8e5322c1e9282534n,
    methodCount: 3,
  },
};

// Failed resolution
const resolveError: ResolveMessage = {
  type: RpcMessageType.Resolve,
  promiseId: 10,
  resolution: new Error('Capability no longer available'),
};

// Handling resolve messages
function handleResolve(msg: ResolveMessage): void {
  if (msg.resolution instanceof Error) {
    console.error(`Promise ${msg.promiseId} broken:`, msg.resolution.message);
    // Fail any pending calls on this promise
  } else {
    console.log(`Promise ${msg.promiseId} resolved to capability ${msg.resolution.id}`);
    // Forward any pending calls to the resolved capability
  }
}
```

### ReleaseMessage

Release a reference to a capability. When all references are released, the capability can be garbage collected.

```typescript
import type { ReleaseMessage, CapabilityId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Release a single reference
const releaseOne: ReleaseMessage = {
  type: RpcMessageType.Release,
  id: 5,
  referenceCount: 1,
};

// Release multiple references at once
const releaseMany: ReleaseMessage = {
  type: RpcMessageType.Release,
  id: 5,
  referenceCount: 3,
};

// Capability reference counting
class CapabilityRefCounter {
  private counts = new Map<CapabilityId, number>();

  addRef(id: CapabilityId): void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }

  release(id: CapabilityId, count: number = 1): ReleaseMessage | null {
    const current = this.counts.get(id) ?? 0;
    const newCount = current - count;

    if (newCount <= 0) {
      this.counts.delete(id);
      return {
        type: RpcMessageType.Release,
        id,
        referenceCount: current,
      };
    }

    this.counts.set(id, newCount);
    return null;
  }
}
```

### BootstrapMessage

Request the initial capability from the server. This is typically the first message sent after connecting.

```typescript
import type { BootstrapMessage, MessageId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Bootstrap request
const bootstrap: BootstrapMessage = {
  type: RpcMessageType.Bootstrap,
  questionId: 0, // Usually the first question
};

// The server responds with a ReturnMessage containing the root capability
```

### AbortMessage

Terminate the connection with a reason.

```typescript
import type { AbortMessage } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Abort due to error
const abortError: AbortMessage = {
  type: RpcMessageType.Abort,
  reason: 'Protocol violation: unexpected message type',
};

// Graceful shutdown
const abortShutdown: AbortMessage = {
  type: RpcMessageType.Abort,
  reason: 'Server shutting down',
};
```

### RpcMessage Union Type

The `RpcMessage` type is a discriminated union of all message types.

```typescript
import type { RpcMessage } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Message handler using discriminated union
function handleMessage(msg: RpcMessage): void {
  switch (msg.type) {
    case RpcMessageType.Call:
      console.log(`Call to capability ${msg.target}, method ${msg.methodId}`);
      break;

    case RpcMessageType.Return:
      console.log(`Return for question ${msg.answerId}`);
      break;

    case RpcMessageType.Finish:
      console.log(`Finish question ${msg.questionId}`);
      break;

    case RpcMessageType.Resolve:
      console.log(`Resolve promise ${msg.promiseId}`);
      break;

    case RpcMessageType.Release:
      console.log(`Release capability ${msg.id}`);
      break;

    case RpcMessageType.Bootstrap:
      console.log(`Bootstrap request, question ${msg.questionId}`);
      break;

    case RpcMessageType.Abort:
      console.log(`Abort: ${msg.reason}`);
      break;
  }
}
```

## Transport Interface

The `Transport` interface defines the contract for sending and receiving RPC messages over a network connection.

### TransportState

```typescript
import { TransportState } from '@dotdo/capnweb';

// Transport lifecycle states
const states = {
  connecting: TransportState.Connecting,   // Connection in progress
  connected: TransportState.Connected,     // Ready to send/receive
  disconnected: TransportState.Disconnected, // Cleanly disconnected
  failed: TransportState.Failed,           // Connection failed
};

function isConnected(state: TransportState): boolean {
  return state === TransportState.Connected;
}
```

### TransportEvents

```typescript
import type { TransportEvents, RpcMessage } from '@dotdo/capnweb';

// Event handler types
const handlers: TransportEvents = {
  message: (msg: RpcMessage) => {
    console.log('Received message:', msg.type);
  },
  connected: () => {
    console.log('Transport connected');
  },
  disconnected: (reason?: string) => {
    console.log('Transport disconnected:', reason);
  },
  error: (error: Error) => {
    console.error('Transport error:', error);
  },
};
```

### Transport Interface

```typescript
import type { Transport, RpcMessage, TransportEvents } from '@dotdo/capnweb';
import { TransportState, RpcMessageType } from '@dotdo/capnweb';

// Example: WebSocket-based transport implementation
class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private handlers = new Map<keyof TransportEvents, Set<Function>>();

  state: TransportState = TransportState.Connecting;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.state = TransportState.Connected;
      this.emit('connected');
    };

    this.ws.onclose = (event) => {
      this.state = TransportState.Disconnected;
      this.emit('disconnected', event.reason);
    };

    this.ws.onerror = () => {
      this.state = TransportState.Failed;
      this.emit('error', new Error('WebSocket error'));
    };

    this.ws.onmessage = (event) => {
      // Decode and emit message
      // const msg = decodeMessage(event.data);
      // this.emit('message', msg);
    };
  }

  async send(message: RpcMessage): Promise<void> {
    if (this.state !== TransportState.Connected) {
      throw new Error('Transport not connected');
    }
    // const data = encodeMessage(message);
    // this.ws.send(data);
  }

  async close(reason?: string): Promise<void> {
    this.ws.close(1000, reason);
  }

  on<K extends keyof TransportEvents>(
    event: K,
    handler: TransportEvents[K]
  ): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off<K extends keyof TransportEvents>(
    event: K,
    handler: TransportEvents[K]
  ): void {
    this.handlers.get(event)?.delete(handler);
  }

  private emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as Function)(...args);
    }
  }
}
```

## Connection Types

### ConnectionOptions

Configuration options for establishing a connection.

```typescript
import type { ConnectionOptions } from '@dotdo/capnweb';

// Basic connection
const basicOptions: ConnectionOptions = {
  url: 'https://api.example.do',
};

// Connection with all options
const fullOptions: ConnectionOptions = {
  url: 'webtransport://api.example.do',
  timeout: 30000,              // 30 second connection timeout
  autoReconnect: true,         // Automatically reconnect on disconnect
  maxReconnectAttempts: 5,     // Try 5 times before giving up
  reconnectDelay: 1000,        // Start with 1 second delay (exponential backoff)
};

// URL schemes
const schemes = {
  webTransport: 'webtransport://api.example.do', // Primary transport
  https: 'https://api.example.do',               // Fallback
};
```

### ConnectionStats

Statistics about the current connection.

```typescript
import type { ConnectionStats } from '@dotdo/capnweb';

// Connection statistics
function logStats(stats: ConnectionStats): void {
  console.log(`Messages in: ${stats.messagesIn}`);
  console.log(`Messages out: ${stats.messagesOut}`);
  console.log(`Bytes in: ${stats.bytesIn}`);
  console.log(`Bytes out: ${stats.bytesOut}`);
  console.log(`Latency: ${stats.latencyMs}ms`);
  console.log(`Uptime: ${stats.uptime}ms`);
}

// Monitoring connection health
function checkHealth(stats: ConnectionStats): boolean {
  const isHealthy = stats.latencyMs < 1000; // Less than 1 second latency
  return isHealthy;
}
```

### Connection Interface

```typescript
import type { Connection, ConnectionStats } from '@dotdo/capnweb';
import { TransportState } from '@dotdo/capnweb';

// Using a connection
async function useConnection(conn: Connection): Promise<void> {
  // Check connection state
  if (conn.state !== TransportState.Connected) {
    throw new Error('Not connected');
  }

  // Get the root capability
  const root = await conn.bootstrap<RootCapability>();

  // Use the capability...

  // Check stats
  console.log('Connection stats:', conn.stats);

  // Close when done
  await conn.close('Done');
}

// Type for the root capability
interface RootCapability {
  getService(name: string): Promise<unknown>;
}
```

## Message Builder

The `MessageBuilder` class helps construct Cap'n Proto messages from segments.

```typescript
import { MessageBuilder, createMessageBuilder } from '@dotdo/capnweb';
import type { Message, Segment } from '@dotdo/capnweb';

// Create a message builder
const builder = createMessageBuilder();

// Add segments
const segment1 = new ArrayBuffer(64);
const segment2 = new ArrayBuffer(32);

builder
  .addSegment(segment1)
  .addSegment(segment2);

// Build the message
const message: Message = builder.build();
console.log(`Built message with ${message.segments.length} segments`);
console.log(`Total size: ${message.totalSize} bytes`);

// Clear and reuse
builder.clear();

// Alternative: Direct instantiation
const directBuilder = new MessageBuilder();
directBuilder.addSegment(new ArrayBuffer(128));
const directMessage = directBuilder.build();
```

## Error Types

@dotdo/capnweb provides a hierarchy of error types for different failure scenarios.

### CapnwebError

The base error class for all capnweb errors.

```typescript
import { CapnwebError } from '@dotdo/capnweb';

// Base error with code
const error = new CapnwebError('Something went wrong', 'GENERIC_ERROR');
console.log(error.name);    // 'CapnwebError'
console.log(error.message); // 'Something went wrong'
console.log(error.code);    // 'GENERIC_ERROR'

// Type checking
function isCapnwebError(e: unknown): e is CapnwebError {
  return e instanceof CapnwebError;
}

try {
  // ... operation that might fail
} catch (e) {
  if (isCapnwebError(e)) {
    console.log(`Error code: ${e.code}`);
  }
}
```

### ConnectionError

Errors related to establishing or maintaining a connection.

```typescript
import { ConnectionError } from '@dotdo/capnweb';

// Connection refused
throw new ConnectionError('Failed to connect: Connection refused');

// Timeout
throw new ConnectionError('Connection timed out after 30000ms');

// Handling connection errors
function handleConnectionError(error: ConnectionError): void {
  console.error(`Connection failed: ${error.message}`);
  console.error(`Error code: ${error.code}`); // 'CONNECTION_ERROR'

  // Decide whether to retry
  const shouldRetry = !error.message.includes('refused');
  if (shouldRetry) {
    // Schedule reconnection...
  }
}
```

### RpcError

Errors that occur during RPC method calls.

```typescript
import { RpcError } from '@dotdo/capnweb';

// Method not found
throw new RpcError('Method not found', 42);

// Permission denied
throw new RpcError('Permission denied');

// Handling RPC errors
function handleRpcError(error: RpcError): void {
  console.error(`RPC failed: ${error.message}`);
  console.error(`Error code: ${error.code}`); // 'RPC_ERROR'

  if (error.methodId !== undefined) {
    console.error(`Method ID: ${error.methodId}`);
  }
}
```

### CapabilityError

Errors related to capability management.

```typescript
import { CapabilityError } from '@dotdo/capnweb';
import type { CapabilityId } from '@dotdo/capnweb';

// Capability not found
throw new CapabilityError('Capability not found', 5);

// Capability released
throw new CapabilityError('Capability has been released');

// Handling capability errors
function handleCapabilityError(error: CapabilityError): void {
  console.error(`Capability error: ${error.message}`);
  console.error(`Error code: ${error.code}`); // 'CAPABILITY_ERROR'

  if (error.capabilityId !== undefined) {
    console.error(`Capability ID: ${error.capabilityId}`);
    // Clean up any references to this capability
  }
}
```

## Serialization Utilities

@dotdo/capnweb provides utilities for encoding and decoding RPC messages.

```typescript
import { encodeMessage, decodeMessage } from '@dotdo/capnweb';
import type { RpcMessage } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

// Encoding a message to bytes
const callMessage: RpcMessage = {
  type: RpcMessageType.Call,
  questionId: 1,
  target: 0,
  interfaceId: 0x8e5322c1e9282534n,
  methodId: 0,
  params: { segments: [], totalSize: 0 },
};

// Note: These are stub implementations in the current version
// Real implementations would serialize to Cap'n Proto wire format
try {
  const encoded: ArrayBuffer = encodeMessage(callMessage);
  console.log(`Encoded to ${encoded.byteLength} bytes`);
} catch (e) {
  console.log('encodeMessage not yet implemented');
}

// Decoding bytes to a message
try {
  const data = new ArrayBuffer(64);
  const decoded: RpcMessage = decodeMessage(data);
  console.log(`Decoded message type: ${decoded.type}`);
} catch (e) {
  console.log('decodeMessage not yet implemented');
}
```

## Complete Examples

### Building a Protocol Inspector

```typescript
import type { Transport, RpcMessage, TransportEvents } from '@dotdo/capnweb';
import { TransportState, RpcMessageType } from '@dotdo/capnweb';

/**
 * A transport wrapper that logs all messages for debugging
 */
class InspectingTransport implements Transport {
  private inner: Transport;
  private handlers = new Map<keyof TransportEvents, Set<Function>>();

  constructor(inner: Transport) {
    this.inner = inner;

    // Wrap message events
    inner.on('message', (msg) => {
      this.logMessage('IN', msg);
      this.emit('message', msg);
    });

    inner.on('connected', () => {
      console.log('[INSPECTOR] Connected');
      this.emit('connected');
    });

    inner.on('disconnected', (reason) => {
      console.log(`[INSPECTOR] Disconnected: ${reason}`);
      this.emit('disconnected', reason);
    });

    inner.on('error', (error) => {
      console.error('[INSPECTOR] Error:', error);
      this.emit('error', error);
    });
  }

  get state(): TransportState {
    return this.inner.state;
  }

  get url(): string {
    return this.inner.url;
  }

  async send(message: RpcMessage): Promise<void> {
    this.logMessage('OUT', message);
    return this.inner.send(message);
  }

  async close(reason?: string): Promise<void> {
    console.log(`[INSPECTOR] Closing: ${reason}`);
    return this.inner.close(reason);
  }

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): void {
    this.handlers.get(event)?.delete(handler);
  }

  private emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as Function)(...args);
    }
  }

  private logMessage(direction: 'IN' | 'OUT', msg: RpcMessage): void {
    const typeNames: Record<RpcMessageType, string> = {
      [RpcMessageType.Call]: 'Call',
      [RpcMessageType.Return]: 'Return',
      [RpcMessageType.Finish]: 'Finish',
      [RpcMessageType.Resolve]: 'Resolve',
      [RpcMessageType.Release]: 'Release',
      [RpcMessageType.Disembargo]: 'Disembargo',
      [RpcMessageType.Bootstrap]: 'Bootstrap',
      [RpcMessageType.Abort]: 'Abort',
    };

    console.log(`[${direction}] ${typeNames[msg.type]}:`, this.summarizeMessage(msg));
  }

  private summarizeMessage(msg: RpcMessage): object {
    switch (msg.type) {
      case RpcMessageType.Call:
        return {
          questionId: msg.questionId,
          target: msg.target,
          methodId: msg.methodId,
        };
      case RpcMessageType.Return:
        return {
          answerId: msg.answerId,
          isError: msg.result instanceof Error,
        };
      case RpcMessageType.Bootstrap:
        return { questionId: msg.questionId };
      case RpcMessageType.Abort:
        return { reason: msg.reason };
      default:
        return msg;
    }
  }
}
```

### Implementing a Request Queue

```typescript
import type { RpcMessage, CallMessage, ReturnMessage, MessageId } from '@dotdo/capnweb';
import { RpcMessageType } from '@dotdo/capnweb';

interface PendingRequest {
  message: CallMessage;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Manages pending RPC requests with timeout support
 */
class RequestQueue {
  private pending = new Map<MessageId, PendingRequest>();
  private nextId: MessageId = 0;
  private timeoutMs = 30000;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;

    // Start timeout checker
    setInterval(() => this.checkTimeouts(), 1000);
  }

  createRequest(
    target: number,
    interfaceId: bigint,
    methodId: number,
    params: { segments: readonly { data: ArrayBuffer; byteLength: number }[]; totalSize: number }
  ): { message: CallMessage; promise: Promise<unknown> } {
    const questionId = this.nextId++;

    const message: CallMessage = {
      type: RpcMessageType.Call,
      questionId,
      target,
      interfaceId,
      methodId,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(questionId, {
        message,
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });

    return { message, promise };
  }

  handleReturn(msg: ReturnMessage): boolean {
    const request = this.pending.get(msg.answerId);
    if (!request) {
      return false;
    }

    this.pending.delete(msg.answerId);

    if (msg.result instanceof Error) {
      request.reject(msg.result);
    } else {
      request.resolve(msg.result);
    }

    return true;
  }

  private checkTimeouts(): void {
    const now = Date.now();

    for (const [id, request] of this.pending) {
      if (now - request.timestamp > this.timeoutMs) {
        this.pending.delete(id);
        request.reject(new Error(`Request ${id} timed out after ${this.timeoutMs}ms`));
      }
    }
  }

  cancelAll(reason: string): void {
    for (const [id, request] of this.pending) {
      request.reject(new Error(reason));
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
```

### Capability Reference Tracker

```typescript
import type { CapabilityRef, CapabilityId, ReleaseMessage } from '@dotdo/capnweb';
import { RpcMessageType, CapabilityError } from '@dotdo/capnweb';

/**
 * Tracks capability references and manages their lifecycle
 */
class CapabilityTracker {
  private capabilities = new Map<CapabilityId, {
    ref: CapabilityRef;
    localRefCount: number;
    remoteRefCount: number;
  }>();

  /**
   * Register a new capability received from the server
   */
  register(ref: CapabilityRef): void {
    this.capabilities.set(ref.id, {
      ref,
      localRefCount: 1,
      remoteRefCount: 1,
    });
  }

  /**
   * Get a capability by ID
   */
  get(id: CapabilityId): CapabilityRef {
    const entry = this.capabilities.get(id);
    if (!entry) {
      throw new CapabilityError(`Capability ${id} not found`, id);
    }
    return entry.ref;
  }

  /**
   * Add a local reference to a capability
   */
  addRef(id: CapabilityId): void {
    const entry = this.capabilities.get(id);
    if (!entry) {
      throw new CapabilityError(`Capability ${id} not found`, id);
    }
    entry.localRefCount++;
  }

  /**
   * Release a local reference and return a ReleaseMessage if
   * the capability should be released remotely
   */
  release(id: CapabilityId): ReleaseMessage | null {
    const entry = this.capabilities.get(id);
    if (!entry) {
      return null;
    }

    entry.localRefCount--;

    if (entry.localRefCount <= 0) {
      this.capabilities.delete(id);
      return {
        type: RpcMessageType.Release,
        id,
        referenceCount: entry.remoteRefCount,
      };
    }

    return null;
  }

  /**
   * Check if a capability is still valid
   */
  has(id: CapabilityId): boolean {
    return this.capabilities.has(id);
  }

  /**
   * Get all tracked capability IDs
   */
  getAllIds(): CapabilityId[] {
    return Array.from(this.capabilities.keys());
  }

  /**
   * Clear all capabilities (e.g., on disconnect)
   */
  clear(): void {
    this.capabilities.clear();
  }
}
```

## TypeScript Configuration

For best results, enable strict mode in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## API Reference Summary

### Types

| Type | Description |
|------|-------------|
| `CapabilityId` | Numeric identifier for capabilities |
| `MessageId` | Numeric identifier for request/response correlation |
| `Segment` | A segment of a Cap'n Proto message |
| `Message` | A complete Cap'n Proto message |
| `CapabilityRef` | Reference to a remote capability |
| `CapabilityPromise` | Promise for an unresolved capability |
| `RpcMessage` | Union of all RPC message types |
| `Transport` | Interface for message transport |
| `TransportEvents` | Event handler signatures for transport |
| `ConnectionOptions` | Options for establishing connections |
| `ConnectionStats` | Connection statistics |
| `Connection` | Interface for RPC connections |

### Enums

| Enum | Values |
|------|--------|
| `RpcMessageType` | `Call`, `Return`, `Finish`, `Resolve`, `Release`, `Disembargo`, `Bootstrap`, `Abort` |
| `TransportState` | `Connecting`, `Connected`, `Disconnected`, `Failed` |

### Classes

| Class | Description |
|-------|-------------|
| `MessageBuilder` | Builder for constructing Cap'n Proto messages |
| `CapnwebError` | Base error class |
| `ConnectionError` | Connection-related errors |
| `RpcError` | RPC call errors |
| `CapabilityError` | Capability resolution errors |

### Functions

| Function | Description |
|----------|-------------|
| `encodeMessage(message)` | Encode an RPC message to bytes |
| `decodeMessage(data)` | Decode bytes to an RPC message |
| `createMessageBuilder()` | Create a new message builder |

## License

MIT

## Related Packages

- [rpc.do](https://www.npmjs.com/package/rpc.do) - Promise pipelining RPC client
- [platform.do](https://www.npmjs.com/package/platform.do) - Platform SDK with managed connections
- [oauth.do](https://www.npmjs.com/package/oauth.do) - OAuth authentication for .do services
