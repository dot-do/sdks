//! Authenticated RPC session support for oauth-do
//!
//! This module provides integration between oauth-do and the platform-do SDK,
//! enabling creation of authenticated RPC sessions using stored OAuth tokens.
//!
//! Dependency chain: capnweb-do -> rpc-do -> platform-do -> oauth-do
//!
//! oauth-do depends on both:
//! - rpc-do: For direct RPC client access and low-level RPC operations
//! - platform-do: For managed connections with pooling, retry, and auth
//!
//! # Example
//!
//! ```rust,no_run
//! use oauth_do::rpc::{create_authenticated_client, AuthenticatedRpcOptions};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Create an authenticated client with stored credentials (using platform-do)
//!     let result = create_authenticated_client(AuthenticatedRpcOptions::default()).await?;
//!
//!     if result.is_authenticated {
//!         // Make authenticated RPC calls
//!         let response = result.client.call("api.users.list", serde_json::json!({})).await?;
//!         println!("Response: {:?}", response);
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! # Direct RPC Access
//!
//! For low-level RPC access without platform-do's pooling:
//!
//! ```rust,no_run
//! use oauth_do::rpc::{create_direct_rpc_client, DirectRpcOptions};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let client = create_direct_rpc_client(
//!         "wss://api.example.do",
//!         DirectRpcOptions::default()
//!     ).await?;
//!
//!     // Use the rpc-do client directly
//!     let result = client.call("some_method", serde_json::json!({})).await?;
//!
//!     Ok(())
//! }
//! ```

use platform_do::{DotDo, DotDoError, RetryPolicy};
use rpc_do::RpcClient;
use std::time::Duration;

use crate::auth::get_token;
use crate::storage::{create_secure_storage, TokenStorage};
use crate::types::StoredTokenData;

/// Options for creating an authenticated RPC session.
#[derive(Debug, Clone)]
pub struct AuthenticatedRpcOptions {
    /// Token to use for authentication. If not provided, will attempt to get
    /// token from storage or environment variables.
    pub token: Option<String>,

    /// If true, return an error if no token is available.
    /// If false (default), create an unauthenticated session.
    pub require_auth: bool,

    /// Request timeout duration.
    pub timeout: Duration,

    /// Maximum number of retry attempts.
    pub max_retries: u32,

    /// Connection pool size.
    pub pool_size: usize,

    /// Base endpoint URL override.
    pub endpoint: Option<String>,
}

impl Default for AuthenticatedRpcOptions {
    fn default() -> Self {
        Self {
            token: None,
            require_auth: false,
            timeout: Duration::from_secs(30),
            max_retries: 3,
            pool_size: 4,
            endpoint: None,
        }
    }
}

impl AuthenticatedRpcOptions {
    /// Create options that require authentication.
    pub fn require_auth() -> Self {
        Self {
            require_auth: true,
            ..Default::default()
        }
    }

    /// Create options with a specific token.
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            token: Some(token.into()),
            ..Default::default()
        }
    }

    /// Set the timeout duration.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Set the maximum number of retries.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Set the connection pool size.
    pub fn pool_size(mut self, pool_size: usize) -> Self {
        self.pool_size = pool_size;
        self
    }

    /// Set the endpoint URL.
    pub fn endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = Some(endpoint.into());
        self
    }
}

/// Result of creating an authenticated RPC client.
pub struct AuthenticatedRpcClient {
    /// The DotDo platform client configured with authentication.
    pub client: DotDo,

    /// The access token being used (if authenticated).
    pub token: Option<String>,

    /// Full token data including refresh token (if available).
    pub token_data: Option<StoredTokenData>,

    /// Whether the client is authenticated.
    pub is_authenticated: bool,
}

/// Error type for authenticated RPC operations.
#[derive(Debug, thiserror::Error)]
pub enum AuthenticatedRpcError {
    /// Authentication is required but no token is available.
    #[error("Authentication required but no token available. Please login using `oauth-do login` or provide a token explicitly.")]
    AuthRequired,

    /// Failed to get token from storage.
    #[error("Failed to get token from storage: {0}")]
    StorageError(String),

