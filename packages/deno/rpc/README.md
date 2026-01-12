# @dotdo/rpc

**The Deno-native RPC layer for the `.do` ecosystem.**

```typescript
import { connect } from "jsr:@dotdo/rpc";

// Connect to any .do service - zero configuration
const users = await connect<UserService>("users.do");
const user = await users.get("123");

// Chainable transformations with .map()
const names = await users.list().map((u) => u.name);
```

One import. Native TypeScript. Permission-safe by default.

---

## What is @dotdo/rpc?

`@dotdo/rpc` is the streamlined RPC client for the DotDo ecosystem, built from the ground up for Deno. It sits between raw [capnweb](https://jsr.io/@dotdo/capnweb) (the protocol) and domain-specific SDKs, providing a seamless developer experience with Deno's native features.

Think of it as the "managed proxy" that lets you:

1. **Connect to any `.do` service** - `users.do`, `mongo.do`, `ai.do`, and hundreds more
2. **Get full TypeScript inference** - No codegen, no build step, instant autocomplete
3. **Use `.map()` for transformations** - Server-side or client-side, same syntax
4. **Leverage Deno idioms** - URL imports, explicit permissions, native TypeScript

```
Your Deno Code
    |
    v
+--------------+     +--------------+     +-------------+
| @dotdo/rpc   | --> | @dotdo/capnweb | --> | *.do Server |
+--------------+     +--------------+     +-------------+
    |
    +--- Managed proxy (connect<T>())
    +--- Automatic service routing
    +--- MappablePromise for transforms
    +--- Built-in error handling
```

---

## @dotdo/rpc vs @dotdo/capnweb

| Feature | @dotdo/capnweb | @dotdo/rpc |
|---------|----------------|------------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe interfaces | Yes | Yes (enhanced) |
| Simplified `connect()` API | No | Yes |
| Service name routing | No | Yes (`"users.do"` -> full URL) |
| MappablePromise `.map()` | No | Yes |
| Connection options preset | No | Yes |
| Timeout handling built-in | No | Yes |
| AbortSignal support | Partial | Full |

**Use @dotdo/capnweb** when you need low-level protocol access or are building custom RPC infrastructure.

**Use @dotdo/rpc** when you're consuming `.do` services and want maximum productivity with minimal boilerplate.

---

## Installation

### From JSR (Recommended)

```typescript
// deno.json
{
  "imports": {
    "@dotdo/rpc": "jsr:@dotdo/rpc@^0.1.0"
  }
}
```

Then import:

```typescript
import { connect } from "@dotdo/rpc";
```

### Direct URL Import

```typescript
import { connect } from "https://jsr.io/@dotdo/rpc/0.1.0/mod.ts";
```

### From deno.land/x

```typescript
import { connect } from "https://deno.land/x/dotdo_rpc@v0.1.0/mod.ts";
```

### Using `deno add`

```bash
deno add @dotdo/rpc
```

This adds the import to your `deno.json` automatically.

---

## Deno Permissions

`@dotdo/rpc` requires network access to communicate with `.do` services. Here are the recommended permission patterns:

### Minimal Permissions

```bash
# Allow only specific .do domains
deno run --allow-net=api.do,users.do,mongo.do main.ts
```

### Development Permissions

```bash
# Allow all network access (development only)
deno run --allow-net --allow-env main.ts
```

### Production Permissions (Recommended)

```bash
# Explicit, minimal permissions
deno run \
  --allow-net=api.do \
  --allow-env=DOTDO_TOKEN \
  --allow-read=.env \
  main.ts
```

### Permission Flags Reference

| Permission | Purpose | When Needed |
|------------|---------|-------------|
| `--allow-net=api.do` | Network access to DotDo | Always |
| `--allow-env=DOTDO_TOKEN` | Read auth token from env | If using env vars |
| `--allow-read=.env` | Load .env files | If using dotenv |

---

## Quick Start

### Basic Connection

```typescript
import { connect } from "@dotdo/rpc";

// Connect to a .do service
const users = await connect("users.do");

// Make RPC calls
const user = await users.get("123");
console.log(user);

// Clean up with explicit disposal
await users[Symbol.asyncDispose]();
```

### Using `using` Declaration (Deno 1.38+)

```typescript
import { connect } from "@dotdo/rpc";

// Automatic cleanup with explicit resource management
{
  await using users = await connect("users.do");

  const allUsers = await users.list();
  console.log(`Found ${allUsers.length} users`);
} // Connection automatically disposed here
```

### With Authentication

```typescript
import { connect } from "@dotdo/rpc";

const users = await connect("users.do", {
  token: Deno.env.get("DOTDO_TOKEN"),
  headers: {
    "X-Request-ID": crypto.randomUUID(),
  },
});

// Authenticated calls
const me = await users.me();
```

### TypeScript: Full Type Safety

```typescript
import { connect } from "@dotdo/rpc";

// Define your service interface
interface UserService {
  get(id: string): Promise<User>;
  list(): Promise<User[]>;
  create(data: CreateUserInput): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  delete(id: string): Promise<void>;
}

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

// Type-safe client with full autocomplete
const users = await connect<UserService>("users.do");

// TypeScript knows all the types!
const user = await users.get("123");        // User
const allUsers = await users.list();         // User[]
const newUser = await users.create({         // User
  name: "Alice",
  email: "alice@example.com",
});
```

---

## The MappablePromise

`@dotdo/rpc` extends standard Promises with a `.map()` method that enables elegant data transformations.

### How It Works

```typescript
import { connect, type MappablePromise } from "@dotdo/rpc";

const users = await connect<UserService>("users.do");

// .map() works on arrays - transforms each element
const names: MappablePromise<string[]> = users.list().map((u) => u.name);
const result = await names;  // ["Alice", "Bob", "Charlie"]

// .map() works on single values too
const upperName = await users.get("123").map((u) => u.name.toUpperCase());
// "ALICE"
```

### Chaining Maps

```typescript
// Chain multiple transformations
const activeEmails = await users
  .list()
  .map((user) => user.email)
  .map((email) => email.toLowerCase());
```

### Type-Safe Transforms

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  profile: {
    avatar: string;
    bio: string;
  };
}

