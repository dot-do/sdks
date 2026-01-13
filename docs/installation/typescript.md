# TypeScript Installation

TypeScript is the reference implementation for Cap'n Web, offering the most complete feature set.

## Installation

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

## Available Packages

| Package | Purpose | npm |
|---------|---------|-----|
| `capnweb` | Core protocol (Cloudflare's official) | `npm install capnweb` |
| `@dotdo/capnweb` | Extended protocol features | `npm install @dotdo/capnweb` |
| `rpc.do` | Magic proxy with batching | `npm install rpc.do` |
| `dotdo` | Platform SDK with auth | `npm install dotdo` |

## Requirements

- **Node.js**: 18.0.0 or later
- **TypeScript**: 5.0+ recommended (for `using` declarations)
- **ES Target**: ES2022+ for native `using` support

## Basic Usage

### WebSocket Client

```typescript
import { newWebSocketRpcSession, RpcTarget } from 'capnweb'

// Define your API interface
interface MyApi extends RpcTarget {
  greet(name: string): string
  getUser(id: number): Promise<User>
}

// Connect and use
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

const greeting = await api.greet('World')
console.log(greeting)  // "Hello, World!"
```

### HTTP Batch Client

```typescript
import { newHttpBatchRpcSession } from 'capnweb'

using api = newHttpBatchRpcSession<MyApi>('https://api.example.com')

// Multiple calls are batched into one HTTP request
const greeting1 = api.greet('Alice')
const greeting2 = api.greet('Bob')
const [result1, result2] = await Promise.all([greeting1, greeting2])
```

### Server (Cloudflare Workers)

```typescript
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'

class MyApiServer extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  async getUser(id: number): Promise<User> {
    return await db.getUser(id)
  }
}

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

### Server (Node.js)

```typescript
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { RpcTarget, newWebSocketRpcSession, nodeHttpBatchRpcResponse } from 'capnweb'

class MyApiServer extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }
}

const httpServer = http.createServer(async (req, res) => {
  if (req.headers.upgrade?.toLowerCase() === 'websocket') return

  if (req.url === '/api') {
    await nodeHttpBatchRpcResponse(req, res, new MyApiServer(), {
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

const wsServer = new WebSocketServer({ server: httpServer })
wsServer.on('connection', (ws) => {
  newWebSocketRpcSession(ws as any, new MyApiServer())
})

httpServer.listen(8080)
```

## TypeScript Configuration

Recommended `tsconfig.json` settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true
  }
}
```

### Using `using` Declarations

The `using` keyword requires ES2022+ target. If targeting older environments, use try/finally:

```typescript
// With `using` (ES2022+)
using api = newWebSocketRpcSession<MyApi>(url)

// Without `using` (older targets)
const api = newWebSocketRpcSession<MyApi>(url)
try {
  await api.doSomething()
} finally {
  api[Symbol.dispose]()
}
```

## Platform-Specific Imports

Cap'n Web has different entry points for different environments:

```typescript
// Standard environments (Node.js, Deno, browsers)
import { newWebSocketRpcSession } from 'capnweb'

// Cloudflare Workers (uses native RpcTarget)
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'
// RpcTarget is aliased to Workers' built-in RpcTarget
```

## Integration with Workers RPC

On Cloudflare Workers, Cap'n Web integrates seamlessly with the built-in RPC:

```typescript
import { RpcTarget, RpcStub } from 'capnweb'

// Service Bindings work with Cap'n Web
export default {
  async fetch(request: Request, env: Env) {
    // env.MY_SERVICE is a Workers Service Binding
    // Can be used with Cap'n Web stubs
    const stub: RpcStub<MyService> = env.MY_SERVICE
    await stub.doSomething()
  }
}
```

## Example Project Structure

```
my-project/
├── src/
│   ├── client.ts       # Client code
│   ├── server.ts       # Server implementation
│   └── types.ts        # Shared interfaces
├── package.json
└── tsconfig.json
```

### `types.ts` - Shared Types

```typescript
import { RpcTarget } from 'capnweb'

export interface MyApi extends RpcTarget {
  greet(name: string): string
  authenticate(token: string): AuthedApi
}

export interface AuthedApi extends RpcTarget {
  getProfile(): UserProfile
}

export type UserProfile = {
  id: number
  name: string
  email: string
}
```

### `server.ts` - Server Implementation

```typescript
import { RpcTarget, newWorkersRpcResponse } from 'capnweb'
import type { MyApi, AuthedApi, UserProfile } from './types'

class MyApiServer extends RpcTarget implements MyApi {
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  authenticate(token: string): AuthedApi {
    const user = validateToken(token)
    return new AuthedApiServer(user)
  }
}

class AuthedApiServer extends RpcTarget implements AuthedApi {
  constructor(private user: User) {
    super()
  }

  getProfile(): UserProfile {
    return {
      id: this.user.id,
      name: this.user.name,
      email: this.user.email
    }
  }
}
```

### `client.ts` - Client Code

```typescript
import { newWebSocketRpcSession } from 'capnweb'
import type { MyApi } from './types'

async function main() {
  using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

  // Simple call
  console.log(await api.greet('World'))

  // Pipelined calls
  const authed = api.authenticate(myToken)
  const profile = await authed.getProfile()
  console.log(`Welcome, ${profile.name}!`)
}

main()
```

## Troubleshooting

### `using` Not Recognized

Ensure your TypeScript target is ES2022+:

```json
{
  "compilerOptions": {
    "target": "ES2022"
  }
}
```

### Type Errors with RpcTarget

Make sure interfaces extend `RpcTarget`:

```typescript
// WRONG
interface MyApi {
  greet(name: string): string
}

// CORRECT
interface MyApi extends RpcTarget {
  greet(name: string): string
}
```

### WebSocket Connection Issues

Check that your URL uses `wss://` (not `ws://`) in production.
