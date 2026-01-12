# capnweb

**Zero-cost capability-based RPC for Rust.**

```rust
let user = api.users().get(42).profile().name().await?;
```

One line. One round-trip. Full type safety. Automatic pipelining.

## Why capnweb?

Cap'n Web brings capability-based RPC to Rust with an API designed for Rust developers:

- **`async`/`.await`** - First-class tokio integration, composable with the entire async ecosystem
- **`Result<T, E>`** - Errors are values; `?` propagation works exactly as expected
- **Pipelining is invisible** - Chain methods on unresolved promises; calls batch automatically
- **Drop = Cancel** - RAII semantics extend to network requests; drop a promise to cancel
- **Proc macros** - Define interfaces as traits, get type-safe stubs with zero boilerplate
- **Bidirectional RPC** - Export local capabilities; receive remote calls on your types
- **Ownership semantics** - `Clone` a stub to share; `Drop` to release server-side resources

### Technical Specifications

| Aspect | Details |
|--------|---------|
| Minimum Rust | 1.75+ (async in traits) |
| Async Runtime | tokio (default), async-std optional |
| Transport | WebSocket (default), HTTP batch optional |
| Serialization | JSON with special type encoding |
| Protocol | Cap'n Web (CapTP-derived, bidirectional) |

---

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
capnweb-do = "0.1"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
```

Or use cargo:

```bash
cargo add capnweb-do
```

> **Note:** The crate is published as `capnweb-do` on crates.io (since crates.io doesn't allow dots in crate names). After installation, use it as `capnweb_do` or rename in your imports.

### Feature Flags

```toml
[dependencies]
capnweb-do = { version = "0.1", features = ["macros", "http"] }
```

| Feature | Default | Description |
|---------|---------|-------------|
| `macros` | Yes | `#[interface]` and `#[target]` proc macros |
| `tokio` | Yes | Tokio runtime support |
| `async-std` | No | async-std runtime support |
| `websocket` | Yes | WebSocket transport via tokio-tungstenite |
| `http` | No | HTTP batch transport via reqwest |
| `rustls` | No | TLS via rustls (vs native-tls) |
| `wasm` | No | WebAssembly target support |

---

## Quick Start

### 1. Define Your Interfaces

Interfaces are Rust traits. The `#[capnweb::interface]` proc macro generates:
- A stub type that forwards method calls over RPC
- A `Promise<T>` return type that enables pipelining
- Serialization/deserialization for arguments and return values

```rust
use capnweb::prelude::*;
use serde::{Deserialize, Serialize};

#[capnweb::interface]
trait Api {
    fn users(&self) -> Users;
    fn authenticate(&self, token: String) -> Session;
}

#[capnweb::interface]
trait Users {
    fn get(&self, id: u64) -> User;
    fn list(&self) -> Vec<User>;
    fn create(&self, name: String, email: String) -> User;
}

#[derive(Debug, Deserialize, Serialize)]
struct User {
    id: u64,
    name: String,
    email: String,
}
```

**How the proc macro works:** The `#[interface]` attribute transforms your trait into a capability interface. Each method signature `fn foo(&self, args...) -> T` generates:
1. A method on the stub that returns `Promise<T>`
2. Wire protocol encoding for the call
3. Deserialization of the response into `T`

**WARNING:** Trait methods must not include `async` or `Result` in their signatures. The `async` and error handling happen at `.await` time, keeping the trait definition clean for pipelining.

### 2. Connect and Call

```rust
#[tokio::main]
async fn main() -> capnweb::Result<()> {
    // Connect to a Cap'n Web server
    let api = capnweb::connect::<Api>("wss://api.example.com").await?;

    // Make a pipelined call - this entire chain is ONE round-trip
    let user = api.users().get(42).await?;

    println!("Hello, {}!", user.name);
    Ok(())
}
```

---

## Pipelining

The killer feature. Chain method calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response before making the next call:

```rust
// WITHOUT pipelining: 3 sequential round-trips
let users = api.users().await?;           // Round trip 1
let user = users.get(42).await?;          // Round trip 2
let profile = user.profile().await?;      // Round trip 3
let name = profile.name;
```

Total latency: 3x network round-trip time.

### The Solution

```rust
// WITH pipelining: 1 round-trip
let name = api.users().get(42).profile().name().await?;
```

Total latency: 1x network round-trip time.

### How Does It Work?

