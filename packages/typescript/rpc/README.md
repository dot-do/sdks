# rpc.do

**The magic proxy that makes any `.do` service feel like local code.**

```typescript
import { connect } from 'rpc.do'

const api = connect('wss://mongo.do')

// Call any method - no schema required
const users = await api.$.users.find({ active: true })
const profile = await api.$.users.findOne({ id: 123 }).profile.settings
```

One import. One connection. Zero boilerplate.

---

## What is rpc.do?

`rpc.do` is the managed RPC layer for the `.do` ecosystem. It sits between raw [capnweb](https://www.npmjs.com/package/capnweb) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `api.$.anything.you.want()` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Authenticate seamlessly** - Integrates with `oauth.do`

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  rpc.do  | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Magic proxy (api.$.method())
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining
    +--- Auth integration
```

---

## rpc.do vs capnweb

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side `.map()` | Yes | Yes (enhanced) |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc.do** when you're calling `.do` services and want maximum flexibility.

---

## Installation

```bash
npm install rpc.do
```

Or with your preferred package manager:

```bash
# Yarn
yarn add rpc.do

# pnpm
pnpm add rpc.do

# Bun
bun add rpc.do
```

Requires Node.js 18+ or any modern JavaScript runtime (Deno, Bun, browsers).

---

## Quick Start

### Basic Connection

```typescript
import { connect } from 'rpc.do'

// Connect to any .do service
const client = connect('wss://api.example.do')

// Call methods via the $ proxy
const result = await client.$.hello('World')
console.log(result)  // "Hello, World!"

// Close when done
await client.close()
```

### With Authentication

```typescript
import { connect } from 'rpc.do'

const client = connect('wss://api.example.do', {
  token: 'your-api-key',
  headers: {
    'X-Custom-Header': 'value'
  }
})

// Authenticated calls
const user = await client.$.users.me()
```

### TypeScript: Type Your APIs

```typescript
import { connect } from 'rpc.do'

// Define your service interface
interface MyService {
  square(x: number): Promise<number>
  users: {
    get(id: number): Promise<User>
    list(): Promise<User[]>
    create(data: CreateUserInput): Promise<User>
  }
}

interface User {
  id: number
  name: string
  email: string
}

interface CreateUserInput {
  name: string
  email: string
}

// Type-safe client
const client = connect<MyService>('wss://api.example.do')

// Full autocomplete and type checking
const num = await client.$.square(5)         // TypeScript knows: number
const user = await client.$.users.get(123)   // TypeScript knows: User
const users = await client.$.users.list()    // TypeScript knows: User[]
```

---

## The Magic Proxy

The `$` property returns a magic proxy that intercepts all property access and method calls, sending them as RPC requests.

### How It Works

```typescript
const client = connect('wss://api.example.do')

// Every property access is recorded
client.$                    // proxy
client.$.users              // proxy with path ["users"]
client.$.users.get          // proxy with path ["users", "get"]
client.$.users.get(123)     // RPC call to "get" with args [123]
```

The proxy doesn't know what methods exist on the server. It just records the path and sends it when you call a function.

### Nested Access

Access deeply nested APIs naturally:

```typescript
// All of these work
await client.$.users.get(123)
await client.$.users.profiles.settings.theme.get()
await client.$.api.v2.admin.users.deactivate(userId)
```

### Dynamic Keys

Use bracket notation for dynamic property names:

```typescript
const tableName = 'users'
const result = await client.$[tableName].find({ active: true })

// Equivalent to
const result = await client.$.users.find({ active: true })
```

---

## Capabilities

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object.

### Creating Capabilities

```typescript
// Server returns a capability reference
const counter = await client.$.makeCounter(10)

// counter is now a proxy to the remote Counter object
console.log(counter.__capabilityId)  // e.g., 1

// Call methods on the capability
const value = await counter.value()       // 10
const newValue = await counter.increment(5)  // 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```typescript
// Create two counters
const counter1 = await client.$.makeCounter(10)
const counter2 = await client.$.makeCounter(20)

// Pass counter1 to a method
const result = await client.$.addCounters(counter1, counter2)
console.log(result)  // 30
```

### Capability Lifecycle

Capabilities are automatically serialized when passed over RPC:

```typescript
// When you pass a capability...
await client.$.doSomething(counter)

// rpc.do converts it to: { $ref: counter.__capabilityId }
// The server knows to look up capability 1 and use that object
```

---

## Promise Pipelining

The killer feature inherited from capnweb. Chain dependent calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response:

```typescript
// BAD: Three round trips
const session = await api.authenticate(token)     // Wait...
const userId = await session.getUserId()          // Wait...
const profile = await api.getUserProfile(userId)  // Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```typescript
// GOOD: One round trip
const session = api.authenticate(token)           // RpcPromise
const userId = session.getUserId()                // RpcPromise (pipelined)
const profile = api.getUserProfile(userId)        // RpcPromise (pipelined)

// Only awaiting triggers the network request
const result = await profile
```

### How Pipelining Works

1. **Recording phase**: Method calls return `RpcPromise` objects without sending anything
2. **Batching**: When you `await`, rpc.do collects all recorded operations
3. **Single request**: Everything is sent as one batched request
4. **Server resolution**: The server evaluates dependencies and returns results

```typescript
const client = connect('wss://api.example.do')

// Build the pipeline (no network yet)
const auth = client.$.authenticate(token)
const user = auth.getUser()
const profile = user.profile
const settings = profile.settings

// Send and await (one round trip)
const result = await settings
```

### The Pipeline Builder

For complex pipelines with named intermediate results:

```typescript
const results = await client.pipeline()
  .call('authenticate', token)
  .as('session')
  .callOn('session', 'getUser')
  .as('user')
  .callOn('user', 'getProfile')
  .as('profile')
  .execute()

// Access named results
console.log(results.session)
console.log(results.user)
console.log(results.profile)
```

### Parallel Pipelines

Fork a pipeline to fetch multiple things at once:

```typescript
const client = connect('wss://api.example.do')

// Start with authentication
const session = client.$.authenticate(token)

// Branch into parallel requests (still one round trip!)
const [user, permissions, settings] = await Promise.all([
  session.getUser(),
  session.getPermissions(),
  session.getSettings()
])
```

---

## Server-Side Map

Transform collections on the server to avoid N+1 round trips.

### The N+1 Problem

```typescript
// BAD: N+1 round trips
const userIds = await client.$.listUserIds()  // 1 round trip
const profiles = []
for (const id of userIds) {
  profiles.push(await client.$.getProfile(id))  // N round trips
}
```

### The Solution: serverMap

```typescript
// GOOD: 1 round trip total
const userIds = await client.$.listUserIds()

const profiles = await client.serverMap(
  userIds,
  'id => self.getProfile(id)',
  { self: client.getSelf() }
)
```

### How serverMap Works

1. **Expression serialization**: Your lambda is converted to a string expression
2. **Capture list**: Referenced capabilities (like `self`) are sent along
3. **Server execution**: The server applies the expression to each array element
4. **Single response**: All results return in one response

### The RpcPromise.map() Method

For even cleaner syntax:

```typescript
// Get numbers and square them server-side
const squared = await client.$.generateFibonacci(10)
  .then(nums => client.serverMap(
    nums,
    'x => self.square(x)',
    { self: client.getSelf() }
  ))

console.log(squared)  // [0, 1, 1, 4, 9, 25, ...]
```

### Map Constraints

The map expression has restrictions:

| Allowed | Not Allowed |
|---------|-------------|
| Property access | Arbitrary code execution |
| Method calls on captured refs | Async operations |
| Simple expressions | Side effects |
| Captured capability refs | Local variables |

```typescript
// GOOD: Simple expression with captured ref
'x => self.transform(x)'

// GOOD: Property access
'user => user.profile.name'

// BAD: Arbitrary code (won't work)
'x => someLocalFunction(x)'

// BAD: Async (won't work)
'async x => await something(x)'
```

---

## Error Handling

rpc.do provides typed errors for different failure scenarios.

### Error Classes

```typescript
import {
  RpcError,
  ConnectionError,
  CapabilityError,
  TimeoutError
} from 'rpc.do'

try {
  await client.$.riskyOperation()
} catch (error) {
  if (error instanceof RpcError) {
    console.log('RPC failed:', error.message)
    console.log('Error code:', error.code)
    console.log('Extra data:', error.data)
  } else if (error instanceof ConnectionError) {
    console.log('Connection lost:', error.message)
  } else if (error instanceof CapabilityError) {
    console.log('Invalid capability:', error.capabilityId)
  } else if (error instanceof TimeoutError) {
    console.log('Request timed out')
  }
}
```

### Error Propagation

Errors from the server are deserialized and re-thrown:

```typescript
// Server code
class MyApi {
  riskyOperation() {
    throw new Error('Something went wrong')
  }
}

// Client code
try {
  await client.$.riskyOperation()
} catch (error) {
  // error.name === 'Error'
  // error.message === 'Something went wrong'
}
```

### Retry Patterns

Implement exponential backoff for transient failures:

```typescript
import { ConnectionError, TimeoutError } from 'rpc.do'

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Don't retry client errors
      if (error instanceof RpcError && error.code === 'VALIDATION_ERROR') {
        throw error
      }

      // Retry connection and timeout errors
      if (error instanceof ConnectionError || error instanceof TimeoutError) {
        const delay = baseDelay * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }

  throw lastError
}

