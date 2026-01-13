# DotDo RPC Ecosystem Architecture

This document describes the layered package architecture for the DotDo RPC ecosystem across all supported languages.

## Repository Structure

The ecosystem spans two repositories:

| Repository | Purpose | Contents |
|------------|---------|----------|
| **[dot-do/capnweb](https://github.com/dot-do/capnweb)** | Protocol implementation | Fork of cloudflare/capnweb + ports to 17 languages |
| **[dot-do/sdks](https://github.com/dot-do/sdks)** | Higher-level SDKs | rpc.do, platform.do, oauth.do, domain SDKs |

The capnweb implementations provide the low-level protocol, while this repo (sdks) provides the managed layers that build on top.

## Package Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Application Layer                             │
│   @dotdo/agents    @dotdo/db    @dotdo/mongo    @dotdo/kafka        │
│   Domain-specific APIs that feel native to each language             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                         dotdo (Platform)                             │
│   Managed RPC layer with authentication, connection pooling,         │
│   automatic retries, and configuration management                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                       @dotdo/rpc ($ Proxy)                          │
│   Zero-schema magic proxy with:                                      │
│   • Type-safe property access without codegen                        │
│   • Transparent promise pipelining                                   │
│   • Record/replay for .map() operations                              │
│   • Lazy evaluation and automatic batching                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     @dotdo/capnweb (Protocol)                        │
│   Low-level Cap'n Web protocol implementation:                       │
│   • WebSocket/HTTP transport                                         │
│   • Message encoding/decoding                                        │
│   • Import/export tables                                             │
│   • Reference counting                                               │
└─────────────────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Layer 1: `@dotdo/capnweb` - Protocol Implementation
The direct port of the Cap'n Web protocol. This layer handles:
- Wire protocol encoding/decoding
- WebSocket and HTTP batch transports
- Promise resolution and pipelining at the protocol level
- Import/export table management for capability references
- Reference counting for remote objects

**Users of this layer**: Protocol implementers, debugging tools, custom transports.

### Layer 2: `@dotdo/rpc` - The Magic $ Proxy
The zero-schema, type-safe abstraction that makes RPC feel like local calls:
- **Proxy-based API**: Access any property/method without schema files
- **Promise Pipelining**: Chain calls transparently, single round trip
- **Record/Replay**: `.map()` captures operations and replays on server
- **Type Safety**: Full TypeScript/language type checking at compile time
- **Lazy Evaluation**: Calls batched until awaited

**Users of this layer**: Developers building custom RPC integrations.

### Layer 3: `dotdo` - Platform Package
The managed layer that handles operational concerns:
- **Authentication**: API keys, tokens, mTLS
- **Connection Management**: Pooling, reconnection, load balancing
- **Configuration**: Environment-based config, service discovery
- **Observability**: Logging, metrics, tracing integration
- **Retries**: Automatic retry with backoff for transient failures

**Users of this layer**: Application developers using DotDo services.

### Layer 4: Domain Packages
API-compatible wrappers that feel native to each ecosystem:
- `@dotdo/db` - Database operations
- `@dotdo/mongo` - MongoDB-compatible API
- `@dotdo/kafka` - Kafka-compatible API
- `@dotdo/agents` - AI agent orchestration
- `@dotdo/redis` - Redis-compatible API

**Users of this layer**: Application developers who want drop-in replacements.

## Package Naming by Language

capnweb packages are published from [dot-do/capnweb](https://github.com/dot-do/capnweb).
rpc.do and higher-level packages are published from this repo (dot-do/sdks).

| Language | capnweb | rpc.do | platform.do | domain |
|----------|---------|--------|-------------|--------|
| **TypeScript** | `capnweb` (npm) | `rpc.do` | `dotdo` | `mongo.do` |
| **Python** | `capnweb` (PyPI) | `rpc-do` | `dotdo` | `mongo-do` |
| **Rust** | `capnweb` (crates) | `rpc-do` | `dotdo` | `mongo-do` |
| **Go** | `go.capnweb.dev` | `go.rpc.do` | `go.dotdo.dev` | `go.mongo.do` |
| **Ruby** | `capnweb` (gems) | `rpc.do` | `dotdo` | `mongo.do` |
| **Java** | `dev.capnweb:capnweb` | `do.rpc:sdk` | `do.dotdo:sdk` | `do.mongo:sdk` |
| **Kotlin** | `dev.capnweb:capnweb` | `do.rpc:sdk` | `do.dotdo:sdk` | `do.mongo:sdk` |
| **Scala** | `dev.capnweb::capnweb` | `do.rpc::sdk` | `do.dotdo::sdk` | `do.mongo::sdk` |
| **C#/.NET** | `CapnWeb` (NuGet) | `Rpc.Do` | `DotDo` | `Mongo.Do` |
| **F#** | `CapnWeb` (NuGet) | `Rpc.Do` | `DotDo` | `Mongo.Do` |
| **PHP** | `capnweb/capnweb` | `rpc.do/sdk` | `dotdo/sdk` | `mongo.do/sdk` |
| **Swift** | `CapnWeb` (SPM) | `RpcDo` | `DotDo` | `MongoDo` |
| **Dart** | `capnweb` (pub) | `rpc_do` | `dotdo` | `mongo_do` |
| **Elixir** | `:capnweb` (hex) | `:rpc_do` | `:dotdo` | `:mongo_do` |
| **Clojure** | `dev.capnweb/capnweb` | `do.rpc/sdk` | `do.dotdo/sdk` | `do.mongo/sdk` |
| **Crystal** | `capnweb` (shards) | `rpc-do` | `dotdo` | `mongo-do` |
| **Nim** | `capnweb` (nimble) | `rpcdo` | `dotdo` | `mongodo` |
| **Deno** | `@capnweb/capnweb` | `@dotdo/rpc` | `@dotdo/dotdo` | `@dotdo/mongo` |
| **Nim** | `dotdocapnweb` | `dotdorpc` | `dotdo` | `dotdodb` |

## Repository Structure

```
github.com/dot-do/sdks/         # This repo - core RPC packages and multi-language SDKs
├── packages/
│   ├── typescript/
│   │   ├── capnweb/            # @dotdo/capnweb
│   │   ├── rpc/                # @dotdo/rpc
│   │   └── dotdo/              # dotdo
│   ├── python/
│   │   ├── capnweb/            # dotdo-capnweb
│   │   ├── rpc/                # dotdo-rpc
│   │   └── dotdo/              # dotdo
│   └── ... (17 languages)
├── test/
│   └── conformance/            # Cross-language test specs
└── scripts/
    └── test-all.ts             # Cross-language test runner

github.com/dot-do/mongo/        # MongoDB-compatible API
├── packages/
│   ├── typescript/             # @dotdo/mongo
│   ├── python/                 # dotdo-mongo
│   └── ...

github.com/dot-do/kafka/        # Kafka-compatible API
github.com/dot-do/db/           # Database operations
github.com/dot-do/agents/       # AI agent orchestration
```

## API Comparison by Layer

### TypeScript Example

```typescript
// Layer 1: @dotdo/capnweb - Low-level protocol
import { RpcSession, newWebSocketRpcSession } from '@dotdo/capnweb';
const session = newWebSocketRpcSession('wss://api.dotdo.dev');
const stub = session.getRemoteMain();
// Manual message construction, raw protocol access

// Layer 2: @dotdo/rpc - Magic $ Proxy
import { connect } from '@dotdo/rpc';
const $ = await connect<MyApi>('wss://api.dotdo.dev');
const users = await $.users.list();           // Zero-schema access
const names = await users.map(u => u.name);   // Server-side map, 1 RT

// Layer 3: dotdo - Managed platform
import { DotDo } from 'dotdo';
const client = new DotDo({ apiKey: process.env.DOTDO_KEY });
const $ = client.rpc<MyApi>();                // Auth handled
// Automatic retries, connection pooling, observability

// Layer 4: @dotdo/mongo - Domain package
import { MongoClient } from '@dotdo/mongo';
const client = new MongoClient(process.env.DOTDO_KEY);
const db = client.db('myapp');
const users = await db.collection('users').find({}).toArray();
// Feels exactly like mongodb driver, runs over RPC
```

### Python Example

```python
# Layer 1: dotdo-capnweb - Low-level protocol
from dotdo_capnweb import RpcSession, WebSocketTransport
session = RpcSession(WebSocketTransport('wss://api.dotdo.dev'))
stub = session.get_remote_main()

# Layer 2: dotdo-rpc - Magic proxy
from dotdo_rpc import connect
api = await connect('wss://api.dotdo.dev')
users = await api.users.list()
names = await users.map(lambda u: u.name)  # Server-side, 1 RT

# Layer 3: dotdo - Managed platform
from dotdo import DotDo
client = DotDo(api_key=os.environ['DOTDO_KEY'])
api = client.rpc()  # Auth handled, retries, pooling

# Layer 4: dotdo-mongo - Domain package
from dotdo_mongo import MongoClient
client = MongoClient(os.environ['DOTDO_KEY'])
db = client['myapp']
users = list(db.users.find({}))  # PyMongo-compatible API
```

### Rust Example

```rust
// Layer 1: dotdo-capnweb - Low-level protocol
use dotdo_capnweb::{RpcSession, WebSocketTransport};
let session = RpcSession::new(WebSocketTransport::connect("wss://...").await?);
let stub = session.get_remote_main();

// Layer 2: dotdo-rpc - Magic proxy
use dotdo_rpc::connect;
let api = connect::<MyApi>("wss://api.dotdo.dev").await?;
let users = api.users().list().await?;
let names = users.map(|u| u.name()).await?;  // Server-side, 1 RT

// Layer 3: dotdo - Managed platform
use dotdo::DotDo;
let client = DotDo::new(std::env::var("DOTDO_KEY")?);
let api = client.rpc::<MyApi>();

// Layer 4: dotdo-mongo - Domain package
use dotdo_mongo::Client;
let client = Client::new(std::env::var("DOTDO_KEY")?)?;
let db = client.database("myapp");
let users: Vec<User> = db.collection("users").find(None).await?.collect().await?;
```

## The Magic: How `.map()` Works

The `.map()` operation is the crown jewel of the RPC layer. It enables server-side collection transformation in a single round trip:

```typescript
// Without map: N+1 round trips
const userIds = await api.getActiveUserIds();     // RT 1
const names = [];
for (const id of userIds) {
  names.push(await api.getUserName(id));          // RT 2, 3, 4, ...
}

// With map: 1 round trip
const userIds = await api.getActiveUserIds();     // RT 1
const names = await userIds.map(id => api.getUserName(id));  // Still RT 1!
```

**How it works:**
1. The map callback is executed locally in "recording mode"
2. The proxy intercepts all RPC calls and records them as instructions
3. Captured references (like `api`) are serialized as capabilities
4. Instructions are sent to server: `["remap", arrayId, instructions, captures]`
5. Server replays instructions for each array element
6. Results returned in single response

**Language-specific syntax:**

| Language | Map Syntax |
|----------|------------|
| TypeScript | `arr.map(x => api.transform(x))` |
| Python | `arr.map(lambda x: api.transform(x))` |
| Rust | `arr.map(\|x\| api.transform(x))` |
| Go | `arr.Map(func(x T) R { return api.Transform(x) })` |
| Ruby | `arr.remap { \|x\| api.transform(x) }` |
| Java/Kotlin | `arr.map(x -> api.transform(x))` |
| C# | `arr.Select(x => api.Transform(x))` |
| Swift | `arr.map { x in api.transform(x) }` |
| Elixir | `arr \|> DotDo.rmap(fn x -> Api.transform(x) end)` |

## Migration Path

### Phase 1: Rename and Restructure (This PR)
- Rename repo from `capnweb` to `sdks`
- Restructure packages into `capnweb/`, `rpc/`, `dotdo/` subdirectories
- Update all package names to `@dotdo/*` convention

### Phase 2: Implement Layers
- Complete `@dotdo/capnweb` implementations (protocol layer)
- Build `@dotdo/rpc` on top (proxy layer)
- Add `dotdo` platform features (managed layer)

### Phase 3: Domain Packages
- Create separate repos for `mongo`, `kafka`, `db`, `agents`
- Implement API-compatible wrappers
- Publish to package registries

## Design Principles

1. **Layer Independence**: Each layer can be used independently
2. **Native Feel**: Each language's packages follow that ecosystem's conventions
3. **Type Safety**: Full compile-time checking where the language supports it
4. **Zero Schema**: No codegen required for basic usage
5. **Progressive Disclosure**: Simple things simple, complex things possible
6. **API Compatibility**: Domain packages match native driver APIs exactly

## Error Hierarchy

All error types in the DotDo ecosystem follow a single inheritance chain to ensure consistent `instanceof` checks across all packages.

### Single Source of Truth

Errors are defined **only** in `@dotdo/capnweb` and re-exported through the package chain:

```
@dotdo/capnweb  (defines)
      ↓
   rpc.do       (re-exports from @dotdo/capnweb)
      ↓
   dotdo        (re-exports from rpc.do)
      ↓
@dotdo/oauth    (extends CapnwebError with OAuthError)
```

This ensures that:
- `instanceof` checks work correctly regardless of which package the error was imported from
- There are no duplicate class definitions that would break error catching
- All errors share a common base class (`CapnwebError`)

### Error Class Hierarchy

```typescript
CapnwebError (base)
├── ConnectionError     // Connection failures, disconnections
├── RpcError           // Method call failures, server errors
├── CapabilityError    // Capability resolution failures
├── TimeoutError       // Request timeout exceeded
└── OAuthError         // OAuth-specific errors (defined in oauth.do)
```

### Usage Examples

```typescript
// Import from any package - they're all the same class
import { RpcError } from 'rpc.do';
import { RpcError as RpcErrorFromDotdo } from 'dotdo';
import { CapnwebError } from '@dotdo/capnweb';

// All of these work correctly:
try {
  await client.call('someMethod');
} catch (error) {
  // Catch specific error types
  if (error instanceof RpcError) {
    console.log('RPC call failed:', error.message);
  }

  // Or catch all RPC-related errors
  if (error instanceof CapnwebError) {
    console.log(`Error [${error.code}]: ${error.message}`);
  }
}
```

### Error Properties

| Error Class | Properties | When Thrown |
|-------------|------------|-------------|
| `CapnwebError` | `message`, `code` | Base class, not thrown directly |
| `ConnectionError` | `message`, `code` | Network failures, server unreachable |
| `RpcError` | `message`, `code`, `methodId?` | Method not found, invalid args, server exceptions |
| `CapabilityError` | `message`, `code`, `capabilityId?` | Capability expired, revoked, or not found |
| `TimeoutError` | `message`, `code` | Request exceeded configured timeout |

### Guidelines for Package Authors

1. **Never define new error classes that duplicate capnweb errors**
2. **Always re-export from the upstream package** (rpc.do re-exports from @dotdo/capnweb)
3. **New error types should extend CapnwebError** (e.g., OAuthError in oauth.do)
4. **Use the `code` property for machine-readable error identification**

---

## Dependency Chain: oauth.do -> rpc.do -> Domain SDKs

This section explains how authentication flows through the DotDo package hierarchy, enabling seamless, zero-configuration auth for end users.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Your Application                             │
│                                                                      │
│   import { MongoClient } from '@dotdo/mongo'                        │
│   const db = new MongoClient().db('myapp')                          │
│   await db.collection('users').find({})  // Just works!            │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    Domain SDKs (Layer 4)                            │
│         @dotdo/mongo, @dotdo/kafka, @dotdo/db, etc.                 │
│                                                                      │
│   • Import rpc.do for connectivity                                  │
│   • Provide native-feeling APIs                                     │
│   • Auth is automatic - no configuration needed                     │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                       rpc.do (Layer 2)                              │
│                  RPC proxy with auto-auth                           │
│                                                                      │
│   • Imports oauth.do for authentication                             │
│   • Calls ensureLoggedIn() automatically                            │
│   • Injects auth headers into all requests                          │
│   • Handles token refresh transparently                             │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                       oauth.do (Auth)                               │
│               Token storage, login flows, refresh                   │
│                                                                      │
│   • Stores tokens securely (keychain/file)                          │
│   • Browser & device code OAuth flows                               │
│   • Automatic token refresh                                         │
│   • Environment variable overrides                                  │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     capnweb (Layer 1)                               │
│                  Low-level protocol                                 │
│                                                                      │
│   • Wire protocol encoding/decoding                                 │
│   • WebSocket transport                                             │
│   • Promise pipelining                                              │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
                        DotDo Servers
```

### How It Works

#### 1. oauth.do - Authentication Foundation

The `oauth.do` package handles all authentication concerns:

```typescript
// oauth.do provides these key functions:
export { ensureLoggedIn, getToken, isAuthenticated, logout, whoami } from 'oauth.do';

// ensureLoggedIn() - The core function used by rpc.do
// - Checks for existing valid token
// - Prompts for login if needed (browser or device flow)
// - Refreshes expired tokens automatically
// - Returns a valid Token object
const token = await ensureLoggedIn();

// getToken() - Get token without prompting
// - Returns existing token if valid
// - Throws if not authenticated
const token = await getToken();
```

**Token Resolution Order:**
1. Environment variables (`DOTDO_TOKEN`, `DOTDO_API_KEY`)
2. System keychain (macOS Keychain, Linux libsecret, Windows Credential Manager)
3. File fallback (`~/.config/dotdo/credentials.json`)

#### 2. rpc.do - Automatic Auth Integration

The `rpc.do` package imports `oauth.do` and automatically handles authentication:

```typescript
// Inside rpc.do's connect function (simplified):
import { ensureLoggedIn, getAuthHeader } from 'oauth.do';

export async function connect(service: string, options?: ConnectOptions) {
  // Auto-auth: ensure user is logged in before connecting
  if (!options?.token) {
    await ensureLoggedIn();
  }

  // Get auth header for all requests
  const authHeader = await getAuthHeader();

  // Connect with authentication
  const ws = new WebSocket(service, {
    headers: { Authorization: authHeader }
  });

  // ... rest of connection setup
}
```

**Key Points:**
- `rpc.do` imports `oauth.do` as a dependency
- On `connect()`, it calls `ensureLoggedIn()` if no token is provided
- Auth headers are injected automatically
- Token refresh happens transparently on 401 responses

#### 3. Domain SDKs - Zero Config Experience

Domain packages like `@dotdo/mongo` simply import `rpc.do`:

```typescript
// Inside @dotdo/mongo (simplified):
import { connect } from 'rpc.do';

export class MongoClient {
  private rpc: RpcClient;

  async connect() {
    // rpc.do handles auth automatically
    this.rpc = await connect('mongo.do');
  }

  db(name: string) {
    return new Database(this.rpc, name);
  }
}
```

**For end users, it just works:**
```typescript
import { MongoClient } from '@dotdo/mongo';

const client = new MongoClient();
const db = client.db('myapp');

// First use triggers login if needed
const users = await db.collection('users').find({}).toArray();
```

### Code Examples by Language

#### TypeScript

```typescript
// ===== Direct oauth.do usage (low level) =====
import { ensureLoggedIn, getToken, logout, whoami } from 'oauth.do';

// Check auth status
if (await isAuthenticated()) {
  const user = await whoami();
  console.log(`Logged in as ${user?.email}`);
} else {
  await ensureLoggedIn(); // Prompts for login
}

// ===== Using rpc.do (mid level) =====
import { connect } from 'rpc.do';

// Auth is automatic - ensureLoggedIn() called internally
const api = await connect('api.do');
const result = await api.users.list();

// ===== Using domain SDK (recommended) =====
import { MongoClient } from '@dotdo/mongo';

// Most ergonomic - auth completely transparent
const client = new MongoClient();
const db = client.db('myapp');
const users = await db.collection('users').find({}).toArray();
```

#### Python

```python
# ===== Direct oauth.do usage (low level) =====
from oauth_do import ensure_logged_in, get_token, logout, whoami, is_authenticated

# Check auth status
if await is_authenticated():
    user = await whoami()
    print(f"Logged in as {user.email if user else 'unknown'}")
else:
    await ensure_logged_in()  # Prompts for login

# ===== Using rpc.do (mid level) =====
from rpc_do import connect

# Auth is automatic
api = await connect("api.do")
result = await api.users.list()

# ===== Using domain SDK (recommended) =====
from dotdo_mongo import MongoClient

# Auth completely transparent
client = MongoClient()
db = client["myapp"]
users = list(db.users.find({}))
```

#### Go

```go
// ===== Direct oauth.do usage (low level) =====
import "go.dotdo.dev/oauth"

// Check auth status
authenticated, _ := oauth.IsAuthenticated()
if authenticated {
    user, _ := oauth.Whoami(nil)
    fmt.Printf("Logged in as %s\n", user.Email)
} else {
    oauth.EnsureLoggedIn(nil) // Prompts for login
}

// ===== Using rpc.do (mid level) =====
import "go.dotdo.dev/rpc"

// Auth is automatic
client, _ := rpc.Connect("api.do")
defer client.Close()
result, _ := client.Call("users.list")

// ===== Using domain SDK (recommended) =====
import "go.dotdo.dev/mongo"

// Auth completely transparent
client, _ := mongo.Connect(context.Background())
db := client.Database("myapp")
users, _ := db.Collection("users").Find(context.Background(), bson.M{})
```

### Environment Variables

Override authentication behavior with environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DOTDO_API_KEY` | API key for non-interactive use | `sk_live_abc123` |
| `DOTDO_TOKEN` | Direct token override (for CI/CD) | `eyJhbGciOiJ...` |
| `DOTDO_CONFIG_DIR` | Custom config directory | `/path/to/config` |
| `DOTDO_NO_KEYCHAIN` | Disable keychain, use file only | `1` or `true` |
| `DOTDO_AUTH_SERVER` | Custom OAuth server | `https://auth.example.com` |

**Usage:**

```bash
# For CI/CD pipelines - use API key
export DOTDO_API_KEY="sk_live_your_api_key"

# For automated scripts - use direct token
export DOTDO_TOKEN="eyJhbGciOiJSUzI1NiIs..."

# For containerized environments
docker run -e DOTDO_API_KEY=sk_live_abc123 myapp
```

**Priority Order:**
1. `DOTDO_TOKEN` (highest - direct token)
2. `DOTDO_API_KEY` (API key authentication)
3. System keychain (secure storage)
4. File storage (`~/.config/dotdo/credentials.json`)

### Token Storage Locations

| Platform | Primary Storage | Fallback |
|----------|-----------------|----------|
| **macOS** | Keychain (`keytar`) | `~/.config/dotdo/credentials.json` |
| **Linux** | libsecret (`keytar`) | `~/.config/dotdo/credentials.json` |
| **Windows** | Credential Manager | `%APPDATA%\dotdo\credentials.json` |

**Security Notes:**
- Keychain storage is preferred (encrypted, OS-managed)
- File fallback uses AES-256-GCM encryption with machine-specific key
- Tokens are never logged or exposed in error messages
- Refresh tokens are stored securely and rotated automatically

### CLI Authentication

```bash
# Login (opens browser or shows device code)
dotdo login

# Check who you're logged in as
dotdo whoami

# Logout (clears stored tokens)
dotdo logout

# Login with device code (for headless environments)
dotdo login --device

# View storage info
dotdo auth status
```

### Dependency Graph

```
oauth.do                    # Zero dependencies (auth foundation)
    ↑
rpc.do ←────── oauth.do     # Imports oauth.do for auto-auth
    ↑
platform.do ← rpc.do        # Optional: managed layer
    ↑
@dotdo/mongo ← rpc.do       # Domain SDKs import rpc.do
@dotdo/kafka ← rpc.do
@dotdo/db ← rpc.do
@dotdo/redis ← rpc.do
```

### Best Practices

1. **Use Domain SDKs** - They provide the best DX with zero auth config
2. **Set `DOTDO_API_KEY`** in CI/CD - Avoid interactive login prompts
3. **Don't store tokens in code** - Use environment variables
4. **Let keychain manage tokens** - Don't disable unless necessary
5. **Use `ensureLoggedIn()`** - It handles all edge cases (expired, revoked, etc.)

---

## Internal Protocol Architecture

This section documents the internal algorithms and design decisions within the Cap'n Web protocol implementation.

### Module Structure and Dependencies

The TypeScript implementation follows a layered module architecture:

```
src/
├── index.ts          # Public API surface, re-exports, CORS handling
├── rpc.ts            # RPC session management, message processing, embargo handling
├── core.ts           # StubHook hierarchy, RpcPayload, RpcStub/RpcPromise proxies
├── serialize.ts      # Evaluator/Devaluator for wire format conversion
├── websocket.ts      # WebSocket transport implementation
├── batch.ts          # HTTP batch transport implementation
├── messageport.ts    # MessagePort transport (iframe communication)
├── map.ts            # Server-side .map() implementation
├── errors.ts         # Standardized error types and codes
├── version.ts        # Protocol version negotiation
├── types.ts          # Type definitions and branded types
└── symbols.ts        # Internal symbols for Workers interop
```

**Dependency Graph:**

```
                    index.ts (public API)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  websocket.ts      batch.ts      messageport.ts
        │               │               │
        └───────────────┼───────────────┘
                        ▼
                     rpc.ts (session management)
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
    core.ts       serialize.ts       map.ts
        │               │               │
        └───────┬───────┘               │
                ▼                       │
            types.ts ◄──────────────────┘
```

### StubHook Hierarchy

`StubHook` is the internal abstraction representing a remote or local capability reference:

```
StubHook (abstract base)
├── ErrorStubHook          # Represents a permanently-failed stub
├── PayloadStubHook        # Wraps an RpcPayload (resolved value)
├── TargetStubHook         # Wraps a local RpcTarget
├── PromiseStubHook        # Wraps a Promise<StubHook>
├── RpcImportHook          # References an entry in the import table
│   └── RpcMainHook        # Special hook for session's main import
├── EmbargoedStubHook      # Maintains e-order during promise resolution
└── EmbargoedCallStubHook  # Queued call during embargo period
```

**Key Methods:**

| Method | Purpose |
|--------|---------|
| `call(path, args)` | Invoke a method at the given property path |
| `get(path)` | Access a property, returning a promise for its value |
| `map(path, captures, instructions)` | Apply server-side map operation |
| `pull()` | Request the resolved payload (for promises) |
| `dup()` | Create a reference-counted duplicate |
| `dispose()` | Release the reference |
| `onBroken(callback)` | Register disconnect notification |

---

## Protocol Details

### Import/Export Table Lifecycle

The protocol maintains two tables per session: **imports** (references to remote capabilities) and **exports** (references to local capabilities). These are mirrored between peers.

**ID Assignment Strategy:**

```
         Client                          Server
┌─────────────────────┐          ┌─────────────────────┐
│  Imports Table      │          │  Exports Table      │
│  (positive IDs)     │◄────────►│  (positive IDs)     │
│  ID 1, 2, 3, ...    │          │  ID 1, 2, 3, ...    │
├─────────────────────┤          ├─────────────────────┤
│  Exports Table      │          │  Imports Table      │
│  (negative IDs)     │◄────────►│  (negative IDs)     │
│  ID -1, -2, -3, ... │          │  ID -1, -2, -3, ... │
├─────────────────────┤          ├─────────────────────┤
│  ID 0 = Main        │◄────────►│  ID 0 = Main        │
└─────────────────────┘          └─────────────────────┘
```

- **ID 0**: Reserved for the bootstrap/main interface
- **Positive IDs**: Assigned by the importer for push results and received exports
- **Negative IDs**: Assigned by the exporter for new exports it initiates

**Lifecycle States:**

```
                      ┌──────────────────┐
                      │    Created       │
                      │  (push/export)   │
                      └────────┬─────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
                 ▼             ▼             ▼
          ┌──────────┐  ┌───────────┐  ┌───────────┐
          │ Pending  │  │  Pulled   │  │ Resolved  │
          │(waiting) │  │(awaiting) │  │ (ready)   │
          └────┬─────┘  └─────┬─────┘  └─────┬─────┘
               │              │              │
               └──────────────┼──────────────┘
                              ▼
                      ┌──────────────────┐
                      │    Released      │
                      │  (ref count 0)   │
                      └──────────────────┘
```

### Reference Counting Semantics

Each import/export entry maintains a reference count to prevent premature disposal:

```typescript
// ImportTableEntry tracks both local and remote reference counts
class ImportTableEntry {
  localRefcount: number = 0;   // How many local StubHooks reference this
  remoteRefcount: number = 1;  // How many times peer has exported this ID
}
```

**Reference Count Operations:**

| Operation | Local Count | Remote Count | Wire Message |
|-----------|-------------|--------------|--------------|
| Receive export | +1 | (set by peer) | - |
| Create local dup | +1 | - | - |
| Dispose local hook | -1 | - | - |
| Send release | - | -N | `["release", id, N]` |
| Receive release | (dispose when 0) | -N | - |

**Why Remote Refcount Matters:**

A race condition can occur when the exporter sends the same ID multiple times before receiving a release:

```
Peer A                                 Peer B
   │                                      │
   │ ── export ID=-1 ──────────────────►  │  remoteRefcount = 1
   │ ── export ID=-1 (in another msg) ─►  │  remoteRefcount = 2
   │                                      │
   │ ◄── release ID=-1, count=1 ────────  │  (B disposed first ref)
   │                                      │
   │  (A decrements: 2-1=1, not zero)     │
   │  (A keeps the export alive)          │
```

### Embargo Protocol

The **embargo** mechanism ensures **E-order (event order)** when promises resolve. Without embargo, a race condition could occur:

**The Problem:**

```
Client                    Introducer                   Target
   │                          │                           │
   │ ── call(promise.foo) ──► │                           │
   │    (pipelined through    │ ── forward call ────────► │
   │     introducer)          │                           │
   │                          │                           │
   │ ◄── resolve(promise) ──  │                           │
   │    = capability to       │                           │
   │      Target              │                           │
   │                          │                           │
   │ ── call(resolved.bar) ──────────────────────────────►│
   │    (direct to target)    │                           │
   │                          │                           │
   ▼                          ▼                           ▼
```

If the direct call `bar()` arrives at Target before the forwarded call `foo()`, they execute out of order, violating E-order.

**The Solution - Embargo:**

```typescript
// ImportTableEntry maintains pending pipelined calls
private pendingPipelinedCalls?: PromiseWithResolvers<void>[];

// When a promise resolves with pending pipelined calls:
resolve(resolution: StubHook) {
  if (this.pendingPipelinedCalls && this.pendingPipelinedCalls.length > 0) {
    // Wrap resolution in embargo that waits for all pipelined calls
    const embargoPromise = Promise.allSettled(
      this.pendingPipelinedCalls.map(r => r.promise)
    ).then(() => resolution);

    this.resolution = new EmbargoedStubHook(embargoPromise, resolution);
  }
}
```

**Embargo Behavior:**

1. Before resolution: Calls are sent through the introducer (pipelined)
2. At resolution: Register all pending pipelined calls for embargo
3. During embargo: New calls queue behind the embargo promise
4. Embargo lifts: When all pipelined calls have been resolved
5. After embargo: Calls go directly to the resolved target

### E-Order Guarantees

**E-order** (event order) is a fundamental guarantee: if events A and B are ordered (A happens-before B) from one actor's perspective, all actors will observe them in that order.

**Implementation Strategies:**

1. **PromiseStubHook - Local Promise Ordering:**
   ```typescript
   // Even if resolution is available, chain through the promise
   // to maintain ordering relative to earlier calls
   call(path, args) {
     args.ensureDeepCopied();  // Can't serialize yet, must deep-copy
     return new PromiseStubHook(this.promise.then(hook => hook.call(path, args)));
   }
   ```

2. **EmbargoedStubHook - Cross-Network Ordering:**
   ```typescript
   call(path, args) {
     if (this.embargoLifted) {
       return this.resolution.call(path, args);  // Direct path
     }
     // Queue behind embargo to maintain e-order
     return new EmbargoedCallStubHook(
       this.embargoPromise.then(hook => hook.call(path, args))
     );
   }
   ```

3. **Payload Deep-Copy Before Async:**
   ```typescript
   // Once call() returns synchronously, args must not be touched
   // If we can't serialize immediately, deep-copy now
   args.ensureDeepCopied();
   ```

---

## Message Flow

### Request/Response Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  const result = await api.getData(123)                          │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  RpcStub (Proxy)                                                │ │
│  │  - Intercepts method call                                       │ │
│  │  - Creates RpcPayload from args [123]                           │ │
│  │  - Calls hook.call(["getData"], payload)                        │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  RpcSession.sendCall()                                          │ │
│  │  - Devaluates payload to wire format                            │ │
│  │  - Assigns new import ID                                        │ │
│  │  - Sends: ["push", ["pipeline", 0, ["getData"], [[123]]]]       │ │
│  │  - Creates ImportTableEntry for result                          │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               │  WebSocket / HTTP
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         SERVER                                        │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  RpcSession.processMessage()                                     ││
│  │  - Parses JSON message                                           ││
│  │  - Validates message structure                                   ││
│  │  - Routes to "push" handler                                      ││
│  └──────────────────────────┬───────────────────────────────────────┘│
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  Evaluator.evaluate()                                           │ │
│  │  - Converts wire format to RpcPayload                           │ │
│  │  - Looks up export 0 (main interface)                           │ │
│  │  - Evaluates ["pipeline", ...] → creates call chain             │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  PayloadStubHook.call() → Application Method                    │ │
│  │  - Follows property path to find function                       │ │
│  │  - Delivers payload via payload.deliverCall(fn, thisArg)        │ │
│  │  - Awaits result                                                │ │
│  └──────────────────────────┬──────────────────────────────────────┘ │
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  ensureResolvingExport()                                        │ │
│  │  - Calls hook.pull() on the result                              │ │
│  │  - Devaluates result to wire format                             │ │
│  │  - Sends: ["resolve", exportId, resultExpression]               │ │
│  └──────────────────────────┬───────────────────────────────────────┘│
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               │  WebSocket / HTTP
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT                                        │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  RpcSession.processMessage() - "resolve" handler                 ││
│  │  - Evaluates result expression                                   ││
│  │  - Calls ImportTableEntry.resolve(hook)                          ││
│  │  - Resolves the pending promise                                  ││
│  │  - Sends: ["release", importId, 1]                               ││
│  └──────────────────────────┬───────────────────────────────────────┘│
│                             │                                         │
│  ┌──────────────────────────▼──────────────────────────────────────┐ │
│  │  RpcPayload.deliverResolve()                                    │ │
│  │  - Substitutes any embedded promises with resolutions           │ │
│  │  - Returns final value to application                           │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Promise Pipelining Example

```typescript
// Application code - all in ONE round trip
const user = api.getUser(123);           // RpcPromise, not awaited
const profile = await api.getProfile(user.id);  // Pipelined!
```

**Wire Protocol:**

```
Client → Server:
["push", ["pipeline", 0, ["getUser"], [[123]]]]     // ID 1: getUser(123)
["push", ["pipeline", 1, ["id"]]]                    // ID 2: (result of 1).id
["push", ["pipeline", 0, ["getProfile"], [["pipeline", 2]]]]  // ID 3: getProfile(...)
["pull", 3]                                          // Only care about final result

Server → Client:
["resolve", 1, { "id": 123, "name": "Alice" }]      // getUser result
["resolve", 2, 123]                                  // .id result
["resolve", 3, { "bio": "...", "avatar": "..." }]   // getProfile result

Client → Server:
["release", 1, 1]
["release", 2, 1]
["release", 3, 1]
```

### Capability Passing Lifecycle

When a capability (RpcTarget or function) is passed over RPC:

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. EXPORT: Passing a capability FROM local TO remote              │
└─────────────────────────────────────────────────────────────────────┘

  Local Side                              Remote Side
  ┌────────────────────┐                  ┌────────────────────┐
  │ class MyCallback   │   ["export",-1]  │ RpcStub<MyCallback>│
  │   extends RpcTarget│ ─────────────►   │   (proxy)          │
  │                    │                  │                    │
  │ Exports Table:     │                  │ Imports Table:     │
  │ ID=-1 → MyCallback │                  │ ID=-1 → ImportHook │
  └────────────────────┘                  └────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  2. USE: Remote invokes the capability                              │
└─────────────────────────────────────────────────────────────────────┘

  Remote Side                             Local Side
  ┌────────────────────┐                  ┌────────────────────┐
  │ await stub.onEvent │   ["push",       │ MyCallback.onEvent │
  │     ("data")       │   ["pipeline",-1,│    ("data")        │
  │                    │    ["onEvent"],  │                    │
  │                    │    [["data"]]]]  │                    │
  │                    │ ─────────────►   │                    │
  └────────────────────┘                  └────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  3. DISPOSE: Remote is done with the capability                     │
└─────────────────────────────────────────────────────────────────────┘

  Remote Side                             Local Side
  ┌────────────────────┐                  ┌────────────────────┐
  │ stub[Symbol        │   ["release",    │ MyCallback         │
  │   .dispose]()      │    -1, 1]        │  [Symbol.dispose]()│
  │                    │ ─────────────►   │  called if defined │
  │ Imports Table:     │                  │                    │
  │ ID=-1 removed      │                  │ Exports Table:     │
  └────────────────────┘                  │ ID=-1 removed      │
                                          └────────────────────┘
```

### HTTP Batch Mode Timing

```
┌───────────────────────────────────────────────────────────────────┐
│  Microtask 0: Application code runs                               │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │ const a = api.methodA();   // Queued                       │   │
│  │ const b = api.methodB();   // Queued                       │   │
│  │ const c = api.methodC(a);  // Queued (pipeline)            │   │
│  │ const result = await Promise.all([a, b, c]); // ◄── await  │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  setTimeout(0): Batch collected and sent                          │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  POST /rpc HTTP/1.1                                        │   │
│  │  Content-Type: text/plain                                  │   │
│  │                                                            │   │
│  │  ["push", ["pipeline", 0, ["methodA"]]]                    │   │
│  │  ["push", ["pipeline", 0, ["methodB"]]]                    │   │
│  │  ["push", ["pipeline", 0, ["methodC"], [["pipeline",1]]]]  │   │
│  │  ["pull", 1]                                               │   │
│  │  ["pull", 2]                                               │   │
│  │  ["pull", 3]                                               │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  HTTP Response: All results in one response                       │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  ["resolve", 1, resultA]                                   │   │
│  │  ["resolve", 2, resultB]                                   │   │
│  │  ["resolve", 3, resultC]                                   │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Version Negotiation

The protocol supports version negotiation for forward/backward compatibility:

```
Client                                Server
   │                                     │
   │ ─── ["hello", versions, peerId] ──► │  Client sends supported versions
   │                                     │
   │ ◄── ["hello-ack", selected, id] ─── │  Server picks highest common
   │                                     │
   │ ─── ["push", ...] ─────────────────►│  Normal messages can now flow
```

**Fallback Behavior:**

If the server doesn't support version negotiation (older implementation), it will respond with a regular RPC message. The client detects this and falls back to the current protocol version.

**Version Format:** `major.minor` (e.g., "1.0")

- Major version changes: Breaking wire format changes
- Minor version changes: Backward-compatible additions
