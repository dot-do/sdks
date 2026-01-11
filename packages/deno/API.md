# Cap'n Web for Deno

A Deno-native RPC client that embraces URL imports, web-standard APIs, and top-level await. Zero dependencies. Zero configuration. Just beautiful, type-safe RPC.

---

## Quick Start

```typescript
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Connect with top-level await
const api = await rpc<MyApi>("wss://api.example.com");

// Call remote methods like local functions
const user = await api.users.get(123);
console.log(user.name);
```

```bash
deno run --allow-net=api.example.com app.ts
```

---

## Installation

### URL Import (Recommended)

```typescript
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";
```

### Import Map

```json
// deno.json
{
  "imports": {
    "capnweb": "https://deno.land/x/capnweb@1.0.0/mod.ts",
    "capnweb/": "https://deno.land/x/capnweb@1.0.0/"
  }
}
```

```typescript
import { rpc } from "capnweb";
```

---

## Core API

### Connecting

The `rpc()` function is the primary entry point. It accepts a URL and returns a typed stub.

```typescript
// WebSocket (real-time, bidirectional)
const api = await rpc<MyApi>("wss://api.example.com");

// HTTP (batch mode, auto-detected from protocol)
const api = await rpc<MyApi>("https://api.example.com/rpc");

// With URL object
const api = await rpc<MyApi>(new URL("wss://api.example.com"));
```

#### Connection Options

```typescript
const api = await rpc<MyApi>("wss://api.example.com", {
  // Custom headers for authentication
  headers: {
    "Authorization": `Bearer ${token}`,
  },

  // Timeout using web-standard AbortSignal
  signal: AbortSignal.timeout(30_000),

  // Reconnection settings
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    backoff: "exponential",
  },
});
```

### Making Calls

Remote methods feel like local function calls.

```typescript
// Simple method call
const greeting = await api.greet("World");

// Nested service access
const user = await api.users.get(123);

// Chained navigation
const friends = await api.users.get(123).friends.list();

// Property access
const userName = await api.currentUser.name;

// Dynamic keys via subscript
const setting = await api.settings["theme.darkMode"];
```

### Type Safety

Define interfaces for full autocomplete and type checking.

```typescript
interface MyApi {
  greet(name: string): string;
  users: UserService;
  currentUser: User;
}

interface UserService {
  get(id: number): User;
  list(): User[];
  create(data: CreateUserInput): User;
}

interface User {
  id: number;
  name: string;
  email: string;
  profile: ProfileService;
}

// Full type inference
const api = await rpc<MyApi>("wss://api.example.com");
const user = await api.users.get(123);  // User
const name = await user.profile.getName();  // string
```

---

## Pipelining

Pipelining is automatic and invisible. Simply avoid awaiting intermediate results.

```typescript
// Three operations, ONE round trip
const auth = api.authenticate(token);      // Not awaited
const userId = auth.getUserId();           // Pipelined
const profile = api.profiles.get(userId);  // Uses userId without await

// Await only the final result
const profileData = await profile;
```

### Parallel Requests

Use the web-standard `Promise.all()` for concurrent operations.

```typescript
const [user, notifications, settings] = await Promise.all([
  api.users.get(123),
  api.notifications.recent(10),
  api.settings.get(),
]);
```

### The `map()` Operation

Transform arrays in a single round trip.

```typescript
// Get all user IDs, then fetch all profiles - ONE round trip
const userIds = api.listUserIds();
const profiles = await userIds.map((id) => api.profiles.get(id));

// Transform with multiple fields
const enriched = await api.userIds.map((id) => ({
  id,
  profile: api.profiles.get(id),
  avatar: api.avatars.get(id),
}));

// Chain transformations
const activeEmails = await api.users.list()
  .filter((user) => user.isActive)
  .map((user) => user.email);
```

---

## Error Handling

### Exception-Based

```typescript
import { rpc, RpcError, ConnectionError } from "capnweb";

try {
  const result = await api.riskyOperation();
} catch (error) {
  if (error instanceof RpcError) {
    console.error(`Remote error: ${error.message}`);
    console.error(`Type: ${error.type}`);  // "ValidationError", "NotFound", etc.
  } else if (error instanceof ConnectionError) {
    console.error(`Connection lost: ${error.message}`);
  } else {
    throw error;
  }
}
```