// Usage
const result = await withRetry(() => client.$.users.get(123))
```

---

## TypeScript Integration

rpc.do is written in TypeScript and provides comprehensive type support.

### Generic Type Parameters

```typescript
import { connect, RpcClient } from 'rpc.do'

interface MyApi {
  greet(name: string): Promise<string>
  math: {
    add(a: number, b: number): Promise<number>
    multiply(a: number, b: number): Promise<number>
  }
}

// Type the entire client
const client: RpcClient<MyApi> = connect<MyApi>('wss://api.example.do')

// Or use the connect generic directly
const client = connect<MyApi>('wss://api.example.do')

// Full type inference
const greeting = await client.$.greet('World')  // string
const sum = await client.$.math.add(1, 2)       // number
```

### ServiceInterface Type Helper

Convert regular interfaces to RPC-compatible ones:

```typescript
import { ServiceInterface } from 'rpc.do'

// Regular interface (methods return direct values)
interface UserService {
  get(id: number): User
  list(): User[]
  create(data: CreateUser): User
}

// Convert to RPC interface (methods return Promises)
type UserServiceRpc = ServiceInterface<UserService>

// Equivalent to:
// interface UserServiceRpc {
//   get(id: number): Promise<User>
//   list(): Promise<User[]>
//   create(data: CreateUser): Promise<User>
// }
```

### Capability Types

Type your capabilities for full inference:

```typescript
interface Counter {
  value(): Promise<number>
  increment(by: number): Promise<number>
  decrement(by: number): Promise<number>
}

