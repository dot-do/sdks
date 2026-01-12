# Cap'n Web Rust Client: Syntax Exploration

This document explores four divergent approaches to designing an idiomatic Rust client for Cap'n Web RPC. Each approach optimizes for different trade-offs between type safety, ergonomics, compile-time guarantees, and flexibility.

---

## Background: What Makes Rust Unique

Rust brings unique constraints and opportunities:

- **Ownership & Borrowing**: Resources must have clear owners; RPC stubs represent remote resources
- **Async/Await**: First-class support, but requires explicit `.await` points
- **Result<T, E>**: Errors are values, not exceptions; `?` operator for propagation
- **Traits**: Zero-cost abstractions through static dispatch
- **Proc Macros**: Compile-time code generation for type safety
- **No Runtime Reflection**: Unlike dynamic languages, we can't intercept arbitrary method calls

The challenge: Cap'n Web stubs are "infinite" proxies where any method/property could be valid. Rust's static type system wants to know methods at compile time.

---

## Approach 1: Trait-Based with Proc Macros (The "tonic" Way)

Inspired by tonic/gRPC and tarpc. Users define interfaces as traits, and proc macros generate stub implementations.

### Philosophy
Type safety is paramount. Every remote interface is a Rust trait. The proc macro generates the stub type that implements the trait, forwarding calls over RPC.

### Connection/Session Creation

```rust
use capnweb::{Session, WebSocketTransport};

// Connect to server
let session = Session::builder()
    .transport(WebSocketTransport::new("wss://api.example.com"))
    .build()
    .await?;

// Get typed stub for the root API
let api: ApiStub = session.stub();
```

### Defining Remote Interfaces

```rust
use capnweb::rpc;

#[rpc::interface]
pub trait UserService {
    async fn get_user(&self, id: u64) -> Result<User, RpcError>;
    async fn list_users(&self) -> Result<Vec<User>, RpcError>;

    // Returns another interface (for hierarchical APIs)
    fn profile(&self) -> ProfileServiceStub;
}

#[rpc::interface]
pub trait ProfileService {
    async fn get_name(&self) -> Result<String, RpcError>;
    async fn update_bio(&self, bio: String) -> Result<(), RpcError>;
}

// The macro generates:
// - UserServiceStub: implements UserService, forwards to RPC
// - ProfileServiceStub: implements ProfileService
```

### Making RPC Calls

```rust
// Simple call with full type inference
let user = api.get_user(42).await?;
println!("User: {}", user.name);

// Chained navigation
let name = api.profile().get_name().await?;

// Result<T, E> and ? work naturally
async fn fetch_users(api: &ApiStub) -> Result<Vec<User>, RpcError> {
    let users = api.list_users().await?;
    Ok(users)
}
```

### Pipelining Syntax

The key insight: methods return `RpcFuture<T>` which is both a Future AND a stub for pipelining.

```rust
use capnweb::Pipeline;

// WITHOUT pipelining (2 round trips)
let user = api.get_user(42).await?;
let name = user.profile.get_name().await?;

// WITH pipelining (1 round trip!)
// Don't await the first call; chain through it
let name = api.get_user(42)      // Returns RpcFuture<User>
    .pipeline(|u| u.profile())   // Navigate through unresolved promise
    .get_name()                  // Call method on pipelined stub
    .await?;

// Alternative: fluent pipeline! macro
let name = pipeline!(api.get_user(42) => profile => get_name()).await?;
```

### Exposing Local Objects as RPC Targets

```rust
use capnweb::{RpcTarget, rpc};

#[rpc::target]
impl MyService {
    pub async fn greet(&self, name: String) -> String {
        format!("Hello, {}!", name)
    }

    pub async fn echo(&self, msg: String) -> String {
        msg
    }
}

// Start server
let service = MyService::new();
let session = Session::builder()
    .transport(WebSocketTransport::accept(socket))
    .export(service)
    .build()
    .await?;
```

### Error Handling

