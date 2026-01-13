# Core Concepts

Understanding these fundamental concepts will help you use Cap'n Web effectively.

## RpcTarget

`RpcTarget` is the base class for objects that can be passed **by reference** over RPC. When you send an `RpcTarget` instance over RPC, the recipient receives a stub that calls back to the original object.

```typescript
import { RpcTarget } from 'capnweb'

class Calculator extends RpcTarget {
  private total = 0

  add(n: number): number {
    this.total += n
    return this.total
  }

  getTotal(): number {
    return this.total
  }
}
```

### What Gets Exposed

- **Class methods**: Available via RPC
- **Getters**: Available via RPC
- **Instance properties**: NOT exposed (this is intentional for security)
- **`#` private methods**: Never exposed

```typescript
class Example extends RpcTarget {
  publicProperty = 'visible locally'      // NOT exposed via RPC
  private tsPrivate = 'visible locally'   // NOT exposed via RPC (but TS-only)

  publicMethod() { }                       // Exposed via RPC
  private tsPrivateMethod() { }            // EXPOSED via RPC (TS annotation only!)
  #jsPrivateMethod() { }                   // NOT exposed via RPC (true JS private)
}
```

::: warning
TypeScript's `private` keyword does NOT prevent RPC access. Use `#` prefix for true privacy.
:::

## RpcStub

An `RpcStub<T>` is a proxy representing a remote `RpcTarget`. When you receive an object reference over RPC, you get a stub.

```typescript
import { RpcStub } from 'capnweb'

// The stub looks like the original type
const calculator: RpcStub<Calculator> = await api.getCalculator()

// Method calls go over RPC
await calculator.add(5)    // RPC call
await calculator.add(10)   // RPC call
const total = await calculator.getTotal()  // 15
```

### Stub Behavior

- All property accesses and method calls return `RpcPromise`
- You must `await` to get actual values
- Stubs don't know which properties exist at runtime (TypeScript helps here)

```typescript
// Reading a property requires await
const value = await stub.someProperty

// Even if the original was synchronous, the stub is async
const result = await stub.syncMethod()
```

## RpcPromise

`RpcPromise<T>` is Cap'n Web's enhanced Promise that enables promise pipelining.

```typescript
import { RpcPromise } from 'capnweb'

// RpcPromise acts like a regular Promise
const userPromise: RpcPromise<User> = api.getUser(123)
const user = await userPromise  // Works like normal

// But also acts as a stub for the eventual value
const namePromise = userPromise.name  // No await needed!
const name = await namePromise        // Gets the name
```

### Promise Pipelining

The key feature of `RpcPromise` is that you can use it before awaiting:

```typescript
// All of this happens in ONE round trip
const user = api.getUser(123)           // RpcPromise<User>
const profile = api.getProfile(user.id) // user.id is an RpcPromise<number>
const result = await profile            // Only now does the request happen
```

See [Promise Pipelining](/guide/promise-pipelining) for detailed explanation.

## Pass-by-Value Types

These types are serialized and copied when sent over RPC:

| Type | Notes |
|------|-------|
| `string`, `number`, `boolean` | Primitives |
| `null`, `undefined` | Null values |
| `bigint` | Large integers |
| `Date` | Serialized as ISO string |
| `Uint8Array` | Binary data |
| `Error` | Error messages preserved |
| Plain objects `{}` | Copied by value |
| Arrays `[]` | Copied by value |

## Pass-by-Reference Types

These types create stubs when sent over RPC:

| Type | Notes |
|------|-------|
| `RpcTarget` subclasses | Main way to pass objects by reference |
| Functions | Become callable stubs |

```typescript
// Function passed by reference
await api.subscribe((message: string) => {
  console.log('Received:', message)
})
// The server can now call this function!
```

## Sessions

A session represents a connection between client and server.

### HTTP Batch Session

Short-lived, request-response pattern:

```typescript
using session = newHttpBatchRpcSession<MyApi>('https://api.example.com')

// All calls before await are batched
const a = session.methodA()
const b = session.methodB()
const [resultA, resultB] = await Promise.all([a, b])  // One HTTP request
```

### WebSocket Session

Long-lived, persistent connection:

```typescript
using session = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Connection stays open
await session.methodA()
// ... later ...
await session.methodB()
```

### Session Lifecycle

```typescript
// Option 1: using statement (automatic cleanup)
using session = newWebSocketRpcSession<MyApi>(url)
// Session disposed when leaving scope

// Option 2: Manual disposal
const session = newWebSocketRpcSession<MyApi>(url)
// ... use session ...
session[Symbol.dispose]()  // Close connection
```

## Disposal and Cleanup

Remote resources need explicit cleanup because garbage collection doesn't work across network boundaries.

```typescript
// Stubs should be disposed when done
using calculator = await api.getCalculator()
await calculator.add(5)
// Calculator disposed automatically at end of scope

// Or manually:
const calc = await api.getCalculator()
try {
  await calc.add(5)
} finally {
  calc[Symbol.dispose]()
}
```

### Automatic Disposal Rules

1. **Params**: Stubs in call parameters are disposed when the call completes
2. **Returns**: Stubs in return values are disposed when the caller disposes them
3. **Sessions**: Closing a session disposes all stubs from that session

See [Resource Management](/guide/resource-management) for detailed rules.

## Error Handling

Errors from remote calls are delivered as rejected promises:

```typescript
try {
  await api.riskyOperation()
} catch (error) {
  // Error from server, with stack trace preserved
  console.error('Remote error:', error.message)
}
```

See [Error Handling](/guide/error-handling) for patterns and best practices.
