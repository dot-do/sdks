//! Error types for RPC operations.

use std::fmt;
use thiserror::Error;

/// All errors that can occur during RPC operations.
#[derive(Debug, Error)]
pub enum RpcError {
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
    #[error("remote error: {message}")]
    Remote {
        /// Error type from server (e.g., "RangeError", "TypeError")
        error_type: String,
        /// Error message
        message: String,
        /// Optional error code
        code: Option<i32>,
    },

    /// Request timed out.
    #[error("timeout")]
    Timeout,

    /// Request was canceled (promise dropped before completion).
    #[error("canceled")]
    Canceled,

    /// Session was terminated.
    #[error("session aborted: {0}")]
    Aborted(String),

    /// Method not found on remote object.
    #[error("method not found: {0}")]
    MethodNotFound(String),

    /// Serialization error.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Deserialization error.
    #[error("deserialization error: {0}")]
    Deserialization(String),

    /// Protocol error.
    #[error("protocol error: {0}")]
    Protocol(String),

    /// Internal error.
    #[error("internal error: {0}")]
    Internal(String),
}

impl RpcError {
    /// Create a remote error from server response.
    pub fn remote(error_type: impl Into<String>, message: impl Into<String>) -> Self {
        RpcError::Remote {
            error_type: error_type.into(),
            message: message.into(),
            code: None,
        }
    }

    /// Create a remote error with code.
    pub fn remote_with_code(
        error_type: impl Into<String>,
        message: impl Into<String>,
        code: i32,
    ) -> Self {
        RpcError::Remote {
            error_type: error_type.into(),
            message: message.into(),
            code: Some(code),
        }
    }

    /// Check if this error matches a specific type name.
    pub fn is_type(&self, type_name: &str) -> bool {
        match self {
            RpcError::Remote { error_type, .. } => error_type == type_name,
            RpcError::NotFound(_) => type_name == "NotFound" || type_name == "Error",
            RpcError::Unauthorized => type_name == "Unauthorized" || type_name == "Error",
            RpcError::Forbidden(_) => type_name == "Forbidden" || type_name == "Error",
            RpcError::InvalidArgument(_) => {
                type_name == "InvalidArgument"
                    || type_name == "RangeError"
                    || type_name == "TypeError"
                    || type_name == "Error"
            }
            RpcError::Timeout => type_name == "Timeout" || type_name == "Error",
            RpcError::MethodNotFound(_) => type_name == "MethodNotFound" || type_name == "Error",
            _ => type_name == "Error",
        }
    }

    /// Check if error message contains a substring.
    pub fn message_contains(&self, substring: &str) -> bool {
        let message = self.to_string().to_lowercase();
        message.contains(&substring.to_lowercase())
    }
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

    /// URL parsing error.
    #[error("invalid URL: {0}")]
    InvalidUrl(String),

    /// TLS/SSL error.
    #[error("TLS error: {0}")]
    Tls(String),

    /// I/O error.
    #[error("io error: {0}")]
    Io(String),
}

impl From<tokio_tungstenite::tungstenite::Error> for TransportError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        TransportError::WebSocket(err.to_string())
    }
}

impl From<url::ParseError> for TransportError {
    fn from(err: url::ParseError) -> Self {
        TransportError::InvalidUrl(err.to_string())
    }
}

impl From<std::io::Error> for TransportError {
    fn from(err: std::io::Error) -> Self {
        TransportError::Io(err.to_string())
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for RpcError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        RpcError::Transport(TransportError::WebSocket(err.to_string()))
    }
}

impl From<serde_json::Error> for RpcError {
    fn from(err: serde_json::Error) -> Self {
        RpcError::Serialization(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_type_matching() {
        let err = RpcError::remote("RangeError", "test error");
        assert!(err.is_type("RangeError"));
        assert!(!err.is_type("TypeError"));
    }

    #[test]
    fn test_error_message_contains() {
        let err = RpcError::remote("Error", "This is a test error message");
        assert!(err.message_contains("test"));
        assert!(err.message_contains("TEST")); // case insensitive
        assert!(!err.message_contains("foobar"));
    }

    #[test]
    fn test_transport_error_display() {
        let err = TransportError::ConnectionFailed("connection refused".to_string());
        assert!(err.to_string().contains("connection refused"));
    }
}
