"""
oauth.do - OAuth authentication for DotDo CLI and SDK

This package provides local CLI authentication with secure token storage.

Example:
    Basic usage::

        from oauth_do import ensure_logged_in, get_token, is_authenticated, logout, whoami

        # Check if logged in, prompt if not
        token = await ensure_logged_in()

        # Get token without prompting (raises if not logged in)
        token = await get_token()

        # Check auth status
        if await is_authenticated():
            print("Already logged in")

        # Get current user info
        user = await whoami()
        print(f"Logged in as {user.email if user else 'unknown'}")

        # Logout and clear stored tokens
        await logout()

Environment Variables:
    DOTDO_TOKEN: Direct token override
    DOTDO_API_KEY: API key authentication
    DOTDO_CONFIG_DIR: Custom config directory

Storage Locations:
    - macOS: Keychain via keyring
    - Linux: libsecret via keyring
    - Windows: Credential Manager via keyring
    - Fallback: ~/.config/dotdo/credentials.json
"""

from __future__ import annotations

import json
import os
import secrets
import hashlib
import base64
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Callable, Literal, TypeAlias

import httpx

# Try to import keyring for secure storage
try:
    import keyring
    KEYRING_AVAILABLE = True
except ImportError:
    KEYRING_AVAILABLE = False


__version__ = "0.1.0"
__all__ = [
    # Core auth functions
    "ensure_logged_in",
    "get_token",
    "is_authenticated",
    "logout",
    "whoami",
    # Convenience functions
    "login",
    "login_with_browser",
    "login_with_device_code",
    "get_auth_header",
    "get_storage_info",
    # Storage
    "TokenStorage",
    "get_storage",
    "store_token",
    "delete_token",
    "has_token",
    "get_config_dir",
    "get_credentials_path",
    "get_env_token",
    # OAuth flows
    "browser_flow",
    "device_flow",
    "refresh_token",
    "revoke_token",
    "is_headless",
    "can_use_browser_flow",
    # Types
    "Token",
    "StoredCredential",
    "User",
    "Workspace",
    "AuthOptions",
    "StorageOptions",
    "DeviceAuthorizationResponse",
    "AuthError",
    "AuthErrorCode",
    "OAUTH_DEFAULTS",
    "ENV_VARS",
]


# ============================================================================
# Constants
# ============================================================================

class OAUTH_DEFAULTS:
    """Default OAuth configuration."""
    AUTH_SERVER = "https://oauth.do"
    CLIENT_ID = "dotdo-cli"
    SCOPES = ["openid", "profile", "email", "offline_access"]
    CALLBACK_PORT = 8787
    TIMEOUT = 300  # 5 minutes in seconds
    SERVICE_NAME = "oauth.do"
    ACCOUNT_NAME = "default"


class ENV_VARS:
    """Environment variable names."""
    TOKEN = "DOTDO_TOKEN"
    API_KEY = "DOTDO_API_KEY"
    CONFIG_DIR = "DOTDO_CONFIG_DIR"
    NO_KEYCHAIN = "DOTDO_NO_KEYCHAIN"
    AUTH_SERVER = "DOTDO_AUTH_SERVER"


# ============================================================================
# Types
# ============================================================================

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


@dataclass
class Token:
    """OAuth access token with metadata."""
    access_token: str
    token_type: str = "Bearer"
    expires_at: int | None = None
    refresh_token: str | None = None
    scopes: list[str] = field(default_factory=list)
    token_id: str | None = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "access_token": self.access_token,
            "token_type": self.token_type,
            "expires_at": self.expires_at,
            "refresh_token": self.refresh_token,
            "scopes": self.scopes,
            "token_id": self.token_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Token":
        """Create from dictionary."""
        return cls(
            access_token=data["access_token"],
            token_type=data.get("token_type", "Bearer"),
            expires_at=data.get("expires_at"),
            refresh_token=data.get("refresh_token"),
            scopes=data.get("scopes", []),
            token_id=data.get("token_id"),
        )


TokenSource: TypeAlias = Literal["browser", "device", "api_key", "env"]


@dataclass
class StoredCredential:
    """Stored credential format."""
    token: Token
    stored_at: int
    source: TokenSource
    user_id: str | None = None
    workspace_id: str | None = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "token": self.token.to_dict(),
            "stored_at": self.stored_at,
            "source": self.source,
            "user_id": self.user_id,
            "workspace_id": self.workspace_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "StoredCredential":
        """Create from dictionary."""
        return cls(
            token=Token.from_dict(data["token"]),
            stored_at=data["stored_at"],
            source=data["source"],
            user_id=data.get("user_id"),
            workspace_id=data.get("workspace_id"),
        )


