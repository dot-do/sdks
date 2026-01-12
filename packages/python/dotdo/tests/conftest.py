"""
Pytest configuration and fixtures for dotdo package tests.

This module provides reusable fixtures for testing the DotDo platform SDK.
"""

import os
import pytest
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def api_key() -> str:
    """Provide a test API key."""
    return "test-api-key-12345"


@pytest.fixture
def mock_env_api_key(api_key: str):
    """Set up environment with API key."""
    with patch.dict(os.environ, {"DOTDO_API_KEY": api_key}):
        yield api_key


@pytest.fixture
def dotdo_config():
    """Create a test DotDoConfig."""
    from dotdo import DotDoConfig, RetryConfig

    return DotDoConfig(
        base_url="wss://test.api.dotdo.dev/rpc",
        api_key="fixture-api-key",
        timeout=10.0,
        pool_size=5,
        retry=RetryConfig(max_retries=2)
    )


@pytest.fixture
def retry_config():
    """Create a test RetryConfig."""
    from dotdo import RetryConfig

    return RetryConfig(
        max_retries=3,
        initial_delay=0.01,  # Fast for tests
        max_delay=0.1,
        exponential_base=2.0
    )


@pytest.fixture
def mock_rpc_client():
    """Create a mock RpcClient for testing."""
    client = MagicMock()
    client.connect = AsyncMock()
    client.disconnect = AsyncMock()
    client.call = AsyncMock(return_value={"status": "ok"})
    client.rpc = MagicMock()
    return client


@pytest.fixture
def mock_connection_pool(mock_rpc_client):
    """Create a mock ConnectionPool for testing."""
    pool = MagicMock()
    pool.acquire = AsyncMock(return_value=mock_rpc_client)
    pool.release = AsyncMock()
    pool.close = AsyncMock()
    return pool


@pytest.fixture
def dotdo_client(api_key: str):
    """Create a DotDo client instance for testing."""
    from dotdo import DotDo

    return DotDo(api_key=api_key)


@pytest.fixture
async def connected_dotdo_client(dotdo_client, mock_rpc_client, mock_connection_pool):
    """Create a connected DotDo client for testing."""
    # Patch internal state to simulate connection
    dotdo_client._client = mock_rpc_client
    dotdo_client._pool = mock_connection_pool
    dotdo_client._authenticated = True

    yield dotdo_client

    # Cleanup
    dotdo_client._client = None
    dotdo_client._pool = None
    dotdo_client._authenticated = False
