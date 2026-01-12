"""
Secure token storage for oauth.do

This module provides secure token storage with keyring integration
and file fallback for environments where keyring is not available.
"""

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field, ValidationError, field_validator

from .types import StorageError

if TYPE_CHECKING:
    from .types import StoredTokenData

logger = logging.getLogger(__name__)


class TokenDataValidationError(StorageError):
    """Exception raised when token data JSON validation fails.

    This exception is raised when token JSON is malformed, missing
    required fields, or contains invalid field types.

    Attributes:
        message: Human-readable error description
        cause: The underlying exception that caused this error
    """

    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message, cause)


class TokenDataModel(BaseModel):
    """Pydantic model for validating token data JSON.

    Supports both camelCase (accessToken) and snake_case (access_token) field names
    for compatibility with different token sources.

    Extra fields are ignored for forward compatibility with future token formats.
    """

    access_token: str = Field(alias="accessToken")
    token_type: str = Field(default="Bearer", alias="tokenType")
    refresh_token: str | None = Field(default=None, alias="refreshToken")
    expires_at: int | None = Field(default=None, alias="expiresAt")

    model_config = {
        "populate_by_name": True,  # Allow both accessToken and access_token
        "extra": "ignore",  # Ignore extra fields for forward compatibility
    }

    @field_validator("access_token", mode="before")
    @classmethod
    def validate_access_token_not_empty(cls, v: str | None) -> str:
        """Validate that access_token is not empty or whitespace-only."""
        if v is None:
            raise ValueError("access_token is required and cannot be null")
        if not isinstance(v, str):
            raise ValueError("access_token must be a string")
        if not v.strip():
            raise ValueError("access_token cannot be empty or whitespace-only")
        return v


def parse_token_data(data: str) -> "StoredTokenData":
    """Parse and validate token data JSON string.

    This function validates JSON token data against a schema, ensuring:
    - Valid JSON format
    - Required fields are present (accessToken/access_token)
    - Field types are correct
    - access_token is non-empty

    Extra fields are ignored for forward compatibility.

    Args:
        data: JSON string containing token data

    Returns:
        StoredTokenData instance with validated fields

    Raises:
        TokenDataValidationError: If JSON is malformed, missing required fields,
                                  or contains invalid field types

    Example:
        >>> token = parse_token_data('{"accessToken": "abc123"}')
        >>> token.access_token
        'abc123'
    """
    from .types import StoredTokenData

    if not data or not data.strip():
        raise TokenDataValidationError("Invalid token format: empty or whitespace-only JSON")

    try:
        # First try to parse as JSON to give better error messages
        parsed = json.loads(data)
    except json.JSONDecodeError as e:
        raise TokenDataValidationError(f"Invalid JSON format: {e}") from e

    # Ensure it's a dict/object
    if not isinstance(parsed, dict):
        raise TokenDataValidationError(
            f"Invalid token format: expected JSON object, got {type(parsed).__name__}"
        )

    try:
        validated = TokenDataModel.model_validate(parsed)
    except ValidationError as e:
        # Extract the first error message for a cleaner error
        errors = e.errors()
        if errors:
            first_error = errors[0]
            field = ".".join(str(loc) for loc in first_error.get("loc", []))
            msg = first_error.get("msg", "validation error")
            raise TokenDataValidationError(
                f"Invalid token format: {field} - {msg}"
            ) from e
        raise TokenDataValidationError(f"Invalid token format: {e}") from e

    return StoredTokenData(
        access_token=validated.access_token,
        refresh_token=validated.refresh_token,
        expires_at=validated.expires_at,
    )


# Keychain service and account identifiers
KEYCHAIN_SERVICE = "oauth.do"
KEYCHAIN_ACCOUNT = "access_token"

# Try to import keyring
try:
    import keyring
    KEYRING_AVAILABLE = True
except ImportError:
    keyring = None  # type: ignore
    KEYRING_AVAILABLE = False


def _get_env(key: str) -> str | None:
    """Get environment variable value."""
    return os.environ.get(key)


