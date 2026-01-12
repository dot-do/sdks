"""
Tests for {{Name}}Client.
"""

import pytest
from {{name}}_do import {{Name}}Client


class Test{{Name}}Client:
    """Tests for the {{Name}}Client class."""

    def test_create_client_with_defaults(self) -> None:
        """Test creating a client with default options."""
        client = {{Name}}Client()
        assert client.base_url == "https://{{name}}.do"
        assert client.api_key is None

    def test_create_client_with_api_key(self) -> None:
        """Test creating a client with an API key."""
        client = {{Name}}Client(api_key="test-key")
        assert client.api_key == "test-key"

    def test_create_client_with_custom_url(self) -> None:
        """Test creating a client with a custom base URL."""
        client = {{Name}}Client(base_url="https://custom.{{name}}.do")
        assert client.base_url == "https://custom.{{name}}.do"
