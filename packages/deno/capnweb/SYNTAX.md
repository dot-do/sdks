# Cap'n Web Deno Client: Syntax Exploration

This document explores four divergent approaches to designing a Deno-native client for Cap'n Web RPC. Each approach leverages Deno's unique features while optimizing for different trade-offs between ergonomics, type safety, and idiomatic patterns.

---

## Background: What Makes Deno Unique

Deno brings distinct features that shape API design:

- **URL-based imports**: No package.json, direct URL imports from deno.land/x or CDNs
- **Top-level await**: Module-level async operations without wrapping in functions
- **Built-in TypeScript**: First-class TypeScript support without configuration
- **Permissions model**: Explicit `--allow-net` for network access
- **Web-standard APIs**: Native `fetch`, `WebSocket`, `Request`/`Response`, no polyfills needed
- **Import maps**: Optional `deno.json` for aliasing imports
- **Explicit resource management**: Full support for `using` declarations
- **No CommonJS**: ESM-only, cleaner module semantics

The opportunity: Create an API that feels like it was designed specifically for Deno, leveraging web standards and the modern JavaScript runtime.

---

## Approach 1: URL-First Web Standards (The "Deno Way")

Inspired by Deno's philosophy of leveraging web standards and URL imports directly. Everything feels like native web APIs.

### Philosophy

Treat RPC stubs like enhanced fetch clients. Use web-standard patterns everywhere. Make imports, connections, and APIs feel like they belong in the Deno ecosystem.

### Connection/Session Creation

```typescript
// Direct URL import (no package.json, no node_modules)
import { rpc } from "https://deno.land/x/capnweb@1.0.0/mod.ts";

// Or via import map in deno.json:
// { "imports": { "capnweb/": "https://deno.land/x/capnweb@1.0.0/" } }
import { rpc } from "capnweb/mod.ts";

// Top-level await - connect at module initialization
const api = await rpc("wss://api.example.com");

// Alternative: URL constructor pattern (familiar to Deno users)
const api = await rpc(new URL("wss://api.example.com"));

// HTTP batch mode (auto-detected from protocol)
const api = await rpc("https://api.example.com/rpc");

// With options using Request-like pattern
const api = await rpc("wss://api.example.com", {
  headers: { "X-Custom-Header": "value" },
  signal: AbortSignal.timeout(30_000),
});

// Connection with typed API (generic parameter)
interface MyApi {
  greet(name: string): string;
  users: UserService;
}

const api = await rpc<MyApi>("wss://api.example.com");
```

### Making RPC Calls

```typescript
// Simple call - feels like calling a local function
const greeting = await api.greet("World");
console.log(greeting); // "Hello, World!"

// Property access returns awaitable promises
const userName = await api.currentUser.name;

// Chained navigation
const friends = await api.users.get(123).friends.list();

// Subscript access for dynamic keys
const config = await api.settings["dark-mode"];

// Method with complex arguments
const user = await api.users.create({
  name: "Alice",
  email: "alice@example.com",
  roles: ["admin"],
});
```

### Pipelining Syntax

Pipelining is invisible - just don't await intermediate results.

```typescript
// All of this is ONE round trip (pipelining happens automatically)
const authedApi = api.authenticate(token);  // RpcPromise, not awaited
const userId = authedApi.getUserId();       // Pipelined
const profile = api.profiles.get(userId);   // Uses userId without await

// Await only what you need
const profileData = await profile;

// Batch multiple results with Promise.all (web standard)
const [userProfile, notifications] = await Promise.all([
  api.profiles.get(userId),
  authedApi.notifications.recent(10),
]);

// The magic .map() - transform arrays in a single round trip
const userIds = api.listUserIds();
const profiles = await userIds.map((id) => ({
  id,
  profile: api.profiles.get(id),
}));
```

### Error Handling