@dataclass
class Workspace:
    """Workspace/organization information."""
    id: str
    name: str
    slug: str
    role: Literal["owner", "admin", "member", "viewer"]


@dataclass
class User:
    """Authenticated user information."""
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
    email_verified: bool = False
    created_at: str | None = None
    workspace: Workspace | None = None


@dataclass
class AuthOptions:
    """Options for authentication operations."""
    client_id: str | None = None
    scopes: list[str] | None = None
    auth_server: str | None = None
    force: bool = False
    flow: Literal["browser", "device", "auto"] | None = None
    callback_port: int | None = None
    timeout: int | None = None
    interactive: bool = False
    state: str | None = None


@dataclass
class StorageOptions:
    """Options for token storage."""
    service_name: str | None = None
    account_name: str | None = None
    config_dir: str | None = None
    disable_keychain: bool = False


@dataclass
class DeviceAuthorizationResponse:
    """Device authorization response."""
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str | None
    expires_in: int
    interval: int


# ============================================================================
# Storage
# ============================================================================

def get_config_dir(options: StorageOptions | None = None) -> Path:
    """Get the configuration directory path."""
    # Check environment variable first
    env_dir = os.environ.get(ENV_VARS.CONFIG_DIR)
    if env_dir:
        return Path(env_dir)

    # Use provided option
    if options and options.config_dir:
        return Path(options.config_dir)

    # Default: ~/.config/dotdo on Unix, %APPDATA%/dotdo on Windows
    import platform
    if platform.system() == "Windows":
        app_data = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        return Path(app_data) / "dotdo"

    # XDG Base Directory specification
    xdg_config = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    return Path(xdg_config) / "dotdo"


def get_credentials_path(options: StorageOptions | None = None) -> Path:
    """Get the credentials file path."""
    return get_config_dir(options) / "credentials.json"


def get_env_token() -> Token | None:
    """Check for token in environment variables."""
    # Direct token override
    env_token = os.environ.get(ENV_VARS.TOKEN)
    if env_token:
        return Token(access_token=env_token)

    # API key authentication
    api_key = os.environ.get(ENV_VARS.API_KEY)
    if api_key:
        return Token(access_token=api_key)

    return None


def _is_keychain_disabled(options: StorageOptions | None = None) -> bool:
    """Check if keychain is disabled."""
    if options and options.disable_keychain:
        return True
    env_disable = os.environ.get(ENV_VARS.NO_KEYCHAIN)
    return env_disable in ("1", "true")


class TokenStorage:
    """Token storage manager with keychain and file fallback."""

    def __init__(self, options: StorageOptions | None = None):
        self.options = options or StorageOptions()
        self._service_name = self.options.service_name or OAUTH_DEFAULTS.SERVICE_NAME
        self._account_name = self.options.account_name or OAUTH_DEFAULTS.ACCOUNT_NAME

    async def store(self, token: Token, source: TokenSource = "browser") -> None:
        """Store a token."""
        import time
        credential = StoredCredential(
            token=token,
            stored_at=int(time.time() * 1000),
            source=source,
        )

        # Try keychain first
        stored_in_keychain = await self._store_in_keychain(credential)

        # Store in file as backup if keychain unavailable
        if not stored_in_keychain:
            self._store_in_file(credential)

    async def get(self) -> Token | None:
        """Get stored token (checks env, keychain, then file)."""
        # Check environment first
        env_token = get_env_token()
        if env_token:
            return env_token

        # Try keychain
        keychain_cred = await self._get_from_keychain()
        if keychain_cred:
            return keychain_cred.token

        # Try file fallback
        file_cred = self._get_from_file()
        if file_cred:
            return file_cred.token

        return None

    async def get_credential(self) -> StoredCredential | None:
        """Get full stored credential with metadata."""
        import time
        # Check environment first
        env_token = get_env_token()
        if env_token:
            return StoredCredential(
                token=env_token,
                stored_at=int(time.time() * 1000),
                source="env",
            )

        # Try keychain
        keychain_cred = await self._get_from_keychain()
        if keychain_cred:
            return keychain_cred

        # Try file fallback
        return self._get_from_file()

    async def delete(self) -> None:
        """Delete stored token."""
        await self._delete_from_keychain()
        self._delete_file()

    async def has(self) -> bool:
        """Check if a token is stored."""
        token = await self.get()
        return token is not None

    async def is_expired(self) -> bool:
        """Check if the stored token is expired."""
        import time
        credential = await self.get_credential()
        if not credential:
            return True

        token = credential.token
        if not token.expires_at:
            return False  # No expiry = never expires

        # Consider expired if within 5 minutes of expiry
        buffer_seconds = 300
        return token.expires_at < int(time.time()) + buffer_seconds

    # Keychain operations
    async def _store_in_keychain(self, credential: StoredCredential) -> bool:
        if _is_keychain_disabled(self.options) or not KEYRING_AVAILABLE:
            return False
        try:
            data = json.dumps(credential.to_dict())
            keyring.set_password(self._service_name, self._account_name, data)
            return True
        except Exception:
            return False

    async def _get_from_keychain(self) -> StoredCredential | None:
        if _is_keychain_disabled(self.options) or not KEYRING_AVAILABLE:
            return None
        try:
            data = keyring.get_password(self._service_name, self._account_name)
            if not data:
                return None
            return StoredCredential.from_dict(json.loads(data))
        except Exception:
            return None

    async def _delete_from_keychain(self) -> bool:
        if _is_keychain_disabled(self.options) or not KEYRING_AVAILABLE:
            return False
        try:
            keyring.delete_password(self._service_name, self._account_name)
            return True
        except Exception:
            return False

    # File operations (fallback)
    def _store_in_file(self, credential: StoredCredential) -> None:
        config_dir = get_config_dir(self.options)
        config_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

        file_path = get_credentials_path(self.options)
        data = json.dumps(credential.to_dict())
        file_path.write_text(data)
        file_path.chmod(0o600)

    def _get_from_file(self) -> StoredCredential | None:
        file_path = get_credentials_path(self.options)
        if not file_path.exists():
            return None
        try:
            data = file_path.read_text()
            return StoredCredential.from_dict(json.loads(data))
        except Exception:
            return None

    def _delete_file(self) -> bool:
        file_path = get_credentials_path(self.options)
        if not file_path.exists():
            return False
        try:
            file_path.unlink()
            return True
        except Exception:
            return False


