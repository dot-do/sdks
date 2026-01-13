# RpcPromise

An enhanced Promise that enables promise pipelining.

## Overview

`RpcPromise<T>` is the key to Cap'n Web's promise pipelining feature. It acts both as a Promise (can be awaited) and as a stub for the eventual value (can access properties and call methods without awaiting).

## Type Definition

```typescript
type RpcPromise<T> = Promise<T> & RpcStub<T> & {
  map<U>(mapper: (value: RpcPromise<T extends (infer E)[] ? E : T>) => U): RpcPromise<T extends any[] ? U[] : U>
}
```

## Basic Usage

```typescript
// RpcPromise can be used like a regular Promise
const userPromise: RpcPromise<User> = api.getUser(123)
const user: User = await userPromise

// But it can also be used as a stub
const namePromise: RpcPromise<string> = userPromise.name
const name: string = await namePromise
```

## Promise Pipelining

The main feature of `RpcPromise` is using it before awaiting:

```typescript
// Traditional: 2 round trips
const user = await api.getUser(123)        // Round trip 1
const profile = await api.getProfile(user.id)  // Round trip 2

// Pipelined: 1 round trip
const user = api.getUser(123)              // RpcPromise<User>
const profile = await api.getProfile(user.id)  // Uses user.id as RpcPromise
```

### How It Works

1. `api.getUser(123)` returns an `RpcPromise<User>` immediately
2. `user.id` returns an `RpcPromise<number>` (property access on promise)
3. `api.getProfile(user.id)` accepts the promise as a parameter
4. Both calls are sent together; server resolves dependencies

## Property Access

Accessing properties on an `RpcPromise` returns another `RpcPromise`:

```typescript
interface User {
  id: number
  name: string
  address: Address
}

const user: RpcPromise<User> = api.getUser(123)

const id: RpcPromise<number> = user.id
const name: RpcPromise<string> = user.name
const city: RpcPromise<string> = user.address.city  // Chained access
```

## Method Calls

Calling methods on an `RpcPromise` works similarly:

```typescript
interface Calculator {
  add(n: number): Calculator
  getTotal(): number
}

const calc: RpcPromise<Calculator> = api.createCalculator()

// Chain method calls
const result: RpcPromise<number> = calc.add(5).add(10).getTotal()
const total: number = await result  // Single round trip for all calls
```

## Using Promises as Parameters

`RpcPromise<T>` can be used anywhere `T` is expected in RPC calls:

```typescript
interface Api {
  getUser(id: number): User
  getProfile(userId: number): Profile
  formatProfile(profile: Profile): string
}

const user = api.getUser(123)           // RpcPromise<User>
const profile = api.getProfile(user.id) // user.id is RpcPromise<number>
const text = await api.formatProfile(profile)  // profile is RpcPromise<Profile>

// All three calls happen in one round trip!
```

## The `map()` Method

`RpcPromise` has a special `map()` method for transforming arrays on the server:

```typescript
const idsPromise: RpcPromise<number[]> = api.listUserIds()

// Map over the array - runs on server!
const profiles = await idsPromise.map(id => api.getProfile(id))
// profiles is Profile[]
```

### How `map()` Works

1. Your callback is recorded (not executed yet)
2. The recording is sent to the server
3. Server applies the callback to each array element
4. Results are returned in one response

### `map()` Restrictions

```typescript
// The callback receives RpcPromise, not the actual value
const results = await ids.map((id: RpcPromise<number>) => {
  // WRONG: Can't do math on RpcPromise
  return id + 1

  // CORRECT: Use id in RPC calls
  return api.getById(id)
})
```

### `map()` on Non-Arrays

`map()` also works on nullable values:

```typescript
const maybeUser: RpcPromise<User | null> = api.findUser(email)

// If null, returns null. Otherwise, transforms.
const maybeName = await maybeUser.map(user => user.name)
// maybeName is string | null
```

## Disposal

`RpcPromise` is disposable:

```typescript
const user = api.getUser(123)

// If you don't need the result, dispose it
user[Symbol.dispose]()

// This tells the server not to send the result
// and may cancel the operation
```

### When to Dispose Promises

1. **Unused pipelined results**: If you only need intermediate values for pipelining
2. **Cancellation**: To cancel a pending operation
3. **Cleanup**: In error handlers or early returns

```typescript
const user = api.getUser(123)
const profile = await api.getProfile(user.id)

// We only needed user.id, not the full user
user[Symbol.dispose]()
```

## Promise Methods

`RpcPromise` supports all standard Promise methods:

```typescript
const user = api.getUser(123)

// then/catch/finally
user
  .then(u => console.log(u.name))
  .catch(err => console.error(err))
  .finally(() => console.log('done'))

// Thenable in Promise.all
const [user1, user2] = await Promise.all([
  api.getUser(1),
  api.getUser(2)
])

// Promise.race, Promise.any, etc.
const fastest = await Promise.race([
  api.getFromCache(id),
  api.getFromDatabase(id)
])
```

## Type Narrowing

TypeScript knows the resolved type:

```typescript
const userPromise: RpcPromise<User> = api.getUser(123)

// TypeScript knows name is RpcPromise<string>
const name = userPromise.name

// After await, TypeScript knows it's string
const resolvedName: string = await name
```

## Combining with Regular Promises

`RpcPromise` works seamlessly with regular Promises:

```typescript
// Mix RpcPromise and regular Promise
const [user, config] = await Promise.all([
  api.getUser(123),           // RpcPromise
  fetch('/config').then(r => r.json())  // Regular Promise
])
```

## Error Handling

Errors propagate through pipelined calls:

```typescript
const user = api.getUser(invalidId)      // Will fail
const profile = api.getProfile(user.id)  // Never executes

try {
  await profile
} catch (error) {
  // Error from getUser propagates here
}
```

## Best Practices

### 1. Delay Awaits for Pipelining

```typescript
// GOOD: Pipelined
const user = api.getUser(123)
const profile = await api.getProfile(user.id)

// BAD: Not pipelined
const user = await api.getUser(123)  // Too early!
const profile = await api.getProfile(user.id)
```

### 2. Use Promise.all for Multiple Results

```typescript
const user = api.getUser(123)
const [name, email, profile] = await Promise.all([
  user.name,
  user.email,
  api.getProfile(user.id)
])
```

### 3. Dispose Unused Promises

```typescript
const user = api.getUser(123)
try {
  await api.getProfile(user.id)
} finally {
  user[Symbol.dispose]()  // Clean up
}
```

### 4. Use `map()` for Array Operations

```typescript
// GOOD: Single round trip
const profiles = await api.listIds().map(id => api.getProfile(id))

// BAD: Multiple round trips
const ids = await api.listIds()
const profiles = await Promise.all(ids.map(id => api.getProfile(id)))
```
