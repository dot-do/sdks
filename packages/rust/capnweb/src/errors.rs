//! Standardized Error Codes for DotDo Cap'n Web SDK.
//!
//! This module defines standardized error codes that are consistent across
//! all language implementations (TypeScript, Python, Rust, Go).
//!
//! # Error Code Ranges
//!
//! - 1xxx: Connection errors
//! - 2xxx: RPC errors
//! - 3xxx: Timeout errors
//! - 4xxx: Capability errors
//! - 5xxx: Serialization errors

use std::fmt;
use thiserror::Error;

// ============================================================================
// Standard Error Codes
// ============================================================================

/// Standard error codes used across all DotDo SDK implementations.
///
/// These codes are consistent across TypeScript, Python, Rust, and Go.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(i32)]
pub enum ErrorCode {
    /// Connection-related errors (network, transport)
    ConnectionError = 1001,

    /// RPC method call failures
    RpcError = 2001,

    /// Request timeout exceeded
    TimeoutError = 3001,

    /// Capability resolution or access errors
    CapabilityError = 4001,

    /// Serialization/deserialization errors
    SerializationError = 5001,
}

impl ErrorCode {
    /// Returns the numeric code value.
    pub fn code(&self) -> i32 {
        *self as i32
    }

    /// Returns the string name of the error code.
    pub fn name(&self) -> &'static str {
        match self {
            ErrorCode::ConnectionError => "CONNECTION_ERROR",
            ErrorCode::RpcError => "RPC_ERROR",
            ErrorCode::TimeoutError => "TIMEOUT_ERROR",
            ErrorCode::CapabilityError => "CAPABILITY_ERROR",
            ErrorCode::SerializationError => "SERIALIZATION_ERROR",
        }
    }

    /// Creates an ErrorCode from a numeric value.
    pub fn from_code(code: i32) -> Option<Self> {
        match code {
            1001 => Some(ErrorCode::ConnectionError),
            2001 => Some(ErrorCode::RpcError),
            3001 => Some(ErrorCode::TimeoutError),
            4001 => Some(ErrorCode::CapabilityError),
            5001 => Some(ErrorCode::SerializationError),
            _ => None,
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}({})", self.name(), self.code())
    }
}

// ============================================================================
// Base Error Type
// ============================================================================

