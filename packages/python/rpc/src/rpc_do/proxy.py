"""
RpcProxy - Zero-schema proxy using __getattr__.

The proxy intercepts attribute access and method calls, translating them
into RPC requests without requiring any schema definition.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .promise import RpcPromise

if TYPE_CHECKING:
    from .client import RpcClient

__all__ = ["RpcProxy"]


class RpcProxy:
    """
    Zero-schema proxy for dynamic RPC method access.

    RpcProxy uses __getattr__ to intercept all attribute access and build
    up method paths dynamically. This allows calling any remote method
    without defining a schema.

    Example:
        proxy = RpcProxy(client)

        # Attribute access builds the method path
        users = proxy.users           # RpcProxy with path ["users"]
        get = users.get               # RpcProxy with path ["users", "get"]

        # Calling creates an RpcPromise
        result = await get(id=123)    # Calls "users.get" with {id: 123}

        # Or chain directly
        result = await proxy.users.get(id=123)
    """

    __slots__ = ("_client", "_path")

    def __init__(self, client: RpcClient, path: list[str] | None = None) -> None:
        """
        Initialize the proxy.

        Args:
            client: The RpcClient for making calls
            path: The current method path (default: empty)
        """
        object.__setattr__(self, "_client", client)
        object.__setattr__(self, "_path", path or [])

    def __getattr__(self, name: str) -> RpcProxy | RpcPromise[Any]:
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

    def __call__(self, *args: Any, **kwargs: Any) -> RpcPromise[Any]:
        """
        Execute the RPC call.

        Args:
            *args: Positional arguments for the method
            **kwargs: Keyword arguments for the method

        Returns:
            An RpcPromise that resolves to the call result
        """
        method = ".".join(self._path) if self._path else ""
        return RpcPromise(self._client, method, args, kwargs)

    def __repr__(self) -> str:
        path = ".".join(self._path) if self._path else "<root>"
        return f"RpcProxy({path})"

    def __setattr__(self, name: str, value: Any) -> None:
        """Prevent accidental attribute setting."""
        if name in ("_client", "_path"):
            object.__setattr__(self, name, value)
        else:
            raise AttributeError(
                f"Cannot set attribute '{name}' on RpcProxy. "
                "Use RPC calls to modify remote state."
            )
