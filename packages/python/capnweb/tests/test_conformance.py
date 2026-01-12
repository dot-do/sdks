"""
Conformance tests for the Python capnweb SDK.

These tests are generated from the YAML specifications in test/conformance/
and verify that the Python SDK correctly implements the capnweb protocol.
"""

import pytest
from typing import Any


class TestConformance:
    """
    Conformance test suite.

    Each test is generated from a YAML spec file and verifies a specific
    aspect of the capnweb protocol implementation.
    """

    @pytest.mark.asyncio
    async def test_conformance(self, api, conformance_test: dict[str, Any]):
        """
        Run a single conformance test from the YAML spec.

        This test is parametrized by pytest_generate_tests in conftest.py
        to run once for each test case defined in the conformance specs.
        """
        test_name = conformance_test["name"]
        category = conformance_test.get("_category", "unknown")

        # Skip if test infrastructure not ready
        if api is None:
            pytest.skip(f"SDK not implemented yet: {category}/{test_name}")

        # Handle different test types
        if "call" in conformance_test:
            await self._run_call_test(api, conformance_test)
        elif "pipeline" in conformance_test:
            await self._run_pipeline_test(api, conformance_test)
        elif "sequence" in conformance_test:
            await self._run_sequence_test(api, conformance_test)
        else:
            pytest.skip(f"Unknown test type: {test_name}")

    async def _run_call_test(self, api, spec: dict[str, Any]):
        """Execute a simple call test."""
        method_name = spec["call"]
        args = spec.get("args", [])

        # Get the method from the API
        method = getattr(api, method_name)

        # Handle variable substitution in args
        resolved_args = self._resolve_args(args, {})

        # Make the call
        if "expect_error" in spec:
            with pytest.raises(Exception) as exc_info:
                await method(*resolved_args)
            self._verify_error(exc_info.value, spec["expect_error"])
        else:
            result = await method(*resolved_args)
            expected = spec.get("expect")
            assert result == expected, f"Expected {expected}, got {result}"

    async def _run_pipeline_test(self, api, spec: dict[str, Any]):
        """Execute a pipeline test (multiple calls in one round trip)."""
        pipeline = spec["pipeline"]
        context = {"$self": api}

        # Build the pipeline
        for step in pipeline:
            call = step["call"]
            args = step.get("args", [])

            # Resolve the target (could be nested like "counter.increment")
            parts = call.split(".")
            target = context.get(f"${parts[0]}", api)
            for part in parts[1:] if len(parts) > 1 else [parts[0]]:
                target = getattr(target, part)

            # Make the call (but don't await yet - that's the point of pipelining!)
            resolved_args = self._resolve_args(args, context)
            result_promise = target(*resolved_args) if callable(target) else target

            # Store in context if named
            if "as" in step:
                context[f"${step['as']}"] = result_promise

        # Now await the final result(s)
        if "expect" in spec:
            # Await all promises and check results
            if isinstance(spec["expect"], dict):
                results = {}
                for key, expected in spec["expect"].items():
                    if f"${key}" in context:
                        results[key] = await context[f"${key}"]
                assert results == spec["expect"]
            else:
                # Get the last promise
                last_promise = list(context.values())[-1]
                result = await last_promise
                assert result == spec["expect"]

    async def _run_sequence_test(self, api, spec: dict[str, Any]):
        """Execute a sequence of calls (each awaited before next)."""
        context = spec.get("setup", {})
        context["$self"] = api

        for step in spec["sequence"]:
            call = step["call"]
            args = step.get("args", [])

            # Resolve target
            parts = call.split(".")
            if parts[0].startswith("$"):
                target = context[parts[0]]
                parts = parts[1:]
            else:
                target = api

            for part in parts:
                target = getattr(target, part)

            # Make and await call
            resolved_args = self._resolve_args(args, context)
            result = await target(*resolved_args) if callable(target) else await target

            # Check expectation
            if "expect" in step:
                assert result == step["expect"], f"Step {call}: expected {step['expect']}, got {result}"

            # Store result
            if "as" in step:
                context[f"${step['as']}"] = result

    def _resolve_args(self, args: list, context: dict) -> list:
        """Replace $variable references in arguments with actual values."""
        resolved = []
        for arg in args:
            if isinstance(arg, str) and arg.startswith("$"):
                resolved.append(context.get(arg, arg))
            else:
                resolved.append(arg)
        return resolved

    def _verify_error(self, error: Exception, expected: dict[str, Any]):
        """Verify an error matches the expected specification."""
        if "type" in expected:
            assert type(error).__name__ == expected["type"], \
                f"Expected {expected['type']}, got {type(error).__name__}"

        if "message" in expected:
            assert str(error) == expected["message"]

        if "message_contains" in expected:
            assert expected["message_contains"] in str(error), \
                f"Expected error to contain '{expected['message_contains']}', got '{error}'"


class TestBasicCalls:
    """Basic RPC call tests (language-specific additions)."""

    @pytest.mark.asyncio
    async def test_square_with_type_hints(self, api):
        """Test that square returns the correct type (Python-specific)."""
        pytest.skip("SDK not implemented yet")
        result = await api.square(5)
        assert isinstance(result, int)
        assert result == 25


class TestPythonSpecific:
    """Python-specific SDK tests (not from conformance specs)."""

    @pytest.mark.asyncio
    async def test_context_manager(self, server_url):
        """Test async context manager for session."""
        pytest.skip("SDK not implemented yet")
        # async with capnweb.connect(server_url) as api:
        #     result = await api.square(3)
        #     assert result == 9

    @pytest.mark.asyncio
    async def test_type_annotations(self, api):
        """Test that type annotations work with the API."""
        pytest.skip("SDK not implemented yet")
        # from capnweb import RpcPromise
        # promise: RpcPromise[int] = api.square(4)
        # result: int = await promise
        # assert result == 16
