# Cap'n Web Rust API

The definitive API for Cap'n Web RPC in Rust.

---

## Design Principles

1. **Pipelining is the default** - Method chains are promises, not values
2. **Types guide, not constrain** - Typed interfaces with dynamic escape hatch
3. **Ownership is explicit** - Stubs are cheap clones; drops cancel
4. **Errors are values** - `Result<T, E>` everywhere, `?` propagates naturally

---

## Quick Start

```rust
use capnweb::prelude::*;

#[capnweb::interface]
trait Api {
    fn users(&self) -> Users;
    fn auth(&self, token: String) -> Session;
}

#[capnweb::interface]
trait Users {
    fn get(&self, id: u64) -> User;
    fn list(&self) -> Vec<User>;
}

#[derive(Deserialize)]
struct User {
    id: u64,
    name: String,
}

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<Api>("wss://api.example.com").await?;

    // Single round-trip: pipelining is automatic
    let user = api.users().get(42).await?;

    println!("{}", user.name);
    Ok(())
}
```

---

## Connection

```rust
// Simple
let api = capnweb::connect::<Api>(url).await?;

// With options
let api = capnweb::Client::builder()
    .url("wss://api.example.com")
    .timeout(Duration::from_secs(30))
    .reconnect(capnweb::Reconnect::exponential())
    .connect::<Api>()
    .await?;
```

---

## Interfaces

Define remote interfaces as traits. The `#[capnweb::interface]` macro generates stub types.

```rust
#[capnweb::interface]
trait Api {
    // Returns another interface (capability)
    fn users(&self) -> Users;

    // Returns data
    fn version(&self) -> String;

    // With arguments
    fn authenticate(&self, token: String) -> Session;
}

#[capnweb::interface]
trait Users {
    fn get(&self, id: u64) -> User;
    fn create(&self, name: String, email: String) -> User;
    fn delete(&self, id: u64) -> ();
}

#[capnweb::interface]
trait Session {
    fn user(&self) -> User;
    fn permissions(&self) -> Vec<String>;
    fn revoke(&self) -> ();
}
```

**Key insight**: Return types are not wrapped in `Result`. The `Result` appears when you `.await`:

```rust
let users: Users = api.users();           // Promise<Users>, no network yet
let user: Promise<User> = users.get(42);  // Promise<User>, still no network
let user: User = user.await?;             // NOW we send, Result<User, Error>
```

---

## Pipelining

Pipelining sends the entire call chain in one round-trip. It's automatic.

```rust
// These three calls are ONE round-trip:
let name = api
    .users()       // -> Promise<Users>
    .get(42)       // -> Promise<User>
    .profile()     // -> Promise<Profile>
    .name()        // -> Promise<String>
    .await?;       // Execute all, return String
```

### Forking Pipelines

```rust
let session = api.authenticate(token);  // Not sent yet

// Both fork from the same promise
let user = session.user();
let perms = session.permissions();

// Single round-trip resolves both
let (user, perms) = capnweb::join!(user, perms).await?;
```

### The `Promise<T>` Type

`Promise<T>` is both a `Future` and a stub. You can call methods on it before awaiting.

```rust
pub struct Promise<T> { /* ... */ }

impl<T> Future for Promise<T> {
    type Output = Result<T, Error>;
}

// If T has methods, so does Promise<T>
impl Promise<Users> {
    fn get(&self, id: u64) -> Promise<User> { /* ... */ }
    fn list(&self) -> Promise<Vec<User>> { /* ... */ }
}
```

---

## Error Handling

```rust
use capnweb::{Error, Result};

// Result<T> = Result<T, capnweb::Error>
async fn fetch_user(api: &Api, id: u64) -> Result<User> {
    api.users().get(id).await
}

// Pattern match on errors
match api.users().get(id).await {
    Ok(user) => println!("{}", user.name),
    Err(Error::NotFound(path)) => println!("No user at {}", path),
    Err(Error::Unauthorized) => println!("Access denied"),
    Err(Error::Transport(e)) => println!("Network error: {}", e),
    Err(e) => return Err(e),
}

// Add context
let user = api.users().get(id)
    .await
    .context(format!("fetching user {}", id))?;
```

---

## Exposing Services

Implement interfaces locally and export them.

```rust
use capnweb::target;

struct MyUsers {
    db: Database,
}

#[target(Users)]
impl MyUsers {
    async fn get(&self, id: u64) -> Result<User> {
        self.db.find(id).await
    }

    async fn create(&self, name: String, email: String) -> Result<User> {
        self.db.insert(name, email).await
    }

    async fn delete(&self, id: u64) -> Result<()> {
        self.db.remove(id).await
    }
}

// Serve
capnweb::serve(MyUsers::new(db))
    .listen("0.0.0.0:8080")
    .await?;
```

