"""
Unit tests for the RpcProxy and RpcPromise classes.
"""

import pytest
from typing import Any


class TestRpcPromise:
    """Unit tests for RpcPromise."""

    def test_promise_is_awaitable(self):
        """Test that RpcPromise can be awaited."""
        from rpc_do.promise import RpcPromise

        # Create a promise using proper constructor
        promise = RpcPromise(None, "test", (), {})

        # Should have __await__ method
        assert hasattr(promise, "__await__")

    def test_promise_getattr_returns_promise(self):
        """Test that accessing attributes on a promise returns another promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Accessing a property should return another promise
        chained = promise.someProperty
        assert isinstance(chained, RpcPromise)

    def test_promise_call_returns_promise(self):
        """Test that calling a promise returns another promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Calling should return another promise
        called = promise(1, 2, 3)
        assert isinstance(called, RpcPromise)

    def test_promise_map_returns_promise(self):
        """Test that map() returns a promise."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # map() should return a promise
        mapped = promise.map(lambda x: x * 2)
        assert isinstance(mapped, RpcPromise)


class TestPipelining:
    """Test promise pipelining functionality."""

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
        assert len(url._pipeline) == 3  # profile, avatar, url

    def test_pipeline_method_call(self):
        """Test pipelining with method calls."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "makeCounter", (10,), {})

        # Chain: makeCounter(10).increment(5)
        increment = promise.increment
        result = increment(5)

        assert isinstance(result, RpcPromise)


class TestZeroSchema:
    """Test zero-schema proxy behavior."""

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


class TestMapFunction:
    """Test the map() function on promises."""

    def test_map_captures_function(self):
        """Test that map captures the transformation function."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        fn = lambda x: x * 2
        mapped = promise.map(fn)

        assert mapped._map_fn is fn

    def test_map_chain(self):
        """Test that map can be chained."""
        from rpc_do.promise import RpcPromise

        promise = RpcPromise(None, "test", (), {})

        # Chain multiple maps
        result = promise.map(lambda x: x * 2).map(lambda x: x + 1)

        assert isinstance(result, RpcPromise)