```typescript
import { RpcError, ConnectionError } from "capnweb/mod.ts";

try {
  const result = await api.dangerousOperation();
} catch (error) {
  if (error instanceof RpcError) {
    // Remote error with full context
    console.error(`RPC failed: ${error.message}`);
    console.error(`Remote type: ${error.type}`);  // e.g., "TypeError"
    console.error(`Stack: ${error.stack}`);
  } else if (error instanceof ConnectionError) {
    console.error(`Connection lost: ${error.message}`);
  } else {
    throw error;
  }
}

// AbortController integration (web standard)
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  const result = await api.slowOperation({ signal: controller.signal });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Request was aborted");
  }
}

// Connection health monitoring
api.addEventListener("error", (event) => {
  console.error("Connection error:", event.error);
});

api.addEventListener("close", (event) => {
  console.log("Connection closed:", event.reason);
});
```

### Exposing Local Objects as RPC Targets

```typescript
import { RpcTarget } from "capnweb/mod.ts";

// Extend RpcTarget to create an exportable object
class Calculator extends RpcTarget {
  #memory = 0;  // Private field (never exposed over RPC)

  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }

  // Async methods work seamlessly
  async compute(expression: string): Promise<number> {
    // Simulate async computation
    await new Promise((r) => setTimeout(r, 100));
    return eval(expression);  // Don't actually do this!
  }

  // Properties are exposed as remote properties
  get memory(): number {
    return this.#memory;
  }

  set memory(value: number) {
    this.#memory = value;
  }

  // Cleanup when all references are released
  [Symbol.dispose](): void {
    console.log("Calculator disposed");
  }
}

// Pass to remote as callback
const calc = new Calculator();
await api.registerCalculator(calc);

// Server can now call methods on calc
```

### Type Hints Support

```typescript
// Define interfaces for full IDE support
interface UserApi {
  get(id: number): Promise<User>;
  list(): Promise<User[]>;
  create(data: CreateUserInput): Promise<User>;
}

interface User {
  id: number;
  name: string;
  email: string;
  profile: ProfileApi;
}

interface ProfileApi {
  getName(): Promise<string>;
  updateBio(bio: string): Promise<void>;
}

// Typed connection - full autocomplete and type checking
const api = await rpc<{ users: UserApi }>("wss://api.example.com");

// IDE knows all the types
const user = await api.users.get(123);
const name = await user.profile.getName();  // Inferred as string
```

### Pros & Cons

**Pros:**
- Feels native to Deno ecosystem
- Leverages web standards (AbortController, EventTarget, URL)
- Minimal API surface - just `rpc()` and `RpcTarget`
- Top-level await makes simple scripts elegant
- Familiar patterns for web developers

**Cons:**
- Less explicit about batching behavior
- Some users may want more control over connection lifecycle
- Event-based error handling may feel less TypeScript-idiomatic

---

## Approach 2: Explicit Session Manager (The "Control" Way)

Inspired by database connection pools and explicit resource management. Every operation has clear semantics and lifecycle.

### Philosophy

Be explicit about connection state, batching, and resource ownership. Let developers control exactly when requests are sent.

### Connection/Session Creation

```typescript
import { Session, WebSocketTransport, HttpBatchTransport } from "capnweb/session.ts";

// Explicit session creation with transport selection
const session = new Session({
  transport: new WebSocketTransport("wss://api.example.com"),
  timeout: 30_000,
  reconnect: {
    enabled: true,
    maxAttempts: 5,
    backoff: "exponential",
  },
});

// Must explicitly connect
await session.connect();

// Get typed stub
const api = session.stub<MyApi>();

// Use, then cleanup
await session.close();

// Or use explicit resource management
{
  using session = await Session.connect("wss://api.example.com");
  const api = session.stub<MyApi>();
  // ... use api ...
}  // Automatically closed here

// HTTP batch with explicit batch control
const batch = await Session.batch("https://api.example.com/rpc");
// ... add calls ...
const results = await batch.execute();  // Explicit send
```

### Making RPC Calls

```typescript
using session = await Session.connect("wss://api.example.com");
const api = session.stub<MyApi>();

// Simple call
const greeting = await api.greet("Alice");

// Check connection state before operations
if (session.isConnected) {
  const result = await api.operation();
}

// Access session metadata
console.log(`Connected to: ${session.remoteAddress}`);
console.log(`Latency: ${session.latency}ms`);
console.log(`Messages sent: ${session.stats.messagesSent}`);
```

