"""
Authentication functions for oauth.do

This module provides the core authentication functions: auth, logout, get_user.
"""

from __future__ import annotations

import os
import time
from typing import Callable, Awaitable

import httpx

from .config import get_config
from .storage import create_secure_storage, TokenStorage
from .types import (
    AuthError,
    AuthErrorCode,
    AuthResult,
    StoredTokenData,
    TokenResponse,
    User,
)


# Buffer time before expiration to trigger refresh (5 minutes in ms)
REFRESH_BUFFER_MS = 5 * 60 * 1000


def _get_env(key: str) -> str | None:
    """Get environment variable value."""
    return os.environ.get(key)


def _is_token_expired(expires_at: int | None) -> bool:
    """Check if token is expired or about to expire."""
    if expires_at is None:
        return False  # Can't determine, assume valid
    now_ms = int(time.time() * 1000)
    return now_ms >= expires_at - REFRESH_BUFFER_MS


async def get_user(token: str | None = None) -> AuthResult:
    """
    Get current authenticated user.

    Calls GET /me endpoint with Bearer token authentication.

    Args:
        token: Optional authentication token (uses DO_TOKEN env var if not provided)

    Returns:
        AuthResult with user info or None if not authenticated

    Example::

        from oauth_do import get_user

        result = await get_user()
        if result.user:
            print(f"Logged in as {result.user.email}")
        else:
            print("Not authenticated")
    """
    config = get_config()
    auth_token = token or _get_env("DO_TOKEN") or ""

    if not auth_token:
        return AuthResult(user=None)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{config.api_url}/me",
                headers={
                    "Authorization": f"Bearer {auth_token}",
                    "Content-Type": "application/json",
                },
            )

            if not response.is_success:
                if response.status_code == 401:
                    return AuthResult(user=None)
                raise AuthError(
                    f"Authentication failed: {response.reason_phrase}",
                    AuthErrorCode.NETWORK_ERROR,
                    status=response.status_code,
                )

            data = response.json()

            user = User(
                id=data.get("id", data.get("sub", "")),
                email=data.get("email"),
                name=data.get("name"),
                avatar_url=data.get("picture") or data.get("avatar_url"),
                email_verified=data.get("email_verified", False),
                created_at=data.get("created_at"),
            )

            return AuthResult(user=user, token=auth_token)

    except httpx.RequestError as e:
        print(f"Auth error: {e}")
        return AuthResult(user=None)


async def logout(token: str | None = None) -> None:
    """
    Logout current user.

    Calls POST /logout endpoint and removes stored token.

    Args:
        token: Optional authentication token (uses DO_TOKEN env var if not provided)

    Example::

        from oauth_do import logout

        await logout()
        print("Logged out successfully")
    """
    config = get_config()
    auth_token = token or _get_env("DO_TOKEN") or ""

    if not auth_token:
        return

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{config.api_url}/logout",
                headers={
                    "Authorization": f"Bearer {auth_token}",
                    "Content-Type": "application/json",
                },
            )

            if not response.is_success:
                print(f"Logout warning: {response.reason_phrase}")

    except httpx.RequestError as e:
        print(f"Logout error: {e}")


async def refresh_access_token(refresh_token: str) -> TokenResponse:
    """
    Refresh an access token using a refresh token.

    Args:
        refresh_token: The refresh token from the original auth response

    Returns:
        New token response with fresh access_token

    Raises:
        AuthError: If refresh fails
    """
    config = get_config()

    if not config.client_id:
        raise AuthError(
            "Client ID is required for token refresh",
            AuthErrorCode.REFRESH_FAILED,
        )

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://auth.apis.do/user_management/authenticate",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": config.client_id,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if not response.is_success:
            error_text = response.text
            raise AuthError(
                f"Token refresh failed: {response.status_code} - {error_text}",
                AuthErrorCode.REFRESH_FAILED,
                status=response.status_code,
            )

        data = response.json()
        return TokenResponse(
            access_token=data["access_token"],
            token_type=data.get("token_type", "Bearer"),
            refresh_token=data.get("refresh_token"),
            expires_in=data.get("expires_in"),
        )


