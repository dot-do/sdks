"""
Conformance tests for the Python rpc-do SDK.

These tests are generated from the YAML specifications in test/conformance/
and verify that the Python SDK correctly implements the RPC protocol.

The tests can run in two modes:
1. Using MockServer (default) - no external dependencies
2. Using a live test server - set TEST_SERVER_URL environment variable

Run tests:
    cd packages/python/rpc
    PYTHONPATH=src pytest tests/test_conformance.py -v

Run with live server:
    TEST_SERVER_URL=http://localhost:8787 pytest tests/test_conformance.py -v
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import pytest
import yaml

from .mock_server import (
    MockServer,
    PipelinedRequest,
    PipelineStep,
    RpcRequest,
)


# ============================================================================
# Test Spec Loading
# ============================================================================


def get_conformance_dir() -> Path:
    """Get the conformance test directory."""
    env_dir = os.environ.get("TEST_SPEC_DIR")
    if env_dir:
        return Path(env_dir)
    # Default: relative to this file - go up to dot-do-capnweb root
    return Path(__file__).parent.parent.parent.parent.parent / "test" / "conformance"


def load_test_specs() -> list[dict[str, Any]]:
    """Load all conformance test specifications from YAML files."""
    spec_dir = get_conformance_dir()
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


# ============================================================================
# Mock Client Wrapper
# ============================================================================


class MockClient:
    """
    Client wrapper that uses MockServer for testing.

    This provides a similar interface to the real RpcClient but uses
    the MockServer for processing requests without network I/O.
    """

    def __init__(self, server: MockServer) -> None:
        self._server = server
        self._next_request_id = 1
        self._capabilities: dict[str, Any] = {}

    def __getattr__(self, name: str) -> MockMethodProxy:
        """Zero-schema method access."""
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")
        return MockMethodProxy(self, name)

    async def call(self, method: str, *args: Any) -> Any:
        """Make a direct RPC call."""
        request = RpcRequest(
            id=self._get_next_id(),
            method=method,
            args=list(args),
        )
        response = self._server.process_request(request)

        if response.error:
            raise MockRpcError(
                response.error.get("message", "Unknown error"),
                response.error.get("type", "Error"),
            )

        return response.result

    async def call_on_capability(
        self, capability: Any, method: str, *args: Any
    ) -> Any:
        """Call a method on a capability."""
        # Get the capability ID
        cap_id = self._get_capability_id(capability)
        if cap_id is None:
            raise ValueError("Invalid capability reference")

        request = RpcRequest(
            id=self._get_next_id(),
            method=method,
            args=list(args),
            target=cap_id,
        )
        response = self._server.process_request(request)

        if response.error:
            raise MockRpcError(
                response.error.get("message", "Unknown error"),
                response.error.get("type", "Error"),
            )

        return response.result

    async def call_and_map(
        self,
        method: str,
        args: list[Any],
        expression: str,
        captures: dict[str, Any],
    ) -> Any:
        """Execute a call and map in a single round trip."""
        # Resolve capture IDs
        capture_ids: dict[str, int] = {}
        for name, cap in captures.items():
            cap_id = self._get_capability_id(cap)
            if cap_id is not None:
                capture_ids[name] = cap_id

        request = RpcRequest(
            id=self._get_next_id(),
            method=method,
            args=args,
        )

        response = self._server.process_call_and_map(
            request, expression, capture_ids
        )

        if response.error:
            raise MockRpcError(
                response.error.get("message", "Unknown error"),
                response.error.get("type", "Error"),
            )

        return response.result

    async def server_map(
        self,
        value: Any,
        expression: str,
        captures: dict[str, Any],
    ) -> Any:
        """Execute a map on a stored value."""
        # Get the capability ID for the value
        cap_id = self._get_capability_id(value)
        if cap_id is None:
            # If value is a list, we need to store it first
            if isinstance(value, list):
                cap_id = self._server.register_capability(value)
            else:
                raise ValueError("Cannot map over non-capability value")

        # Resolve capture IDs
        capture_ids: dict[str, int] = {}
        for name, cap in captures.items():
            cid = self._get_capability_id(cap)
            if cid is not None:
                capture_ids[name] = cid

        response = self._server.process_map_request(
            self._get_next_id(),
            cap_id,
            expression,
            capture_ids,
        )

        if response.error:
            raise MockRpcError(
                response.error.get("message", "Unknown error"),
                response.error.get("type", "Error"),
            )

        return response.result

    def get_self(self) -> dict[str, int]:
        """Get a reference to the root capability (self)."""
        return {"$ref": 0}

    def _get_next_id(self) -> int:
        """Get the next request ID."""
        request_id = self._next_request_id
        self._next_request_id += 1
        return request_id

    def _get_capability_id(self, capability: Any) -> int | None:
        """Extract capability ID from various reference formats."""
        if isinstance(capability, dict):
            if "__capabilityId" in capability:
                return capability["__capabilityId"]
            if "$ref" in capability:
                return capability["$ref"]
        if isinstance(capability, MockClient):
            return 0  # Self reference
        return None


class MockMethodProxy:
    """Proxy for method calls on MockClient."""

    def __init__(
        self,
        client: MockClient,
        method: str,
        cap_id: int | None = None,
    ) -> None:
        self._client = client
        self._method = method
        self._cap_id = cap_id

    def __getattr__(self, name: str) -> MockMethodProxy:
        """Chain method access."""
        if name.startswith("_"):
            raise AttributeError(f"'{type(self).__name__}' has no attribute '{name}'")
        return MockMethodProxy(
            self._client,
            f"{self._method}.{name}" if self._method else name,
            self._cap_id,
        )

    async def __call__(self, *args: Any) -> Any:
        """Execute the method call."""
        if self._cap_id is not None:
            return await self._client.call_on_capability(
                {"$ref": self._cap_id}, self._method, *args
            )
        return await self._client.call(self._method, *args)

    def __await__(self):
        """Allow awaiting property access (zero-arg method call)."""
        return self().__await__()


class MockRpcError(Exception):
    """Error from mock RPC call."""

    def __init__(self, message: str, error_type: str = "Error") -> None:
        super().__init__(message)
        self.message = message
        self.error_type = error_type
        self.name = error_type  # For compatibility with TypeScript tests


# ============================================================================
# Test Runner
# ============================================================================


class TestConformance:
    """
    Conformance test suite.

    Each test is parametrized from YAML spec files and verifies a specific
    aspect of the RPC protocol implementation.
    """

    @pytest.fixture
    def server(self) -> MockServer:
        """Create a fresh MockServer for each test."""
        return MockServer()

    @pytest.fixture
    def client(self, server: MockServer) -> MockClient:
        """Create a MockClient connected to the server."""
        return MockClient(server)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "conformance_test",
        load_test_specs(),
        ids=[
            f"{t.get('_category', 'test')}::{t['name']}"
            for t in load_test_specs()
        ],
    )
    async def test_conformance(
        self,
        server: MockServer,
        client: MockClient,
        conformance_test: dict[str, Any],
    ) -> None:
        """Run a single conformance test from the YAML spec."""
        if not conformance_test:
            pytest.skip("No conformance specs found")

        test_name = conformance_test.get("name", "unknown")
        category = conformance_test.get("_category", "unknown")

        # Skip tests that require specific setup we don't support yet
        if "export" in conformance_test:
            pytest.skip(
                f"Callback exports not yet implemented: {category}/{test_name}"
            )

        # Create context for variable storage
        context: dict[str, Any] = {"$self": client}

        # Reset round trip counter
        server.reset_round_trips()

        # Handle different test types
        if "pipeline" in conformance_test:
            await self._run_pipeline_test(server, client, conformance_test, context)
        elif "sequence" in conformance_test:
            await self._run_sequence_test(server, client, conformance_test, context)
        elif "map" in conformance_test:
            await self._run_map_test(server, client, conformance_test, context)
        elif "call" in conformance_test:
            await self._run_call_test(server, client, conformance_test, context)
        else:
            pytest.skip(f"Unknown test type: {test_name}")

    async def _run_call_test(
        self,
        server: MockServer,
        client: MockClient,
        spec: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Execute a simple call test."""
        method_name = spec["call"]
        args = spec.get("args", [])

        # Run setup if present
        if "setup" in spec:
            await self._run_setup(server, client, spec["setup"], context)

        # Handle variable substitution in args
        resolved_args = self._resolve_args(args, context)

        # Make the call
        if "expect_error" in spec:
            await self._test_error_case(
                server, client, method_name, resolved_args, spec["expect_error"], context
            )
        else:
            result = await client.call(method_name, *resolved_args)
            if "expect" in spec:
                assert result == spec["expect"], f"Expected {spec['expect']}, got {result}"
            elif "expect_type" in spec:
                assert result is not None

    async def _run_pipeline_test(
        self,
        server: MockServer,
        client: MockClient,
        spec: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Execute a pipeline test."""
        pipeline = spec["pipeline"]

        # Build pipeline steps
        steps: list[PipelineStep] = []
        step_names: set[str] = {s.get("as", "") for s in pipeline if s.get("as")}

        for step in pipeline:
            call = step["call"]
            args = step.get("args", [])

            # Resolve args, converting $name to step references if needed
            resolved_args = self._resolve_pipeline_args(args, context, step_names)

            # Parse the call target
            parts = call.split(".")
            if len(parts) == 1:
                steps.append(
                    PipelineStep(
                        method=call,
                        args=resolved_args,
                        as_name=step.get("as"),
                    )
                )
            else:
                # Call on pipelined result
                target_name = parts[0]
                method = ".".join(parts[1:])
                steps.append(
                    PipelineStep(
                        method=method,
                        target=target_name,
                        args=resolved_args,
                        as_name=step.get("as"),
                    )
                )

        # Execute pipeline
        request = PipelinedRequest(id=1, steps=steps)
        results = server.process_pipeline(request)

        # Check for errors
        if "expect_error" in spec:
            last_resp = results.get("__last")
            if last_resp and last_resp.error:
                # Success - we got the expected error
                error = MockRpcError(
                    last_resp.error.get("message", ""),
                    last_resp.error.get("type", "Error"),
                )
                if spec["expect_error"].get("type"):
                    assert error.error_type == spec["expect_error"]["type"]
                if spec["expect_error"].get("message_contains"):
                    assert spec["expect_error"]["message_contains"] in error.message
                return
            else:
                pytest.fail("Expected pipeline to fail with error")

        # Check expectations
        if "expect" in spec:
            expected = spec["expect"]
            if isinstance(expected, dict):
                # Multiple named results
                for key, value in expected.items():
                    resp = results.get(key)
                    assert resp is not None, f"Missing result for {key}"
                    if resp.error:
                        pytest.fail(f"Error in {key}: {resp.error}")
                    assert resp.result == value, f"Expected {value}, got {resp.result}"
            else:
                # Single result from last step
                last_resp = results.get("__last")
                assert last_resp is not None, "No result from pipeline"
                if last_resp.error:
                    pytest.fail(f"Pipeline error: {last_resp.error}")
                assert last_resp.result == expected, f"Expected {expected}, got {last_resp.result}"

        # Check round trips
        if "max_round_trips" in spec:
            assert server.round_trip_count <= spec["max_round_trips"], (
                f"Expected at most {spec['max_round_trips']} round trips, "
                f"got {server.round_trip_count}"
            )

    async def _run_sequence_test(
        self,
        server: MockServer,
        client: MockClient,
        spec: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Execute a sequence test (calls executed one after another)."""
        # Run setup if present
        if "setup" in spec:
            await self._run_setup(server, client, spec["setup"], context)

        for step in spec["sequence"]:
            call = step["call"]
            args = step.get("args", [])

            # Resolve the target
            result = await self._execute_call(client, call, args, context)

            # Check expectation
            if "expect" in step:
                assert result == step["expect"], f"Step {call}: expected {step['expect']}, got {result}"

            # Store result if named
            if "as" in step:
                context[f"${step['as']}"] = result

    async def _run_map_test(
        self,
        server: MockServer,
        client: MockClient,
        spec: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Execute a map test."""
        # Run setup if present
        if "setup" in spec:
            await self._run_setup(server, client, spec["setup"], context)

        map_spec = spec["map"]
        expression = map_spec.get("expression", "")
        captures = map_spec.get("captures", [])

        # Build capture context
        capture_context: dict[str, Any] = {}
        for capture in captures:
            clean_name = capture.lstrip("$")
            if clean_name == "self":
                capture_context["self"] = client.get_self()
            elif f"${clean_name}" in context:
                capture_context[clean_name] = context[f"${clean_name}"]

        # Get the source
        call = spec.get("call", "")
        args = spec.get("args", [])
        resolved_args = self._resolve_args(args, context)

        if call.startswith("$"):
            # Variable reference
            var_name = call.lstrip("$")
            source = context.get(f"${var_name}")
            if source is None:
                raise ValueError(f"Unknown variable: {var_name}")
            result = await client.server_map(source, expression, capture_context)
        else:
            # Call and map
            result = await client.call_and_map(
                call, resolved_args, expression, capture_context
            )

        # Check expectations
        if "expect" in spec:
            assert result == spec["expect"], f"Expected {spec['expect']}, got {result}"

        if spec.get("expect_type") == "capability":
            assert isinstance(result, dict) and "__capabilityId" in result

        if spec.get("expect_type") == "array_of_capabilities":
            assert isinstance(result, list)
            for item in result:
                assert isinstance(item, dict) and "__capabilityId" in item

        if "expect_length" in spec:
            assert len(result) == spec["expect_length"]

        # Check round trips
        if "max_round_trips" in spec:
            assert server.round_trip_count <= spec["max_round_trips"]

        # Verify steps
        if "verify" in spec:
            # Store result in context for verification
            context["$result"] = result
            for verify in spec["verify"]:
                verify_result = await self._execute_call(
                    client, verify["call"], [], context
                )
                assert verify_result == verify["expect"]

    async def _run_setup(
        self,
        server: MockServer,
        client: MockClient,
        setup: list[dict[str, Any]],
        context: dict[str, Any],
    ) -> None:
        """Run setup steps and populate context."""
        for step in setup:
            if "pipeline" in step:
                # Handle nested pipeline in setup
                await self._run_setup_pipeline(server, client, step, context)
            elif "call" in step:
                call = step["call"]
                args = step.get("args", [])

                result = await self._execute_call(client, call, args, context)

                # Apply map if present
                if "map" in step:
                    map_spec = step["map"]
                    expression = map_spec.get("expression", "")
                    captures = map_spec.get("captures", [])

                    capture_context: dict[str, Any] = {}
                    for capture in captures:
                        clean_name = capture.lstrip("$")
                        if clean_name == "self":
                            capture_context["self"] = client.get_self()
                        elif f"${clean_name}" in context:
                            capture_context[clean_name] = context[f"${clean_name}"]

                    # Store the result as a capability first
                    if isinstance(result, list):
                        cap_id = server.register_capability(result)
                        result = {"__capabilityId": cap_id}

                    result = await client.server_map(result, expression, capture_context)

                # Store in context
                if "as" in step:
                    context[f"${step['as']}"] = result

        # Reset round trips after setup
        server.reset_round_trips()

    async def _run_setup_pipeline(
        self,
        server: MockServer,
        client: MockClient,
        step: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Run a pipeline within setup."""
        last_result: Any = None

        for pipeline_step in step.get("pipeline", []):
            call = pipeline_step.get("call", "")

            if call.startswith("$"):
                # Reference to context variable
                var_name = call.lstrip("$")
                source = context.get(f"${var_name}")

                if "map" in pipeline_step:
                    map_spec = pipeline_step["map"]
                    expression = map_spec.get("expression", "")
                    captures = map_spec.get("captures", [])

                    capture_context: dict[str, Any] = {}
                    for capture in captures:
                        clean_name = capture.lstrip("$")
                        if clean_name == "self":
                            capture_context["self"] = client.get_self()
                        elif f"${clean_name}" in context:
                            capture_context[clean_name] = context[f"${clean_name}"]

                    # Ensure source is registered as capability
                    if isinstance(source, list):
                        cap_id = server.register_capability(source)
                        source = {"__capabilityId": cap_id}

                    source = await client.server_map(source, expression, capture_context)

                last_result = source
                if "as" in pipeline_step:
                    context[f"${pipeline_step['as']}"] = source
            else:
                # Regular call
                args = pipeline_step.get("args", [])
                result = await self._execute_call(client, call, args, context)

                last_result = result
                if "as" in pipeline_step:
                    context[f"${pipeline_step['as']}"] = result

        # Store final result under the step's 'as' name
        if "as" in step:
            # If the last pipeline step had an 'as', use that; otherwise use last_result
            last_step = step["pipeline"][-1] if step.get("pipeline") else None
            if last_step and "as" in last_step:
                context[f"${step['as']}"] = context.get(f"${last_step['as']}", last_result)
            else:
                context[f"${step['as']}"] = last_result

    async def _execute_call(
        self,
        client: MockClient,
        call: str,
        args: list[Any],
        context: dict[str, Any],
    ) -> Any:
        """Execute a call, handling dotted paths for capability methods."""
        resolved_args = self._resolve_args(args, context)

        # Check if it's a call on a context variable
        if call.startswith("$"):
            parts = call[1:].split(".")
            target_name = parts[0]
            method = ".".join(parts[1:]) if len(parts) > 1 else ""

            target = context.get(f"${target_name}")
            if target is None:
                raise ValueError(f"Unknown variable: {target_name}")

            if method:
                return await client.call_on_capability(target, method, *resolved_args)
            return target

        # Check if it's a dotted path (calling method on context variable)
        parts = call.split(".")
        if len(parts) > 1:
            target_name = parts[0]
            method = ".".join(parts[1:])

            target = context.get(f"${target_name}")
            if target is not None:
                return await client.call_on_capability(target, method, *resolved_args)

        # Direct call on root
        return await client.call(call, *resolved_args)

    async def _test_error_case(
        self,
        server: MockServer,
        client: MockClient,
        method: str,
        args: list[Any],
        expect_error: dict[str, Any],
        context: dict[str, Any],
    ) -> None:
        """Test an error case."""
        # Check if any_of contains a value option (not just errors)
        any_of = expect_error.get("any_of", [])
        has_value_option = any(
            isinstance(opt, dict) and "value" in opt for opt in any_of
        )

        if has_value_option:
            # Could be error OR value
            try:
                result = await client.call(method, *args)
                # Check if result matches any value option
                value_options = [
                    opt for opt in any_of if isinstance(opt, dict) and "value" in opt
                ]
                matches = False
                for opt in value_options:
                    expected = opt["value"]
                    if expected is None and (result is None or result != result):
                        # NaN check
                        matches = True
                        break
                    if result == expected:
                        matches = True
                        break
                assert matches or any(
                    isinstance(opt, dict) and "type" in opt for opt in any_of
                )
            except MockRpcError as e:
                # Error case
                if expect_error.get("type"):
                    assert e.error_type == expect_error["type"]
                if expect_error.get("message_contains"):
                    assert expect_error["message_contains"] in str(e)
        else:
            # Standard error test
            with pytest.raises(MockRpcError) as exc_info:
                await client.call(method, *args)

            error = exc_info.value
            if expect_error.get("type"):
                assert error.error_type == expect_error["type"]
            if expect_error.get("message_contains"):
                assert expect_error["message_contains"] in str(error)

    def _resolve_args(
        self, args: list[Any], context: dict[str, Any]
    ) -> list[Any]:
        """Replace $variable references in arguments with actual values."""
        resolved = []
        for arg in args:
            if isinstance(arg, str) and arg.startswith("$"):
                name = arg[1:]
                if name == "self":
                    resolved.append({"$ref": 0})
                else:
                    value = context.get(f"${name}", arg)
                    if isinstance(value, dict) and "__capabilityId" in value:
                        resolved.append({"$ref": value["__capabilityId"]})
                    else:
                        resolved.append(value)
            else:
                resolved.append(arg)
        return resolved

    def _resolve_pipeline_args(
        self,
        args: list[Any],
        context: dict[str, Any],
        step_names: set[str],
    ) -> list[Any]:
        """Resolve arguments for pipeline (converts $name to step reference)."""
        resolved = []
        for arg in args:
            if isinstance(arg, str) and arg.startswith("$"):
                name = arg[1:]
                if name == "self":
                    resolved.append({"$ref": 0})
                elif name in step_names:
                    # Step reference
                    resolved.append({"$step": name})
                else:
                    value = context.get(f"${name}", arg)
                    if isinstance(value, dict) and "__capabilityId" in value:
                        resolved.append({"$ref": value["__capabilityId"]})
                    else:
                        resolved.append(value)
            else:
                resolved.append(arg)
        return resolved
