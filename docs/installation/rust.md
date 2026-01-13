# Rust Installation

The Rust SDK provides async/await-based access to Cap'n Web RPC with full type safety.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
capnweb = "0.1"
tokio = { version = "1", features = ["full"] }
```

Or use cargo:

```bash
cargo add capnweb
cargo add tokio --features full
```

## Requirements

- Rust 1.70 or later
- Tokio runtime

## Basic Usage

### Client

```rust
use capnweb::prelude::*;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    // Connect to server
    let api = capnweb::connect("wss://api.example.com").await?;

    // Make RPC calls
    let greeting: String = api.call("greet", ("World",)).await?;
    println!("{}", greeting); // "Hello, World!"

    Ok(())
}
```

### Typed API

```rust
use capnweb::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct User {
    id: i64,
    name: String,
    email: String,
}

// Define your API trait
#[capnweb::api]
trait MyApi {
    async fn greet(&self, name: &str) -> String;
    async fn get_user(&self, id: i64) -> User;
}

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect::<dyn MyApi>("wss://api.example.com").await?;

    let greeting = api.greet("World").await?;
    println!("{}", greeting);

    let user = api.get_user(123).await?;
    println!("User: {}", user.name);

    Ok(())
}
```

### Promise Pipelining

```rust
use capnweb::prelude::*;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect("wss://api.example.com").await?;

    // Start call without awaiting
    let user_promise = api.call_async::<User>("get_user", (123,));

    // Pipeline another call using the promise
    let profile = api.call::<Profile>("get_profile", (user_promise.field("id"),)).await?;

    // Single round trip for both calls!
    println!("Profile: {}", profile.name);

    Ok(())
}
```

## Server Implementation

```rust
use capnweb::prelude::*;
use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

struct MyApiImpl;

#[capnweb::rpc_target]
impl MyApiImpl {
    async fn greet(&self, name: String) -> String {
        format!("Hello, {}!", name)
    }

    async fn get_user(&self, id: i64) -> User {
        User {
            id,
            name: "Alice".to_string(),
            email: "alice@example.com".to_string(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:8080").await?;

    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let ws_stream = accept_async(stream).await.expect("WebSocket handshake failed");
            let api = MyApiImpl;
            capnweb::serve(ws_stream, api).await;
        });
    }

    Ok(())
}
```

## Error Handling

```rust
use capnweb::prelude::*;

#[tokio::main]
async fn main() {
    let api = match capnweb::connect("wss://api.example.com").await {
        Ok(api) => api,
        Err(e) => {
            eprintln!("Connection failed: {}", e);
            return;
        }
    };

    match api.call::<String>("risky_operation", ()).await {
        Ok(result) => println!("Success: {}", result),
        Err(capnweb::Error::Rpc(e)) => {
            eprintln!("RPC error: {}", e.message);
        }
        Err(capnweb::Error::Connection(e)) => {
            eprintln!("Connection error: {}", e);
        }
        Err(e) => {
            eprintln!("Other error: {}", e);
        }
    }
}
```

## Configuration Options

```rust
use capnweb::prelude::*;
use std::time::Duration;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::ConnectOptions::new("wss://api.example.com")
        .timeout(Duration::from_secs(30))
        .header("Authorization", format!("Bearer {}", token))
        .reconnect(true)
        .connect()
        .await?;

    Ok(())
}
```

## HTTP Batch Mode

```rust
use capnweb::prelude::*;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let mut batch = capnweb::HttpBatch::new("https://api.example.com");

    // Queue up calls
    let greeting1 = batch.call_async::<String>("greet", ("Alice",));
    let greeting2 = batch.call_async::<String>("greet", ("Bob",));

    // Send batch
    let (g1, g2) = tokio::join!(greeting1, greeting2);

    println!("{}, {}", g1?, g2?);

    Ok(())
}
```

## Custom Types

```rust
use capnweb::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct CreateUserRequest {
    name: String,
    email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    age: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CreateUserResponse {
    id: i64,
    created_at: String,
}

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect("wss://api.example.com").await?;

    let request = CreateUserRequest {
        name: "Alice".to_string(),
        email: "alice@example.com".to_string(),
        age: Some(30),
    };

    let response: CreateUserResponse = api.call("create_user", (request,)).await?;
    println!("Created user {}", response.id);

    Ok(())
}
```

## Streaming and Callbacks

```rust
use capnweb::prelude::*;

#[tokio::main]
async fn main() -> capnweb::Result<()> {
    let api = capnweb::connect("wss://api.example.com").await?;

    // Subscribe with a callback
    let callback = capnweb::Callback::new(|message: String| {
        println!("Received: {}", message);
    });

    api.call::<()>("subscribe", (callback,)).await?;

    // Keep connection alive
    tokio::signal::ctrl_c().await?;

    Ok(())
}
```

## Troubleshooting

### Async Runtime Errors

Ensure you're using the Tokio runtime:

```rust
// WRONG - no runtime
fn main() {
    capnweb::connect("wss://...").await;
}

// CORRECT - with Tokio
#[tokio::main]
async fn main() {
    capnweb::connect("wss://...").await;
}
```

### Serialization Errors

Ensure types derive `Serialize` and `Deserialize`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]  // Required!
struct MyType {
    field: String,
}
```

### Lifetime Errors

Use owned types in API calls:

```rust
// WRONG - borrowed string
let name = "World";
api.call("greet", (&name,)).await;

// CORRECT - owned string
api.call("greet", (name.to_string(),)).await;

// Also correct - &str can be passed directly
api.call("greet", ("World",)).await;
```