### Cancellation with AbortController

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5_000);

try {
  const result = await api.slowOperation({ signal: controller.signal });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Request cancelled");
  }
}
```

### Connection Events

```typescript
api.addEventListener("error", (event) => {
  console.error("Connection error:", event.error);
});

api.addEventListener("close", (event) => {
  console.log("Connection closed:", event.reason);
});

api.addEventListener("reconnect", (event) => {
  console.log("Reconnected after", event.attempts, "attempts");
});
```

---

## Exposing Local Objects

Create RPC targets by extending `RpcTarget`.

```typescript
import { RpcTarget } from "capnweb";

class Calculator extends RpcTarget {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  async compute(expression: string): Promise<number> {
    await new Promise((r) => setTimeout(r, 100));
    return evaluate(expression);
  }

  // Cleanup when all remote references are released
  [Symbol.dispose](): void {
    console.log("Calculator disposed");
  }
}

// Pass to remote as callback
const calc = new Calculator();
await api.registerCalculator(calc);

// The remote can now call calc.add(1, 2)
```

### Function-Based Targets

```typescript
import { target } from "capnweb";

const handler = target({
  onMessage(message: string): void {
    console.log(`Received: ${message}`);
  },
  onError(error: string): void {
    console.error(`Error: ${error}`);
  },
});

await api.subscribe(handler);
```

---

## Resource Management

### Explicit Disposal

```typescript
const api = await rpc<MyApi>("wss://api.example.com");

// Use the connection
const user = await api.users.get(123);

// Clean up
await api[Symbol.asyncDispose]();
```

### Using Declaration

```typescript
{
  await using api = await rpc<MyApi>("wss://api.example.com");

  const user = await api.users.get(123);
  console.log(user.name);

}  // Connection automatically closed
```

---

## Advanced: Session API

For applications requiring explicit control over connection lifecycle.

```typescript
import { Session } from "capnweb/session.ts";

// Create session with full configuration
const session = new Session("wss://api.example.com", {
  timeout: 30_000,
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    backoff: "exponential",
  },
});

// Explicit connection
await session.connect();

// Get typed stub
const api = session.stub<MyApi>();

// Access session metadata
console.log(`Latency: ${session.latency}ms`);
console.log(`Messages sent: ${session.stats.messagesSent}`);

// Check connection state
if (session.isConnected) {
  const result = await api.operation();
}

// Manual reconnection
await session.reconnect();

// Cleanup
await session.close();
```

### Explicit Batching

```typescript
import { Session } from "capnweb/session.ts";

await using session = await Session.connect("wss://api.example.com");
const api = session.stub<MyApi>();

// Explicit batch block
const results = await session.batch(async (batch) => {
  const auth = batch.call(api.authenticate, token);
  const profile = batch.call(api.profiles.get, auth.userId);
  const notifications = batch.call(auth.notifications.recent, 10);

  return { profile, notifications };
});

console.log(results.profile);
console.log(results.notifications);
```

---

## Functional Utilities

Optional functional composition helpers.

```typescript
import { pipe, retry } from "capnweb/fn.ts";

// Retry with exponential backoff
const user = await retry(() => api.users.get(123), {
  attempts: 3,
  delay: 1_000,
  backoff: 2,
});

// Compose transformations
import { map, filter } from "capnweb/fn.ts";

const activeNames = await pipe(
  api.users.list(),
  filter((u) => u.isActive),
  map((u) => u.name),
);
```

---

## Module Structure

```
capnweb/
  mod.ts           # Main exports: rpc(), RpcTarget, target()
  session.ts       # Session API for explicit control
  fn.ts            # Functional utilities: pipe, map, filter, retry
  errors.ts        # RpcError, ConnectionError, TimeoutError
  types.ts         # Type definitions