# Default storage instance
_default_storage: TokenStorage | None = None


def get_storage(options: StorageOptions | None = None) -> TokenStorage:
    """Get the default token storage instance."""
    global _default_storage
    if _default_storage is None or options:
        _default_storage = TokenStorage(options)
    return _default_storage


async def store_token(token: Token, source: TokenSource = "browser") -> None:
    """Store a token using default storage."""
    await get_storage().store(token, source)


async def delete_token() -> None:
    """Delete stored token using default storage."""
    await get_storage().delete()


async def has_token() -> bool:
    """Check if token is stored using default storage."""
    return await get_storage().has()


# ============================================================================
# Environment Detection
# ============================================================================

def is_headless() -> bool:
    """Check if we're in a headless environment."""
    # Check for common headless indicators
    if os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_TTY"):
        return True

    # Check for CI environments
    ci_vars = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "JENKINS_URL"]
    if any(os.environ.get(v) for v in ci_vars):
        return True

    # Check for container environments
    if os.environ.get("KUBERNETES_SERVICE_HOST") or os.environ.get("container"):
        return True

    # Check if DISPLAY is missing (Linux)
    import platform
    if platform.system() == "Linux":
        if not os.environ.get("DISPLAY") and not os.environ.get("WAYLAND_DISPLAY"):
            return True

    return False


def can_use_browser_flow() -> bool:
    """Check if browser flow is available."""
    if is_headless():
        return False

    import platform
    system = platform.system()

    if system in ("Darwin", "Windows"):
        return True

    if system == "Linux":
        return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))

    return False


# ============================================================================
# OAuth Flows (Stubs - to be implemented)
# ============================================================================

async def browser_flow(options: AuthOptions | None = None) -> Token:
    """
    Run the browser-based OAuth flow.

    Opens browser to authorization URL, starts local callback server,
    and exchanges authorization code for tokens.

    Args:
        options: Authentication options

    Returns:
        Token on successful authentication

    Raises:
        AuthError: If authentication fails
    """
    # TODO: Implement browser flow with PKCE
    # 1. Generate PKCE code_verifier and code_challenge
    # 2. Build authorization URL with parameters
    # 3. Start local HTTP server on callback_port
    # 4. Open browser to authorization URL
    # 5. Wait for callback with authorization code
    # 6. Exchange code for tokens
    raise NotImplementedError("Browser flow not yet implemented in Python SDK")