### Pipelining Syntax

Explicit batch blocks make pipelining visible.

```typescript
using session = await Session.connect("wss://api.example.com");
const api = session.stub<MyApi>();

// Implicit pipelining (same as Approach 1)
const profile = await api.authenticate(token).getProfile();

// Explicit batch block for complex scenarios
const results = await session.batch(async (batch) => {
  const auth = batch.call(api.authenticate, token);
  const profile = batch.call(api.profiles.get, auth.userId);
  const notifications = batch.call(auth.notifications.recent, 10);

  // Specify what to return
  return { profile, notifications };
});

console.log(results.profile);
console.log(results.notifications);

// Or use pipeline builder
const profile = await session.pipeline()
  .call(api.authenticate, token)
  .then((auth) => api.profiles.get(auth.userId))
  .execute();
```

### The `map()` Operation

```typescript
using session = await Session.connect("wss://api.example.com");
const api = session.stub<MyApi>();

// Standard map (single round trip)
const names = await api.users.list().map((user) => user.name);

// With explicit capture list (for clarity)
const enriched = await api.userIds.map(
  (id) => ({
    id,
    profile: api.profiles.get(id),
    avatar: api.avatars.get(id),
  }),
  { captures: [api.profiles, api.avatars] }
);

// Filter + map combination
const activeEmails = await api.users.list()
  .filter((user) => user.isActive)
  .map((user) => user.email);
```

### Error Handling

```typescript
import {
  Session,
  RpcError,
  TimeoutError,
  ConnectionLostError,
  DisconnectedError,
} from "capnweb/session.ts";

using session = await Session.connect("wss://api.example.com");
const api = session.stub<MyApi>();

// Typed error handling
try {
  const result = await api.riskyOperation();
} catch (error) {
  switch (true) {
    case error instanceof TimeoutError:
      console.error(`Operation timed out after ${error.timeout}ms`);
      break;
    case error instanceof ConnectionLostError:
      console.error(`Connection lost: ${error.message}`);
      // Optionally reconnect
      await session.reconnect();
      break;
    case error instanceof RpcError:
      if (error.isType("NotFoundError")) {
        console.error("Resource not found");
      } else if (error.isType("ValidationError")) {
        console.error(`Validation failed: ${error.details}`);
      }
      break;
    default:
      throw error;
  }
}

// Session-level error handling
session.onError((error) => {
  console.error("Session error:", error);
});

session.onDisconnect((reason) => {
  console.log("Disconnected:", reason);
});

// Retry helper
import { retry } from "capnweb/retry.ts";

const result = await retry(
  () => api.flakyOperation(),
  {
    attempts: 3,
    delay: 1000,
    backoff: 2,
    retryIf: (error) => error instanceof TimeoutError,
  }
);
```

### Exposing Local Objects as RPC Targets

```typescript
import { RpcTarget, expose, hidden } from "capnweb/target.ts";

@expose  // Class decorator marks all public methods as exposed
class GameState extends RpcTarget {
  score = 0;
  #secretKey = "abc123";  // Never exposed

  getScore(): number {
    return this.score;
  }

  addPoints(points: number): void {
    this.score += points;
  }

  @hidden  // Explicitly hide even public methods
  resetForTesting(): void {
    this.score = 0;
  }

  // Disposal callback
  override [Symbol.dispose](): void {
    console.log("GameState disposed");
  }
}

// Alternative: Function-based targets
const handler = RpcTarget.from({
  onMessage(message: string): void {
    console.log(`Received: ${message}`);
  },
  onError(error: string): void {
    console.error(`Error: ${error}`);
  },
});

// Register with remote
await api.subscribe(handler);
```

### Type Hints Support