```

### Exports

```typescript
// mod.ts - Primary API
export { rpc } from "./rpc.ts";
export { RpcTarget, target } from "./target.ts";
export { RpcError, ConnectionError, TimeoutError } from "./errors.ts";
export type { RpcStub, RpcPromise, RpcOptions } from "./types.ts";
```

---

## Deno Permissions

```bash
# Minimal: single host
deno run --allow-net=api.example.com app.ts

# Multiple hosts
deno run --allow-net=api.example.com,auth.example.com app.ts

# All network (development only)
deno run --allow-net app.ts
```

---

## Complete Example

```typescript
import { rpc, RpcTarget, RpcError } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Define your API types
interface Api {
  authenticate(token: string): AuthenticatedApi;
  users: UserService;
}

interface AuthenticatedApi {
  getUserId(): number;
  notifications: NotificationService;
}

interface UserService {
  get(id: number): User;
  list(): User[];
}

interface NotificationService {
  recent(count: number): Notification[];
}

interface User {
  id: number;
  name: string;
  email: string;
}

interface Notification {
  id: number;
  message: string;
}

// Event handler for real-time updates
class NotificationHandler extends RpcTarget {
  onNotification(notification: Notification): void {
    console.log(`New notification: ${notification.message}`);
  }

  [Symbol.dispose](): void {
    console.log("Handler disposed");
  }
}

// Main application
const api = await rpc<Api>("wss://api.example.com", {
  headers: { "X-Client": "deno" },
  signal: AbortSignal.timeout(60_000),
});

try {
  // Pipeline: authenticate and fetch data in one round trip
  const auth = api.authenticate(Deno.env.get("API_TOKEN")!);
  const userId = auth.getUserId();
  const user = api.users.get(userId);
  const notifications = auth.notifications.recent(5);

  // Await results
  const [userData, notifs] = await Promise.all([user, notifications]);
  console.log(`Welcome, ${userData.name}!`);
  console.log(`You have ${notifs.length} notifications`);

  // Subscribe to real-time updates
  const handler = new NotificationHandler();
  await auth.notifications.subscribe(handler);

  // Map operation: fetch all users with profiles
  const allUsers = await api.users.list();
  console.log(`Total users: ${allUsers.length}`);

} catch (error) {
  if (error instanceof RpcError) {
    console.error(`API Error [${error.type}]: ${error.message}`);
  } else {
    throw error;
  }
}

// Connection events
api.addEventListener("close", () => {
  console.log("Disconnected from server");
});
```

---

## Design Principles

1. **URL-First**: Connection via URL feels native to Deno's import system
2. **Web Standards**: AbortController, EventTarget, URL, WebSocket - no polyfills
3. **Top-Level Await**: Scripts are clean and readable
4. **Invisible Pipelining**: Don't await, and it pipelines automatically
5. **Explicit Resources**: Full support for `using` declarations
6. **Progressive Complexity**: Simple API for simple cases, Session API for control
7. **TypeScript Native**: Generics and inference work perfectly
8. **Zero Dependencies**: Pure Deno with web standards

---

## API Reference

### `rpc<T>(url, options?): Promise<RpcStub<T>>`

Create a typed RPC client.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string \| URL` | WebSocket (`wss://`) or HTTP (`https://`) endpoint |
| `options.headers` | `Record<string, string>` | Custom headers |
| `options.signal` | `AbortSignal` | Cancellation signal |
| `options.reconnect` | `ReconnectOptions` | Auto-reconnection settings |

### `RpcTarget`

Base class for objects that can be passed to remote methods.

```typescript
class RpcTarget {
  [Symbol.dispose]?(): void;
  [Symbol.asyncDispose]?(): Promise<void>;
}
```

### `target(methods): RpcTarget`

Create an RPC target from a plain object.

```typescript
const handler = target({
  onEvent(data: unknown): void { /* ... */ },
});
```

### `RpcError`

Remote exception with type information.

```typescript
class RpcError extends Error {
  type: string;       // Remote error type name
  stack: string;      // Remote stack trace
  details?: unknown;  // Additional error data
}
```

### `ConnectionError`

Network-level connection failure.

```typescript
class ConnectionError extends Error {
  code: string;  // "CLOSED", "TIMEOUT", "REFUSED"
}
```

---

## License

MIT
