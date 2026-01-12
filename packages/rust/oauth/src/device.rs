//! Device authorization flow for OAuth.do
//!
//! Implements OAuth 2.0 Device Authorization Grant (RFC 8628)

use crate::config::get_config;
use crate::types::{
    DeviceAuthorizationResponse, OAuthProvider, TokenError, TokenErrorResponse, TokenResponse,
};
use anyhow::{anyhow, Result};
use std::time::{Duration, Instant};

/// Options for device authorization
#[derive(Debug, Default)]
pub struct DeviceAuthOptions {
    /// OAuth provider to use directly (bypasses AuthKit login screen)
    pub provider: Option<OAuthProvider>,
}

/// Initiate device authorization flow
///
/// Following OAuth 2.0 Device Authorization Grant (RFC 8628)
///
/// # Arguments
///
/// * `options` - Optional settings including provider for direct OAuth
///
/// # Returns
///
/// Device authorization response with codes and URIs
///
/// # Example
///
/// ```rust,no_run
/// use oauth_do::device::{authorize_device, DeviceAuthOptions};
///
/// #[tokio::main]
/// async fn main() -> anyhow::Result<()> {
///     let response = authorize_device(DeviceAuthOptions::default()).await?;
///     println!("Visit: {}", response.verification_uri);
///     println!("Enter code: {}", response.user_code);
///     Ok(())
/// }
/// ```
pub async fn authorize_device(options: DeviceAuthOptions) -> Result<DeviceAuthorizationResponse> {
    let config = get_config();

    if config.client_id.is_empty() {
        return Err(anyhow!(
            "Client ID is required for device authorization. Set OAUTH_CLIENT_ID or configure with client_id"
        ));
    }

    let url = "https://auth.apis.do/user_management/authorize/device";

    let mut params = vec![
        ("client_id", config.client_id.clone()),
        ("scope", "openid profile email".to_string()),
    ];

    // Add provider if specified (bypasses AuthKit login screen)
    if let Some(provider) = options.provider {
        params.push(("provider", provider.as_str().to_string()));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Device authorization failed: {} - {}",
            status,
            error_text
        ));
    }

    let data: DeviceAuthorizationResponse = response.json().await?;
    Ok(data)
}

/// Poll for tokens after device authorization
///
/// # Arguments
///
/// * `device_code` - Device code from authorization response
/// * `interval` - Polling interval in seconds (default: 5)
/// * `expires_in` - Expiration time in seconds (default: 600)
///
/// # Returns
///
/// Token response with access token and optionally user info
///
/// # Example
///
/// ```rust,no_run
/// use oauth_do::device::{authorize_device, poll_for_tokens, DeviceAuthOptions};
///
/// #[tokio::main]
/// async fn main() -> anyhow::Result<()> {
///     let auth_response = authorize_device(DeviceAuthOptions::default()).await?;
///     let tokens = poll_for_tokens(
///         &auth_response.device_code,
///         auth_response.interval,
///         auth_response.expires_in,
///     ).await?;
///     println!("Access token: {}", tokens.access_token);
///     Ok(())
/// }
/// ```
pub async fn poll_for_tokens(
    device_code: &str,
    interval: u64,
    expires_in: u64,
) -> Result<TokenResponse> {
    let config = get_config();

    if config.client_id.is_empty() {
        return Err(anyhow!("Client ID is required for token polling"));
    }

    let start_time = Instant::now();
    let timeout = Duration::from_secs(expires_in);
    let mut current_interval = Duration::from_secs(interval);

    let client = reqwest::Client::new();
    let url = "https://auth.apis.do/user_management/authenticate";

    loop {
        // Check if expired
        if start_time.elapsed() > timeout {
            return Err(anyhow!("Device authorization expired. Please try again."));
        }

        // Wait for interval
        tokio::time::sleep(current_interval).await;

        let params = [
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
            ("client_id", &config.client_id),
        ];

        let response = client
            .post(url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;

        if response.status().is_success() {
            let data: TokenResponse = response.json().await?;
            return Ok(data);
        }

        // Handle error responses
        let error_response: TokenErrorResponse = response
            .json()
            .await
            .unwrap_or(TokenErrorResponse {
                error: Some("unknown".to_string()),
                error_description: None,
            });

        let error = TokenError::from_str(&error_response.error.unwrap_or_else(|| "unknown".to_string()));

        match error {
            TokenError::AuthorizationPending => {
                // Continue polling
                continue;
            }
            TokenError::SlowDown => {
                // Increase interval by 5 seconds
                current_interval += Duration::from_secs(5);
                continue;
            }
            TokenError::AccessDenied => {
                return Err(anyhow!("Access denied by user"));
            }
            TokenError::ExpiredToken => {
                return Err(anyhow!("Device code expired"));
            }
            TokenError::Unknown(msg) => {
                return Err(anyhow!("Token polling failed: {}", msg));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_auth_options_default() {
        let options = DeviceAuthOptions::default();
        assert!(options.provider.is_none());
    }

    #[test]
    fn test_oauth_provider_as_str() {
        assert_eq!(OAuthProvider::GitHubOAuth.as_str(), "GitHubOAuth");
        assert_eq!(OAuthProvider::GoogleOAuth.as_str(), "GoogleOAuth");
        assert_eq!(OAuthProvider::MicrosoftOAuth.as_str(), "MicrosoftOAuth");
        assert_eq!(OAuthProvider::AppleOAuth.as_str(), "AppleOAuth");
    }
}