const users = await connect<{ list(): Promise<User[]> }>("users.do");

// TypeScript infers the transformed type
const avatars = await users.list().map((u) => u.profile.avatar);
//    ^? string[]

const profiles = await users.list().map((u) => ({
  displayName: u.name,
  avatarUrl: u.profile.avatar,
}));
//    ^? { displayName: string; avatarUrl: string }[]
```

### MappablePromise vs Array.map()

```typescript
// MappablePromise.map() - single await
const names = await users.list().map((u) => u.name);

// Equivalent with Array.map() - requires intermediate await
const userList = await users.list();
const names = userList.map((u) => u.name);
```

The key advantage: fewer intermediate variables and cleaner code flow.

---

## Connection Options

### Full Options Interface

```typescript
import { connect, type ConnectOptions } from "@dotdo/rpc";

const options: ConnectOptions = {
  // Base URL for the DotDo platform
  // Default: "https://api.do"
  baseUrl: "https://api.do",

  // Authentication token (sent as Bearer token)
  token: Deno.env.get("DOTDO_TOKEN"),

  // Custom headers for all requests
  headers: {
    "X-Client-Version": "1.0.0",
    "X-Request-ID": crypto.randomUUID(),
  },

  // Request timeout in milliseconds
  // Default: 30000 (30 seconds)
  timeout: 30000,

  // AbortSignal for cancellation
  signal: AbortSignal.timeout(60000),
};

const api = await connect("api.do", options);
```

### Service Name Resolution

The `connect()` function intelligently resolves service names:

```typescript
// Service name -> Full URL
await connect("users.do")
// Resolves to: https://api.do/users

// Service name with .do suffix stripped
await connect("users.do")
// Resolves to: https://api.do/users

// Full URL passed through unchanged
await connect("https://custom.api.com/rpc")
// Uses: https://custom.api.com/rpc

// Custom base URL
await connect("users.do", { baseUrl: "https://staging.api.do" })
// Resolves to: https://staging.api.do/users
```

---

## Error Handling

`@dotdo/rpc` provides structured error types for different failure scenarios.

### RpcError Class

```typescript
import { connect, RpcError } from "@dotdo/rpc";

const users = await connect<UserService>("users.do");