```typescript
import { Session, RpcStub, RpcPromise } from "capnweb/session.ts";

// Full interface definitions
interface Api {
  users: UserService;
  authenticate(token: string): AuthedApi;
}

interface UserService {
  get(id: number): User;
  list(): User[];
}

interface AuthedApi {
  getUserId(): number;
  notifications: NotificationService;
}

// Typed session
using session = await Session.connect<Api>("wss://api.example.com");

// Full type inference
const api: RpcStub<Api> = session.stub();
const auth: RpcPromise<AuthedApi> = api.authenticate(token);
const userId: RpcPromise<number> = auth.getUserId();
```

### Pros & Cons

**Pros:**
- Complete control over connection lifecycle
- Explicit batching for complex scenarios
- Clear separation of concerns (transport, session, stub)
- Better for long-running applications
- Rich session metadata and statistics

**Cons:**
- More verbose for simple use cases
- Learning curve for batch API
- More imports required

---

## Approach 3: Functional Composition (The "FP" Way)

Inspired by functional programming patterns. Stubs are immutable, operations compose cleanly, and side effects are explicit.

### Philosophy

Treat RPC operations as composable transformations. Emphasize immutability, pure functions, and explicit effect handling. Perfect for developers who prefer functional patterns.

### Connection/Session Creation

```typescript
import { connect, pipe, batch } from "capnweb/fn.ts";

// connect returns a stub factory
const createApi = await connect("wss://api.example.com");

// Create typed stub
const api = createApi<MyApi>();

// HTTP batch is explicit
const api = await batch("https://api.example.com/rpc")<MyApi>();

// Functional options pattern
const createApi = await pipe(
  connect("wss://api.example.com"),
  withTimeout(30_000),
  withRetry({ attempts: 3 }),
  withLogging((msg) => console.log(msg)),
);

const api = createApi<MyApi>();
```

### Making RPC Calls

```typescript
import { call, prop, chain } from "capnweb/fn.ts";

const api = await connect("wss://api.example.com")<MyApi>();

// Direct call (same as other approaches)
const greeting = await api.greet("Alice");

// Functional style with explicit call
const greeting = await call(api, "greet", "Alice");

// Property access as function
const userName = await prop(api, "currentUser", "name");

// Composition of operations
const getUserName = chain(
  call("users", "get"),
  prop("profile"),
  prop("name"),
);

const name = await getUserName(api, 123);

// Applicative style for parallel operations
import { parallel } from "capnweb/fn.ts";

const [profile, settings] = await parallel(
  call(api, "getProfile"),
  call(api, "getSettings"),
);
```

### Pipelining Syntax

Pipeline composition is first-class.

```typescript
import { pipeline, step, fork, join } from "capnweb/fn.ts";

const api = await connect("wss://api.example.com")<MyApi>();

// Pipeline as data structure
const fetchUserData = pipeline(
  step("authenticate", (api, token: string) => api.authenticate(token)),
  step("getProfile", (auth) => auth.getProfile()),
  step("enrichProfile", (profile, api) => ({
    ...profile,
    friends: api.profiles.getFriends(profile.id),
  })),
);

// Execute pipeline
const userData = await fetchUserData.run(api, myToken);

// Fork and join for parallel branches
const fetchAllUserData = pipeline(
  step("auth", (api, token: string) => api.authenticate(token)),
  fork({
    profile: (auth) => auth.getProfile(),
    notifications: (auth) => auth.notifications.recent(10),
    settings: (auth) => auth.settings.get(),
  }),
  join((results) => ({
    user: results.profile,
    notifs: results.notifications,
    prefs: results.settings,
  })),
);

const allData = await fetchAllUserData.run(api, myToken);
```

### The `map()` Operation

```typescript
import { map, filter, reduce, flatMap } from "capnweb/fn.ts";

const api = await connect("wss://api.example.com")<MyApi>();

// Composable map
const names = await pipe(
  api.users.list(),
  map((user) => user.name),
);

// Filter + map
const activeEmails = await pipe(
  api.users.list(),
  filter((user) => user.isActive),
  map((user) => user.email),
);

// Complex transformation
const enrichedUsers = await pipe(
  api.userIds(),
  map((id) => ({
    id,
    profile: api.profiles.get(id),
  })),
  filter((u) => u.profile.isPublic),
  map((u) => ({
    ...u,
    friends: api.friends.get(u.id),
  })),
);

// Reduce for aggregation
const totalScore = await pipe(
  api.users.list(),
  map((user) => user.score),
  reduce((acc, score) => acc + score, 0),
);
```

