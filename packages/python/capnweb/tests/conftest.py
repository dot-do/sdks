"""
Pytest configuration and fixtures for capnweb conformance tests.

This module provides fixtures for connecting to the test server and
loading conformance test specifications.
"""

import os
import pytest
import yaml
from pathlib import Path
from typing import Generator, Any

# These will be implemented in the actual SDK
# For now, we define stubs to show the expected interface


class MockRpcPromise:
    """Mock RPC Promise for test scaffolding."""
    def __init__(self, value):
        self._value = value

    async def __await__(self):
        return self._value

    def __getattr__(self, name):
        return MockRpcPromise(None)

    def __call__(self, *args):
        return MockRpcPromise(None)


class MockSession:
    """Mock session for test scaffolding."""
    def __init__(self, url: str):
        self.url = url
        self.api = MockRpcPromise(None)

    async def close(self):
        pass


async def connect(url: str) -> MockSession:
    """Mock connect function."""
    return MockSession(url)


# Fixtures

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
    # Default: relative to this file
    return Path(__file__).parent.parent.parent.parent / "test" / "conformance"


@pytest.fixture
async def session(server_url: str) -> Generator[MockSession, None, None]:
    """Create a session connected to the test server."""
    # TODO: Replace with actual capnweb.connect when SDK is implemented
    sess = await connect(server_url)
    yield sess
    await sess.close()


@pytest.fixture
async def api(session: MockSession):
    """Get the API stub from a session."""
    return session.api


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
            Path(__file__).parent.parent.parent.parent / "test" / "conformance"
        ))
        tests = load_test_specs(spec_dir)
        metafunc.parametrize(
            "conformance_test",
            tests,
            ids=[t["name"] for t in tests]
        )