/// All errors that can occur during capnweb/RPC operations.
///
/// This enum represents the complete error hierarchy for the DotDo SDK.
/// Each variant corresponds to a specific error code that is consistent
/// across all language implementations.
///
/// # Error Hierarchy
///
/// - `Connection`: Connection failures, disconnections (1001)
/// - `Rpc`: Method call failures, server errors (2001)
/// - `Timeout`: Request timeout exceeded (3001)
/// - `Capability`: Capability resolution failures (4001)
/// - `Serialization`: Encoding/decoding failures (5001)
///
/// # Example
///
/// ```ignore
/// use capnweb::{connect, CapnwebError, ErrorCode};
///
/// async fn example() {
///     match connect("wss://api.example.do").await {
///         Ok(session) => println!("Connected!"),
///         Err(CapnwebError::Connection(e)) => {
///             println!("Connection failed: {}", e.message);
///         }
///         Err(e) => {
///             println!("Error [{}]: {}", e.code(), e);
///         }
///     }
/// }
/// ```
#[derive(Debug, Error)]
pub enum CapnwebError {
    /// Connection-related error (network, transport).
    ///
    /// Error Code: 1001 (CONNECTION_ERROR)
    #[error("connection error: {0}")]
    Connection(#[from] ConnectionError),

    /// RPC method call failure.
    ///
    /// Error Code: 2001 (RPC_ERROR)
    #[error("rpc error: {0}")]
    Rpc(#[from] RpcError),

    /// Request timeout exceeded.
    ///
    /// Error Code: 3001 (TIMEOUT_ERROR)
    #[error("timeout error: {0}")]
    Timeout(#[from] TimeoutError),

    /// Capability resolution or access error.
    ///
    /// Error Code: 4001 (CAPABILITY_ERROR)
    #[error("capability error: {0}")]
    Capability(#[from] CapabilityError),

    /// Serialization or deserialization error.
    ///
    /// Error Code: 5001 (SERIALIZATION_ERROR)
    #[error("serialization error: {0}")]
    Serialization(#[from] SerializationError),
}

impl CapnwebError {
    /// Returns the error code for this error.
    pub fn code(&self) -> ErrorCode {
        match self {
            CapnwebError::Connection(_) => ErrorCode::ConnectionError,
            CapnwebError::Rpc(_) => ErrorCode::RpcError,
            CapnwebError::Timeout(_) => ErrorCode::TimeoutError,
            CapnwebError::Capability(_) => ErrorCode::CapabilityError,
            CapnwebError::Serialization(_) => ErrorCode::SerializationError,
        }
    }

    /// Returns the numeric code value.
    pub fn code_value(&self) -> i32 {
        self.code().code()
    }

    /// Returns the string name of the error code.
    pub fn code_name(&self) -> &'static str {
        self.code().name()
    }

    /// Checks if this error has the specified error code.
    pub fn is_code(&self, code: ErrorCode) -> bool {
        self.code() == code
    }
}

// ============================================================================
// Specific Error Types
// ============================================================================

/// Error raised when a connection cannot be established or is unexpectedly lost.
///
/// Error Code: 1001 (CONNECTION_ERROR)
///
/// # Common Causes
///
/// - Network unreachable or server down
/// - TLS/certificate errors
/// - Connection timeout during handshake
/// - Server closed connection unexpectedly
///
/// # Example
///
/// ```ignore
/// use capnweb::{connect, ConnectionError};
///
/// async fn example() {
///     match connect("wss://api.example.do").await {
///         Ok(session) => println!("Connected!"),
///         Err(capnweb::CapnwebError::Connection(e)) => {
///             println!("Failed to connect: {}", e.message);
///             // Retry logic here
///         }
///         Err(e) => println!("Other error: {}", e),
///     }
/// }
/// ```
#[derive(Debug, Error)]
#[error("{message}")]
pub struct ConnectionError {
    /// Description of the connection failure.
    pub message: String,
}

impl ConnectionError {
    /// Creates a new ConnectionError.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// Error raised when an RPC method call fails.
///
/// Error Code: 2001 (RPC_ERROR)
///
/// # Common Causes
///
/// - Method not found on the remote server
/// - Invalid arguments passed to the method
/// - Server-side exception during method execution
/// - Permission denied for the requested operation
///
/// # Example
///
/// ```ignore
/// use capnweb::RpcError;
///
/// async fn example(session: &Session) {
///     match session.call("processData", args).await {
///         Ok(result) => println!("Success: {:?}", result),
///         Err(capnweb::CapnwebError::Rpc(e)) => {
///             println!("RPC call failed: {}", e.message);
///             if let Some(method_id) = e.method_id {
///                 println!("Method ID: {}", method_id);
///             }
///         }
///         Err(e) => println!("Other error: {}", e),
///     }
/// }
/// ```
#[derive(Debug, Error)]
#[error("{message}")]
pub struct RpcError {
    /// Description of the RPC failure.
    pub message: String,
    /// Optional method ID that failed (for debugging).
    pub method_id: Option<u32>,
}

impl RpcError {
    /// Creates a new RpcError.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            method_id: None,
        }
    }

    /// Creates a new RpcError with a method ID.
    pub fn with_method_id(message: impl Into<String>, method_id: u32) -> Self {
        Self {
            message: message.into(),
            method_id: Some(method_id),
        }
    }
}

/// Error raised when an operation exceeds its timeout.
///
/// Error Code: 3001 (TIMEOUT_ERROR)
///
/// # Common Causes
///
/// - Server is slow or overloaded
/// - Network latency issues
/// - Method taking longer than expected to complete
/// - Deadlock or infinite loop on the server
///
/// # Example
///
/// ```ignore
/// use capnweb::TimeoutError;
/// use std::time::Duration;
///
/// async fn example(session: &Session) {
///     let result = session
///         .call_with_timeout("longRunningOperation", args, Duration::from_secs(5))
///         .await;
///
///     match result {
///         Ok(value) => println!("Success: {:?}", value),
///         Err(capnweb::CapnwebError::Timeout(e)) => {
///             println!("Operation timed out: {}", e.message);
///             // Consider retrying with a longer timeout
///         }
///         Err(e) => println!("Other error: {}", e),
///     }
/// }
/// ```
#[derive(Debug, Error)]
#[error("{message}")]
pub struct TimeoutError {
    /// Description of what timed out.
    pub message: String,
    /// The timeout duration in milliseconds.
    pub timeout_ms: Option<u64>,
}

impl TimeoutError {
    /// Creates a new TimeoutError with a default message.
    pub fn new() -> Self {
        Self {
            message: "Request timed out".to_string(),
            timeout_ms: None,
        }
    }

    /// Creates a new TimeoutError with a custom message.
    pub fn with_message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            timeout_ms: None,
        }
    }

    /// Creates a new TimeoutError with a timeout duration.
    pub fn with_timeout(message: impl Into<String>, timeout_ms: u64) -> Self {
        Self {
            message: message.into(),
            timeout_ms: Some(timeout_ms),
        }
    }
}

impl Default for TimeoutError {
    fn default() -> Self {
        Self::new()
    }
}

/// Error raised when a capability cannot be resolved or is invalid.
///
/// Error Code: 4001 (CAPABILITY_ERROR)
///
/// # Common Causes
///
/// - Capability reference expired or was garbage collected
/// - Capability was revoked by the server
/// - Invalid capability ID provided
/// - Capability not found in the import table
///
/// # Example
///
/// ```ignore
/// use capnweb::CapabilityError;
///
/// async fn example(session: &Session) {
///     let counter = session.call("getCounter", args).await?;
///
///     match counter.call("increment", [1]).await {
///         Ok(value) => println!("Value: {}", value),
///         Err(capnweb::CapnwebError::Capability(e)) => {
///             println!("Capability error: {}", e.message);
///             if let Some(cap_id) = e.capability_id {
///                 println!("Capability ID: {}", cap_id);
///             }
///         }
///         Err(e) => println!("Other error: {}", e),
///     }
/// }
/// ```
#[derive(Debug, Error)]
#[error("{message}")]
pub struct CapabilityError {
    /// Description of the capability error.
    pub message: String,
    /// Optional ID of the capability that caused the error.
    pub capability_id: Option<u64>,
}

impl CapabilityError {
    /// Creates a new CapabilityError.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            capability_id: None,
        }
    }

    /// Creates a new CapabilityError with a capability ID.
    pub fn with_capability_id(message: impl Into<String>, capability_id: u64) -> Self {
        Self {
            message: message.into(),
            capability_id: Some(capability_id),
        }
    }
}