### Error Handling

```typescript
import {
  connect,
  tryCatch,
  recover,
  retry,
  Result,
  Ok,
  Err,
} from "capnweb/fn.ts";

const api = await connect("wss://api.example.com")<MyApi>();

// Result type instead of exceptions
const result: Result<User, RpcError> = await tryCatch(
  () => api.users.get(123)
);

// Pattern matching on result
const user = result.match({
  ok: (user) => user,
  err: (error) => defaultUser,
});

// Or use match expression
switch (result.type) {
  case "ok":
    console.log(result.value.name);
    break;
  case "err":
    console.error(result.error.message);
    break;
}

// Recover from specific errors
const user = await pipe(
  tryCatch(() => api.users.get(123)),
  recover("NotFound", () => createDefaultUser()),
);

// Retry with functional composition
const user = await pipe(
  () => api.users.get(123),
  retry({ attempts: 3, delay: 1000 }),
  tryCatch,
);

// Chain error handling
const userData = await pipe(
  tryCatch(() => api.authenticate(token)),
  flatMap((auth) => tryCatch(() => auth.getProfile())),
  flatMap((profile) => tryCatch(() => api.enrich(profile))),
);
```

### Exposing Local Objects as RPC Targets

```typescript
import { target, handler, methods } from "capnweb/fn.ts";

// Function-based target creation
const calculator = target({
  add: (a: number, b: number) => a + b,
  multiply: (a: number, b: number) => a * b,
  async compute(expr: string): Promise<number> {
    await delay(100);
    return eval(expr);
  },
});

// Compose targets
const advancedCalc = target({
  ...methods(calculator),
  power: (base: number, exp: number) => Math.pow(base, exp),
  sqrt: (n: number) => Math.sqrt(n),
});

// Handler with lifecycle
const subscription = handler({
  methods: {
    onMessage: (msg: string) => console.log(msg),
    onError: (err: string) => console.error(err),
  },
  dispose: () => console.log("Subscription disposed"),
});

await api.subscribe(subscription);

// Stateful target using closure
const createCounter = () => {
  let count = 0;
  return target({
    increment: () => ++count,
    decrement: () => --count,
    get: () => count,
  });
};

const counter = createCounter();
await api.registerCounter(counter);
```

### Type Hints Support

```typescript
import { connect, pipeline, step, RpcFn } from "capnweb/fn.ts";

// Interface as type constraint
interface UserApi {
  get(id: number): User;
  list(): User[];
}

// Typed pipeline steps
type AuthStep = RpcFn<[token: string], AuthedApi>;
type ProfileStep = RpcFn<[auth: AuthedApi], Profile>;

const fetchProfile = pipeline<[string], Profile>(
  step<AuthStep>("auth", (api, token) => api.authenticate(token)),
  step<ProfileStep>("profile", (auth) => auth.getProfile()),
);

// Full inference
const api = await connect("wss://api.example.com")<{ users: UserApi }>();
const users = await api.users.list();  // User[]
```

### Pros & Cons

**Pros:**
- Highly composable and reusable
- Clear separation of effects
- Result types prevent unhandled errors
- Great for complex data transformations
- Testable (pure functions)

**Cons:**
- Steeper learning curve
- More verbose for simple operations
- May feel unfamiliar to OOP developers
- Pipeline debugging can be challenging

---

## Approach 4: Decorator-Based Schema (The "TypeScript" Way)

Inspired by NestJS, TypeORM, and class-validator. Heavy use of decorators for schema definition with runtime validation.

### Philosophy

Leverage TypeScript decorators for a declarative API. Define interfaces as classes, get automatic validation, and enjoy rich IDE support with minimal boilerplate.

### Connection/Session Creation

