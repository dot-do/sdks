# Getting Started

DotDo SDKs provide a multi-language implementation of Cap'n Web, a JavaScript-native RPC protocol with Promise Pipelining. This guide will help you get up and running quickly.

## What is Cap'n Web?

Cap'n Web is a spiritual sibling to [Cap'n Proto](https://capnproto.org), designed for the web stack:

- **Object-Capability Protocol**: Pass functions and objects by reference over RPC
- **Zero-Schema**: No code generation required - works directly with TypeScript interfaces
- **JSON-based**: Human-readable serialization with JSON
- **Multi-Transport**: HTTP, WebSocket, and MessagePort out of the box
- **Promise Pipelining**: Chain dependent calls in a single round trip

## Quick Start

### 1. Install the Package

::: code-group

```bash [npm]
npm install capnweb
```

```bash [pnpm]
pnpm add capnweb
```

```bash [yarn]
yarn add capnweb
```

```bash [bun]
bun add capnweb
```

:::

### 2. Define Your Interface (Optional)

TypeScript interfaces help with type safety but are not required:

```typescript
interface MyApi {
  greet(name: string): string
  getUser(id: number): Promise<User>
  authenticate(token: string): AuthenticatedApi
}

interface AuthenticatedApi {
  getProfile(): UserProfile
  updateProfile(data: Partial<UserProfile>): void
}

type User = {
  id: number
  name: string
  email: string
}
```

### 3. Create a Client

```typescript
import { newWebSocketRpcSession } from 'capnweb'

// Create a WebSocket session for long-lived connections
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Make RPC calls
const greeting = await api.greet('World')
console.log(greeting)  // "Hello, World!"
```

### 4. Create a Server

```typescript
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'

class MyApiServer extends RpcTarget implements MyApi {
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  async getUser(id: number): Promise<User> {
    return { id, name: 'Alice', email: 'alice@example.com' }
  }

  authenticate(token: string): AuthenticatedApi {
    // Validate token and return authenticated API
    return new AuthenticatedApiServer(token)
  }
}

// Cloudflare Workers handler
export default {
  fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/api') {
      return newWorkersRpcResponse(request, new MyApiServer())
    }

    return new Response('Not found', { status: 404 })
  }
}
```

## Transport Options

Cap'n Web supports multiple transport mechanisms:

### WebSocket (Recommended for Long-Lived Connections)

```typescript
import { newWebSocketRpcSession } from 'capnweb'

// Persistent connection with bidirectional communication
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')
```

### HTTP Batch (Recommended for Short-Lived Operations)

```typescript
import { newHttpBatchRpcSession } from 'capnweb'

// Single HTTP request with multiple calls batched together
using api = newHttpBatchRpcSession<MyApi>('https://api.example.com')

// All calls before await are batched into one request
const greeting1 = api.greet('Alice')
const greeting2 = api.greet('Bob')
const [result1, result2] = await Promise.all([greeting1, greeting2])
```

### MessagePort (Browser Workers/Iframes)

```typescript
import { newMessagePortRpcSession } from 'capnweb'

const channel = new MessageChannel()

// Server side (e.g., in a Web Worker)
newMessagePortRpcSession(channel.port1, new MyApiServer())

// Client side
using api = newMessagePortRpcSession<MyApi>(channel.port2)
```

## Next Steps

- [Learn about Promise Pipelining](/guide/promise-pipelining) - Make multiple calls in one round trip
- [Understand RpcTarget](/api/rpc-target) - Create objects that can be passed by reference
- [Error Handling](/guide/error-handling) - Handle errors gracefully
- [See Examples](/examples/) - Real-world usage patterns

## Language-Specific Guides

While this documentation focuses on TypeScript, Cap'n Web is available in many languages:

- [Python Installation](/installation/python)
- [Go Installation](/installation/go)
- [Rust Installation](/installation/rust)
- [Ruby Installation](/installation/ruby)
- [Java/Kotlin Installation](/installation/java-kotlin)
- [.NET Installation](/installation/dotnet)

Each language follows the same concepts but uses idiomatic patterns for that language.