---

## Dynamic Calls

When you need to call methods not defined in traits:

```rust
use capnweb::Dynamic;

// Escape hatch to dynamic
let dyn_api = api.dynamic();

let result: serde_json::Value = dyn_api
    .call("experimentalMethod")
    .arg("param1")
    .arg(42)
    .await?;

// Navigate dynamically
let value: String = dyn_api
    .get("nested")
    .get("property")
    .await?;
```

---

## Core Types

```rust
/// Connect to a Cap'n Web server
pub async fn connect<T: Interface>(url: &str) -> Result<T>;

/// A promise of a remote value. Call methods to pipeline.
pub struct Promise<T> { /* ... */ }

/// RPC error types
pub enum Error {
    Transport(TransportError),
    NotFound(String),
    Unauthorized,
    InvalidArgument(String),
    Remote { code: i32, message: String },
    Timeout,
    Canceled,
}

pub type Result<T> = std::result::Result<T, Error>;
```

---

## Traits

```rust
/// Marker for types that can be RPC interfaces
pub trait Interface: Send + Sync + 'static {
    type Stub: Clone + Send + Sync;
}

/// Marker for types that can be serialized over RPC
pub trait Message: Serialize + DeserializeOwned + Send + 'static {}

/// Implemented by local services
pub trait Target<I: Interface>: Send + Sync + 'static {
    // Generated by #[target] macro
}
```

---

## Ownership & Lifecycle

```rust
// Stubs are cheap to clone (Arc internally)
let api2 = api.clone();

// Dropping a Promise cancels the pending call
let promise = api.users().list();
drop(promise);  // Server receives cancellation

// Stubs hold capability references
{
    let session = api.authenticate(token).await?;
    // session capability is live
}
// session dropped -> server may garbage collect
```

---

## Streaming

```rust
#[capnweb::interface]
trait Events {
    fn subscribe(&self, topic: String) -> Stream<Event>;
}

// Consume as async iterator
let mut events = api.events().subscribe("updates").await?;

while let Some(event) = events.next().await {
    let event = event?;
    println!("Got: {:?}", event);
}
```

---

## Complete Example

```rust
use capnweb::prelude::*;

#[capnweb::interface]
trait TodoApi {
    fn todos(&self) -> Todos;
    fn auth(&self, token: String) -> AuthedApi;
}

#[capnweb::interface]
trait Todos {
    fn list(&self) -> Vec<Todo>;
    fn get(&self, id: u64) -> Todo;
}

#[capnweb::interface]
trait AuthedApi {
    fn todos(&self) -> MutableTodos;
    fn me(&self) -> User;
}

#[capnweb::interface]
trait MutableTodos {
    fn create(&self, title: String) -> Todo;
    fn update(&self, id: u64, done: bool) -> Todo;
    fn delete(&self, id: u64) -> ();
}

#[derive(Deserialize)]
struct Todo { id: u64, title: String, done: bool }

#[derive(Deserialize)]
struct User { id: u64, name: String }

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<TodoApi>("wss://todo.example.com").await?;

    // Public: list todos (one round-trip)
    let todos = api.todos().list().await?;

    // Authenticated: create and immediately fetch (one round-trip!)
    let session = api.auth(std::env::var("TOKEN")?);
    let new_todo = session.todos().create("Learn Rust".into());
    let me = session.me();

    let (todo, user) = capnweb::join!(new_todo, me).await?;
    println!("{} created: {}", user.name, todo.title);

    Ok(())
}
```

---

## Why This Design

| Choice | Rationale |
|--------|-----------|
| `Promise<T>` as dual Future/Stub | Enables natural method chaining that pipelines automatically |
| Trait-based interfaces | Full IDE support, compile-time safety, zero-cost dispatch |
| No `Result` in trait signatures | Cleaner syntax; Result appears at await boundary |
| `#[target]` on impl blocks | Familiar pattern from axum/actix; async fn just works |
| `dynamic()` escape hatch | Pragmatic flexibility without compromising typed API |
| `Arc` interior for Clone | Stubs represent capabilities; sharing is natural |
| Drop = Cancel | Rust ownership maps perfectly to RPC lifecycle |

---

## Appendix: Generated Code

For `#[capnweb::interface] trait Users { fn get(&self, id: u64) -> User; }`:

```rust
// Generated stub type
#[derive(Clone)]
pub struct UsersStub {
    inner: Arc<StubInner>,
}

impl UsersStub {
    pub fn get(&self, id: u64) -> Promise<User> {
        Promise::new(self.inner.clone(), "get", (id,))
    }
}

// Promise<Users> can call Users methods
impl Promise<UsersStub> {
    pub fn get(&self, id: u64) -> Promise<User> {
        self.pipeline("get", (id,))
    }
}
```
