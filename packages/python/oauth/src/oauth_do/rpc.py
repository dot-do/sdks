"""
Authenticated RPC session support for oauth.do

This module provides integration between oauth.do and the platform-do SDK,
enabling creation of authenticated RPC sessions using stored OAuth tokens.

Dependency chain: capnweb-do -> rpc-do -> platform-do -> oauth-do

oauth-do depends on both:
- rpc-do: For direct RPC client access and low-level RPC operations
- platform-do: For managed connections with pooling, retry, and auth

Example::

    from oauth_do import create_authenticated_client, connect_authenticated

    # Create an authenticated client (using platform-do)
    result = await create_authenticated_client()
    if result.is_authenticated:
        api = await result.client.api()
        data = await api.users.list()

    # Or connect directly to a service
    api = await connect_authenticated("api")
    data = await api.users.list()

    # For direct RPC access (using rpc-do):
    from oauth_do import create_direct_rpc_client

    client = await create_direct_rpc_client("wss://api.example.do")
    result = await client.some_method()
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TypeVar

from .auth import get_token, get_stored_token_data
from .types import StoredTokenData

# Lazy import modules to avoid circular imports and allow oauth_do
# to work without full dependencies installed for basic auth-only usage
_platform_do = None
_rpc_do = None


def _get_platform_do():
    """Lazy import of platform_do (dotdo module) to support optional dependency."""
    global _platform_do
    if _platform_do is None:
        try:
            from dotdo import DotDo, DotDoConfig, RetryConfig
            _platform_do = type("PlatformModule", (), {
                "DotDo": DotDo,
                "DotDoConfig": DotDoConfig,
                "RetryConfig": RetryConfig,
            })
        except ImportError:
            raise ImportError(
                "platform-do is required for RPC functionality. "
                "Install it with: pip install platform-do"
            )
    return _platform_do


def _get_rpc_do():
    """Lazy import of rpc_do module to support optional dependency."""
    global _rpc_do
    if _rpc_do is None:
        try:
            from rpc_do import RpcClient, connect
            _rpc_do = type("RpcModule", (), {
                "RpcClient": RpcClient,
                "connect": connect,
            })
        except ImportError:
            raise ImportError(
                "rpc-do is required for direct RPC functionality. "
                "Install it with: pip install rpc-do"
            )
    return _rpc_do


T = TypeVar("T")


@dataclass
class AuthenticatedRpcOptions:
    """Options for creating an authenticated RPC session."""

    token: str | None = None
    """Token to use for authentication. If not provided, will attempt to get
    token from storage or environment variables."""

    require_auth: bool = False
    """If True, raise an error if no token is available.
    If False (default), create an unauthenticated session."""

    timeout: float = 30.0
    """Default timeout for RPC calls in seconds."""

    base_url: str | None = None
    """Base URL override for .do services."""

    debug: bool = False
    """Enable debug logging."""


@dataclass
class AuthenticatedRpcClient:
    """Result of creating an authenticated RPC client."""

    client: Any
    """The platform-do client configured with authentication."""

    token: str | None
    """The access token being used (if authenticated)."""

    token_data: StoredTokenData | None
    """Full token data including refresh token (if available)."""

    is_authenticated: bool
    """Whether the client is authenticated."""


async def create_authenticated_client(
    options: AuthenticatedRpcOptions | None = None,
) -> AuthenticatedRpcClient:
    """
    Create an authenticated platform-do client using stored OAuth tokens.

    This function integrates oauth-do with platform-do to create RPC sessions
    that are automatically authenticated using stored credentials.

    Args:
        options: Configuration options for the RPC client

    Returns:
        An authenticated client with token information

    Raises:
        RuntimeError: If require_auth is True but no token is available

    Example::

        from oauth_do import create_authenticated_client

        # Create client with stored token
        result = await create_authenticated_client()

        if result.is_authenticated:
            # Connect to a .do service
            api = await result.client.connect("api")
            data = await api.users.list()

        # Don't forget to close when done
        await result.client.close()

    Example with required auth::

        from oauth_do import create_authenticated_client, AuthenticatedRpcOptions

        result = await create_authenticated_client(
            AuthenticatedRpcOptions(require_auth=True)
        )
    """
    platform_do = _get_platform_do()

    if options is None:
        options = AuthenticatedRpcOptions()

    # Get token from explicit option, storage, or environment
    token: str | None = options.token
    token_data: StoredTokenData | None = None

    if not token:
        # Try to get full token data first (includes refresh token, expiry)
        token_data = await get_stored_token_data()
        if token_data:
            token = token_data.access_token
        else:
            # Fall back to simple token retrieval
            token = await get_token()

    if options.require_auth and not token:
        raise RuntimeError(
            "Authentication required but no token available. "
            "Please login using `oauth-do login` or provide a token explicitly."
        )

    # Create platform-do client with authentication
    # The DotDo class accepts api_key for authentication
    client_options: dict[str, Any] = {
        "timeout": options.timeout,
    }

    if options.base_url:
        client_options["base_url"] = options.base_url

    # Pass token as api_key since DotDo uses api_key for authentication
    if token:
        client_options["api_key"] = token

    client = platform_do.DotDo(**client_options)

    return AuthenticatedRpcClient(
        client=client,
        token=token,
        token_data=token_data,
        is_authenticated=bool(token),
    )


async def connect_authenticated(
    service: str,
    options: AuthenticatedRpcOptions | None = None,
) -> Any:
    """
    Connect to a .do service with automatic authentication.

    This is a convenience function that creates an authenticated client
    and connects to a specific service in one call.

    Note: This returns the client's rpc proxy directly. The connection
    will remain open until the client is explicitly disconnected.
    For better resource management, use create_authenticated_client()
    and manage the client lifecycle explicitly.

    Args:
        service: Service name (e.g., 'api', 'ai') or full URL
        options: Configuration options

    Returns:
        RPC proxy for the service

    Example::

        from oauth_do import connect_authenticated

        # Connect to api.do with stored credentials
        api = await connect_authenticated("api")
        result = await api.users.list()

    Example with type hints::

        from typing import Protocol

        class MyService(Protocol):
            async def get_data(self) -> dict: ...

        service = await connect_authenticated("my-service")
        # service behaves like MyService

    Example with explicit resource management::

        from oauth_do import create_authenticated_client

        result = await create_authenticated_client()
        async with result.client as client:
            api = client.rpc
            data = await api.users.list()
    """
    result = await create_authenticated_client(options)
    # Connect the client and return its rpc proxy
    await result.client.connect()
    return result.client.rpc


def create_auth_factory(
    base_options: AuthenticatedRpcOptions | None = None,
) -> Callable[[AuthenticatedRpcOptions | None], Any]:
    """
    Create a factory function for authenticated clients.

    This is useful when you need to create multiple connections with the
    same authentication configuration.

    Args:
        base_options: Base configuration options to use for all clients

    Returns:
        A factory function for creating authenticated clients

    Example::

        from oauth_do import create_auth_factory, AuthenticatedRpcOptions

        # Create factory with base options
        create_client = create_auth_factory(
            AuthenticatedRpcOptions(timeout=60.0, debug=True)
        )

        # Create multiple authenticated clients
        client1 = await create_client()
        client2 = await create_client(AuthenticatedRpcOptions(require_auth=True))
    """
    if base_options is None:
        base_options = AuthenticatedRpcOptions()

    async def factory(
        options: AuthenticatedRpcOptions | None = None,
    ) -> AuthenticatedRpcClient:
        merged = AuthenticatedRpcOptions(
            token=options.token if options and options.token else base_options.token,
            require_auth=(
                options.require_auth if options else base_options.require_auth
            ),
            timeout=options.timeout if options else base_options.timeout,
            base_url=options.base_url if options and options.base_url else base_options.base_url,
            debug=options.debug if options else base_options.debug,
        )
        return await create_authenticated_client(merged)

    return factory


@dataclass
class DirectRpcOptions:
    """Options for creating a direct RPC connection (without platform-do pooling)."""

    token: str | None = None
    """Token to use for authentication. If not provided, will attempt to get
    token from storage or environment variables."""

    require_auth: bool = False
    """If True, raise an error if no token is available.
    If False (default), create an unauthenticated connection."""

    timeout: float = 30.0
    """Connection timeout in seconds."""


@dataclass
class AuthenticatedRpcSession:
    """Result of creating an authenticated RPC session for direct connections."""

    token: str | None
    """The access token being used (if authenticated)."""

    token_data: StoredTokenData | None
    """Full token data including refresh token (if available)."""

    is_authenticated: bool
    """Whether the session is authenticated."""


async def create_direct_rpc_client(
    url: str,
    options: DirectRpcOptions | None = None,
) -> Any:
    """
    Create a direct RPC client connection with automatic authentication.

    This uses rpc-do directly for low-level RPC access without platform-do's
    pooling and retry logic. Use this when you need direct control over the
    connection lifecycle or for simple single-connection scenarios.

    For managed connections with pooling and retry, use create_authenticated_client()
    which uses platform-do.

    Args:
        url: WebSocket URL of the RPC service
        options: Connection options

    Returns:
        Direct RPC client instance

    Raises:
        RuntimeError: If require_auth is True but no token is available

    Example::

        from oauth_do import create_direct_rpc_client, DirectRpcOptions

        # Create direct connection with stored credentials
        client = await create_direct_rpc_client("wss://api.example.do")

        # Make RPC calls
        result = await client.some_method()

        # Close when done
        await client.close()
    """
    rpc_do = _get_rpc_do()

    if options is None:
        options = DirectRpcOptions()

    # Get token from explicit option, storage, or environment
    token: str | None = options.token

    if not token:
        token = await get_token()

    if options.require_auth and not token:
        raise RuntimeError(
            "Authentication required but no token available. "
            "Please login using `oauth-do login` or provide a token explicitly."
        )

    # Create RPC client with authentication
    return rpc_do.connect(
        url,
        token=token,
        timeout=options.timeout,
    )


async def create_authenticated_rpc_session(
    options: DirectRpcOptions | None = None,
) -> AuthenticatedRpcSession:
    """
    Create an authenticated RPC session that can be used for multiple connections.

    This provides authentication info that can be used with the raw rpc-do client,
    suitable for scenarios where you need fine-grained control over the RPC transport.

    Args:
        options: Authentication options

    Returns:
        Authenticated RPC session info with a connect method

    Example::

        from oauth_do import create_authenticated_rpc_session
        from rpc_do import connect

        session = await create_authenticated_rpc_session()

        if session.is_authenticated:
            # Use the token to connect to multiple services
            client1 = connect("wss://api.example.do", token=session.token)
            client2 = connect("wss://other.example.do", token=session.token)
    """
    if options is None:
        options = DirectRpcOptions()

    # Get token from explicit option, storage, or environment
    token: str | None = options.token
    token_data: StoredTokenData | None = None

    if not token:
        token_data = await get_stored_token_data()
        if token_data:
            token = token_data.access_token
        else:
            token = await get_token()

    if options.require_auth and not token:
        raise RuntimeError(
            "Authentication required but no token available. "
            "Please login using `oauth-do login` or provide a token explicitly."
        )

    return AuthenticatedRpcSession(
        token=token,
        token_data=token_data,
        is_authenticated=bool(token),
    )


__all__ = [
    # Platform-do based (managed connections)
    "AuthenticatedRpcOptions",
    "AuthenticatedRpcClient",
    "create_authenticated_client",
    "connect_authenticated",
    "create_auth_factory",
    # Direct rpc-do access
    "DirectRpcOptions",
    "AuthenticatedRpcSession",
    "create_direct_rpc_client",
    "create_authenticated_rpc_session",
]
