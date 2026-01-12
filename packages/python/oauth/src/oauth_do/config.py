"""
Configuration management for oauth.do

This module provides global configuration for OAuth settings.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .types import OAuthConfig


def _get_env(key: str) -> str | None:
    """Get environment variable value."""
    return os.environ.get(key)


# Global configuration
_global_config: dict[str, str | None] = {
    "api_url": _get_env("OAUTH_API_URL") or _get_env("API_URL") or "https://apis.do",
    "client_id": _get_env("OAUTH_CLIENT_ID") or "client_01JQYTRXK9ZPD8JPJTKDCRB656",
    "authkit_domain": _get_env("OAUTH_AUTHKIT_DOMAIN") or "login.oauth.do",
    "storage_path": _get_env("OAUTH_STORAGE_PATH"),
}


def configure(
    *,
    api_url: str | None = None,
    client_id: str | None = None,
    authkit_domain: str | None = None,
    storage_path: str | None = None,
) -> None:
    """
    Configure OAuth settings.

    Args:
        api_url: Base URL for API endpoints (default: https://apis.do)
        client_id: OAuth client ID
        authkit_domain: AuthKit domain for device authorization (default: login.oauth.do)
        storage_path: Custom path for token storage

    Example::

        from oauth_do import configure

        configure(
            client_id="my-client-id",
            authkit_domain="auth.example.com",
        )
    """
    global _global_config

    if api_url is not None:
        _global_config["api_url"] = api_url
    if client_id is not None:
        _global_config["client_id"] = client_id
    if authkit_domain is not None:
        _global_config["authkit_domain"] = authkit_domain
    if storage_path is not None:
        _global_config["storage_path"] = storage_path


def get_config() -> "OAuthConfig":
    """
    Get current OAuth configuration.

    Returns:
        Current OAuth configuration object

    Example::

        from oauth_do import get_config

        config = get_config()
        print(f"API URL: {config.api_url}")
        print(f"Client ID: {config.client_id}")
    """
    from .types import OAuthConfig

    return OAuthConfig(
        api_url=_global_config["api_url"] or "https://apis.do",
        client_id=_global_config["client_id"] or "client_01JQYTRXK9ZPD8JPJTKDCRB656",
        authkit_domain=_global_config["authkit_domain"] or "login.oauth.do",
        storage_path=_global_config["storage_path"],
    )


def configure_from_env() -> None:
    """
    Configure OAuth from environment variables.

    Reads from:
        - OAUTH_API_URL or API_URL
        - OAUTH_CLIENT_ID
        - OAUTH_AUTHKIT_DOMAIN
        - OAUTH_STORAGE_PATH
    """
    configure(
        api_url=_get_env("OAUTH_API_URL") or _get_env("API_URL"),
        client_id=_get_env("OAUTH_CLIENT_ID"),
        authkit_domain=_get_env("OAUTH_AUTHKIT_DOMAIN"),
        storage_path=_get_env("OAUTH_STORAGE_PATH"),
    )