```rust
use capnweb::{RpcError, RpcResult};

// RpcResult<T> = Result<T, RpcError>
async fn safe_fetch(api: &ApiStub) -> RpcResult<User> {
    api.get_user(42).await
}

// Pattern match on error kinds
match api.get_user(42).await {
    Ok(user) => println!("Found: {}", user.name),
    Err(RpcError::NotFound(msg)) => println!("User not found: {}", msg),
    Err(RpcError::Transport(e)) => println!("Connection error: {}", e),
    Err(e) => println!("Other error: {}", e),
}
```

### Pros & Cons

**Pros:**
- Maximum type safety at compile time
- IDE autocompletion and refactoring work perfectly
- Zero-cost abstractions (no runtime reflection)
- Familiar to tonic/tarpc users

**Cons:**
- Requires defining traits for every interface
- Cannot call arbitrary methods (only trait-defined ones)
- Proc macro complexity

---

## Approach 2: Dynamic Stubs with Method Builders (The "reqwest" Way)

Inspired by reqwest's builder pattern. Stubs are dynamic, method calls are built at runtime.

### Philosophy
Flexibility over static typing. A stub can call any method. Type safety comes from explicit annotations at call sites.

### Connection/Session Creation

```rust
use capnweb::Client;

// Simple one-liner (like reqwest)
let client = capnweb::connect("wss://api.example.com").await?;

// Or with options
let client = Client::builder()
    .url("wss://api.example.com")
    .timeout(Duration::from_secs(30))
    .on_disconnect(|err| eprintln!("Disconnected: {}", err))
    .build()
    .await?;
```

### Making RPC Calls

```rust
// Get the root stub
let api = client.stub();

// Call methods using .call() builder
let user: User = api
    .call("getUser")
    .arg(42u64)
    .send()
    .await?;

// Fluent property access
let name: String = api
    .get("users")          // Property access
    .call("find")          // Method call
    .arg(42u64)
    .get("profile")        // Navigate into result
    .get("name")           // Get property
    .send()
    .await?;

// Turbofish for type inference
let users = api.call("listUsers").send::<Vec<User>>().await?;
```

### Pipelining Syntax

Pipelining is natural: just don't `.send()` until you've built the full chain.

```rust
// This entire chain is ONE round trip
let profile_name: String = api
    .call("authenticate").arg(&token)  // Step 1
    .call("getProfile")                 // Step 2 (pipelined)
    .get("displayName")                 // Step 3 (pipelined)
    .send()
    .await?;

// Fork pipelining: multiple leaves from one stem
let auth = api.call("authenticate").arg(&token);  // Not sent yet

let (user_id, friends): (u64, Vec<u64>) = tokio::try_join!(
    auth.call("getUserId").send(),
    auth.call("getFriendIds").send(),
)?;
```

### Exposing Local Objects as RPC Targets

```rust
use capnweb::{Target, handler};

// Function-based handlers
let target = Target::new()
    .method("greet", |name: String| async move {
        Ok(format!("Hello, {}!", name))
    })
    .method("add", |a: i32, b: i32| async move {
        Ok(a + b)
    });

// Or derive-based
#[derive(Target)]
struct Calculator;

#[handler]
impl Calculator {
    async fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }

    async fn multiply(&self, a: i32, b: i32) -> i32 {
        a * b
    }
}

// Export as RPC target
client.export("calculator", Calculator);
```

### Error Handling

```rust
use capnweb::{Error, ErrorKind};

// Errors carry context
let result = api.call("getUser").arg(42u64).send::<User>().await;

match result {
    Ok(user) => println!("{}", user.name),
    Err(e) if e.is_not_found() => println!("Not found"),
    Err(e) if e.is_timeout() => println!("Timed out"),
    Err(e) => return Err(e.into()),
}

// Chain context
let user = api.call("getUser").arg(id)
    .send::<User>()
    .await
    .map_err(|e| e.context(format!("fetching user {}", id)))?;
```

### Pros & Cons

**Pros:**
- No traits or codegen needed
- Can call any method (great for exploratory/dynamic APIs)
- Builder pattern is very Rusty
- Easy to learn

**Cons:**
- Runtime type checking (panics or errors on mismatch)
- No IDE autocompletion for remote methods
- Slightly more verbose

---

## Approach 3: Type-State Pipelining (The "Zero-Cost" Way)

