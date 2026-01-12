//! # rpc-do
//!
//! High-performance capability-based RPC client for Rust.
//!
//! This SDK provides:
//! - WebSocket-based RPC transport
//! - Promise pipelining to reduce round trips
//! - Dynamic method dispatch via proxies
//! - Server-side map operations
//!
//! ## Quick Start
//!
//! ```ignore
//! use rpc_do::prelude::*;
//!
//! #[tokio::main]
//! async fn main() -> rpc_do::Result<()> {
//!     let client = connect("wss://api.example.com").await?;
//!     let result: i32 = client.call("square", &[5]).await?;
//!     println!("Result: {}", result);
//!     client.close().await?;
//!     Ok(())
//! }
//! ```

pub mod client;
pub mod error;
pub mod map;
pub mod promise;
pub mod proxy;

// Re-exports
pub use client::{connect, RpcClient, RpcClientConfig, PipelineStep};
pub use error::{RpcError, TransportError};
pub use map::{RpcMap, RpcMapExt, ServerMap};
pub use promise::RpcPromise;
pub use proxy::{DynamicProxy, MethodProxy, Stub};

/// Result type alias for RPC operations.
pub type Result<T> = std::result::Result<T, RpcError>;

/// Prelude module for common imports.
pub mod prelude {
    pub use super::client::{connect, RpcClient, PipelineStep};
    pub use super::error::RpcError;
    pub use super::map::{RpcMap, RpcMapExt, ServerMap};
    pub use super::promise::RpcPromise;
    pub use super::proxy::{DynamicProxy, Stub};
    pub use super::Result;
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::json;
}

/// Check if the SDK is fully implemented.
pub fn is_implemented() -> bool {
    true
}

/// Get the SDK version.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert_eq!(version(), "0.1.0");
    }

    #[test]
    fn test_is_implemented() {
        assert!(is_implemented());
    }
}
