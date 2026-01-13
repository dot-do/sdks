# Error Handling

Cap'n Web provides robust error handling that preserves error information across RPC boundaries.

## Basic Error Handling

Errors from remote calls are delivered as rejected promises:

```typescript
try {
  await api.riskyOperation()
} catch (error) {
  console.error('Operation failed:', error.message)
}
```

### Error Preservation

Cap'n Web preserves error details across the network:

```typescript
// Server throws
class MyApi extends RpcTarget {
  doSomething() {
    throw new Error('Something went wrong')
  }
}

// Client receives
try {
  await api.doSomething()
} catch (error) {
  error.message     // "Something went wrong"
  error.stack       // Stack trace from server
  error.name        // "Error"
}
```

### Built-in Error Types

These error types are serialized with their type preserved:

- `Error`
- `TypeError`
- `RangeError`
- `ReferenceError`
- `SyntaxError`
- `URIError`

```typescript
// Server
throw new TypeError('Expected string, got number')

// Client
try {
  await api.method()
} catch (error) {
  error instanceof TypeError  // true
}
```

## Handling Pipelined Errors

When using promise pipelining, errors propagate through the chain:

```typescript
const user = api.getUser(invalidId)        // This will fail
const profile = api.getProfile(user.id)    // Never executes
const posts = api.getPosts(user.id)        // Never executes

try {
  await Promise.all([profile, posts])
} catch (error) {
  // Error from getUser propagates to all dependent calls
  console.error('Failed:', error.message)
}
```

### Partial Failures

Use `Promise.allSettled` for independent calls that may fail:

```typescript
const results = await Promise.allSettled([
  api.getUser(1),
  api.getUser(2),  // This might fail
  api.getUser(3),
])

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    console.log(`User ${index + 1}:`, result.value)
  } else {
    console.error(`User ${index + 1} failed:`, result.reason)
  }
})
```

## Connection Errors

Handle connection-level errors:

```typescript
const api = newWebSocketRpcSession<MyApi>('wss://api.example.com')

// Monitor connection health
api.onRpcBroken((error) => {
  console.error('Connection lost:', error)
  // Reconnect logic here
})

// Calls fail when disconnected
try {
  await api.method()
} catch (error) {
  if (error.message.includes('disconnected')) {
    // Handle disconnect
  }
}
```

## Custom Error Classes

For custom error types, extend Error and include serializable data:

```typescript
// Server-side custom error
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

class MyApi extends RpcTarget {
  updateUser(data: any) {
    if (!data.email) {
      throw new ValidationError(
        'Email is required',
        'email',
        'REQUIRED_FIELD'
      )
    }
  }
}
```

::: warning
Custom error properties (like `field` and `code`) are serialized as a plain object. The error won't be an instance of your custom class on the client side.
:::

```typescript
// Client-side handling
try {
  await api.updateUser({})
} catch (error) {
  // error.name === 'ValidationError'
  // error.field === 'email'  (if you set it as an own property)
  // error.code === 'REQUIRED_FIELD'
  // But: error instanceof ValidationError === false
}
```

## Error Handling Patterns

### Pattern 1: Result Types

Return success/failure as data instead of throwing:

```typescript
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string }

class MyApi extends RpcTarget {
  async createUser(data: UserData): Promise<Result<User>> {
    try {
      const user = await db.create(data)
      return { success: true, data: user }
    } catch (e) {
      return { success: false, error: e.message, code: 'CREATE_FAILED' }
    }
  }
}

// Client
const result = await api.createUser(data)
if (result.success) {
  console.log('Created:', result.data)
} else {
  console.error('Failed:', result.error)
}
```

### Pattern 2: Error Boundaries

Wrap RPC calls in error boundaries:

```typescript
async function withErrorHandling<T>(
  operation: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    console.error('RPC error:', error)
    return fallback
  }
}

const user = await withErrorHandling(
  () => api.getUser(123),
  { id: 0, name: 'Unknown' }
)
```

### Pattern 3: Retry Logic

Implement automatic retries for transient failures:

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      // Don't retry on certain errors
      if (error.message.includes('validation')) {
        throw error
      }

      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, delayMs * attempt))
      }
    }
  }

  throw lastError
}

const data = await withRetry(() => api.fetchData())
```

### Pattern 4: Typed Error Handling

Create typed error handlers:

```typescript
function handleApiError(error: unknown): never {
  if (error instanceof Error) {
    switch (error.name) {
      case 'ValidationError':
        throw new UserFacingError('Please check your input')
      case 'AuthenticationError':
        throw new UserFacingError('Please log in again')
      case 'RateLimitError':
        throw new UserFacingError('Too many requests, try again later')
      default:
        throw new UserFacingError('Something went wrong')
    }
  }
  throw new UserFacingError('Unknown error')
}

try {
  await api.doSomething()
} catch (error) {
  handleApiError(error)
}
```

## Debugging Tips

### Enable Verbose Logging

```typescript
// Custom transport with logging
const transport: RpcTransport = {
  async send(message) {
    console.log('Sending:', message)
    await originalTransport.send(message)
  },
  async receive() {
    const message = await originalTransport.receive()
    console.log('Received:', message)
    return message
  }
}
```

### Check Stack Traces

Server-side stack traces are included in errors. Look for the `at` lines that indicate server-side code.

### Use Error Monitoring

Integrate with error tracking services:

```typescript
import * as Sentry from '@sentry/node'

try {
  await api.method()
} catch (error) {
  Sentry.captureException(error, {
    extra: {
      rpcMethod: 'method',
      isRpcError: true
    }
  })
  throw error
}
```