async def device_flow(
    options: AuthOptions | None = None,
    on_user_code: Callable[[str, str, str | None], None] | None = None,
    on_poll: Callable[[int], None] | None = None,
) -> Token:
    """
    Run the device code OAuth flow.

    Suitable for headless servers, SSH sessions, and CI/CD environments.

    Args:
        options: Authentication options
        on_user_code: Callback when user code is ready (code, uri, uri_complete)
        on_poll: Callback when polling for token (attempt number)

    Returns:
        Token on successful authentication

    Raises:
        AuthError: If authentication fails
    """
    # TODO: Implement device code flow (RFC 8628)
    # 1. Request device authorization
    # 2. Display/callback user code and verification URL
    # 3. Poll for token until user authorizes
    raise NotImplementedError("Device flow not yet implemented in Python SDK")


async def refresh_token(token: Token, options: AuthOptions | None = None) -> Token:
    """
    Refresh an access token using a refresh token.

    Args:
        token: Token with refresh_token
        options: Authentication options

    Returns:
        New token with refreshed access_token

    Raises:
        AuthError: If refresh fails
    """
    if not token.refresh_token:
        raise AuthError("No refresh token available", AuthErrorCode.REFRESH_FAILED)

    opts = options or AuthOptions()
    auth_server = opts.auth_server or OAUTH_DEFAULTS.AUTH_SERVER
    client_id = opts.client_id or OAUTH_DEFAULTS.CLIENT_ID
    token_url = f"{auth_server}/token"

    async with httpx.AsyncClient() as client:
        response = await client.post(
            token_url,
            data={
                "grant_type": "refresh_token",
                "refresh_token": token.refresh_token,
                "client_id": client_id,
            },
        )

        if not response.is_success:
            error = response.json() if response.content else {}
            raise AuthError(
                f"Token refresh failed: {error.get('error_description', error.get('error', response.reason_phrase))}",
                AuthErrorCode.REFRESH_FAILED,
                status=response.status_code,
            )

        data = response.json()
        import time
        return Token(
            access_token=data["access_token"],
            token_type=data.get("token_type", "Bearer"),
            expires_at=int(time.time()) + data["expires_in"] if data.get("expires_in") else None,
            refresh_token=data.get("refresh_token", token.refresh_token),
            scopes=data.get("scope", "").split() if data.get("scope") else token.scopes,
        )


async def revoke_token(token: Token, options: AuthOptions | None = None) -> None:
    """
    Revoke a token (logout).

    Args:
        token: Token to revoke
        options: Authentication options
    """
    opts = options or AuthOptions()
    auth_server = opts.auth_server or OAUTH_DEFAULTS.AUTH_SERVER
    client_id = opts.client_id or OAUTH_DEFAULTS.CLIENT_ID
    revoke_url = f"{auth_server}/revoke"

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                revoke_url,
                data={
                    "token": token.access_token,
                    "client_id": client_id,
                },
            )
    except Exception:
        # Network errors during revocation are non-fatal
        pass


# ============================================================================
# Core Auth Functions
# ============================================================================

async def ensure_logged_in(options: AuthOptions | None = None) -> Token:
    """
    Ensure the user is logged in.

    If already authenticated, returns the existing token (refreshing if needed).
    If not authenticated, initiates the appropriate login flow.

    Args:
        options: Authentication options

    Returns:
        Valid access token

    Example::

        # Basic usage - will prompt for login if needed
        token = await ensure_logged_in()

        # Force re-authentication
        token = await ensure_logged_in(AuthOptions(force=True))

        # Prefer device flow for CI environments
        token = await ensure_logged_in(AuthOptions(flow="device"))
    """
    opts = options or AuthOptions()
    storage = get_storage()

    # Check for forced re-authentication
    if not opts.force:
        existing_token = await storage.get()
        if existing_token:
            # Check if token needs refresh
            if await storage.is_expired():
                if existing_token.refresh_token:
                    try:
                        new_token = await refresh_token(existing_token, opts)
                        await storage.store(new_token, "browser")
                        return new_token
                    except AuthError:
                        pass  # Continue to login
            else:
                return existing_token

    # Determine which flow to use
    flow = opts.flow or "auto"

    if flow == "browser" or (flow == "auto" and can_use_browser_flow()):
        token = await browser_flow(opts)
        await storage.store(token, "browser")
    else:
        token = await device_flow(opts)
        await storage.store(token, "device")

    return token


async def get_token() -> Token:
    """
    Get the current access token without prompting for login.

    Returns:
        Token if authenticated

    Raises:
        AuthError: With code NOT_AUTHENTICATED if not logged in

    Example::

        try:
            token = await get_token()
            # Use token for API calls
        except AuthError as e:
            if e.code == AuthErrorCode.NOT_AUTHENTICATED:
                print("Please run: dotdo login")
    """
    storage = get_storage()
    token = await storage.get()

    if not token:
        raise AuthError(
            "Not authenticated. Please login first.",
            AuthErrorCode.NOT_AUTHENTICATED,
        )

    return token


