//! # DotDo Platform SDK
//!
//! The official Rust SDK for the DotDo AI platform.
//!
//! This crate provides managed connections with authentication, connection pooling,
//! and automatic retry logic for robust communication with DotDo services.
//!
//! ## Quick Start
//!
//! ```ignore
//! use dotdo::prelude::*;
//!
//! #[tokio::main]
//! async fn main() -> dotdo::Result<()> {
//!     // Create a DotDo client with default configuration
//!     let client = DotDo::builder()
//!         .api_key("your-api-key")
//!         .build()
//!         .await?;
//!
//!     // Make authenticated calls
//!     let response = client.call("ai.complete", json!({
//!         "prompt": "Hello, world!"
//!     })).await?;
//!
//!     println!("Response: {:?}", response);
//!     Ok(())
//! }
//! ```
//!
//! ## Features
//!
//! - **Authentication**: API key and OAuth token support
//! - **Connection Pooling**: Efficient reuse of connections
//! - **Retry Logic**: Automatic retries with exponential backoff
//! - **Health Monitoring**: Automatic health checks and failover

use dotdo_rpc::{RpcClient, RpcClientConfig, RpcError};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};

// Re-export underlying crates
pub use dotdo_rpc;
pub use dotdo_rpc::dotdo_capnweb;

/// Prelude module for common imports.
pub mod prelude {
    pub use super::{Auth, DotDo, DotDoBuilder, DotDoError, Result, RetryPolicy};
    pub use dotdo_rpc::prelude::*;
    pub use serde_json::json;
}

// ============================================================================
// Error Types
// ============================================================================

/// DotDo platform errors.
#[derive(Debug, Error)]
pub enum DotDoError {
    /// Underlying RPC error.
    #[error("rpc error: {0}")]
    Rpc(#[from] RpcError),

    /// Authentication error.
    #[error("authentication error: {0}")]
    Auth(String),

    /// Configuration error.
    #[error("configuration error: {0}")]
    Config(String),

    /// Connection pool exhausted.
    #[error("connection pool exhausted")]
    PoolExhausted,

    /// All retries failed.
    #[error("all retries failed: {0}")]
    RetriesExhausted(String),

    /// Service not available.
    #[error("service not available: {0}")]
    ServiceUnavailable(String),

    /// Rate limited.
    #[error("rate limited, retry after {retry_after_ms}ms")]
    RateLimited { retry_after_ms: u64 },
}

/// Alias for Result<T, DotDoError>.
pub type Result<T> = std::result::Result<T, DotDoError>;

// ============================================================================
// Authentication
// ============================================================================

/// Authentication credentials for DotDo services.
#[derive(Debug, Clone)]
pub enum Auth {
    /// API key authentication.
    ApiKey(String),
    /// OAuth bearer token.
    BearerToken(String),
    /// OAuth client credentials flow.
    ClientCredentials {
        client_id: String,
        client_secret: String,
    },
    /// No authentication (for public endpoints).
    None,
}

impl Auth {
    /// Create API key authentication.
    pub fn api_key(key: impl Into<String>) -> Self {
        Self::ApiKey(key.into())
    }

    /// Create bearer token authentication.
    pub fn bearer_token(token: impl Into<String>) -> Self {
        Self::BearerToken(token.into())
    }

    /// Create client credentials authentication.
    pub fn client_credentials(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self::ClientCredentials {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
        }
    }

    /// Check if authentication is configured.
    pub fn is_configured(&self) -> bool {
        !matches!(self, Auth::None)
    }

    /// Get the authorization header value (stub).
    fn to_header_value(&self) -> Option<String> {
        match self {
            Auth::ApiKey(key) => Some(format!("Bearer {}", key)),
            Auth::BearerToken(token) => Some(format!("Bearer {}", token)),
            Auth::ClientCredentials { .. } => {
                // In a real implementation, this would fetch a token
                None
            }
            Auth::None => None,
        }
    }
}

impl Default for Auth {
    fn default() -> Self {
        Self::None
    }
}

// ============================================================================
// Retry Policy
// ============================================================================

/// Retry policy configuration.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Maximum number of retry attempts.
    pub max_retries: u32,
    /// Initial backoff duration.
    pub initial_backoff: Duration,
    /// Maximum backoff duration.
    pub max_backoff: Duration,
    /// Backoff multiplier for exponential backoff.
    pub backoff_multiplier: f64,
    /// Whether to add jitter to backoff.
    pub jitter: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_secs(30),
            backoff_multiplier: 2.0,
            jitter: true,
        }
    }
}