interface MyApi {
  makeCounter(initial: number): Promise<Counter>
}

const client = connect<MyApi>('wss://api.example.do')

// TypeScript knows counter is a Counter
const counter = await client.$.makeCounter(10)

// Full type checking on capability methods
const val = await counter.value()        // number
const newVal = await counter.increment(5) // number
```

### Type Guards

Check capability references at runtime:

```typescript
import { isCapabilityRef, CapabilityRef } from 'rpc.do'

const result = await client.$.getSomething()

if (isCapabilityRef(result)) {
  // result is CapabilityRef
  console.log('Got capability:', result.__capabilityId)
} else {
  // result is something else
  console.log('Got value:', result)
}
```

---

## RpcPromise

`RpcPromise` extends the standard Promise with pipelining capabilities.

### Creating RpcPromises

```typescript
import { RpcPromise, createRpcPromise } from 'rpc.do'

// RpcPromises are returned by client calls
const promise: RpcPromise<number> = client.$.square(5)

// Or create manually
const promise = createRpcPromise<number>(client, 'square', [5])
```

### Chaining with get()

Access properties on the eventual result:

```typescript
const userPromise = client.$.getUser(123)

// Get nested properties without awaiting
const namePromise = userPromise.get('name')
const emailPromise = userPromise.get('email')

