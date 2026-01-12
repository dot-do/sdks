"""
oauth.do - OAuth authentication for DotDo CLI and SDK

This package provides local CLI authentication with secure token storage
using OAuth 2.0 Device Authorization Grant (RFC 8628).

Example:
    Basic usage::

        from oauth_do import get_token, get_user, logout

        # Get current token
        token = await get_token()

        # Get current user info
        result = await get_user(token)
        if result.user:
            print(f"Logged in as {result.user.email}")

        # Logout and clear stored tokens
        await logout(token)

CLI Usage:
    $ oauth-do login     # Login using device authorization flow
    $ oauth-do logout    # Logout and remove stored credentials
    $ oauth-do whoami    # Show current authenticated user
    $ oauth-do token     # Display current authentication token
    $ oauth-do status    # Show authentication and storage status

Environment Variables:
    OAUTH_API_URL: API base URL (default: https://apis.do)
    OAUTH_CLIENT_ID: OAuth client ID
    OAUTH_AUTHKIT_DOMAIN: AuthKit domain (default: login.oauth.do)
    OAUTH_STORAGE_PATH: Custom path for token storage
    DO_TOKEN: Direct token override
    DO_ADMIN_TOKEN: Admin token override
    DEBUG: Enable debug output

Storage Locations:
    Default: ~/.oauth.do/token (with 0600 permissions)
    Optional: Keyring (macOS Keychain, Windows Credential Manager, Linux libsecret)
"""

from __future__ import annotations

__version__ = "0.1.0"

# Types
from .types import (
    AuthError,
    AuthErrorCode,
    AuthResult,
    DeviceAuthorizationResponse,
    DeviceAuthOptions,
    OAuthConfig,
    OAuthProvider,
    StorageError,
    StoredTokenData,
    TokenError,
    TokenResponse,
    TokenSource,
    User,
)

# Configuration
from .config import (
    configure,
    configure_from_env,
    get_config,
)

# Storage
from .storage import (
    create_secure_storage,
    create_keyring_storage_if_available,
    FileStorage,
    KeyringStorage,
    MemoryStorage,
    TokenStorage,
    KEYRING_AVAILABLE,
)

# Device flow
from .device import (
    authorize_device,
    poll_for_tokens,
)

# Auth functions
from .auth import (
    auth,
    get_stored_token_data,
    get_token,
    get_user,
    is_authenticated,
    logout,
    refresh_access_token,
    store_token_data,
    AuthProvider,
)

# Authenticated RPC support (integrates with platform-do and rpc-do)
from .rpc import (
    # Platform-do based (managed connections)
    AuthenticatedRpcClient,
    AuthenticatedRpcOptions,
    connect_authenticated,
    create_auth_factory,
    create_authenticated_client,
    # Direct rpc-do access
    DirectRpcOptions,
    AuthenticatedRpcSession,
    create_direct_rpc_client,
    create_authenticated_rpc_session,
)

__all__ = [
    # Version
    "__version__",
    # Types
    "AuthError",
    "AuthErrorCode",
    "AuthResult",
    "DeviceAuthorizationResponse",
    "DeviceAuthOptions",
    "OAuthConfig",
    "OAuthProvider",
    "StorageError",
    "StoredTokenData",
    "TokenError",
    "TokenResponse",
    "TokenSource",
    "User",
    # Configuration
    "configure",
    "configure_from_env",
    "get_config",
    # Storage
    "create_secure_storage",
    "create_keyring_storage_if_available",
    "FileStorage",
    "KeyringStorage",
    "MemoryStorage",
    "TokenStorage",
    "KEYRING_AVAILABLE",
    # Device flow
    "authorize_device",
    "poll_for_tokens",
    # Auth functions
    "auth",
    "get_stored_token_data",
    "get_token",
    "get_user",
    "is_authenticated",
    "logout",
    "refresh_access_token",
    "store_token_data",
    "AuthProvider",
    # Authenticated RPC (platform-do based)
    "AuthenticatedRpcClient",
    "AuthenticatedRpcOptions",
    "connect_authenticated",
    "create_auth_factory",
    "create_authenticated_client",
    # Direct RPC access (rpc-do based)
    "DirectRpcOptions",
    "AuthenticatedRpcSession",
    "create_direct_rpc_client",
    "create_authenticated_rpc_session",
]
