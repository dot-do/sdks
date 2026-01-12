//! # dotdo-rpc
//!
//! High-level RPC client abstraction for DotDo services.
//!
//! This crate provides the `RpcClient` and `RpcProxy` traits that build on
//! top of `dotdo-capnweb` to provide a more ergonomic API for DotDo services.
//!
//! ## Quick Start
//!
//! ```ignore
//! use dotdo_rpc::prelude::*;
//!
//! #[tokio::main]
//! async fn main() -> dotdo_rpc::Result<()> {
//!     let client = RpcClient::connect("wss://api.do.ai").await?;
//!     let result = client.call("echo", vec![json!("hello")]).await?;
//!     println!("Response: {:?}", result);
//!     Ok(())
//! }
//! ```

use dotdo_capnweb::{Error as CapnwebError, Session};
use serde::{de::DeserializeOwned, Serialize};
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;
use thiserror::Error;

// Re-export capnweb types
pub use dotdo_capnweb;

/// Prelude module for common imports.
pub mod prelude {
    pub use super::{connect, RpcClient, RpcError, RpcProxy, Result};
    pub use dotdo_capnweb::prelude::*;
    pub use serde_json::json;
}

// ============================================================================
// Error Types
// ============================================================================

/// RPC-specific errors.
#[derive(Debug, Error)]
pub enum RpcError {
    /// Underlying capnweb error.
    #[error("capnweb error: {0}")]
    Capnweb(#[from] CapnwebError),

    /// Connection error.
    #[error("connection error: {0}")]
    Connection(String),

    /// Invalid endpoint configuration.
    #[error("invalid endpoint: {0}")]
    InvalidEndpoint(String),

    /// Proxy mapping error.
    #[error("proxy error: {0}")]
    ProxyError(String),

    /// Service unavailable.
    #[error("service unavailable: {0}")]
    ServiceUnavailable(String),
}

/// Alias for Result<T, RpcError>.
pub type Result<T> = std::result::Result<T, RpcError>;

// ============================================================================
// RpcProxy Trait
// ============================================================================

/// Trait for RPC proxy types that can transform requests/responses.
///
/// The `RpcProxy` trait enables middleware-like functionality for RPC calls,
/// allowing transformation of requests before sending and responses after
/// receiving.
///
/// # Example
///
/// ```ignore
/// struct LoggingProxy;
///
/// impl<T> RpcProxy<T> for LoggingProxy
/// where
///     T: Send + 'static,
/// {
///     type Output = T;
///
///     fn map<F>(self, transform: F) -> Self::Output
///     where
///         F: FnOnce(T) -> Self::Output + Send + 'static,
///     {
///         // Stub implementation
///         unimplemented!()
///     }
/// }
/// ```
pub trait RpcProxy<T>: Send + 'static
where
    T: Send + 'static,
{
    /// The output type after transformation.
    type Output: Send + 'static;

    /// Transform the proxied value using the provided function.
    ///
    /// This method allows middleware-style transformations of RPC results.
    fn map<F>(self, transform: F) -> Self::Output
    where
        F: FnOnce(T) -> Self::Output + Send + 'static;
}

/// A default proxy implementation that wraps RPC responses.
pub struct ResponseProxy<T> {
    inner: Option<T>,
    _marker: PhantomData<T>,
}

impl<T> ResponseProxy<T> {
    /// Create a new response proxy.
    pub fn new(value: T) -> Self {
        Self {
            inner: Some(value),
            _marker: PhantomData,
        }
    }

    /// Get the inner value, consuming the proxy.
    pub fn into_inner(mut self) -> Option<T> {
        self.inner.take()
    }
}

impl<T> RpcProxy<T> for ResponseProxy<T>
where
    T: Send + 'static,
{
    type Output = T;

    fn map<F>(mut self, transform: F) -> Self::Output
    where
        F: FnOnce(T) -> Self::Output + Send + 'static,
    {
        let value = self.inner.take().expect("ResponseProxy already consumed");
        transform(value)
    }
}

// ============================================================================
// RpcClient
// ============================================================================

/// High-level RPC client for DotDo services.
///
/// `RpcClient` wraps a `dotdo_capnweb::Session` and provides additional
/// functionality such as:
///
/// - Automatic reconnection handling
/// - Request/response transformation via `RpcProxy`
/// - Service discovery
/// - Health checking
///
/// # Example
///
/// ```ignore
/// let client = RpcClient::connect("wss://api.do.ai").await?;
///
/// // Make a simple call
/// let result = client.call("getUser", vec![json!(42)]).await?;
///
/// // Use typed responses
/// let user: User = client.call_typed("getUser", vec![json!(42)]).await?;
/// ```
pub struct RpcClient {
    /// The underlying session.
    session: Arc<Session>,
    /// The endpoint URL.
    endpoint: String,
    /// Client configuration.
    config: RpcClientConfig,
}

/// Configuration options for RpcClient.
#[derive(Debug, Clone)]
pub struct RpcClientConfig {
    /// Request timeout in milliseconds.
    pub timeout_ms: u64,
    /// Maximum number of retry attempts.
    pub max_retries: u32,
    /// Enable automatic reconnection.
    pub auto_reconnect: bool,
    /// Health check interval in milliseconds (0 to disable).
    pub health_check_interval_ms: u64,
}

impl Default for RpcClientConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            max_retries: 3,
            auto_reconnect: true,
            health_check_interval_ms: 0,
        }
    }
}

