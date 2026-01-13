# Serializable Types

Types that can be passed by value over RPC.

## Overview

When passing data over RPC, Cap'n Web serializes values to JSON with some enhancements. This page describes which types are supported and how they're handled.

## Supported Types

### Primitives

| Type | Example | Notes |
|------|---------|-------|
| `string` | `"hello"` | UTF-8 encoded |
| `number` | `42`, `3.14` | IEEE 754 double |
| `boolean` | `true`, `false` | |
| `null` | `null` | |
| `undefined` | `undefined` | Converted to `null` in some contexts |

```typescript
class Api extends RpcTarget {
  echo(value: string | number | boolean | null): any {
    return value
  }
}
```

### bigint

Large integers are supported:

```typescript
class Api extends RpcTarget {
  processLargeNumber(n: bigint): bigint {
    return n * 2n
  }
}

// Client
const result = await api.processLargeNumber(9007199254740993n)
```

### Date

Date objects are serialized as ISO strings and reconstructed:

```typescript
class Api extends RpcTarget {
  getTimestamp(): Date {
    return new Date()
  }

  processDate(date: Date): string {
    return date.toLocaleDateString()
  }
}

// Client
const date = await api.getTimestamp()  // Date object
```

### Uint8Array

Binary data is supported via Uint8Array:

```typescript
class Api extends RpcTarget {
  processBinary(data: Uint8Array): Uint8Array {
    // Manipulate binary data
    return new Uint8Array(data.map(b => b + 1))
  }
}

// Client
const result = await api.processBinary(new Uint8Array([1, 2, 3]))
// result: Uint8Array [2, 3, 4]
```

### Error

Error objects preserve their type and message:

```typescript
class Api extends RpcTarget {
  getError(): Error {
    return new TypeError('Expected string')
  }
}

// Client
const error = await api.getError()
error instanceof TypeError  // true
error.message              // "Expected string"
```

Supported error types:
- `Error`
- `TypeError`
- `RangeError`
- `ReferenceError`
- `SyntaxError`
- `URIError`

### Plain Objects

Plain objects (from object literals) are serialized:

```typescript
class Api extends RpcTarget {
  getUser(): { id: number; name: string } {
    return { id: 1, name: 'Alice' }
  }
}
```

### Arrays

Arrays and their contents are serialized:

```typescript
class Api extends RpcTarget {
  getNumbers(): number[] {
    return [1, 2, 3, 4, 5]
  }

  getUsers(): Array<{ id: number; name: string }> {
    return [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]
  }
}
```

## Pass-by-Reference Types

These types are NOT serialized. Instead, a stub reference is created:

### RpcTarget

Classes extending `RpcTarget` are passed by reference:

```typescript
class Calculator extends RpcTarget {
  add(n: number): number { /*...*/ }
}

class Api extends RpcTarget {
  createCalculator(): Calculator {
    return new Calculator()  // Passed by reference
  }
}

// Client receives RpcStub<Calculator>, not Calculator
const calc = await api.createCalculator()
```

### Functions

Functions are passed by reference:

```typescript
class Api extends RpcTarget {
  subscribe(callback: (message: string) => void): void {
    // callback is actually RpcStub<(message: string) => void>
    callback('Hello!')  // RPC call back to client
  }
}

// Client
await api.subscribe((msg) => console.log(msg))
```

## Unsupported Types

### Class Instances

Non-RpcTarget class instances are NOT supported:

```typescript
class User {
  constructor(public name: string) {}
}

class Api extends RpcTarget {
  // WRONG: User is not an RpcTarget
  getUser(): User {
    return new User('Alice')  // Error or unexpected behavior
  }

  // CORRECT: Return plain object
  getUser(): { name: string } {
    return { name: 'Alice' }
  }
}
```

### Cyclic References

Cyclic/circular references are NOT supported:

```typescript
const obj: any = { name: 'Alice' }
obj.self = obj  // Circular reference

class Api extends RpcTarget {
  // WRONG: Will throw an error
  getCyclic(): any {
    return obj
  }
}
```

