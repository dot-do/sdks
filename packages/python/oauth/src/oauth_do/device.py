"""
Device Authorization Flow for oauth.do

Implements OAuth 2.0 Device Authorization Grant (RFC 8628) for CLI authentication.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import httpx

from .config import get_config
from .types import (
    AuthError,
    AuthErrorCode,
    DeviceAuthorizationResponse,
    TokenError,
    TokenResponse,
)

if TYPE_CHECKING:
    from .types import DeviceAuthOptions, OAuthProvider


# Device authorization endpoint
DEVICE_AUTH_URL = "https://auth.apis.do/user_management/authorize/device"
# Token endpoint
TOKEN_URL = "https://auth.apis.do/user_management/authenticate"


async def authorize_device(
    options: "DeviceAuthOptions | None" = None,
    provider: "OAuthProvider | None" = None,
) -> DeviceAuthorizationResponse:
    """
    Initiate device authorization flow (RFC 8628).

    Makes a POST request to the device authorization endpoint to get
    a device code and user code for authentication.

    Args:
        options: Device authorization options
        provider: OAuth provider for direct login (bypasses AuthKit login screen)

    Returns:
        Device authorization response with codes and URIs

    Raises:
        AuthError: If authorization request fails

    Example::

        from oauth_do.device import authorize_device

        auth = await authorize_device()
        print(f"Visit: {auth.verification_uri}")
        print(f"Enter code: {auth.user_code}")
    """
    config = get_config()

    if not config.client_id:
        raise AuthError(
            "Client ID is required for device authorization. "
            "Set OAUTH_CLIENT_ID or configure(client_id='...')",
            AuthErrorCode.UNKNOWN,
        )

    # Build request body
    body = {
        "client_id": config.client_id,
        "scope": "openid profile email",
    }

    # Add provider if specified (bypasses AuthKit login screen)
    actual_provider = provider or (options.provider if options else None)
    if actual_provider:
        body["provider"] = actual_provider

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                DEVICE_AUTH_URL,
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

            if not response.is_success:
                error_text = response.text
                raise AuthError(
                    f"Device authorization failed: {response.reason_phrase} - {error_text}",
                    AuthErrorCode.NETWORK_ERROR,
                    status=response.status_code,
                )

            data = response.json()

            return DeviceAuthorizationResponse(
                device_code=data["device_code"],
                user_code=data["user_code"],
                verification_uri=data["verification_uri"],
                verification_uri_complete=data.get("verification_uri_complete", ""),
                expires_in=data["expires_in"],
                interval=data.get("interval", 5),
            )

    except httpx.RequestError as e:
        raise AuthError(
            f"Device authorization request failed: {e}",
            AuthErrorCode.NETWORK_ERROR,
            cause=e,
        ) from e


async def poll_for_tokens(
    device_code: str,
    interval: int = 5,
    expires_in: int = 600,
) -> TokenResponse:
    """
    Poll for tokens after device authorization.

    Continuously polls the token endpoint until the user authorizes
    the device or the code expires.

    Args:
        device_code: Device code from authorization response
        interval: Polling interval in seconds (default: 5)
        expires_in: Expiration time in seconds (default: 600)

    Returns:
        Token response with access token and user info

    Raises:
        AuthError: If polling fails or code expires

    Example::

        from oauth_do.device import authorize_device, poll_for_tokens

        auth = await authorize_device()
        print(f"Enter code: {auth.user_code}")

        token = await poll_for_tokens(
            auth.device_code,
            auth.interval,
            auth.expires_in,
        )
        print(f"Access token: {token.access_token}")
    """
    config = get_config()

    if not config.client_id:
        raise AuthError(
            "Client ID is required for token polling",
            AuthErrorCode.UNKNOWN,
        )

    import time
    start_time = time.time()
    timeout = expires_in
    current_interval = interval

    while True:
        # Check if expired
        elapsed = time.time() - start_time
        if elapsed > timeout:
            raise AuthError(
                "Device authorization expired. Please try again.",
                AuthErrorCode.TIMEOUT,
            )

        # Wait for interval
        await asyncio.sleep(current_interval)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    TOKEN_URL,
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "device_code": device_code,
                        "client_id": config.client_id,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )

                if response.is_success:
                    data = response.json()
                    return TokenResponse(
                        access_token=data["access_token"],
                        token_type=data.get("token_type", "Bearer"),
                        refresh_token=data.get("refresh_token"),
                        expires_in=data.get("expires_in"),
                    )

                # Handle error responses
                try:
                    error_data = response.json()
                except Exception:
                    error_data = {"error": "unknown"}

                error = error_data.get("error", "unknown")

                if error == TokenError.AUTHORIZATION_PENDING.value:
                    # Continue polling
                    continue

                if error == TokenError.SLOW_DOWN.value:
                    # Increase interval by 5 seconds
                    current_interval += 5
                    continue

                if error == TokenError.ACCESS_DENIED.value:
                    raise AuthError(
                        "Access denied by user",
                        AuthErrorCode.ACCESS_DENIED,
                    )

                if error == TokenError.EXPIRED_TOKEN.value:
                    raise AuthError(
                        "Device code expired",
                        AuthErrorCode.TIMEOUT,
                    )

                raise AuthError(
                    f"Token polling failed: {error}",
                    AuthErrorCode.UNKNOWN,
                )

        except AuthError:
            raise
        except Exception as e:
            # Network errors - continue polling
            if isinstance(e, httpx.RequestError):
                continue
            raise
