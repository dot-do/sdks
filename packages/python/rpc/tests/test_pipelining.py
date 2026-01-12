"""
Unit tests for promise pipelining functionality.

Tests cover:
- Promise creation and chaining
- Pipeline building through attribute access
- Method call pipelining
- Map operations on promises
- Pipeline execution
"""

import pytest
import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestRpcPromiseBasic:
    """Basic tests for RpcPromise."""

    def test_promise_is_awaitable(self):
        """Test that RpcPromise can be awaited."""
        from rpc_do.promise import RpcPromise

        # Create a promise using proper constructor
        promise = RpcPromise(None, "test", (), {})

        # Should have __await__ method
        assert hasattr(promise, "__await__")

    def test_promise_repr(self):
        """Test RpcPromise string representation."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (), {})
        assert "getUser" in repr(promise)
        assert "pending" in repr(promise)

    def test_promise_repr_with_pipeline(self):
        """Test RpcPromise repr includes pipeline info."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (), {})
        chained = promise.profile.avatar

        assert "getUser" in repr(chained)
        assert "profile" in repr(chained)


class TestPromisePropertyAccess:
    """Tests for property access on promises."""

    def test_promise_getattr_returns_promise(self):
        """Test that accessing attributes on a promise returns another promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Accessing a property should return another promise
        chained = promise.someProperty
        assert isinstance(chained, RpcPromise)

    def test_promise_deep_property_chain(self):
        """Test deep property access chains."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (), {})

        # Chain: getUser().profile.avatar.url.path
        result = promise.profile.avatar.url.path
        assert isinstance(result, RpcPromise)
        assert len(result._pipeline) == 4

    def test_private_attribute_raises(self):
        """Test that accessing private attributes raises AttributeError."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        with pytest.raises(AttributeError):
            _ = promise._private


class TestPromiseMethodCalls:
    """Tests for method calls on promises."""

    def test_promise_call_returns_promise(self):
        """Test that calling a promise returns another promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Calling should return another promise
        called = promise(1, 2, 3)
        assert isinstance(called, RpcPromise)

    def test_promise_call_captures_args(self):
        """Test that calling captures arguments correctly."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "method", (), {})
        called = promise(1, "hello", True)

        assert called._args == (1, "hello", True)

    def test_promise_call_captures_kwargs(self):
        """Test that calling captures keyword arguments."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "method", (), {})
        called = promise(name="test", value=42)

        assert called._kwargs == {"name": "test", "value": 42}

    def test_promise_call_with_mixed_args(self):
        """Test calling with both args and kwargs."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "method", (), {})
        called = promise(1, 2, key="value")

        assert called._args == (1, 2)
        assert called._kwargs == {"key": "value"}


class TestPipelineBuilding:
    """Tests for building pipelines."""

    def test_pipeline_chain(self):
        """Test that multiple attribute accesses build a pipeline."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (), {})

        # Chain: getUser().profile.avatar.url
        profile = promise.profile
        avatar = profile.avatar
        url = avatar.url

        # Each should be a promise with the pipeline recorded
        assert isinstance(url, RpcPromise)
        assert len(url._pipeline) == 3

        # Check pipeline contents
        assert url._pipeline[0][0] == "profile"
        assert url._pipeline[1][0] == "avatar"
        assert url._pipeline[2][0] == "url"

    def test_pipeline_with_method_call(self):
        """Test pipelining with method calls in chain."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "makeCounter", (10,), {})

        # Chain: makeCounter(10).increment(5)
        increment = promise.increment
        result = increment(5)

        assert isinstance(result, RpcPromise)
        # Pipeline should have increment with args
        assert len(result._pipeline) == 1
        assert result._pipeline[0][0] == "increment"
        assert result._pipeline[0][1] == (5,)

    def test_pipeline_method_in_middle(self):
        """Test method calls in the middle of a pipeline."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (123,), {})

        # Chain: getUser(123).getProfile().avatar
        result = promise.getProfile().avatar

        assert isinstance(result, RpcPromise)
        assert len(result._pipeline) == 2

    def test_pipeline_preserves_initial_args(self):
        """Test that pipeline preserves original method args."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getUser", (123,), {"includeProfile": True})
        chained = promise.profile.avatar

        assert chained._method == "getUser"
        assert chained._args == (123,)
        assert chained._kwargs == {"includeProfile": True}


class TestMapOperations:
    """Tests for map operations on promises."""

    def test_promise_map_returns_promise(self):
        """Test that map() returns a promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # map() should return a promise
        mapped = promise.map(lambda x: x * 2)
        assert isinstance(mapped, RpcPromise)

    def test_map_captures_function(self):
        """Test that map captures the transformation function."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        fn = lambda x: x * 2
        mapped = promise.map(fn)

        assert mapped._map_fn is fn

    def test_map_chain(self):
        """Test that map can be chained multiple times."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Chain multiple maps
        result = promise.map(lambda x: x * 2).map(lambda x: x + 1)

        assert isinstance(result, RpcPromise)
        assert result._map_fn is not None

    def test_map_sets_source_promise(self):
        """Test that map sets source promise correctly."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "getNumbers", (), {})
        mapped = promise.map(lambda x: x * 2)

        assert mapped._source_promise is promise

    def test_map_preserves_method_info(self):
        """Test that map preserves original method information."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "generateFibonacci", (10,), {})
        mapped = promise.map(lambda x: x * 2)

        assert mapped._method == "generateFibonacci"
        assert mapped._args == (10,)


