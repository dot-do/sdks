# RpcClient

The main entry point for creating Cap'n Web RPC sessions.

## Overview

Cap'n Web provides several factory functions to create RPC sessions:

| Function | Transport | Use Case |
|----------|-----------|----------|
| `newWebSocketRpcSession` | WebSocket | Long-lived connections |
| `newHttpBatchRpcSession` | HTTP POST | Short-lived batch operations |
| `newMessagePortRpcSession` | MessagePort | Browser workers/iframes |
| `newWorkersRpcResponse` | Cloudflare Workers | Server-side handling |

## newWebSocketRpcSession

Creates a WebSocket-based RPC session for long-lived, bidirectional communication.

### Signature

```typescript
function newWebSocketRpcSession<T>(
  url: string,
  options?: RpcSessionOptions
): RpcStub<T>

function newWebSocketRpcSession<T>(
  webSocket: WebSocket,
  localMain?: RpcTarget,
  options?: RpcSessionOptions
): RpcStub<T>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | WebSocket URL (`wss://` or `ws://`) |
| `webSocket` | `WebSocket` | Existing WebSocket connection |
| `localMain` | `RpcTarget` | Optional local API to expose to peer |
| `options` | `RpcSessionOptions` | Session configuration |

### Returns

`RpcStub<T>` - A stub for making RPC calls to the remote API.

### Example

```typescript
import { newWebSocketRpcSession } from 'capnweb'

// Client usage
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')
const result = await api.greet('World')

// Server usage (with existing WebSocket)
const localApi = new MyApiServer()
using client = newWebSocketRpcSession<ClientApi>(webSocket, localApi)
```

### Disposal

The returned stub is disposable. When disposed:
- The WebSocket connection is closed
- All pending calls are rejected
- Server-side resources are released

```typescript
// Automatic disposal with `using`
{
  using api = newWebSocketRpcSession<MyApi>(url)
  await api.doSomething()
}  // Connection closed here

// Manual disposal
const api = newWebSocketRpcSession<MyApi>(url)
// ... use api ...
api[Symbol.dispose]()  // Close connection
```

---

## newHttpBatchRpcSession

Creates an HTTP-based RPC session that batches multiple calls into a single request.

### Signature

```typescript
function newHttpBatchRpcSession<T>(
  url: string,
  options?: HttpBatchOptions
): RpcStub<T>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | HTTP(S) URL for the API endpoint |
| `options` | `HttpBatchOptions` | Batch configuration |

### HttpBatchOptions

```typescript
interface HttpBatchOptions extends RpcSessionOptions {
  headers?: Record<string, string>
  method?: 'POST' | 'PUT'
}
```

### Returns

`RpcStub<T>` - A stub for making batched RPC calls.

### Example

```typescript
import { newHttpBatchRpcSession } from 'capnweb'

using api = newHttpBatchRpcSession<MyApi>('https://api.example.com', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

// Multiple calls are batched
const greeting1 = api.greet('Alice')
const greeting2 = api.greet('Bob')
const user = api.getUser(greeting1.userId)  // Pipelining works!

// Batch is sent when awaited
const [g1, g2, u] = await Promise.all([greeting1, greeting2, user])
```

### Batch Behavior

- Calls are queued until the next microtask
- All queued calls are sent in a single HTTP request
- Promise pipelining works within the batch
- After the batch completes, the stub cannot be reused

---

## newMessagePortRpcSession

Creates an RPC session over a MessagePort (for browser workers/iframes).

### Signature

```typescript
function newMessagePortRpcSession<T>(
  port: MessagePort,
  localMain?: RpcTarget,
  options?: RpcSessionOptions
): RpcStub<T>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `port` | `MessagePort` | MessagePort for communication |
| `localMain` | `RpcTarget` | Optional local API to expose |
| `options` | `RpcSessionOptions` | Session configuration |

### Example

```typescript
import { newMessagePortRpcSession, RpcTarget } from 'capnweb'

// Create a MessageChannel
const channel = new MessageChannel()

// Server side (e.g., in a Web Worker)
class Greeter extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}
newMessagePortRpcSession(channel.port1, new Greeter())

// Client side
using api = newMessagePortRpcSession<Greeter>(channel.port2)
const greeting = await api.greet('World')
```

### Security Note

Always create a new `MessageChannel` for RPC. Don't use `window.postMessage` directly, as it's accessible to any script on the page.

---

## newWorkersRpcResponse

Creates an HTTP response for Cloudflare Workers that handles both HTTP batch and WebSocket connections.

### Signature

```typescript
function newWorkersRpcResponse(
  request: Request,
  api: RpcTarget,
  options?: WorkersRpcOptions
): Response | Promise<Response>
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `request` | `Request` | Incoming Workers request |
| `api` | `RpcTarget` | API implementation to expose |
| `options` | `WorkersRpcOptions` | Response configuration |

### WorkersRpcOptions

```typescript
interface WorkersRpcOptions extends RpcSessionOptions {
  headers?: Record<string, string>
}
```

### Example

```typescript
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

export default {
  fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/api') {
      return newWorkersRpcResponse(request, new MyApi(), {
        headers: {
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    return new Response('Not found', { status: 404 })
  }
}
```

### Request Handling

The function automatically handles:
- **WebSocket Upgrade**: If the request has an `Upgrade: websocket` header
- **HTTP POST**: For batch RPC requests
- **OPTIONS**: For CORS preflight requests

---

## newHttpBatchRpcResponse

Creates an HTTP response for batch RPC requests (non-Workers environments).

### Signature

```typescript
function newHttpBatchRpcResponse(
  request: Request,
  api: RpcTarget,
  options?: RpcSessionOptions
): Promise<Response>
```

### Example

```typescript
// Deno server
Deno.serve(async (req) => {
  if (req.method === 'POST' && new URL(req.url).pathname === '/api') {
    return await newHttpBatchRpcResponse(req, new MyApi())
  }
  return new Response('Not Found', { status: 404 })
})
```

---

## nodeHttpBatchRpcResponse

Handles batch RPC requests in Node.js using native HTTP types.

### Signature

```typescript
function nodeHttpBatchRpcResponse(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  api: RpcTarget,
  options?: NodeHttpOptions
): Promise<void>
```

### Example

```typescript
import http from 'node:http'
import { nodeHttpBatchRpcResponse, RpcTarget } from 'capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api' && req.method === 'POST') {
    await nodeHttpBatchRpcResponse(req, res, new MyApi(), {
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
    return
  }
  res.writeHead(404)
  res.end('Not Found')
})

server.listen(8080)
```

---

## RpcSessionOptions

Common options for all session types.

```typescript
interface RpcSessionOptions {
  // Called when the session encounters an unrecoverable error
  onError?: (error: Error) => void

  // Called when the session is closed
  onClose?: () => void

  // Timeout for individual RPC calls (milliseconds)
  callTimeout?: number
}
```

---

## Type Parameters

All factory functions accept a type parameter `T` that represents the remote API interface:

```typescript
interface MyApi {
  greet(name: string): string
  getUser(id: number): Promise<User>
  authenticate(token: string): AuthenticatedApi
}

// The stub knows which methods are available
const api = newWebSocketRpcSession<MyApi>(url)
await api.greet('World')     // TypeScript knows this returns string
await api.getUser(123)       // TypeScript knows this returns Promise<User>
```

For best type safety, define your API interfaces in a shared types file that both client and server can import.