/// Error raised when serialization or deserialization fails.
///
/// Error Code: 5001 (SERIALIZATION_ERROR)
///
/// # Common Causes
///
/// - Invalid data format
/// - Schema mismatch between client and server
/// - Corrupted message data
/// - Unsupported data types
///
/// # Example
///
/// ```ignore
/// use capnweb::SerializationError;
///
/// async fn example(session: &Session) {
///     match session.call("processData", complex_object).await {
///         Ok(result) => println!("Success: {:?}", result),
///         Err(capnweb::CapnwebError::Serialization(e)) => {
///             println!("Serialization failed: {}", e.message);
///             if e.is_deserialize {
///                 println!("This was a deserialization error");
///             }
///         }
///         Err(e) => println!("Other error: {}", e),
///     }
/// }
/// ```
#[derive(Debug, Error)]
#[error("{message}")]
pub struct SerializationError {
    /// Description of the serialization failure.
    pub message: String,
    /// Whether this was a deserialization (vs serialization) error.
    pub is_deserialize: bool,
}

impl SerializationError {
    /// Creates a new SerializationError for serialization failures.
    pub fn serialize(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            is_deserialize: false,
        }
    }

    /// Creates a new SerializationError for deserialization failures.
    pub fn deserialize(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            is_deserialize: true,
        }
    }
}

// ============================================================================
// Error Utilities
// ============================================================================

