//! # dotdo-capnweb
//!
//! DotDo Cap'n Web - Zero-cost capability-based RPC for Rust.
//!
//! ```ignore
//! let user = api.users().get(42).profile().name().await?;
//! ```
//!
//! One line. One round-trip. Full type safety. Automatic pipelining.
//!
//! ## Quick Start
//!
//! ```ignore
//! use dotdo_capnweb::prelude::*;
//!
//! #[tokio::main]
//! async fn main() -> dotdo_capnweb::Result<()> {
//!     let api = dotdo_capnweb::connect("wss://api.do.ai").await?;
//!     let user = api.call::<User>("getUser", vec![json!(42)]).await?;
//!     println!("Hello, {}!", user.name);
//!     Ok(())
//! }
//! ```
//!
//! ## Status
//!
//! This SDK is currently a stub implementation for conformance testing.
//! Full implementation is in progress.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use thiserror::Error;

// Re-export common dependencies
pub use serde;
pub use serde_json;

/// Prelude module for common imports.
pub mod prelude {
    pub use super::{connect, Error, Promise, Result, RpcError};
    pub use serde::{Deserialize, Serialize};
}

// ============================================================================
// Error Types
// ============================================================================

/// All errors that can occur during RPC operations.
#[derive(Debug, Error)]
pub enum Error {
    /// Network or connection failure.
    #[error("transport error: {0}")]
    Transport(#[from] TransportError),

    /// Resource not found (404 equivalent).
    #[error("not found: {0}")]
    NotFound(String),

    /// Authentication required or failed.
    #[error("unauthorized")]
    Unauthorized,

    /// Permission denied for this operation.
    #[error("forbidden: {0}")]
    Forbidden(String),

    /// Invalid argument passed to RPC.
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// Error returned by remote server.
    #[error("remote error {code}: {message}")]
    Remote { code: i32, message: String },

    /// Request timed out.
    #[error("timeout")]
    Timeout,

    /// Request was canceled (promise dropped before completion).
    #[error("canceled")]
    Canceled,

    /// Session was terminated.
    #[error("session aborted: {0}")]
    Aborted(String),

    /// SDK not yet implemented.
    #[error("not implemented: {0}")]
    NotImplemented(String),

    /// Serialization error.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Deserialization error.
    #[error("deserialization error: {0}")]
    Deserialization(String),
}

/// Transport-level errors.
#[derive(Debug, Error)]
pub enum TransportError {
    /// Connection failed.
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    /// Connection was closed.
    #[error("connection closed")]
    ConnectionClosed,

    /// WebSocket error.
    #[error("websocket error: {0}")]
    WebSocket(String),

    /// HTTP error.
    #[error("http error: {0}")]
    Http(String),

    /// I/O error.
    #[error("io error: {0}")]
    Io(String),
}

/// Alias for Result<T, capnweb::Error>.
pub type Result<T> = std::result::Result<T, Error>;

/// Alias for RpcError (same as Error, for compatibility).
pub type RpcError = Error;

// ============================================================================
// Promise Type
// ============================================================================

/// A lazy RPC result that supports pipelining.
///
/// `Promise<T>` implements both `Future<Output = Result<T>>` and
/// allows calling methods on interfaces before resolution.
///
/// # Example
///
/// ```ignore
/// let users: Promise<Users> = api.users();       // No network yet
/// let user: Promise<User> = users.get(42);       // Still no network
/// let profile: Promise<Profile> = user.profile(); // Building the pipeline...
/// let profile: Profile = profile.await?;          // NOW we send everything
/// ```
pub struct Promise<T> {
    /// Internal connection handle.
    inner: Arc<PromiseInner>,
    /// Marker for the expected result type.
    _marker: PhantomData<T>,
}

struct PromiseInner {
    /// The URL we're connected to (for stub implementation).
    url: String,
    /// The expression tree for this promise (method chain).
    expression: Vec<Expression>,
}

#[derive(Clone, Debug)]
struct Expression {
    method: String,
    args: Vec<serde_json::Value>,
}

impl<T> Promise<T> {
    /// Create a new promise (internal use).
    fn new(url: String, method: &str, args: Vec<serde_json::Value>) -> Self {
        Self {
            inner: Arc::new(PromiseInner {
                url,
                expression: vec![Expression {
                    method: method.to_string(),
                    args,
                }],
            }),
            _marker: PhantomData,
        }
    }

    /// Extend the pipeline with another method call.
    pub fn pipeline<U>(&self, method: &str, args: Vec<serde_json::Value>) -> Promise<U> {
        let mut expression = self.inner.expression.clone();
        expression.push(Expression {
            method: method.to_string(),
            args,
        });
        Promise {
            inner: Arc::new(PromiseInner {
                url: self.inner.url.clone(),
                expression,
            }),
            _marker: PhantomData,
        }
    }

    /// Get the method chain as a string (for debugging/testing).
    pub fn expression_string(&self) -> String {
        self.inner
            .expression
            .iter()
            .map(|e| {
                let args_str = e
                    .args
                    .iter()
                    .map(|a| a.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{}({})", e.method, args_str)
            })
            .collect::<Vec<_>>()
            .join(".")
    }
}

impl<T> Clone for Promise<T> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            _marker: PhantomData,
        }
    }
}

impl<T: DeserializeOwned + Send + 'static> Future for Promise<T> {
    type Output = Result<T>;

    fn poll(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
        // Stub implementation: always returns NotImplemented
        Poll::Ready(Err(Error::NotImplemented(format!(
            "Promise execution not yet implemented. Expression: {}",
            self.expression_string()
        ))))
    }
}