try {
  await users.get("nonexistent");
} catch (error) {
  if (error instanceof RpcError) {
    console.log("Code:", error.code);       // "NOT_FOUND"
    console.log("Message:", error.message); // "User not found"
    console.log("Details:", error.details); // { id: "nonexistent" }
  }
}
```

### Error Codes

| Code | Description | Typical Cause |
|------|-------------|---------------|
| `HTTP_4XX` | HTTP client error | Invalid request, auth failure |
| `HTTP_5XX` | HTTP server error | Server-side failure |
| `TIMEOUT` | Request timed out | Slow network or server |
| `NETWORK_ERROR` | Network failure | DNS, connection refused |
| `RPC_ERROR` | Remote procedure error | Server returned error |

### Error Handling Patterns

#### Basic Try-Catch

```typescript
import { connect, RpcError } from "@dotdo/rpc";

async function getUser(id: string): Promise<User | null> {
  const users = await connect<UserService>("users.do");

  try {
    return await users.get(id);
  } catch (error) {
    if (error instanceof RpcError) {
      if (error.code === "HTTP_404" || error.code.includes("NOT_FOUND")) {
        return null;
      }
      console.error(`RPC Error [${error.code}]: ${error.message}`);
    }
    throw error;
  }
}
```

#### With AbortSignal for Timeout

```typescript
import { connect, RpcError } from "@dotdo/rpc";

async function fetchWithTimeout<T>(
  service: string,
  method: (api: T) => Promise<unknown>,
  timeoutMs: number = 5000,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const api = await connect<T>(service, {
      signal: controller.signal,
    });
    return await method(api);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RpcError("Request cancelled", "TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Usage
const user = await fetchWithTimeout<UserService>(
  "users.do",
  (api) => api.get("123"),
  3000,
);
```

#### Retry Pattern with Exponential Backoff

```typescript
import { connect, RpcError } from "@dotdo/rpc";

interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableCodes?: string[];
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffMultiplier = 2,
    retryableCodes = ["TIMEOUT", "NETWORK_ERROR", "HTTP_500", "HTTP_502", "HTTP_503"],
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (error instanceof RpcError) {
        if (!retryableCodes.some((code) => error.code.includes(code))) {
          throw error; // Not retryable
        }
      }

      if (attempt === maxAttempts) {
        break;
      }

      // Wait with jitter
      const jitter = Math.random() * 0.3 * delay;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

// Usage
const user = await withRetry(async () => {
  const users = await connect<UserService>("users.do");
  return users.get("123");
});
```

---

## Nested Services and Method Paths

The RPC proxy supports deeply nested service interfaces.

### Defining Nested Interfaces

```typescript
interface ApiService {
  users: UserMethods;
  posts: PostMethods;
  admin: {
    users: AdminUserMethods;
    settings: SettingsMethods;
  };
}

interface UserMethods {
  get(id: string): Promise<User>;
  list(): Promise<User[]>;
  profile: {
    get(userId: string): Promise<Profile>;
    update(userId: string, data: Partial<Profile>): Promise<Profile>;
  };
}

interface PostMethods {
  get(id: string): Promise<Post>;
  listByUser(userId: string): Promise<Post[]>;
}

interface AdminUserMethods {
  ban(userId: string): Promise<void>;
  unban(userId: string): Promise<void>;
  setRole(userId: string, role: string): Promise<void>;
}

interface SettingsMethods {
  get(): Promise<Settings>;
  update(settings: Partial<Settings>): Promise<Settings>;
}
```

### Making Nested Calls

```typescript
const api = await connect<ApiService>("api.do");

// Direct method calls
const user = await api.users.get("123");
const posts = await api.posts.listByUser("123");

// Nested namespaces
const profile = await api.users.profile.get("123");
await api.admin.users.setRole("123", "moderator");

// Admin settings
const settings = await api.admin.settings.get();
```

### How Nested Paths Are Resolved

```typescript
// api.users.profile.get("123")
// Sends RPC call: { method: "users.profile.get", params: ["123"] }

// api.admin.settings.update({ theme: "dark" })
// Sends RPC call: { method: "admin.settings.update", params: [{ theme: "dark" }] }
```

---

## Working with Deno.serve

Integrate `@dotdo/rpc` with Deno's native HTTP server.

### Basic Server with RPC Client

```typescript
import { connect } from "@dotdo/rpc";

interface UserService {
  get(id: string): Promise<User>;
  list(): Promise<User[]>;
}

interface User {
  id: string;
  name: string;
  email: string;
}

// Create shared client
const users = await connect<UserService>("users.do", {
  token: Deno.env.get("DOTDO_TOKEN"),
});

Deno.serve({ port: 8000 }, async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === "/users" && req.method === "GET") {
    try {
      const allUsers = await users.list();
      return Response.json(allUsers);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 },
      );
    }
  }

  if (url.pathname.startsWith("/users/") && req.method === "GET") {
    const id = url.pathname.split("/")[2];
    try {
      const user = await users.get(id);
      return Response.json(user);
    } catch (error) {
      if (error instanceof RpcError && error.code === "HTTP_404") {
        return Response.json({ error: "User not found" }, { status: 404 });
      }
      return Response.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 },
      );
    }
  }

  return new Response("Not Found", { status: 404 });
});
```

### Request-Scoped Connections

```typescript
import { connect, type RpcProxy } from "@dotdo/rpc";