```typescript
import { Client, Service, Connect } from "capnweb/decorators.ts";

// Define API schema using decorators
@Service("https://api.example.com")
class ApiClient {
  @Connect()
  static async create(): Promise<ApiClient> {
    // Factory method created by decorator
    throw new Error("Implemented by decorator");
  }
}

// Usage
const api = await ApiClient.create();

// Or with runtime configuration
@Service()
class ApiClient {
  @Connect({ timeout: 30_000, reconnect: true })
  static async create(url: string): Promise<ApiClient> {
    throw new Error("Implemented by decorator");
  }
}

const api = await ApiClient.create("wss://api.example.com");

// Singleton pattern
@Service("wss://api.example.com", { singleton: true })
class ApiClient {
  @Connect()
  static instance: Promise<ApiClient>;
}

// Access singleton
const api = await ApiClient.instance;
```

### Making RPC Calls

```typescript
import { Service, Method, Property, Remote } from "capnweb/decorators.ts";

// Define interface with decorators
@Service("wss://api.example.com")
class UserApi {
  @Method()
  async getUser(id: number): Promise<User> {
    throw new Error("Implemented by decorator");
  }

  @Method()
  async createUser(data: CreateUserInput): Promise<User> {
    throw new Error("Implemented by decorator");
  }

  @Property()
  currentUser!: User;

  // Nested service
  @Remote(() => ProfileApi)
  profiles!: ProfileApi;
}

@Service()
class ProfileApi {
  @Method()
  async get(userId: number): Promise<Profile> {
    throw new Error("Implemented by decorator");
  }

  @Method()
  async update(userId: number, data: Partial<Profile>): Promise<Profile> {
    throw new Error("Implemented by decorator");
  }
}

// Usage - full type safety
const api = await UserApi.create();
const user = await api.getUser(123);
const profile = await api.profiles.get(user.id);
```

### Pipelining Syntax

Decorators enable automatic pipelining detection.

```typescript
import { Service, Method, Pipeline, Batch } from "capnweb/decorators.ts";

@Service("wss://api.example.com")
class Api {
  @Method()
  async authenticate(token: string): Promise<AuthedApi> {
    throw new Error("Implemented by decorator");
  }

  // Mark methods that return pipelineable stubs
  @Pipeline()
  @Method()
  async getAuthenticatedApi(token: string): Promise<AuthedApi> {
    throw new Error("Implemented by decorator");
  }
}

// Automatic pipeline detection
const api = await Api.create();
const auth = api.authenticate(token);     // RpcPromise (not awaited)
const profile = auth.getProfile();        // Pipelined automatically
const result = await profile;

// Explicit batch decorator for HTTP mode
@Batch()
async function fetchUserData(api: Api, token: string) {
  const auth = api.authenticate(token);
  const profile = auth.getProfile();
  const notifications = auth.notifications.recent(10);

  return {
    profile: await profile,
    notifications: await notifications,
  };
}

const data = await fetchUserData(api, myToken);
```

### The `map()` Operation

```typescript
import { Service, Method, Map, MapResult } from "capnweb/decorators.ts";

@Service("wss://api.example.com")
class Api {
  @Method()
  async listUserIds(): Promise<number[]> {
    throw new Error("Implemented by decorator");
  }

  @Method()
  async getProfile(userId: number): Promise<Profile> {
    throw new Error("Implemented by decorator");
  }
}

// Map with type-safe transformation
const api = await Api.create();

// Decorator-based map definition
@Map((id: number, api: Api) => ({
  id,
  profile: api.getProfile(id),
}))
class EnrichUser {
  id!: number;
  profile!: Profile;
}

const enriched: EnrichUser[] = await api.listUserIds().map(EnrichUser);

// Or inline with generic map
const profiles = await api.listUserIds().map((id) => api.getProfile(id));

// Filter support via decorator
@Map((user: User) => user.email)
@Filter((user: User) => user.isActive)
class ActiveUserEmails {}

const emails = await api.users.list().map(ActiveUserEmails);
```

### Error Handling

