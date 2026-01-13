# Security Policy

https://www.cloudflare.com/disclosure

## Reporting a Vulnerability

* https://hackerone.com/cloudflare
  * All Cloudflare products are in scope for reporting. If you submit a valid report on bounty-eligible assets through our disclosure program, we will transfer your report to our private bug bounty program and invite you as a participant.
* `mailto:security@cloudflare.com`
  * If you'd like to encrypt your message, please do so within the body of the message. Our email system doesn't handle PGP-MIME well.
  * https://www.cloudflare.com/gpg/security-at-cloudflare-pubkey-06A67236.txt

All abuse reports should be submitted to our Trust & Safety team through our dedicated page: https://www.cloudflare.com/abuse/

---

## Capability Security Model

Cap'n Web implements the **Object-Capability Security** model, where access to resources is controlled by possession of capability references rather than identity-based access control lists.

### Core Principles

1. **No Ambient Authority**: Code cannot access capabilities it wasn't explicitly given
2. **Principle of Least Authority (POLA)**: Grant only the minimum capabilities needed
3. **Capability Attenuation**: Create restricted views of capabilities

### Implementation

```typescript
// BAD: Ambient authority - anyone with AdminApi can do anything
class AdminApi extends RpcTarget {
  deleteUser(id: string) { /* ... */ }
  deleteDatabase() { /* ... */ }  // Dangerous!
}

// GOOD: Separate capabilities, grant minimally
class UserApi extends RpcTarget {
  deleteUser(id: string) { /* ... */ }
}

class DatabaseAdminApi extends RpcTarget {
  deleteDatabase() { /* ... */ }
}

// Only give DatabaseAdminApi to verified admins
class AuthApi extends RpcTarget {
  authenticate(token: string): UserApi | { users: UserApi, admin: DatabaseAdminApi } {
    const user = validateToken(token);
    if (user.role === 'admin') {
      return { users: new UserApi(), admin: new DatabaseAdminApi() };
    }
    return new UserApi();
  }
}
```

### What RpcTarget Exposes

| Element | Exposed via RPC? | Notes |
|---------|-----------------|-------|
| Class methods | Yes | Public API surface |
| Getters | Yes | Treated as methods |
| Instance properties | **No** | Intentional security boundary |
| `private` (TypeScript) | **Yes** | TypeScript-only annotation, not runtime enforced |
| `#` private methods | **No** | True JavaScript privacy, never exposed |

**Critical Warning**: TypeScript's `private` keyword does NOT prevent RPC access. Use `#` prefix for truly private methods.

---

## CORS Decision Tree

For HTTP batch mode, use this decision tree to configure CORS:

```
                    Is your API public?
                          │
              ┌───────────┼───────────┐
              │           │           │
            Yes          No       Internal
              │           │           │
              ▼           ▼           ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ allowedOrigins: │ │ Configure   │ │ No CORS    │
    │ "*"          │ │ explicit    │ │ (default)   │
    │              │ │ allowlist   │ │             │
    │ ONLY if using│ │             │ │ Only same-  │
    │ in-band auth │ │ ["https://  │ │ origin      │
    └──────┬───────┘ │  app.com"]  │ │ requests    │
           │         └──────┬──────┘ └──────┬──────┘
           │                │               │
           ▼                ▼               ▼
    ┌────────────────────────────────────────────┐
    │         Does your API use cookies?          │
    └─────────────────────┬──────────────────────┘
                          │
              ┌───────────┼───────────┐
              │                       │
            Yes                      No
              │                       │
              ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐
    │ MUST use explicit│     │ Can use "*" if  │
    │ origin allowlist │     │ in-band auth    │
    │                  │     │                 │
    │ NEVER use "*"    │     │ Or use allowlist│
    │ with credentials │     │ for extra safety│
    └─────────────────┘     └─────────────────┘
```

### CORS Configuration Examples

```typescript
// Most restrictive (default): No cross-origin access
return newWorkersRpcResponse(request, api);

// Explicit allowlist (recommended for cookie-based auth)
return newWorkersRpcResponse(request, api, {
  allowedOrigins: ["https://myapp.com", "https://staging.myapp.com"],
  allowCredentials: true
});

// Public API with in-band authorization
return newWorkersRpcResponse(request, api, {
  allowedOrigins: "*"  // Only safe if auth is via RPC params, not cookies
});
```

### Special Handling: Null Origin

The implementation **never** allows credentials with `null` origin:

```typescript
// From src/index.ts - null origin protection
if (allowCredentials && requestOrigin === "null") {
  return headers; // No CORS headers - request blocked
}
```

The "null" origin is shared by sandboxed iframes, `file://` URLs, and `data:` URLs. Allowing credentials with null origin enables CSRF attacks.

### WebSocket CORS Warning

WebSocket connections **bypass browser CORS restrictions**. Any website can connect to your WebSocket endpoint:

```typescript
// ANY website can do this:
const api = newWebSocketRpcSession('wss://your-api.com');
```

**Mitigations:**
- Always use token-based authentication via RPC methods
- Never trust cookies for WebSocket authentication
- Validate Origin header if needed (but this is bypassable from non-browser clients)

---

## Rate Limiting Recommendations

### Why Rate Limiting Matters for RPC

Promise pipelining can amplify server load significantly:

```typescript
// A single pipelined request could trigger many operations
const ids = api.listAllIds();  // Returns 1000 IDs
const data = await ids.map(id => api.heavyOperation(id));
// This runs 1000 heavy operations in ONE request!
```

### Implementation Strategies

**1. Per-Session Rate Limiting**

```typescript
class RateLimitedApi extends RpcTarget {
  private callCount = 0;
  private windowStart = Date.now();

  private checkRateLimit() {
    const now = Date.now();
    if (now - this.windowStart > 60000) {
      this.callCount = 0;
      this.windowStart = now;
    }
    if (++this.callCount > 100) {
      throw new Error('Rate limit exceeded: 100 calls per minute');
    }
  }

  async expensiveOperation(data: unknown) {
    this.checkRateLimit();
    // ... operation
  }
}
```

**2. Cloudflare Workers CPU Limits**

```toml
# wrangler.toml
[limits]
cpu_ms = 50  # Limit CPU time per request (default is 30000ms)
```

**3. Request Timeout Configuration**

```typescript
// Session-level default timeout
const api = newWebSocketRpcSession('wss://api.example.com', undefined, {
  timeout: 5000  // 5 second timeout for all calls
});

// Per-call timeout override
const result = await api.slowOperation({ timeout: 30000 });
```

### Recommended Limits

| Resource | Recommended Limit | Rationale |
|----------|------------------|-----------|
| Calls per minute | 100-1000 | Prevents abuse while allowing legitimate use |
| Message size | 10MB | Default in protocol; prevents memory exhaustion |
| Recursion depth | 100 levels | Prevents stack overflow attacks |
| Concurrent connections | 10-100 per user | Prevents connection exhaustion |
| Request timeout | 5-30 seconds | Prevents hanging connections |

---

## Input Validation

### TypeScript Types are NOT Runtime Validation

TypeScript types are erased at compile time. Always validate inputs:

```typescript
import { z } from 'zod';

const UserUpdateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional()
});

class UserApi extends RpcTarget {
  updateUser(id: string, data: unknown): User {
    // TypeScript thinks data is `unknown`, but we must validate
    const validData = UserUpdateSchema.parse(data);
    return db.updateUser(id, validData);
  }
}
```

### Injection Prevention

Cap'n Web does not automatically sanitize inputs:

```typescript
// DANGEROUS: SQL injection
class Api extends RpcTarget {
  findUser(name: string) {
    return db.query(`SELECT * FROM users WHERE name = '${name}'`);  // DON'T!
  }
}

// SAFE: Parameterized queries
class Api extends RpcTarget {
  findUser(name: string) {
    return db.query('SELECT * FROM users WHERE name = ?', [name]);
  }
}
```

### Object Property Injection

Be careful with object queries (MongoDB-style attacks):

```typescript
// DANGEROUS: Object properties can be attack vectors
class Api extends RpcTarget {
  findUser(query: Record<string, unknown>) {
    return db.find(query);  // Attacker could send { $ne: null }
  }
}

// SAFE: Validate query structure or only allow specific fields
class Api extends RpcTarget {
  findUser(name: string) {
    return db.find({ name });  // Only allow searching by name
  }
}
```

---

## Error Message Security

### Don't Leak Internal Details

```typescript
// DANGEROUS: Reveals whether username exists
class Api extends RpcTarget {
  login(username: string, password: string) {
    const user = db.findUser(username);
    if (!user) {
      throw new Error('User not found');  // Information leak!
    }
    if (!checkPassword(user, password)) {
      throw new Error('Wrong password');  // Confirms username exists!
    }
    return user;
  }
}

// SAFE: Generic error message
class Api extends RpcTarget {
  login(username: string, password: string) {
    const user = db.findUser(username);
    if (!user || !checkPassword(user, password)) {
      throw new Error('Invalid credentials');  // No information leaked
    }
    return user;
  }
}
```

### Server-Side Error Redaction

Configure `onSendError` to redact sensitive information:

```typescript
const session = new RpcSession(transport, localMain, {
  onSendError(error) {
    // Log full error server-side
    console.error('RPC error:', error);

    // Return sanitized error to client
    return new Error('An internal error occurred');
    // Or return the error with stack trace removed (default behavior)
  }
});
```

---

## Security Checklist

### Authentication
- [ ] Use in-band authentication for WebSocket (not cookies)
- [ ] Implement proper token validation
- [ ] Use secure token storage (keychain/encrypted file)
- [ ] Set appropriate token expiration

### Authorization
- [ ] Follow principle of least authority
- [ ] Separate capabilities by privilege level
- [ ] Use capability attenuation for restricted access
- [ ] Validate authorization on every call

### Input Validation
- [ ] Validate all inputs at runtime (Zod, etc.)
- [ ] Use parameterized queries for databases
- [ ] Sanitize data before use in templates
- [ ] Limit input sizes

### Transport Security
- [ ] Use HTTPS/WSS in production
- [ ] Configure CORS appropriately
- [ ] Set proper timeouts
- [ ] Implement rate limiting

### Error Handling
- [ ] Use generic error messages
- [ ] Don't log sensitive data
- [ ] Configure `onSendError` to redact stacks
- [ ] Monitor for unusual error patterns

### Code Security
- [ ] Use `#` prefix for truly private methods
- [ ] Don't expose instance properties
- [ ] Review what RpcTarget methods are exposed
- [ ] Audit capability grants