def _is_debug() -> bool:
    """Check if debug mode is enabled."""
    return bool(_get_env("DEBUG"))


class TokenStorage(ABC):
    """Abstract base class for token storage."""

    @abstractmethod
    async def get_token(self) -> str | None:
        """Get the stored access token."""
        ...

    @abstractmethod
    async def set_token(self, token: str) -> None:
        """Store an access token."""
        ...

    @abstractmethod
    async def remove_token(self) -> None:
        """Remove the stored token."""
        ...

    async def get_token_data(self) -> "StoredTokenData | None":
        """Get full token data including refresh token and expiration."""
        token = await self.get_token()
        if token:
            from .types import StoredTokenData
            return StoredTokenData(access_token=token)
        return None

    async def set_token_data(self, data: "StoredTokenData") -> None:
        """Store full token data."""
        await self.set_token(data.access_token)


class KeyringStorage(TokenStorage):
    """
    Keyring-based token storage using OS credential manager.

    Uses:
        - macOS: Keychain
        - Windows: Credential Manager
        - Linux: Secret Service (libsecret)

    This is the most secure option for CLI token storage.
    """

    def __init__(self) -> None:
        self._initialized = False
        self._available: bool | None = None

    async def is_available(self) -> bool:
        """Check if keyring storage is available on this system."""
        if self._available is not None:
            return self._available

        if not KEYRING_AVAILABLE or keyring is None:
            self._available = False
            return False

        try:
            # Try a read operation to verify keyring access
            keyring.get_password(KEYCHAIN_SERVICE, "__test__")
            self._available = True
            return True
        except Exception as e:
            # This is expected during availability check - keyring may not be
            # configured or accessible in this environment
            logger.debug("Keyring not available: %s", e)
            self._available = False
            return False

    async def get_token(self) -> str | None:
        """Get token from keyring."""
        if not KEYRING_AVAILABLE or keyring is None:
            return None

        try:
            data = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            if not data:
                return None

            # Check if it's JSON (new format) or plain token
            if data.strip().startswith("{"):
                token_data = json.loads(data)
                return token_data.get("accessToken") or token_data.get("access_token")
            return data.strip()
        except KeyError:
            # Credential doesn't exist yet, this is expected
            return None
        except PermissionError as e:
            raise StorageError(
                f"Permission denied accessing keyring token storage: {e}", cause=e
            ) from e
        except Exception as e:
            logger.warning("Unexpected error reading token from keyring: %s", e)
            raise StorageError(f"Failed to read token from keyring: {e}", cause=e) from e

    async def set_token(self, token: str) -> None:
        """Store token in keyring."""
        if not KEYRING_AVAILABLE or keyring is None:
            raise StorageError("Keyring storage not available")

        try:
            keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, token.strip())
        except PermissionError as e:
            raise StorageError(
                f"Permission denied saving token to keyring: {e}", cause=e
            ) from e
        except Exception as e:
            raise StorageError(f"Failed to save token to keyring: {e}", cause=e) from e

    async def remove_token(self) -> None:
        """Remove token from keyring."""
        if not KEYRING_AVAILABLE or keyring is None:
            return

        try:
            keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        except KeyError:
            # Credential doesn't exist, this is expected
            pass
        except Exception as e:
            # Check if this is a "not found" type error from keyring backends
            # Different backends raise different exceptions for missing credentials
            error_msg = str(e).lower()
            if "not found" in error_msg or "no password" in error_msg:
                # Credential doesn't exist, this is expected
                pass
            else:
                logger.warning("Error removing token from keyring: %s", e)
                # Don't raise on remove - it's a best-effort operation

    async def get_token_data(self) -> "StoredTokenData | None":
        """Get full token data from keyring."""
        if not KEYRING_AVAILABLE or keyring is None:
            return None

        try:
            data = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            if not data:
                return None

            from .types import StoredTokenData

            # Check if it's JSON format
            if data.strip().startswith("{"):
                token_data = json.loads(data)
                return StoredTokenData(
                    access_token=token_data.get("accessToken") or token_data.get("access_token", ""),
                    refresh_token=token_data.get("refreshToken") or token_data.get("refresh_token"),
                    expires_at=token_data.get("expiresAt") or token_data.get("expires_at"),
                )
            # Legacy plain text format
            return StoredTokenData(access_token=data.strip())
        except KeyError:
            # Credential doesn't exist yet, this is expected
            return None
        except PermissionError as e:
            raise StorageError(
                f"Permission denied accessing keyring token storage: {e}", cause=e
            ) from e
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON in keyring token data: %s", e)
            return None
        except Exception as e:
            logger.warning("Unexpected error reading token data from keyring: %s", e)
            raise StorageError(
                f"Failed to read token data from keyring: {e}", cause=e
            ) from e

    async def set_token_data(self, data: "StoredTokenData") -> None:
        """Store full token data in keyring."""
        if not KEYRING_AVAILABLE or keyring is None:
            raise StorageError("Keyring storage not available")

        try:
            json_data = json.dumps({
                "accessToken": data.access_token,
                "refreshToken": data.refresh_token,
                "expiresAt": data.expires_at,
            })
            keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, json_data)
        except PermissionError as e:
            raise StorageError(
                f"Permission denied saving token data to keyring: {e}", cause=e
            ) from e
        except Exception as e:
            raise StorageError(f"Failed to save token data to keyring: {e}", cause=e) from e


