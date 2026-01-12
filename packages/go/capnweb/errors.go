// Package capnweb provides standardized error codes for DotDo Cap'n Web SDK.
//
// This file defines standardized error codes that are consistent across
// all language implementations (TypeScript, Python, Rust, Go).
//
// Error Code Ranges:
//   - 1xxx: Connection errors
//   - 2xxx: RPC errors
//   - 3xxx: Timeout errors
//   - 4xxx: Capability errors
//   - 5xxx: Serialization errors
package capnweb

import (
	"errors"
	"fmt"
)

// ============================================================================
// Standard Error Codes
// ============================================================================

// ErrorCode represents a standardized error code used across all DotDo SDK implementations.
// These codes are consistent across TypeScript, Python, Rust, and Go.
type ErrorCode int

const (
	// ConnectionErrorCode indicates connection-related errors (network, transport).
	ConnectionErrorCode ErrorCode = 1001

	// RpcErrorCode indicates RPC method call failures.
	RpcErrorCode ErrorCode = 2001

	// TimeoutErrorCode indicates request timeout exceeded.
	TimeoutErrorCode ErrorCode = 3001

	// CapabilityErrorCode indicates capability resolution or access errors.
	CapabilityErrorCode ErrorCode = 4001

	// SerializationErrorCode indicates serialization/deserialization errors.
	SerializationErrorCode ErrorCode = 5001
)

// String returns the string name of the error code.
func (c ErrorCode) String() string {
	switch c {
	case ConnectionErrorCode:
		return "CONNECTION_ERROR"
	case RpcErrorCode:
		return "RPC_ERROR"
	case TimeoutErrorCode:
		return "TIMEOUT_ERROR"
	case CapabilityErrorCode:
		return "CAPABILITY_ERROR"
	case SerializationErrorCode:
		return "SERIALIZATION_ERROR"
	default:
		return fmt.Sprintf("UNKNOWN_ERROR_%d", c)
	}
}

// CodeFromInt creates an ErrorCode from an integer value.
// Returns (ErrorCode, true) if valid, or (0, false) if not a known code.
func CodeFromInt(code int) (ErrorCode, bool) {
	switch code {
	case 1001:
		return ConnectionErrorCode, true
	case 2001:
		return RpcErrorCode, true
	case 3001:
		return TimeoutErrorCode, true
	case 4001:
		return CapabilityErrorCode, true
	case 5001:
		return SerializationErrorCode, true
	default:
		return 0, false
	}
}

// ============================================================================
// Base Error Type
// ============================================================================

// CapnwebError is the base error interface for all capnweb/RPC errors.
//
// All error types in the DotDo ecosystem implement this interface, allowing you to
// check error codes consistently across different error types.
type CapnwebError interface {
	error
	// Code returns the standardized error code.
	Code() ErrorCode
	// CodeName returns the string name of the error code.
	CodeName() string
}

// baseError provides common functionality for all capnweb errors.
type baseError struct {
	message  string
	code     ErrorCode
	codeName string
}

func (e *baseError) Error() string {
	return fmt.Sprintf("%s(%d): %s", e.codeName, e.code, e.message)
}

func (e *baseError) Code() ErrorCode {
	return e.code
}

func (e *baseError) CodeName() string {
	return e.codeName
}

// ============================================================================
// Specific Error Types
// ============================================================================

// ConnectionErr represents an error when a connection cannot be established
// or is unexpectedly lost.
//
// Error Code: 1001 (CONNECTION_ERROR)
//
// Common causes:
//   - Network unreachable or server down
//   - TLS/certificate errors
//   - Connection timeout during handshake
//   - Server closed connection unexpectedly
type ConnectionErr struct {
	baseError
}

// NewConnectionError creates a new ConnectionErr.
func NewConnectionError(message string) *ConnectionErr {
	return &ConnectionErr{
		baseError: baseError{
			message:  message,
			code:     ConnectionErrorCode,
			codeName: "CONNECTION_ERROR",
		},
	}
}

// RpcErr represents an error when an RPC method call fails.
//
// Error Code: 2001 (RPC_ERROR)
//
// Common causes:
//   - Method not found on the remote server
//   - Invalid arguments passed to the method
//   - Server-side exception during method execution
//   - Permission denied for the requested operation
type RpcErr struct {
	baseError
	// MethodID is the optional method ID that failed (for debugging).
	MethodID *int
}

// NewRpcError creates a new RpcErr.
func NewRpcError(message string) *RpcErr {
	return &RpcErr{
		baseError: baseError{
			message:  message,
			code:     RpcErrorCode,
			codeName: "RPC_ERROR",
		},
	}
}

// NewRpcErrorWithMethod creates a new RpcErr with a method ID.
func NewRpcErrorWithMethod(message string, methodID int) *RpcErr {
	return &RpcErr{
		baseError: baseError{
			message:  message,
			code:     RpcErrorCode,
			codeName: "RPC_ERROR",
		},
		MethodID: &methodID,
	}
}

// TimeoutErr represents an error when an operation exceeds its timeout.
//
// Error Code: 3001 (TIMEOUT_ERROR)
//
// Common causes:
//   - Server is slow or overloaded
//   - Network latency issues
//   - Method taking longer than expected to complete
//   - Deadlock or infinite loop on the server
type TimeoutErr struct {
	baseError
	// TimeoutMs is the timeout duration in milliseconds.
	TimeoutMs *int64
}

// NewTimeoutError creates a new TimeoutErr with a default message.
func NewTimeoutError() *TimeoutErr {
	return &TimeoutErr{
		baseError: baseError{
			message:  "Request timed out",
			code:     TimeoutErrorCode,
			codeName: "TIMEOUT_ERROR",
		},
	}
}

