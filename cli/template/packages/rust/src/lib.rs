//! # {{Name}}-DO SDK
//!
//! {{description}}
//!
//! ## Example
//!
//! ```rust,no_run
//! use {{name}}_do::{{Name}}Client;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = {{Name}}Client::new(std::env::var("DOTDO_KEY")?)?;
//!     let rpc = client.connect().await?;
//!     // Use the RPC client...
//!     Ok(())
//! }
//! ```

use rpc_do::{connect, RpcClient};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

/// Errors that can occur when using the {{Name}} client
#[derive(Error, Debug)]
pub enum {{Name}}Error {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("RPC error: {0}")]
    Rpc(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

/// Result type for {{Name}} operations
pub type {{Name}}Result<T> = Result<T, {{Name}}Error>;

/// Options for configuring the {{Name}} client
#[derive(Clone, Debug)]
pub struct {{Name}}ClientOptions {
    /// API key for authentication
    pub api_key: Option<String>,
    /// Base URL for the service
    pub base_url: String,
}

impl Default for {{Name}}ClientOptions {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: "https://{{name}}.do".to_string(),
        }
    }
}

/// {{Name}}.do client for interacting with the {{name}} service
pub struct {{Name}}Client {
    options: {{Name}}ClientOptions,
    rpc: Arc<RwLock<Option<RpcClient>>>,
}

impl {{Name}}Client {
    /// Create a new {{Name}} client with an API key
    pub fn new(api_key: impl Into<String>) -> {{Name}}Result<Self> {
        Ok(Self {
            options: {{Name}}ClientOptions {
                api_key: Some(api_key.into()),
                ..Default::default()
            },
            rpc: Arc::new(RwLock::new(None)),
        })
    }

    /// Create a new {{Name}} client with custom options
    pub fn with_options(options: {{Name}}ClientOptions) -> Self {
        Self {
            options,
            rpc: Arc::new(RwLock::new(None)),
        }
    }

    /// Connect to the {{name}}.do service
    pub async fn connect(&self) -> {{Name}}Result<RpcClient> {
        let mut rpc = self.rpc.write().await;
        if rpc.is_none() {
            let client = connect(&self.options.base_url)
                .await
                .map_err(|e| {{Name}}Error::Connection(e.to_string()))?;
            *rpc = Some(client.clone());
            Ok(client)
        } else {
            Ok(rpc.clone().unwrap())
        }
    }

    /// Disconnect from the service
    pub async fn disconnect(&self) {
        let mut rpc = self.rpc.write().await;
        *rpc = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_options() {
        let options = {{Name}}ClientOptions::default();
        assert_eq!(options.base_url, "https://{{name}}.do");
        assert!(options.api_key.is_none());
    }

    #[test]
    fn test_new_client() {
        let client = {{Name}}Client::new("test-key").unwrap();
        assert!(client.options.api_key.is_some());
    }
}