Every interface method returns a `Promise<T>`. A `Promise` has a dual nature:

1. **As a `Future`** - Await it to get the resolved value
2. **As a callable stub** - Call methods on it before awaiting

```rust
let users: Promise<Users> = api.users();       // No network yet
let user: Promise<User> = users.get(42);       // Still no network
let profile: Promise<Profile> = user.profile(); // Building the pipeline...
let profile: Profile = profile.await?;          // NOW we send everything
```

The entire method chain is encoded as a single `push` message to the server. The server evaluates `api.users().get(42).profile()` in one shot and returns the result.

### The `Promise<T>` Type

```rust
/// A lazy RPC result that supports pipelining.
///
/// `Promise<T>` implements both `Future<Output = Result<T>>` and
/// allows calling methods on interfaces before resolution.
pub struct Promise<T> {
    // Internal: connection handle, expression tree, phantom data
}

impl<T> Future for Promise<T> {
    type Output = Result<T>;
    // Polls the underlying RPC call
}

// For interface types, Promise<T> also implements the interface methods
// This is generated by the proc macro
```

### Forking Pipelines

Multiple calls can branch from a shared prefix:

```rust
let session = api.authenticate(token);  // Not sent yet - just a Promise

// Both calls branch from the same unresolved session
let user_promise = session.user();
let perms_promise = session.permissions();

// Single round-trip resolves both branches
let (user, perms) = capnweb::join!(user_promise, perms_promise).await?;
```

### Understanding `capnweb::join!`

The `join!` macro executes multiple promises concurrently and waits for all to complete.

```rust
/// Execute multiple promises concurrently, returning when all complete.
///
/// # Return Type
/// Returns `Result<(A, B, ...), Error>` - if ANY promise fails, the entire
/// join fails with that error. Successfully resolved values from other
/// promises are dropped.
///
/// # Cancellation
/// If one promise fails, the others are NOT automatically cancelled.
/// To cancel on first error, use `try_join!` or manual cancellation.
///
/// # Example
/// ```rust
/// let (user, posts) = capnweb::join!(
///     api.users().get(id),
///     api.posts().list_for_user(id)
/// ).await?;
/// ```
#[macro_export]
macro_rules! join {
    ($($promise:expr),+ $(,)?) => { ... }
}
```

**WARNING:** `capnweb::join!` returns `Result<(A, B), Error>`, not `(Result<A>, Result<B>)`. If you need individual error handling, await promises separately or use `futures::join!` which returns a tuple of Results.

```rust
// If you need independent error handling:
use futures::join;

let (user_result, posts_result) = join!(
    api.users().get(id),
    api.posts().list()
);

// Handle each independently
let user = user_result.unwrap_or_default();
let posts = posts_result?;
```

---

## Error Handling

Errors are values. The `?` operator works exactly as you expect.

```rust
use capnweb::{Error, Result};

async fn fetch_author_name(api: &Api, post_id: u64) -> Result<String> {
    let author = api.posts().get(post_id).author().await?;
    Ok(author.name)
}

// Pattern match on error variants
match api.posts().get(post_id).await {
    Ok(post) => println!("Found: {}", post.title),
    Err(Error::NotFound(path)) => eprintln!("No post at {}", path),
    Err(Error::Unauthorized) => eprintln!("Access denied"),
    Err(Error::Transport(e)) => eprintln!("Network error: {}", e),
    Err(Error::Timeout) => eprintln!("Request timed out"),
    Err(Error::Canceled) => eprintln!("Request was canceled"),
    Err(e) => return Err(e),
}
```

### Error Types

```rust
/// All errors that can occur during RPC operations.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Network or connection failure
    #[error("transport error: {0}")]
    Transport(#[from] TransportError),

    /// Resource not found (404 equivalent)
    #[error("not found: {0}")]
    NotFound(String),

    /// Authentication required or failed
    #[error("unauthorized")]
    Unauthorized,

    /// Permission denied for this operation
    #[error("forbidden: {0}")]
    Forbidden(String),

    /// Invalid argument passed to RPC
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// Error returned by remote server
    #[error("remote error {code}: {message}")]
    Remote { code: i32, message: String },

    /// Request timed out
    #[error("timeout")]
    Timeout,

    /// Request was canceled (promise dropped before completion)
    #[error("canceled")]
    Canceled,

    /// Session was terminated
    #[error("session aborted: {0}")]
    Aborted(String),
}

