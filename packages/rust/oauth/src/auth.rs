//! Authentication utilities for OAuth.do
//!
//! This module provides functions for user authentication,
//! token management, and user information retrieval.

use crate::config::get_config;
use crate::storage::{create_secure_storage, TokenStorage};
use crate::types::{AuthResult, StoredTokenData, TokenResponse, User};
use anyhow::{anyhow, Result};

/// Buffer time before expiration to trigger refresh (5 minutes in milliseconds)
const REFRESH_BUFFER_MS: u64 = 5 * 60 * 1000;

/// Get current authenticated user
///
/// Calls GET /me endpoint with the provided token.
///
/// # Arguments
///
/// * `token` - Optional authentication token (will use DO_TOKEN env var if not provided)
///
/// # Returns
///
/// Authentication result with user info or null if not authenticated
pub async fn get_user(token: Option<&str>) -> Result<AuthResult> {
    let config = get_config();
    let auth_token = token
        .map(|t| t.to_string())
        .or_else(|| std::env::var("DO_TOKEN").ok())
        .unwrap_or_default();

    if auth_token.is_empty() {
        return Ok(AuthResult {
            user: None,
            token: None,
        });
    }

    let client = reqwest::Client::new();
    let url = format!("{}/me", config.api_url);

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .send()
        .await?;

    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Ok(AuthResult {
                user: None,
                token: None,
            });
        }
        let status = response.status();
        return Err(anyhow!("Authentication failed: {}", status));
    }

    let user: User = response.json().await?;
    Ok(AuthResult {
        user: Some(user),
        token: Some(auth_token),
    })
}

/// Logout current user
///
/// Calls POST /logout endpoint and removes stored credentials.
///
/// # Arguments
///
/// * `token` - Optional authentication token (will use DO_TOKEN env var if not provided)
pub async fn logout(token: Option<&str>) -> Result<()> {
    let config = get_config();
    let auth_token = token
        .map(|t| t.to_string())
        .or_else(|| std::env::var("DO_TOKEN").ok())
        .unwrap_or_default();

    if auth_token.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::new();
    let url = format!("{}/logout", config.api_url);

    // Call logout endpoint (ignore errors - we still want to remove local token)
    let _ = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .send()
        .await;

    // Remove stored token
    let storage = create_secure_storage(config.storage_path.as_deref());
    storage.remove_token()?;

    Ok(())
}

/// Check if a token is expired or about to expire
fn is_token_expired(expires_at: Option<u64>) -> bool {
    match expires_at {
        Some(exp) => {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;
            now_ms >= exp.saturating_sub(REFRESH_BUFFER_MS)
        }
        None => false, // Can't determine, assume valid
    }
}

/// Refresh an access token using a refresh token
///
/// # Arguments
///
/// * `refresh_token` - The refresh token from the original auth response
///
/// # Returns
///
/// New token response with fresh access_token (and possibly new refresh_token)
pub async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse> {
    let config = get_config();

    if config.client_id.is_empty() {
        return Err(anyhow!("Client ID is required for token refresh"));
    }

    let client = reqwest::Client::new();
    let url = "https://auth.apis.do/user_management/authenticate";

    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", &config.client_id),
    ];

    let response = client
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(anyhow!("Token refresh failed: {} - {}", status, error_text));
    }

    let data: TokenResponse = response.json().await?;
    Ok(data)
}

/// Get token from environment or stored credentials
///
/// Checks in order:
/// 1. DO_ADMIN_TOKEN environment variable
/// 2. DO_TOKEN environment variable
/// 3. Stored token (keychain/secure file) - with automatic refresh if expired
pub async fn get_token() -> Result<Option<String>> {
    // Check env vars first
    if let Ok(admin_token) = std::env::var("DO_ADMIN_TOKEN") {
        if !admin_token.is_empty() {
            return Ok(Some(admin_token));
        }
    }

    if let Ok(do_token) = std::env::var("DO_TOKEN") {
        if !do_token.is_empty() {
            return Ok(Some(do_token));
        }
    }

    // Try stored token
    let config = get_config();
    let storage = create_secure_storage(config.storage_path.as_deref());

    // Get full token data if available
    if let Ok(Some(token_data)) = storage.get_token_data() {
        // If token is not expired, return it
        if !is_token_expired(token_data.expires_at) {
            return Ok(Some(token_data.access_token));
        }

        // Token is expired - try to refresh if we have a refresh token
        if let Some(refresh_token) = &token_data.refresh_token {
            match refresh_access_token(refresh_token).await {
                Ok(new_tokens) => {
                    // Calculate new expiration time
                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    let expires_at = new_tokens.expires_in.map(|e| now_ms + e * 1000);

                    // Store new token data
                    let new_data = StoredTokenData {
                        access_token: new_tokens.access_token.clone(),
                        refresh_token: new_tokens.refresh_token.or_else(|| token_data.refresh_token.clone()),
                        expires_at,
                    };

                    storage.set_token_data(&new_data)?;
                    return Ok(Some(new_tokens.access_token));
                }
                Err(_) => {
                    // Refresh failed - return None (caller should re-authenticate)
                    return Ok(None);
                }
            }
        }

        // Expired but no refresh token - return None
        return Ok(None);
    }

    // Fall back to simple token storage (no expiration tracking)
    storage.get_token()
}

/// Check if user is authenticated (has valid token)
pub async fn is_authenticated(token: Option<&str>) -> Result<bool> {
    let result = get_user(token).await?;
    Ok(result.user.is_some())
}

/// Get stored token data from storage
pub fn get_stored_token_data() -> Result<Option<StoredTokenData>> {
    let config = get_config();
    let storage = create_secure_storage(config.storage_path.as_deref());
    storage.get_token_data()
}

/// Store token data including refresh token
pub fn store_token_data(data: &StoredTokenData) -> Result<()> {
    let config = get_config();
    let storage = create_secure_storage(config.storage_path.as_deref());
    storage.set_token_data(data)
}

/// Build OAuth authorization URL
///
/// # Arguments
///
/// * `redirect_uri` - The URI to redirect to after authorization
/// * `scope` - OAuth scopes (default: "openid profile email")
/// * `state` - Optional state parameter for CSRF protection
/// * `response_type` - OAuth response type (default: "code")
///
/// # Returns
///
/// The full authorization URL
pub fn build_auth_url(
    redirect_uri: &str,
    scope: Option<&str>,
    state: Option<&str>,
    response_type: Option<&str>,
) -> String {
    let config = get_config();

    let mut params = vec![
        ("client_id", config.client_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("response_type", response_type.unwrap_or("code")),
        ("scope", scope.unwrap_or("openid profile email")),
    ];

    if let Some(s) = state {
        params.push(("state", s));
    }

    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("https://{}/authorize?{}", config.authkit_domain, query)
}

// Add urlencoding as a simple implementation
mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
                _ => format!("%{:02X}", c as u8),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_token_expired_none() {
        // No expiration set - should not be considered expired
        assert!(!is_token_expired(None));
    }

    #[test]
    fn test_is_token_expired_future() {
        // Token expires far in the future
        let future_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 3600000; // 1 hour from now
        assert!(!is_token_expired(Some(future_ms)));
    }

    #[test]
    fn test_is_token_expired_past() {
        // Token already expired
        let past_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            - 3600000; // 1 hour ago
        assert!(is_token_expired(Some(past_ms)));
    }

    #[test]
    fn test_build_auth_url() {
        let url = build_auth_url("https://example.com/callback", None, None, None);
        assert!(url.contains("client_id="));
        assert!(url.contains("redirect_uri="));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("scope="));
    }
}