```typescript
import {
  Service,
  Method,
  Catch,
  Retry,
  Timeout,
  Validate,
} from "capnweb/decorators.ts";

@Service("wss://api.example.com")
class Api {
  // Method-level error handling via decorators
  @Method()
  @Timeout(5000)
  @Retry({ attempts: 3, backoff: "exponential" })
  @Catch(NotFoundError, () => null)
  async getUser(id: number): Promise<User | null> {
    throw new Error("Implemented by decorator");
  }

  // Validation decorator
  @Method()
  @Validate(CreateUserSchema)
  async createUser(data: CreateUserInput): Promise<User> {
    throw new Error("Implemented by decorator");
  }
}

// Schema validation with Zod integration
import { z } from "https://deno.land/x/zod/mod.ts";

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  roles: z.array(z.string()).default([]),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Global error handler
@Service("wss://api.example.com")
@GlobalCatch((error) => {
  console.error("API Error:", error);
  throw error;
})
class Api {
  // ...
}

// Custom error types
@RpcError("USER_NOT_FOUND")
class UserNotFoundError extends Error {
  constructor(public userId: number) {
    super(`User ${userId} not found`);
  }
}
```

### Exposing Local Objects as RPC Targets

```typescript
import { Target, Expose, Hidden, OnDispose } from "capnweb/decorators.ts";

@Target()
class Calculator {
  #memory = 0;

  @Expose()
  add(a: number, b: number): number {
    return a + b;
  }

  @Expose()
  multiply(a: number, b: number): number {
    return a * b;
  }

  // Exposed property
  @Expose()
  get memory(): number {
    return this.#memory;
  }

  @Expose()
  set memory(value: number) {
    this.#memory = value;
  }

  @Hidden()
  resetInternal(): void {
    this.#memory = 0;
  }

  @OnDispose()
  cleanup(): void {
    console.log("Calculator disposed");
  }
}

// Event handler pattern
@Target()
class EventHandler {
  @Expose()
  onMessage(message: string): void {
    console.log(`Received: ${message}`);
  }

  @Expose()
  async onEvent(event: Event): Promise<void> {
    await processEvent(event);
  }
}

// Register target
const calc = new Calculator();
await api.registerCalculator(calc);
```

### Type Hints Support

```typescript
import {
  Service,
  Method,
  Property,
  Remote,
  InferApi,
} from "capnweb/decorators.ts";

// Full type inference from decorators
@Service("wss://api.example.com")
class Api {
  @Method()
  async getUser(id: number): Promise<User> {
    throw new Error();
  }

  @Remote(() => UserService)
  users!: UserService;
}

@Service()
class UserService {
  @Method()
  async list(): Promise<User[]> {
    throw new Error();
  }

  @Method()
  async create(data: CreateUserInput): Promise<User> {
    throw new Error();
  }
}

// Extract types from decorated classes
type ApiType = InferApi<typeof Api>;
type UserServiceType = InferApi<typeof UserService>;

// Full IDE support
const api = await Api.create();
const users = await api.users.list();  // User[]
const user = await api.getUser(123);   // User
```

### Pros & Cons

**Pros:**
- Familiar to NestJS/Angular developers
- Declarative schema definition
- Built-in validation support
- Excellent IDE integration
- Self-documenting code

**Cons:**
- Requires experimental decorators flag
- More boilerplate for simple cases
- Decorator magic can obscure behavior
- Runtime overhead from reflection metadata

---

## Comparison Matrix

| Feature | Approach 1 (Web Standards) | Approach 2 (Session) | Approach 3 (Functional) | Approach 4 (Decorators) |
|---------|---------------------------|---------------------|------------------------|------------------------|
| **Learning Curve** | Low | Medium | High | Medium |
| **Verbosity** | Very Low | Medium | High | Medium |
| **Type Safety** | Good | Excellent | Excellent | Excellent |
| **Pipelining** | Implicit | Explicit/Implicit | Composable | Decorator-controlled |
| **Error Handling** | Exceptions | Exceptions | Result types | Decorators |
| **IDE Support** | Good | Excellent | Good | Excellent |
| **Testability** | Good | Good | Excellent | Good |
| **Deno Integration** | Excellent | Good | Good | Good |
| **Web Standards** | Native | Partial | Minimal | Minimal |
| **Bundle Size** | Minimal | Small | Medium | Medium |
| **Flexibility** | High | Very High | High | Medium |