// Await all at once
const [name, email] = await Promise.all([namePromise, emailPromise])
```

### Chaining with call()

Call methods on the eventual result:

```typescript
const userPromise = client.$.getUser(123)

// Call method on the result (without awaiting userPromise)
const formattedPromise = userPromise.call('formatDisplayName')

// The actual call happens when you await
const formatted = await formattedPromise
```

### Pipeline Operations

Track the operations in a pipeline:

```typescript
const promise = client.$.users.get(123)
  .get('profile')
  .call('format')

// Inspect the pipeline
console.log(promise.getPipelineOps())
// [
//   { type: 'get', property: 'profile' },
//   { type: 'call', method: 'format', args: [] }
// ]
```

---

## Connection Options

### Full Options Interface

```typescript
import { connect, ConnectOptions } from 'rpc.do'

const options: ConnectOptions = {
  // Authentication token (sent in WebSocket handshake)
  token: 'your-api-key',

  // Custom headers for the connection
  headers: {
    'X-Request-ID': crypto.randomUUID(),
    'X-Client-Version': '1.0.0'
  },

  // Connection timeout in milliseconds
  timeout: 30000,

  // Enable automatic reconnection
  autoReconnect: true
}

const client = connect('wss://api.example.do', options)
```

### Connection Lifecycle

```typescript
const client = connect('wss://api.example.do')

// Make calls
const result = await client.$.doSomething()

// Clean up
await client.close()
```

### Multiple Connections

Connect to multiple `.do` services simultaneously:

```typescript
import { connect } from 'rpc.do'

// Connect to different services
const mongo = connect('wss://mongo.do')
const kafka = connect('wss://kafka.do')
const cache = connect('wss://cache.do')

// Use them together
const users = await mongo.$.users.find({ active: true })

for (const user of users) {
  await kafka.$.events.publish('user.sync', user)
  await cache.$.users.set(user.id, user)
}

// Clean up all
await Promise.all([mongo.close(), kafka.close(), cache.close()])
```

---

## Testing

### Mock Server

Use the MockServer for unit tests:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { connect, RpcClient } from 'rpc.do'
import { MockServer } from 'rpc.do/tests/test-server'

describe('MyService', () => {
  let server: MockServer
  let client: RpcClient<unknown>

  beforeEach(() => {
    server = new MockServer()
    client = connect(server)
  })

  it('should call methods', async () => {
    const result = await client.$.square(5)
    expect(result).toBe(25)
  })

  it('should handle capabilities', async () => {
    const counter = await client.$.makeCounter(10)
    expect(counter.__capabilityId).toBeDefined()

    const value = await counter.value()
    expect(value).toBe(10)
  })
})
```

### Mocking the Client

For integration tests, mock the client:

```typescript
import { vi, describe, it, expect } from 'vitest'

// Mock the module
vi.mock('rpc.do', () => ({
  connect: vi.fn(() => ({
    $: new Proxy({}, {
      get: () => vi.fn().mockResolvedValue({ id: 1, name: 'Test' })
    }),
    close: vi.fn()
  }))
}))

import { connect } from 'rpc.do'
import { myFunction } from './my-code'

describe('myFunction', () => {
  it('should use the RPC client', async () => {
    const result = await myFunction()
    expect(result).toEqual({ id: 1, name: 'Test' })
  })
})
```

