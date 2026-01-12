"""
Type definitions for oauth.do

This module contains all the type definitions used across the oauth.do package.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, TypeAlias


class TokenError(str, Enum):
    """Token polling error types (RFC 8628)."""
    AUTHORIZATION_PENDING = "authorization_pending"
    SLOW_DOWN = "slow_down"
    ACCESS_DENIED = "access_denied"
    EXPIRED_TOKEN = "expired_token"
    UNKNOWN = "unknown"


class AuthErrorCode(str, Enum):
    """Authentication error codes."""
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"
    TOKEN_REVOKED = "TOKEN_REVOKED"
    REFRESH_FAILED = "REFRESH_FAILED"
    STORAGE_ERROR = "STORAGE_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"
    INVALID_GRANT = "INVALID_GRANT"
    ACCESS_DENIED = "ACCESS_DENIED"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    UNKNOWN = "UNKNOWN"


class AuthError(Exception):
    """Authentication error with error code."""

    def __init__(
        self,
        message: str,
        code: AuthErrorCode,
        status: int | None = None,
        cause: Exception | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.status = status
        self.__cause__ = cause


class StorageError(Exception):
    """Exception raised for token storage errors.

    This exception is raised when there are issues with reading, writing,
    or deleting tokens from storage backends (file, keyring, etc.).

    Attributes:
        message: Human-readable error description
        cause: The underlying exception that caused this error
    """

    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.__cause__ = cause


@dataclass
class OAuthConfig:
    """OAuth configuration options."""
    api_url: str = "https://apis.do"
    client_id: str = "client_01JQYTRXK9ZPD8JPJTKDCRB656"
    authkit_domain: str = "login.oauth.do"
    storage_path: str | None = None


@dataclass
class User:
    """User information returned from auth endpoints."""
    id: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    email_verified: bool = False
    created_at: str | None = None


@dataclass
class AuthResult:
    """Authentication result."""
    user: User | None
    token: str | None = None


@dataclass
class DeviceAuthorizationResponse:
    """Device authorization response (RFC 8628)."""
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


@dataclass
class TokenResponse:
    """Token response from authentication endpoint."""
    access_token: str
    token_type: str = "Bearer"
    refresh_token: str | None = None
    expires_in: int | None = None
    user: User | None = None


@dataclass
class StoredTokenData:
    """Stored token data including refresh token and expiration."""
    access_token: str
    refresh_token: str | None = None
    expires_at: int | None = None  # Unix timestamp in milliseconds


# Type aliases
OAuthProvider: TypeAlias = Literal["GitHubOAuth", "GoogleOAuth", "MicrosoftOAuth", "AppleOAuth"]
TokenSource: TypeAlias = Literal["browser", "device", "api_key", "env"]


@dataclass
class DeviceAuthOptions:
    """Options for device authorization."""
    provider: OAuthProvider | None = None
