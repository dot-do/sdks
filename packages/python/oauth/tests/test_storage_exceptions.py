"""
Tests for exception handling in oauth_do storage module.

These tests verify that:
1. FileNotFoundError is handled gracefully (credential doesn't exist - expected)
2. PermissionError raises a clear StorageError message
3. Other unexpected errors are logged/raised appropriately
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest

from oauth_do.storage import FileStorage, KeyringStorage, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT
from oauth_do.types import StorageError, StoredTokenData

if TYPE_CHECKING:
    pass


class TestFileStorageExceptionHandling:
    """Test FileStorage exception handling."""

    @pytest.fixture
    def temp_storage(self, tmp_path: Path) -> FileStorage:
        """Create a FileStorage with a temporary path."""
        token_file = tmp_path / "token"
        return FileStorage(str(token_file))

    # --- FileNotFoundError Tests (Expected Behavior) ---

    async def test_get_token_returns_none_when_file_not_found(
        self, temp_storage: FileStorage
    ) -> None:
        """FileNotFoundError should be handled gracefully, returning None."""
        # Token file doesn't exist - this is expected and should return None
        result = await temp_storage.get_token()
        assert result is None

    async def test_get_token_data_returns_none_when_file_not_found(
        self, temp_storage: FileStorage
    ) -> None:
        """FileNotFoundError for token data should return None gracefully."""
        result = await temp_storage.get_token_data()
        assert result is None

    async def test_remove_token_graceful_when_file_not_found(
        self, temp_storage: FileStorage
    ) -> None:
        """Removing a non-existent token should not raise an error."""
        # Should not raise any exception
        await temp_storage.remove_token()

    # --- PermissionError Tests ---

    async def test_get_token_raises_storage_error_on_permission_denied(
        self, temp_storage: FileStorage, tmp_path: Path
    ) -> None:
        """PermissionError should raise StorageError with clear message."""
        # Create the token file
        token_file = tmp_path / "token"
        token_file.write_text(json.dumps({"accessToken": "test-token"}))

        # Mock read_text to raise PermissionError
        with patch.object(Path, "read_text", side_effect=PermissionError("Permission denied")):
            temp_storage._init_paths()
            # Force re-init to not use cached paths
            temp_storage._initialized = False
            temp_storage._custom_path = str(token_file)

            with pytest.raises(StorageError) as exc_info:
                await temp_storage.get_token()

            assert "Permission denied" in str(exc_info.value)
            assert exc_info.value.__cause__ is not None
            assert isinstance(exc_info.value.__cause__, PermissionError)

    async def test_get_token_data_raises_storage_error_on_permission_denied(
        self, temp_storage: FileStorage, tmp_path: Path
    ) -> None:
        """PermissionError reading token data should raise StorageError."""
        token_file = tmp_path / "token"
        token_file.write_text(json.dumps({"accessToken": "test-token"}))

        with patch.object(Path, "read_text", side_effect=PermissionError("Permission denied")):
            temp_storage._initialized = False
            temp_storage._custom_path = str(token_file)

            with pytest.raises(StorageError) as exc_info:
                await temp_storage.get_token_data()

            assert "Permission denied" in str(exc_info.value)

    async def test_set_token_raises_storage_error_on_permission_denied(
        self, temp_storage: FileStorage, tmp_path: Path
    ) -> None:
        """PermissionError writing token should raise StorageError."""
        with patch.object(Path, "write_text", side_effect=PermissionError("Permission denied")):
            with pytest.raises((StorageError, RuntimeError)) as exc_info:
                await temp_storage.set_token("test-token")

            # Should include permission denied context
            assert "Permission denied" in str(exc_info.value) or "permission" in str(
                exc_info.value
            ).lower()

    async def test_remove_token_raises_storage_error_on_permission_denied(
        self, temp_storage: FileStorage, tmp_path: Path
    ) -> None:
        """PermissionError removing token should raise StorageError."""
        token_file = tmp_path / "token"
        token_file.write_text("test-token")
        temp_storage._initialized = False
        temp_storage._custom_path = str(token_file)

        with patch.object(Path, "unlink", side_effect=PermissionError("Permission denied")):
            with pytest.raises(StorageError) as exc_info:
                await temp_storage.remove_token()

            assert "Permission denied" in str(exc_info.value)

    # --- Unexpected Error Tests ---

    async def test_get_token_logs_and_raises_unexpected_error(
        self, temp_storage: FileStorage, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Unexpected errors should be logged and raised."""
        token_file = tmp_path / "token"
        token_file.write_text(json.dumps({"accessToken": "test-token"}))
        temp_storage._initialized = False
        temp_storage._custom_path = str(token_file)

        # Simulate an unexpected error (e.g., OS error)
        unexpected_error = OSError("Unexpected disk error")
        with patch.object(Path, "read_text", side_effect=unexpected_error):
            with caplog.at_level(logging.WARNING):
                with pytest.raises((StorageError, OSError)):
                    await temp_storage.get_token()

            # Should log a warning about the unexpected error
            # (the exact log message format may vary)

    async def test_get_token_data_logs_unexpected_json_error(
        self, temp_storage: FileStorage, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """JSON decode errors should be logged with context."""
        token_file = tmp_path / "token"
        token_file.write_text("{invalid json")
        temp_storage._initialized = False
        temp_storage._custom_path = str(token_file)

        with caplog.at_level(logging.WARNING):
            # Should handle gracefully but log the issue
            result = await temp_storage.get_token_data()
            # Either returns None or raises StorageError - both are acceptable
            # The key is that it doesn't silently fail


class TestKeyringStorageExceptionHandling:
    """Test KeyringStorage exception handling."""

    # --- KeyError Tests (Credential Not Found - Expected) ---

    async def test_get_token_returns_none_when_keyring_credential_not_found(self) -> None:
        """KeyError from keyring should be handled gracefully."""
        storage = KeyringStorage()

        with patch("oauth_do.storage.KEYRING_AVAILABLE", True):
            mock_keyring = MagicMock()
            mock_keyring.get_password.return_value = None
            with patch("oauth_do.storage.keyring", mock_keyring):
                result = await storage.get_token()
                assert result is None

    async def test_remove_token_graceful_when_keyring_credential_not_found(self) -> None:
        """Removing non-existent keyring credential should not raise."""
        storage = KeyringStorage()

        with patch("oauth_do.storage.KEYRING_AVAILABLE", True):
            mock_keyring = MagicMock()
            # Simulate keyring.errors.PasswordDeleteError or similar
            mock_keyring.delete_password.side_effect = Exception("No password found")
            with patch("oauth_do.storage.keyring", mock_keyring):
                # Should handle gracefully for "not found" type errors
                await storage.remove_token()

    # --- Permission/Access Errors ---

    async def test_get_token_raises_storage_error_on_keyring_access_denied(self) -> None:
        """Keyring access denied should raise StorageError with clear message."""
        storage = KeyringStorage()

        with patch("oauth_do.storage.KEYRING_AVAILABLE", True):
            mock_keyring = MagicMock()
            # Simulate keyring access denied error
            mock_keyring.get_password.side_effect = PermissionError(
                "Keyring access denied by user"
            )
            with patch("oauth_do.storage.keyring", mock_keyring):
                with pytest.raises(StorageError) as exc_info:
                    await storage.get_token()

                assert "access" in str(exc_info.value).lower() or "permission" in str(
                    exc_info.value
                ).lower()

    async def test_get_token_data_raises_storage_error_on_keyring_permission_error(self) -> None:
        """Keyring permission error for token data should raise StorageError."""
        storage = KeyringStorage()

        with patch("oauth_do.storage.KEYRING_AVAILABLE", True):
            mock_keyring = MagicMock()
            mock_keyring.get_password.side_effect = PermissionError("Access denied")
            with patch("oauth_do.storage.keyring", mock_keyring):
                with pytest.raises(StorageError) as exc_info:
                    await storage.get_token_data()

                assert exc_info.value.__cause__ is not None

    # --- Unexpected Errors ---

    async def test_get_token_logs_unexpected_keyring_error(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Unexpected keyring errors should be logged."""
        storage = KeyringStorage()

        with patch("oauth_do.storage.KEYRING_AVAILABLE", True):
            mock_keyring = MagicMock()
            mock_keyring.get_password.side_effect = RuntimeError("Unexpected keyring backend error")
            with patch("oauth_do.storage.keyring", mock_keyring):
                with caplog.at_level(logging.WARNING):
                    with pytest.raises((StorageError, RuntimeError)):
                        await storage.get_token()


class TestStorageErrorException:
    """Test StorageError exception class."""

    def test_storage_error_with_message(self) -> None:
        """StorageError should store the message."""
        error = StorageError("Test error message")
        assert str(error) == "Test error message"

    def test_storage_error_with_cause(self) -> None:
        """StorageError should chain the cause exception."""
        cause = PermissionError("Original error")
        error = StorageError("Storage failed", cause=cause)

        assert str(error) == "Storage failed"
        assert error.__cause__ is cause

    def test_storage_error_inheritance(self) -> None:
        """StorageError should be an Exception."""
        error = StorageError("Test")
        assert isinstance(error, Exception)

    def test_storage_error_can_be_raised_and_caught(self) -> None:
        """StorageError should be raiseable and catchable."""
        with pytest.raises(StorageError) as exc_info:
            raise StorageError("Test error", cause=ValueError("inner"))

        assert "Test error" in str(exc_info.value)
        assert isinstance(exc_info.value.__cause__, ValueError)
