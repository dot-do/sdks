# Resource Management

Remote resources need explicit cleanup because garbage collection doesn't work across network boundaries. This guide explains Cap'n Web's disposal system.

## Why Disposal Matters

Local garbage collection can't detect when remote resources are unreachable:

```typescript
// Problem: Server doesn't know when client is done with this
const calculator = await api.getCalculator()
calculator = null  // Local GC will clean up the stub, but...
// Server still holds the Calculator object in memory!
```

## The Disposal System

Cap'n Web uses JavaScript's [Explicit Resource Management](https://v8.dev/features/explicit-resource-management) for cleanup.

### Using `using` Declarations

The `using` keyword automatically disposes resources when they go out of scope:

```typescript
{
  using calculator = await api.getCalculator()
  await calculator.add(5)
  await calculator.add(10)
}  // calculator is automatically disposed here
```

### Manual Disposal

Without `using`, call `Symbol.dispose` explicitly:

```typescript
const calculator = await api.getCalculator()
try {
  await calculator.add(5)
} finally {
  calculator[Symbol.dispose]()
}
```

## Ownership Rules

Cap'n Web follows clear ownership rules for stubs:

### Rule 1: Caller Owns All Stubs

The caller is responsible for disposing all stubs:

```typescript
// You called getCalculator, you own the result
using calculator = await api.getCalculator()
```

### Rule 2: Parameters Are Borrowed

Stubs passed as parameters are "borrowed" - the callee doesn't own them:

```typescript
// Server
class MyApi extends RpcTarget {
  async processCalculator(calc: Calculator) {
    // calc is automatically disposed when this method returns
    // Don't store it for later use!
    return await calc.getTotal()
  }
}

// Client
const calculator = await api.getCalculator()
await api.processCalculator(calculator)  // Passed to server
// calculator still works here - you still own it
await calculator.add(5)
```

### Rule 3: Return Values Transfer Ownership

When you return a stub, ownership transfers to the caller:

```typescript
// Server
class MyApi extends RpcTarget {
  getCalculator(): Calculator {
    return new Calculator()  // Ownership transfers to caller
  }
}

// Client
using calc = await api.getCalculator()  // You now own it
```

## Disposing RpcPromise

`RpcPromise` instances also need disposal if you don't await them:

```typescript
// If you start a call but don't need the result
{
  using userPromise = api.getUser(123)
  // userPromise disposed at end of scope
}

// Or manually
const userPromise = api.getUser(123)
userPromise[Symbol.dispose]()  // Cancels the pending call
```

## Stub Duplication

Use `dup()` to create copies of stubs when you need multiple owners:

```typescript
const calculator = await api.getCalculator()

// Create a duplicate
const calculatorCopy = calculator.dup()

// Now both need to be disposed
calculator[Symbol.dispose]()     // Original disposed
await calculatorCopy.add(5)      // Copy still works!
calculatorCopy[Symbol.dispose]() // Now the resource is released
```

### When to Use `dup()`

- Passing a stub to a function that will dispose it
- Storing a stub for later use while also passing it around
- Creating multiple references to the same remote object

```typescript
// Pass to function but keep for yourself
const calc = await api.getCalculator()
const calcForFunction = calc.dup()

await someFunction(calcForFunction)  // Function may dispose it
await calc.add(5)  // Original still works
```

## Session Disposal

Disposing a session disposes all stubs from that session:

```typescript
{
  using api = newWebSocketRpcSession<MyApi>('wss://example.com')
  const calc = await api.getCalculator()
  const user = await api.getUser(123)
  // When api is disposed, calc and user are also disposed
}
```

## Listening for Disposal

Your `RpcTarget` can implement cleanup logic:

```typescript
class DatabaseConnection extends RpcTarget {
  private connection: Connection

  constructor() {
    super()
    this.connection = createConnection()
  }

  // Called when stub is disposed
  [Symbol.dispose]() {
    this.connection.close()
    console.log('Connection cleaned up')
  }

  query(sql: string) {
    return this.connection.query(sql)
  }
}
```

## Monitoring Broken Connections

Use `onRpcBroken` to detect when stubs become unusable:

```typescript
const calculator = await api.getCalculator()

calculator.onRpcBroken((error) => {
  console.error('Calculator unavailable:', error)
  // Clean up local state
})
```

This fires when:
- The underlying connection is lost
- The stub was explicitly disposed
- The remote object was garbage collected (if supported)

## Best Practices

### 1. Always Use `using` When Possible

```typescript
// GOOD
using stub = await api.getResource()

// Also good for short-lived operations
{
  using api = newWebSocketRpcSession<MyApi>(url)
  await api.doSomething()
}
```

### 2. Don't Store Borrowed Stubs

```typescript
// BAD: Storing a parameter
class MyApi extends RpcTarget {
  private savedCalc?: Calculator

  processCalculator(calc: Calculator) {
    this.savedCalc = calc  // WRONG! calc will be disposed
  }
}

// GOOD: Duplicate if you need to store
class MyApi extends RpcTarget {
  private savedCalc?: Calculator

  processCalculator(calc: Calculator) {
    this.savedCalc = calc.dup()
  }
}
```

### 3. Dispose Unused Promises

```typescript
// If you pipeline but don't need intermediate results
const user = api.getUser(123)
const posts = await api.getPosts(user.id)
user[Symbol.dispose]()  // Don't need user object, just its ID
```

### 4. Clean Up in Error Handlers

```typescript
let api: RpcStub<MyApi> | undefined

try {
  api = newWebSocketRpcSession<MyApi>(url)
  await api.doSomething()
} catch (error) {
  console.error(error)
} finally {
  api?.[Symbol.dispose]()
}
```

## Memory Leak Prevention

Common causes of memory leaks:

1. **Not disposing long-lived sessions**: Always dispose WebSocket sessions when done
2. **Storing borrowed stubs**: Use `dup()` if you need to keep a reference
3. **Forgotten promises**: Dispose `RpcPromise` instances you don't await
4. **Circular references**: Avoid creating cycles between local and remote objects

```typescript
// Potential leak: circular reference
class ClientCallback extends RpcTarget {
  constructor(private api: RpcStub<ServerApi>) {
    super()
    // Now callback references api, and server may reference callback
  }
}
```
