# HTTP Batch Sessions

Single-request RPC batching over HTTP.

## Overview

HTTP batch sessions allow you to make multiple RPC calls in a single HTTP request. This is ideal for:

- Serverless functions (no persistent connections)
- Simple request-response patterns
- Environments where WebSocket isn't available
- Reducing connection overhead

## Creating a Session

```typescript
import { newHttpBatchRpcSession } from 'capnweb'

using api = newHttpBatchRpcSession<MyApi>('https://api.example.com', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

// Queue up calls
const greeting1 = api.greet('Alice')
const greeting2 = api.greet('Bob')
const user = api.getUser(greeting1.userId)

// Batch is sent when awaited
const [g1, g2, u] = await Promise.all([greeting1, greeting2, user])
```

## How Batching Works

1. **Queue Phase**: Calls are queued when you invoke methods
2. **Send Phase**: Batch is sent on the next microtask tick (or when awaited)
3. **Response Phase**: All results return together

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

// Queue phase - no network traffic yet
const a = api.methodA()
const b = api.methodB()
const c = api.methodC()

// Send phase - one HTTP request with all three calls
const [resultA, resultB, resultC] = await Promise.all([a, b, c])
```

## Promise Pipelining

HTTP batch sessions fully support promise pipelining:

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

// Pipeline dependent calls
const user = api.getUser(123)              // Don't await
const profile = api.getProfile(user.id)    // Uses user.id as RpcPromise
const friends = api.getFriends(user.id)    // Reuses user.id

// All sent in one request, dependencies resolved on server
const [p, f] = await Promise.all([profile, friends])
```

## Configuration Options

```typescript
const api = newHttpBatchRpcSession<MyApi>('https://api.example.com', {
  // Custom headers
  headers: {
    'Authorization': `Bearer ${token}`,
    'X-Request-Id': generateId()
  },

  // HTTP method (default: POST)
  method: 'POST',

  // Timeout for the HTTP request
  callTimeout: 30000
})
```

## Server-Side Handling

### Cloudflare Workers

```typescript
import { newWorkersRpcResponse, RpcTarget } from 'capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

export default {
  fetch(request: Request) {
    if (new URL(request.url).pathname === '/api') {
      // Handles both HTTP batch and WebSocket
      return newWorkersRpcResponse(request, new MyApi())
    }
    return new Response('Not found', { status: 404 })
  }
}
```

### Node.js

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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    })
    return
  }

  // Handle CORS preflight
  if (req.url === '/api' && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    res.end()
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

server.listen(8080)
```

### Deno

```typescript
import { newHttpBatchRpcResponse, RpcTarget } from 'npm:capnweb'

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

Deno.serve(async (req) => {
  if (new URL(req.url).pathname === '/api') {
    const response = await newHttpBatchRpcResponse(req, new MyApi())
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  }
  return new Response('Not Found', { status: 404 })
})
```

## Batch Lifecycle

### Single-Use Sessions

HTTP batch sessions are single-use. After the batch completes, the session cannot make more calls:

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

const a = await api.methodA()  // Batch 1 sent

// This will throw an error!
const b = await api.methodB()  // Error: Batch already completed
```

### Multiple Batches

For multiple batches, create new sessions:

```typescript
// First batch
{
  using api = newHttpBatchRpcSession<MyApi>(url)
  const a = await api.methodA()
}

// Second batch
{
  using api = newHttpBatchRpcSession<MyApi>(url)
  const b = await api.methodB()
}
```

## Awaited vs Non-Awaited Results

Only awaited promises get their results returned:

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

const user = api.getUser(123)           // Used for pipelining
const profile = api.getProfile(user.id) // We want this result

// Only profile result is returned (user was just for pipelining)
const result = await profile
// user.id was used but user object itself wasn't needed
```

## Error Handling

### Individual Call Errors

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

const a = api.methodA()
const b = api.methodThatFails()
const c = api.methodC()

// Use allSettled to handle partial failures
const results = await Promise.allSettled([a, b, c])
results.forEach((result, i) => {
  if (result.status === 'fulfilled') {
    console.log(`Call ${i}: ${result.value}`)
  } else {
    console.error(`Call ${i} failed: ${result.reason}`)
  }
})
```

### Network Errors

```typescript
using api = newHttpBatchRpcSession<MyApi>(url)

try {
  await api.method()
} catch (error) {
  if (error.message.includes('network')) {
    // Handle network failure
  }
}
```

## Comparison with WebSocket

| Feature | HTTP Batch | WebSocket |
|---------|------------|-----------|
| Connection | New per batch | Persistent |
| Latency | Higher (connection overhead) | Lower |
| Bidirectional | No | Yes |
| Server callbacks | No | Yes |
| Serverless-friendly | Yes | Depends |
| Pipeline support | Yes | Yes |

## Use Cases

### 1. Serverless Functions

```typescript
export default async function handler(req: Request) {
  using api = newHttpBatchRpcSession<BackendApi>(BACKEND_URL)

  const user = api.getUser(req.userId)
  const [profile, posts] = await Promise.all([
    api.getProfile(user.id),
    api.getPosts(user.id)
  ])

  return Response.json({ profile, posts })
}
```

### 2. Data Fetching

```typescript
async function fetchDashboardData(userId: number) {
  using api = newHttpBatchRpcSession<Api>(url)

  const user = api.getUser(userId)
  return await Promise.all([
    user.name,
    user.email,
    api.getNotifications(user.id),
    api.getStats(user.id)
  ])
}
```

### 3. Batch Updates

```typescript
async function updateMultipleRecords(updates: Update[]) {
  using api = newHttpBatchRpcSession<Api>(url)

  const promises = updates.map(u => api.updateRecord(u.id, u.data))
  return await Promise.all(promises)
}
```

## Performance Tips

### 1. Queue All Calls Before Awaiting

```typescript
// GOOD: All calls batched
using api = newHttpBatchRpcSession<Api>(url)
const a = api.methodA()
const b = api.methodB()
const c = api.methodC()
const [ra, rb, rc] = await Promise.all([a, b, c])

// BAD: Three separate batches
using api1 = newHttpBatchRpcSession<Api>(url)
const ra = await api1.methodA()

using api2 = newHttpBatchRpcSession<Api>(url)
const rb = await api2.methodB()
```

### 2. Use Pipelining for Dependencies

```typescript
// GOOD: Pipelined in one request
using api = newHttpBatchRpcSession<Api>(url)
const user = api.getUser(123)
const profile = await api.getProfile(user.id)

// BAD: Two requests
using api1 = newHttpBatchRpcSession<Api>(url)
const user = await api1.getUser(123)

using api2 = newHttpBatchRpcSession<Api>(url)
const profile = await api2.getProfile(user.id)
```