// NewTimeoutErrorWithMessage creates a new TimeoutErr with a custom message.
func NewTimeoutErrorWithMessage(message string) *TimeoutErr {
	return &TimeoutErr{
		baseError: baseError{
			message:  message,
			code:     TimeoutErrorCode,
			codeName: "TIMEOUT_ERROR",
		},
	}
}

// NewTimeoutErrorWithDuration creates a new TimeoutErr with a timeout duration.
func NewTimeoutErrorWithDuration(message string, timeoutMs int64) *TimeoutErr {
	return &TimeoutErr{
		baseError: baseError{
			message:  message,
			code:     TimeoutErrorCode,
			codeName: "TIMEOUT_ERROR",
		},
		TimeoutMs: &timeoutMs,
	}
}

// CapabilityErr represents an error when a capability cannot be resolved or is invalid.
//
// Error Code: 4001 (CAPABILITY_ERROR)
//
// Common causes:
//   - Capability reference expired or was garbage collected
//   - Capability was revoked by the server
//   - Invalid capability ID provided
//   - Capability not found in the import table
type CapabilityErr struct {
	baseError
	// CapabilityID is the optional ID of the capability that caused the error.
	CapabilityID *uint64
}

// NewCapabilityError creates a new CapabilityErr.
func NewCapabilityError(message string) *CapabilityErr {
	return &CapabilityErr{
		baseError: baseError{
			message:  message,
			code:     CapabilityErrorCode,
			codeName: "CAPABILITY_ERROR",
		},
	}
}

// NewCapabilityErrorWithID creates a new CapabilityErr with a capability ID.
func NewCapabilityErrorWithID(message string, capabilityID uint64) *CapabilityErr {
	return &CapabilityErr{
		baseError: baseError{
			message:  message,
			code:     CapabilityErrorCode,
			codeName: "CAPABILITY_ERROR",
		},
		CapabilityID: &capabilityID,
	}
}

// SerializationErr represents an error when serialization or deserialization fails.
//
// Error Code: 5001 (SERIALIZATION_ERROR)
//
// Common causes:
//   - Invalid data format
//   - Schema mismatch between client and server
//   - Corrupted message data
//   - Unsupported data types
type SerializationErr struct {
	baseError
	// IsDeserialize indicates whether this was a deserialization (vs serialization) error.
	IsDeserialize bool
}

// NewSerializationError creates a new SerializationErr for serialization failures.
func NewSerializationError(message string) *SerializationErr {
	return &SerializationErr{
		baseError: baseError{
			message:  message,
			code:     SerializationErrorCode,
			codeName: "SERIALIZATION_ERROR",
		},
		IsDeserialize: false,
	}
}

// NewDeserializationError creates a new SerializationErr for deserialization failures.
func NewDeserializationError(message string) *SerializationErr {
	return &SerializationErr{
		baseError: baseError{
			message:  message,
			code:     SerializationErrorCode,
			codeName: "SERIALIZATION_ERROR",
		},
		IsDeserialize: true,
	}
}

// ============================================================================
// Error Utilities
// ============================================================================

// IsErrorCode checks if an error is a CapnwebError with a specific error code.
//
// Example:
//
//	if IsErrorCode(err, TimeoutErrorCode) {
//	    // Handle timeout specifically
//	}
func IsErrorCode(err error, code ErrorCode) bool {
	var capnwebErr CapnwebError
	if errors.As(err, &capnwebErr) {
		return capnwebErr.Code() == code
	}
	return false
}

// GetErrorCode extracts the error code from an error if it's a CapnwebError.
// Returns (code, true) if the error is a CapnwebError, or (0, false) otherwise.
func GetErrorCode(err error) (ErrorCode, bool) {
	var capnwebErr CapnwebError
	if errors.As(err, &capnwebErr) {
		return capnwebErr.Code(), true
	}
	return 0, false
}

// CreateError creates an appropriate error from an error code and message.
func CreateError(code ErrorCode, message string) CapnwebError {
	switch code {
	case ConnectionErrorCode:
		return NewConnectionError(message)
	case RpcErrorCode:
		return NewRpcError(message)
	case TimeoutErrorCode:
		return NewTimeoutErrorWithMessage(message)
	case CapabilityErrorCode:
		return NewCapabilityError(message)
	case SerializationErrorCode:
		return NewSerializationError(message)
	default:
		// Return a generic RPC error for unknown codes
		return NewRpcError(message)
	}
}

// WrapError wraps an unknown error into a CapnwebError.
// If the error is already a CapnwebError, it's returned as-is.
func WrapError(err error, defaultCode ErrorCode) CapnwebError {
	if err == nil {
		return nil
	}

	var capnwebErr CapnwebError
	if errors.As(err, &capnwebErr) {
		return capnwebErr
	}

	return CreateError(defaultCode, err.Error())
}

// IsConnectionError returns true if the error is a ConnectionErr.
func IsConnectionError(err error) bool {
	return IsErrorCode(err, ConnectionErrorCode)
}

// IsRpcError returns true if the error is an RpcErr.
func IsRpcError(err error) bool {
	return IsErrorCode(err, RpcErrorCode)
}

// IsTimeoutError returns true if the error is a TimeoutErr.
func IsTimeoutError(err error) bool {
	return IsErrorCode(err, TimeoutErrorCode)
}

// IsCapabilityError returns true if the error is a CapabilityErr.
func IsCapabilityError(err error) bool {
	return IsErrorCode(err, CapabilityErrorCode)
}

// IsSerializationError returns true if the error is a SerializationErr.
func IsSerializationError(err error) bool {
	return IsErrorCode(err, SerializationErrorCode)
}