### Conformance Tests

The package includes conformance tests that verify behavior against the capnweb specification:

```bash
npm test
```

---

## Advanced Patterns

### Singleton Client

```typescript
import { connect, RpcClient } from 'rpc.do'

let client: RpcClient<MyApi> | null = null

export function getClient(): RpcClient<MyApi> {
  if (!client) {
    client = connect<MyApi>(process.env.API_URL!)
  }
  return client
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close()
    client = null
  }
}
```

### Request Context

Attach context to requests:

```typescript
import { connect } from 'rpc.do'

async function withContext<T>(
  fn: (client: RpcClient<MyApi>) => Promise<T>,
  context: { userId: string; requestId: string }
): Promise<T> {
  const client = connect<MyApi>('wss://api.example.do', {
    headers: {
      'X-User-ID': context.userId,
      'X-Request-ID': context.requestId
    }
  })

  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

// Usage
const result = await withContext(
  client => client.$.users.get(123),
  { userId: 'user_abc', requestId: crypto.randomUUID() }
)
```

### Capability Pools

Manage pools of capability references:

```typescript
import { CapabilityRef } from 'rpc.do'

class CapabilityPool<T extends CapabilityRef> {
  private pool: T[] = []
  private createFn: () => Promise<T>

  constructor(createFn: () => Promise<T>) {
    this.createFn = createFn
  }

  async acquire(): Promise<T> {
    if (this.pool.length > 0) {
      return this.pool.pop()!
    }
    return this.createFn()
  }

  release(capability: T): void {
    this.pool.push(capability)
  }
}

// Usage
const counterPool = new CapabilityPool(
  () => client.$.makeCounter(0)
)

const counter = await counterPool.acquire()
await counter.increment(5)
counterPool.release(counter)
```

### Middleware Pattern

Wrap calls with cross-cutting concerns:

```typescript
import { RpcClient, connect } from 'rpc.do'

type Middleware = (
  method: string,
  args: unknown[],
  next: () => Promise<unknown>
) => Promise<unknown>

function createClientWithMiddleware<T>(
  url: string,
  middleware: Middleware[]
): RpcClient<T> {
  const baseClient = connect<T>(url)

  // Wrap the call method
  const originalCall = baseClient.call.bind(baseClient)
  baseClient.call = async (method: string, ...args: unknown[]) => {
    const chain = middleware.reduceRight(
      (next, mw) => () => mw(method, args, next),
      () => originalCall(method, ...args)
    )
    return chain()
  }

  return baseClient
}

// Logging middleware
const loggingMiddleware: Middleware = async (method, args, next) => {
  console.log(`Calling ${method}`, args)
  const start = Date.now()
  try {
    const result = await next()
    console.log(`${method} completed in ${Date.now() - start}ms`)
    return result
  } catch (error) {
    console.error(`${method} failed:`, error)
    throw error
  }
}

// Metrics middleware
const metricsMiddleware: Middleware = async (method, args, next) => {
  const start = Date.now()
  try {
    const result = await next()
    recordMetric('rpc.success', { method, duration: Date.now() - start })
    return result
  } catch (error) {
    recordMetric('rpc.error', { method, duration: Date.now() - start })
    throw error
  }
}

// Usage
const client = createClientWithMiddleware<MyApi>(
  'wss://api.example.do',
  [loggingMiddleware, metricsMiddleware]
)
```

---

## API Reference

### Module Exports