class FileStorage(TokenStorage):
    """
    Secure file-based token storage.

    Stores token in ~/.oauth.do/token with restricted permissions (0600).
    This is the fallback when keyring is not available.
    """

    def __init__(self, custom_path: str | None = None) -> None:
        self._custom_path = custom_path
        self._token_path: Path | None = None
        self._config_dir: Path | None = None
        self._initialized = False

    def _init_paths(self) -> bool:
        """Initialize storage paths."""
        if self._initialized:
            return self._token_path is not None

        self._initialized = True

        try:
            home = Path.home()

            if self._custom_path:
                # Expand ~ in custom path
                if self._custom_path.startswith("~/"):
                    expanded = home / self._custom_path[2:]
                else:
                    expanded = Path(self._custom_path)
                self._token_path = expanded
                self._config_dir = expanded.parent
            else:
                # Default path
                self._config_dir = home / ".oauth.do"
                self._token_path = self._config_dir / "token"
            return True
        except RuntimeError as e:
            # Path.home() can raise RuntimeError if home directory can't be determined
            logger.warning("Could not determine home directory: %s", e)
            return False
        except Exception as e:
            logger.warning("Error initializing storage paths: %s", e)
            return False

    async def get_token(self) -> str | None:
        """Get token from file."""
        # Try to get from token data first
        data = await self.get_token_data()
        if data:
            return data.access_token

        # Fall back to legacy plain text format
        if not self._init_paths() or self._token_path is None:
            return None

        try:
            if not self._token_path.exists():
                return None

            # Check file permissions
            mode = self._token_path.stat().st_mode & 0o777
            if mode != 0o600:
                logger.debug(
                    "Token file has insecure permissions (%s). "
                    "Expected 0600. Run: chmod 600 %s",
                    oct(mode),
                    self._token_path,
                )

            content = self._token_path.read_text().strip()

            # Check if it's JSON (new format) or plain token (legacy)
            if content.startswith("{"):
                parsed = json.loads(content)
                return parsed.get("accessToken") or parsed.get("access_token")
            return content
        except FileNotFoundError:
            # Credential doesn't exist yet, this is expected
            return None
        except PermissionError as e:
            raise StorageError(
                f"Permission denied accessing token file {self._token_path}: {e}", cause=e
            ) from e
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON in token file %s: %s", self._token_path, e)
            return None
        except OSError as e:
            logger.warning("Unexpected error reading token file: %s", e)
            raise StorageError(f"Failed to read token file: {e}", cause=e) from e

    async def set_token(self, token: str) -> None:
        """Store token in file."""
        from .types import StoredTokenData
        await self.set_token_data(StoredTokenData(access_token=token.strip()))

    async def remove_token(self) -> None:
        """Remove token file."""
        if not self._init_paths() or self._token_path is None:
            return

        try:
            if self._token_path.exists():
                self._token_path.unlink()
        except FileNotFoundError:
            # File was already removed, this is expected
            pass
        except PermissionError as e:
            raise StorageError(
                f"Permission denied removing token file {self._token_path}: {e}", cause=e
            ) from e
        except OSError as e:
            logger.warning("Error removing token file: %s", e)
            # Don't raise on remove - it's a best-effort operation

    async def get_token_data(self) -> "StoredTokenData | None":
        """Get full token data from file."""
        if not self._init_paths() or self._token_path is None:
            return None

        try:
            if not self._token_path.exists():
                return None

            content = self._token_path.read_text().strip()

            from .types import StoredTokenData

            # Check if it's JSON format
            if content.startswith("{"):
                parsed = json.loads(content)
                return StoredTokenData(
                    access_token=parsed.get("accessToken") or parsed.get("access_token", ""),
                    refresh_token=parsed.get("refreshToken") or parsed.get("refresh_token"),
                    expires_at=parsed.get("expiresAt") or parsed.get("expires_at"),
                )
            # Legacy plain text format
            return StoredTokenData(access_token=content)
        except FileNotFoundError:
            # Credential doesn't exist yet, this is expected
            return None
        except PermissionError as e:
            raise StorageError(
                f"Permission denied accessing token file {self._token_path}: {e}", cause=e
            ) from e
        except json.JSONDecodeError as e:
            logger.warning("Invalid JSON in token file %s: %s", self._token_path, e)
            return None
        except OSError as e:
            logger.warning("Unexpected error reading token data from file: %s", e)
            raise StorageError(f"Failed to read token data from file: {e}", cause=e) from e

    async def set_token_data(self, data: "StoredTokenData") -> None:
        """Store full token data in file."""
        if not self._init_paths() or self._token_path is None or self._config_dir is None:
            raise StorageError("File storage not available - could not initialize paths")

        try:
            # Create directory with secure permissions
            self._config_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

            # Write token data as JSON
            json_data = json.dumps({
                "accessToken": data.access_token,
                "refreshToken": data.refresh_token,
                "expiresAt": data.expires_at,
            })

            # Write with secure permissions
            self._token_path.write_text(json_data)
            self._token_path.chmod(0o600)
        except PermissionError as e:
            raise StorageError(
                f"Permission denied writing token file {self._token_path}: {e}", cause=e
            ) from e
        except OSError as e:
            raise StorageError(f"Failed to save token data: {e}", cause=e) from e

    async def get_storage_info(self) -> dict:
        """Get information about the storage backend."""
        self._init_paths()
        return {
            "type": "file",
            "secure": True,
            "path": str(self._token_path) if self._token_path else None,
        }