Inspired by the typestate pattern. The type system encodes the pipeline state, enabling compile-time verification of call chains.

### Philosophy
Use Rust's type system to its fullest. Every pipeline step has a unique type. Invalid chains don't compile.

### Connection/Session Creation

```rust
use capnweb::prelude::*;

// Connection returns a typed root
let api: Root<Api> = capnweb::connect::<Api>("wss://api.example.com").await?;
```

### Defining the Type Schema

```rust
use capnweb::schema;

schema! {
    // Define the API structure
    interface Api {
        fn authenticate(token: String) -> AuthedApi;
        fn get_public_user(id: u64) -> User;
    }

    interface AuthedApi {
        fn get_profile() -> Profile;
        fn get_friends() -> Vec<UserId>;
    }

    interface Profile {
        fn name() -> String;
        fn bio() -> String;
        fn update(bio: String) -> ();
    }

    // Value types (passed by value, not reference)
    struct User {
        id: u64,
        name: String,
    }

    type UserId = u64;
}
```

### Making RPC Calls

```rust
// Every operation is fully typed
let profile = api
    .authenticate(token.clone())  // : Pipeline<AuthedApi>
    .get_profile()                // : Pipeline<Profile>
    .await?;                      // : Profile

// Type errors caught at compile time!
// api.authenticate(token).get_friends().name();
// Error: Vec<UserId> doesn't have method `name`

let name = api.get_public_user(42).name; // : Pipeline<String>
let name: String = name.await?;
```

### Pipelining Syntax

Pipelining is the default. The type system tracks it.

```rust
// Type signature shows the pipeline depth
fn complex_query(api: &Root<Api>, token: String) -> Pipeline<String, Depth3> {
    api.authenticate(token)   // Depth1
       .get_profile()         // Depth2
       .name()                // Depth3
}

// Only .await actually sends the request
let name = complex_query(&api, token).await?;

// The magic: parallel pipelines in one round trip
let auth = api.authenticate(token);

// Both of these pipeline through `auth`
let profile_name = auth.get_profile().name();
let friend_count = auth.get_friends().map(|f| f.len());

// Single round trip via join
let (name, count): (String, usize) =
    capnweb::join!(profile_name, friend_count).await?;
```

### The Map Operation

```rust
// .map() with full type inference
let friend_ids: Pipeline<Vec<u64>> = auth.get_friends();

let friend_names: Pipeline<Vec<String>> = friend_ids.map(|id| {
    // `id` here is Pipeline<u64>, not u64
    // We can use it in further RPC calls
    api.get_public_user(id).name
});

let names: Vec<String> = friend_names.await?;
```

### Exposing Local Objects as RPC Targets

```rust
use capnweb::target;

#[target]
struct MyProfileService {
    user_id: u64,
}

#[target]
impl MyProfileService {
    fn name(&self) -> String {
        fetch_name(self.user_id)
    }

    fn bio(&self) -> String {
        fetch_bio(self.user_id)
    }

    async fn update(&self, bio: String) -> Result<(), Error> {
        update_bio(self.user_id, bio).await
    }
}

// Register implements the Profile interface
let session = capnweb::serve::<Profile, _>(MyProfileService::new(42), transport);
```

### Pros & Cons

**Pros:**
- Maximum compile-time safety
- Invalid pipelines are compile errors
- Zero runtime overhead for type checking
- Self-documenting (types show the API structure)

