# platform-do

The official Rust SDK for the DotDo platform. This crate provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform-do` is the highest-level crate in the DotDo stack, built on top of:

- **[rpc-do](../rpc)** - Type-safe RPC client
- **[capnweb-do](../capnweb)** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic async Rust API.

```
+------------------+
|   platform-do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc-do       |  <-- RPC client layer
+------------------+
|   capnweb-do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and client credentials
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with jitter
- **Async/Await**: Built on Tokio for modern async Rust
- **Type Safety**: Full Rust type system support with generics
- **Health Checks**: Automatic connection health monitoring

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
platform-do = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
serde_json = "1"
```

## Quick Start

### Basic Usage

```rust
use platform_do::prelude::*;

#[tokio::main]
async fn main() -> Result<()> {
    // Create a client with API key
    let client = DotDo::builder()
        .api_key("your-api-key")
        .build()
        .await?;

    // Make an RPC call
    let response = client.call("ai.complete", json!({
        "prompt": "Hello, world!",
        "model": "claude-3"
    })).await?;

    println!("Response: {:?}", response);
    Ok(())
}
```

### With Full Configuration

```rust
use platform_do::prelude::*;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<()> {
    let client = DotDo::builder()
        .endpoint("wss://api.do.ai")
        .api_key("your-api-key")
        .pool_size(8)
        .timeout(Duration::from_secs(60))
        .retry_policy(RetryPolicy::new(5))
        .with_health_checks(Duration::from_secs(30))
        .build()
        .await?;

    // Make typed calls
    let result: GenerateResponse = client.call_typed(
        "ai.generate",
        json!({ "prompt": "Explain Rust ownership" })
    ).await?;

    println!("Generated: {}", result.text);
    Ok(())
}
```

## Configuration

### DotDoBuilder

The builder pattern provides a fluent API for configuration:

```rust
let client = DotDo::builder()
    // Endpoint configuration
    .endpoint("wss://api.do.ai")

    // Authentication (choose one)
    .api_key("your-api-key")
    // .bearer_token("oauth-token")
    // .client_credentials("client-id", "client-secret")

    // Connection pool
    .pool_size(4)

    // Timeouts
    .timeout(Duration::from_secs(30))

    // Retry behavior
    .retry_policy(RetryPolicy {
        max_retries: 3,
        initial_backoff: Duration::from_millis(100),
        max_backoff: Duration::from_secs(30),
        backoff_multiplier: 2.0,
        jitter: true,
    })

    // Health monitoring
    .with_health_checks(Duration::from_secs(30))

    .build()
    .await?;
```

### DotDoConfig

```rust
pub struct DotDoConfig {
    /// Base endpoint URL
    pub endpoint: String,
    /// Authentication credentials
    pub auth: Auth,
    /// Retry policy
    pub retry_policy: RetryPolicy,
    /// Connection pool size
    pub pool_size: usize,
    /// Request timeout
    pub timeout: Duration,
    /// Enable health checks
    pub health_check_enabled: bool,
    /// Health check interval
    pub health_check_interval: Duration,
}
```

## Authentication

### API Key

```rust
let client = DotDo::builder()
    .api_key("your-api-key")
    .build()
    .await?;
```

### Bearer Token (OAuth)

```rust
let client = DotDo::builder()
    .bearer_token("oauth-access-token")
    .build()
    .await?;
```

### Client Credentials

```rust
let client = DotDo::builder()
    .client_credentials("client-id", "client-secret")
    .build()
    .await?;
```

### Auth Enum

```rust
pub enum Auth {
    /// API key authentication
    ApiKey(String),
    /// OAuth bearer token
    BearerToken(String),
    /// OAuth client credentials flow
    ClientCredentials {
        client_id: String,
        client_secret: String,
    },
    /// No authentication
    None,
}

// Helper constructors
let auth = Auth::api_key("key");
let auth = Auth::bearer_token("token");
let auth = Auth::client_credentials("id", "secret");
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```rust
let client = DotDo::builder()
    .pool_size(8)  // Up to 8 concurrent connections
    .build()
    .await?;
```

### Pool Behavior

1. Connections are created on-demand
2. Healthy connections are reused
3. Failed connections are discarded
4. Pool size limits concurrent connections

## Retry Policy

Configure automatic retries with exponential backoff:

```rust
let policy = RetryPolicy {
    max_retries: 5,
    initial_backoff: Duration::from_millis(100),
    max_backoff: Duration::from_secs(30),
    backoff_multiplier: 2.0,
    jitter: true,  // Adds randomness to prevent thundering herd
};

let client = DotDo::builder()
    .retry_policy(policy)
    .build()
    .await?;
```

### Convenience Constructors

```rust
// Default retry policy (3 retries)
let policy = RetryPolicy::default();

// Custom max retries with defaults
let policy = RetryPolicy::new(5);

// Disable retries
let policy = RetryPolicy::no_retry();
```

### Backoff Calculation

| Attempt | Delay (base 100ms, multiplier 2) |
|---------|----------------------------------|
| 1       | 0ms                              |
| 2       | ~100ms + jitter                  |
| 3       | ~200ms + jitter                  |
| 4       | ~400ms + jitter                  |
| 5       | ~800ms + jitter                  |

## Error Handling

### DotDoError Enum

```rust
pub enum DotDoError {
    /// Underlying RPC error
    Rpc(RpcError),
    /// Authentication error
    Auth(String),
    /// Configuration error
    Config(String),
    /// Connection pool exhausted
    PoolExhausted,
    /// All retries failed
    RetriesExhausted(String),
    /// Service not available
    ServiceUnavailable(String),
    /// Rate limited
    RateLimited { retry_after_ms: u64 },
}
```

### Error Handling Examples

