//! oauth-do - Simple, secure OAuth authentication for humans and AI agents
//!
//! This crate provides OAuth 2.0 Device Authorization Grant (RFC 8628) flow
//! for CLI applications and AI agents.
//!
//! # Features
//!
//! - Device authorization flow for CLI/terminal apps
//! - Secure token storage using OS keychain (with file fallback)
//! - Automatic token refresh
//! - User information retrieval
//!
//! # Example
//!
//! ```rust,no_run
//! use oauth_do::device::{authorize_device, poll_for_tokens, DeviceAuthOptions};
//! use oauth_do::auth::get_user;
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Start device authorization
//!     let auth_response = authorize_device(DeviceAuthOptions::default()).await?;
//!
//!     println!("Visit: {}", auth_response.verification_uri);
//!     println!("Enter code: {}", auth_response.user_code);
//!
//!     // Poll for tokens
//!     let tokens = poll_for_tokens(
//!         &auth_response.device_code,
//!         auth_response.interval,
//!         auth_response.expires_in,
//!     ).await?;
//!
//!     // Get user info
//!     let result = get_user(Some(&tokens.access_token)).await?;
//!     if let Some(user) = result.user {
//!         println!("Logged in as: {}", user.email.unwrap_or_default());
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! # CLI Usage
//!
//! ```bash
//! # Install
//! cargo install oauth-do
//!
//! # Login
//! oauth-do login
//!
//! # Check current user
//! oauth-do whoami
//!
//! # Get token
//! oauth-do token
//!
//! # Logout
//! oauth-do logout
//! ```

pub mod auth;
pub mod config;
pub mod device;
pub mod storage;
pub mod types;

// Re-export commonly used types and functions
pub use auth::{get_token, get_user, is_authenticated, logout, refresh_access_token};
pub use config::{configure, get_config};
pub use device::{authorize_device, poll_for_tokens, DeviceAuthOptions};
pub use storage::{
    create_secure_storage, FileStorage, KeyringStorage, MemoryStorage, SecureStorage, TokenStorage,
};
pub use types::{
    AuthResult, DeviceAuthorizationResponse, OAuthConfig, OAuthProvider, StoredTokenData,
    TokenError, TokenResponse, User,
};