    /// DotDo client error.
    #[error("DotDo client error: {0}")]
    DotDoError(#[from] DotDoError),
}

/// Create an authenticated DotDo platform client using stored OAuth tokens.
///
/// This function integrates oauth-do with platform-do to create RPC sessions
/// that are automatically authenticated using stored credentials.
///
/// # Arguments
///
/// * `options` - Configuration options for the RPC client
///
/// # Returns
///
/// An authenticated client with token information.
///
/// # Errors
///
/// Returns an error if `require_auth` is true but no token is available.
///
/// # Example
///
/// ```rust,no_run
/// use oauth_do::rpc::{create_authenticated_client, AuthenticatedRpcOptions};
///
/// #[tokio::main]
/// async fn main() -> anyhow::Result<()> {
///     // Create client with stored token
///     let result = create_authenticated_client(AuthenticatedRpcOptions::default()).await?;
///
///     if result.is_authenticated {
///         println!("Authenticated with token: {}...", &result.token.unwrap()[..20]);
///     }
///
///     Ok(())
/// }
/// ```
pub async fn create_authenticated_client(
    options: AuthenticatedRpcOptions,
) -> Result<AuthenticatedRpcClient, AuthenticatedRpcError> {
    // Get token from explicit option, storage, or environment
    let (token, token_data) = if let Some(explicit_token) = options.token {
        (Some(explicit_token), None)
    } else {
        // Try to get token from storage
        match get_token_with_data().await {
            Ok((t, td)) => (t, td),
            Err(e) => {
                if options.require_auth {
                    return Err(AuthenticatedRpcError::StorageError(e.to_string()));
                }
                (None, None)
            }
        }
    };

    // Check if auth is required but not available
    if options.require_auth && token.is_none() {
        return Err(AuthenticatedRpcError::AuthRequired);
    }

    // Build the DotDo client
    let mut builder = DotDo::builder()
        .timeout(options.timeout)
        .pool_size(options.pool_size)
        .retry_policy(RetryPolicy::new(options.max_retries));

    // Set endpoint if provided
    if let Some(endpoint) = options.endpoint {
        builder = builder.endpoint(endpoint);
    }

    // Set authentication if token is available
    if let Some(ref t) = token {
        builder = builder.bearer_token(t);
    }

    let client = builder.build().await?;

    Ok(AuthenticatedRpcClient {
        client,
        token,
        token_data,
        is_authenticated: token.is_some(),
    })
}

/// Get token and token data from storage.
async fn get_token_with_data() -> anyhow::Result<(Option<String>, Option<StoredTokenData>)> {
    // First try to get from environment
    if let Some(token) = get_token().await? {
        return Ok((Some(token), None));
    }

    // Try to get from secure storage
    let storage = create_secure_storage(None);
    if let Some(token_data) = storage.get_token_data().await? {
        return Ok((Some(token_data.access_token.clone()), Some(token_data)));
    }

    Ok((None, None))
}

/// Create a DotDo client factory that uses oauth-do for authentication.
///
/// This is useful when you need to create multiple connections with the
/// same authentication configuration.
///
/// # Arguments
///
/// * `base_options` - Base configuration options to use for all clients
///
/// # Returns
///
/// A factory function for creating authenticated clients.
pub fn create_auth_factory(
    base_options: AuthenticatedRpcOptions,
) -> impl Fn(Option<AuthenticatedRpcOptions>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<AuthenticatedRpcClient, AuthenticatedRpcError>> + Send>>
{
    move |override_options| {
        let options = if let Some(overrides) = override_options {
            AuthenticatedRpcOptions {
                token: overrides.token.or_else(|| base_options.token.clone()),
                require_auth: overrides.require_auth,
                timeout: overrides.timeout,
                max_retries: overrides.max_retries,
                pool_size: overrides.pool_size,
                endpoint: overrides.endpoint.or_else(|| base_options.endpoint.clone()),
            }
        } else {
            base_options.clone()
        };

        Box::pin(create_authenticated_client(options))
    }
}

// ============================================================================
// Direct RPC Access (using rpc-do directly)
// ============================================================================

/// Options for creating a direct RPC connection (without platform-do pooling).
#[derive(Debug, Clone)]
pub struct DirectRpcOptions {
    /// Token to use for authentication. If not provided, will attempt to get
    /// token from storage or environment variables.
    pub token: Option<String>,

    /// If true, return an error if no token is available.
    /// If false (default), create an unauthenticated connection.
    pub require_auth: bool,

    /// Connection timeout duration.
    pub timeout: Duration,
}

impl Default for DirectRpcOptions {
    fn default() -> Self {
        Self {
            token: None,
            require_auth: false,
            timeout: Duration::from_secs(30),
        }
    }
}

impl DirectRpcOptions {
    /// Create options that require authentication.
    pub fn require_auth() -> Self {
        Self {
            require_auth: true,
            ..Default::default()
        }
    }

    /// Create options with a specific token.
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            token: Some(token.into()),
            ..Default::default()
        }
    }

    /// Set the timeout duration.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// Result of creating an authenticated RPC session for direct connections.
pub struct AuthenticatedRpcSession {
    /// The access token being used (if authenticated).
    pub token: Option<String>,

    /// Full token data including refresh token (if available).
    pub token_data: Option<StoredTokenData>,

