//! Configuration management for OAuth.do
//!
//! This module handles global OAuth configuration settings.

use crate::types::OAuthConfig;
use std::sync::{LazyLock, RwLock};

/// Global OAuth configuration
static GLOBAL_CONFIG: LazyLock<RwLock<OAuthConfig>> =
    LazyLock::new(|| RwLock::new(OAuthConfig::default()));

/// Configure OAuth settings
///
/// # Example
///
/// ```rust
/// use oauth_do::{configure, OAuthConfig};
///
/// configure(OAuthConfig {
///     client_id: "my_client_id".to_string(),
///     ..Default::default()
/// });
/// ```
pub fn configure(config: OAuthConfig) {
    let mut global = GLOBAL_CONFIG.write().unwrap();
    *global = config;
}

/// Get current configuration
///
/// Returns a clone of the current global configuration.
pub fn get_config() -> OAuthConfig {
    GLOBAL_CONFIG.read().unwrap().clone()
}

/// Update specific configuration values
///
/// Allows partial updates to the configuration.
pub fn update_config<F>(updater: F)
where
    F: FnOnce(&mut OAuthConfig),
{
    let mut global = GLOBAL_CONFIG.write().unwrap();
    updater(&mut global);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = get_config();
        assert_eq!(config.api_url, "https://apis.do");
        assert_eq!(config.authkit_domain, "login.oauth.do");
    }

    #[test]
    fn test_configure() {
        configure(OAuthConfig {
            api_url: "https://test.apis.do".to_string(),
            client_id: "test_client".to_string(),
            authkit_domain: "test.login.oauth.do".to_string(),
            storage_path: None,
        });

        let config = get_config();
        assert_eq!(config.api_url, "https://test.apis.do");
        assert_eq!(config.client_id, "test_client");

        // Reset to default
        configure(OAuthConfig::default());
    }
}
