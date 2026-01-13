# WebSocket Sessions

Long-lived RPC connections over WebSocket.

## Overview

WebSocket sessions provide persistent, bidirectional communication. They're ideal for:

- Long-running applications
- Real-time updates
- Bidirectional RPC (server calling client)
- Streaming data

## Creating a Session

### Client-Side

```typescript
import { newWebSocketRpcSession } from 'capnweb'

// Connect to a WebSocket endpoint
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Make calls over the persistent connection
await api.greet('World')
// ... later ...
await api.getUser(123)
```

### Server-Side (Cloudflare Workers)

```typescript
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

export default {
  fetch(request: Request) {
    if (new URL(request.url).pathname === '/api') {
      return newWorkersRpcResponse(request, new MyApi())
    }
    return new Response('Not found', { status: 404 })
  }
}
```

### Server-Side (Node.js)

```typescript
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { newWebSocketRpcSession, RpcTarget } from 'capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

const httpServer = http.createServer()
const wsServer = new WebSocketServer({ server: httpServer })

wsServer.on('connection', (ws) => {
  // Handle each WebSocket connection
  newWebSocketRpcSession(ws as any, new MyApi())
})

httpServer.listen(8080)
```

## Bidirectional RPC

With WebSocket sessions, the server can call client methods:

### Client Exposes API

```typescript
import { newWebSocketRpcSession, RpcTarget } from 'capnweb'

// Client-side API that server can call
class ClientCallback extends RpcTarget {
  onNotification(message: string): void {
    console.log('Server says:', message)
  }

  onUpdate(data: any): void {
    updateUI(data)
  }
}

// Connect and provide client API
const clientApi = new ClientCallback()
using api = newWebSocketRpcSession<ServerApi>(
  'wss://api.example.com',
  clientApi  // Second parameter is local API
)

// Register for callbacks
await api.subscribe()
```

### Server Calls Client

```typescript
class ServerApi extends RpcTarget {
  private clients: RpcStub<ClientCallback>[] = []

  subscribe(callback: RpcStub<ClientCallback>): void {
    this.clients.push(callback.dup())  // Keep a copy

    // Server can call client methods
    callback.onNotification('Subscribed successfully!')
  }

  broadcast(message: string): void {
    for (const client of this.clients) {
      client.onNotification(message)
    }
  }
}
```

## Connection Lifecycle

### Opening

```typescript
// Connection is established when you create the session
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')
// At this point, connection is open and ready
```

### Closing

```typescript
// Automatic close with `using`
{
  using api = newWebSocketRpcSession<MyApi>(url)
  // ... use api ...
}  // Connection closed here

// Manual close
const api = newWebSocketRpcSession<MyApi>(url)
// ... use api ...
api[Symbol.dispose]()  // Close connection
```

### Error Handling

```typescript
const api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Monitor for connection issues
api.onRpcBroken((error) => {
  console.error('Connection lost:', error)
  // Implement reconnection logic
})
```

## Promise Pipelining

WebSocket sessions fully support promise pipelining:

```typescript
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// These calls are pipelined (sent together)
const user = api.getUser(123)
const profile = await api.getProfile(user.id)

// Single round trip for both calls!
```

### Streaming Pipelining

With WebSocket, you can interleave pipelining across time:

```typescript
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// First batch
const user = api.authenticate(token)
const userId = await user.id

// Later, another batch
const profile = api.getProfile(userId)
const friends = await api.getFriends(userId)
```

## Configuration Options

```typescript
const api = newWebSocketRpcSession<MyApi>('wss://api.example.com', {
  // Called when connection breaks
  onError: (error) => {
    console.error('WebSocket error:', error)
  },

  // Called when connection closes
  onClose: () => {
    console.log('Connection closed')
  },

  // Timeout for individual calls (ms)
  callTimeout: 30000
})
```

## Reconnection

Cap'n Web doesn't include built-in reconnection. Implement it yourself:

```typescript
async function createResilientConnection<T>(url: string): Promise<RpcStub<T>> {
  let api: RpcStub<T> | null = null

  async function connect() {
    api = newWebSocketRpcSession<T>(url)

    api.onRpcBroken(async (error) => {
      console.error('Connection lost, reconnecting...', error)
      await new Promise(r => setTimeout(r, 1000))
      await connect()
    })
  }

  await connect()
  return api!
}

const api = await createResilientConnection<MyApi>('wss://api.example.com')
```

## Using with Existing WebSocket

If you already have a WebSocket connection:

```typescript
// Browser
const ws = new WebSocket('wss://api.example.com')
await new Promise(resolve => ws.onopen = resolve)

// Create session from existing WebSocket
using api = newWebSocketRpcSession<MyApi>(ws)
```

## Multiple Sessions

You can have multiple WebSocket sessions:

```typescript
// Connect to different services
using userApi = newWebSocketRpcSession<UserApi>('wss://users.example.com')
using dataApi = newWebSocketRpcSession<DataApi>('wss://data.example.com')

// Use independently
const user = await userApi.getUser(123)
const data = await dataApi.getData(user.dataId)
```

## Security Considerations

### Authentication

WebSockets don't support custom headers in browsers. Authenticate in-band:

```typescript
// Create unauthenticated connection
using publicApi = newWebSocketRpcSession<PublicApi>('wss://api.example.com')

// Authenticate via RPC
const authedApi = await publicApi.authenticate(token)

// Now use authenticated API
const profile = await authedApi.getProfile()
```

### Origin Validation

On the server, validate the Origin header:

```typescript
wsServer.on('connection', (ws, request) => {
  const origin = request.headers.origin

  if (origin !== 'https://trusted-site.com') {
    ws.close(4000, 'Invalid origin')
    return
  }

  newWebSocketRpcSession(ws as any, new MyApi())
})
```

## Performance Tips

### 1. Reuse Connections

```typescript
// GOOD: Reuse session for multiple calls
using api = newWebSocketRpcSession<MyApi>(url)
await api.method1()
await api.method2()
await api.method3()

// BAD: Create new connection each time
await newWebSocketRpcSession<MyApi>(url).method1()
await newWebSocketRpcSession<MyApi>(url).method2()  // New connection!
```

### 2. Pipeline Related Calls

```typescript
// GOOD: Pipelined
const user = api.getUser(123)
const profile = await api.getProfile(user.id)

// BAD: Sequential
const user = await api.getUser(123)
const profile = await api.getProfile(user.id)
```

### 3. Clean Up Unused References

```typescript
// Dispose stubs you don't need anymore
const calculator = await api.createCalculator()
await calculator.add(5)
calculator[Symbol.dispose]()  // Release server resources
```
