"""
RpcPromise - Awaitable promise with pipelining support.

The RpcPromise enables promise pipelining by allowing method calls and
property access on unresolved promises. This batches multiple RPC calls
into fewer network round trips.
"""

from __future__ import annotations

import asyncio
from typing import (
    TYPE_CHECKING,
    Any,
    Awaitable,
    Callable,
    Generic,
    TypeVar,
    Union,
    overload,
)

if TYPE_CHECKING:
    from .client import RpcClient

T = TypeVar("T")
U = TypeVar("U")

__all__ = ["RpcPromise"]


class RpcPromise(Awaitable[T], Generic[T]):
    """
    Awaitable RPC promise with support for pipelining.

    RpcPromise allows chaining method calls and property accesses before
    awaiting, enabling promise pipelining that reduces network round trips.

    Example:
        # Without pipelining (3 round trips):
        user = await client.getUser(123)
        profile = await user.profile()
        avatar = await profile.avatar()

        # With pipelining (1 round trip):
        avatar = await client.getUser(123).profile.avatar

    The map() method enables server-side transformations:
        # Server-side map (1 round trip):
        squares = await client.generateFibonacci(10).map(
            lambda x: client.square(x)
        )
    """

    __slots__ = (
        "_client",
        "_method",
        "_args",
        "_kwargs",
        "_result",
        "_resolved",
        "_error",
        "_pipeline",
        "_map_fn",
        "_map_captures",
        "_source_promise",
        "_capability_id",
    )

    def __init__(
        self,
        client: RpcClient | None,
        method: str,
        args: tuple[Any, ...] = (),
        kwargs: dict[str, Any] | None = None,
        *,
        pipeline: list[tuple[str, tuple[Any, ...], dict[str, Any]]] | None = None,
        source_promise: RpcPromise | None = None,
        map_fn: Callable[[Any], Any] | None = None,
        map_captures: dict[str, Any] | None = None,
        capability_id: str | None = None,
    ) -> None:
        """
        Initialize an RpcPromise.

        Args:
            client: The RpcClient for making calls
            method: The method name to call
            args: Positional arguments for the method
            kwargs: Keyword arguments for the method
            pipeline: List of pipelined operations (method, args, kwargs)
            source_promise: Source promise for map operations
            map_fn: Transformation function for map
            map_captures: Captured variables for server-side map
            capability_id: ID of the capability this promise represents
        """
        self._client = client
        self._method = method
        self._args = args
        self._kwargs = kwargs or {}
        self._result: T | None = None
        self._resolved = False
        self._error: Exception | None = None
        self._pipeline = pipeline or []
        self._map_fn = map_fn
        self._map_captures = map_captures or {}
        self._source_promise = source_promise
        self._capability_id = capability_id

    def __getattr__(self, name: str) -> RpcPromise[Any]:
        """
        Property access for pipelining.

        Returns a new promise that will access the named property/method
        on the result of this promise.

        Args:
            name: The property or method name

        Returns:
            A new RpcPromise for the pipelined access
        """
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")

        # Build pipeline entry for property access
        new_pipeline = self._pipeline + [(name, (), {})]

        return RpcPromise(
            self._client,
            self._method,
            self._args,
            self._kwargs,
            pipeline=new_pipeline,
            source_promise=self._source_promise,
            map_fn=self._map_fn,
            map_captures=self._map_captures,
            capability_id=self._capability_id,
        )

    def __call__(self, *args: Any, **kwargs: Any) -> RpcPromise[Any]:
        """
        Method call for pipelining.

        If this promise represents a property access, calling it will
        execute that as a method call with the provided arguments.

        Args:
            *args: Positional arguments for the method
            **kwargs: Keyword arguments for the method

        Returns:
            A new RpcPromise for the method call result
        """
        if self._pipeline:
            # Update the last pipeline entry with call arguments
            *rest, (method, _, _) = self._pipeline
            new_pipeline = rest + [(method, args, kwargs)]
        else:
            # This is a direct call on the method
            return RpcPromise(
                self._client,
                self._method,
                args,
                kwargs,
                capability_id=self._capability_id,
            )

        return RpcPromise(
            self._client,
            self._method,
            self._args,
            self._kwargs,
            pipeline=new_pipeline,
            source_promise=self._source_promise,
            map_fn=self._map_fn,
            map_captures=self._map_captures,
            capability_id=self._capability_id,
        )

    def map(self, fn: Callable[[T], U]) -> RpcPromise[list[U]]:
        """
        Server-side map transformation.

        Applies a transformation function to the result (or each element
        if the result is an array). The transformation is executed on the
        server to minimize round trips.

        Args:
            fn: A function that transforms each element. Should use
                RPC calls on captured client references.

        Returns:
            A new RpcPromise that will resolve to the transformed result

        Example:
            # Square each Fibonacci number on the server
            squares = await client.generateFibonacci(10).map(
                lambda x: client.square(x)
            )
        """
        return RpcPromise(
            self._client,
            self._method,
            self._args,
            self._kwargs,
            pipeline=self._pipeline,
            source_promise=self,
            map_fn=fn,
            capability_id=self._capability_id,
        )

    def __await__(self):
        """Make the promise awaitable."""
        return self._resolve().__await__()

    async def _resolve(self) -> T:
        """
        Resolve the promise by executing the RPC call.

        Returns:
            The result of the RPC call

        Raises:
            RpcError: If the RPC call fails
        """
        if self._resolved:
            if self._error:
                raise self._error
            return self._result  # type: ignore

        if self._client is None:
            raise RuntimeError("Cannot resolve promise without client")

        try:
            # If this is a map operation on a source promise
            if self._source_promise is not None and self._map_fn is not None:
                source_result = await self._source_promise
                self._result = await self._execute_map(source_result)
            else:
                # Execute the RPC call with pipelining
                self._result = await self._client._execute_call(
                    self._method,
                    self._args,
                    self._kwargs,
                    self._pipeline,
                    self._capability_id,
                )
            self._resolved = True
            return self._result  # type: ignore
        except Exception as e:
            self._error = e
            self._resolved = True
            raise

    async def _execute_map(self, source_result: Any) -> Any:
        """
        Execute the map function on the source result.

        Args:
            source_result: The result to transform

        Returns:
            The transformed result
        """
        if source_result is None:
            return None

        if self._map_fn is None:
            return source_result

        if isinstance(source_result, list):
            # Map over array
            results = []
            for item in source_result:
                result = self._map_fn(item)
                if isinstance(result, RpcPromise):
                    result = await result
                results.append(result)
            return results
        else:
            # Map over single value
            result = self._map_fn(source_result)
            if isinstance(result, RpcPromise):
                result = await result
            return result

    def __repr__(self) -> str:
        status = "resolved" if self._resolved else "pending"
        pipeline_str = ""
        if self._pipeline:
            pipeline_str = "." + ".".join(p[0] for p in self._pipeline)
        return f"RpcPromise({self._method}{pipeline_str}, {status})"