/// Checks if an error is a CapnwebError with a specific error code.
///
/// # Arguments
///
/// * `error` - The error to check
/// * `code` - The error code to match
///
/// # Returns
///
/// `true` if the error matches the code
///
/// # Example
///
/// ```ignore
/// use capnweb::{is_error_code, ErrorCode};
///
/// fn handle_error(error: &CapnwebError) {
///     if is_error_code(error, ErrorCode::TimeoutError) {
///         // Handle timeout specifically
///     }
/// }
/// ```
pub fn is_error_code(error: &CapnwebError, code: ErrorCode) -> bool {
    error.is_code(code)
}

/// Creates an appropriate CapnwebError from an error code and message.
///
/// # Arguments
///
/// * `code` - The error code
/// * `message` - The error message
///
/// # Returns
///
/// An instance of the appropriate error variant
pub fn create_error(code: ErrorCode, message: impl Into<String>) -> CapnwebError {
    let message = message.into();
    match code {
        ErrorCode::ConnectionError => CapnwebError::Connection(ConnectionError::new(message)),
        ErrorCode::RpcError => CapnwebError::Rpc(RpcError::new(message)),
        ErrorCode::TimeoutError => CapnwebError::Timeout(TimeoutError::with_message(message)),
        ErrorCode::CapabilityError => CapnwebError::Capability(CapabilityError::new(message)),
        ErrorCode::SerializationError => {
            CapnwebError::Serialization(SerializationError::serialize(message))
        }
    }
}

/// Result type alias for capnweb operations.
pub type Result<T> = std::result::Result<T, CapnwebError>;

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_codes() {
        assert_eq!(ErrorCode::ConnectionError.code(), 1001);
        assert_eq!(ErrorCode::RpcError.code(), 2001);
        assert_eq!(ErrorCode::TimeoutError.code(), 3001);
        assert_eq!(ErrorCode::CapabilityError.code(), 4001);
        assert_eq!(ErrorCode::SerializationError.code(), 5001);
    }

    #[test]
    fn test_error_code_names() {
        assert_eq!(ErrorCode::ConnectionError.name(), "CONNECTION_ERROR");
        assert_eq!(ErrorCode::RpcError.name(), "RPC_ERROR");
        assert_eq!(ErrorCode::TimeoutError.name(), "TIMEOUT_ERROR");
        assert_eq!(ErrorCode::CapabilityError.name(), "CAPABILITY_ERROR");
        assert_eq!(ErrorCode::SerializationError.name(), "SERIALIZATION_ERROR");
    }

    #[test]
    fn test_error_code_from_code() {
        assert_eq!(ErrorCode::from_code(1001), Some(ErrorCode::ConnectionError));
        assert_eq!(ErrorCode::from_code(2001), Some(ErrorCode::RpcError));
        assert_eq!(ErrorCode::from_code(9999), None);
    }

    #[test]
    fn test_capnweb_error_code() {
        let conn_err = CapnwebError::Connection(ConnectionError::new("test"));
        assert_eq!(conn_err.code(), ErrorCode::ConnectionError);
        assert_eq!(conn_err.code_value(), 1001);
        assert_eq!(conn_err.code_name(), "CONNECTION_ERROR");
    }

    #[test]
    fn test_create_error() {
        let err = create_error(ErrorCode::TimeoutError, "test timeout");
        assert!(err.is_code(ErrorCode::TimeoutError));
        assert!(err.to_string().contains("test timeout"));
    }

    #[test]
    fn test_is_error_code() {
        let err = CapnwebError::Rpc(RpcError::new("test"));
        assert!(is_error_code(&err, ErrorCode::RpcError));
        assert!(!is_error_code(&err, ErrorCode::TimeoutError));
    }

    #[test]
    fn test_rpc_error_with_method_id() {
        let err = RpcError::with_method_id("test", 42);
        assert_eq!(err.method_id, Some(42));
    }

    #[test]
    fn test_capability_error_with_id() {
        let err = CapabilityError::with_capability_id("test", 123);
        assert_eq!(err.capability_id, Some(123));
    }

    #[test]
    fn test_serialization_error_types() {
        let ser_err = SerializationError::serialize("test");
        assert!(!ser_err.is_deserialize);

        let deser_err = SerializationError::deserialize("test");
        assert!(deser_err.is_deserialize);
    }
}