---

## Recommended Approach: Hybrid of 1 and 2

After analyzing all approaches, the most Deno-idiomatic API combines:

1. **Primary API from Approach 1** - Simple `rpc()` function using web standards
2. **Session control from Approach 2** - For applications needing explicit lifecycle management
3. **Type patterns from all approaches** - Flexible typing that works with or without schemas

### Proposed API

```typescript
// deno.json import map
{
  "imports": {
    "capnweb": "https://deno.land/x/capnweb@1.0.0/mod.ts",
    "capnweb/": "https://deno.land/x/capnweb@1.0.0/"
  }
}
```

```typescript
// Simple usage (Approach 1 style)
import { rpc, RpcTarget } from "capnweb";

// Top-level await for quick scripts
const api = await rpc<MyApi>("wss://api.example.com");

// Pipelining just works
const profile = await api.authenticate(token).getProfile();

// Map in single round trip
const names = await api.users.list().map((u) => u.name);

// Expose local objects
class MyHandler extends RpcTarget {
  onEvent(data: unknown): void {
    console.log(data);
  }
}
await api.subscribe(new MyHandler());
```

```typescript
// Advanced usage (Approach 2 style)
import { Session, WebSocketTransport } from "capnweb/session.ts";

// Explicit session control
using session = new Session({
  transport: new WebSocketTransport("wss://api.example.com"),
  timeout: 30_000,
});

await session.connect();
const api = session.stub<MyApi>();

// Explicit batching
const results = await session.batch(async (batch) => {
  const auth = batch.call(api.authenticate, token);
  const profile = batch.call(auth.getProfile);
  return { profile };
});

// Session events
session.addEventListener("close", () => console.log("Closed"));
session.addEventListener("error", (e) => console.error(e));
```

```typescript
// Functional utilities (Approach 3 style)
import { pipe, map, filter, retry } from "capnweb/fn.ts";

// Compose operations
const activeNames = await pipe(
  api.users.list(),
  filter((u) => u.isActive),
  map((u) => u.name),
);

// Retry with functional composition
const user = await retry(() => api.users.get(123), {
  attempts: 3,
  delay: 1000,
});
```

### Key Design Decisions

1. **URL-based connection** - `rpc("wss://...")` feels native to Deno
2. **Web standards everywhere** - AbortController, EventTarget, URL
3. **Implicit pipelining** - Just don't await, and it pipelines
4. **Explicit resource management** - Full `using` declaration support
5. **Progressive complexity** - Simple API for simple cases, session API for complex ones
6. **TypeScript-first** - Generics and inference work perfectly
7. **No dependencies** - Pure Deno with web standards

### Module Structure

```
capnweb/
  mod.ts           # Main exports: rpc(), RpcTarget, RpcPromise, RpcStub
  session.ts       # Session, Transport classes
  fn.ts            # Functional utilities: pipe, map, filter, retry
  errors.ts        # Error types: RpcError, ConnectionError, etc.
  types.ts         # Type definitions
```

### Permissions

When running with Deno:

```bash
# Minimal permissions for RPC
deno run --allow-net=api.example.com script.ts

# Or with broader network access
deno run --allow-net script.ts
```

---

## Open Questions

1. **Streaming**: How to handle async iterators/streams over RPC?
2. **Cancellation**: Should aborting a request cancel server-side work?
3. **Reconnection**: Automatic reconnect with exponential backoff?
4. **Compression**: WebSocket compression (permessage-deflate)?
5. **Metrics**: Built-in latency/throughput tracking?

---

## Next Steps

1. Implement core `rpc()` function and `RpcTarget` class
2. Add WebSocket and HTTP batch transports
3. Implement pipelining and expression evaluation
4. Add TypeScript type inference for stubs
5. Create comprehensive test suite with Deno.test
6. Publish to deno.land/x as `capnweb`
7. Write documentation with examples

---

*This document explores syntax possibilities for the Deno Cap'n Web client. Implementation details will evolve based on practical experience and community feedback.*
