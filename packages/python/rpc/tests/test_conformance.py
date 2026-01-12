"""
Conformance tests for the Python rpc-do SDK.

These tests are generated from the YAML specifications in test/conformance/
and verify that the Python SDK correctly implements the RPC protocol.
"""

import pytest
from typing import Any


class TestConformance:
    """
    Conformance test suite.

    Each test is parametrized from YAML spec files and verifies a specific
    aspect of the RPC protocol implementation.
    """

    @pytest.mark.asyncio
    async def test_conformance(self, client, conformance_test: dict[str, Any]):
        """
        Run a single conformance test from the YAML spec.

        This test is parametrized by pytest_generate_tests in conftest.py
        to run once for each test case defined in the conformance specs.
        """
        if not conformance_test:
            pytest.skip("No conformance specs found")

        test_name = conformance_test.get("name", "unknown")
        category = conformance_test.get("_category", "unknown")

        # Skip tests that require specific setup we don't support yet
        if "export" in conformance_test:
            pytest.skip(f"Callback exports not yet implemented: {category}/{test_name}")

        # Handle different test types
        if "call" in conformance_test and "map" not in conformance_test:
            await self._run_call_test(client, conformance_test)
        elif "pipeline" in conformance_test:
            await self._run_pipeline_test(client, conformance_test)
        elif "sequence" in conformance_test:
            await self._run_sequence_test(client, conformance_test)
        elif "map" in conformance_test:
            await self._run_map_test(client, conformance_test)
        else:
            pytest.skip(f"Unknown test type: {test_name}")

    async def _run_call_test(self, client, spec: dict[str, Any]):
        """Execute a simple call test."""
        method_name = spec["call"]
        args = spec.get("args", [])
        context = {"$self": client}

        # Run setup if present
        if "setup" in spec:
            await self._run_setup(client, spec["setup"], context)

        # Handle variable substitution in args
        resolved_args = self._resolve_args(args, context)

        # Get the method from the client
        method = getattr(client, method_name)

        # Make the call
        if "expect_error" in spec:
            with pytest.raises(Exception) as exc_info:
                await method(*resolved_args)
            self._verify_error(exc_info.value, spec["expect_error"])
        else:
            result = await method(*resolved_args)
            if "expect" in spec:
                expected = spec["expect"]
                assert result == expected, f"Expected {expected}, got {result}"
            elif "expect_type" in spec:
                # Just verify we got something
                assert result is not None

    async def _run_pipeline_test(self, client, spec: dict[str, Any]):
        """Execute a pipeline test (multiple calls in one round trip)."""
        pipeline = spec["pipeline"]
        context = {"$self": client}

        # Build the pipeline
        promises = {}
        for step in pipeline:
            call = step["call"]
            args = step.get("args", [])

            # Resolve the target (could be nested like "counter.increment")
            parts = call.split(".")
            if parts[0].startswith("$"):
                # Reference to a variable
                target = context[parts[0]]
                parts = parts[1:]
            else:
                target = client

            for part in parts:
                target = getattr(target, part)

            # Make the call (but don't await yet - that's the point of pipelining!)
            resolved_args = self._resolve_args(args, context)
            result_promise = target(*resolved_args) if callable(target) else target

            # Store in context if named
            if "as" in step:
                name = step["as"]
                context[f"${name}"] = result_promise
                promises[name] = result_promise

        # Now await the final result(s)
        if "expect_error" in spec:
            with pytest.raises(Exception):
                # Await the last promise
                last_promise = list(context.values())[-1]
                await last_promise
        elif "expect" in spec:
            # Await all promises and check results
            if isinstance(spec["expect"], dict):
                results = {}
                for key, expected in spec["expect"].items():
                    if key in promises:
                        results[key] = await promises[key]
                assert results == spec["expect"]
            else:
                # Get the last promise
                last_promise = list(promises.values())[-1] if promises else list(context.values())[-1]
                result = await last_promise
                assert result == spec["expect"]

    async def _run_sequence_test(self, client, spec: dict[str, Any]):
        """Execute a sequence of calls (each awaited before next)."""
        context = {"$self": client}

        # Run setup if present
        if "setup" in spec:
            await self._run_setup(client, spec["setup"], context)

        for step in spec["sequence"]:
            call = step["call"]
            args = step.get("args", [])

            # Resolve target
            parts = call.split(".")
            if parts[0].startswith("$"):
                target = context[parts[0]]
                parts = parts[1:]
            else:
                target = client

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

    async def _run_map_test(self, client, spec: dict[str, Any]):
        """Execute a map test."""
        context = {"$self": client}

        # Run setup if present
        if "setup" in spec:
            await self._run_setup(client, spec["setup"], context)

        # Get the source call
        if spec.get("call", "").startswith("$"):
            # Variable reference
            source = context[spec["call"]]
        else:
            method_name = spec["call"]
            args = spec.get("args", [])
            resolved_args = self._resolve_args(args, context)
            method = getattr(client, method_name)
            source = method(*resolved_args)

        # Apply the map
        map_spec = spec["map"]
        expression = map_spec.get("expression", "")
        captures = map_spec.get("captures", [])

        # Build capture context for the lambda
        capture_context = {}
        for capture in captures:
            if capture in context:
                capture_context[capture.lstrip("$")] = context[capture]

        # Parse and execute the map expression
        # The expression is like "x => self.square(x)" - we need to convert to Python lambda
        result = await self._execute_map(source, expression, capture_context)

        # Check expectations
        if "expect" in spec:
            assert result == spec["expect"], f"Expected {spec['expect']}, got {result}"
        elif "expect_type" in spec:
            if spec["expect_type"] == "array_of_capabilities":
                assert isinstance(result, list)
                if "expect_length" in spec:
                    assert len(result) == spec["expect_length"]
            elif spec["expect_type"] == "capability":
                assert result is not None

    async def _execute_map(self, source, expression: str, capture_context: dict):
        """Execute a map expression on a source promise."""
        # Parse expression like "x => self.square(x)" or "counter => counter.value"
        # Convert to a Python lambda that creates RPC calls

        # First await the source to get the array/value
        source_value = await source

        # Handle null/None
        if source_value is None:
            return None

        # Extract the lambda parameter and body
        parts = expression.split("=>")
        if len(parts) != 2:
            raise ValueError(f"Invalid map expression: {expression}")

        param = parts[0].strip()
        body = parts[1].strip()

        # Execute the map
        if isinstance(source_value, list):
            results = []
            for item in source_value:
                result = await self._evaluate_map_body(body, param, item, capture_context)
                results.append(result)
            return results
        else:
            # Single value
            return await self._evaluate_map_body(body, param, source_value, capture_context)

    async def _evaluate_map_body(self, body: str, param: str, value, capture_context: dict):
        """Evaluate a map body expression."""
        # Parse body like "self.square(x)" or "counter.value"
        # This is a simplified parser - real implementation would be more robust

        # Replace parameter with the actual value in method calls
        if f"({param})" in body:
            # Method call like "self.square(x)"
            parts = body.replace(f"({param})", "").split(".")
            target = capture_context.get(parts[0], value)
            for part in parts[1:]:
                target = getattr(target, part)
            if callable(target):
                result = target(value)
            else:
                result = target
            return await result if hasattr(result, "__await__") else result

        elif f"{param}." in body:
            # Property/method access on parameter like "counter.value"
            parts = body.split(".")
            target = value
            for part in parts[1:]:
                # Check if it's a method call
                if "(" in part:
                    method_name = part.split("(")[0]
                    args_str = part.split("(")[1].rstrip(")")
                    target = getattr(target, method_name)
                    if args_str:
                        # Parse simple numeric args
                        args = [int(a.strip()) for a in args_str.split(",") if a.strip()]
                        result = target(*args)
                    else:
                        result = target()
                    target = await result if hasattr(result, "__await__") else result
                else:
                    target = getattr(target, part)
                    if callable(target):
                        result = target()
                        target = await result if hasattr(result, "__await__") else result
            return target

        else:
            # Direct transformation like "self.returnNumber(x * 2)"
            # For now, just call with the value
            parts = body.split(".")
            target = capture_context.get(parts[0], value)
            for part in parts[1:]:
                if "(" in part:
                    method_name = part.split("(")[0]
                    target = getattr(target, method_name)
                    result = target(value)
                    return await result if hasattr(result, "__await__") else result
                else:
                    target = getattr(target, part)
            return target

    async def _run_setup(self, client, setup: list[dict], context: dict):
        """Run setup steps and populate context."""
        for step in setup:
            if "call" in step:
                call = step["call"]
                args = step.get("args", [])

                # Resolve target
                parts = call.split(".")
                if parts[0].startswith("$"):
                    target = context[parts[0]]
                    parts = parts[1:]
                else:
                    target = client

                for part in parts:
                    target = getattr(target, part)

                resolved_args = self._resolve_args(args, context)
                result = target(*resolved_args) if callable(target) else target

                # Check if we should apply a map
                if "map" in step:
                    map_spec = step["map"]
                    expression = map_spec.get("expression", "")
                    captures = map_spec.get("captures", [])
                    capture_context = {}
                    for capture in captures:
                        if capture in context:
                            capture_context[capture.lstrip("$")] = context[capture]
                    result = await self._execute_map_promise(result, expression, capture_context)

                # Await if needed
                if step.get("await", False):
                    result = await result if hasattr(result, "__await__") else result

                # Store in context
                if "as" in step:
                    context[f"${step['as']}"] = result

            elif "pipeline" in step:
                # Handle nested pipeline in setup
                for pipeline_step in step["pipeline"]:
                    if "call" in pipeline_step:
                        call = pipeline_step["call"]
                        if call.startswith("$"):
                            source = context[call]
                        else:
                            source = getattr(client, call)

                        if "map" in pipeline_step:
                            map_spec = pipeline_step["map"]
                            expression = map_spec.get("expression", "")
                            captures = map_spec.get("captures", [])
                            capture_context = {}
                            for capture in captures:
                                if capture in context:
                                    capture_context[capture.lstrip("$")] = context[capture]
                            source = await self._execute_map_promise(source, expression, capture_context)

                        if "as" in pipeline_step:
                            context[f"${pipeline_step['as']}"] = source

                if step.get("await", False) and "as" in step:
                    context[f"${step['as']}"] = await context.get(f"${step['as']}")

    async def _execute_map_promise(self, source, expression: str, capture_context: dict):
        """Execute a map on a promise, returning a new promise."""
        # Similar to _execute_map but wraps the result
        return await self._execute_map(source, expression, capture_context)

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
        if "any_of" in expected:
            # Could be one of several error types
            return

        if "type" in expected:
            # Map JavaScript error types to Python
            type_mapping = {
                "RangeError": "RpcError",
                "Error": ("RpcError", "Exception", "AttributeError"),
            }
            expected_type = expected["type"]
            actual_type = type(error).__name__

            if expected_type in type_mapping:
                allowed = type_mapping[expected_type]
                if isinstance(allowed, tuple):
                    assert actual_type in allowed, \
                        f"Expected one of {allowed}, got {actual_type}"
                else:
                    assert actual_type == allowed, \
                        f"Expected {allowed}, got {actual_type}"

        if "message" in expected:
            assert str(error) == expected["message"]

        if "message_contains" in expected:
            assert expected["message_contains"] in str(error), \
                f"Expected error to contain '{expected['message_contains']}', got '{error}'"