// ============================================================================
// Connection
// ============================================================================

/// Session state for a connection.
pub struct Session {
    /// The URL we're connected to.
    url: String,
    /// Whether the session is connected.
    connected: bool,
}

impl Session {
    /// Get the URL of this session.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Check if the session is connected.
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// Close the session gracefully.
    pub async fn close(&mut self) -> Result<()> {
        self.connected = false;
        Ok(())
    }

    /// Create a promise for a method call on the root interface.
    pub fn call<T>(&self, method: &str, args: Vec<serde_json::Value>) -> Promise<T> {
        Promise::new(self.url.clone(), method, args)
    }

    /// Execute a dynamic method call (for conformance testing).
    ///
    /// This is a stub that returns NotImplemented.
    pub async fn call_method(
        &self,
        method: &str,
        args: Vec<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        Err(Error::NotImplemented(format!(
            "Method call not implemented: {}({:?})",
            method, args
        )))
    }

    /// Execute a pipelined call sequence (for conformance testing).
    ///
    /// This is a stub that returns NotImplemented.
    pub async fn call_pipeline(
        &self,
        steps: Vec<PipelineStep>,
    ) -> Result<serde_json::Value> {
        Err(Error::NotImplemented(format!(
            "Pipeline not implemented: {:?}",
            steps
        )))
    }
}

/// A step in a pipeline call.
#[derive(Debug, Clone)]
pub struct PipelineStep {
    /// The method to call.
    pub call: String,
    /// Arguments to the method.
    pub args: Vec<serde_json::Value>,
    /// Optional alias for the result.
    pub alias: Option<String>,
}

/// Connect to a Cap'n Web server.
///
/// # Arguments
///
/// * `url` - The WebSocket URL to connect to (e.g., "wss://api.example.com")
///
/// # Returns
///
/// A `Session` that can be used to make RPC calls.
///
/// # Example
///
/// ```ignore
/// let session = capnweb::connect("wss://api.example.com").await?;
/// let result = session.call::<User>("getUser", vec![json!(42)]).await?;
/// ```
pub async fn connect(url: &str) -> Result<Session> {
    // Stub implementation: just store the URL
    // Real implementation would establish WebSocket connection
    Ok(Session {
        url: url.to_string(),
        connected: true,
    })
}

// ============================================================================
// Dynamic API
// ============================================================================

/// Dynamic API handle for untyped RPC calls.
pub struct Dynamic {
    session: Arc<Session>,
}

impl Dynamic {
    /// Create a new dynamic API handle.
    pub fn new(session: Arc<Session>) -> Self {
        Self { session }
    }

    /// Start building a method call.
    pub fn call(&self, method: &str) -> DynamicCall {
        DynamicCall {
            session: self.session.clone(),
            method: method.to_string(),
            args: Vec::new(),
        }
    }

    /// Get a nested property.
    pub fn get(&self, property: &str) -> DynamicProperty {
        DynamicProperty {
            session: self.session.clone(),
            path: vec![property.to_string()],
        }
    }
}

/// Builder for a dynamic method call.
pub struct DynamicCall {
    session: Arc<Session>,
    method: String,
    args: Vec<serde_json::Value>,
}

impl DynamicCall {
    /// Add an argument to the call.
    pub fn arg<T: Serialize>(mut self, value: T) -> Self {
        self.args
            .push(serde_json::to_value(value).unwrap_or(serde_json::Value::Null));
        self
    }

    /// Execute the call and get the result.
    pub async fn execute<T: DeserializeOwned>(self) -> Result<T> {
        let value = self
            .session
            .call_method(&self.method, self.args)
            .await?;
        serde_json::from_value(value).map_err(|e| Error::Deserialization(e.to_string()))
    }
}

/// Builder for accessing a dynamic property.
pub struct DynamicProperty {
    session: Arc<Session>,
    path: Vec<String>,
}

impl DynamicProperty {
    /// Navigate to a nested property.
    pub fn get(mut self, property: &str) -> Self {
        self.path.push(property.to_string());
        self
    }

    /// Get the property value.
    pub async fn value<T: DeserializeOwned>(self) -> Result<T> {
        Err(Error::NotImplemented(format!(
            "Property access not implemented: {}",
            self.path.join(".")
        )))
    }
}

// ============================================================================
// Testing Utilities
// ============================================================================

/// Check if the SDK is fully implemented.
///
/// Returns `true` if the SDK can execute actual RPC calls,
/// `false` if it's still a stub implementation.
pub fn is_implemented() -> bool {
    false
}

/// Get the SDK version.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_connect_creates_session() {
        let session = connect("ws://localhost:8787").await.unwrap();
        assert_eq!(session.url(), "ws://localhost:8787");
        assert!(session.is_connected());
    }

    #[tokio::test]
    async fn test_promise_expression_string() {
        let promise: Promise<i32> = Promise::new(
            "ws://localhost".to_string(),
            "square",
            vec![serde_json::json!(5)],
        );
        assert_eq!(promise.expression_string(), "square(5)");
    }

    #[tokio::test]
    async fn test_promise_pipeline_expression() {
        let promise1: Promise<()> = Promise::new(
            "ws://localhost".to_string(),
            "makeCounter",
            vec![serde_json::json!(42)],
        );
        let promise2: Promise<i32> = promise1.pipeline("value", vec![]);
        assert_eq!(promise2.expression_string(), "makeCounter(42).value()");
    }

    #[test]
    fn test_is_implemented() {
        // Stub implementation should return false
        assert!(!is_implemented());
    }
}
