# rpc-do

**Managed RPC proxies with automatic routing for Rust.**

```rust
let user = api.users().get(42).profile().name().await?;
```

One line. One round-trip. Full type safety. Zero boilerplate.

---

## What is rpc-do?

`rpc-do` is a high-level RPC client for Rust that adds **managed proxies** and **automatic routing** on top of the raw [capnweb](https://crates.io/crates/capnweb) protocol. While `capnweb` gives you the wire protocol and low-level primitives, `rpc-do` gives you:

| Feature | capnweb | rpc-do |
|---------|---------|--------|
| WebSocket transport | Yes | Yes |
| Promise pipelining | Manual | Automatic |
| Dynamic proxies | No | Yes |
| Stub management | Manual | Automatic |
| Server-side map | Protocol only | Full API |
| Callback exports | Manual | Managed |
| Connection lifecycle | Manual | Automatic |
| Reconnection | No | Built-in |

Think of `rpc-do` as "what you actually want to write" versus "how the wire protocol works."

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [The RpcClient](#the-rpcclient)
  - [Dynamic Proxies](#dynamic-proxies)
  - [Stubs: Remote Capabilities](#stubs-remote-capabilities)
  - [RpcPromise: Pipelining Made Easy](#rpcpromise-pipelining-made-easy)
- [Making RPC Calls](#making-rpc-calls)
  - [Simple Calls](#simple-calls)
  - [Typed Calls](#typed-calls)
  - [Calls on Stubs](#calls-on-stubs)
- [Pipelining](#pipelining)
  - [Why Pipelining Matters](#why-pipelining-matters)
  - [Building Pipelines](#building-pipelines)
  - [Pipeline Execution](#pipeline-execution)
- [Server-Side Map Operations](#server-side-map-operations)
  - [The N+1 Problem](#the-n1-problem)
  - [Using RpcMap](#using-rpcmap)
  - [Map Expressions](#map-expressions)
- [Bidirectional RPC](#bidirectional-rpc)
  - [Exporting Callbacks](#exporting-callbacks)
  - [Server-to-Client Calls](#server-to-client-calls)
- [Error Handling](#error-handling)
  - [Error Types](#error-types)
  - [Pattern Matching Errors](#pattern-matching-errors)
  - [Error Context](#error-context)
- [Connection Management](#connection-management)
  - [Configuration](#configuration)
  - [Reconnection](#reconnection)
  - [Health Checks](#health-checks)
- [Advanced Patterns](#advanced-patterns)
  - [Concurrent Requests](#concurrent-requests)
  - [Request Cancellation](#request-cancellation)
  - [Streaming with Callbacks](#streaming-with-callbacks)
- [Platform Integration](#platform-integration)
  - [Tokio Runtime](#tokio-runtime)
  - [async-std (Future)](#async-std-future)
  - [WebAssembly (Future)](#webassembly-future)
- [Complete Examples](#complete-examples)
- [API Reference](#api-reference)
- [Protocol Reference](#protocol-reference)
- [License](#license)

---

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
rpc-do = "0.1"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Or use `cargo add`:

```bash
cargo add rpc-do
cargo add tokio --features full
cargo add serde --features derive
cargo add serde_json
```

### Feature Flags

```toml
[dependencies]
rpc-do = { version = "0.1", features = ["rustls"] }
```

| Feature | Default | Description |
|---------|---------|-------------|
| `native-tls` | Yes | TLS via system libraries |
| `rustls` | No | TLS via rustls (pure Rust) |

---

## Quick Start

### 1. Connect to an RPC Server

```rust
use rpc_do::prelude::*;

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    // Connect to the RPC endpoint
    let client = connect("wss://api.example.com").await?;

    // Make a simple RPC call
    let result: i32 = client.call("square", &[5]).await?;
    println!("5 squared = {}", result);

    // Close gracefully
    client.close().await?;
    Ok(())
}
```

### 2. Work with Capabilities (Stubs)

```rust
use rpc_do::prelude::*;

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://api.example.com").await?;

    // Get a capability (stub) from the server
    let counter_json = client.call_raw("makeCounter", vec![json!(0)]).await?;

    // Extract the stub ID
    let stub_id = counter_json["$stub"].as_str()
        .ok_or_else(|| RpcError::Protocol("Expected stub".into()))?;

    // Create a Stub to call methods on it
    let counter = Stub::new(client.state.clone(), stub_id.to_string());

    // Call methods on the capability
    let value: i32 = counter.call("increment").arg(5).execute_as().await?;
    println!("Counter value: {}", value);

    client.close().await?;
    Ok(())
}
```

### 3. Use Pipelining

```rust
use rpc_do::prelude::*;

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://api.example.com").await?;

    // Execute multiple steps in a single round-trip
    let result = client.pipeline(vec![
        PipelineStep {
            call: "makeCounter".into(),
            args: vec![json!(10)],
            alias: Some("counter".into()),
            target: None,
        },
        PipelineStep {
            call: "increment".into(),
            args: vec![json!(5)],
            alias: Some("result".into()),
            target: Some("counter".into()),  // Call on the counter from step 1
        },
    ]).await?;

    println!("Pipeline result: {}", result);

    client.close().await?;
    Ok(())
}
```

---

## Core Concepts

### The RpcClient

`RpcClient` is the main entry point for all RPC operations. It manages:

- **WebSocket connection** to the server
- **Request/response correlation** via message IDs
- **Pending request tracking** with timeouts
- **Exported callbacks** for bidirectional RPC
- **Connection lifecycle** (connect, reconnect, close)

```rust
use rpc_do::client::{RpcClient, RpcClientConfig};

// Simple connection
let client = RpcClient::connect("wss://api.example.com").await?;

// With custom configuration
let config = RpcClientConfig {
    timeout_ms: 60_000,        // 60 second timeout
    max_retries: 5,            // Retry up to 5 times
    auto_reconnect: true,      // Reconnect on disconnect
    health_check_interval_ms: 30_000, // Ping every 30s
};
let client = RpcClient::connect_with_config("wss://api.example.com", config).await?;
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `connect(endpoint)` | Connect with default config |
| `connect_with_config(endpoint, config)` | Connect with custom config |
| `call::<T>(method, args)` | Make typed RPC call |
| `call_raw(method, args)` | Make call returning raw JSON |
| `call_on_stub(stub_id, method, args)` | Call method on a stub |
| `pipeline(steps)` | Execute pipeline |
| `export(name, handler)` | Export callback for server |
| `close()` | Close connection gracefully |
| `is_connected()` | Check connection status |

### Dynamic Proxies

`DynamicProxy` provides an ergonomic builder API for making calls without compile-time type information:

```rust
use rpc_do::proxy::DynamicProxy;

let proxy = DynamicProxy::new(client.state.clone(), 0);

// Build calls fluently
let result: i32 = proxy
    .call("calculate")
    .arg(10)
    .arg(20)
    .arg("add")
    .execute_as()
    .await?;
```

**Why use DynamicProxy?**

- When calling methods discovered at runtime
- When working with dynamic interfaces
- When you need the builder pattern for complex calls
- When the exact types aren't known at compile time

### Stubs: Remote Capabilities

A `Stub` represents a reference to an object on the server. When you call a method that returns a capability, you get back a stub ID that you can use for further calls.

```rust
use rpc_do::proxy::Stub;

// Stubs are created from JSON responses containing "$stub" field
let response = client.call_raw("createSession", vec![json!("user-token")]).await?;
let stub_id = response["$stub"].as_str().unwrap();

// Create a Stub wrapper
let session = Stub::new(client.state.clone(), stub_id.to_string());

// Now call methods on the session
let user: User = session.call("getUser").execute_as().await?;
let posts: Vec<Post> = session.call("listPosts").arg(10).execute_as().await?;
```

**Stubs are cheap to clone:**

```rust
// Clone the stub to use in multiple places
let session2 = session.clone();

// Both refer to the same server-side capability
tokio::spawn(async move {
    let _ = session.call("ping").execute().await;
});

tokio::spawn(async move {
    let _ = session2.call("ping").execute().await;
});
```

**Passing stubs as arguments:**

```rust
// Convert stub to JSON for passing as argument
let stub_arg = session.to_json();

// Pass to another method that expects a capability
client.call_raw("processSession", vec![stub_arg]).await?;
```

### RpcPromise: Pipelining Made Easy

`RpcPromise<T>` is a lazy RPC result that supports method chaining for automatic pipelining:

```rust
use rpc_do::promise::RpcPromise;
use rpc_do::client::ConnectionState;
use std::sync::Arc;
use tokio::sync::Mutex;

// RpcPromise implements Future
let promise: RpcPromise<User> = RpcPromise::new(
    state.clone(),
    request_id,
    "getUser",
    vec![json!(42)],
    None,
);

// Chain calls to build a pipeline
let name_promise: RpcPromise<String> = promise
    .call("profile", vec![])
    .call("displayName", vec![]);

// Execute the entire pipeline in one round-trip
let name: String = name_promise.await?;
```

**The magic:** When you chain `.call()` on an `RpcPromise`, no network request is made. The calls are accumulated into a pipeline. Only when you `.await` does the entire chain execute as a single request.

```rust
// No network yet - just building the expression tree
let promise = client_promise
    .call("users", vec![])
    .call("get", vec![json!(42)])
    .call("posts", vec![])
    .call("latest", vec![]);

// NOW we send one request with the entire pipeline
let post = promise.await?;
```

---

## Making RPC Calls

### Simple Calls

The most basic way to make an RPC call:

```rust
// Returns raw JSON
let result: serde_json::Value = client.call_raw("echo", vec![json!("hello")]).await?;
println!("Echo: {}", result);
```

### Typed Calls

When you know the return type at compile time:

```rust
// Automatically deserialize to the target type
let sum: i32 = client.call("add", &[1, 2, 3]).await?;
println!("Sum: {}", sum);

// Works with any Deserialize type
#[derive(Debug, Deserialize)]
struct User {
    id: u64,
    name: String,
    email: String,
}

let user: User = client.call("getUser", &[42u64]).await?;
println!("User: {:?}", user);

// Vectors, HashMaps, etc.
let users: Vec<User> = client.call("listUsers", &[]).await?;
let counts: HashMap<String, i32> = client.call("getCounts", &[]).await?;
```

**Type inference:**

```rust
// Type is inferred from usage
async fn get_user_name(client: &RpcClient, id: u64) -> rpc_do::Result<String> {
    let user: User = client.call("getUser", &[id]).await?;
    Ok(user.name)
}
```

### Calls on Stubs

When you have a reference to a server-side object:

```rust
// Method 1: Using client.call_on_stub
let value: i32 = client.call_on_stub(&stub_id, "getValue", vec![]).await?
    .as_i64().unwrap() as i32;

// Method 2: Using Stub wrapper (recommended)
let stub = Stub::new(client.state.clone(), stub_id);
let value: i32 = stub.call("getValue").execute_as().await?;

// Method 3: Using MethodCall builder for complex calls
let result = stub
    .call("complexMethod")
    .arg("string-arg")
    .arg(42)
    .arg(json!({"key": "value"}))
    .execute_as::<ResultType>()
    .await?;
```

---

## Pipelining

### Why Pipelining Matters

Consider fetching a user's latest post title. Without pipelining:

```rust
// WITHOUT pipelining: 4 sequential round-trips
let user = client.call::<User>("getUser", &[42]).await?;           // Round trip 1
let posts = client.call::<Vec<Post>>("getUserPosts", &[user.id]).await?; // Round trip 2
let latest = &posts[0];
let title = client.call::<String>("getPostTitle", &[latest.id]).await?;  // Round trip 3

// Total latency: 3x network round-trip time
```

With pipelining:

```rust
// WITH pipelining: 1 round-trip
let result = client.pipeline(vec![
    PipelineStep { call: "getUser".into(), args: vec![json!(42)], alias: Some("user".into()), target: None },
    PipelineStep { call: "getUserPosts".into(), args: vec![], alias: Some("posts".into()), target: Some("user".into()) },
    PipelineStep { call: "getPostTitle".into(), args: vec![json!(0)], alias: Some("title".into()), target: Some("posts".into()) },
]).await?;

// Total latency: 1x network round-trip time
```

For a 100ms network latency:
- Without pipelining: 300ms minimum
- With pipelining: 100ms minimum

**That's 3x faster**, and the difference grows with chain length.

### Building Pipelines

#### Using PipelineStep directly

```rust
use rpc_do::client::PipelineStep;

let steps = vec![
    // Step 1: Create a counter with initial value 10
    PipelineStep {
        call: "makeCounter".into(),
        args: vec![json!(10)],
        alias: Some("counter".into()),
        target: None,
    },
    // Step 2: Increment by 5 (on the counter from step 1)
    PipelineStep {
        call: "increment".into(),
        args: vec![json!(5)],
        alias: Some("after_inc".into()),
        target: Some("counter".into()),
    },
    // Step 3: Get the final value
    PipelineStep {
        call: "getValue".into(),
        args: vec![],
        alias: Some("final".into()),
        target: Some("counter".into()),
    },
];

let result = client.pipeline(steps).await?;
// result contains: { "counter": {...}, "after_inc": 15, "final": 15 }
```

#### Using RpcPromise chaining

```rust
use rpc_do::promise::RpcPromise;

// Start with a promise for the initial call
let counter_promise: RpcPromise<serde_json::Value> = RpcPromise::new(
    client.state.clone(),
    client.next_request_id(),
    "makeCounter",
    vec![json!(10)],
    None,
);

// Chain calls - each call is queued, not executed
let value_promise = counter_promise
    .call::<serde_json::Value>("increment", vec![json!(5)])
    .call::<i32>("getValue", vec![]);

// Execute entire pipeline
let value: i32 = value_promise.await?;
```

#### Using MethodProxy

```rust
use rpc_do::proxy::MethodProxy;

let proxy = MethodProxy::new(
    client.state.clone(),
    "makeCounter",
    vec![json!(10)],
    None,
);

let result = proxy
    .then("increment", vec![json!(5)])
    .then_as("getValue", vec![], "final_value")
    .execute()
    .await?;
```

### Pipeline Execution

When you execute a pipeline, the server:

1. Receives all steps in a single message
2. Executes step 1, stores result under its alias
3. Executes step 2, using step 1's result as target if specified
4. Continues until all steps complete
5. Returns all results in a single response

```rust
// Server receives:
{
    "type": "pipeline",
    "id": 123,
    "steps": [
        { "call": "makeCounter", "args": [10], "as": "counter" },
        { "call": "increment", "args": [5], "as": "after_inc", "target": "counter" },
        { "call": "getValue", "args": [], "as": "final", "target": "counter" }
    ]
}

// Server responds:
{
    "type": "pipeline_result",
    "id": 123,
    "results": {
        "counter": { "$stub": "stub_abc123" },
        "after_inc": 15,
        "final": 15
    }
}
```

---

## Server-Side Map Operations

### The N+1 Problem

A common anti-pattern in RPC systems:

```rust
// DON'T DO THIS - N+1 round trips!
let numbers: Vec<i32> = client.call("generateFibonacci", &[10]).await?;

let mut squared = Vec::new();
for n in numbers {
    // Each iteration is a network round-trip!
    let sq: i32 = client.call("square", &[n]).await?;
    squared.push(sq);
}
// For 10 numbers: 11 round trips (1 + 10)
```

This is terrible for performance. If you have 100 items and 50ms latency, that's 5+ seconds just in network time.

### Using RpcMap

`RpcMap` executes the map operation entirely on the server:

```rust
use rpc_do::map::RpcMapExt;

// DO THIS - 1 round trip!
let squared: Vec<i32> = client
    .map(
        "generateFibonacci",           // Source method
        vec![json!(10)],               // Source args
        "x => self.square(x)",         // Map expression
        vec!["$self".into()],          // Captured variables
    )
    .await?;
// For 10 numbers: 1 round trip, always
```

**How it works:**

1. Client sends a `map` message with source call and expression
2. Server executes the source call to get the collection
3. Server applies the expression to each element
4. Server returns the transformed collection
5. Client receives all results in one response

### Map Expressions

Map expressions are evaluated on the server. The syntax is:

```
parameter => expression
```

**Simple property access:**

```rust
// Extract just the names from users
let names: Vec<String> = client
    .map(
        "listUsers",
        vec![],
        "user => user.name",
        vec![],
    )
    .await?;
```

**Method calls on elements:**

```rust
// Call a method on each element
let lengths: Vec<i32> = client
    .map(
        "listStrings",
        vec![],
        "s => s.length()",
        vec![],
    )
    .await?;
```

**Using captured capabilities:**

```rust
// Use a capability reference in the expression
let calculator_stub = get_calculator_stub(&client).await?;

let results: Vec<i32> = client
    .map(
        "generateNumbers",
        vec![json!(5)],
        "x => $calc.square(x)",  // $calc refers to captured stub
        vec![calculator_stub.id().to_string()],  // Capture the calculator
    )
    .await?;
```

**Complex transformations:**

```rust
// Transform with multiple operations
let summaries: Vec<PostSummary> = client
    .map(
        "listPosts",
        vec![],
        "post => { id: post.id, title: post.title, preview: post.content.substring(0, 100) }",
        vec![],
    )
    .await?;
```

### RpcMap Internals

The `RpcMap<T>` type implements `Future`:

```rust
pub struct RpcMap<T> {
    state: Option<Arc<Mutex<ConnectionState>>>,
    source_method: String,
    source_args: Vec<JsonValue>,
    expression: String,
    captures: Vec<String>,
    inner: MapState,
    _marker: PhantomData<T>,
}

impl<T> Future for RpcMap<T>
where
    T: DeserializeOwned + Send + 'static,
{
    type Output = Result<T, RpcError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        // Sends map message, awaits response, deserializes
    }
}
```

**Key features:**

- Lazy execution (nothing happens until `.await`)
- Automatic deserialization to target type
- Timeout handling
- Cancellation support

---

## Bidirectional RPC

### Exporting Callbacks

The server can call back to the client by invoking exported callbacks:

```rust
// Export a callback that the server can call
let callback_id = client.export("onProgress", |args| {
    if let Some(percent) = args.get(0).and_then(|v| v.as_i64()) {
        println!("Progress: {}%", percent);
    }
    json!(null)  // Return value sent back to server
}).await?;

// Pass the callback to a server method
client.call_raw("startLongOperation", vec![
    json!({"callbackId": callback_id}),
]).await?;
```

**Typed callbacks with closures:**

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

let progress = Arc::new(AtomicU32::new(0));
let progress_clone = progress.clone();

client.export("onProgress", move |args| {
    if let Some(p) = args.get(0).and_then(|v| v.as_u64()) {
        progress_clone.store(p as u32, Ordering::SeqCst);
    }
    json!({"received": true})
}).await?;

// Later, check progress
println!("Current progress: {}%", progress.load(Ordering::SeqCst));
```

### Server-to-Client Calls

When the server invokes an exported callback, the flow is:

1. Server sends a `callback` message with the export ID and arguments
2. Client looks up the handler in its export table
3. Client invokes the handler with the arguments
4. Client sends a `callback_result` message with the return value
5. Server receives the result

```rust
// Server sends:
{
    "type": "callback",
    "id": 456,
    "export_id": "export_1",
    "args": [50]
}

// Client handler executes, then sends:
{
    "type": "callback_result",
    "id": 456,
    "value": {"received": true}
}
```

**Real-world example - Event streaming:**

```rust
use std::sync::mpsc;

// Create a channel for events
let (tx, rx) = mpsc::channel::<Event>();

// Export event handler
client.export("onEvent", move |args| {
    if let Ok(event) = serde_json::from_value::<Event>(args[0].clone()) {
        let _ = tx.send(event);
    }
    json!(null)
}).await?;

// Subscribe to events
client.call_raw("subscribe", vec![json!("user.events")]).await?;

// Process events in another thread
std::thread::spawn(move || {
    while let Ok(event) = rx.recv() {
        println!("Received event: {:?}", event);
    }
});
```

---

## Error Handling

### Error Types

`rpc-do` provides rich error types through `RpcError`:

```rust
use rpc_do::error::{RpcError, TransportError};

#[derive(Debug, Error)]
pub enum RpcError {
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
    #[error("remote error: {message}")]
    Remote {
        error_type: String,
        message: String,
        code: Option<i32>,
    },

    /// Request timed out
    #[error("timeout")]
    Timeout,

    /// Request was canceled
    #[error("canceled")]
    Canceled,

    /// Session was terminated
    #[error("session aborted: {0}")]
    Aborted(String),

    /// Method not found on remote object
    #[error("method not found: {0}")]
    MethodNotFound(String),

    /// Serialization error
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Deserialization error
    #[error("deserialization error: {0}")]
    Deserialization(String),

    /// Protocol error
    #[error("protocol error: {0}")]
    Protocol(String),

    /// Internal error
    #[error("internal error: {0}")]
    Internal(String),
}
```

### Pattern Matching Errors

Use Rust's pattern matching for comprehensive error handling:

```rust
match client.call::<User>("getUser", &[id]).await {
    Ok(user) => {
        println!("Found user: {}", user.name);
    }
    Err(RpcError::NotFound(path)) => {
        eprintln!("User {} not found at {}", id, path);
    }
    Err(RpcError::Unauthorized) => {
        eprintln!("Please log in first");
    }
    Err(RpcError::Forbidden(reason)) => {
        eprintln!("Access denied: {}", reason);
    }
    Err(RpcError::Remote { error_type, message, code }) => {
        eprintln!("Server error [{}]: {} (code: {:?})", error_type, message, code);
    }
    Err(RpcError::Timeout) => {
        eprintln!("Request timed out - server may be overloaded");
    }
    Err(RpcError::Transport(TransportError::ConnectionClosed)) => {
        eprintln!("Connection lost - attempting reconnect...");
    }
    Err(e) => {
        eprintln!("Unexpected error: {}", e);
    }
}
```

**Using error helpers:**

```rust
// Check error type
if err.is_type("RangeError") {
    println!("Invalid range provided");
}

// Check message content
if err.message_contains("quota exceeded") {
    println!("Rate limit hit");
}
```

### Error Context

Add context to errors for better debugging:

```rust
async fn fetch_user_posts(client: &RpcClient, user_id: u64) -> rpc_do::Result<Vec<Post>> {
    let user: User = client
        .call("getUser", &[user_id])
        .await
        .map_err(|e| RpcError::Internal(format!("Failed to fetch user {}: {}", user_id, e)))?;

    let posts: Vec<Post> = client
        .call("getUserPosts", &[user.id])
        .await
        .map_err(|e| RpcError::Internal(format!("Failed to fetch posts for user {}: {}", user_id, e)))?;

    Ok(posts)
}
```

**Using the `?` operator:**

```rust
async fn get_post_author_name(client: &RpcClient, post_id: u64) -> rpc_do::Result<String> {
    let post: Post = client.call("getPost", &[post_id]).await?;
    let author: User = client.call("getUser", &[post.author_id]).await?;
    Ok(author.name)
}
```

---

## Connection Management

### Configuration

Customize connection behavior with `RpcClientConfig`:

```rust
use rpc_do::client::{RpcClient, RpcClientConfig};

let config = RpcClientConfig {
    /// Request timeout in milliseconds
    timeout_ms: 30_000,  // 30 seconds

    /// Maximum retry attempts for failed requests
    max_retries: 3,

    /// Automatically reconnect on disconnect
    auto_reconnect: true,

    /// Health check interval (0 to disable)
    health_check_interval_ms: 30_000,  // 30 seconds
};

let client = RpcClient::connect_with_config("wss://api.example.com", config).await?;
```

**Configuration presets:**

```rust
// High-latency network (satellite, intercontinental)
let high_latency_config = RpcClientConfig {
    timeout_ms: 120_000,
    max_retries: 5,
    auto_reconnect: true,
    health_check_interval_ms: 60_000,
};

// Local development
let dev_config = RpcClientConfig {
    timeout_ms: 5_000,
    max_retries: 0,
    auto_reconnect: false,
    health_check_interval_ms: 0,
};

// Production with aggressive health checks
let prod_config = RpcClientConfig {
    timeout_ms: 30_000,
    max_retries: 3,
    auto_reconnect: true,
    health_check_interval_ms: 15_000,
};
```

### Reconnection

When `auto_reconnect` is enabled, the client will automatically attempt to reconnect on connection loss:

```rust
let config = RpcClientConfig {
    auto_reconnect: true,
    max_retries: 5,
    ..Default::default()
};

let client = RpcClient::connect_with_config("wss://api.example.com", config).await?;

// If connection drops, pending requests will fail with TransportError::ConnectionClosed
// but the client will attempt to reconnect in the background

// Check connection status
if !client.is_connected().await {
    println!("Connection lost, waiting for reconnect...");
}
```

### Health Checks

Enable periodic health checks to detect stale connections:

```rust
let config = RpcClientConfig {
    health_check_interval_ms: 30_000,  // Ping every 30 seconds
    ..Default::default()
};

let client = RpcClient::connect_with_config("wss://api.example.com", config).await?;
// Client will automatically send ping/pong frames to keep connection alive
```

---

## Advanced Patterns

### Concurrent Requests

Execute multiple independent requests concurrently:

```rust
use tokio::try_join;

// Three independent requests executed concurrently
let (users, posts, stats) = try_join!(
    client.call::<Vec<User>>("listUsers", &[]),
    client.call::<Vec<Post>>("listPosts", &[]),
    client.call::<Stats>("getStats", &[]),
)?;

println!("Got {} users, {} posts", users.len(), posts.len());
```

**Using `futures::future::join_all`:**

```rust
use futures::future::join_all;

let ids = vec![1, 2, 3, 4, 5];

let futures: Vec<_> = ids
    .iter()
    .map(|id| client.call::<User>("getUser", &[*id]))
    .collect();

let results: Vec<rpc_do::Result<User>> = join_all(futures).await;

for result in results {
    match result {
        Ok(user) => println!("User: {}", user.name),
        Err(e) => eprintln!("Error: {}", e),
    }
}
```

**Semaphore for bounded concurrency:**

```rust
use std::sync::Arc;
use tokio::sync::Semaphore;

let semaphore = Arc::new(Semaphore::new(10)); // Max 10 concurrent requests
let ids: Vec<u64> = (1..=100).collect();

let futures: Vec<_> = ids
    .into_iter()
    .map(|id| {
        let client = client.clone();
        let semaphore = semaphore.clone();
        async move {
            let _permit = semaphore.acquire().await.unwrap();
            client.call::<User>("getUser", &[id]).await
        }
    })
    .collect();

let results = join_all(futures).await;
```

### Request Cancellation

Dropping a promise cancels the request:

```rust
use tokio::time::{timeout, Duration};

// Cancel if not complete within 5 seconds
let result = timeout(
    Duration::from_secs(5),
    client.call::<Data>("slowOperation", &[]),
).await;

match result {
    Ok(Ok(data)) => println!("Got data: {:?}", data),
    Ok(Err(e)) => eprintln!("RPC error: {}", e),
    Err(_) => eprintln!("Operation timed out, request canceled"),
}
```

**Manual cancellation with `tokio::select!`:**

```rust
use tokio::sync::oneshot;

let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

// Spawn operation
let handle = tokio::spawn({
    let client = client.clone();
    async move {
        tokio::select! {
            result = client.call::<Data>("slowOperation", &[]) => result,
            _ = cancel_rx => Err(RpcError::Canceled),
        }
    }
});

// Cancel after some condition
if should_cancel() {
    let _ = cancel_tx.send(());
}

let result = handle.await?;
```

### Streaming with Callbacks

Implement streaming patterns using bidirectional callbacks:

```rust
use std::sync::Arc;
use tokio::sync::mpsc;

// Create async channel for streaming data
let (tx, mut rx) = mpsc::channel::<DataChunk>(100);

// Export callback for receiving stream chunks
let tx_clone = tx.clone();
client.export("onChunk", move |args| {
    if let Ok(chunk) = serde_json::from_value::<DataChunk>(args[0].clone()) {
        // Non-blocking send
        let _ = tx_clone.try_send(chunk);
    }
    json!(null)
}).await?;

// Export callback for stream completion
let tx_complete = tx.clone();
client.export("onStreamEnd", move |_args| {
    drop(tx_complete); // Close channel
    json!(null)
}).await?;

// Start the stream
client.call_raw("startStream", vec![json!({"topic": "events"})]).await?;

// Process chunks as they arrive
while let Some(chunk) = rx.recv().await {
    process_chunk(chunk).await;
}
```

**Backpressure handling:**

```rust
use std::sync::atomic::{AtomicBool, Ordering};

let paused = Arc::new(AtomicBool::new(false));
let paused_clone = paused.clone();

// Track pending items
let pending = Arc::new(AtomicU32::new(0));
let pending_clone = pending.clone();

client.export("onChunk", move |args| {
    // Increment pending count
    let count = pending_clone.fetch_add(1, Ordering::SeqCst);

    // Signal backpressure if too many pending
    if count > 100 {
        paused_clone.store(true, Ordering::SeqCst);
        json!({"pause": true})
    } else {
        json!({"pause": false})
    }
}).await?;

// Resume when caught up
tokio::spawn(async move {
    loop {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if pending.load(Ordering::SeqCst) < 50 && paused.load(Ordering::SeqCst) {
            client.call_raw("resumeStream", vec![]).await.ok();
            paused.store(false, Ordering::SeqCst);
        }
    }
});
```

---

## Platform Integration

### Tokio Runtime

`rpc-do` is built on tokio and requires the tokio runtime:

```rust
#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://api.example.com").await?;
    // ...
    Ok(())
}
```

**With custom runtime configuration:**

```rust
fn main() -> rpc_do::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();

    runtime.block_on(async {
        let client = connect("wss://api.example.com").await?;
        // ...
        Ok(())
    })
}
```

**Single-threaded runtime:**

```rust
#[tokio::main(flavor = "current_thread")]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://api.example.com").await?;
    // ...
    Ok(())
}
```

### async-std (Future)

Support for async-std is planned for future releases.

### WebAssembly (Future)

WebAssembly support is planned for future releases, enabling use in browsers via wasm-bindgen.

---

## Complete Examples

### Counter Service Client

```rust
//! Example: Counter service demonstrating stubs and method calls.

use rpc_do::prelude::*;
use rpc_do::proxy::Stub;

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://counter.example.com").await?;

    // Create a new counter with initial value 10
    let response = client.call_raw("makeCounter", vec![json!(10)]).await?;

    // Extract stub reference
    let stub_id = response["$stub"]
        .as_str()
        .ok_or_else(|| RpcError::Protocol("Expected stub in response".into()))?;

    let counter = Stub::new(client.state.clone(), stub_id.to_string());

    // Increment the counter
    let value: i32 = counter.call("increment").arg(5).execute_as().await?;
    println!("After increment(5): {}", value);  // 15

    // Decrement
    let value: i32 = counter.call("decrement").arg(3).execute_as().await?;
    println!("After decrement(3): {}", value);  // 12

    // Get current value
    let value: i32 = counter.call("getValue").execute_as().await?;
    println!("Current value: {}", value);  // 12

    // Reset to a new value
    counter.call("reset").arg(100).execute().await?;
    let value: i32 = counter.call("getValue").execute_as().await?;
    println!("After reset(100): {}", value);  // 100

    client.close().await?;
    Ok(())
}
```

### Pipeline Orchestration

```rust
//! Example: Complex pipeline demonstrating multi-step operations.

use rpc_do::prelude::*;

#[derive(Debug, Deserialize)]
struct Order {
    id: u64,
    user_id: u64,
    items: Vec<OrderItem>,
    total: f64,
}

#[derive(Debug, Deserialize)]
struct OrderItem {
    product_id: u64,
    quantity: u32,
    price: f64,
}

#[derive(Debug, Deserialize)]
struct Shipment {
    tracking_number: String,
    carrier: String,
    estimated_delivery: String,
}

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://orders.example.com").await?;

    // Complex pipeline: create order, process payment, create shipment
    // All in a single round-trip
    let result = client.pipeline(vec![
        // Step 1: Create order
        PipelineStep {
            call: "createOrder".into(),
            args: vec![json!({
                "user_id": 42,
                "items": [
                    {"product_id": 1, "quantity": 2},
                    {"product_id": 5, "quantity": 1},
                ]
            })],
            alias: Some("order".into()),
            target: None,
        },
        // Step 2: Process payment using order total
        PipelineStep {
            call: "processPayment".into(),
            args: vec![json!({"card_token": "tok_visa"})],
            alias: Some("payment".into()),
            target: Some("order".into()),
        },
        // Step 3: Create shipment for the order
        PipelineStep {
            call: "createShipment".into(),
            args: vec![json!({"method": "express"})],
            alias: Some("shipment".into()),
            target: Some("order".into()),
        },
        // Step 4: Send confirmation email
        PipelineStep {
            call: "sendConfirmation".into(),
            args: vec![],
            alias: Some("notification".into()),
            target: Some("order".into()),
        },
    ]).await?;

    // Parse results
    let order: Order = serde_json::from_value(result["order"].clone())?;
    let shipment: Shipment = serde_json::from_value(result["shipment"].clone())?;

    println!("Order #{} created", order.id);
    println!("Total: ${:.2}", order.total);
    println!("Tracking: {} via {}", shipment.tracking_number, shipment.carrier);
    println!("Estimated delivery: {}", shipment.estimated_delivery);

    client.close().await?;
    Ok(())
}
```

### Server-Side Data Transformation

```rust
//! Example: Using map operations to avoid N+1 queries.

use rpc_do::prelude::*;
use rpc_do::map::RpcMapExt;

#[derive(Debug, Deserialize)]
struct ProductSummary {
    id: u64,
    name: String,
    price: f64,
    in_stock: bool,
}

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://store.example.com").await?;

    // BAD: N+1 pattern
    println!("--- N+1 Pattern (slow) ---");
    let product_ids: Vec<u64> = client.call("listProductIds", &[]).await?;
    for id in &product_ids {
        let product: ProductSummary = client.call("getProduct", &[*id]).await?;
        println!("{}: ${:.2}", product.name, product.price);
    }

    // GOOD: Server-side map
    println!("\n--- Server-side Map (fast) ---");
    let products: Vec<ProductSummary> = client
        .map(
            "listProductIds",
            vec![],
            "id => self.getProduct(id)",
            vec!["$self".into()],
        )
        .await?;

    for product in &products {
        println!("{}: ${:.2} {}",
            product.name,
            product.price,
            if product.in_stock { "(in stock)" } else { "(out of stock)" }
        );
    }

    // Extract just names and prices
    println!("\n--- Projected Map ---");
    let summaries: Vec<(String, f64)> = client
        .map(
            "listProductIds",
            vec![],
            "id => { let p = self.getProduct(id); [p.name, p.price] }",
            vec!["$self".into()],
        )
        .await?;

    for (name, price) in summaries {
        println!("{}: ${:.2}", name, price);
    }

    client.close().await?;
    Ok(())
}
```

### Real-time Dashboard with Callbacks

```rust
//! Example: Real-time metrics dashboard using bidirectional RPC.

use rpc_do::prelude::*;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Default, Deserialize)]
struct Metrics {
    requests_per_second: f64,
    active_connections: u32,
    error_rate: f64,
    p99_latency_ms: f64,
}

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = connect("wss://metrics.example.com").await?;

    // Shared metrics state
    let metrics = Arc::new(RwLock::new(Metrics::default()));
    let metrics_clone = metrics.clone();

    // Export callback for receiving metric updates
    client.export("onMetrics", move |args| {
        if let Ok(new_metrics) = serde_json::from_value::<Metrics>(args[0].clone()) {
            // Update shared state (blocking is okay for quick operations)
            if let Ok(mut m) = metrics_clone.try_write() {
                *m = new_metrics;
            }
        }
        json!(null)
    }).await?;

    // Subscribe to metrics stream
    client.call_raw("subscribeMetrics", vec![json!({
        "interval_ms": 1000,
        "metrics": ["requests_per_second", "active_connections", "error_rate", "p99_latency_ms"]
    })]).await?;

    println!("Dashboard started. Press Ctrl+C to exit.\n");

    // Display loop
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        let m = metrics.read().await;

        // Clear screen and print dashboard
        print!("\x1B[2J\x1B[1;1H");
        println!("╔══════════════════════════════════════╗");
        println!("║         REAL-TIME DASHBOARD          ║");
        println!("╠══════════════════════════════════════╣");
        println!("║ Requests/sec:     {:>10.1}        ║", m.requests_per_second);
        println!("║ Active Conns:     {:>10}        ║", m.active_connections);
        println!("║ Error Rate:       {:>10.2}%       ║", m.error_rate * 100.0);
        println!("║ P99 Latency:      {:>10.1}ms      ║", m.p99_latency_ms);
        println!("╚══════════════════════════════════════╝");
    }
}
```

### Robust Client with Retry Logic

```rust
//! Example: Production-grade client with retry and error handling.

use rpc_do::prelude::*;
use rpc_do::client::RpcClientConfig;
use std::time::Duration;

/// Wrapper that adds retry logic to RPC calls.
struct RobustClient {
    client: rpc_do::client::RpcClient,
    max_retries: u32,
    retry_delay: Duration,
}

impl RobustClient {
    async fn connect(endpoint: &str) -> rpc_do::Result<Self> {
        let config = RpcClientConfig {
            timeout_ms: 30_000,
            max_retries: 3,
            auto_reconnect: true,
            health_check_interval_ms: 15_000,
        };

        let client = rpc_do::client::RpcClient::connect_with_config(endpoint, config).await?;

        Ok(Self {
            client,
            max_retries: 3,
            retry_delay: Duration::from_millis(500),
        })
    }

    async fn call_with_retry<T, A>(&self, method: &str, args: &[A]) -> rpc_do::Result<T>
    where
        T: serde::de::DeserializeOwned,
        A: serde::Serialize,
    {
        let mut last_error = None;

        for attempt in 0..=self.max_retries {
            if attempt > 0 {
                // Exponential backoff
                let delay = self.retry_delay * 2u32.pow(attempt - 1);
                tokio::time::sleep(delay).await;

                // Check connection
                if !self.client.is_connected().await {
                    eprintln!("Connection lost, waiting for reconnect...");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }

            match self.client.call::<T, A>(method, args).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    // Don't retry certain errors
                    match &e {
                        RpcError::NotFound(_) |
                        RpcError::Unauthorized |
                        RpcError::Forbidden(_) |
                        RpcError::InvalidArgument(_) => {
                            return Err(e);
                        }
                        RpcError::Timeout |
                        RpcError::Transport(_) => {
                            eprintln!("Attempt {} failed: {}, retrying...", attempt + 1, e);
                            last_error = Some(e);
                        }
                        _ => {
                            last_error = Some(e);
                        }
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| RpcError::Internal("Unknown error".into())))
    }
}

#[tokio::main]
async fn main() -> rpc_do::Result<()> {
    let client = RobustClient::connect("wss://api.example.com").await?;

    // Calls will automatically retry on transient errors
    let user: serde_json::Value = client.call_with_retry("getUser", &[42u64]).await?;
    println!("User: {}", user);

    Ok(())
}
```

---

## API Reference

### Module: `rpc_do::client`

| Type | Description |
|------|-------------|
| `RpcClient` | Main client for making RPC calls |
| `RpcClientConfig` | Configuration options |
| `PipelineStep` | A step in a pipeline call |
| `RpcMessage` | Wire protocol message types |
| `connect(endpoint)` | Connect with default config |
| `connect_with_config(endpoint, config)` | Connect with custom config |

### Module: `rpc_do::proxy`

| Type | Description |
|------|-------------|
| `DynamicProxy` | Builder for dynamic method calls |
| `MethodCall` | In-progress method call builder |
| `Stub` | Reference to a remote capability |
| `MethodProxy` | Chainable method call with pipelining |

### Module: `rpc_do::promise`

| Type | Description |
|------|-------------|
| `RpcPromise<T>` | Lazy RPC result with pipelining support |

### Module: `rpc_do::map`

| Type | Description |
|------|-------------|
| `RpcMap<T>` | Server-side map operation |
| `ServerMap` | Trait for types that support server-side map |
| `RpcMapExt` | Extension trait adding `.map()` to RpcClient |

### Module: `rpc_do::error`

| Type | Description |
|------|-------------|
| `RpcError` | All RPC error variants |
| `TransportError` | Network/connection errors |

### Module: `rpc_do::prelude`

Convenient re-exports:

```rust
pub use super::client::{connect, RpcClient, PipelineStep};
pub use super::error::RpcError;
pub use super::map::{RpcMap, RpcMapExt, ServerMap};
pub use super::promise::RpcPromise;
pub use super::proxy::{DynamicProxy, Stub};
pub use super::Result;
pub use serde::{Deserialize, Serialize};
pub use serde_json::json;
```

---

## Protocol Reference

`rpc-do` implements the Cap'n Web protocol over WebSocket. Key message types:

### Call Message

```json
{
    "type": "call",
    "id": 123,
    "method": "methodName",
    "args": [arg1, arg2, ...],
    "target": "stub_id"  // optional
}
```

### Pipeline Message

```json
{
    "type": "pipeline",
    "id": 123,
    "steps": [
        { "call": "method1", "args": [...], "as": "alias1" },
        { "call": "method2", "args": [...], "as": "alias2", "target": "alias1" }
    ]
}
```

### Map Message

```json
{
    "type": "map",
    "id": 123,
    "source_call": "listItems",
    "source_args": [...],
    "expression": "x => x.transform()",
    "captures": ["$self"]
}
```

### Result Message

```json
{
    "type": "result",
    "id": 123,
    "value": { ... }
}
```

### Error Message

```json
{
    "type": "error",
    "id": 123,
    "errorType": "NotFound",
    "message": "Resource not found",
    "code": 404
}
```

### Export Message

```json
{
    "type": "export",
    "id": "export_1",
    "name": "onProgress"
}
```

### Callback Message

```json
{
    "type": "callback",
    "id": 456,
    "export_id": "export_1",
    "args": [50]
}
```

### Callback Result Message

```json
{
    "type": "callback_result",
    "id": 456,
    "value": { "received": true }
}
```

---

## Why rpc-do?

### Comparison with alternatives

| Feature | rpc-do | tonic/gRPC | tarpc | jsonrpc |
|---------|--------|------------|-------|---------|
| Pipelining | Yes | No | No | No |
| Bidirectional | Yes | Yes | Yes | No |
| Server-side map | Yes | No | No | No |
| Dynamic calls | Yes | No | No | Yes |
| Browser support | Planned | No | No | Yes |
| Type safety | Runtime | Compile | Compile | Runtime |
| Schema | None | Protobuf | Rust types | JSON Schema |
| Transport | WebSocket | HTTP/2 | Any | HTTP |

### When to use rpc-do

- **Latency-sensitive applications** - Pipelining reduces round trips
- **Complex workflows** - Pipeline multiple operations in one request
- **Real-time updates** - Bidirectional callbacks for live data
- **Data transformations** - Server-side map avoids N+1 problems
- **Dynamic interfaces** - Call methods discovered at runtime
- **Browser clients** - WebSocket works everywhere (planned)

### When to use something else

- **Need code generation from schema** - Use gRPC with protobuf
- **Compile-time type safety required** - Use tarpc
- **Simple request/response only** - Use plain HTTP/JSON
- **Streaming large datasets** - Use gRPC streams

---

## License

MIT OR Apache-2.0

---

## See Also

- [capnweb](https://crates.io/crates/capnweb) - Low-level Cap'n Web protocol
- [rpc.do](https://rpc.do) - Official documentation
- [Cap'n Web Specification](https://capnweb.org) - Protocol specification