/// Alias for Result<T, capnweb::Error>
pub type Result<T> = std::result::Result<T, Error>;
```

### Adding Context

```rust
use capnweb::ResultExt;

let post = api.posts().get(id)
    .await
    .context(format!("fetching post {}", id))?;

// Or with closures for lazy evaluation
let user = api.users().get(id)
    .await
    .with_context(|| format!("user {} not found", id))?;
```

---

## Implementing Services

Expose your own types as RPC targets using `#[capnweb::target]`.

```rust
use capnweb::{target, Result};

struct MyUsers {
    db: Database,
}

#[target(Users)]
impl MyUsers {
    async fn get(&self, id: u64) -> Result<User> {
        self.db.find_user(id)
            .await
            .map_err(|e| Error::NotFound(format!("user {}", id)))
    }

    async fn list(&self) -> Result<Vec<User>> {
        self.db.all_users().await.map_err(Into::into)
    }

    async fn create(&self, name: String, email: String) -> Result<User> {
        self.db.insert_user(&name, &email).await.map_err(Into::into)
    }
}
```

### Understanding `#[target]` and `impl Trait` Returns

When a service method returns a capability (another interface), use `impl Trait`:

```rust
#[capnweb::interface]
trait Api {
    fn authenticate(&self, token: String) -> AuthenticatedApi;
}

#[capnweb::interface]
trait AuthenticatedApi {
    fn me(&self) -> User;
    fn posts(&self) -> MutablePosts;
}

struct MyApi { db: Database }

#[target(Api)]
impl MyApi {
    // Return type is `impl AuthenticatedApi` - the proc macro handles
    // wrapping the concrete type and exporting it as a capability
    async fn authenticate(&self, token: String) -> Result<impl AuthenticatedApi> {
        let user_id = verify_token(&token).await?;
        Ok(AuthenticatedSession {
            user_id,
            db: self.db.clone(),
        })
    }
}

struct AuthenticatedSession {
    user_id: u64,
    db: Database,
}

#[target(AuthenticatedApi)]
impl AuthenticatedSession {
    async fn me(&self) -> Result<User> {
        self.db.find_user(self.user_id).await
    }

    async fn posts(&self) -> Result<impl MutablePosts> {
        Ok(UserPosts {
            user_id: self.user_id,
            db: self.db.clone(),
        })
    }
}
```

**How `impl Trait` works with proc macros:** The `#[target]` macro generates wrapper code that:
1. Implements the interface trait for your concrete type
2. Automatically exports returned capabilities to the client's import table
3. Handles the `impl Trait` return by boxing the concrete type internally

### Serving Your API

```rust
use capnweb::serve;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let db = Database::connect("postgres://localhost/myapp").await?;
    let api = MyApi { db };

    // Serve over WebSocket
    capnweb::serve(api)
        .listen("0.0.0.0:8080")
        .await
}
```

With custom configuration:

```rust
capnweb::serve(api)
    .tls(cert_path, key_path)
    .max_connections(1000)
    .idle_timeout(Duration::from_secs(300))
    .on_connect(|conn| {
        tracing::info!("New connection from {}", conn.remote_addr());
    })
    .listen("0.0.0.0:443")
    .await
```

---

## Bidirectional RPC

Cap'n Web is fully bidirectional. The server can call capabilities exported by the client, and vice versa.

### Client Exporting Capabilities

```rust
#[capnweb::interface]
trait ProgressCallback {
    fn on_progress(&self, percent: u32);
    fn on_complete(&self, result: String);
    fn on_error(&self, message: String);
}

struct MyProgressHandler;

#[target(ProgressCallback)]
impl MyProgressHandler {
    async fn on_progress(&self, percent: u32) -> Result<()> {
        println!("Progress: {}%", percent);
        Ok(())
    }

    async fn on_complete(&self, result: String) -> Result<()> {
        println!("Complete: {}", result);
        Ok(())
    }

    async fn on_error(&self, message: String) -> Result<()> {
        eprintln!("Error: {}", message);
        Ok(())
    }
}

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let client = capnweb::Client::builder()
        .url("wss://api.example.com")
        .connect::<Api>()
        .await?;

    // Export a local capability that the server can call
    let callback = client.export(MyProgressHandler);

    // Pass the callback to a long-running server operation
    // The server will call methods on our callback as it progresses
    let result = client.api()
        .long_running_task("heavy-computation", callback)
        .await?;

    Ok(())
}
```