interface UserService {
  get(id: string): Promise<User>;
  me(): Promise<User>;
}

Deno.serve({ port: 8000 }, async (req: Request): Promise<Response> => {
  // Extract auth from incoming request
  const authHeader = req.headers.get("Authorization");

  // Create request-scoped connection with forwarded auth
  await using users = await connect<UserService>("users.do", {
    token: authHeader?.replace("Bearer ", ""),
    headers: {
      "X-Request-ID": req.headers.get("X-Request-ID") ?? crypto.randomUUID(),
    },
  });

  const url = new URL(req.url);

  if (url.pathname === "/me") {
    try {
      const user = await users.me();
      return Response.json(user);
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return new Response("Not Found", { status: 404 });
});
```

### Middleware Pattern

```typescript
import { connect, RpcError } from "@dotdo/rpc";

type Handler = (req: Request) => Promise<Response>;
type Middleware = (handler: Handler) => Handler;

// Logging middleware
const withLogging: Middleware = (handler) => async (req) => {
  const start = performance.now();
  const response = await handler(req);
  const duration = performance.now() - start;
  console.log(`${req.method} ${req.url} - ${response.status} (${duration.toFixed(2)}ms)`);
  return response;
};

// Error handling middleware
const withErrorHandling: Middleware = (handler) => async (req) => {
  try {
    return await handler(req);
  } catch (error) {
    if (error instanceof RpcError) {
      const status = parseInt(error.code.replace("HTTP_", "")) || 500;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Unhandled error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
};

// Compose middleware
const compose = (...middlewares: Middleware[]) => (handler: Handler) =>
  middlewares.reduceRight((h, m) => m(h), handler);

// Main handler
const mainHandler: Handler = async (req) => {
  const users = await connect<UserService>("users.do");
  const url = new URL(req.url);

  if (url.pathname === "/users") {
    return Response.json(await users.list());
  }

  return new Response("Not Found", { status: 404 });
};

// Apply middleware
const handler = compose(withLogging, withErrorHandling)(mainHandler);

Deno.serve({ port: 8000 }, handler);
```

---

## Streaming Responses

Handle streaming data from `.do` services.

### AsyncIterator Pattern

```typescript
import { connect } from "@dotdo/rpc";

interface StreamService {
  streamEvents(): AsyncIterable<Event>;
  streamLogs(options: LogOptions): AsyncIterable<LogEntry>;
}

interface Event {
  id: string;
  type: string;
  data: unknown;
  timestamp: string;
}

interface LogOptions {
  level: "debug" | "info" | "warn" | "error";
  since?: string;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

const stream = await connect<StreamService>("stream.do");

// Iterate over streaming events
for await (const event of stream.streamEvents()) {
  console.log(`Event: ${event.type}`, event.data);
}

// Stream with options
for await (const log of stream.streamLogs({ level: "error" })) {
  console.error(`[${log.timestamp}] ${log.message}`);
}
```

### Server-Sent Events Integration

```typescript
import { connect } from "@dotdo/rpc";

interface NotificationService {
  subscribe(userId: string): AsyncIterable<Notification>;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
}

Deno.serve({ port: 8000 }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/notifications/stream") {
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return Response.json({ error: "userId required" }, { status: 400 });
    }

    const notifications = await connect<NotificationService>("notifications.do");

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          for await (const notification of notifications.subscribe(userId)) {
            const data = `data: ${JSON.stringify(notification)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
        } catch (error) {
          const errorData = `event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  return new Response("Not Found", { status: 404 });
});
```

---

## Testing

### Using Deno's Test Framework

```typescript
// users_test.ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { connect, RpcError } from "@dotdo/rpc";

interface UserService {
  get(id: string): Promise<User>;
  list(): Promise<User[]>;
  create(data: { name: string; email: string }): Promise<User>;
}

interface User {
  id: string;
  name: string;
  email: string;
}

Deno.test("UserService", async (t) => {
  const users = await connect<UserService>("users.do", {
    baseUrl: Deno.env.get("TEST_API_URL") ?? "https://api.do",
    token: Deno.env.get("TEST_TOKEN"),
  });

  await t.step("list returns array of users", async () => {
    const result = await users.list();
    assertEquals(Array.isArray(result), true);
  });

  await t.step("get returns user by id", async () => {
    const user = await users.get("test-user-123");
    assertEquals(typeof user.id, "string");
    assertEquals(typeof user.name, "string");
    assertEquals(typeof user.email, "string");
  });

  await t.step("get throws for nonexistent user", async () => {
    await assertRejects(
      () => users.get("nonexistent-id-xyz"),
      RpcError,
    );
  });
});
```

### Running Tests

```bash
# Run tests with required permissions
deno test --allow-net --allow-env users_test.ts

# Run with coverage
deno test --allow-net --allow-env --coverage=coverage users_test.ts
deno coverage coverage
```

### Mocking with Fake Server

```typescript
// mock_server.ts
export function createMockServer<T>(
  handlers: Record<string, (...args: unknown[]) => unknown>,
): T {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (typeof prop === "string" && prop in handlers) {
        return (...args: unknown[]) => Promise.resolve(handlers[prop](...args));
      }
      if (typeof prop === "string") {
        return createMockServer(handlers);
      }
      return undefined;
    },
    apply(_target, _thisArg, args) {
      // Handle direct calls
      return Promise.resolve(args);
    },
  };

  return new Proxy(function () {}, handler) as T;
}

// Test with mock
Deno.test("with mock server", async () => {
  const mockUsers: User[] = [
    { id: "1", name: "Alice", email: "alice@example.com" },
    { id: "2", name: "Bob", email: "bob@example.com" },
  ];

  const users = createMockServer<UserService>({
    list: () => mockUsers,
    get: (id: string) => mockUsers.find((u) => u.id === id),
  });

  const result = await users.list();
  assertEquals(result.length, 2);

  const alice = await users.get("1");
  assertEquals(alice.name, "Alice");
});
```

### Integration Testing with Test Server

```typescript
// integration_test.ts
import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";

Deno.test({
  name: "Integration: Full user lifecycle",
  permissions: { net: true, env: true },
  async fn() {
    const users = await connect<UserService>("users.do", {
      baseUrl: Deno.env.get("INTEGRATION_API_URL"),
      token: Deno.env.get("INTEGRATION_TOKEN"),
    });

    // Create user
    const created = await users.create({
      name: "Integration Test",
      email: `test-${Date.now()}@example.com`,
    });
    assertEquals(created.name, "Integration Test");

    // Read user
    const fetched = await users.get(created.id);
    assertEquals(fetched.id, created.id);

    // Cleanup
    await users.delete(created.id);
  },
});
```

---

## Advanced Patterns

### Singleton Client with Lazy Initialization

```typescript
// client.ts
import { connect, type RpcProxy } from "@dotdo/rpc";

interface Services {
  users: UserService;
  posts: PostService;
  notifications: NotificationService;
}

class ServiceClients {
  private cache = new Map<string, RpcProxy<unknown>>();

  async get<K extends keyof Services>(name: K): Promise<RpcProxy<Services[K]>> {
    if (!this.cache.has(name)) {
      const client = await connect<Services[K]>(`${name}.do`, {
        token: Deno.env.get("DOTDO_TOKEN"),
      });
      this.cache.set(name, client as RpcProxy<unknown>);
    }
    return this.cache.get(name) as RpcProxy<Services[K]>;
  }

  async disposeAll(): Promise<void> {
    for (const client of this.cache.values()) {
      await client[Symbol.asyncDispose]?.();
    }
    this.cache.clear();
  }
}

// Export singleton
export const services = new ServiceClients();

// Usage
const users = await services.get("users");
const posts = await services.get("posts");
```

### Request Context Pattern

```typescript
import { connect, type ConnectOptions } from "@dotdo/rpc";

interface RequestContext {
  userId?: string;
  requestId: string;
  traceId?: string;
}

function createContextualConnect(ctx: RequestContext) {
  return async function connectWithContext<T>(
    service: string,
    options: ConnectOptions = {},
  ): Promise<RpcProxy<T>> {
    return connect<T>(service, {
      ...options,
      headers: {
        "X-Request-ID": ctx.requestId,
        ...(ctx.userId && { "X-User-ID": ctx.userId }),
        ...(ctx.traceId && { "X-Trace-ID": ctx.traceId }),
        ...options.headers,
      },
    });
  };
}

// Usage in request handler
Deno.serve(async (req) => {
  const ctx: RequestContext = {
    userId: req.headers.get("X-User-ID") ?? undefined,
    requestId: req.headers.get("X-Request-ID") ?? crypto.randomUUID(),
    traceId: req.headers.get("X-Trace-ID") ?? undefined,
  };

  const connect = createContextualConnect(ctx);
  const users = await connect<UserService>("users.do");

  // All calls include context headers
  const user = await users.me();
  return Response.json(user);
});
```

### Circuit Breaker Pattern

```typescript
import { connect, RpcError } from "@dotdo/rpc";

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.options.resetTimeout) {
        this.state = "half-open";
      } else {
        throw new RpcError("Circuit breaker is open", "CIRCUIT_OPEN");
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = "open";
    }
  }

  get currentState(): string {
    return this.state;
  }
}

