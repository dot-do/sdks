"""
DotDo RPC Client - Zero-schema RPC with magic $ proxy.

Example usage:
    from dotdo_rpc import RpcClient

    async with RpcClient("wss://api.dotdo.dev/rpc") as client:
        # Magic $ proxy provides zero-schema access
        result = await client.$.users.get(id=123)

        # Chain calls with promise pipelining
        user = client.$.users.get(id=123)
        posts = await user.posts.list(limit=10)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .proxy import RpcProxy

if TYPE_CHECKING:
    from types import TracebackType


__all__ = ["RpcClient", "RpcProxy"]
__version__ = "0.1.0"


class RpcClient:
    """
    RPC Client with magic $ proxy for zero-schema access.

    The $ property returns an RpcProxy that allows calling remote methods
    without any schema definition. Method names and arguments are dynamically
    resolved at runtime.

    Example:
        client = RpcClient("wss://api.dotdo.dev/rpc")
        await client.connect()

        # Zero-schema access via $
        result = await client.$.service.method(arg1="value")

        # Promise pipelining - call methods on unresolved results
        user = client.$.users.get(id=123)  # Not awaited yet
        posts = await user.posts.list()     # Pipelined call
    """

    def __init__(self, url: str, *, timeout: float = 30.0) -> None:
        """
        Initialize RPC client.

        Args:
            url: WebSocket URL for the RPC endpoint
            timeout: Default timeout for RPC calls in seconds
        """
        self._url = url
        self._timeout = timeout
        self._connected = False
        self._proxy: RpcProxy | None = None

    @property
    def url(self) -> str:
        """The WebSocket URL for this client."""
        return self._url

    @property
    def connected(self) -> bool:
        """Whether the client is currently connected."""
        return self._connected

    @property
    def $(self) -> RpcProxy:
        """
        Magic proxy for zero-schema RPC access.

        Returns an RpcProxy that intercepts attribute access and method calls,
        translating them into RPC requests.

        Example:
            # These are equivalent:
            await client.$.users.get(id=123)
            await client.call("users.get", id=123)
        """
        if self._proxy is None:
            self._proxy = RpcProxy(self, path=[])
        return self._proxy

    async def connect(self) -> None:
        """
        Establish WebSocket connection to the RPC server.

        Raises:
            ConnectionError: If connection cannot be established
        """
        # TODO: Implement actual WebSocket connection using dotdo-capnweb
        self._connected = True

    async def disconnect(self) -> None:
        """Close the WebSocket connection."""
        # TODO: Implement actual disconnection
        self._connected = False
        self._proxy = None

    async def call(self, method: str, **kwargs: Any) -> Any:
        """
        Make a direct RPC call.

        Args:
            method: Dot-separated method path (e.g., "users.get")
            **kwargs: Arguments to pass to the method

        Returns:
            The result of the RPC call

        Raises:
            ConnectionError: If not connected
            RpcError: If the RPC call fails
        """
        if not self._connected:
            raise ConnectionError("Not connected to RPC server")

        # TODO: Implement actual RPC call using dotdo-capnweb
        raise NotImplementedError("RPC call not yet implemented")

    async def __aenter__(self) -> RpcClient:
        """Async context manager entry - connects to server."""
        await self.connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Async context manager exit - disconnects from server."""
        await self.disconnect()