impl RetryPolicy {
    /// Create a new retry policy with custom settings.
    pub fn new(max_retries: u32) -> Self {
        Self {
            max_retries,
            ..Default::default()
        }
    }

    /// Disable retries.
    pub fn no_retry() -> Self {
        Self {
            max_retries: 0,
            ..Default::default()
        }
    }

    /// Calculate the backoff duration for a given attempt (stub).
    fn backoff_for_attempt(&self, attempt: u32) -> Duration {
        if attempt >= self.max_retries {
            return self.max_backoff;
        }

        let backoff = self.initial_backoff.as_millis() as f64
            * self.backoff_multiplier.powi(attempt as i32);
        let backoff = backoff.min(self.max_backoff.as_millis() as f64);

        Duration::from_millis(backoff as u64)
    }
}

// ============================================================================
// Connection Pool
// ============================================================================

/// Connection pool for managing multiple RPC connections.
struct ConnectionPool {
    /// Available connections.
    connections: Vec<Arc<RpcClient>>,
    /// Maximum pool size.
    max_size: usize,
    /// Endpoint URL.
    endpoint: String,
    /// Client configuration.
    config: RpcClientConfig,
}

impl ConnectionPool {
    /// Create a new connection pool (stub).
    fn new(endpoint: String, config: RpcClientConfig, max_size: usize) -> Self {
        Self {
            connections: Vec::new(),
            max_size,
            endpoint,
            config,
        }
    }

    /// Get a connection from the pool (stub).
    async fn get(&mut self) -> Result<Arc<RpcClient>> {
        // Try to find an existing healthy connection
        if let Some(conn) = self.connections.pop() {
            if conn.is_connected() {
                return Ok(conn);
            }
        }

        // Create a new connection if under limit
        if self.connections.len() < self.max_size {
            let client = RpcClient::connect_with_config(&self.endpoint, self.config.clone())
                .await
                .map_err(DotDoError::Rpc)?;
            return Ok(Arc::new(client));
        }

        Err(DotDoError::PoolExhausted)
    }

    /// Return a connection to the pool (stub).
    fn release(&mut self, conn: Arc<RpcClient>) {
        if conn.is_connected() && self.connections.len() < self.max_size {
            self.connections.push(conn);
        }
    }
}

// ============================================================================
// DotDo Client
// ============================================================================

/// Configuration for the DotDo client.
#[derive(Debug, Clone)]
pub struct DotDoConfig {
    /// Base endpoint URL.
    pub endpoint: String,
    /// Authentication credentials.
    pub auth: Auth,
    /// Retry policy.
    pub retry_policy: RetryPolicy,
    /// Connection pool size.
    pub pool_size: usize,
    /// Request timeout.
    pub timeout: Duration,
    /// Enable health checks.
    pub health_check_enabled: bool,
    /// Health check interval.
    pub health_check_interval: Duration,
}

impl Default for DotDoConfig {
    fn default() -> Self {
        Self {
            endpoint: "wss://api.do.ai".to_string(),
            auth: Auth::None,
            retry_policy: RetryPolicy::default(),
            pool_size: 4,
            timeout: Duration::from_secs(30),
            health_check_enabled: false,
            health_check_interval: Duration::from_secs(30),
        }
    }
}

/// Builder for creating DotDo clients.
pub struct DotDoBuilder {
    config: DotDoConfig,
}

impl DotDoBuilder {
    /// Create a new builder with default configuration.
    pub fn new() -> Self {
        Self {
            config: DotDoConfig::default(),
        }
    }