// Usage
const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
});

const users = await connect<UserService>("users.do");

async function getUserSafe(id: string): Promise<User | null> {
  try {
    return await breaker.execute(() => users.get(id));
  } catch (error) {
    if (error instanceof RpcError && error.code === "CIRCUIT_OPEN") {
      console.warn("Circuit breaker is open, returning cached data");
      return null;
    }
    throw error;
  }
}
```

### Batching Pattern

```typescript
import { connect, type MappablePromise } from "@dotdo/rpc";

interface BatchableService {
  getMany(ids: string[]): Promise<User[]>;
}

class BatchingClient<T> {
  private pending = new Map<string, { resolve: (v: T) => void; reject: (e: Error) => void }>();
  private timer: number | null = null;
  private batchFn: (ids: string[]) => Promise<T[]>;

  constructor(batchFn: (ids: string[]) => Promise<T[]>, private delay = 10) {
    this.batchFn = batchFn;
  }

  get(id: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.scheduleBatch();
    });
  }

  private scheduleBatch(): void {
    if (this.timer !== null) return;

    this.timer = setTimeout(async () => {
      this.timer = null;
      const entries = [...this.pending.entries()];
      this.pending.clear();

      const ids = entries.map(([id]) => id);

      try {
        const results = await this.batchFn(ids);
        entries.forEach(([id, { resolve }], index) => {
          resolve(results[index]);
        });
      } catch (error) {
        entries.forEach(([, { reject }]) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }, this.delay);
  }
}

// Usage
const service = await connect<BatchableService>("users.do");
const batcher = new BatchingClient((ids) => service.getMany(ids));

// These will be batched into a single request
const [user1, user2, user3] = await Promise.all([
  batcher.get("1"),
  batcher.get("2"),
  batcher.get("3"),
]);
```

---

## Environment Variables

`@dotdo/rpc` respects these environment variables when used with the higher-level `@dotdo/dotdo` package:

| Variable | Description | Default |
|----------|-------------|---------|
| `DOTDO_API_KEY` | API key for authentication | - |
| `DOTDO_ACCESS_TOKEN` | OAuth access token | - |
| `DOTDO_BASE_URL` | Base URL for API | `https://api.do` |

### Loading from .env

```typescript
// deps.ts
export { load } from "https://deno.land/std@0.220.0/dotenv/mod.ts";

// main.ts
import { load } from "./deps.ts";
import { connect } from "@dotdo/rpc";

// Load .env file
await load({ export: true });

const users = await connect<UserService>("users.do", {
  token: Deno.env.get("DOTDO_TOKEN"),
});
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```typescript
#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Complete @dotdo/rpc example: A task management CLI
 *
 * Run with:
 *   deno run --allow-net --allow-env task_manager.ts
 */

import { connect, RpcError, type MappablePromise } from "@dotdo/rpc";

// ─── Type Definitions ─────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  assignee?: string;
}

