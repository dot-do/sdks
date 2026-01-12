"""
Pytest configuration and fixtures for rpc-do tests.

This module provides fixtures for:
- Connecting to the test server
- Loading conformance test specifications
- Mocking RPC clients for unit tests
- Reusable test utilities

To run conformance tests, you need the test server running:
    cd /path/to/dot-do-capnweb
    npm run test:server

Then run tests:
    cd packages/python/rpc
    PYTHONPATH=src pytest tests/test_conformance.py -v
"""

import os
import socket
import asyncio
import pytest
import yaml
from pathlib import Path
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock


def is_server_available(host: str = "localhost", port: int = 8787) -> bool:
    """Check if the test server is running."""
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except (socket.error, socket.timeout):
        return False


# ============================================================================
# Unit Test Fixtures
# ============================================================================

@pytest.fixture
def mock_websocket():
    """Create a mock WebSocket connection."""
    ws = MagicMock()
    ws.send = AsyncMock()
    ws.recv = AsyncMock(return_value='["resolve", 1, 42]')
    ws.close = AsyncMock()
    return ws


@pytest.fixture
def mock_rpc_client():
    """Create a mock RpcClient for unit testing."""
    from rpc_do import RpcClient

    client = RpcClient("ws://localhost:8787")
    return client


@pytest.fixture
def mock_connected_client(mock_websocket):
    """Create an RpcClient with mocked WebSocket."""
    from rpc_do import RpcClient

    client = RpcClient("ws://localhost:8787")
    client._ws = mock_websocket
    client._closed = False
    return client


@pytest.fixture
def rpc_promise():
    """Create an RpcPromise for testing."""
    from rpc_do.promise import RpcPromise

    return RpcPromise(None, "testMethod", (), {})


@pytest.fixture
def mock_client_with_execute():
    """Create a mock client with _execute_call method."""
    client = MagicMock()
    client._execute_call = AsyncMock(return_value={"status": "ok"})
    return client


# ============================================================================
# Integration Test Fixtures
# ============================================================================

@pytest.fixture(scope="session")
def server_url() -> str:
    """Get the test server URL from environment."""
    url = os.environ.get("TEST_SERVER_URL", "http://localhost:8787")
    return url


@pytest.fixture(scope="session")
def server_ws_url(server_url: str) -> str:
    """Get the WebSocket URL for the test server."""
    return server_url.replace("http://", "ws://").replace("https://", "wss://")


@pytest.fixture(scope="session")
def spec_dir() -> Path:
    """Get the conformance test spec directory."""
    env_dir = os.environ.get("TEST_SPEC_DIR")
    if env_dir:
        return Path(env_dir)
    # Default: relative to this file - go up to dot-do-capnweb root
    return Path(__file__).parent.parent.parent.parent.parent / "test" / "conformance"


@pytest.fixture(scope="session")
def server_available() -> bool:
    """Check if the test server is available."""
    host = os.environ.get("TEST_SERVER_HOST", "localhost")
    port = int(os.environ.get("TEST_SERVER_PORT", "8787"))
    return is_server_available(host, port)


@pytest.fixture
async def client(server_ws_url: str, server_available: bool) -> AsyncGenerator[Any, None]:
    """Create a client connected to the test server."""
    if not server_available:
        pytest.skip(
            "Test server not available. Run 'npm run test:server' in the "
            "dot-do-capnweb root directory."
        )

    from rpc_do import connect

    try:
        client = await connect(server_ws_url)
        yield client
        await client.close()
    except Exception as e:
        pytest.skip(f"Could not connect to test server: {e}")


def load_test_specs(spec_dir: Path) -> list[dict[str, Any]]:
    """Load all conformance test specifications from YAML files."""
    specs = []
    if not spec_dir.exists():
        return specs

    for spec_file in sorted(spec_dir.glob("*.yaml")):
        with open(spec_file) as f:
            spec = yaml.safe_load(f)
            if spec and "tests" in spec:
                for test in spec["tests"]:
                    test["_file"] = spec_file.name
                    test["_category"] = spec.get("name", spec_file.stem)
                    specs.append(test)
    return specs


def pytest_generate_tests(metafunc):
    """Generate test cases from conformance specs."""
    if "conformance_test" in metafunc.fixturenames:
        spec_dir = Path(os.environ.get(
            "TEST_SPEC_DIR",
            Path(__file__).parent.parent.parent.parent.parent / "test" / "conformance"
        ))
        tests = load_test_specs(spec_dir)
        if tests:
            metafunc.parametrize(
                "conformance_test",
                tests,
                ids=[f"{t.get('_category', 'test')}::{t['name']}" for t in tests]
            )
        else:
            # No tests found - skip
            metafunc.parametrize("conformance_test", [{}], ids=["no_specs_found"])
