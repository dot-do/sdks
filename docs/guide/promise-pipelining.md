# Promise Pipelining

Promise Pipelining is Cap'n Web's most powerful feature. It allows you to make multiple dependent RPC calls in a single network round trip, dramatically reducing latency.

## The Problem

Consider a typical scenario where you need to make sequential API calls:

```typescript
// Traditional approach: 3 network round trips
const session = await api.login(credentials)      // Round trip 1: ~100ms
const user = await session.getCurrentUser()       // Round trip 2: ~100ms
const profile = await api.getProfile(user.id)     // Round trip 3: ~100ms
// Total: ~300ms
```

Each `await` waits for the previous call to complete before sending the next request. This adds up quickly.

## The Solution

With Promise Pipelining, you can chain calls without waiting:

```typescript
// With pipelining: 1 network round trip
const session = api.login(credentials)            // Start call, don't await
const user = session.getCurrentUser()             // Pipeline on session
const profile = await api.getProfile(user.id)     // Pipeline on user.id
// Total: ~100ms
```

**All three calls are sent together** and the server resolves the dependencies.

## How It Works

### RpcPromise as a Stub

When you call an RPC method without `await`, you get an `RpcPromise<T>`. This promise can be used as if it were the actual value:

```typescript
const userPromise = api.getUser(123)  // Returns RpcPromise<User>

// userPromise.name returns RpcPromise<string>
const namePromise = userPromise.name

// You can use namePromise in other calls
const greeting = await api.greet(namePromise)
```

### Server-Side Resolution

The server receives all the calls at once and resolves them in the correct order:

```
Client sends:
  1. getUser(123) → result stored as $0
  2. greet($0.name) → uses $0.name when $0 resolves

Server processes:
  1. Executes getUser(123), stores result
  2. Executes greet(user.name) using stored result
  3. Returns all results at once
```

## Practical Examples

### Authentication Flow

```typescript
// Traditional: 2 round trips
const authed = await api.authenticate(token)
const data = await authed.getData()

// Pipelined: 1 round trip
const authed = api.authenticate(token)
const data = await authed.getData()
```

### Fetching Related Data

```typescript
// Traditional: 4 round trips
const user = await api.getUser(id)
const posts = await api.getPosts(user.id)
const comments = await api.getComments(posts[0].id)
const author = await api.getUser(comments[0].authorId)

// Pipelined: 1 round trip
const user = api.getUser(id)
const posts = api.getPosts(user.id)
const comments = api.getComments(posts[0].id)
const author = await api.getUser(comments[0].authorId)
```

### Property Access

You can pipeline through property access:

```typescript
const user = api.getUser(123)
const name = user.name           // RpcPromise<string>
const email = user.email         // RpcPromise<string>
const address = user.address     // RpcPromise<Address>
const city = address.city        // RpcPromise<string>

// All resolved in one round trip
const [userName, userCity] = await Promise.all([name, city])
```

## The Magic `map()` Method

For operations on arrays, Cap'n Web provides a special `map()` method that executes on the server:

```typescript
// Get user IDs and their profiles in ONE round trip
const idsPromise = api.listUserIds()
const profiles = await idsPromise.map(id => api.getProfile(id))
```

### How `map()` Works

1. Your callback is recorded (not executed immediately)
2. The recording is sent to the server
3. Server replays the callback for each array element
4. All results returned together

```typescript
// This callback is recorded, not executed
const results = await userIds.map(id => {
  return {
    id,                       // The promise itself
    profile: api.getProfile(id),  // RPC call for each ID
    posts: api.getPosts(id)       // Another RPC call
  }
})
// Results: [{ id: 1, profile: {...}, posts: [...] }, ...]
```

### `map()` Restrictions

- Callback must be synchronous (no `await`)
- Callback cannot have side effects (only RPC calls)
- Input values are `RpcPromise`, not actual values

```typescript
// WRONG: Can't use regular operations on RpcPromise
const results = await ids.map(id => {
  return id + 1  // Error! Can't add number to RpcPromise
})

// CORRECT: Only use in RPC calls
const results = await ids.map(id => {
  return api.getById(id)
})
```

## HTTP Batch Sessions

For HTTP batch mode, pipelining works slightly differently:

```typescript
using api = newHttpBatchRpcSession<MyApi>('https://api.example.com')

// Queue up calls
const a = api.methodA()
const b = api.methodB()
const c = api.methodC(a)  // Depends on a

// Batch is sent when you await
const [resultA, resultB, resultC] = await Promise.all([a, b, c])
```

The batch is automatically sent on the next microtask tick.

## WebSocket Sessions

With WebSocket sessions, you have more flexibility:

```typescript
using api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Immediate pipelining
const user = api.getUser(123)
const profile = await api.getProfile(user.id)  // Sent immediately

// Can make more calls later on the same connection
const posts = await api.getPosts(123)
```

## Best Practices

### 1. Avoid Unnecessary Awaits

```typescript
// BAD: Awaits too early
const user = await api.getUser(id)  // Wait here
const profile = await api.getProfile(user.id)  // Then wait here

// GOOD: Only await at the end
const user = api.getUser(id)
const profile = await api.getProfile(user.id)  // Single round trip
```

### 2. Use Promise.all for Multiple Independent Results

```typescript
// Get multiple independent results
const user = api.getUser(id)
const [name, email, posts] = await Promise.all([
  user.name,
  user.email,
  api.getPosts(user.id)
])
```

### 3. Dispose Unused Promises

If you start a pipelined call but don't need the result, dispose it:

```typescript
const session = api.login(credentials)
const user = session.getCurrentUser()  // Started but not awaited

// If you don't need user, dispose it
user[Symbol.dispose]()
```

### 4. Consider Readability

Sometimes multiple round trips are clearer:

```typescript
// More readable for complex logic
const user = await api.getUser(id)
if (user.role === 'admin') {
  const adminData = await api.getAdminData(user.id)
  // ...
}
```

## Performance Impact

| Scenario | Without Pipelining | With Pipelining |
|----------|-------------------|-----------------|
| 2 dependent calls | 2 x latency | 1 x latency |
| 5 dependent calls | 5 x latency | 1 x latency |
| N dependent calls | N x latency | 1 x latency |

For a typical 100ms latency connection, pipelining 5 calls saves 400ms per operation.