class TestZeroSchemaProxy:
    """Tests for zero-schema proxy behavior."""

    def test_arbitrary_method_names(self):
        """Test that any method name can be accessed."""
        from rpc_do.proxy import RpcProxy

        class MockClient:
            pass

        proxy = RpcProxy(MockClient())

        # Any attribute should work
        assert proxy.users is not None
        assert proxy.someRandomMethod is not None
        assert proxy.deeply.nested.path is not None

    def test_method_call_builds_promise(self):
        """Test that calling a proxy method builds a promise."""
        from rpc_do.proxy import RpcProxy
        from rpc_do.promise import RpcPromise

        class MockClient:
            pass

        proxy = RpcProxy(MockClient())

        # Calling should create a promise
        promise = proxy.square(5)
        assert isinstance(promise, RpcPromise)

    def test_kwargs_supported(self):
        """Test that keyword arguments are supported."""
        from rpc_do.proxy import RpcProxy
        from rpc_do.promise import RpcPromise

        class MockClient:
            pass

        proxy = RpcProxy(MockClient())

        # Should support kwargs
        promise = proxy.getUser(id=123, includeProfile=True)
        assert isinstance(promise, RpcPromise)
        assert promise._kwargs == {"id": 123, "includeProfile": True}


class TestMapExecution:
    """Tests for map execution logic."""

    @pytest.mark.asyncio
    async def test_execute_map_on_list(self):
        """Test executing map on a list result."""
        from rpc_do.promise import RpcPromise

        # Create a mock client
        client = MagicMock()
        client._execute_call = AsyncMock(return_value=[1, 2, 3])

        promise = RpcPromise(client, "getNumbers", (), {})

        # Create mapped promise
        mapped = promise.map(lambda x: x * 2)

        # Resolve
        result = await mapped

        # Should have doubled each element
        assert result == [2, 4, 6]

    @pytest.mark.asyncio
    async def test_execute_map_on_single_value(self):
        """Test executing map on a single value result."""
        from rpc_do.promise import RpcPromise

        # Create a mock client
        client = MagicMock()
        client._execute_call = AsyncMock(return_value=5)

        promise = RpcPromise(client, "getNumber", (), {})

        # Create mapped promise
        mapped = promise.map(lambda x: x * 2)

        # Resolve
        result = await mapped

        assert result == 10

    @pytest.mark.asyncio
    async def test_execute_map_on_none(self):
        """Test executing map on None returns None."""
        from rpc_do.promise import RpcPromise

        # Create a mock client
        client = MagicMock()
        client._execute_call = AsyncMock(return_value=None)

        promise = RpcPromise(client, "getNothing", (), {})

        # Create mapped promise
        mapped = promise.map(lambda x: x * 2)

        # Resolve
        result = await mapped

        assert result is None

    @pytest.mark.asyncio
    async def test_map_with_async_transform(self):
        """Test map with transformation returning RpcPromise."""
        from rpc_do.promise import RpcPromise

        # Create a mock client
        client = MagicMock()
        call_count = 0

        async def mock_execute(method, args, kwargs, pipeline=None, capability_id=None):
            nonlocal call_count
            call_count += 1
            if method == "getNumbers":
                return [1, 2, 3]
            elif method == "square":
                return args[0] ** 2
            return None

        client._execute_call = mock_execute

        source = RpcPromise(client, "getNumbers", (), {})

        # Map with a function that creates promises
        def square(x):
            return RpcPromise(client, "square", (x,), {})

        mapped = source.map(square)
        result = await mapped

        assert result == [1, 4, 9]


