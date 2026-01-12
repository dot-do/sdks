# DotDo RPC Ecosystem Architecture

This document describes the layered package architecture for the DotDo RPC ecosystem across all supported languages.

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

| Language | capnweb | rpc | platform | domain |
|----------|---------|-----|----------|--------|
| **TypeScript** | `@dotdo/capnweb` | `@dotdo/rpc` | `dotdo` | `@dotdo/db` |
| **Python** | `dotdo-capnweb` | `dotdo-rpc` | `dotdo` | `dotdo-db` |
| **Rust** | `dotdo-capnweb` | `dotdo-rpc` | `dotdo` | `dotdo-db` |
| **Go** | `go.dotdo.dev/capnweb` | `go.dotdo.dev/rpc` | `go.dotdo.dev/dotdo` | `go.dotdo.dev/db` |
| **Ruby** | `dotdo-capnweb` | `dotdo-rpc` | `dotdo` | `dotdo-db` |
| **Java** | `com.dotdo:capnweb` | `com.dotdo:rpc` | `com.dotdo:core` | `com.dotdo:db` |
| **Kotlin** | `com.dotdo:capnweb` | `com.dotdo:rpc` | `com.dotdo:core` | `com.dotdo:db` |
| **Scala** | `com.dotdo::capnweb` | `com.dotdo::rpc` | `com.dotdo::core` | `com.dotdo::db` |
| **C#/.NET** | `DotDo.CapnWeb` | `DotDo.Rpc` | `DotDo` | `DotDo.Db` |
| **F#** | `DotDo.CapnWeb` | `DotDo.Rpc` | `DotDo` | `DotDo.Db` |
| **PHP** | `dotdo/capnweb` | `dotdo/rpc` | `dotdo/dotdo` | `dotdo/db` |
| **Swift** | `DotDoCapnWeb` | `DotDoRpc` | `DotDo` | `DotDoDb` |
| **Dart** | `dotdo_capnweb` | `dotdo_rpc` | `dotdo` | `dotdo_db` |
| **Elixir** | `:dotdo_capnweb` | `:dotdo_rpc` | `:dotdo` | `:dotdo_db` |
| **Clojure** | `com.dotdo/capnweb` | `com.dotdo/rpc` | `com.dotdo/core` | `com.dotdo/db` |
| **Crystal** | `dotdo-capnweb` | `dotdo-rpc` | `dotdo` | `dotdo-db` |
| **Nim** | `dotdocapnweb` | `dotdorpc` | `dotdo` | `dotdodb` |

## Repository Structure

```
github.com/dot-do/rpc/          # This repo - core RPC packages
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
- Rename repo from `capnweb` to `rpc`
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