    /// Set the endpoint URL.
    pub fn endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.config.endpoint = endpoint.into();
        self
    }

    /// Set API key authentication.
    pub fn api_key(mut self, key: impl Into<String>) -> Self {
        self.config.auth = Auth::api_key(key);
        self
    }

    /// Set bearer token authentication.
    pub fn bearer_token(mut self, token: impl Into<String>) -> Self {
        self.config.auth = Auth::bearer_token(token);
        self
    }

    /// Set client credentials authentication.
    pub fn client_credentials(
        mut self,
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
    ) -> Self {
        self.config.auth = Auth::client_credentials(client_id, client_secret);
        self
    }

    /// Set the authentication method.
    pub fn auth(mut self, auth: Auth) -> Self {
        self.config.auth = auth;
        self
    }

    /// Set the retry policy.
    pub fn retry_policy(mut self, policy: RetryPolicy) -> Self {
        self.config.retry_policy = policy;
        self
    }

    /// Set the connection pool size.
    pub fn pool_size(mut self, size: usize) -> Self {
        self.config.pool_size = size;
        self
    }

    /// Set the request timeout.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.config.timeout = timeout;
        self
    }

    /// Enable health checks.
    pub fn with_health_checks(mut self, interval: Duration) -> Self {
        self.config.health_check_enabled = true;
        self.config.health_check_interval = interval;
        self
    }

    /// Build the DotDo client.
    pub async fn build(self) -> Result<DotDo> {
        DotDo::new(self.config).await
    }
}

impl Default for DotDoBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// The main DotDo client for interacting with the platform.
///
/// `DotDo` provides managed connections with authentication, connection pooling,
/// and automatic retry logic.
///
/// # Example
///
/// ```ignore
/// use dotdo::prelude::*;
///
/// let client = DotDo::builder()
///     .api_key("your-api-key")
///     .pool_size(8)
///     .retry_policy(RetryPolicy::new(5))
///     .build()
///     .await?;
///
/// let result = client.call("ai.complete", json!({
///     "model": "claude-3",
///     "prompt": "Hello!"
/// })).await?;
/// ```
pub struct DotDo {
    /// Client configuration.
    config: DotDoConfig,
    /// Connection pool.
    pool: Mutex<ConnectionPool>,
    /// Cached authentication token (for OAuth flows).
    auth_token: RwLock<Option<String>>,
}

impl DotDo {
    /// Create a new DotDo client builder.
    pub fn builder() -> DotDoBuilder {
        DotDoBuilder::new()
    }

    /// Create a new DotDo client with the given configuration.
    async fn new(config: DotDoConfig) -> Result<Self> {
        let rpc_config = RpcClientConfig {
            timeout_ms: config.timeout.as_millis() as u64,
            max_retries: 0, // We handle retries at this layer
            auto_reconnect: true,
            health_check_interval_ms: if config.health_check_enabled {
                config.health_check_interval.as_millis() as u64
            } else {
                0
            },
        };

        let pool = ConnectionPool::new(
            config.endpoint.clone(),
            rpc_config,
            config.pool_size,
        );

        Ok(Self {
            config,
            pool: Mutex::new(pool),
            auth_token: RwLock::new(None),
        })
    }

    /// Get the endpoint URL.
    pub fn endpoint(&self) -> &str {
        &self.config.endpoint
    }

    /// Check if authentication is configured.
    pub fn is_authenticated(&self) -> bool {
        self.config.auth.is_configured()
    }

