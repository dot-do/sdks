//! Type definitions for OAuth.do
//!
//! This module contains all the type definitions used throughout the oauth-do library.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// OAuth error types for the library
#[derive(Error, Debug)]
pub enum OAuthError {
    /// Configuration lock is poisoned (unrecoverable)
    #[error("Configuration lock poisoned - unrecoverable")]
    ConfigLockPoisoned,

    /// Storage lock is poisoned (unrecoverable)
    #[error("Storage lock poisoned - unrecoverable")]
    StorageLockPoisoned,

    /// Network request failed
    #[error("Network request failed: {0}")]
    NetworkError(#[from] reqwest::Error),

    /// JSON serialization/deserialization failed
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    /// IO error
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    /// Client ID is required
    #[error("Client ID is required. Set OAUTH_CLIENT_ID or configure with client_id")]
    MissingClientId,

    /// Authentication failed
    #[error("Authentication failed: {status}")]
    AuthenticationFailed { status: String },

    /// Token refresh failed
    #[error("Token refresh failed: {status} - {details}")]
    TokenRefreshFailed { status: String, details: String },

    /// Device authorization failed
    #[error("Device authorization failed: {status} - {details}")]
    DeviceAuthorizationFailed { status: String, details: String },

    /// Device code expired
    #[error("Device authorization expired. Please try again.")]
    DeviceCodeExpired,

    /// Access denied by user
    #[error("Access denied by user")]
    AccessDenied,

    /// Token polling failed
    #[error("Token polling failed: {0}")]
    TokenPollingFailed(String),

    /// Keyring error
    #[error("Keyring error: {0}")]
    KeyringError(String),

    /// Home directory not found
    #[error("Could not determine home directory")]
    HomeDirNotFound,

    /// Token data parsing failed
    #[error("Failed to parse token data: {0}")]
    TokenParseError(String),
}

/// OAuth configuration options
#[derive(Debug, Clone)]
pub struct OAuthConfig {
    /// Base URL for API endpoints
    /// Default: 'https://apis.do'
    pub api_url: String,

    /// Client ID for OAuth flow
    pub client_id: String,

    /// AuthKit domain for device authorization
    /// Default: 'login.oauth.do'
    pub authkit_domain: String,

    /// Custom path for token storage
    /// Supports ~ for home directory (e.g., '~/.studio/tokens.json')
    /// Default: '~/.oauth.do/token'
    pub storage_path: Option<String>,
}

impl Default for OAuthConfig {
    fn default() -> Self {
        Self {
            api_url: std::env::var("OAUTH_API_URL")
                .or_else(|_| std::env::var("API_URL"))
                .unwrap_or_else(|_| "https://apis.do".to_string()),
            client_id: std::env::var("OAUTH_CLIENT_ID")
                .unwrap_or_else(|_| "client_01JQYTRXK9ZPD8JPJTKDCRB656".to_string()),
            authkit_domain: std::env::var("OAUTH_AUTHKIT_DOMAIN")
                .unwrap_or_else(|_| "login.oauth.do".to_string()),
            storage_path: std::env::var("OAUTH_STORAGE_PATH").ok(),
        }
    }
}

/// User information returned from auth endpoints
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Additional fields
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Authentication result
#[derive(Debug, Clone)]
pub struct AuthResult {
    pub user: Option<User>,
    pub token: Option<String>,
}

/// Device authorization response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAuthorizationResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// Token response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    pub token_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_in: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<User>,
}

/// Token polling error types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    AuthorizationPending,
    SlowDown,
    AccessDenied,
    ExpiredToken,
    Unknown(String),
}

impl TokenError {
    pub fn from_str(s: &str) -> Self {
        match s {
            "authorization_pending" => TokenError::AuthorizationPending,
            "slow_down" => TokenError::SlowDown,
            "access_denied" => TokenError::AccessDenied,
            "expired_token" => TokenError::ExpiredToken,
            other => TokenError::Unknown(other.to_string()),
        }
    }
}

/// Stored token data including refresh token and expiration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokenData {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken", skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Unix timestamp in milliseconds
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<u64>,
}

/// OAuth provider options for direct provider login
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthProvider {
    GitHubOAuth,
    GoogleOAuth,
    MicrosoftOAuth,
    AppleOAuth,
}

impl OAuthProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            OAuthProvider::GitHubOAuth => "GitHubOAuth",
            OAuthProvider::GoogleOAuth => "GoogleOAuth",
            OAuthProvider::MicrosoftOAuth => "MicrosoftOAuth",
            OAuthProvider::AppleOAuth => "AppleOAuth",
        }
    }
}

/// Token error response from the API
#[derive(Debug, Deserialize)]
pub struct TokenErrorResponse {
    pub error: Option<String>,
    pub error_description: Option<String>,
}
