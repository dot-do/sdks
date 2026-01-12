# capnweb

[![deno.land/x](https://shield.deno.dev/x/capnweb)](https://deno.land/x/capnweb)

**Deno-native capability-based RPC. URL imports. Web standards. Zero config.**

```typescript
const user = await api.users.get(123).profile.name;
```

One line. One round-trip. Full type safety.

---

## The Deno Way

Cap'n Web embraces everything that makes Deno great:

- **URL imports** - No package.json, no node_modules, just import from a URL
- **Top-level await** - Connect at module scope, write cleaner scripts
- **Web standards** - AbortController, EventTarget, URL, WebSocket - no polyfills
- **TypeScript-first** - Full type inference without configuration
- **Explicit resources** - `using` declarations for automatic cleanup
- **Permissions** - Works with Deno's security model

```typescript
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Top-level await - connect at module scope
const api = await rpc<Api>("wss://api.example.com");

// Pipelining is automatic. This entire chain is ONE round-trip:
const userName = await api.users.get(123).profile.name;

console.log(`Hello, ${userName}!`);
```

```bash
deno run --allow-net=api.example.com app.ts
```

---

## Installation

### URL Import (Recommended)

```typescript
import { rpc, RpcTarget, RpcError } from "https://deno.land/x/capnweb@1.0.0/mod.ts";
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
import { Session } from "capnweb/session.ts";
```

---

## Quick Start

### Basic Usage

```typescript
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Connect via WebSocket
const api = await rpc("wss://api.example.com");

// Call remote methods
const greeting = await api.greet("World");
console.log(greeting);  // "Hello, World!"

// Navigate nested services
const user = await api.users.get(123);
console.log(user.name);
```

### With Type Safety

Define interfaces for full autocomplete and compile-time checking.

```typescript
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

interface Api {
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
  profile: Profile;
}

interface Profile {
  bio: string;
  avatar: string;
}

interface CreateUserInput {
  name: string;
  email: string;
}

// Full type inference
const api = await rpc<Api>("wss://api.example.com");
const user = await api.users.get(123);     // User
const name = user.name;                     // string
const bio = await api.users.get(123).profile.bio;  // string
```

---

## Connecting

The `rpc()` function is the primary entry point.

```typescript
// WebSocket (real-time, bidirectional)
const api = await rpc<Api>("wss://api.example.com");

// HTTP batch mode (auto-detected from protocol)
const api = await rpc<Api>("https://api.example.com/rpc");

// With URL object
const api = await rpc<Api>(new URL("wss://api.example.com"));
```

### Connection Options

```typescript
const api = await rpc<Api>("wss://api.example.com", {
  // Authentication
  headers: {
    "Authorization": `Bearer ${Deno.env.get("API_TOKEN")}`,
  },

  // Timeout using web-standard AbortSignal
  signal: AbortSignal.timeout(30_000),

  // Auto-reconnection
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    backoff: "exponential",
  },
});
```

---

## Pipelining

Pipelining sends dependent calls without waiting for intermediate results. One round-trip instead of many.

### The Problem

```typescript
// WITHOUT pipelining: 3 round-trips
const session = await api.authenticate(token);     // Round trip 1
const userId = await session.getUserId();          // Round trip 2
const profile = await api.profiles.get(userId);    // Round trip 3
```

### The Solution

Just don't await intermediate results. Pipelining is automatic.

```typescript
// WITH pipelining: 1 round-trip
const session = api.authenticate(token);    // Promise (not awaited)
const userId = session.getUserId();         // Pipelined
const profile = api.profiles.get(userId);   // Uses userId without await

// Await only the final result
const profileData = await profile;
```

### Parallel Requests

Use web-standard `Promise.all()` for concurrent operations.

```typescript
const [user, notifications, settings] = await Promise.all([
  api.users.get(123),
  api.notifications.recent(10),
  api.settings.get(),
]);
```

### The `map()` Operation

Transform arrays server-side in a single round trip.

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

The `map()` operation uses the protocol's `remap` instruction to execute the mapping function on the server, returning only the transformed results.

---

## Error Handling

### Exception-Based Errors

```typescript
import { rpc, RpcError, ConnectionError } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

try {
  const result = await api.riskyOperation();
} catch (error) {
  if (error instanceof RpcError) {
    // Remote error with full context
    console.error(`RPC failed: ${error.message}`);
    console.error(`Type: ${error.type}`);      // "NotFound", "Unauthorized", etc.
    console.error(`Details:`, error.details);  // Additional error data
  } else if (error instanceof ConnectionError) {
    console.error(`Connection lost: ${error.message}`);
    console.error(`Code: ${error.code}`);      // "CLOSED", "TIMEOUT", "REFUSED"
  } else {
    throw error;
  }
}
```

### Cancellation with AbortController

Web-standard cancellation that propagates to the server.

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
const timeoutId = setTimeout(() => controller.abort(), 5_000);

try {
  const result = await api.slowOperation({ signal: controller.signal });
  clearTimeout(timeoutId);
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Request cancelled");
  }
}

// Or use the built-in timeout signal
const result = await api.operation({ signal: AbortSignal.timeout(5_000) });
```

### Connection Events

The API stub implements EventTarget for connection lifecycle events.

```typescript
api.addEventListener("error", (event) => {
  console.error("Connection error:", event.error);
});

api.addEventListener("close", (event) => {
  console.log("Connection closed:", event.reason);
});

api.addEventListener("reconnect", (event) => {
  console.log(`Reconnected after ${event.attempts} attempts`);
});
```

---

## Exposing Local Objects

Pass local objects to remote methods for bidirectional RPC.

### Class-Based Targets

```typescript
import { RpcTarget } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

class Calculator extends RpcTarget {
  #memory = 0;  // Private fields are never exposed

  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  async compute(expression: string): Promise<number> {
    // Async methods work seamlessly
    await new Promise((r) => setTimeout(r, 100));
    // Parse and evaluate the expression safely
    return this.parseExpression(expression);
  }

  private parseExpression(expr: string): number {
    // Simple expression parser (add/multiply only)
    const parts = expr.split("+").map((p) => p.trim());
    return parts.reduce((sum, part) => {
      const factors = part.split("*").map((f) => parseFloat(f.trim()));
      return sum + factors.reduce((prod, f) => prod * f, 1);
    }, 0);
  }

  get memory(): number {
    return this.#memory;
  }

  set memory(value: number) {
    this.#memory = value;
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

For simple handlers, use the `target()` helper.

```typescript
import { target } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

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

### Using Declaration (Recommended)

Deno fully supports `using` declarations for automatic cleanup.

```typescript
{
  await using api = await rpc<Api>("wss://api.example.com");

  const user = await api.users.get(123);
  console.log(user.name);

}  // Connection automatically closed here
```

### Explicit Disposal

```typescript
const api = await rpc<Api>("wss://api.example.com");

try {
  const user = await api.users.get(123);
  console.log(user.name);
} finally {
  await api[Symbol.asyncDispose]();
}
```

### Reference Counting

The protocol tracks references to remote objects. When you drop a reference (by letting it go out of scope or explicitly releasing it), the server is notified via a `release` message. This enables automatic garbage collection of server-side resources.

```typescript
{
  const session = await api.authenticate(token);
  // session reference is live on server
}
// session goes out of scope -> server receives release -> may garbage collect
```

---

## Server-Side Usage

### Deno.serve

Build RPC servers with Deno's built-in HTTP server.

```typescript
import { serve, RpcTarget } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Define your API implementation
class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  users = new UsersService();
}

class UsersService extends RpcTarget {
  #users = new Map<number, User>();

  get(id: number): User | null {
    return this.#users.get(id) ?? null;
  }

  create(name: string, email: string): User {
    const id = this.#users.size + 1;
    const user = { id, name, email };
    this.#users.set(id, user);
    return user;
  }

  list(): User[] {
    return [...this.#users.values()];
  }
}

interface User {
  id: number;
  name: string;
  email: string;
}

// Serve over WebSocket
Deno.serve({ port: 8080 }, (req) => {
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    serve(socket, new MyApi());
    return response;
  }
  return new Response("Cap'n Web RPC Server", { status: 200 });
});

console.log("Server running on http://localhost:8080");
```

### HTTP Batch Endpoint

For stateless HTTP batch requests.

```typescript
import { handleBatch, RpcTarget } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

class MyApi extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

const api = new MyApi();

Deno.serve({ port: 8080 }, async (req) => {
  if (req.method === "POST" && new URL(req.url).pathname === "/rpc") {
    const body = await req.json();
    const result = await handleBatch(api, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("Not Found", { status: 404 });
});
```

### Deno Deploy

Cap'n Web works seamlessly with Deno Deploy for edge RPC.

```typescript
// main.ts - Deploy this to Deno Deploy
import { handleBatch, RpcTarget } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

class EdgeApi extends RpcTarget {
  // Access Deno Deploy KV
  async get(key: string): Promise<string | null> {
    const kv = await Deno.openKv();
    const result = await kv.get<string>(["data", key]);
    return result.value;
  }

  async set(key: string, value: string): Promise<void> {
    const kv = await Deno.openKv();
    await kv.set(["data", key], value);
  }

  // Edge location info
  location(): { region: string } {
    return { region: Deno.env.get("DENO_REGION") ?? "unknown" };
  }
}

const api = new EdgeApi();

Deno.serve(async (req) => {
  // Handle CORS for browser clients
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const result = await handleBatch(api, body);
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return new Response("Cap'n Web Edge API", { status: 200 });
});
```

### Fresh Framework Integration

Use Cap'n Web with the Fresh web framework.

```typescript
// routes/api/rpc.ts
import { Handlers } from "$fresh/server.ts";
import { handleBatch, RpcTarget } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

class FreshApi extends RpcTarget {
  hello(name: string): string {
    return `Hello from Fresh, ${name}!`;
  }
}

const api = new FreshApi();

export const handler: Handlers = {
  async POST(req) {
    const body = await req.json();
    const result = await handleBatch(api, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
```

---

## Session API

For applications requiring explicit control over connection lifecycle.

```typescript
import { Session } from "https://deno.land/x/capnweb@1.0.0/session.ts";

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
const api = session.stub<Api>();

// Access session metadata
console.log(`Latency: ${session.latency}ms`);
console.log(`Messages sent: ${session.stats.messagesSent}`);
console.log(`Messages received: ${session.stats.messagesReceived}`);

// Check connection state
if (session.isConnected) {
  const result = await api.operation();
}

// Manual reconnection
await session.reconnect();

// Cleanup
await session.close();
```

### Using with Resource Management

```typescript
import { Session } from "https://deno.land/x/capnweb@1.0.0/session.ts";

await using session = await Session.connect("wss://api.example.com");
const api = session.stub<Api>();

const user = await api.users.get(123);
// Session automatically closed when block exits
```

### Explicit Batching

Control exactly when requests are sent.

```typescript
import { Session } from "https://deno.land/x/capnweb@1.0.0/session.ts";

await using session = await Session.connect("wss://api.example.com");
const api = session.stub<Api>();

// Explicit batch block
const results = await session.batch(async () => {
  // All calls in this block are batched into a single request
  const auth = api.authenticate(token);
  const profile = api.profiles.get(auth.userId);
  const notifications = auth.notifications.recent(10);

  return { profile, notifications };
});

console.log(results.profile);
console.log(results.notifications);
```

---

## Deno Permissions

Cap'n Web respects Deno's security model. Specify only the permissions you need.

```bash
# Single host (recommended for production)
deno run --allow-net=api.example.com app.ts

# Multiple hosts
deno run --allow-net=api.example.com,auth.example.com app.ts

# With environment variables for tokens
deno run --allow-net=api.example.com --allow-env=API_TOKEN app.ts

# Development: all network access
deno run --allow-net app.ts
```

### Permission Prompts

With `--prompt`, Deno asks for permissions at runtime.

```bash
deno run --prompt app.ts
# Deno will prompt: "Allow network access to api.example.com? [y/n]"
```

---

## Protocol Details

Cap'n Web implements the full Cap'n Proto CapTP-inspired protocol over JSON.

### Import/Export Tables

Each side of an RPC session maintains import and export tables:

- **Imports**: Remote objects you've received references to
- **Exports**: Local objects you've shared with the remote side

IDs are assigned sequentially:
- Positive IDs (1, 2, 3...): Chosen by the importing side (call results)
- Negative IDs (-1, -2, -3...): Chosen by the exporting side (stub references)
- ID 0: The "main" interface (bootstrap capability)

### Message Types

| Message | Description |
|---------|-------------|
| `push` | Evaluate an expression, assign result to import ID |
| `pull` | Request resolution of an import as a `resolve` message |
| `resolve` | Send the resolved value for an export |
| `reject` | Send an error for an export |
| `release` | Release an import (with reference count) |
| `abort` | Terminate the session with an error |

### The `remap` Instruction

The `map()` operation compiles to a `remap` instruction:

```typescript
// This code:
const names = await api.users.list().map((user) => user.name);

// Generates a remap instruction with:
// - Source: api.users.list()
// - Captures: [] (no external references)
// - Instructions: [["import", 0, ["name"]]]  // Get .name from input
```

For maps that reference external stubs:

```typescript
// This code:
const enriched = await api.userIds.map((id) => ({
  id,
  profile: api.profiles.get(id),
}));

// Generates a remap instruction with:
// - Source: api.userIds
// - Captures: [["import", profilesImportId]]  // Capture api.profiles
// - Instructions that call the captured profiles service
```

---

## Complete Example

```typescript
import {
  rpc,
  RpcTarget,
  RpcError,
  ConnectionError,
} from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// ─── Type Definitions ─────────────────────────────────────────────────

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
  subscribe(handler: NotificationHandler): void;
}

interface NotificationHandler {
  onNotification(notification: Notification): void;
}

interface User {
  id: number;
  name: string;
  email: string;
}

interface Notification {
  id: number;
  message: string;
  timestamp: Date;
}

// ─── Event Handler ────────────────────────────────────────────────────

class MyNotificationHandler extends RpcTarget implements NotificationHandler {
  onNotification(notification: Notification): void {
    console.log(`[${notification.timestamp}] ${notification.message}`);
  }

  [Symbol.dispose](): void {
    console.log("Handler disposed");
  }
}

// ─── Main Application ─────────────────────────────────────────────────

const token = Deno.env.get("API_TOKEN");
if (!token) {
  console.error("API_TOKEN environment variable required");
  Deno.exit(1);
}

// Connect with automatic cleanup
{
  await using api = await rpc<Api>("wss://api.example.com", {
    headers: { "X-Client": "deno" },
    signal: AbortSignal.timeout(60_000),
  });

  try {
    // Pipeline: authenticate and fetch data in one round trip
    const auth = api.authenticate(token);
    const userId = auth.getUserId();
    const user = api.users.get(userId);
    const notifications = auth.notifications.recent(5);

    // Await results with Promise.all
    const [userData, notifs] = await Promise.all([user, notifications]);
    console.log(`Welcome, ${userData.name}!`);
    console.log(`You have ${notifs.length} notifications`);

    // Subscribe to real-time updates
    const handler = new MyNotificationHandler();
    await auth.notifications.subscribe(handler);

    // Fetch all users with map operation
    const allUsers = await api.users.list();
    console.log(`Total users: ${allUsers.length}`);

    // Keep connection alive for real-time updates
    console.log("Listening for notifications... (Ctrl+C to exit)");
    await new Promise((resolve) => {
      Deno.addSignalListener("SIGINT", () => resolve(undefined));
    });

  } catch (error) {
    if (error instanceof RpcError) {
      console.error(`API Error [${error.type}]: ${error.message}`);
    } else if (error instanceof ConnectionError) {
      console.error(`Connection Error [${error.code}]: ${error.message}`);
    } else {
      throw error;
    }
  }
}

console.log("Connection closed");
```

Run with:

```bash
deno run --allow-net=api.example.com --allow-env=API_TOKEN app.ts
```

---

## Functional Utilities

Optional functional composition helpers.

```typescript
import { pipe, map, filter, retry } from "https://deno.land/x/capnweb@1.0.0/fn.ts";

// Retry with exponential backoff
const user = await retry(() => api.users.get(123), {
  attempts: 3,
  delay: 1_000,
  backoff: 2,
});

// Compose transformations
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
  mod.ts           # Main exports: rpc(), RpcTarget, target(), serve()
  session.ts       # Session API for explicit control
  fn.ts            # Functional utilities: pipe, map, filter, retry
  errors.ts        # RpcError, ConnectionError, TimeoutError
  types.ts         # Type definitions
```

### Exports

```typescript
// mod.ts - Primary API
export { rpc, serve, handleBatch } from "./rpc.ts";
export { RpcTarget, target } from "./target.ts";
export { RpcError, ConnectionError, TimeoutError } from "./errors.ts";
export type { RpcStub, RpcPromise, RpcOptions } from "./types.ts";
```

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

### `serve(socket, target): void`

Serve an RPC target over a WebSocket connection.

| Parameter | Type | Description |
|-----------|------|-------------|
| `socket` | `WebSocket` | Deno WebSocket from `Deno.upgradeWebSocket()` |
| `target` | `RpcTarget` | The API implementation to serve |

### `handleBatch(target, messages): Promise<unknown[]>`

Handle HTTP batch RPC requests.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `RpcTarget` | The API implementation |
| `messages` | `unknown[]` | Array of RPC messages from request body |

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
  stack: string;      // Remote stack trace (if enabled)
  details?: unknown;  // Additional error data
}
```

### `ConnectionError`

Network-level connection failure.

```typescript
class ConnectionError extends Error {
  code: "CLOSED" | "TIMEOUT" | "REFUSED";
}
```

---

## Design Principles

| Decision | Rationale |
|----------|-----------|
| URL-first connection | Feels native to Deno's import system |
| Web standards everywhere | AbortController, EventTarget, URL - no polyfills |
| Invisible pipelining | Don't await, and it pipelines automatically |
| `using` declarations | Explicit resource management for cleanup |
| TypeScript generics | Full type inference without code generation |
| Zero dependencies | Pure Deno with web standards only |
| Progressive complexity | Simple `rpc()` for scripts, `Session` for apps |

---

## License

MIT
