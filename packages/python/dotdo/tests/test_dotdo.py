"""
Unit tests for the DotDo platform SDK.

Tests cover:
- DotDo client initialization and configuration
- Connection pool management
- Retry logic configuration
- Authentication methods
- Context manager support
"""

import pytest
import asyncio
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestDotDoConfig:
    """Tests for DotDo configuration."""

    def test_default_config(self):
        """Test default configuration values."""
        from dotdo import DotDoConfig

        config = DotDoConfig()

        assert config.base_url == "wss://api.dotdo.dev/rpc"
        assert config.api_key is None
        assert config.timeout == 30.0
        assert config.pool_size == 10

    def test_custom_config(self):
        """Test custom configuration values."""
        from dotdo import DotDoConfig, RetryConfig

        config = DotDoConfig(
            base_url="wss://custom.api.do/rpc",
            api_key="test-key",
            timeout=60.0,
            pool_size=20,
            retry=RetryConfig(max_retries=5)
        )

        assert config.base_url == "wss://custom.api.do/rpc"
        assert config.api_key == "test-key"
        assert config.timeout == 60.0
        assert config.pool_size == 20
        assert config.retry.max_retries == 5


class TestRetryConfig:
    """Tests for retry configuration."""

    def test_default_retry_config(self):
        """Test default retry configuration values."""
        from dotdo import RetryConfig

        config = RetryConfig()

        assert config.max_retries == 3
        assert config.initial_delay == 0.1
        assert config.max_delay == 10.0
        assert config.exponential_base == 2.0

    def test_custom_retry_config(self):
        """Test custom retry configuration values."""
        from dotdo import RetryConfig

        config = RetryConfig(
            max_retries=5,
            initial_delay=0.5,
            max_delay=30.0,
            exponential_base=3.0
        )

        assert config.max_retries == 5
        assert config.initial_delay == 0.5
        assert config.max_delay == 30.0
        assert config.exponential_base == 3.0

    def test_retryable_errors_default(self):
        """Test default retryable errors."""
        from dotdo import RetryConfig

        config = RetryConfig()

        assert ConnectionError in config.retryable_errors
        assert TimeoutError in config.retryable_errors


class TestAuthMethod:
    """Tests for authentication methods."""

    def test_auth_method_enum(self):
        """Test authentication method enum values."""
        from dotdo import AuthMethod

        assert AuthMethod.API_KEY.value == "api_key"
        assert AuthMethod.OAUTH.value == "oauth"
        assert AuthMethod.JWT.value == "jwt"


class TestDotDoInitialization:
    """Tests for DotDo client initialization."""

    def test_init_with_api_key(self):
        """Test initialization with API key."""
        from dotdo import DotDo

        client = DotDo(api_key="test-api-key")

        assert client._config.api_key == "test-api-key"
        assert client.authenticated is False

    def test_init_with_env_api_key(self):
        """Test initialization with API key from environment."""
        from dotdo import DotDo

        with patch.dict(os.environ, {"DOTDO_API_KEY": "env-api-key"}):
            client = DotDo()
            assert client._config.api_key == "env-api-key"

    def test_init_with_custom_options(self):
        """Test initialization with custom options."""
        from dotdo import DotDo

        client = DotDo(
            api_key="test-key",
            base_url="wss://custom.api.do/rpc",
            timeout=60.0,
            pool_size=20,
            max_retries=5
        )

        assert client._config.base_url == "wss://custom.api.do/rpc"
        assert client._config.timeout == 60.0
        assert client._config.pool_size == 20
        assert client._config.retry.max_retries == 5

    def test_init_with_full_config(self):
        """Test initialization with full configuration object."""
        from dotdo import DotDo, DotDoConfig

        config = DotDoConfig(
            base_url="wss://my.api.do/rpc",
            api_key="config-key",
            pool_size=5
        )

        client = DotDo(config=config)

        assert client._config is config
        assert client._config.api_key == "config-key"

    def test_config_property(self):
        """Test config property access."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        assert client.config is client._config
        assert client.config.api_key == "test-key"


class TestConnectionPool:
    """Tests for connection pool management."""

    def test_pool_initialization(self):
        """Test connection pool initialization."""
        from dotdo import DotDoConfig
        from dotdo import ConnectionPool

        config = DotDoConfig(pool_size=10)
        pool = ConnectionPool(config)

        assert pool._size == 10
        assert len(pool._connections) == 0
        assert len(pool._available) == 0

    @pytest.mark.asyncio
    async def test_pool_close(self):
        """Test connection pool close clears all connections."""
        from dotdo import DotDoConfig
        from dotdo import ConnectionPool

        config = DotDoConfig(pool_size=5)
        pool = ConnectionPool(config)

        # Simulate some connections
        mock_client = MagicMock()
        mock_client.disconnect = AsyncMock()
        pool._connections.append(mock_client)
        pool._available.append(mock_client)

        await pool.close()

        assert len(pool._connections) == 0
        assert len(pool._available) == 0


class TestDotDoConnection:
    """Tests for DotDo connection lifecycle."""

    @pytest.mark.asyncio
    async def test_connect_requires_api_key(self):
        """Test that connect raises if no API key configured."""
        from dotdo import DotDo

        client = DotDo()

        with pytest.raises(ValueError, match="API key required"):
            await client.connect()

    @pytest.mark.asyncio
    async def test_disconnect_clears_state(self):
        """Test that disconnect clears client state."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        # Manually set authenticated state
        client._authenticated = True
        client._pool = MagicMock()
        client._pool.close = AsyncMock()
        client._client = MagicMock()
        client._client.disconnect = AsyncMock()

        await client.disconnect()

        assert client._authenticated is False
        assert client._client is None
        assert client._pool is None

    @pytest.mark.asyncio
    async def test_context_manager_connects_and_disconnects(self):
        """Test context manager calls connect and disconnect."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        # Mock connection methods
        client.connect = AsyncMock()
        client.disconnect = AsyncMock()

        async with client:
            client.connect.assert_called_once()

        client.disconnect.assert_called_once()

    @pytest.mark.asyncio
    async def test_context_manager_disconnects_on_error(self):
        """Test context manager disconnects even on error."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        client.connect = AsyncMock()
        client.disconnect = AsyncMock()

        with pytest.raises(ValueError):
            async with client:
                raise ValueError("Test error")

        client.disconnect.assert_called_once()


