"""
RpcClient - WebSocket-based RPC client implementing the Cap'n Web protocol.

The client manages WebSocket connections to .do services and provides
zero-schema RPC access through attribute-based method invocation.
"""

from __future__ import annotations

import asyncio
import json
from types import TracebackType
from typing import Any, Callable, TYPE_CHECKING

import websockets

from .promise import RpcPromise

__all__ = ["RpcClient", "connect", "RpcError"]


def _build_ws_url(service: str) -> str:
    """
    Build WebSocket URL from service name or URL.

    Args:
        service: Either a service name (e.g., "api.do") or full URL

    Returns:
        WebSocket URL for the service
    """
    if service.startswith("wss://") or service.startswith("ws://"):
        return service

    if service.startswith("https://"):
        base = service.replace("https://", "wss://")
        return f"{base}/rpc" if not base.endswith("/rpc") else base

    if service.startswith("http://"):
        base = service.replace("http://", "ws://")
        return f"{base}/rpc" if not base.endswith("/rpc") else base

    # Just a service name like "api.do"
    return f"wss://{service}/rpc"


class RpcError(Exception):
    """
    Error raised when an RPC call fails.

    Attributes:
        message: Error message from the server
        code: Error code (if provided)
        data: Additional error data (if provided)
    """

    def __init__(
        self,
        message: str,
        code: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.data = data or {}

    def __str__(self) -> str:
        if self.code:
            return f"[{self.code}] {self.message}"
        return self.message


class RpcClient:
    """
    WebSocket RPC client implementing the Cap'n Web protocol.

    Provides attribute-based method invocation where any attribute access
    returns an RpcPromise that can be awaited or chained for pipelining.

    Example:
        client = await connect("api.do")

        # Direct method call
        result = await client.square(5)

        # Pipelined calls
        counter = client.makeCounter(10)
        value = await counter.increment(5)

        await client.close()
    """

    __slots__ = (
        "_url",
        "_ws",
        "_next_import_id",
        "_imports",
        "_exports",
        "_timeout",
        "_receive_task",
        "_closed",
        "_pull_waiters",
    )

    def __init__(
        self,
        url: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize the client (internal use - use connect() instead).

        Args:
            url: WebSocket URL for the RPC endpoint
            timeout: Default timeout for RPC calls in seconds
        """
        self._url = url
        self._ws: Any = None
        self._next_import_id = 1  # Import IDs start at 1 (0 is bootstrap)
        self._imports: dict[int, Any] = {}  # Our imports (their exports)
        self._exports: dict[int, Any] = {}  # Our exports (their imports)
        self._timeout = timeout
        self._receive_task: asyncio.Task[None] | None = None
        self._closed = False
        self._pull_waiters: dict[int, asyncio.Future[Any]] = {}

    def __getattr__(self, name: str) -> RpcPromise[Any]:
        """
        Zero-schema method access.

        Any attribute access returns an RpcPromise for calling that method.

        Args:
            name: The method name

        Returns:
            An RpcPromise for the method call
        """
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")

        return RpcPromise(self, name)

    async def close(self) -> None:
        """Close the WebSocket connection."""
        self._closed = True

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
            self._receive_task = None

        if self._ws:
            await self._ws.close()
            self._ws = None

        # Cancel any pending pull waiters
        for future in self._pull_waiters.values():
            if not future.done():
                future.cancel()
        self._pull_waiters.clear()

    async def _connect(self) -> None:
        """Establish WebSocket connection."""
        if self._ws is not None:
            return

        try:
            # Try modern asyncio API first (websockets >= 14)
            from websockets.asyncio.client import connect as async_connect
            self._ws = await async_connect(self._url)
        except ImportError:
            # Fall back to legacy API
            self._ws = await websockets.connect(self._url)
        self._receive_task = asyncio.create_task(self._receive_loop())

    async def _receive_loop(self) -> None:
        """Background task to receive and dispatch messages."""
        if self._ws is None:
            return

        try:
            async for message in self._ws:
                await self._handle_message(message)
        except Exception:
            # Connection closed or other error
            pass
        except asyncio.CancelledError:
            pass

    async def _handle_message(self, message: str | bytes) -> None:
        """
        Handle an incoming WebSocket message.

        Cap'n Web protocol messages:
        - ["resolve", export_id, value] - Resolution of a promise
        - ["reject", export_id, error] - Rejection of a promise
        - ["push", expression] - Push a new call onto our exports
        - ["pull", import_id] - Request to resolve an export
        - ["release", export_id, refcount] - Release references

        Args:
            message: The raw message data
        """
        try:
            msg = json.loads(message)
        except json.JSONDecodeError:
            return

        if not isinstance(msg, list) or len(msg) < 2:
            return

        msg_type = msg[0]

        if msg_type == "resolve":
            # ["resolve", export_id, value]
            if len(msg) >= 3:
                export_id = msg[1]
                value = self._evaluate(msg[2])
                if export_id in self._pull_waiters:
                    future = self._pull_waiters.pop(export_id)
                    if not future.done():
                        future.set_result(value)

        elif msg_type == "reject":
            # ["reject", export_id, error]
            if len(msg) >= 3:
                export_id = msg[1]
                error = self._evaluate_error(msg[2])
                if export_id in self._pull_waiters:
                    future = self._pull_waiters.pop(export_id)
                    if not future.done():
                        future.set_exception(error)

        elif msg_type == "push":
            # ["push", expression] - Server pushing something to us
            # We just track these in exports for now
            if len(msg) >= 2:
                export_id = len(self._exports)
                self._exports[export_id] = msg[1]

        elif msg_type == "pull":
            # ["pull", import_id] - Server wants us to resolve something
            pass  # Not implemented for client-side yet

        elif msg_type == "release":
            # ["release", export_id, refcount]
            pass  # Reference counting cleanup

        elif msg_type == "abort":
            # ["abort", error] - Session aborted
            if len(msg) >= 2:
                error = self._evaluate_error(msg[1])
                # Reject all pending operations
                for future in self._pull_waiters.values():
                    if not future.done():
                        future.set_exception(error)
                self._pull_waiters.clear()

    def _evaluate(self, value: Any) -> Any:
        """
        Evaluate a Cap'n Web serialized value.

        Special value formats:
        - [[items...]] - Array (wrapped in outer array to escape)
        - ["bigint", "123"] - BigInt
        - ["date", timestamp] - Date
        - ["bytes", base64] - Uint8Array
        - ["error", type, message] - Error
        - ["undefined"] - undefined
        - ["inf"], ["-inf"], ["nan"] - Special numbers
        - ["export", id] - Capability reference
        - ["promise", id] - Promise reference
        - ["import", id] - Import reference (our export)
        - ["pipeline", id, path, args?] - Pipelined call

        Args:
            value: The serialized value

        Returns:
            The deserialized Python value
        """
        if isinstance(value, list):
            if len(value) == 0:
                return value

            first = value[0]

            # Escaped array: [[items...]]
            if isinstance(first, list) and len(value) == 1:
                return [self._evaluate(item) for item in first]

            # Special types
            if first == "bigint" and len(value) >= 2:
                return int(value[1])

            if first == "date" and len(value) >= 2:
                # Return as timestamp (could use datetime)
                return value[1]

            if first == "bytes" and len(value) >= 2:
                import base64
                return base64.b64decode(value[1])

            if first == "error":
                return self._evaluate_error(value)

            if first == "undefined":
                return None

            if first == "inf":
                return float("inf")

            if first == "-inf":
                return float("-inf")

            if first == "nan":
                return float("nan")

            # Capability references
            if first == "export" and len(value) >= 2:
                export_id = value[1]
                return _CapabilityProxy(self, export_id)

            if first == "promise" and len(value) >= 2:
                export_id = value[1]
                return _CapabilityProxy(self, export_id, is_promise=True)

            if first == "import" and len(value) >= 2:
                # Reference to our export (their import)
                return self._exports.get(value[1])

            if first == "pipeline" and len(value) >= 2:
                # Pipelined reference
                export_id = value[1]
                return _CapabilityProxy(self, export_id, is_promise=True)

            # Unknown array format - return as-is
            return [self._evaluate(item) for item in value]

        elif isinstance(value, dict):
            return {k: self._evaluate(v) for k, v in value.items()}

        else:
            # Primitive values pass through
            return value

    def _evaluate_error(self, value: Any) -> Exception:
        """
        Evaluate a serialized error.

        Args:
            value: The serialized error

        Returns:
            The deserialized exception
        """
        if isinstance(value, list) and len(value) >= 3 and value[0] == "error":
            error_type = value[1]
            message = value[2]
            stack = value[3] if len(value) > 3 else None

            # Map error types
            if error_type == "RangeError":
                return RpcError(message, code="RangeError")
            elif error_type == "TypeError":
                return RpcError(message, code="TypeError")
            else:
                return RpcError(message, code=error_type)

        return RpcError(str(value))

    def _devaluate(self, value: Any) -> Any:
        """
        Serialize a Python value for the Cap'n Web protocol.

        Args:
            value: The Python value

        Returns:
            The serialized representation
        """
        if value is None:
            return None

        if isinstance(value, bool):
            return value

        if isinstance(value, (int, float)):
            if isinstance(value, float):
                if value == float("inf"):
                    return ["inf"]
                if value == float("-inf"):
                    return ["-inf"]
                if value != value:  # NaN check
                    return ["nan"]
            return value

        if isinstance(value, str):
            return value

        if isinstance(value, list):
            return [[self._devaluate(item) for item in value]]

        if isinstance(value, dict):
            return {k: self._devaluate(v) for k, v in value.items()}

        if isinstance(value, bytes):
            import base64
            return ["bytes", base64.b64encode(value).decode("ascii")]

        if isinstance(value, _CapabilityProxy):
            # Reference to a capability we received
            return ["import", value._export_id]

        if isinstance(value, RpcClient):
            # Self reference
            return ["import", 0]

        # Unknown type - try to convert to string
        return str(value)

    async def _execute_call(
        self,
        method: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        pipeline: list[tuple[str, tuple[Any, ...], dict[str, Any]]] | None = None,
        capability_id: int | None = None,
    ) -> Any:
        """
        Execute an RPC call using the Cap'n Web protocol.

        Args:
            method: The method name
            args: Positional arguments
            kwargs: Keyword arguments
            pipeline: Optional pipeline of chained operations
            capability_id: Optional capability ID to call method on

        Returns:
            The result of the RPC call

        Raises:
            RpcError: If the call fails
        """
        if self._closed:
            raise RpcError("Client is closed")

        if self._ws is None:
            await self._connect()

        # Determine the target export ID
        target_id = capability_id if capability_id is not None else 0

        # Build the property path
        path: list[str | int] = [method] if method else []

        # Add pipeline steps to path
        if pipeline:
            for step_method, step_args, step_kwargs in pipeline:
                path.append(step_method)

        # Build the call expression
        # ["pipeline", target_id, path, args?]
        if args or kwargs:
            # Serialize arguments
            if args and not kwargs:
                serialized_args = [self._devaluate(arg) for arg in args]
            elif kwargs and not args:
                serialized_args = [self._devaluate(kwargs)]
            else:
                # Mix of both
                serialized_args = [self._devaluate(list(args) + [kwargs])]

            expression = ["pipeline", target_id, path, serialized_args]
        else:
            expression = ["pipeline", target_id, path]

        # Send the push message
        msg = ["push", expression]
        assert self._ws is not None
        await self._ws.send(json.dumps(msg))

        # The server will assign an export ID for the result
        # We need to track it and send a pull request
        import_id = self._next_import_id
        self._next_import_id += 1

        # Create a future to wait for the result
        future: asyncio.Future[Any] = asyncio.Future()
        self._pull_waiters[import_id] = future

        # Send pull request to get the result
        pull_msg = ["pull", import_id]
        await self._ws.send(json.dumps(pull_msg))

        # Wait for the response
        try:
            result = await asyncio.wait_for(future, timeout=self._timeout)
            return result
        except asyncio.TimeoutError:
            self._pull_waiters.pop(import_id, None)
            raise RpcError(f"RPC call timed out: {method}")

    async def __aenter__(self) -> RpcClient:
        """Async context manager entry."""
        await self._connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Async context manager exit."""
        await self.close()


class _CapabilityProxy:
    """
    Proxy for a remote capability (stub).

    Allows calling methods on capabilities returned from the server.
    """

    __slots__ = ("_client", "_export_id", "_is_promise")

    def __init__(
        self,
        client: RpcClient,
        export_id: int,
        is_promise: bool = False,
    ) -> None:
        self._client = client
        self._export_id = export_id
        self._is_promise = is_promise

    def __getattr__(self, name: str) -> RpcPromise[Any]:
        """Access methods on the capability."""
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")

        return RpcPromise(
            self._client,
            name,
            capability_id=self._export_id,
        )

    def __repr__(self) -> str:
        return f"Capability({self._export_id})"


async def connect(service: str, **options: Any) -> RpcClient:
    """
    Connect to a .do service.

    Args:
        service: Service name (e.g., "api.do") or full WebSocket URL
        **options: Connection options
            - timeout: Default timeout for RPC calls (default: 30.0)

    Returns:
        Connected RpcClient instance

    Example:
        # Connect to a .do service
        client = await connect("api.do")

        # With options
        client = await connect("api.do", timeout=60.0)

        # Using full URL
        client = await connect("wss://api.do/rpc")
    """
    url = _build_ws_url(service)
    timeout = options.get("timeout", 30.0)

    client = RpcClient(url, timeout=timeout)
    await client._connect()

    return client
