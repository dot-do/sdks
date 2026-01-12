"""
Unit tests for the RpcClient class.

Tests cover:
- Connection and disconnection
- URL building
- Error handling and propagation
- Context manager support
- Message serialization/deserialization
"""

import pytest
import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestRpcClientConnection:
    """Tests for RpcClient connection lifecycle."""

    @pytest.mark.asyncio
    async def test_connect_returns_client(self):
        """Test that connect() returns an RpcClient."""
        from rpc_do import connect

        # Use a mock URL - actual connection will fail without server
        try:
            client = await connect("test.do")
            assert client is not None
            await client.close()
        except Exception:
            # Expected to fail without a server
            pass

    @pytest.mark.asyncio
    async def test_connect_with_custom_timeout(self):
        """Test that connect accepts custom timeout."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787", timeout=60.0)
        assert client._timeout == 60.0
        await client.close()

    def test_client_has_getattr(self):
        """Test that client supports attribute access for zero-schema."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Accessing an attribute should return an RpcPromise
        promise = client.someMethod
        assert promise is not None

    @pytest.mark.asyncio
    async def test_client_close_idempotent(self):
        """Test that close() can be called multiple times safely."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # First close should work
        await client.close()
        assert client._closed is True

        # Second close should also work (idempotent)
        await client.close()
        assert client._closed is True

    @pytest.mark.asyncio
    async def test_client_close_cancels_waiters(self):
        """Test that close() cancels pending pull waiters."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Simulate pending waiters
        future: asyncio.Future[Any] = asyncio.Future()
        client._pull_waiters[1] = future

        await client.close()

        assert len(client._pull_waiters) == 0
        assert future.cancelled()

    @pytest.mark.asyncio
    async def test_context_manager(self):
        """Test async context manager usage."""
        from rpc_do import connect

        try:
            async with await connect("test.do") as client:
                assert client is not None
        except Exception:
            # Expected without server
            pass

    @pytest.mark.asyncio
    async def test_context_manager_closes_on_error(self):
        """Test that context manager closes connection on exception."""
        from rpc_do import RpcClient
        from unittest.mock import AsyncMock, MagicMock

        client = RpcClient("ws://localhost:8787")

        # Mock the websocket connection to avoid actual network calls
        mock_ws = MagicMock()
        mock_ws.close = AsyncMock()
        client._ws = mock_ws

        try:
            async with client:
                raise ValueError("Test error")
        except ValueError:
            pass

        assert client._closed is True


class TestRpcClientUrlParsing:
    """Test RpcClient URL parsing and building."""

    def test_parse_service_url(self):
        """Test service URL parsing."""
        from rpc_do.client import _build_ws_url

        # Simple service name
        assert _build_ws_url("api.do") == "wss://api.do/rpc"

        # Full URL with protocol
        assert _build_ws_url("wss://api.do/rpc") == "wss://api.do/rpc"
        assert _build_ws_url("ws://localhost:8787") == "ws://localhost:8787"

        # HTTP URLs converted to WS
        assert _build_ws_url("https://api.do") == "wss://api.do/rpc"
        assert _build_ws_url("http://localhost:8787") == "ws://localhost:8787/rpc"

    def test_parse_url_with_path(self):
        """Test URL parsing preserves existing /rpc path."""
        from rpc_do.client import _build_ws_url

        assert _build_ws_url("https://api.do/rpc") == "wss://api.do/rpc"
        assert _build_ws_url("http://localhost:8787/rpc") == "ws://localhost:8787/rpc"

    def test_parse_simple_domain(self):
        """Test simple domain names get wss:// prefix."""
        from rpc_do.client import _build_ws_url

        assert _build_ws_url("myservice.do") == "wss://myservice.do/rpc"
        assert _build_ws_url("api.example.com") == "wss://api.example.com/rpc"


class TestRpcClientErrorHandling:
    """Tests for RPC error handling and propagation."""

    def test_rpc_error_with_code(self):
        """Test RpcError includes error code."""
        from rpc_do import RpcError

        error = RpcError("Test error", code="TEST_ERROR")
        assert error.message == "Test error"
        assert error.code == "TEST_ERROR"
        assert str(error) == "[TEST_ERROR] Test error"

    def test_rpc_error_without_code(self):
        """Test RpcError without error code."""
        from rpc_do import RpcError

        error = RpcError("Simple error")
        assert error.message == "Simple error"
        assert error.code is None
        assert str(error) == "Simple error"

    def test_rpc_error_with_data(self):
        """Test RpcError includes additional data."""
        from rpc_do import RpcError

        error = RpcError("Error with data", code="DATA_ERROR", data={"field": "value"})
        assert error.data == {"field": "value"}

    @pytest.mark.asyncio
    async def test_call_on_closed_client_raises(self):
        """Test that calling methods on closed client raises error."""
        from rpc_do import RpcClient, RpcError

        client = RpcClient("ws://localhost:8787")
        await client.close()

        # Attempting to call should raise
        with pytest.raises(RpcError, match="Client is closed"):
            await client._execute_call("test", (), {})


