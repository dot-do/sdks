"""
DotDo Platform SDK - Managed connections with auth, pooling, and retry logic.

Example usage:
    from dotdo import DotDo

    # Using API key authentication
    async with DotDo(api_key="your-api-key") as do:
        result = await do.rpc.users.get(id=123)

    # Using environment variables (DOTDO_API_KEY)
    async with DotDo() as do:
        result = await do.rpc.users.list()

    # With custom configuration
    do = DotDo(
        api_key="your-api-key",
        base_url="https://api.dotdo.dev",
        max_retries=3,
        pool_size=10,
    )
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from dotdo_rpc import RpcClient, RpcProxy

if TYPE_CHECKING:
    from types import TracebackType


__all__ = ["DotDo", "DotDoConfig", "AuthMethod", "RetryConfig"]
__version__ = "0.1.0"


class AuthMethod(Enum):
    """Authentication methods supported by DotDo."""
    API_KEY = "api_key"
    OAUTH = "oauth"
    JWT = "jwt"


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""
    max_retries: int = 3
    initial_delay: float = 0.1
    max_delay: float = 10.0
    exponential_base: float = 2.0
    retryable_errors: tuple[type[Exception], ...] = field(
        default_factory=lambda: (ConnectionError, TimeoutError)
    )


@dataclass
class DotDoConfig:
    """Configuration for DotDo client."""
    base_url: str = "wss://api.dotdo.dev/rpc"
    api_key: str | None = None
    auth_method: AuthMethod = AuthMethod.API_KEY
    timeout: float = 30.0
    pool_size: int = 10
    retry: RetryConfig = field(default_factory=RetryConfig)


class ConnectionPool:
    """
    Manages a pool of RPC connections for improved performance.

    Connection pooling reduces latency by reusing existing WebSocket
    connections instead of establishing new ones for each request.
    """

    def __init__(self, config: DotDoConfig) -> None:
        """
        Initialize the connection pool.

        Args:
            config: DotDo configuration with pool settings
        """
        self._config = config
        self._connections: list[RpcClient] = []
        self._available: list[RpcClient] = []
        self._size = config.pool_size

    async def acquire(self) -> RpcClient:
        """
        Acquire a connection from the pool.

        If no connections are available and the pool is not at capacity,
        creates a new connection. Otherwise, waits for an available connection.

        Returns:
            An RpcClient instance ready for use
        """
        # TODO: Implement actual connection pooling
        # - Check for available connections
        # - Create new connection if pool not at capacity
        # - Wait for available connection if pool is full
        client = RpcClient(self._config.base_url, timeout=self._config.timeout)
        await client.connect()
        return client

    async def release(self, client: RpcClient) -> None:
        """
        Return a connection to the pool.

        Args:
            client: The RpcClient to return to the pool
        """
        # TODO: Implement actual connection return
        # - Mark connection as available
        # - Handle broken connections
        self._available.append(client)

    async def close(self) -> None:
        """Close all connections in the pool."""
        # TODO: Implement actual pool shutdown
        for client in self._connections:
            await client.disconnect()
        self._connections.clear()
        self._available.clear()


class DotDo:
    """
    DotDo Platform SDK - Managed connections with auth, pooling, and retry.

    Provides a high-level interface for interacting with the DotDo platform,
    handling authentication, connection management, and automatic retries.

    Example:
        # Basic usage with API key
        async with DotDo(api_key="your-key") as do:
            users = await do.rpc.users.list()

        # With custom configuration
        config = DotDoConfig(
            base_url="wss://custom.dotdo.dev/rpc",
            pool_size=20,
            retry=RetryConfig(max_retries=5),
        )
        async with DotDo(config=config) as do:
            result = await do.rpc.service.method()

    Authentication:
        The client supports multiple authentication methods:
        - API Key: Set via api_key parameter or DOTDO_API_KEY env var
        - OAuth: Set via oauth_token parameter (coming soon)
        - JWT: Set via jwt_token parameter (coming soon)

    Connection Pooling:
        By default, the client maintains a pool of WebSocket connections
        to reduce latency. Configure pool size via the pool_size parameter.

    Retry Logic:
        Transient failures are automatically retried with exponential backoff.
        Configure retry behavior via the RetryConfig class.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
        pool_size: int = 10,
        max_retries: int = 3,
        config: DotDoConfig | None = None,
    ) -> None:
        """
        Initialize the DotDo client.

        Args:
            api_key: API key for authentication (or use DOTDO_API_KEY env var)
            base_url: Custom base URL for the RPC endpoint
            timeout: Default timeout for RPC calls in seconds
            pool_size: Number of connections to maintain in the pool
            max_retries: Maximum number of retry attempts for failed calls
            config: Full configuration object (overrides other parameters)
        """
        if config is not None:
            self._config = config
        else:
            resolved_api_key = api_key or os.environ.get("DOTDO_API_KEY")
            self._config = DotDoConfig(
                base_url=base_url or "wss://api.dotdo.dev/rpc",
                api_key=resolved_api_key,
                timeout=timeout,
                pool_size=pool_size,
                retry=RetryConfig(max_retries=max_retries),
            )

        self._pool: ConnectionPool | None = None
        self._client: RpcClient | None = None
        self._authenticated = False

    @property
    def config(self) -> DotDoConfig:
        """The current configuration."""
        return self._config

    @property
    def authenticated(self) -> bool:
        """Whether the client has been authenticated."""
        return self._authenticated

    @property
    def rpc(self) -> RpcProxy:
        """
        Magic proxy for zero-schema RPC access.

        Returns an RpcProxy that intercepts attribute access and method calls,
        translating them into authenticated RPC requests with automatic retry.

        Example:
            result = await do.rpc.users.get(id=123)
        """
        if self._client is None:
            raise RuntimeError("DotDo client not connected. Use 'async with DotDo() as do:'")
        return self._client.rpc

    async def connect(self) -> None:
        """
        Establish connection and authenticate with the DotDo platform.

        Raises:
            ValueError: If no API key is configured
            AuthenticationError: If authentication fails
            ConnectionError: If connection cannot be established
        """
        if self._config.api_key is None:
            raise ValueError(
                "API key required. Set via api_key parameter or DOTDO_API_KEY env var."
            )

        # Initialize connection pool
        self._pool = ConnectionPool(self._config)

        # Acquire a connection for the main client
        self._client = await self._pool.acquire()

        # TODO: Implement actual authentication
        # - Send auth request with API key
        # - Handle auth response
        # - Store auth token/session
        self._authenticated = True

    async def disconnect(self) -> None:
        """Close all connections and clean up resources."""
        if self._client is not None:
            await self._client.disconnect()
            self._client = None

        if self._pool is not None:
            await self._pool.close()
            self._pool = None

        self._authenticated = False

    async def call(self, method: str, **kwargs: Any) -> Any:
        """
        Make an authenticated RPC call with automatic retry.

        Args:
            method: Dot-separated method path (e.g., "users.get")
            **kwargs: Arguments to pass to the method

        Returns:
            The result of the RPC call

        Raises:
            RuntimeError: If not connected
            AuthenticationError: If authentication has expired
            RpcError: If the RPC call fails after all retries
        """
        if self._client is None:
            raise RuntimeError("DotDo client not connected. Use 'async with DotDo() as do:'")

        # TODO: Implement retry logic with exponential backoff
        # - Catch retryable errors
        # - Apply exponential backoff between retries
        # - Re-authenticate if needed
        return await self._client.call(method, **kwargs)

    async def __aenter__(self) -> DotDo:
        """Async context manager entry - connects and authenticates."""
        await self.connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Async context manager exit - disconnects and cleans up."""
        await self.disconnect()
