# RpcTarget

The base class for objects that can be passed by reference over RPC.

## Overview

`RpcTarget` is a marker class that tells Cap'n Web: "Instances of this class should be passed by reference, not by value." When an `RpcTarget` is sent over RPC, the recipient receives a stub that calls back to the original object.

## Basic Usage

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

// When passed over RPC, Calculator instances become stubs
class MyApi extends RpcTarget {
  createCalculator(): Calculator {
    return new Calculator()  // Returned by reference
  }
}
```

## What Gets Exposed

### Class Methods

All class methods (defined on the prototype) are accessible via RPC:

```typescript
class Example extends RpcTarget {
  publicMethod(): string {
    return 'accessible via RPC'
  }
}
```

### Getters

Property getters are accessible via RPC:

```typescript
class Example extends RpcTarget {
  get value(): number {
    return 42  // accessible via RPC
  }
}

// Client
const value = await stub.value  // 42
```

### Setters

Property setters are NOT directly accessible. Use methods instead:

```typescript
class Example extends RpcTarget {
  private _value = 0

  // WRONG: Setters don't work over RPC
  set value(v: number) {
    this._value = v
  }

  // CORRECT: Use a method
  setValue(v: number): void {
    this._value = v
  }
}
```

## What's NOT Exposed

### Instance Properties

Properties defined on `this` (own properties) are NOT exposed:

```typescript
class Example extends RpcTarget {
  publicProperty = 'hidden from RPC'  // NOT exposed

  constructor() {
    super()
    this.anotherProperty = 'also hidden'  // NOT exposed
  }
}
```

This is intentional for security - private data stored as instance properties stays private.

### TypeScript `private`

TypeScript's `private` keyword does NOT hide methods from RPC:

```typescript
class Example extends RpcTarget {
  // WARNING: Still accessible via RPC!
  private sensitiveMethod(): string {
    return this.secret
  }
}
```

TypeScript's `private` is only a compile-time check that's erased at runtime.

### JavaScript `#` Private

True JavaScript private methods (using `#` prefix) are NOT accessible:

```typescript
class Example extends RpcTarget {
  // Truly hidden from RPC
  #privateMethod(): string {
    return 'cannot be called via RPC'
  }

  publicMethod(): string {
    return this.#privateMethod()  // Only callable locally
  }
}
```

## Disposal

`RpcTarget` instances can implement disposal logic:

```typescript
class Connection extends RpcTarget {
  private socket: WebSocket

  constructor(url: string) {
    super()
    this.socket = new WebSocket(url)
  }

  // Called when all stubs pointing to this object are disposed
  [Symbol.dispose](): void {
    this.socket.close()
    console.log('Connection cleaned up')
  }

  send(message: string): void {
    this.socket.send(message)
  }
}
```

### When Disposal Occurs

The `[Symbol.dispose]` method is called when:

1. All stubs pointing to the object are disposed
2. The RPC session is closed
3. The object is explicitly disposed

### Multiple Stubs

If you pass the same object multiple times, multiple stubs are created:

```typescript
const conn = new Connection(url)

// Two stubs pointing to same object
const stub1 = await api.getConnection()  // Returns conn
const stub2 = await api.getConnection()  // Returns same conn

stub1[Symbol.dispose]()  // conn.dispose NOT called yet
stub2[Symbol.dispose]()  // NOW conn.dispose is called
```

To avoid multiple disposal calls, create a single stub upfront:

```typescript
import { RpcStub } from 'capnweb'

const conn = new Connection(url)
const stub = new RpcStub(conn)  // Single stub

// Return the same stub
class MyApi extends RpcTarget {
  getConnection(): RpcStub<Connection> {
    return stub  // Same stub returned each time
  }
}
```

## Inheritance

`RpcTarget` can be extended with inheritance:

```typescript
class BaseApi extends RpcTarget {
  baseMethod(): string {
    return 'from base'
  }
}

class ExtendedApi extends BaseApi {
  extendedMethod(): string {
    return 'from extended'
  }
}

// Both methods accessible via RPC
const api = new ExtendedApi()
await stub.baseMethod()      // Works
await stub.extendedMethod()  // Works
```

## Async Methods

Methods can be synchronous or asynchronous:

```typescript
class DataService extends RpcTarget {
  // Sync method
  getValue(): number {
    return 42
  }

  // Async method
  async fetchData(): Promise<Data> {
    return await database.query(...)
  }
}
```

From the client's perspective, all methods are async (return promises).

## Error Handling

Errors thrown in RpcTarget methods are sent to the caller:

```typescript
class MyApi extends RpcTarget {
  riskyOperation(): void {
    throw new Error('Something went wrong')
  }
}

// Client
try {
  await api.riskyOperation()
} catch (error) {
  console.error(error.message)  // "Something went wrong"
}
```

## Workers Compatibility

On Cloudflare Workers, Cap'n Web's `RpcTarget` is aliased to the built-in `RpcTarget`:

```typescript
// These are the same on Workers
import { RpcTarget } from 'capnweb'
// Equivalent to: import { RpcTarget } from 'cloudflare:workers'
```

This allows seamless interoperability between Cap'n Web and Workers RPC.

## Best Practices

### 1. Use `#` for True Privacy

```typescript
class SecureApi extends RpcTarget {
  #secret = 'hidden'

  #internalMethod(): void {
    // Cannot be called via RPC
  }

  publicMethod(): string {
    this.#internalMethod()
    return 'result'
  }
}
```

### 2. Keep State in Instance Properties

```typescript
class StatefulApi extends RpcTarget {
  // Hidden from RPC
  private userId: number

  constructor(userId: number) {
    super()
    this.userId = userId
  }

  // Methods can access private state
  getMyProfile(): Profile {
    return getProfile(this.userId)
  }
}
```

### 3. Return New RpcTargets for Sub-APIs

```typescript
class MainApi extends RpcTarget {
  authenticate(token: string): AuthenticatedApi {
    const user = validateToken(token)
    return new AuthenticatedApi(user)  // New capability
  }
}

class AuthenticatedApi extends RpcTarget {
  constructor(private user: User) {
    super()
  }

  // Only authenticated users can call this
  sensitiveOperation(): void {
    // ...
  }
}
```

### 4. Implement Disposal for Resources

```typescript
class ResourceHolder extends RpcTarget {
  private resource: Resource

  [Symbol.dispose](): void {
    this.resource.release()
  }
}
```