async def get_token(storage: TokenStorage | None = None) -> str | None:
    """
    Get token from environment or stored credentials.

    Checks in order:
        1. DO_ADMIN_TOKEN environment variable
        2. DO_TOKEN environment variable
        3. Stored token (with automatic refresh if expired)

    Args:
        storage: Optional token storage (uses default if not provided)

    Returns:
        Access token or None if not available

    Example::

        from oauth_do import get_token

        token = await get_token()
        if token:
            print(f"Token: {token[:20]}...")
        else:
            print("No token available")
    """
    # Check env vars first
    admin_token = _get_env("DO_ADMIN_TOKEN")
    if admin_token:
        return admin_token

    do_token = _get_env("DO_TOKEN")
    if do_token:
        return do_token

    # Try stored token
    try:
        config = get_config()
        if storage is None:
            storage = create_secure_storage(config.storage_path)

        # Get full token data if available
        token_data = await storage.get_token_data()

        if token_data:
            # If token is not expired, return it
            if not _is_token_expired(token_data.expires_at):
                return token_data.access_token

            # Token is expired - try to refresh if we have a refresh token
            if token_data.refresh_token:
                try:
                    new_tokens = await refresh_access_token(token_data.refresh_token)

                    # Calculate new expiration time
                    expires_at = None
                    if new_tokens.expires_in:
                        expires_at = int(time.time() * 1000) + new_tokens.expires_in * 1000

                    # Store new token data
                    new_data = StoredTokenData(
                        access_token=new_tokens.access_token,
                        refresh_token=new_tokens.refresh_token or token_data.refresh_token,
                        expires_at=expires_at,
                    )
                    await storage.set_token_data(new_data)

                    return new_tokens.access_token
                except Exception:
                    # Refresh failed - return None (caller should re-authenticate)
                    return None

            # Expired but no refresh token - return None
            return None

        # Fall back to simple token storage (no expiration tracking)
        return await storage.get_token()

    except Exception:
        # Storage not available - return None
        return None


async def is_authenticated(token: str | None = None) -> bool:
    """
    Check if user is authenticated (has valid token).

    Args:
        token: Optional token to check (uses stored token if not provided)

    Returns:
        True if authenticated, False otherwise
    """
    if token:
        result = await get_user(token)
        return result.user is not None

    # Check stored token
    stored_token = await get_token()
    if not stored_token:
        return False

    result = await get_user(stored_token)
    return result.user is not None


async def get_stored_token_data(storage: TokenStorage | None = None) -> StoredTokenData | None:
    """
    Get stored token data from storage.

    Args:
        storage: Optional token storage (uses default if not provided)

    Returns:
        Stored token data or None if not available
    """
    try:
        config = get_config()
        if storage is None:
            storage = create_secure_storage(config.storage_path)
        return await storage.get_token_data()
    except Exception:
        return None


async def store_token_data(data: StoredTokenData, storage: TokenStorage | None = None) -> None:
    """
    Store token data including refresh token.

    Args:
        data: Token data to store
        storage: Optional token storage (uses default if not provided)

    Raises:
        RuntimeError: If storage fails
    """
    try:
        config = get_config()
        if storage is None:
            storage = create_secure_storage(config.storage_path)
        await storage.set_token_data(data)
    except Exception as e:
        print(f"Failed to store token data: {e}")
        raise


# Type alias for auth provider function
AuthProvider = Callable[[], str | None | Awaitable[str | None]]


def auth() -> AuthProvider:
    """
    Create an auth provider function for HTTP clients.

    Returns a function that resolves to a token string.

    Returns:
        Auth provider function

    Example::

        from oauth_do import auth

        get_auth = auth()
        token = await get_auth()
    """
    async def _get_token() -> str | None:
        return await get_token()
    return _get_token
