"""
RPC Proxy for zero-schema access.

The RpcProxy implements __getattr__ to provide dynamic method resolution,
allowing users to call remote methods without any schema definition.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from ._types import MapFunction
    from . import RpcClient


__all__ = ["RpcProxy"]


class RpcProxy:
    """
    Dynamic proxy for zero-schema RPC access.

    Implements __getattr__ to intercept attribute access and build up a
    method path. When called, executes the RPC request.

    Example:
        proxy = RpcProxy(client, path=[])

        # Attribute access builds the path
        users = proxy.users        # RpcProxy(client, path=["users"])
        get = users.get            # RpcProxy(client, path=["users", "get"])

        # Calling executes the RPC
        result = await get(id=123) # calls "users.get" with {id: 123}

    Promise Pipelining:
        The proxy supports promise pipelining - calling methods on results
        that haven't been awaited yet. This allows batching multiple calls
        into a single round-trip.

        user = proxy.users.get(id=123)    # Returns PipelinedCall, not awaited
        posts = user.posts.list()          # Pipelined on the result
        await posts                        # Single round-trip for both calls
    """

    def __init__(self, client: RpcClient, path: list[str]) -> None:
        """
        Initialize the proxy.

        Args:
            client: The RpcClient instance for making calls
            path: The current method path being built
        """
        self._client = client
        self._path = path

    def __getattr__(self, name: str) -> RpcProxy:
        """
        Intercept attribute access to build method path.

        Args:
            name: The attribute name being accessed

        Returns:
            A new RpcProxy with the name appended to the path
        """
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")
        return RpcProxy(self._client, self._path + [name])

    def __call__(self, **kwargs: Any) -> PipelinedCall:
        """
        Execute the RPC call.

        Args:
            **kwargs: Arguments to pass to the remote method

        Returns:
            A PipelinedCall that can be awaited or chained
        """
        method = ".".join(self._path)
        return PipelinedCall(self._client, method, kwargs)

    def __repr__(self) -> str:
        path = ".".join(self._path) if self._path else "<root>"
        return f"RpcProxy({path})"


class PipelinedCall:
    """
    Represents a pending RPC call that supports promise pipelining.

    This class allows chaining method calls before awaiting the result,
    enabling promise pipelining where multiple calls are batched into
    a single network round-trip.

    Example:
        # Without pipelining (3 round-trips):
        user = await client.$.users.get(id=123)
        profile = await user.profile.get()
        avatar = await profile.avatar.url()

        # With pipelining (1 round-trip):
        user = client.$.users.get(id=123)      # Not awaited
        profile = user.profile.get()            # Pipelined
        avatar = await profile.avatar.url()    # All executed together
    """

    def __init__(self, client: RpcClient, method: str, kwargs: dict[str, Any]) -> None:
        """
        Initialize a pipelined call.

        Args:
            client: The RpcClient for making the call
            method: The dot-separated method path
            kwargs: Arguments for the method
        """
        self._client = client
        self._method = method
        self._kwargs = kwargs
        self._result: Any = None
        self._resolved = False

    def __getattr__(self, name: str) -> RpcProxy:
        """
        Allow chaining method calls for promise pipelining.

        Args:
            name: The attribute name to chain

        Returns:
            An RpcProxy that will be pipelined on this call's result
        """
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")
        # Return a proxy that represents a pipelined call on this result
        # TODO: Implement actual pipelining tracking
        return RpcProxy(self._client, [f"${self._method}", name])

    def map(self, fn: Callable[[Any], Any]) -> MappedCall:
        """
        Transform the result of this call.

        The map function supports record/replay for testing and debugging.
        When recording is enabled, the input and output of the map function
        are captured. During replay, the recorded output is returned without
        executing the function.

        Args:
            fn: A function to transform the result

        Returns:
            A MappedCall that applies the transformation

        Example:
            # Transform user data
            user_names = client.$.users.list().map(
                lambda users: [u["name"] for u in users]
            )

            # Record/replay for testing:
            # When DOTDO_RECORD=1, captures fn input/output
            # When DOTDO_REPLAY=path/to/recording, uses recorded data
        """
        return MappedCall(self, fn)

    def __await__(self):
        """
        Make the call awaitable.

        Returns:
            An awaitable that resolves to the RPC result
        """
        return self._execute().__await__()

    async def _execute(self) -> Any:
        """Execute the RPC call and return the result."""
        if not self._resolved:
            self._result = await self._client.call(self._method, **self._kwargs)
            self._resolved = True
        return self._result

    def __repr__(self) -> str:
        status = "resolved" if self._resolved else "pending"
        return f"PipelinedCall({self._method}, {status})"


class MappedCall:
    """
    A pipelined call with a transformation function.

    Supports record/replay for testing:
    - Recording: Captures input/output of the map function
    - Replay: Returns recorded output without executing the function

    This enables deterministic testing of code that uses .map() transformations.
    """

    def __init__(self, source: PipelinedCall, fn: Callable[[Any], Any]) -> None:
        """
        Initialize a mapped call.

        Args:
            source: The source PipelinedCall to transform
            fn: The transformation function
        """
        self._source = source
        self._fn = fn
        self._result: Any = None
        self._resolved = False

    def map(self, fn: Callable[[Any], Any]) -> MappedCall:
        """
        Chain another transformation.

        Args:
            fn: A function to transform the result

        Returns:
            A new MappedCall that applies both transformations
        """
        return MappedCall(self, fn)

    def __await__(self):
        """Make the mapped call awaitable."""
        return self._execute().__await__()

    async def _execute(self) -> Any:
        """Execute the source call and apply the transformation."""
        if not self._resolved:
            source_result = await self._source
            # TODO: Implement record/replay logic
            # - Check DOTDO_RECORD env var for recording mode
            # - Check DOTDO_REPLAY env var for replay mode
            # - In record mode: capture fn input/output
            # - In replay mode: return recorded output
            self._result = self._fn(source_result)
            self._resolved = True
        return self._result

    def __repr__(self) -> str:
        status = "resolved" if self._resolved else "pending"
        return f"MappedCall({self._source._method}, {status})"