### Map and Set

Currently NOT supported (may be added in future):

```typescript
class Api extends RpcTarget {
  // WRONG: Map not supported
  getData(): Map<string, number> {
    return new Map([['a', 1]])
  }

  // CORRECT: Use plain object
  getData(): Record<string, number> {
    return { a: 1 }
  }

  // WRONG: Set not supported
  getIds(): Set<number> {
    return new Set([1, 2, 3])
  }

  // CORRECT: Use array
  getIds(): number[] {
    return [1, 2, 3]
  }
}
```

### Other TypedArrays

Only `Uint8Array` is currently supported:

```typescript
class Api extends RpcTarget {
  // WRONG: Float32Array not supported
  getFloats(): Float32Array {
    return new Float32Array([1.0, 2.0])
  }

  // CORRECT: Use regular array or Uint8Array
  getFloats(): number[] {
    return [1.0, 2.0]
  }
}
```

### Streams

`ReadableStream` and `WritableStream` are NOT currently supported (may be added):

```typescript
class Api extends RpcTarget {
  // NOT supported yet
  streamData(): ReadableStream {
    return new ReadableStream({/*...*/})
  }

  // WORKAROUND: Use callbacks
  async streamData(onChunk: (chunk: Uint8Array) => void): Promise<void> {
    for await (const chunk of dataSource) {
      onChunk(chunk)
    }
  }
}
```

## Type Coercion

### undefined to null

`undefined` may be converted to `null` in JSON:

```typescript
class Api extends RpcTarget {
  getValue(): string | undefined {
    return undefined
  }
}

// Client might receive null
const value = await api.getValue()  // null
```

### Number Precision

Numbers are IEEE 754 doubles, limited to ~15 significant digits:

```typescript
// Use bigint for large integers
const big = 9007199254740993  // Loses precision as number
const bigSafe = 9007199254740993n  // bigint preserves precision
```

### Object Property Order

JSON doesn't guarantee property order, but most implementations preserve it:

```typescript
// Order usually preserved, but don't depend on it
const obj = { z: 1, a: 2, m: 3 }
```

## Serialization Format

Cap'n Web uses enhanced JSON:

```typescript
// Standard JSON values pass through
{ "name": "Alice", "age": 30 }

// Special types use wrapper format
{
  "$type": "bigint",
  "value": "9007199254740993"
}

{
  "$type": "Date",
  "value": "2024-01-15T12:00:00.000Z"
}

{
  "$type": "Uint8Array",
  "value": "SGVsbG8="  // Base64
}

// References to RpcTargets
{
  "$type": "ref",
  "id": 42
}
```

## Custom Serialization

For complex types, serialize/deserialize manually:

```typescript
interface UserDTO {
  id: number
  name: string
  createdAt: string  // ISO date string
}

class Api extends RpcTarget {
  getUser(): UserDTO {
    const user = database.getUser()
    return {
      id: user.id,
      name: user.name,
      createdAt: user.createdAt.toISOString()
    }
  }
}

// Client
const dto = await api.getUser()
const user = {
  ...dto,
  createdAt: new Date(dto.createdAt)
}
```

## Best Practices

### 1. Use Plain Data Types

```typescript
// GOOD: Plain types
interface UserData {
  id: number
  name: string
  email: string
}

// AVOID: Class instances
class User {
  constructor(public id: number, public name: string) {}
}
```

### 2. Return DTOs, Not Entities

```typescript
class Api extends RpcTarget {
  // GOOD: Return plain object
  getUser(id: number): UserDTO {
    const entity = this.userRepository.find(id)
    return {
      id: entity.id,
      name: entity.name,
      email: entity.email
    }
  }
}
```

### 3. Validate Input Types

```typescript
import { z } from 'zod'

const UserInputSchema = z.object({
  name: z.string(),
  email: z.string().email()
})

class Api extends RpcTarget {
  createUser(input: unknown): User {
    const validated = UserInputSchema.parse(input)
    return this.userService.create(validated)
  }
}
```
