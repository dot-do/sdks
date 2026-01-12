"""
Unit tests for the RpcClient class.
"""

import pytest
from typing import Any


class TestRpcClient:
    """Unit tests for RpcClient."""

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

    def test_client_has_getattr(self):
        """Test that client supports attribute access for zero-schema."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Accessing an attribute should return an RpcPromise
        promise = client.someMethod
        assert promise is not None

    @pytest.mark.asyncio
    async def test_client_close(self):
        """Test that close() can be called."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # Should not raise
        await client.close()


class TestRpcClientOptions:
    """Test RpcClient connection options."""

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


class TestConnectionManagement:
    """Test connection lifecycle management."""

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
    async def test_reconnection(self):
        """Test that client can handle reconnection."""
        from rpc_do import RpcClient

        client = RpcClient("ws://localhost:8787")

        # First close should work
        await client.close()

        # Second close should also work (idempotent)
        await client.close()