    /// Whether the session is authenticated.
    pub is_authenticated: bool,
}

/// Create a direct RPC client connection with automatic authentication.
///
/// This uses rpc-do directly for low-level RPC access without platform-do's
/// pooling and retry logic. Use this when you need direct control over the
/// connection lifecycle or for simple single-connection scenarios.
///
/// For managed connections with pooling and retry, use `create_authenticated_client()`
/// which uses platform-do.
///
/// # Arguments
///
/// * `url` - WebSocket URL of the RPC service
/// * `options` - Connection options
///
/// # Returns
///
/// Direct RPC client instance.
///
/// # Errors
///
/// Returns an error if `require_auth` is true but no token is available.
///
/// # Example
///
/// ```rust,no_run
/// use oauth_do::rpc::{create_direct_rpc_client, DirectRpcOptions};
///
/// #[tokio::main]
/// async fn main() -> anyhow::Result<()> {
///     // Create direct connection with stored credentials
///     let client = create_direct_rpc_client(
///         "wss://api.example.do",
///         DirectRpcOptions::default()
///     ).await?;
///
///     // Make RPC calls
///     let result = client.call("some_method", serde_json::json!({})).await?;
///
///     Ok(())
/// }
/// ```
pub async fn create_direct_rpc_client(
    url: &str,
    options: DirectRpcOptions,
) -> Result<RpcClient, AuthenticatedRpcError> {
    // Get token from explicit option, storage, or environment
    let token = if let Some(explicit_token) = options.token {
        Some(explicit_token)
    } else {
        match get_token().await {
            Ok(t) => t,
            Err(e) => {
                if options.require_auth {
                    return Err(AuthenticatedRpcError::StorageError(e.to_string()));
                }
                None
            }
        }
    };

    // Check if auth is required but not available
    if options.require_auth && token.is_none() {
        return Err(AuthenticatedRpcError::AuthRequired);
    }

    // Create RPC client with authentication
    let mut builder = RpcClient::builder(url)
        .timeout(options.timeout);

    if let Some(ref t) = token {
        builder = builder.bearer_token(t);
    }

    builder.connect().await.map_err(|e| AuthenticatedRpcError::StorageError(e.to_string()))
}

/// Create an authenticated RPC session that can be used for multiple connections.
///
/// This provides authentication info that can be used with the raw rpc-do client,
/// suitable for scenarios where you need fine-grained control over the RPC transport.
///
/// # Arguments
///
/// * `options` - Authentication options
///
/// # Returns
///
/// Authenticated RPC session info.
///
/// # Example
///
/// ```rust,no_run
/// use oauth_do::rpc::{create_authenticated_rpc_session, DirectRpcOptions};
/// use rpc_do::RpcClient;
///
/// #[tokio::main]
/// async fn main() -> anyhow::Result<()> {
///     let session = create_authenticated_rpc_session(DirectRpcOptions::default()).await?;
///
///     if session.is_authenticated {
///         // Use the token to connect to multiple services
///         let token = session.token.as_ref().unwrap();
///         let client1 = RpcClient::builder("wss://api.example.do")
///             .bearer_token(token)
///             .connect()
///             .await?;
///     }
///
///     Ok(())
/// }
/// ```
pub async fn create_authenticated_rpc_session(
    options: DirectRpcOptions,
) -> Result<AuthenticatedRpcSession, AuthenticatedRpcError> {
    // Get token from explicit option, storage, or environment
    let (token, token_data) = if let Some(explicit_token) = options.token {
        (Some(explicit_token), None)
    } else {
        match get_token_with_data().await {
            Ok((t, td)) => (t, td),
            Err(e) => {
                if options.require_auth {
                    return Err(AuthenticatedRpcError::StorageError(e.to_string()));
                }
                (None, None)
            }
        }
    };

    // Check if auth is required but not available
    if options.require_auth && token.is_none() {
        return Err(AuthenticatedRpcError::AuthRequired);
    }

    Ok(AuthenticatedRpcSession {
        token,
        token_data,
        is_authenticated: token.is_some(),
    })
}

// Re-export rpc-do types for convenience
pub use rpc_do::RpcClient as DirectRpcClient;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_options_default() {
        let opts = AuthenticatedRpcOptions::default();
        assert!(!opts.require_auth);
        assert!(opts.token.is_none());
        assert_eq!(opts.timeout, Duration::from_secs(30));
    }

    #[test]
    fn test_options_require_auth() {
        let opts = AuthenticatedRpcOptions::require_auth();
        assert!(opts.require_auth);
    }

    #[test]
    fn test_options_with_token() {
        let opts = AuthenticatedRpcOptions::with_token("my-token");
        assert_eq!(opts.token, Some("my-token".to_string()));
    }

    #[test]
    fn test_options_builder() {
        let opts = AuthenticatedRpcOptions::default()
            .timeout(Duration::from_secs(60))
            .max_retries(5)
            .pool_size(8)
            .endpoint("wss://custom.api.do");

        assert_eq!(opts.timeout, Duration::from_secs(60));
        assert_eq!(opts.max_retries, 5);
        assert_eq!(opts.pool_size, 8);
        assert_eq!(opts.endpoint, Some("wss://custom.api.do".to_string()));
    }

    #[test]
    fn test_direct_options_default() {
        let opts = DirectRpcOptions::default();
        assert!(!opts.require_auth);
        assert!(opts.token.is_none());
        assert_eq!(opts.timeout, Duration::from_secs(30));
    }

    #[test]
    fn test_direct_options_require_auth() {
        let opts = DirectRpcOptions::require_auth();
        assert!(opts.require_auth);
    }

    #[test]
    fn test_direct_options_with_token() {
        let opts = DirectRpcOptions::with_token("my-token");
        assert_eq!(opts.token, Some("my-token".to_string()));
    }
}