### Server Calling Client Capabilities

From the server's perspective, client-exported capabilities look like any other stub:

```rust
#[capnweb::interface]
trait Api {
    fn long_running_task(&self, name: String, callback: ProgressCallback) -> TaskResult;
}

#[target(Api)]
impl MyApi {
    async fn long_running_task(
        &self,
        name: String,
        callback: impl ProgressCallback,  // Client-provided capability
    ) -> Result<TaskResult> {
        for i in 0..=100 {
            // Call back to the client - this sends an RPC to the client
            callback.on_progress(i).await?;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        callback.on_complete("Done!".into()).await?;

        Ok(TaskResult { success: true })
    }
}
```

### Bidirectional Capability Exchange

Both sides can export capabilities at any time. The protocol manages import/export tables automatically:

```rust
// Server receives client callback, exports its own capability back
#[target(Api)]
impl MyApi {
    async fn subscribe(
        &self,
        topic: String,
        handler: impl EventHandler,  // Client exports this
    ) -> Result<impl Subscription> {  // Server exports this back
        let sub = ActiveSubscription::new(topic, handler);
        self.subscriptions.add(sub.clone()).await;
        Ok(sub)  // Client receives a Subscription stub
    }
}

// Client can then call methods on the returned Subscription
let subscription = api.subscribe("events", my_handler).await?;
subscription.pause().await?;
subscription.resume().await?;
subscription.cancel().await?;
```

---

## Streaming

For real-time data, interfaces can return async streams.

### Basic Streaming

```rust
use futures::StreamExt;

#[capnweb::interface]
trait Events {
    fn subscribe(&self, topic: String) -> Stream<Event>;
}

#[derive(Debug, Deserialize)]
struct Event {
    id: u64,
    kind: String,
    payload: serde_json::Value,
    timestamp: u64,
}

let mut events = api.events().subscribe("user.updates".into()).await?;

while let Some(result) = events.next().await {
    match result {
        Ok(event) => println!("Event {}: {:?}", event.id, event.kind),
        Err(e) => {
            eprintln!("Stream error: {}", e);
            break;
        }
    }
}
```

### Stream Error Handling

Streams yield `Result<T, Error>` for each item. Handle errors inline or break on first error:

```rust
use futures::{StreamExt, TryStreamExt};

// Option 1: Handle each error individually
let mut events = api.events().subscribe(topic).await?;
while let Some(result) = events.next().await {
    let event = match result {
        Ok(e) => e,
        Err(Error::Timeout) => {
            // Transient error - continue
            continue;
        }
        Err(e) => {
            // Fatal error - break
            eprintln!("Fatal stream error: {}", e);
            break;
        }
    };
    process_event(event).await;
}

// Option 2: Collect until first error with try_collect
let events: Vec<Event> = api.events()
    .subscribe(topic)
    .await?
    .try_collect()
    .await?;

// Option 3: Use try_for_each for side effects
api.events()
    .subscribe(topic)
    .await?
    .try_for_each(|event| async move {
        process_event(event).await;
        Ok(())
    })
    .await?;
```

### Backpressure

Cap'n Web streams implement backpressure. If your consumer is slow, the server will be signaled to slow down.

```rust
use std::time::Duration;
use futures::StreamExt;

let mut events = api.events().subscribe(topic).await?;

// Backpressure is automatic - server won't overwhelm a slow consumer
while let Some(event) = events.next().await {
    let event = event?;

    // Slow processing - server will back off
    tokio::time::sleep(Duration::from_secs(1)).await;
    process_event(event).await;
}
```