interface TaskFilters {
  status?: Task["status"];
  priority?: Task["priority"];
  assignee?: string;
}

interface TaskService {
  // CRUD operations
  create(input: CreateTaskInput): Promise<Task>;
  get(id: string): Promise<Task>;
  update(id: string, data: Partial<Task>): Promise<Task>;
  delete(id: string): Promise<void>;

  // Query operations
  list(filters?: TaskFilters): Promise<Task[]>;
  search(query: string): Promise<Task[]>;

  // Bulk operations
  bulkUpdate(ids: string[], data: Partial<Task>): Promise<Task[]>;
  bulkDelete(ids: string[]): Promise<void>;

  // Statistics
  stats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  }>;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function formatTask(task: Task): string {
  const statusEmoji = {
    pending: "[ ]",
    in_progress: "[~]",
    completed: "[x]",
  }[task.status];

  const priorityLabel = {
    low: "LOW",
    medium: "MED",
    high: "HIGH",
  }[task.priority];

  return `${statusEmoji} [${priorityLabel}] ${task.title} (${task.id})`;
}

async function retry<T>(
  fn: () => Promise<T>,
  attempts: number = 3,
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof RpcError) {
        // Don't retry client errors
        if (error.code.startsWith("HTTP_4")) {
          throw error;
        }
      }

      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 100 * Math.pow(2, i)));
      }
    }
  }

  throw lastError;
}

