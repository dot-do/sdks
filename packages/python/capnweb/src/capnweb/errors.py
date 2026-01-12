"""
Standardized Error Codes for DotDo Cap'n Web SDK.

This module defines standardized error codes that are consistent across
all language implementations (TypeScript, Python, Rust, Go).

Error Code Ranges:
- 1xxx: Connection errors
- 2xxx: RPC errors
- 3xxx: Timeout errors
- 4xxx: Capability errors
- 5xxx: Serialization errors
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from typing import Any, TypeVar, Union


# ============================================================================
# Standard Error Codes
# ============================================================================


class ErrorCode(IntEnum):
    """
    Standard error codes used across all DotDo SDK implementations.

    These codes are consistent across TypeScript, Python, Rust, and Go.
    """

    # Connection-related errors (network, transport)
    CONNECTION_ERROR = 1001

    # RPC method call failures
    RPC_ERROR = 2001

    # Request timeout exceeded
    TIMEOUT_ERROR = 3001

    # Capability resolution or access errors
    CAPABILITY_ERROR = 4001

    # Serialization/deserialization errors
    SERIALIZATION_ERROR = 5001


# Maps error codes to their string names
ERROR_CODE_NAMES: dict[ErrorCode, str] = {
    ErrorCode.CONNECTION_ERROR: "CONNECTION_ERROR",
    ErrorCode.RPC_ERROR: "RPC_ERROR",
    ErrorCode.TIMEOUT_ERROR: "TIMEOUT_ERROR",
    ErrorCode.CAPABILITY_ERROR: "CAPABILITY_ERROR",
    ErrorCode.SERIALIZATION_ERROR: "SERIALIZATION_ERROR",
}


# ============================================================================
# Base Error Class
# ============================================================================


class CapnwebError(Exception):
    """
    Base error class for all capnweb/RPC errors.

    All error types in the DotDo ecosystem extend this class, allowing you to
    catch all RPC-related errors with a single catch block.

    Error Hierarchy:
    - CapnwebError (base)
      - ConnectionError: Connection failures, disconnections
      - RpcError: Method call failures, server errors
      - TimeoutError: Request timeout exceeded
      - CapabilityError: Capability resolution failures
      - SerializationError: Encoding/decoding failures

    Example:
        ```python
        try:
            await client.call('someMethod')
        except CapnwebError as error:
            print(f"RPC error [{error.code}]: {error.message}")
        ```

    Attributes:
        message: Human-readable error message.
        code: Numeric error code (e.g., 1001, 2001).
        code_name: String name of the error code (e.g., 'CONNECTION_ERROR').
    """

    def __init__(
        self,
        message: str,
        code: ErrorCode,
        code_name: str | None = None,
    ) -> None:
        """
        Create a new CapnwebError.

        Args:
            message: Human-readable error message.
            code: Numeric error code (e.g., ErrorCode.CONNECTION_ERROR).
            code_name: String name of the error code. If not provided,
                       will be looked up from ERROR_CODE_NAMES.
        """
        super().__init__(message)
        self.message = message
        self.code = code
        self.code_name = code_name or ERROR_CODE_NAMES.get(code, "UNKNOWN_ERROR")

    def __str__(self) -> str:
        return f"{self.code_name}({self.code}): {self.message}"

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.message!r}, code={self.code})"

    def to_dict(self) -> dict[str, Any]:
        """Return a dictionary representation of the error."""
        return {
            "name": self.__class__.__name__,
            "message": self.message,
            "code": int(self.code),
            "code_name": self.code_name,
        }


# ============================================================================
# Specific Error Types
# ============================================================================


class ConnectionError(CapnwebError):
    """
    Error raised when a connection cannot be established or is unexpectedly lost.

    Error Code: 1001 (CONNECTION_ERROR)

    Common causes:
    - Network unreachable or server down
    - TLS/certificate errors
    - Connection timeout during handshake
    - Server closed connection unexpectedly

    Example:
        ```python
        try:
            await connect('wss://api.example.do')
        except ConnectionError as error:
            print(f"Failed to connect: {error.message}")
            # Retry logic here
        ```
    """

    def __init__(self, message: str) -> None:
        """
        Create a new ConnectionError.

        Args:
            message: Description of the connection failure.
        """
        super().__init__(message, ErrorCode.CONNECTION_ERROR, "CONNECTION_ERROR")


class RpcError(CapnwebError):
    """
    Error raised when an RPC method call fails.

    Error Code: 2001 (RPC_ERROR)

    Common causes:
    - Method not found on the remote server
    - Invalid arguments passed to the method
    - Server-side exception during method execution
    - Permission denied for the requested operation

    Example:
        ```python
        try:
            await client.call('processData', data)
        except RpcError as error:
            print(f"RPC call failed: {error.message}")
            if error.method_id is not None:
                print(f"Method ID: {error.method_id}")
        ```

    Attributes:
        method_id: Optional method ID that failed (for debugging).
    """

    def __init__(self, message: str, method_id: int | None = None) -> None:
        """
        Create a new RpcError.

        Args:
            message: Description of the RPC failure.
            method_id: Optional method ID that failed (for debugging).
        """
        super().__init__(message, ErrorCode.RPC_ERROR, "RPC_ERROR")
        self.method_id = method_id


class TimeoutError(CapnwebError):
    """
    Error raised when an operation exceeds its timeout.

    Error Code: 3001 (TIMEOUT_ERROR)

    Common causes:
    - Server is slow or overloaded
    - Network latency issues
    - Method taking longer than expected to complete
    - Deadlock or infinite loop on the server

    Example:
        ```python
        try:
            await client.call('longRunningOperation', timeout=5000)
        except TimeoutError as error:
            print(f"Operation timed out: {error.message}")
            # Consider retrying with a longer timeout
        ```

    Attributes:
        timeout_ms: The timeout duration in milliseconds.
    """

    def __init__(
        self, message: str = "Request timed out", timeout_ms: int | None = None
    ) -> None:
        """
        Create a new TimeoutError.

        Args:
            message: Description of what timed out.
            timeout_ms: The timeout duration in milliseconds.
        """
        super().__init__(message, ErrorCode.TIMEOUT_ERROR, "TIMEOUT_ERROR")
        self.timeout_ms = timeout_ms


class CapabilityError(CapnwebError):
    """
    Error raised when a capability cannot be resolved or is invalid.

    Error Code: 4001 (CAPABILITY_ERROR)

    Common causes:
    - Capability reference expired or was garbage collected
    - Capability was revoked by the server
    - Invalid capability ID provided
    - Capability not found in the import table

    Example:
        ```python
        try:
            counter = await client.call('getCounter')
            await counter.increment(1)
        except CapabilityError as error:
            print(f"Capability error: {error.message}")
            if error.capability_id is not None:
                print(f"Capability ID: {error.capability_id}")
        ```

    Attributes:
        capability_id: Optional ID of the capability that caused the error.
    """

    def __init__(self, message: str, capability_id: int | None = None) -> None:
        """
        Create a new CapabilityError.

        Args:
            message: Description of the capability error.
            capability_id: Optional ID of the capability that caused the error.
        """
        super().__init__(message, ErrorCode.CAPABILITY_ERROR, "CAPABILITY_ERROR")
        self.capability_id = capability_id


class SerializationError(CapnwebError):
    """
    Error raised when serialization or deserialization fails.

    Error Code: 5001 (SERIALIZATION_ERROR)

    Common causes:
    - Invalid data format
    - Schema mismatch between client and server
    - Corrupted message data
    - Unsupported data types

    Example:
        ```python
        try:
            await client.call('processData', complex_object)
        except SerializationError as error:
            print(f"Serialization failed: {error.message}")
        ```

    Attributes:
        is_deserialize: Whether this was a deserialization (vs serialization) error.
    """

    def __init__(self, message: str, is_deserialize: bool = False) -> None:
        """
        Create a new SerializationError.

        Args:
            message: Description of the serialization failure.
            is_deserialize: Whether this was a deserialization error.
        """
        super().__init__(message, ErrorCode.SERIALIZATION_ERROR, "SERIALIZATION_ERROR")
        self.is_deserialize = is_deserialize


# ============================================================================
# Error Utilities
# ============================================================================


def is_error_code(error: BaseException, code: ErrorCode) -> bool:
    """
    Check if an error is a CapnwebError with a specific error code.

    Args:
        error: The error to check.
        code: The error code to match.

    Returns:
        True if the error matches the code.

    Example:
        ```python
        try:
            await client.call('method')
        except Exception as error:
            if is_error_code(error, ErrorCode.TIMEOUT_ERROR):
                # Handle timeout specifically
                pass
        ```
    """
    return isinstance(error, CapnwebError) and error.code == code


def create_error(code: ErrorCode, message: str) -> CapnwebError:
    """
    Create an appropriate CapnwebError subclass from an error code and message.

    Args:
        code: The error code.
        message: The error message.

    Returns:
        An instance of the appropriate error class.
    """
    if code == ErrorCode.CONNECTION_ERROR:
        return ConnectionError(message)
    elif code == ErrorCode.RPC_ERROR:
        return RpcError(message)
    elif code == ErrorCode.TIMEOUT_ERROR:
        return TimeoutError(message)
    elif code == ErrorCode.CAPABILITY_ERROR:
        return CapabilityError(message)
    elif code == ErrorCode.SERIALIZATION_ERROR:
        return SerializationError(message)
    else:
        return CapnwebError(message, code)


def wrap_error(
    error: BaseException,
    default_code: ErrorCode = ErrorCode.RPC_ERROR,
) -> CapnwebError:
    """
    Wrap an unknown error into a CapnwebError.

    Args:
        error: Any error or exception.
        default_code: The default error code if not a CapnwebError.

    Returns:
        A CapnwebError instance.
    """
    if isinstance(error, CapnwebError):
        return error
    return create_error(default_code, str(error))


# Re-export built-in TimeoutError as BuiltinTimeoutError to avoid shadowing
BuiltinTimeoutError = __builtins__["TimeoutError"] if isinstance(__builtins__, dict) else getattr(__builtins__, "TimeoutError", None)  # type: ignore
