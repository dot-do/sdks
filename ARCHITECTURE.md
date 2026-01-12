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
