# RpcStub

A proxy representing a remote `RpcTarget` or function.

## Overview

When you receive an object reference over RPC, you get an `RpcStub<T>`. The stub is a JavaScript Proxy that intercepts property access and method calls, forwarding them over RPC to the original object.

## Type Definition

```typescript
type RpcStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => RpcPromise<Awaited<R>>
    : RpcPromise<T[K]>
} & Disposable & {
  dup(): RpcStub<T>
  onRpcBroken(callback: (error: any) => void): void
}
```

## Basic Usage

```typescript
import { RpcStub } from 'capnweb'

interface Calculator {
  add(n: number): number
  getTotal(): number
}

// stub is an RpcStub<Calculator>
const stub: RpcStub<Calculator> = await api.createCalculator()

// Method calls go over RPC
await stub.add(5)
await stub.add(10)
const total = await stub.getTotal()  // 15
```

## Property Access

Reading properties from a stub returns `RpcPromise`:

```typescript
interface User {
  name: string
  email: string
  profile: Profile
}

const user: RpcStub<User> = await api.getUser(123)

// Properties return RpcPromise
const name: RpcPromise<string> = user.name
const actualName: string = await user.name

// Nested properties
const bio: string = await user.profile.bio
```

## Method Calls

All method calls return `RpcPromise`:

```typescript
// Original method returns string
interface Greeter {
  greet(name: string): string
}

const greeter: RpcStub<Greeter> = await api.getGreeter()

// Stub method returns RpcPromise<string>
const promise: RpcPromise<string> = greeter.greet('World')
const result: string = await promise
```

## Disposal

Stubs are disposable resources that should be cleaned up:

```typescript
// Using `using` declaration (recommended)
{
  using calc = await api.createCalculator()
  await calc.add(5)
}  // calc disposed automatically

// Manual disposal
const calc = await api.createCalculator()
try {
  await calc.add(5)
} finally {
  calc[Symbol.dispose]()
}
```

### What Disposal Does

1. Releases the remote object reference
2. Notifies the server that the client is done
3. Triggers the server-side `[Symbol.dispose]` method (if defined)
4. Prevents further calls on the stub

### Premature Disposal Warning

```typescript
const calc = await api.createCalculator()
calc[Symbol.dispose]()

// This will throw an error!
await calc.add(5)  // Error: Stub has been disposed
```

## Duplication

Use `dup()` to create a copy of a stub:

```typescript
const calc = await api.createCalculator()

// Create a duplicate
const calcCopy = calc.dup()

// Both are independent
calc[Symbol.dispose]()      // Original disposed
await calcCopy.add(5)       // Copy still works!
calcCopy[Symbol.dispose]()  // Now fully released
```

### When to Use `dup()`

1. **Passing to functions that dispose**: If a function will dispose its parameter
2. **Storing for later**: When you need to keep a reference while also passing it around
3. **Multiple owners**: When multiple parts of code need independent lifetimes

```typescript
async function processAndDispose(calc: RpcStub<Calculator>): Promise<number> {
  try {
    await calc.add(10)
    return await calc.getTotal()
  } finally {
    calc[Symbol.dispose]()  // This function disposes the stub
  }
}

// Keep a copy for yourself
const calc = await api.createCalculator()
const calcForFunction = calc.dup()

const result = await processAndDispose(calcForFunction)  // Function disposes its copy
await calc.add(5)  // Original still works
```

## Broken Stub Detection

Monitor a stub for disconnection or errors:

```typescript
const calc = await api.createCalculator()

calc.onRpcBroken((error) => {
  console.error('Calculator unavailable:', error)
  // Handle reconnection or cleanup
})

// Later, if the connection breaks...
// The callback is invoked with the error
```

### Reasons for Broken Stubs

- Connection lost (WebSocket closed)
- Session ended
- Remote object disposed
- Promise rejected (for promise-based stubs)

## Creating Stubs Locally

You can create a stub from a local `RpcTarget`:

```typescript
import { RpcStub, RpcTarget } from 'capnweb'

class Calculator extends RpcTarget {
  private total = 0
  add(n: number): number {
    return this.total += n
  }
}

// Create stub from local object
const calc = new Calculator()
const stub = new RpcStub(calc)

// Calls go directly to the local object
await stub.add(5)  // Works, but locally
```

### Use Cases for Local Stubs

1. **Testing**: Mock remote APIs locally
2. **Unified interface**: Treat local and remote objects the same
3. **Disposal management**: Track when an object is no longer needed

## Stub Proxy Behavior

Stubs are implemented as JavaScript Proxies:

```typescript
const stub: RpcStub<MyApi> = await api.getRemote()

// All property access returns RpcPromise
stub.anything        // RpcPromise<unknown>
stub.doesNotExist    // RpcPromise<unknown> (no runtime error)

// TypeScript helps, but runtime is permissive
// @ts-expect-error
stub.typo            // TypeScript error, but works at runtime
```

### Runtime vs Compile-Time

- **Runtime**: Stubs accept any property name
- **Compile-time**: TypeScript restricts to known properties
- **Error timing**: Errors occur when you `await` non-existent properties

```typescript
const result = stub.nonExistentMethod()  // No error here
await result                              // Error: method not found
```

## Stubs in Parameters

Stubs can be passed as RPC parameters:

```typescript
// Server
class Processor extends RpcTarget {
  async process(calc: RpcStub<Calculator>): Promise<number> {
    await calc.add(10)
    return await calc.getTotal()
  }
}

// Client
const calc = await api.createCalculator()
const result = await processor.process(calc)
```

### Ownership Rules

- **Caller keeps ownership**: The caller can still use the stub after the call
- **Callee gets a copy**: The callee's copy is auto-disposed when the call ends

## Stubs in Return Values

When a method returns an `RpcTarget`, the caller receives a stub:

```typescript
interface Api {
  createCalculator(): Calculator
}

// Returns RpcStub<Calculator>, not Calculator
const calc: RpcStub<Calculator> = await api.createCalculator()
```

### Ownership Transfer

- The caller owns the returned stub
- The caller is responsible for disposal

## Type Utilities

```typescript
import type { RpcStub, UnwrapStub } from 'capnweb'

// Get the underlying type from a stub type
type Calc = UnwrapStub<RpcStub<Calculator>>  // Calculator

// Check if something is a stub
function isStub(value: unknown): value is RpcStub<unknown> {
  return value && typeof value === 'object' && Symbol.dispose in value
}
```