// ─── Main Application ─────────────────────────────────────────────────────────

async function main() {
  console.log("Task Manager - @dotdo/rpc Demo\n");
  console.log("=".repeat(50));

  // Connect to service
  console.log("\n1. Connecting to tasks.do...");
  const tasks = await connect<TaskService>("tasks.do", {
    token: Deno.env.get("DOTDO_TOKEN"),
    timeout: 10000,
  });
  console.log("   Connected!");

  // Create tasks
  console.log("\n2. Creating sample tasks...");
  const task1 = await retry(() =>
    tasks.create({
      title: "Learn @dotdo/rpc",
      description: "Read the README and try examples",
      priority: "high",
    })
  );
  console.log(`   Created: ${formatTask(task1)}`);

  const task2 = await retry(() =>
    tasks.create({
      title: "Build demo application",
      description: "Create a CLI task manager",
      priority: "medium",
    })
  );
  console.log(`   Created: ${formatTask(task2)}`);

  const task3 = await retry(() =>
    tasks.create({
      title: "Write tests",
      priority: "low",
    })
  );
  console.log(`   Created: ${formatTask(task3)}`);

  // List all tasks
  console.log("\n3. Listing all tasks...");
  const allTasks = await tasks.list();
  console.log(`   Found ${allTasks.length} tasks:`);
  for (const task of allTasks) {
    console.log(`   - ${formatTask(task)}`);
  }

  // Use .map() for transformations
  console.log("\n4. Using MappablePromise.map()...");
  const titles = await tasks.list().map((t) => t.title);
  console.log(`   Titles: ${titles.join(", ")}`);

  const highPriority = await tasks
    .list({ priority: "high" })
    .map((t) => ({ id: t.id, title: t.title }));
  console.log(`   High priority tasks: ${JSON.stringify(highPriority)}`);

  // Update task status
  console.log("\n5. Updating task status...");
  const updated = await tasks.update(task1.id, { status: "in_progress" });
  console.log(`   Updated: ${formatTask(updated)}`);

  // Get statistics
  console.log("\n6. Fetching statistics...");
  const stats = await tasks.stats();
  console.log(`   Total tasks: ${stats.total}`);
  console.log(`   By status: ${JSON.stringify(stats.byStatus)}`);
  console.log(`   By priority: ${JSON.stringify(stats.byPriority)}`);

  // Search
  console.log("\n7. Searching tasks...");
  const searchResults = await tasks.search("demo");
  console.log(`   Found ${searchResults.length} matching tasks`);

  // Error handling demo
  console.log("\n8. Error handling demo...");
  try {
    await tasks.get("nonexistent-task-id");
  } catch (error) {
    if (error instanceof RpcError) {
      console.log(`   Caught RpcError: [${error.code}] ${error.message}`);
    }
  }

  // Cleanup
  console.log("\n9. Cleaning up...");
  await tasks.bulkDelete([task1.id, task2.id, task3.id]);
  console.log("   Deleted all demo tasks");

  // Dispose connection
  await tasks[Symbol.asyncDispose]();
  console.log("\n10. Disconnected from tasks.do");

  console.log("\n" + "=".repeat(50));
  console.log("Demo complete!");
}

