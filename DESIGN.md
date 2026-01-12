# Cap'n Web Multi-Language Client Design

## Protocol Essence

Cap'n Web is a **bidirectional capability-based RPC protocol** over JSON, derived from Cap'n Proto's CapTP. The core abstractions are:

### 1. Stubs (RpcStub)
A **stub** is a proxy representing a remote object. Any property access or method call on a stub generates a network request. The key insight: *the stub doesn't know what methods exist* - it forwards everything and lets the server validate.

### 2. Promises with Pipelining (RpcPromise)
An **RPC promise** is lazy - it doesn't request results until awaited. But critically, you can **pipeline** calls through unresolved promises: `stub.getUser().getName()` sends both calls without waiting for the first to resolve.

### 3. Targets (RpcTarget)
A **target** is a local object exposed for remote invocation. Any class extending RpcTarget can be passed by reference across the wire.

### 4. Sessions
Sessions manage the connection and import/export tables:
- **WebSocket** - persistent bidirectional connection
- **HTTP Batch** - stateless POST requests (batches calls)
- **MessagePort** - browser iframe communication

## Design Principles for Multi-Language Clients

### Principle 1: Native Idioms Over Consistency

Each language should feel like it was designed *for* that language. Don't force TypeScript patterns into Python or Java patterns into Go.

**Bad**: `client.call("getUser", [id])` (generic everywhere)
**Good**: Language-specific idiomatic patterns

### Principle 2: The Stub is the API

Users should interact with typed stubs that look like local objects:
```typescript
// TypeScript
const user = await api.users.get(id);

// Python
user = await api.users.get(id)

// Rust
let user = api.users().get(id).await?;

// Go
user, err := api.Users().Get(ctx, id)
```

### Principle 3: Pipelining Should Be Invisible

Users shouldn't need to think about pipelining - it should just happen when they chain calls:
```typescript
// This should automatically pipeline (one round trip):
const name = await api.users.get(id).profile.name;
```

### Principle 4: Type Safety Where Available

Languages with strong type systems should have full type inference. Dynamic languages should have excellent IDE support via type stubs.

### Principle 5: Error Handling Native to Language

- **Python**: Exceptions
- **Rust**: Result<T, E>
- **Go**: (value, error) tuples
- **Java**: Exceptions + CompletableFuture
- **Swift**: throws + async/await

## Language-Specific Considerations

### Python (pypi: capnweb)
- **Async**: `asyncio` with `async/await`
- **Proxying**: `__getattr__` magic methods
- **Types**: Type hints + stub files for IDE support
- **Style**: PEP 8, snake_case methods

```python
# Aspirational syntax
async with capnweb.connect("wss://api.example.com") as api:
    user = await api.users.get(123)
    # Pipelining via __getattr__ chaining
    name = await api.users.get(123).profile.name
```

### Rust (crates.io: capnweb)
- **Async**: `tokio` with `async/await`
- **Proxying**: Proc macros generate typed stubs
- **Types**: Full type inference, generics
- **Style**: snake_case, Result<T, E> everywhere

```rust
// Aspirational syntax
let client = CapnWeb::connect("wss://api.example.com").await?;
let api: Api = client.stub();
let user = api.users().get(123).await?;
// Pipelining via builder pattern
let name = api.users().get(123).profile().name().await?;
```

### Go (go.pkg: github.com/dot-do/sdks/packages/go/capnweb)
- **Async**: Context + channels (Go idiom: no async/await)
- **Proxying**: Interface-based with code generation
- **Types**: Generics (Go 1.18+)
- **Style**: CamelCase exported, lowercase internal

```go
// Aspirational syntax
client, err := capnweb.Dial(ctx, "wss://api.example.com")
api := capnweb.Stub[Api](client)
user, err := api.Users().Get(ctx, 123)
// Pipelining via fluent API
name, err := api.Users().Get(ctx, 123).Profile().Name()
```

### C# (nuget: CapnWeb)
- **Async**: `Task<T>` with `async/await`
- **Proxying**: `DynamicObject` or source generators
- **Types**: Full generics, nullable reference types
- **Style**: PascalCase methods

```csharp
// Aspirational syntax
await using var client = await CapnWeb.ConnectAsync("wss://api.example.com");
var api = client.GetStub<IApi>();
var user = await api.Users.GetAsync(123);
// Pipelining via extension methods
var name = await api.Users.GetAsync(123).Then(u => u.Profile.Name);
```

### Java (maven: com.dotdo.capnweb)
- **Async**: `CompletableFuture<T>`
- **Proxying**: Dynamic proxies + annotation processing
- **Types**: Generics with type erasure limitations
- **Style**: camelCase methods, Builder patterns

```java
// Aspirational syntax
try (var client = CapnWeb.connect("wss://api.example.com")) {
    var api = client.stub(Api.class);
    var user = api.users().get(123).join();
    // Pipelining via thenCompose
    var name = api.users().get(123)
        .thenCompose(u -> u.getProfile().getName())
        .join();
}
```

### Ruby (rubygems: capnweb)
- **Async**: `async` gem or native fibers
- **Proxying**: `method_missing` magic
- **Types**: Sorbet/RBS for optional typing
- **Style**: snake_case, blocks for async

```ruby
# Aspirational syntax
CapnWeb.connect("wss://api.example.com") do |api|
  user = api.users.get(123).await
  # Pipelining via method_missing chaining
  name = api.users.get(123).profile.name.await
end
```

### PHP (packagist: dotdo/capnweb)
- **Async**: ReactPHP or Amp
- **Proxying**: `__call` magic
- **Types**: PHP 8 attributes + type hints
- **Style**: camelCase methods, PSR-12

```php
// Aspirational syntax
$client = CapnWeb::connect("wss://api.example.com");
$api = $client->stub(Api::class);
$user = await($api->users->get(123));
// Pipelining via __call chaining
$name = await($api->users->get(123)->profile->name);
```

### Swift (swift package: CapnWeb)
- **Async**: `async/await` (Swift 5.5+)
- **Proxying**: `@dynamicMemberLookup` + `@dynamicCallable`
- **Types**: Full generics, protocols
- **Style**: camelCase, trailing closure syntax

```swift
// Aspirational syntax
let client = try await CapnWeb.connect("wss://api.example.com")
let api: Api = client.stub()
let user = try await api.users.get(123)
// Pipelining via keypath subscript
let name = try await api.users.get(123).profile.name
```

## Implementation Strategy

### Phase 1: Core Protocol
Each language needs:
1. JSON serialization with special type handling
2. Expression evaluation (the protocol's core)
3. Import/export table management
4. WebSocket transport

### Phase 2: Stub Generation
Options per language:
- **Runtime proxying**: Python, Ruby, PHP (dynamic languages)
- **Compile-time generation**: Rust, Go (proc macros, go generate)
- **Hybrid**: TypeScript, C#, Java, Swift (runtime + optional codegen)

### Phase 3: Type Definitions
For typed languages:
- TypeScript: `.d.ts` files
- Python: `.pyi` stub files
- Rust: trait definitions
- Go: interface definitions
- C#: interface definitions
- Java: interface definitions
- Swift: protocol definitions

## Wire Protocol Reference

See `protocol.md` for the complete wire protocol specification. Key message types:
- `push` - evaluate expression
- `pull` - request result
- `resolve` - send result
- `reject` - send error
- `release` - dispose reference
- `abort` - terminate session