class MemoryStorage(TokenStorage):
    """In-memory token storage (for testing)."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._token_data: "StoredTokenData | None" = None

    async def get_token(self) -> str | None:
        if self._token_data:
            return self._token_data.access_token
        return self._token

    async def set_token(self, token: str) -> None:
        self._token = token
        self._token_data = None

    async def remove_token(self) -> None:
        self._token = None
        self._token_data = None

    async def get_token_data(self) -> "StoredTokenData | None":
        return self._token_data

    async def set_token_data(self, data: "StoredTokenData") -> None:
        self._token_data = data
        self._token = data.access_token


def create_secure_storage(storage_path: str | None = None) -> TokenStorage:
    """
    Create the default secure token storage.

    Priority:
        1. File storage (~/.oauth.do/token with 0600 permissions)

    We use file storage by default because keyring on macOS requires
    GUI authorization popups, which breaks automation and agent workflows.

    Args:
        storage_path: Optional custom path for token storage

    Returns:
        TokenStorage instance
    """
    return FileStorage(storage_path)


async def create_keyring_storage_if_available() -> TokenStorage:
    """
    Try to create keyring storage, fall back to file storage.

    Returns:
        KeyringStorage if available, otherwise FileStorage
    """
    keyring_storage = KeyringStorage()
    if await keyring_storage.is_available():
        return keyring_storage
    return FileStorage()