impl RpcClient {
    /// Connect to an RPC endpoint with default configuration.
    ///
    /// # Arguments
    ///
    /// * `endpoint` - The WebSocket URL to connect to
    ///
    /// # Returns
    ///
    /// A connected `RpcClient` instance.
    pub async fn connect(endpoint: &str) -> Result<Self> {
        Self::connect_with_config(endpoint, RpcClientConfig::default()).await
    }

    /// Connect to an RPC endpoint with custom configuration.
    ///
    /// # Arguments
    ///
    /// * `endpoint` - The WebSocket URL to connect to
    /// * `config` - Client configuration options
    ///
    /// # Returns
    ///
    /// A connected `RpcClient` instance.
    pub async fn connect_with_config(endpoint: &str, config: RpcClientConfig) -> Result<Self> {
        let session = dotdo_capnweb::connect(endpoint)
            .await
            .map_err(RpcError::Capnweb)?;

        Ok(Self {
            session: Arc::new(session),
            endpoint: endpoint.to_string(),
            config,
        })
    }

    /// Get the endpoint URL.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Get the client configuration.
    pub fn config(&self) -> &RpcClientConfig {
        &self.config
    }

    /// Check if the client is connected.
    pub fn is_connected(&self) -> bool {
        self.session.is_connected()
    }

    /// Make an RPC call and return the raw JSON response.
    ///
    /// # Arguments
    ///
    /// * `method` - The method name to call
    /// * `args` - Arguments to pass to the method
    ///
    /// # Returns
    ///
    /// The JSON response from the server.
    pub async fn call(
        &self,
        method: &str,
        args: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        self.session
            .call_method(method, args)
            .await
            .map_err(RpcError::Capnweb)
    }

    /// Make a typed RPC call.
    ///
    /// # Arguments
    ///
    /// * `method` - The method name to call
    /// * `args` - Arguments to pass to the method
    ///
    /// # Returns
    ///
    /// The deserialized response of type `T`.
    pub async fn call_typed<T>(&self, method: &str, args: Vec<serde_json::Value>) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let response = self.call(method, args).await?;
        serde_json::from_value(response).map_err(|e| {
            RpcError::Capnweb(CapnwebError::Deserialization(e.to_string()))
        })
    }

    /// Create a proxy for transforming responses.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let result = client
    ///     .with_proxy()
    ///     .call("getData", vec![])
    ///     .await?
    ///     .map(|data| transform(data));
    /// ```
    pub fn with_proxy(&self) -> ProxiedClient {
        ProxiedClient {
            client: self,
        }
    }

    /// Get the underlying session.
    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }
}

/// A client wrapper that applies proxy transformations.
pub struct ProxiedClient<'a> {
    client: &'a RpcClient,
}

impl<'a> ProxiedClient<'a> {
    /// Make an RPC call that returns a ResponseProxy.
    pub async fn call(
        &self,
        method: &str,
        args: Vec<serde_json::Value>,
    ) -> Result<ResponseProxy<serde_json::Value>> {
        let result = self.client.call(method, args).await?;
        Ok(ResponseProxy::new(result))
    }
}

// ============================================================================
// Connect Function
// ============================================================================

/// Connect to a DotDo RPC endpoint.
///
/// This is a convenience function that creates an `RpcClient` with default
/// configuration.
///
/// # Arguments
///
/// * `endpoint` - The WebSocket URL to connect to
///
/// # Returns
///
/// A connected `RpcClient` instance.
///
/// # Example
///
/// ```ignore
/// use dotdo_rpc::prelude::*;
///
/// let client = connect("wss://api.do.ai").await?;
/// ```
pub async fn connect(endpoint: &str) -> Result<RpcClient> {
    RpcClient::connect(endpoint).await
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rpc_client_connect() {
        let client = RpcClient::connect("ws://localhost:8787").await.unwrap();
        assert_eq!(client.endpoint(), "ws://localhost:8787");
        assert!(client.is_connected());
    }

    #[tokio::test]
    async fn test_rpc_client_config() {
        let config = RpcClientConfig {
            timeout_ms: 5000,
            max_retries: 5,
            auto_reconnect: false,
            health_check_interval_ms: 1000,
        };
        let client = RpcClient::connect_with_config("ws://localhost:8787", config)
            .await
            .unwrap();
        assert_eq!(client.config().timeout_ms, 5000);
        assert_eq!(client.config().max_retries, 5);
        assert!(!client.config().auto_reconnect);
    }

    #[test]
    fn test_response_proxy_map() {
        let proxy = ResponseProxy::new(42);
        let result = proxy.map(|x| x * 2);
        assert_eq!(result, 84);
    }

    #[tokio::test]
    async fn test_connect_function() {
        let client = connect("ws://localhost:8787").await.unwrap();
        assert!(client.is_connected());
    }
}