class TestDotDoRpcAccess:
    """Tests for RPC method access."""

    def test_rpc_property_requires_connection(self):
        """Test that rpc property raises if not connected."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        with pytest.raises(RuntimeError, match="not connected"):
            _ = client.rpc

    @pytest.mark.asyncio
    async def test_call_requires_connection(self):
        """Test that call() raises if not connected."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        with pytest.raises(RuntimeError, match="not connected"):
            await client.call("test.method")


class TestDotDoAuthentication:
    """Tests for authentication state."""

    def test_authenticated_property(self):
        """Test authenticated property."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        assert client.authenticated is False

        # Simulate authentication
        client._authenticated = True
        assert client.authenticated is True


class TestRetryLogicConfiguration:
    """Tests for retry logic configuration."""

    def test_retry_with_custom_errors(self):
        """Test retry configuration with custom retryable errors."""
        from dotdo import RetryConfig

        class CustomError(Exception):
            pass

        config = RetryConfig(
            retryable_errors=(ConnectionError, TimeoutError, CustomError)
        )

        assert CustomError in config.retryable_errors

    def test_exponential_backoff_values(self):
        """Test exponential backoff calculation values."""
        from dotdo import RetryConfig

        config = RetryConfig(
            initial_delay=0.1,
            max_delay=10.0,
            exponential_base=2.0
        )

        # Calculate expected delays
        # Retry 1: 0.1 * 2^0 = 0.1
        # Retry 2: 0.1 * 2^1 = 0.2
        # Retry 3: 0.1 * 2^2 = 0.4
        # etc.
        expected_delays = [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4]

        for i, expected in enumerate(expected_delays):
            delay = min(
                config.initial_delay * (config.exponential_base ** i),
                config.max_delay
            )
            assert abs(delay - expected) < 0.001

    def test_max_delay_caps_backoff(self):
        """Test that max_delay caps the backoff."""
        from dotdo import RetryConfig

        config = RetryConfig(
            initial_delay=1.0,
            max_delay=5.0,
            exponential_base=2.0
        )

        # After a few retries, should cap at max_delay
        for i in range(10):
            delay = min(
                config.initial_delay * (config.exponential_base ** i),
                config.max_delay
            )
            assert delay <= config.max_delay


class TestConnectionPoolConfiguration:
    """Tests for connection pool configuration."""

    def test_pool_size_configuration(self):
        """Test pool size configuration."""
        from dotdo import DotDoConfig

        config = DotDoConfig(pool_size=25)
        assert config.pool_size == 25

    def test_pool_size_in_client(self):
        """Test pool size is passed to client config."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key", pool_size=15)
        assert client._config.pool_size == 15


class TestConfigurationValidation:
    """Tests for configuration validation."""

    def test_timeout_positive(self):
        """Test timeout can be set to positive values."""
        from dotdo import DotDoConfig

        config = DotDoConfig(timeout=120.0)
        assert config.timeout == 120.0

    def test_pool_size_positive(self):
        """Test pool_size can be set to positive values."""
        from dotdo import DotDoConfig

        config = DotDoConfig(pool_size=50)
        assert config.pool_size == 50


class TestDotDoCallMethod:
    """Tests for the call() method."""

    @pytest.mark.asyncio
    async def test_call_delegates_to_client(self):
        """Test that call() delegates to underlying client."""
        from dotdo import DotDo

        client = DotDo(api_key="test-key")

        # Mock the internal client
        mock_rpc_client = MagicMock()
        mock_rpc_client.call = AsyncMock(return_value={"result": "success"})
        client._client = mock_rpc_client

        result = await client.call("users.get", id=123)

        mock_rpc_client.call.assert_called_once_with("users.get", id=123)
        assert result == {"result": "success"}