```rust
use platform_do::{DotDo, DotDoError, Result};

async fn make_request(client: &DotDo) -> Result<serde_json::Value> {
    match client.call("ai.generate", json!({"prompt": "Hello"})).await {
        Ok(response) => Ok(response),
        Err(DotDoError::Auth(msg)) => {
            eprintln!("Authentication failed: {}", msg);
            Err(DotDoError::Auth(msg))
        }
        Err(DotDoError::RateLimited { retry_after_ms }) => {
            eprintln!("Rate limited, retry after {}ms", retry_after_ms);
            tokio::time::sleep(Duration::from_millis(retry_after_ms)).await;
            // Retry...
            client.call("ai.generate", json!({"prompt": "Hello"})).await
        }
        Err(DotDoError::PoolExhausted) => {
            eprintln!("All connections busy");
            Err(DotDoError::PoolExhausted)
        }
        Err(e) => {
            eprintln!("Unexpected error: {:?}", e);
            Err(e)
        }
    }
}
```

## Making RPC Calls

### Untyped Calls

```rust
let response: serde_json::Value = client.call(
    "ai.generate",
    json!({
        "prompt": "Hello, world!",
        "model": "claude-3"
    })
).await?;

println!("Response: {}", response);
```

### Typed Calls

```rust
use serde::Deserialize;

#[derive(Deserialize)]
struct GenerateResponse {
    text: String,
    usage: Usage,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: u32,
    completion_tokens: u32,
}

let result: GenerateResponse = client.call_typed(
    "ai.generate",
    json!({ "prompt": "Hello!" })
).await?;

println!("Generated {} tokens", result.usage.completion_tokens);
```

## Health Checks

Enable automatic health monitoring:

```rust
let client = DotDo::builder()
    .with_health_checks(Duration::from_secs(30))
    .build()
    .await?;

// Manual health check
let is_healthy = client.health_check().await?;
println!("Connection healthy: {}", is_healthy);
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```rust
// Auth is handled automatically
let client = DotDo::builder()
    .api_key(std::env::var("DOTDO_API_KEY")?)
    .build()
    .await?;
```

### Usage Metrics

```rust
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```rust
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

## Prelude Module

Import common types with the prelude:

```rust
use platform_do::prelude::*;

// Includes:
// - DotDo, DotDoBuilder
// - Auth, RetryPolicy
// - DotDoError, Result
// - serde_json::json! macro
// - RPC types from rpc-do
```

## Best Practices

### 1. Reuse Client Instances

```rust
// Good - create once, reuse
lazy_static::lazy_static! {
    static ref CLIENT: DotDo = {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            DotDo::builder()
                .api_key(std::env::var("DOTDO_API_KEY").unwrap())
                .build()
                .await
                .unwrap()
        })
    };
}

// Or use OnceCell
use tokio::sync::OnceCell;
static CLIENT: OnceCell<DotDo> = OnceCell::const_new();

async fn get_client() -> &'static DotDo {
    CLIENT.get_or_init(|| async {
        DotDo::builder()
            .api_key(std::env::var("DOTDO_API_KEY").unwrap())
            .build()
            .await
            .unwrap()
    }).await
}
```

### 2. Use Typed Responses

```rust
// Good - type safety
#[derive(Deserialize)]
struct MyResponse {
    data: String,
}

let result: MyResponse = client.call_typed("method", params).await?;

// Works but no compile-time safety
let result: serde_json::Value = client.call("method", params).await?;
```

### 3. Handle All Errors

```rust
async fn robust_call(client: &DotDo) -> Result<String> {
    let result = client.call("method", json!({})).await
        .map_err(|e| {
            tracing::error!("RPC call failed: {:?}", e);
            e
        })?;

    Ok(result.to_string())
}
```

### 4. Configure Appropriate Timeouts

```rust
let client = DotDo::builder()
    .timeout(Duration::from_secs(30))  // For most operations
    .build()
    .await?;

// For long-running operations, consider per-request timeouts
use tokio::time::timeout;

let result = timeout(
    Duration::from_secs(120),
    client.call("long.operation", params)
).await??;
```

## API Reference

### DotDo

```rust
impl DotDo {
    /// Create a new builder
    pub fn builder() -> DotDoBuilder;

    /// Get the endpoint URL
    pub fn endpoint(&self) -> &str;

    /// Check if authenticated
    pub fn is_authenticated(&self) -> bool;

    /// Make an RPC call
    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value>;

    /// Make a typed RPC call
    pub async fn call_typed<T: DeserializeOwned>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T>;

    /// Check connection health
    pub async fn health_check(&self) -> Result<bool>;
}
```

### DotDoBuilder

```rust
impl DotDoBuilder {
    pub fn new() -> Self;
    pub fn endpoint(self, endpoint: impl Into<String>) -> Self;
    pub fn api_key(self, key: impl Into<String>) -> Self;
    pub fn bearer_token(self, token: impl Into<String>) -> Self;
    pub fn client_credentials(
        self,
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
    ) -> Self;
    pub fn auth(self, auth: Auth) -> Self;
    pub fn retry_policy(self, policy: RetryPolicy) -> Self;
    pub fn pool_size(self, size: usize) -> Self;
    pub fn timeout(self, timeout: Duration) -> Self;
    pub fn with_health_checks(self, interval: Duration) -> Self;
    pub async fn build(self) -> Result<DotDo>;
}
```

## Requirements

- Rust 1.70+
- Tokio runtime

## Feature Flags

```toml
[dependencies]
platform-do = { version = "0.1", features = ["tokio"] }  # default
```

## License

MIT OR Apache-2.0

## Links

- [Documentation](https://do.md/docs/rust)
- [crates.io](https://crates.io/crates/platform-do)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [API Documentation](https://docs.rs/platform-do)