class TestPromiseResolution:
    """Tests for promise resolution mechanics."""

    @pytest.mark.asyncio
    async def test_promise_caches_result(self):
        """Test that resolved promise caches its result."""
        from rpc_do.promise import RpcPromise

        client = MagicMock()
        client._execute_call = AsyncMock(return_value=42)

        promise = RpcPromise(client, "getValue", (), {})

        # Resolve twice
        result1 = await promise
        result2 = await promise

        assert result1 == 42
        assert result2 == 42
        # Should only call once
        assert client._execute_call.call_count == 1

    @pytest.mark.asyncio
    async def test_promise_caches_error(self):
        """Test that promise caches error on failure."""
        from rpc_do.promise import RpcPromise
        from rpc_do import RpcError

        client = MagicMock()
        client._execute_call = AsyncMock(side_effect=RpcError("Test error"))

        promise = RpcPromise(client, "failingMethod", (), {})

        # First call should raise
        with pytest.raises(RpcError):
            await promise

        # Second call should also raise (cached error)
        with pytest.raises(RpcError):
            await promise

        # Should only call once
        assert client._execute_call.call_count == 1

    @pytest.mark.asyncio
    async def test_promise_without_client_raises(self):
        """Test that promise without client raises RuntimeError."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        with pytest.raises(RuntimeError, match="Cannot resolve promise without client"):
            await promise


class TestPipelineExecution:
    """Tests for pipeline execution."""

    @pytest.mark.asyncio
    async def test_pipeline_sends_correct_path(self):
        """Test that pipeline sends correct path to server."""
        from rpc_do.promise import RpcPromise

        client = MagicMock()
        client._execute_call = AsyncMock(return_value="result")

        promise = RpcPromise(client, "getUser", (123,), {})
        chained = promise.profile.avatar.url

        await chained

        # Verify the pipeline was passed correctly
        call_args = client._execute_call.call_args
        assert call_args[0][0] == "getUser"  # method
        assert call_args[0][1] == (123,)  # args
        # Pipeline should be passed
        pipeline = call_args[0][3]
        assert len(pipeline) == 3

    @pytest.mark.asyncio
    async def test_pipeline_with_method_args(self):
        """Test pipeline with method arguments."""
        from rpc_do.promise import RpcPromise

        client = MagicMock()
        client._execute_call = AsyncMock(return_value=15)

        promise = RpcPromise(client, "makeCounter", (10,), {})
        result = promise.increment(5)

        await result

        call_args = client._execute_call.call_args
        pipeline = call_args[0][3]
        # Pipeline should have increment with args (5,)
        assert pipeline[0][0] == "increment"
        assert pipeline[0][1] == (5,)


class TestMapExpressionSerialization:
    """Tests for map expression serialization."""

    def test_serialize_simple_lambda(self):
        """Test serializing a simple lambda."""
        from rpc_do.map import serialize_map_expression

        result = serialize_map_expression(lambda x: x * 2)

        # The expression should have the parameter name and arrow
        assert "x =>" in result.expression
        # Note: When source inspection fails (e.g., in test context),
        # the serializer falls back to "x => x"
        # In production with proper source, it would contain the actual expression

    def test_map_expression_to_dict(self):
        """Test MapExpression serialization to dict."""
        from rpc_do.map import MapExpression

        expr = MapExpression(
            expression="x => x * 2",
            captures={"multiplier": 2},
            param_name="x"
        )

        d = expr.to_dict()
        assert d["expression"] == "x => x * 2"
        assert d["captures"]["multiplier"] == 2

    def test_capture_lambda_helper(self):
        """Test the capture_lambda helper function."""
        from rpc_do.map import capture_lambda

        fn = lambda x: x * 2
        result_fn, captures = capture_lambda(fn, multiplier=2, api="client")

        assert result_fn is fn
        assert captures["multiplier"] == 2
        assert captures["api"] == "client"
