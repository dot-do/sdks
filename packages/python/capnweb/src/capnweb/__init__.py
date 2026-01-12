"""
capnweb-do - DotDo Cap'n Web SDK for Python.

Capability-based RPC with Promise Pipelining.
"""

from __future__ import annotations

__version__ = "0.1.0"

from .errors import (
    ErrorCode,
    CapnwebError,
    ConnectionError,
    RpcError,
    TimeoutError,
    CapabilityError,
    SerializationError,
    is_error_code,
    create_error,
    wrap_error,
)

__all__ = [
    # Error codes
    "ErrorCode",
    # Error classes
    "CapnwebError",
    "ConnectionError",
    "RpcError",
    "TimeoutError",
    "CapabilityError",
    "SerializationError",
    # Error utilities
    "is_error_code",
    "create_error",
    "wrap_error",
    # Version
    "__version__",
]