**Cons:**
- Requires schema definition (can't call undefined methods)
- Complex macro DSL to learn
- Type errors can be verbose

---

## Approach 4: Async Trait Objects with GATs (The "OOP-Familiar" Way)

Uses async traits and dynamic dispatch. Familiar to developers from OOP backgrounds.

### Philosophy
Make stubs feel like regular async Rust objects. Use `dyn Trait` for flexibility where needed.

### Connection/Session Creation

```rust
use capnweb::{Connection, Stub};

// Connect and get a type-erased stub
let conn = Connection::open("wss://api.example.com").await?;
let api: Stub = conn.root();

// Or with a typed interface
let api: Box<dyn ApiService> = conn.root_as::<dyn ApiService>();
```

### Defining Interfaces with Async Traits

```rust
use capnweb::{rpc_trait, Stub, RpcResult};

#[rpc_trait]
pub trait ApiService: Send + Sync {
    async fn get_user(&self, id: u64) -> RpcResult<User>;
    async fn authenticate(&self, token: &str) -> RpcResult<Box<dyn AuthService>>;
}

#[rpc_trait]
pub trait AuthService: Send + Sync {
    async fn profile(&self) -> RpcResult<Box<dyn ProfileService>>;
    async fn friend_ids(&self) -> RpcResult<Vec<u64>>;
}

#[rpc_trait]
pub trait ProfileService: Send + Sync {
    async fn name(&self) -> RpcResult<String>;
    async fn bio(&self) -> RpcResult<String>;
}
```

### Making RPC Calls

```rust
// Using the typed interface
let api: &dyn ApiService = &*conn.root_as::<dyn ApiService>();

let user = api.get_user(42).await?;
println!("User: {}", user.name);

// Chain through returned traits
let auth = api.authenticate(&token).await?;
let profile = auth.profile().await?;
let name = profile.name().await?;
```

### Pipelining Syntax

Uses a `Pipeline` wrapper that implements the trait via pipelining.

```rust
use capnweb::Pipeline;

// Pipeline<T> implements the same trait as T, but pipelines calls
let auth: Pipeline<dyn AuthService> = api.authenticate(&token).pipeline();

// These calls don't await immediately - they build a pipeline
let profile: Pipeline<dyn ProfileService> = auth.profile().pipeline();
let name_future = profile.name();  // Still pipelined

// Now resolve the full pipeline
let name: String = name_future.await?;  // Single round trip!

// Or use the pipeline! macro for ergonomics
let name = pipeline! {
    api.authenticate(&token)
       .profile()
       .name()
}.await?;
```

### Exposing Local Objects as RPC Targets

```rust
use capnweb::{rpc_trait, export};

struct MyApi {
    db: Database,
}

// Implement the trait directly
#[export]
impl ApiService for MyApi {
    async fn get_user(&self, id: u64) -> RpcResult<User> {
        self.db.find_user(id).await.map_err(Into::into)
    }

    async fn authenticate(&self, token: &str) -> RpcResult<Box<dyn AuthService>> {
        let user_id = verify_token(token).await?;
        Ok(Box::new(MyAuthService { user_id, db: self.db.clone() }))
    }
}

// Start serving
let server = Connection::serve(MyApi::new(db), transport).await?;
```

### Error Handling

```rust
use capnweb::{RpcResult, RpcError};

// Functions return RpcResult<T>
async fn get_profile_name(api: &dyn ApiService, token: &str) -> RpcResult<String> {
    let auth = api.authenticate(token).await?;
    let profile = auth.profile().await?;
    profile.name().await
}

// Error downcasting
if let Err(e) = get_profile_name(&api, token).await {
    if let Some(auth_err) = e.downcast_ref::<AuthError>() {
        println!("Auth failed: {}", auth_err);
    }
}
```

### Pros & Cons

**Pros:**
- Familiar OOP-style async traits
- Works well with `dyn Trait` for flexibility
- Clean separation between interface and implementation
- Good for library APIs where you want trait objects

**Cons:**
- Dynamic dispatch overhead
- Pipelining requires explicit `.pipeline()` call
- `Box<dyn Trait>` allocations
- Async traits still have some rough edges

---

## Comparison Matrix

| Feature | Approach 1 (Trait+Macro) | Approach 2 (Builder) | Approach 3 (TypeState) | Approach 4 (Async Trait) |
|---------|--------------------------|----------------------|------------------------|--------------------------|
| **Type Safety** | Compile-time | Runtime | Compile-time | Compile-time |
| **Pipelining** | Explicit `.pipeline()` | Natural (builder chain) | Natural (default) | Explicit `.pipeline()` |
| **Dynamic Calls** | No | Yes | No | No |
| **IDE Support** | Excellent | Limited | Excellent | Excellent |
| **Learning Curve** | Medium | Easy | Hard | Medium |
| **Performance** | Zero-cost | Small overhead | Zero-cost | dyn overhead |
| **Flexibility** | Low | High | Low | Medium |
| **Boilerplate** | Medium (traits) | Low | High (schema) | Medium (traits) |

---

## Recommended Hybrid Approach

After analyzing all four approaches, a practical `capnweb` crate might combine elements:

### Primary API: Typed Traits (Approach 1 + 4)

```rust
use capnweb::prelude::*;

#[capnweb::interface]
trait Api {
    async fn users(&self) -> UserService;
    async fn authenticate(&self, token: String) -> AuthedApi;
}

#[capnweb::interface]
trait UserService {
    async fn get(&self, id: u64) -> User;
    async fn list(&self) -> Vec<User>;
}

// Connect with typed stub
let session = capnweb::connect::<Api>("wss://api.example.com").await?;
let api = session.stub();

// Typed calls with full IDE support
let user = api.users().await?.get(42).await?;
```

### Pipelining: Method Chaining (Approach 3)

```rust
// Pipelining through non-awaited futures
let users_service = api.users();  // RpcFuture<UserService>
let user = users_service.get(42); // RpcFuture<User> (pipelined!)
let user: User = user.await?;     // Single round trip

// Or fluent
let user = api.users().get(42).await?;
```

### Fallback: Dynamic Calls (Approach 2)

```rust
use capnweb::Dynamic;

// When you need to call unknown methods
let stub = api.dynamic();
let result: Value = stub.call("someNewMethod").arg("test").send().await?;
```

### Targets: Derive Macro

```rust
#[capnweb::target]
impl MyUserService {
    pub async fn get(&self, id: u64) -> Result<User, Error> {
        self.db.find(id).await
    }

    pub async fn list(&self) -> Result<Vec<User>, Error> {
        self.db.all().await
    }
}
```

---

## Implementation Notes

### Crate Structure

```
capnweb/
  src/
    lib.rs           # Re-exports, prelude
    session.rs       # Session management
    transport/       # WebSocket, HTTP, custom transports
    stub.rs          # RpcStub, RpcFuture
    target.rs        # RpcTarget trait
    pipeline.rs      # Pipelining machinery
    error.rs         # RpcError, RpcResult

capnweb-macros/
  src/
    lib.rs           # Proc macros: interface, target
```

### Key Types

```rust
/// A session manages one RPC connection
pub struct Session<T: Transport> { ... }

/// A future that can also be used for pipelining
pub struct RpcFuture<T> { ... }

impl<T> Future for RpcFuture<T> {
    type Output = Result<T, RpcError>;
}

impl<T: HasMethods> RpcFuture<T> {
    /// Pipeline a method call through this unresolved future
    pub fn call<M>(&self, method: M) -> RpcFuture<M::Output>
    where M: Method<T>;
}

/// Marker trait for types that can be RPC targets
pub trait RpcTarget: Send + Sync + 'static { ... }

/// Error type for RPC operations
pub enum RpcError {
    Transport(TransportError),
    Remote(RemoteError),
    Timeout,
    Canceled,
    TypeMismatch { expected: &'static str, got: String },
}
```

### Feature Flags

```toml
[features]
default = ["tokio", "websocket"]
tokio = ["tokio/full"]
async-std = ["async-std"]
websocket = ["tokio-tungstenite"]
http = ["reqwest"]
macros = ["capnweb-macros"]
```

---

## Open Questions

1. **Ownership of stubs**: Should stubs be `Clone`? Reference-counted? How does disposal map to Rust's Drop?

2. **Pipelining ergonomics**: Should `.await` be the trigger, or explicit `.send()`? What happens if you pipeline but never await?

3. **Streaming**: How to handle `AsyncIterator`/`Stream` return types for subscriptions?

4. **Cancellation**: How does dropping an `RpcFuture` affect the remote call? Should we use `tokio_util::sync::CancellationToken`?

5. **Backpressure**: How to handle slow consumers in bidirectional scenarios?

---

## Next Steps

1. Prototype Approach 1 (trait-based) as the primary API
2. Add Approach 2 (builder) as `capnweb::dynamic` module
3. Implement core transport (WebSocket first)
4. Write comprehensive tests with mock server
5. Benchmark pipelining vs sequential calls
6. Publish to crates.io as `capnweb`