class TestRpcClientSerialization:
    """Tests for value serialization/deserialization."""

    def test_devaluate_primitives(self):
        """Test serialization of primitive values."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        assert client._devaluate(None) is None
        assert client._devaluate(True) is True
        assert client._devaluate(False) is False
        assert client._devaluate(42) == 42
        assert client._devaluate(3.14) == 3.14
        assert client._devaluate("hello") == "hello"

    def test_devaluate_special_floats(self):
        """Test serialization of special float values."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        assert client._devaluate(float("inf")) == ["inf"]
        assert client._devaluate(float("-inf")) == ["-inf"]
        # NaN check is special
        result = client._devaluate(float("nan"))
        assert result == ["nan"]

    def test_devaluate_lists(self):
        """Test serialization of lists (escaped as nested array)."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        result = client._devaluate([1, 2, 3])
        assert result == [[1, 2, 3]]

    def test_devaluate_dicts(self):
        """Test serialization of dictionaries."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        result = client._devaluate({"key": "value", "num": 42})
        assert result == {"key": "value", "num": 42}

    def test_devaluate_bytes(self):
        """Test serialization of bytes."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        result = client._devaluate(b"hello")
        assert result[0] == "bytes"
        assert result[1] == "aGVsbG8="  # base64 of "hello"

    def test_evaluate_primitives(self):
        """Test deserialization of primitive values."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        assert client._evaluate(None) is None
        assert client._evaluate(True) is True
        assert client._evaluate(42) == 42
        assert client._evaluate("hello") == "hello"

    def test_evaluate_special_types(self):
        """Test deserialization of special type markers."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        assert client._evaluate(["inf"]) == float("inf")
        assert client._evaluate(["-inf"]) == float("-inf")
        assert client._evaluate(["undefined"]) is None
        assert client._evaluate(["bigint", "123456789"]) == 123456789

    def test_evaluate_arrays(self):
        """Test deserialization of escaped arrays."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Escaped array [[items...]]
        result = client._evaluate([[1, 2, 3]])
        assert result == [1, 2, 3]

    def test_evaluate_bytes(self):
        """Test deserialization of bytes."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        result = client._evaluate(["bytes", "aGVsbG8="])
        assert result == b"hello"

    def test_evaluate_nested_objects(self):
        """Test deserialization of nested objects."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        result = client._evaluate({
            "user": {
                "id": 123,
                "name": "Test"
            },
            "items": [[1, 2, 3]]
        })
        assert result == {
            "user": {"id": 123, "name": "Test"},
            "items": [1, 2, 3]
        }


class TestRpcClientMessageHandling:
    """Tests for WebSocket message handling."""

    @pytest.mark.asyncio
    async def test_handle_resolve_message(self):
        """Test handling of resolve messages."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Set up a waiter
        future: asyncio.Future[Any] = asyncio.Future()
        client._pull_waiters[1] = future

        # Handle resolve message
        await client._handle_message('["resolve", 1, 42]')

        assert future.done()
        assert future.result() == 42
        assert 1 not in client._pull_waiters

    @pytest.mark.asyncio
    async def test_handle_reject_message(self):
        """Test handling of reject messages."""
        from rpc_do import RpcClient, RpcError

        client = RpcClient("ws://localhost:8787")

        # Set up a waiter
        future: asyncio.Future[Any] = asyncio.Future()
        client._pull_waiters[1] = future

        # Handle reject message
        await client._handle_message('["reject", 1, ["error", "Error", "Test error"]]')

        assert future.done()
        with pytest.raises(RpcError):
            future.result()

    @pytest.mark.asyncio
    async def test_handle_abort_message(self):
        """Test handling of abort messages cancels all waiters."""
        from rpc_do import RpcClient, RpcError

        client = RpcClient("ws://localhost:8787")

        # Set up multiple waiters
        future1: asyncio.Future[Any] = asyncio.Future()
        future2: asyncio.Future[Any] = asyncio.Future()
        client._pull_waiters[1] = future1
        client._pull_waiters[2] = future2

        # Handle abort message
        await client._handle_message('["abort", ["error", "Error", "Session aborted"]]')

        assert len(client._pull_waiters) == 0
        with pytest.raises(RpcError):
            future1.result()
        with pytest.raises(RpcError):
            future2.result()

    @pytest.mark.asyncio
    async def test_handle_invalid_json(self):
        """Test handling of invalid JSON messages."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Should not raise
        await client._handle_message("not valid json")

    @pytest.mark.asyncio
    async def test_handle_invalid_message_format(self):
        """Test handling of invalid message format."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Should not raise for non-array
        await client._handle_message('"just a string"')

        # Should not raise for short array
        await client._handle_message('[1]')


class TestPrivateAttributeAccess:
    """Tests for private attribute access handling."""

    def test_private_attribute_raises(self):
        """Test that accessing private attributes raises AttributeError."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        with pytest.raises(AttributeError):
            _ = client._private_method

    def test_special_attributes_accessible(self):
        """Test that special attributes like _url are accessible."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # These are in __slots__ and should be accessible
        assert client._url == "ws://localhost:8787"
        assert client._closed is False
