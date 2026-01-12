"""Tests for oauth_do.storage module - JSON schema validation."""

from __future__ import annotations

import json
import pytest

from oauth_do.storage import parse_token_data, TokenDataValidationError
from oauth_do.types import StoredTokenData


class TestParseTokenData:
    """Tests for parse_token_data function with JSON schema validation."""

    def test_valid_token_json_with_camel_case(self) -> None:
        """Valid token JSON with camelCase field names is accepted."""
        data = json.dumps({
            "accessToken": "test_access_token_123",
            "refreshToken": "test_refresh_token_456",
            "expiresAt": 1704067200000,
        })

        result = parse_token_data(data)

        assert isinstance(result, StoredTokenData)
        assert result.access_token == "test_access_token_123"
        assert result.refresh_token == "test_refresh_token_456"
        assert result.expires_at == 1704067200000

    def test_valid_token_json_with_snake_case(self) -> None:
        """Valid token JSON with snake_case field names is accepted."""
        data = json.dumps({
            "access_token": "test_access_token_123",
            "refresh_token": "test_refresh_token_456",
            "expires_at": 1704067200000,
        })

        result = parse_token_data(data)

        assert isinstance(result, StoredTokenData)
        assert result.access_token == "test_access_token_123"
        assert result.refresh_token == "test_refresh_token_456"
        assert result.expires_at == 1704067200000

    def test_valid_token_minimal_fields(self) -> None:
        """Valid token JSON with only required accessToken field."""
        data = json.dumps({"accessToken": "minimal_token"})

        result = parse_token_data(data)

        assert result.access_token == "minimal_token"
        assert result.refresh_token is None
        assert result.expires_at is None

    def test_valid_token_with_token_type(self) -> None:
        """Valid token JSON with tokenType field is accepted."""
        data = json.dumps({
            "accessToken": "test_token",
            "tokenType": "Bearer",
        })

        result = parse_token_data(data)

        assert result.access_token == "test_token"

    def test_malformed_json_raises_clear_error(self) -> None:
        """Malformed JSON raises clear TokenDataValidationError."""
        invalid_json = '{"accessToken": "token", invalid}'

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(invalid_json)

        assert "Invalid JSON" in str(exc_info.value) or "malformed" in str(exc_info.value).lower()

    def test_empty_string_raises_clear_error(self) -> None:
        """Empty string raises clear error."""
        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data("")

        assert "Invalid" in str(exc_info.value) or "empty" in str(exc_info.value).lower()

    def test_missing_required_access_token_raises_error(self) -> None:
        """JSON missing required accessToken field raises clear error."""
        data = json.dumps({
            "refreshToken": "refresh_only",
            "expiresAt": 1704067200000,
        })

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "access" in error_msg or "required" in error_msg or "missing" in error_msg

    def test_empty_access_token_raises_error(self) -> None:
        """Empty accessToken value raises clear error."""
        data = json.dumps({"accessToken": ""})

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "access" in error_msg or "empty" in error_msg or "required" in error_msg

    def test_null_access_token_raises_error(self) -> None:
        """Null accessToken value raises clear error."""
        data = json.dumps({"accessToken": None})

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "access" in error_msg or "null" in error_msg or "required" in error_msg

    def test_wrong_type_access_token_raises_error(self) -> None:
        """Non-string accessToken value raises clear error."""
        data = json.dumps({"accessToken": 12345})

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "type" in error_msg or "string" in error_msg or "access" in error_msg

    def test_wrong_type_expires_at_raises_error(self) -> None:
        """Non-integer expiresAt value raises clear error."""
        data = json.dumps({
            "accessToken": "valid_token",
            "expiresAt": "not_a_number",
        })

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "type" in error_msg or "int" in error_msg or "expires" in error_msg

    def test_extra_fields_are_ignored_forward_compatibility(self) -> None:
        """Extra fields in JSON are ignored for forward compatibility."""
        data = json.dumps({
            "accessToken": "test_token",
            "refreshToken": "refresh",
            "expiresAt": 1704067200000,
            "futureField": "some_value",
            "anotherNewField": {"nested": "data"},
            "version": 2,
        })

        result = parse_token_data(data)

        # Should successfully parse without error
        assert result.access_token == "test_token"
        assert result.refresh_token == "refresh"
        assert result.expires_at == 1704067200000

    def test_extra_fields_with_only_access_token(self) -> None:
        """Extra fields with minimal required fields are handled."""
        data = json.dumps({
            "accessToken": "test_token",
            "unknownField": "ignored",
        })

        result = parse_token_data(data)

        assert result.access_token == "test_token"
        assert result.refresh_token is None

    def test_non_object_json_raises_error(self) -> None:
        """JSON that parses to non-object raises error."""
        # JSON array
        with pytest.raises(TokenDataValidationError):
            parse_token_data('["accessToken", "value"]')

        # JSON string
        with pytest.raises(TokenDataValidationError):
            parse_token_data('"just a string"')

        # JSON number
        with pytest.raises(TokenDataValidationError):
            parse_token_data('12345')

    def test_whitespace_only_access_token_raises_error(self) -> None:
        """Whitespace-only accessToken value raises error."""
        data = json.dumps({"accessToken": "   "})

        with pytest.raises(TokenDataValidationError) as exc_info:
            parse_token_data(data)

        error_msg = str(exc_info.value).lower()
        assert "access" in error_msg or "empty" in error_msg or "whitespace" in error_msg


class TestTokenDataValidationError:
    """Tests for TokenDataValidationError exception."""

    def test_exception_is_subclass_of_storage_error(self) -> None:
        """TokenDataValidationError is a StorageError subclass."""
        from oauth_do.types import StorageError

        error = TokenDataValidationError("test error")
        assert isinstance(error, StorageError)

    def test_exception_message_is_preserved(self) -> None:
        """Exception message is preserved and accessible."""
        error = TokenDataValidationError("Custom error message")
        assert str(error) == "Custom error message"

    def test_exception_can_wrap_cause(self) -> None:
        """Exception can wrap an underlying cause."""
        cause = ValueError("Original error")
        error = TokenDataValidationError("Wrapper message", cause=cause)
        assert error.__cause__ is cause
