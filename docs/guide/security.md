# Security Considerations

Cap'n Web provides powerful capabilities that require careful security consideration.

## Authentication

### WebSocket Authentication

Browsers don't allow custom headers on WebSocket connections, so authentication must happen in-band:

```typescript
// WRONG: Can't set headers on WebSocket
const api = newWebSocketRpcSession('wss://api.example.com', {
  headers: { Authorization: 'Bearer token' }  // Won't work in browser!
})

// CORRECT: Authenticate via RPC method
interface PublicApi {
  authenticate(token: string): AuthenticatedApi
}

const publicApi = newWebSocketRpcSession<PublicApi>('wss://api.example.com')
const authedApi = await publicApi.authenticate(myToken)
```

### Server-Side Authentication

```typescript
class PublicApi extends RpcTarget implements PublicApiInterface {
  authenticate(token: string): AuthenticatedApi {
    const user = validateToken(token)  // Your validation logic
    if (!user) {
      throw new Error('Invalid token')
    }
    return new AuthenticatedApi(user)
  }
}

class AuthenticatedApi extends RpcTarget {
  constructor(private user: User) {
    super()
  }

  getProfile(): UserProfile {
    return getUserProfile(this.user.id)
  }
}
```

### HTTP Authentication

For HTTP batch mode, standard headers work:

```typescript
const api = newHttpBatchRpcSession<MyApi>('https://api.example.com', {
  headers: {
    Authorization: `Bearer ${token}`
  }
})
```

## Object-Capability Security

Cap'n Web follows the object-capability security model:

### Principle of Least Authority

Only expose what's necessary:

```typescript
// BAD: Exposing too much
class AdminApi extends RpcTarget {
  deleteUser(id: string) { /* ... */ }
  deleteDatabase() { /* ... */ }  // Dangerous!
}

// GOOD: Separate capabilities
class UserApi extends RpcTarget {
  deleteUser(id: string) { /* ... */ }
}

class DatabaseAdminApi extends RpcTarget {
  deleteDatabase() { /* ... */ }
}

// Only give admin API to verified admins
class RootApi extends RpcTarget {
  authenticate(token: string): UserApi | AdminBundle {
    const user = validate(token)
    if (user.role === 'admin') {
      return {
        users: new UserApi(),
        database: new DatabaseAdminApi()  // Only admins get this
      }
    }
    return new UserApi()
  }
}
```

### Capability Attenuation

Create restricted versions of capabilities:

```typescript
class FullFileSystem extends RpcTarget {
  read(path: string): string { /* ... */ }
  write(path: string, content: string): void { /* ... */ }
  delete(path: string): void { /* ... */ }
}

class ReadOnlyFileSystem extends RpcTarget {
  constructor(private fs: FullFileSystem) {
    super()
  }

  read(path: string): string {
    return this.fs.read(path)
  }
  // write and delete not exposed
}

// Give untrusted code only read access
const fullFs = new FullFileSystem()
const readOnlyFs = new ReadOnlyFileSystem(fullFs)
```

## Input Validation

### Type Checking at Runtime

TypeScript types are erased at runtime. Validate inputs:

```typescript
import { z } from 'zod'

const UserUpdateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional()
})

class UserApi extends RpcTarget {
  updateUser(id: string, data: unknown): User {
    // Validate at runtime
    const validData = UserUpdateSchema.parse(data)
    return db.updateUser(id, validData)
  }
}
```

### Preventing Injection

Cap'n Web doesn't automatically sanitize inputs:

```typescript
// DANGEROUS: SQL injection
class Api extends RpcTarget {
  findUser(name: string) {
    return db.query(`SELECT * FROM users WHERE name = '${name}'`)  // DON'T!
  }
}

// SAFE: Use parameterized queries
class Api extends RpcTarget {
  findUser(name: string) {
    return db.query('SELECT * FROM users WHERE name = ?', [name])
  }
}
```

### MongoDB-Style Injection

Be careful with object queries:

```typescript
// DANGEROUS: Object properties can be attack vectors
class Api extends RpcTarget {
  findUser(query: Record<string, unknown>) {
    return db.find(query)  // Attacker could send { $ne: null }
  }
}

// SAFE: Validate the query structure
class Api extends RpcTarget {
  findUser(name: string) {
    // Only allow specific fields
    return db.find({ name })
  }
}
```

## Rate Limiting

Promise pipelining can amplify load:

```typescript
// A single pipelined request could trigger many operations
const ids = api.listAllIds()  // Returns 1000 IDs
const data = await ids.map(id => api.heavyOperation(id))
// This runs 1000 heavy operations!
```

### Implementing Rate Limits

```typescript
class RateLimitedApi extends RpcTarget {
  private callCount = 0
  private lastReset = Date.now()

  private checkRateLimit() {
    const now = Date.now()
    if (now - this.lastReset > 60000) {
      this.callCount = 0
      this.lastReset = now
    }
    if (this.callCount++ > 100) {
      throw new Error('Rate limit exceeded')
    }
  }

  expensiveOperation() {
    this.checkRateLimit()
    // ... operation
  }
}
```

### CPU Limits on Workers

Configure per-request CPU limits on Cloudflare Workers:

```toml
# wrangler.toml
[limits]
cpu_ms = 50  # Lower than default 30000ms
```

## Private Methods

TypeScript `private` does NOT prevent RPC access:

```typescript
class Api extends RpcTarget {
  // EXPOSED: TypeScript private is only compile-time
  private sensitiveMethod() {
    return this.secret
  }

  // HIDDEN: JavaScript # private is runtime
  #trulySensitiveMethod() {
    return this.secret
  }
}
```

Use `#` prefix for methods that must not be callable via RPC.

## Cross-Origin Considerations

### WebSocket CORS

WebSockets don't enforce same-origin policy. Any site can connect:

```typescript
// Any website can connect to your WebSocket endpoint!
const api = newWebSocketRpcSession('wss://your-api.com')
```

**Mitigations:**
- Always use token-based authentication
- Don't trust cookies for WebSocket auth
- Validate the `Origin` header if needed

### HTTP CORS

For HTTP batch mode, configure CORS properly:

```typescript
// Server
async function handleRequest(request: Request): Promise<Response> {
  const response = await newHttpBatchRpcResponse(request, api)

  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', 'https://trusted-site.com')
  response.headers.set('Access-Control-Allow-Methods', 'POST')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  return response
}
```

## Sensitive Data

### Don't Log RPC Messages

RPC messages may contain sensitive data:

```typescript
// DANGEROUS: Logs credentials
const transport: RpcTransport = {
  send(message) {
    console.log('Sending:', message)  // Might log passwords!
    return originalTransport.send(message)
  }
}

// SAFER: Redact sensitive fields
const transport: RpcTransport = {
  send(message) {
    console.log('Sending RPC message')  // Don't log content
    return originalTransport.send(message)
  }
}
```

### Error Messages

Don't expose internal details in errors:

```typescript
class Api extends RpcTarget {
  login(username: string, password: string) {
    const user = db.findUser(username)
    if (!user) {
      // DANGEROUS: Reveals whether username exists
      throw new Error('User not found')
    }
    if (!checkPassword(user, password)) {
      // DANGEROUS: Confirms username was correct
      throw new Error('Wrong password')
    }
    return user
  }
}

// BETTER
class Api extends RpcTarget {
  login(username: string, password: string) {
    const user = db.findUser(username)
    if (!user || !checkPassword(user, password)) {
      throw new Error('Invalid credentials')  // Generic message
    }
    return user
  }
}
```

## Security Checklist

- [ ] Use in-band authentication for WebSocket
- [ ] Validate all inputs at runtime (Zod, etc.)
- [ ] Use `#` prefix for truly private methods
- [ ] Implement rate limiting
- [ ] Configure CPU limits on Workers
- [ ] Don't log RPC message contents
- [ ] Use generic error messages
- [ ] Apply principle of least authority
- [ ] Sanitize data before database queries