```typescript
// Main entry point
export { connect } from 'rpc.do'

// Client classes
export { RpcClient, ConnectOptions, CapabilityRef } from 'rpc.do'

// Promise types
export { RpcPromise, PipelineBuilder, PipelineOp } from 'rpc.do'

// Proxy utilities
export {
  CapabilityProxy,
  createProxy,
  createCapabilityProxy,
  isCapabilityProxy,
  getCapabilityRef,
  getClient,
  typed
} from 'rpc.do'

// Map operations
export {
  serverMap,
  createServerMap,
  RpcRecorder,
  RpcReplayer,
  MapSpec,
  MapResult,
  MapOptions
} from 'rpc.do'

// Error types
export {
  RpcError,
  ConnectionError,
  CapabilityError,
  TimeoutError
} from 'rpc.do'

// Type helpers
export { ServiceInterface } from 'rpc.do'
```

### connect()

```typescript
function connect<T = unknown>(
  serverOrUrl: MockServer | string,
  options?: ConnectOptions
): RpcClient<T>
```

Create a new RPC client.

**Parameters:**
- `serverOrUrl` - WebSocket URL (`wss://` or `ws://`) or MockServer for testing
- `options` - Optional connection configuration

**Returns:** An `RpcClient<T>` instance

### RpcClient

```typescript
class RpcClient<T> {
  // Access the magic proxy
  get $(): T

  // Get self reference (capability ID 0)
  getSelf(): CapabilityRef

  // Make a raw RPC call
  call(method: string, ...args: unknown[]): Promise<unknown>

  // Call a method on a capability
  callOnCapability(
    capability: CapabilityRef | unknown,
    method: string,
    ...args: unknown[]
  ): Promise<unknown>

  // Start building a pipeline
  pipeline(): PipelineBuilder

  // Execute a pipeline
  executePipeline(steps: PipelineStep[]): Promise<Record<string, unknown>>

  // Server-side map operation
  serverMap(
    value: unknown,
    expression: string,
    captures: Record<string, unknown>
  ): Promise<unknown>

  // Call and map in one round trip
  callAndMap(
    method: string,
    args: unknown[],
    mapExpression: string,
    captures: Record<string, unknown>
  ): Promise<unknown>

  // Export a callback for server to call
  exportCallback(name: string, fn: (x: number) => number): void

  // Close the connection
  close(): Promise<void>
}
```

### RpcPromise

```typescript
class RpcPromise<T> extends Promise<T> {
  // Get a property from the result
  get<K extends keyof T>(key: K): RpcPromise<T[K]>

  // Call a method on the result
  call(method: string, ...args: unknown[]): RpcPromise<unknown>

  // Server-side map operation
  map<U>(fn: (item: T extends (infer I)[] ? I : T) => U): RpcPromise<U[]>

  // Get pipeline operations
  getPipelineOps(): PipelineOp[]

  // Get capability ID (if this promise represents a capability)
  getCapabilityId(): number | undefined

  // Create from a regular promise
  static from<T>(
    promise: Promise<T>,
    client: RpcClient<unknown>,
    ops?: PipelineOp[],
    capId?: number
  ): RpcPromise<T>
}
```

### PipelineBuilder

```typescript
class PipelineBuilder {
  // Add a method call
  call(method: string, ...args: unknown[]): this

  // Call on a named result
  callOn(targetName: string, method: string, ...args: unknown[]): this

  // Name the previous step's result
  as(name: string): this

  // Execute the pipeline
  execute(): Promise<Record<string, unknown> & { __last: unknown }>
}
```

### Error Classes

```typescript
class RpcError extends Error {
  readonly code: string
  readonly data?: unknown
}

class ConnectionError extends RpcError {
  // code === 'CONNECTION_ERROR'
}

class CapabilityError extends RpcError {
  // code === 'CAPABILITY_ERROR'
  readonly capabilityId?: number
}

class TimeoutError extends RpcError {
  // code === 'TIMEOUT_ERROR'
}
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```typescript
#!/usr/bin/env npx tsx
/**
 * Complete rpc.do example: A todo application with capabilities,
 * pipelining, server-side mapping, and error handling.
 */

import { connect, RpcError, CapabilityError } from 'rpc.do'

// ---- Type Definitions ----

interface User {
  id: number
  name: string
  email: string
}