async def is_authenticated() -> bool:
    """
    Check if the user is currently authenticated.

    Returns:
        True if authenticated with a valid (or refreshable) token

    Example::

        if await is_authenticated():
            print("Already logged in")
        else:
            print("Please login")
    """
    storage = get_storage()
    token = await storage.get()

    if not token:
        return False

    # Check if token is expired
    import time
    if token.expires_at:
        if token.expires_at < int(time.time()):
            # Expired - but can refresh?
            return token.refresh_token is not None

    return True


async def logout(options: AuthOptions | None = None) -> None:
    """
    Logout and clear all stored tokens.

    Args:
        options: Auth options for token revocation

    Example::

        await logout()
        print("Logged out successfully")
    """
    storage = get_storage()

    # Get current token for revocation
    token = await storage.get()

    # Revoke token on server (best effort)
    if token and not get_env_token():
        await revoke_token(token, options)

    # Clear stored credentials
    await storage.delete()


async def whoami(options: AuthOptions | None = None) -> User | None:
    """
    Get information about the currently authenticated user.

    Args:
        options: Authentication options

    Returns:
        User info if authenticated, None otherwise

    Example::

        user = await whoami()
        if user:
            print(f"Logged in as {user.email}")
        else:
            print("Not logged in")
    """
    storage = get_storage()
    token = await storage.get()

    if not token:
        return None

    opts = options or AuthOptions()
    auth_server = opts.auth_server or OAUTH_DEFAULTS.AUTH_SERVER
    userinfo_url = f"{auth_server}/userinfo"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                userinfo_url,
                headers={"Authorization": f"{token.token_type} {token.access_token}"},
            )

            if not response.is_success:
                if response.status_code == 401:
                    return None
                raise AuthError(
                    f"Failed to fetch user info: {response.reason_phrase}",
                    AuthErrorCode.NETWORK_ERROR,
                    status=response.status_code,
                )

            data = response.json()

            workspace = None
            if data.get("workspace"):
                workspace = Workspace(
                    id=data["workspace"]["id"],
                    name=data["workspace"]["name"],
                    slug=data["workspace"]["slug"],
                    role=data["workspace"]["role"],
                )

            return User(
                id=data["sub"],
                email=data["email"],
                name=data.get("name"),
                avatar_url=data.get("picture"),
                email_verified=data.get("email_verified", False),
                created_at=data.get("created_at"),
                workspace=workspace,
            )
    except httpx.RequestError as e:
        raise AuthError(
            "Failed to fetch user info",
            AuthErrorCode.NETWORK_ERROR,
            cause=e,
        ) from e


# ============================================================================
# Convenience Functions
# ============================================================================

async def login(options: AuthOptions | None = None) -> Token:
    """Login with force=True."""
    opts = options or AuthOptions()
    opts.force = True
    return await ensure_logged_in(opts)


async def login_with_browser(options: AuthOptions | None = None) -> Token:
    """Login with browser flow."""
    opts = options or AuthOptions()
    opts.flow = "browser"
    opts.force = True
    return await ensure_logged_in(opts)


async def login_with_device_code(options: AuthOptions | None = None) -> Token:
    """Login with device code flow."""
    opts = options or AuthOptions()
    opts.flow = "device"
    opts.force = True
    return await ensure_logged_in(opts)


async def get_auth_header() -> str | None:
    """
    Get the authorization header for API requests.

    Returns:
        Authorization header value or None if not authenticated

    Example::

        auth = await get_auth_header()
        if auth:
            httpx.get(url, headers={"Authorization": auth})
    """
    try:
        token = await get_token()
        return f"{token.token_type} {token.access_token}"
    except AuthError:
        return None


async def get_storage_info() -> dict:
    """Get storage information."""
    storage = get_storage()
    credential = await storage.get_credential()

    # Determine storage location
    if get_env_token():
        location = "env"
    elif KEYRING_AVAILABLE and not _is_keychain_disabled():
        location = "keychain"
    elif get_credentials_path().exists():
        location = "file"
    else:
        location = "none"

    return {
        "is_authenticated": credential is not None,
        "token_source": location,
        "token_path": str(get_credentials_path()) if location == "file" else None,
        "keychain_available": KEYRING_AVAILABLE,
        "expires_at": datetime.fromtimestamp(credential.token.expires_at) if credential and credential.token.expires_at else None,
        "scopes": credential.token.scopes if credential else None,
    }