// Run
if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error("Fatal error:", error);
    Deno.exit(1);
  }
}
```

Run the example:

```bash
DOTDO_TOKEN=your-token deno run --allow-net --allow-env task_manager.ts
```

---

## API Reference

### Module Exports

```typescript
// Main entry point
export { connect } from "@dotdo/rpc";

// Types
export type { ConnectOptions, RpcProxy, MappablePromise } from "@dotdo/rpc";

// Error class
export { RpcError } from "@dotdo/rpc";
```

### connect()

```typescript
function connect<T>(
  service: string,
  options?: ConnectOptions,
): Promise<RpcProxy<T>>
```

Create a new RPC client for a `.do` service.

**Parameters:**
- `service` - Service name (e.g., `"users.do"`) or full URL
- `options` - Optional connection configuration

**Returns:** A typed `RpcProxy<T>` instance

### ConnectOptions

```typescript
interface ConnectOptions {
  /** Base URL for the DotDo platform (defaults to https://api.do) */
  baseUrl?: string;
  /** Authentication token */
  token?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}
```

### RpcProxy<T>

```typescript
type RpcProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => MappablePromise<Awaited<R>>
    : T[K] extends object
    ? RpcProxy<T[K]>
    : never;
} & AsyncDisposable;
```

A typed proxy that enables RPC calls with full TypeScript support.

### MappablePromise<T>

```typescript
type MappablePromise<T> = Promise<T> & {
  map<U>(
    fn: T extends (infer E)[] ? (item: E, index: number) => U : (value: T) => U,
  ): MappablePromise<T extends unknown[] ? U[] : U>;
};
```

Extended Promise with `.map()` method for transformations.

### RpcError

```typescript
class RpcError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown);
}
```

Error class for RPC failures with structured error codes.

---

## Related Packages

| Package | Registry | Description |
|---------|----------|-------------|
| [@dotdo/capnweb](https://jsr.io/@dotdo/capnweb) | JSR | Low-level Cap'n Web protocol |
| [@dotdo/dotdo](https://jsr.io/@dotdo/dotdo) | JSR | Full platform SDK with pooling |
| [rpc.do](https://npmjs.com/package/rpc.do) | npm | TypeScript/Node.js version |
| [rpc-do](https://pypi.org/project/rpc-do) | PyPI | Python version |
| [rpc-do](https://crates.io/crates/rpc-do) | crates.io | Rust version |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Deno-native** | URL imports, explicit permissions, native TypeScript |
| **Zero configuration** | Sensible defaults, convention over configuration |
| **Type-safe** | Full TypeScript inference, no codegen required |
| **Minimal API** | One main function: `connect()` |
| **Composable** | Works with Deno's standard library patterns |
| **Testable** | Easy mocking, integration test support |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.

For Deno-specific contributions:

```bash
# Clone the repository
git clone https://github.com/dot-do/sdks
cd sdks/packages/deno/rpc

# Run tests
deno task test

# Type check
deno task check

# Lint
deno task lint

# Format
deno task fmt
```