    /// Refresh the authentication token (stub for OAuth flows).
    async fn refresh_auth_token(&self) -> Result<()> {
        match &self.config.auth {
            Auth::ClientCredentials { client_id, client_secret } => {
                // Stub: In real implementation, this would call the OAuth endpoint
                let token = format!("oauth_token_for_{}", client_id);
                let mut auth_token = self.auth_token.write().await;
                *auth_token = Some(token);
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Get the current authorization header value.
    async fn get_auth_header(&self) -> Option<String> {
        // Check for cached OAuth token first
        if let Some(token) = self.auth_token.read().await.as_ref() {
            return Some(format!("Bearer {}", token));
        }

        // Fall back to static auth
        self.config.auth.to_header_value()
    }

    /// Make an RPC call with automatic retries.
    ///
    /// # Arguments
    ///
    /// * `method` - The method name to call
    /// * `params` - Parameters to pass to the method
    ///
    /// # Returns
    ///
    /// The JSON response from the server.
    pub async fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let args = match params {
            serde_json::Value::Array(arr) => arr,
            other => vec![other],
        };

        let mut last_error = None;
        let retry_policy = &self.config.retry_policy;

        for attempt in 0..=retry_policy.max_retries {
            if attempt > 0 {
                let backoff = retry_policy.backoff_for_attempt(attempt - 1);
                tokio::time::sleep(backoff).await;
            }

            // Get a connection from the pool
            let client = {
                let mut pool = self.pool.lock().await;
                match pool.get().await {
                    Ok(client) => client,
                    Err(e) => {
                        last_error = Some(e);
                        continue;
                    }
                }
            };

            // Make the call
            match client.call(method, args.clone()).await {
                Ok(result) => {
                    // Return the connection to the pool
                    let mut pool = self.pool.lock().await;
                    pool.release(client);
                    return Ok(result);
                }
                Err(e) => {
                    last_error = Some(DotDoError::Rpc(e));
                    // Don't return connection if it failed
                }
            }
        }

        Err(last_error.unwrap_or(DotDoError::RetriesExhausted(
            format!("Failed after {} attempts", retry_policy.max_retries + 1)
        )))
    }

    /// Make a typed RPC call with automatic retries.
    ///
    /// # Arguments
    ///
    /// * `method` - The method name to call
    /// * `params` - Parameters to pass to the method
    ///
    /// # Returns
    ///
    /// The deserialized response of type `T`.
    pub async fn call_typed<T>(&self, method: &str, params: serde_json::Value) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let response = self.call(method, params).await?;
        serde_json::from_value(response).map_err(|e| {
            DotDoError::Rpc(RpcError::Capnweb(
                dotdo_capnweb::Error::Deserialization(e.to_string())
            ))
        })
    }

    /// Check the health of the connection (stub).
    pub async fn health_check(&self) -> Result<bool> {
        // Stub: In real implementation, this would ping the server
        let mut pool = self.pool.lock().await;
        match pool.get().await {
            Ok(client) => {
                let healthy = client.is_connected();
                pool.release(client);
                Ok(healthy)
            }
            Err(_) => Ok(false),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dotdo_builder() {
        let client = DotDo::builder()
            .endpoint("ws://localhost:8787")
            .api_key("test-key")
            .pool_size(2)
            .timeout(Duration::from_secs(10))
            .build()
            .await
            .unwrap();

        assert_eq!(client.endpoint(), "ws://localhost:8787");
        assert!(client.is_authenticated());
    }

    #[test]
    fn test_auth_api_key() {
        let auth = Auth::api_key("my-key");
        assert!(auth.is_configured());
        assert_eq!(auth.to_header_value(), Some("Bearer my-key".to_string()));
    }

    #[test]
    fn test_auth_bearer_token() {
        let auth = Auth::bearer_token("my-token");
        assert!(auth.is_configured());
        assert_eq!(auth.to_header_value(), Some("Bearer my-token".to_string()));
    }

    #[test]
    fn test_auth_none() {
        let auth = Auth::None;
        assert!(!auth.is_configured());
        assert_eq!(auth.to_header_value(), None);
    }

    #[test]
    fn test_retry_policy_default() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.max_retries, 3);
        assert_eq!(policy.initial_backoff, Duration::from_millis(100));
    }

    #[test]
    fn test_retry_policy_no_retry() {
        let policy = RetryPolicy::no_retry();
        assert_eq!(policy.max_retries, 0);
    }

    #[test]
    fn test_retry_policy_backoff() {
        let policy = RetryPolicy {
            max_retries: 5,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_secs(10),
            backoff_multiplier: 2.0,
            jitter: false,
        };

        // Attempt 0: 100ms
        assert_eq!(policy.backoff_for_attempt(0), Duration::from_millis(100));
        // Attempt 1: 200ms
        assert_eq!(policy.backoff_for_attempt(1), Duration::from_millis(200));
        // Attempt 2: 400ms
        assert_eq!(policy.backoff_for_attempt(2), Duration::from_millis(400));
    }

    #[tokio::test]
    async fn test_dotdo_health_check() {
        let client = DotDo::builder()
            .endpoint("ws://localhost:8787")
            .build()
            .await
            .unwrap();

        // Stub implementation should return healthy
        let healthy = client.health_check().await.unwrap();
        assert!(healthy);
    }
}