**How backpressure works:** The protocol uses a credit-based flow control system. The client sends "pull" messages to request more items. If the client stops pulling (because `next()` isn't being called), the server stops sending.

### Implementing Server-Side Streams

```rust
use futures::stream::{self, Stream as FuturesStream};
use tokio::sync::broadcast;

struct MyEvents {
    sender: broadcast::Sender<Event>,
}

#[target(Events)]
impl MyEvents {
    async fn subscribe(&self, topic: String) -> Result<impl FuturesStream<Item = Result<Event>>> {
        let mut receiver = self.sender.subscribe();

        let stream = async_stream::stream! {
            loop {
                match receiver.recv().await {
                    Ok(event) if event.topic == topic => {
                        yield Ok(event);
                    }
                    Ok(_) => continue,  // Different topic
                    Err(broadcast::error::RecvError::Closed) => break,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Client fell behind - yield an error but continue
                        yield Err(Error::Remote {
                            code: 429,
                            message: format!("Lagged {} events", n),
                        });
                    }
                }
            }
        };

        Ok(stream)
    }
}
```

### Stream Cancellation

Dropping the stream cancels the subscription server-side:

```rust
{
    let events = api.events().subscribe(topic).await?;
    // Stream is active

    // Take only 10 events, then implicitly drop the stream
    let first_ten: Vec<_> = events.take(10).try_collect().await?;
}
// Stream dropped -> server receives release message -> cleans up subscription
```

---

## The Map Operation

The protocol supports a `remap` operation for transforming data server-side before transfer. This reduces bandwidth by only sending the fields you need.

```rust
// Without map: fetches entire User objects
let users: Vec<User> = api.users().list().await?;
let names: Vec<String> = users.into_iter().map(|u| u.name).collect();

// With map: server extracts names, only names traverse the wire
let names: Vec<String> = api.users()
    .list()
    .map(|user| user.name)
    .await?;
```

**How it works:** The `.map()` closure is serialized as "instructions" in the protocol. The server evaluates these instructions on each item, sending only the transformed results.

```rust
// Map with capability calls - server-side pipelining
let avatars: Vec<Url> = api.users()
    .list()
    .map(|user| user.profile().avatar_url())
    .await?;
```

---

## Resource Management

### Drop = Cancel (RAII for RPC)

Rust's ownership model maps perfectly to RPC lifecycle. Dropping a `Promise` sends a cancellation:

```rust
let promise = api.expensive_computation(data);

// Changed our mind - drop to cancel
drop(promise);  // Server receives cancellation, can abort work
```

This works automatically with scopes:

```rust
async fn fetch_with_timeout(api: &Api, id: u64) -> Result<User> {
    let promise = api.users().get(id);

    tokio::select! {
        result = promise => result,
        _ = tokio::time::sleep(Duration::from_secs(5)) => {
            // Promise dropped here -> automatic cancellation
            Err(Error::Timeout)
        }
    }
}
```

### Stub Lifecycle

Stubs hold references to remote capabilities. When the last clone is dropped, the server is notified:

```rust
{
    let session = api.authenticate(token).await?;
    // session capability is live on server

    let session2 = session.clone();  // Reference count: 2
    drop(session);                    // Reference count: 1

    // session2 still works
    let user = session2.me().await?;
}
// session2 dropped -> reference count: 0 -> server notified -> may GC
```

### Stubs are Cheap to Clone

Stubs use `Arc` internally. Clone freely for use across tasks:

```rust
let api = capnweb::connect::<Api>(url).await?;
let api2 = api.clone();

let handle = tokio::spawn(async move {
    let posts = api2.posts().list().await?;
    Ok::<_, Error>(posts)
});

// api still usable here
let users = api.users().list().await?;

let posts = handle.await??;
```

### Connection Lifecycle

```rust
let client = capnweb::Client::builder()
    .url("wss://api.example.com")
    .connect::<Api>()
    .await?;

// Connection is active

client.close().await?;  // Graceful shutdown - sends abort message

// Or just drop for immediate close
// drop(client);  // Connection terminated, pending calls receive Error::Canceled
```

---

## Connection Options

### Simple Connection

```rust
let api = capnweb::connect::<Api>("wss://api.example.com").await?;
```

### Builder Pattern

```rust
use std::time::Duration;

let client = capnweb::Client::builder()
    .url("wss://api.example.com")
    .timeout(Duration::from_secs(30))
    .reconnect(capnweb::Reconnect::Exponential {
        initial: Duration::from_millis(100),
        max: Duration::from_secs(30),
        factor: 2.0,
    })
    .on_disconnect(|err| {
        tracing::warn!("Disconnected: {}", err);
    })
    .on_reconnect(|| {
        tracing::info!("Reconnected");
    })
    .connect::<Api>()
    .await?;
```

### HTTP Transport

For environments without WebSocket support (some serverless platforms, HTTP-only proxies):

```rust
let client = capnweb::Client::builder()
    .url("https://api.example.com/rpc")
    .transport(capnweb::transport::Http::new())
    .connect::<Api>()
    .await?;
```

**WARNING:** HTTP transport batches calls into POST requests. Pipelining still works, but:
- No bidirectional RPC (server cannot call client)
- No streaming (use polling or long-polling instead)
- Higher latency for multiple concurrent calls

### Authentication

```rust
// Bearer token
let client = capnweb::Client::builder()
    .url("wss://api.example.com")
    .bearer_token("your-token-here")
    .connect::<Api>()
    .await?;

// Custom headers
let client = capnweb::Client::builder()
    .url("wss://api.example.com")
    .header("X-API-Key", "your-key")
    .header("X-Request-ID", uuid::Uuid::new_v4().to_string())
    .connect::<Api>()
    .await?;
```

---

## Dynamic Calls

When you need to call methods not defined in your interfaces:

```rust
use capnweb::Dynamic;

// Get a dynamic handle
let dyn_api = api.dynamic();

// Call any method
let result: serde_json::Value = dyn_api
    .call("experimentalFeature")
    .arg("param1")
    .arg(42u64)
    .await?;

// Navigate dynamic properties
let value: String = dyn_api
    .get("some")
    .get("nested")
    .get("property")
    .await?;

// Mix typed and dynamic
let user = api.users().get(42);
let custom_field: String = user.dynamic().get("customField").await?;
```

---

## Platform Setup

### Tokio (Default)

```rust
#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<Api>("wss://api.example.com").await?;
    // ...
}
```

### async-std

```toml
[dependencies]
capnweb = { version = "0.1", default-features = false, features = ["macros", "async-std"] }
async-std = { version = "1", features = ["attributes"] }
```

```rust
#[async_std::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<Api>("wss://api.example.com").await?;
    // ...
}
```

### WebAssembly (Browser)

```toml
[dependencies]
capnweb = { version = "0.1", default-features = false, features = ["macros", "wasm"] }
wasm-bindgen-futures = "0.4"
```

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub async fn init() -> Result<JsValue, JsValue> {
    let api = capnweb::connect::<Api>("wss://api.example.com")
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    let user = api.users().get(42)
        .await
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(serde_wasm_bindgen::to_value(&user)?)
}
```

---

## Security

### Capability Security Model

Cap'n Web implements object-capability security. You can only access capabilities you've been given:

```rust
// Public API - anyone can call
let api = capnweb::connect::<Api>(url).await?;
let posts = api.posts().list().await?;  // OK - public

// Authenticated API - requires token
let session = api.authenticate(token).await?;  // Server validates token
let my_posts = session.my_posts().await?;  // OK - session grants access

// You cannot fabricate capabilities
// session.internal_admin_api()  // Compile error - not in Session interface
```

### Type Safety

The proc macros ensure type safety at compile time:

```rust
#[capnweb::interface]
trait Users {
    fn get(&self, id: u64) -> User;
}

// Compile errors:
// api.users().get("not a u64").await?;  // Type error
// api.users().nonexistent().await?;     // No such method
// let x: Post = api.users().get(1).await?;  // Wrong return type
```

### Transport Security

Always use TLS in production:

```rust
// wss:// = WebSocket over TLS
let api = capnweb::connect::<Api>("wss://api.example.com").await?;

// https:// = HTTP over TLS
let api = capnweb::Client::builder()
    .url("https://api.example.com/rpc")
    .transport(capnweb::transport::Http::new())
    .connect::<Api>()
    .await?;
```

**WARNING:** Never use `ws://` or `http://` in production. Capability references could be intercepted.

---

## Complete Example

A todo application demonstrating pipelining, bidirectional RPC, and proper error handling:

```rust
use capnweb::prelude::*;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

// ─── Interface Definitions ───────────────────────────────────────────

#[capnweb::interface]
trait TodoApi {
    fn todos(&self) -> Todos;
    fn authenticate(&self, token: String) -> AuthSession;
}

#[capnweb::interface]
trait Todos {
    fn list(&self) -> Vec<Todo>;
    fn get(&self, id: u64) -> Todo;
    fn subscribe(&self) -> Stream<TodoEvent>;
}

#[capnweb::interface]
trait AuthSession {
    fn me(&self) -> User;
    fn todos(&self) -> MutableTodos;
}

#[capnweb::interface]
trait MutableTodos {
    fn create(&self, title: String) -> Todo;
    fn update(&self, id: u64, done: bool) -> Todo;
    fn delete(&self, id: u64);
}

// ─── Data Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Todo {
    id: u64,
    title: String,
    done: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct User {
    id: u64,
    name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct TodoEvent {
    kind: String,  // "created", "updated", "deleted"
    todo: Option<Todo>,
    todo_id: u64,
}

// ─── Application ─────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    // Connect with reconnection enabled
    let client = capnweb::Client::builder()
        .url("wss://todo.example.com")
        .timeout(Duration::from_secs(30))
        .reconnect(capnweb::Reconnect::Exponential {
            initial: Duration::from_millis(100),
            max: Duration::from_secs(10),
            factor: 2.0,
        })
        .connect::<TodoApi>()
        .await?;

    let api = client.api();

    // ─── Public read: list all todos (one round-trip) ────────────────
    println!("All todos:");
    for todo in api.todos().list().await? {
        let status = if todo.done { "[x]" } else { "[ ]" };
        println!("  {} {}", status, todo.title);
    }

    // ─── Authenticate ────────────────────────────────────────────────
    let token = std::env::var("API_TOKEN")
        .map_err(|_| Error::InvalidArgument("API_TOKEN not set".into()))?;

    let session = api.authenticate(token);

    // ─── Fork the pipeline: create AND fetch user info ───────────────
    let new_todo = session.todos().create("Learn Rust".into());
    let me = session.me();

    // Single round-trip resolves both branches
    let (todo, user) = capnweb::join!(new_todo, me).await?;
    println!("\n{} created: {}", user.name, todo.title);

    // ─── Update through the session ──────────────────────────────────
    let updated = session.todos().update(todo.id, true).await?;
    println!("Completed: {}", updated.title);

    // ─── Subscribe to real-time updates ──────────────────────────────
    println!("\nListening for updates (Ctrl+C to stop)...");

    let mut events = api.todos().subscribe().await?;

    while let Some(result) = events.next().await {
        match result {
            Ok(event) => {
                match event.kind.as_str() {
                    "created" => {
                        if let Some(todo) = event.todo {
                            println!("+ New: {}", todo.title);
                        }
                    }
                    "updated" => {
                        if let Some(todo) = event.todo {
                            let status = if todo.done { "completed" } else { "reopened" };
                            println!("~ {}: {}", status, todo.title);
                        }
                    }
                    "deleted" => {
                        println!("- Deleted: #{}", event.todo_id);
                    }
                    _ => {}
                }
            }
            Err(Error::Timeout) => {
                // Heartbeat timeout - reconnect will handle it
                continue;
            }
            Err(e) => {
                eprintln!("Stream error: {}", e);
                break;
            }
        }
    }

    Ok(())
}
```

---

## Protocol Reference

Cap'n Web uses a JSON-based protocol derived from Cap'n Proto's CapTP. Key concepts:

### Import/Export Tables

Each side maintains import and export tables for capability references:
- Positive IDs: chosen by importer (call results)
- Negative IDs: chosen by exporter (returned stubs)
- ID 0: the main/root interface

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `push` | Client->Server | Send expression for evaluation |
| `pull` | Client->Server | Request result of a push |
| `resolve` | Server->Client | Send successful result |
| `reject` | Server->Client | Send error |
| `release` | Either | Drop reference (decrement refcount) |
| `abort` | Either | Terminate session |

### Expression Types

```json
["import", importId, propertyPath?, callArguments?]
["pipeline", importId, propertyPath?, callArguments?]
["export", exportId]
["promise", exportId]
["remap", importId, propertyPath, captures, instructions]
```

See `protocol.md` for the complete wire protocol specification.

---

## Why This Design

| Decision | Rationale |
|----------|-----------|
| `Promise<T>` as Future + Stub | Enables method chaining that pipelines automatically |
| Trait-based interfaces | Full IDE support, compile-time safety, zero-cost dispatch |
| No `Result` in trait signatures | Cleaner syntax; `Result` appears at `.await` |
| `#[target]` on impl blocks | Familiar from axum/actix; `async fn` just works |
| `impl Trait` for capability returns | Hides concrete types, proc macro handles export |
| `dynamic()` escape hatch | Pragmatic flexibility without compromising typed API |
| `Arc` interior for stubs | Stubs represent capabilities; sharing is natural |
| Drop = Cancel | Rust ownership maps perfectly to RPC lifecycle |
| JSON wire format | Browser compatibility, debugging ease, ecosystem |

---

## License

MIT OR Apache-2.0