interface Todo {
  id: number
  title: string
  done: boolean
  ownerId: number
}

interface TodoList {
  add(title: string): Promise<Todo>
  list(): Promise<Todo[]>
  get(id: number): Promise<Todo>
  complete(id: number): Promise<Todo>
  delete(id: number): Promise<void>
}

interface AuthenticatedSession {
  user: User
  todos: TodoList
}

interface TodoApi {
  authenticate(token: string): Promise<AuthenticatedSession>
  square(x: number): Promise<number>
  generateFibonacci(n: number): Promise<number[]>
}

// ---- Main Application ----

async function main() {
  const token = process.env.API_TOKEN || 'demo-token'

  console.log('Connecting to Todo API...\n')
  const client = connect<TodoApi>('wss://todo.example.do', {
    token,
    timeout: 30000
  })

  try {
    // ---- Pipelined Authentication ----
    console.log('1. Pipelined authentication (one round trip)')

    // These calls are pipelined - only one round trip!
    const session = client.$.authenticate(token)
    const userPromise = session.get('user')
    const todosPromise = session.get('todos')

    const [user, todos] = await Promise.all([userPromise, todosPromise])
    console.log(`   Welcome, ${user.name}!`)

    // ---- Capability Usage ----
    console.log('\n2. Using capabilities')

    // todos is a capability - we can call methods on it
    const allTodos = await todos.list()
    console.log(`   You have ${allTodos.length} todos`)

    // Create a new todo
    const newTodo = await todos.add('Learn rpc.do')
    console.log(`   Created: "${newTodo.title}" (id: ${newTodo.id})`)

    // ---- Server-Side Mapping ----
    console.log('\n3. Server-side mapping (eliminates N+1)')

    // Generate fibonacci numbers and square them - all server-side
    const fibs = await client.$.generateFibonacci(8)
    console.log(`   Fibonacci: [${fibs.join(', ')}]`)

    const squared = await client.serverMap(
      fibs,
      'x => self.square(x)',
      { self: client.getSelf() }
    )
    console.log(`   Squared:   [${squared.join(', ')}]`)

    // ---- Pipeline Builder ----
    console.log('\n4. Complex pipeline with named results')

    const results = await client.pipeline()
      .call('generateFibonacci', 5)
      .as('fibs')
      .call('square', 7)
      .as('squared')
      .execute()

    console.log(`   Fibs: [${results.fibs}]`)
    console.log(`   Squared: ${results.squared}`)

    // ---- Error Handling ----
    console.log('\n5. Error handling')

    try {
      await todos.get(99999)
    } catch (error) {
      if (error instanceof RpcError) {
        console.log(`   Expected error: ${error.code} - ${error.message}`)
      }
    }

    // ---- Cleanup ----
    console.log('\n6. Cleanup')

    await todos.delete(newTodo.id)
    console.log(`   Deleted todo ${newTodo.id}`)

    console.log('\nDone!')

  } catch (error) {
    if (error instanceof CapabilityError) {
      console.error('Capability error:', error.message)
    } else if (error instanceof RpcError) {
      console.error('RPC error:', error.message)
    } else {
      throw error
    }
  } finally {
    await client.close()
  }
}

main().catch(console.error)
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](https://npmjs.com/package/capnweb) | The underlying RPC protocol |
| [oauth.do](https://npmjs.com/package/oauth.do) | OAuth integration for `.do` services |
| [mongo.do](https://npmjs.com/package/mongo.do) | MongoDB client built on rpc.do |
| [kafka.do](https://npmjs.com/package/kafka.do) | Kafka client built on rpc.do |
| [database.do](https://npmjs.com/package/database.do) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Zero boilerplate** | No schemas, no codegen, no build step |
| **Magic when you want it** | `api.$.anything()` just works |
| **Types when you need them** | Full TypeScript support, optional |
| **One round trip** | Pipelining by default |
| **Familiar patterns** | Promises, async/await, standard errors |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
