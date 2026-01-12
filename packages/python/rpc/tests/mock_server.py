"""
Mock test server that implements the conformance test interface.

This module provides a MockServer class that can be used for testing
the RPC client without network connections. It implements the same
interface as the TypeScript MockServer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol


class Counter(Protocol):
    """Counter capability interface."""

    def value(self) -> int:
        ...

    def increment(self, by: int) -> int:
        ...


class TestTarget(Protocol):
    """Test target interface for conformance tests."""

    def square(self, x: int) -> int:
        ...

    def returnNumber(self, x: int) -> int:
        ...

    def returnNull(self) -> None:
        ...

    def returnUndefined(self) -> None:
        ...

    def generateFibonacci(self, n: int) -> list[int]:
        ...

    def throwError(self) -> None:
        ...

    def makeCounter(self, initial: int) -> Counter:
        ...

    def incrementCounter(self, counter: Counter, by: int) -> int:
        ...

    def callSquare(self, target: Any, x: int) -> dict[str, int]:
        ...

    def callFunction(self, fn: Callable[[int], int], x: int) -> dict[str, int]:
        ...


@dataclass
class CounterImpl:
    """Counter implementation."""

    _value: int

    def value(self) -> int:
        return self._value

    def increment(self, by: int) -> int:
        self._value += by
        return self._value


@dataclass
class TestTargetImpl:
    """Test target implementation."""

    def square(self, x: int | float) -> int | float:
        return x * x

    def returnNumber(self, x: int | float) -> int | float:
        return x

    def returnNull(self) -> None:
        return None

    def returnUndefined(self) -> None:
        return None  # Python doesn't have undefined

    def generateFibonacci(self, n: int) -> list[int]:
        if n <= 0:
            return []
        if n == 1:
            return [0]

        result = [0, 1]
        for i in range(2, n):
            result.append(result[i - 1] + result[i - 2])
        return result

    def throwError(self) -> None:
        raise RangeError("test error")

    def makeCounter(self, initial: int) -> CounterImpl:
        return CounterImpl(_value=initial)

    def incrementCounter(self, counter: CounterImpl, by: int) -> int:
        return counter.increment(by)

    def callSquare(self, target: Any, x: int) -> dict[str, int]:
        # Target should be a TestTarget or similar with square method
        if hasattr(target, "square"):
            return {"result": target.square(x)}
        # Fallback: target is self-like
        return {"result": x * x}

    def callFunction(
        self, fn: Callable[[int], int], x: int
    ) -> dict[str, int]:
        return {"result": fn(x)}


class RangeError(Exception):
    """JavaScript-style RangeError for compatibility."""
    pass


@dataclass
class RpcRequest:
    """RPC request structure."""

    id: int
    method: str
    args: list[Any] = field(default_factory=list)
    target: int | None = None
    pipeline: list[dict[str, Any]] | None = None


@dataclass
class RpcResponse:
    """RPC response structure."""

    id: int
    result: Any = None
    error: dict[str, str] | None = None
    capabilityId: int | None = None


@dataclass
class PipelineStep:
    """Pipeline step structure."""

    method: str
    args: list[Any] = field(default_factory=list)
    target: str | int | None = None
    as_name: str | None = None  # 'as' is reserved in Python


@dataclass
class PipelinedRequest:
    """Pipelined request structure."""

    id: int
    steps: list[PipelineStep]


class MockServer:
    """
    Mock server that processes RPC messages.

    Used for testing without network connections. Implements the same
    interface as the TypeScript MockServer for conformance testing.
    """

    def __init__(self) -> None:
        self._next_cap_id = 1
        self._capabilities: dict[int, Any] = {}
        self._round_trips = 0

        # Capability 0 is always the bootstrap/root
        target = TestTargetImpl()
        self._capabilities[0] = target

    @property
    def round_trip_count(self) -> int:
        """Get the number of round trips made."""
        return self._round_trips

    def reset_round_trips(self) -> None:
        """Reset the round trip counter."""
        self._round_trips = 0

    def process_batch(self, requests: list[RpcRequest]) -> list[RpcResponse]:
        """Process a batch of requests (single round trip)."""
        self._round_trips += 1
        return [self.process_request(req) for req in requests]

    def process_pipeline(
        self, request: PipelinedRequest
    ) -> dict[str, RpcResponse]:
        """Process a pipelined request (single round trip for entire pipeline)."""
        self._round_trips += 1

        results: dict[str, RpcResponse] = {}
        step_results: dict[str, dict[str, Any]] = {}
        last_response: RpcResponse | None = None

        for step in request.steps:
            try:
                # Resolve the target
                target_id: int
                target: Any

                if isinstance(step.target, str):
                    # Reference to a previous step result
                    prev = step_results.get(step.target)
                    if prev is None:
                        response = RpcResponse(
                            id=request.id,
                            error={
                                "type": "Error",
                                "message": f"Unknown step reference: {step.target}",
                            },
                        )
                        if step.as_name:
                            results[step.as_name] = response
                        last_response = response
                        continue
                    target_id = prev["capId"]
                    target = prev["value"]
                else:
                    target_id = step.target if step.target is not None else 0
                    target = self._capabilities.get(target_id)

                if target is None:
                    response = RpcResponse(
                        id=request.id,
                        error={
                            "type": "Error",
                            "message": f"Unknown capability: {target_id}",
                        },
                    )
                    if step.as_name:
                        results[step.as_name] = response
                    last_response = response
                    continue

                # Resolve capability references in args
                resolved_args = self._resolve_capability_refs_with_steps(
                    step.args, step_results
                )

                # Call the method
                method = getattr(target, step.method, None)
                if not callable(method):
                    response = RpcResponse(
                        id=request.id,
                        error={
                            "type": "Error",
                            "message": f"{step.method} is not a function",
                        },
                    )
                    if step.as_name:
                        results[step.as_name] = response
                    last_response = response
                    continue

                result = method(*resolved_args)
                cap_id: int | None = None

                # If result is a capability (has methods), store it
                if self._is_capability(result):
                    cap_id = self._next_cap_id
                    self._next_cap_id += 1
                    self._capabilities[cap_id] = result

                    # Store for future step references
                    if step.as_name:
                        step_results[step.as_name] = {
                            "capId": cap_id,
                            "value": result,
                        }

                    response = RpcResponse(
                        id=request.id,
                        result={"__capabilityId": cap_id},
                        capabilityId=cap_id,
                    )
                    if step.as_name:
                        results[step.as_name] = response
                    last_response = response
                    continue

                # Store result
                response = RpcResponse(
                    id=request.id,
                    result=result,
                )

                if step.as_name:
                    step_results[step.as_name] = {
                        "capId": -1,
                        "value": result,
                    }
                    results[step.as_name] = response
                last_response = response

            except Exception as e:
                response = RpcResponse(
                    id=request.id,
                    error={
                        "type": type(e).__name__,
                        "message": str(e),
                    },
                )
                if step.as_name:
                    results[step.as_name] = response
                last_response = response

        # Always include __last for the last step's result
        if last_response:
            results["__last"] = last_response

        return results

    def process_request(self, request: RpcRequest) -> RpcResponse:
        """Process a single request."""
        try:
            target_id = request.target if request.target is not None else 0
            target = self._capabilities.get(target_id)

            if target is None:
                return RpcResponse(
                    id=request.id,
                    error={
                        "type": "Error",
                        "message": f"Unknown capability: {target_id}",
                    },
                )

            # Handle pipeline operations
            if request.pipeline:
                for op in request.pipeline:
                    op_type = op.get("type")
                    if op_type == "get" and "property" in op:
                        target = getattr(target, op["property"])
                    elif op_type == "call" and "method" in op:
                        method = getattr(target, op["method"], None)
                        if not callable(method):
                            return RpcResponse(
                                id=request.id,
                                error={
                                    "type": "Error",
                                    "message": f"{op['method']} is not a function",
                                },
                            )
                        target = method(*(op.get("args") or []))

            # Resolve capability references in args
            resolved_args = self._resolve_capability_refs(request.args)

            # Call the method
            method = getattr(target, request.method, None)
            if not callable(method):
                return RpcResponse(
                    id=request.id,
                    error={
                        "type": "Error",
                        "message": f"{request.method} is not a function",
                    },
                )

            result = method(*resolved_args)

            # If result is a capability, store it
            if self._is_capability(result):
                cap_id = self._next_cap_id
                self._next_cap_id += 1
                self._capabilities[cap_id] = result
                return RpcResponse(
                    id=request.id,
                    result={"__capabilityId": cap_id},
                    capabilityId=cap_id,
                )

            return RpcResponse(
                id=request.id,
                result=result,
            )

        except Exception as e:
            return RpcResponse(
                id=request.id,
                error={
                    "type": type(e).__name__,
                    "message": str(e),
                },
            )

    def process_map_request(
        self,
        request_id: int,
        target_id: int,
        expression: str,
        captures: dict[str, int],
    ) -> RpcResponse:
        """Process a map request."""
        self._round_trips += 1

        try:
            target = self._capabilities.get(target_id)
            if target is None:
                return RpcResponse(
                    id=request_id,
                    error={
                        "type": "Error",
                        "message": f"Unknown capability: {target_id}",
                    },
                )

            # Build capture context
            capture_values: dict[str, Any] = {}
            for name, cap_id in captures.items():
                capture_values[name] = self._capabilities.get(cap_id)

            # Execute the map
            result = self._execute_map(target, expression, capture_values)

            return RpcResponse(id=request_id, result=result)

        except Exception as e:
            return RpcResponse(
                id=request_id,
                error={
                    "type": type(e).__name__,
                    "message": str(e),
                },
            )

    def process_call_and_map(
        self,
        request: RpcRequest,
        expression: str,
        captures: dict[str, int],
    ) -> RpcResponse:
        """Process a call and map in a single round trip."""
        self._round_trips += 1

        # First execute the call (without counting as round trip)
        call_response = self._process_request_internal(request)

        if call_response.error:
            return call_response

        # Get the result value
        value = call_response.result

        # If it's a capability reference, get the actual value
        if isinstance(value, dict) and "__capabilityId" in value:
            value = self._capabilities.get(value["__capabilityId"])

        # Build capture context
        capture_values: dict[str, Any] = {}
        for name, cap_id in captures.items():
            capture_values[name] = self._capabilities.get(cap_id)

        # Execute the map
        try:
            result = self._execute_map(value, expression, capture_values)
            return RpcResponse(id=request.id, result=result)
        except Exception as e:
            return RpcResponse(
                id=request.id,
                error={
                    "type": type(e).__name__,
                    "message": str(e),
                },
            )

    def register_capability(self, cap: Any) -> int:
        """Register a capability and return its ID."""
        cap_id = self._next_cap_id
        self._next_cap_id += 1
        self._capabilities[cap_id] = cap
        return cap_id

    def get_capability(self, cap_id: int) -> Any:
        """Get a capability by ID."""
        return self._capabilities.get(cap_id)

    def _is_capability(self, value: Any) -> bool:
        """Check if a value is a capability (has callable methods)."""
        if value is None or isinstance(value, (int, float, str, bool, list)):
            return False
        if not isinstance(value, dict) and hasattr(value, "__dict__"):
            # Check if it has any callable attributes (methods)
            for attr_name in dir(value):
                if not attr_name.startswith("_"):
                    attr = getattr(value, attr_name, None)
                    if callable(attr):
                        return True
        return False

    def _resolve_capability_refs(self, args: list[Any]) -> list[Any]:
        """Resolve capability references in arguments."""
        resolved = []
        for arg in args:
            if isinstance(arg, dict):
                if "__capabilityId" in arg:
                    resolved.append(self._capabilities.get(arg["__capabilityId"]))
                elif "$ref" in arg:
                    resolved.append(self._capabilities.get(arg["$ref"]))
                else:
                    resolved.append(arg)
            else:
                resolved.append(arg)
        return resolved

    def _resolve_capability_refs_with_steps(
        self,
        args: list[Any],
        step_results: dict[str, dict[str, Any]],
    ) -> list[Any]:
        """Resolve capability references with step references."""
        resolved = []
        for arg in args:
            if isinstance(arg, dict):
                if "__capabilityId" in arg:
                    resolved.append(self._capabilities.get(arg["__capabilityId"]))
                elif "$ref" in arg:
                    ref_id = arg["$ref"]
                    if isinstance(ref_id, str):
                        step = step_results.get(ref_id)
                        resolved.append(step["value"] if step else None)
                    else:
                        resolved.append(self._capabilities.get(ref_id))
                elif "$step" in arg:
                    step_name = arg["$step"]
                    step = step_results.get(step_name)
                    resolved.append(step["value"] if step else None)
                else:
                    resolved.append(arg)
            else:
                resolved.append(arg)
        return resolved

    def _process_request_internal(self, request: RpcRequest) -> RpcResponse:
        """Internal request processing (no round trip counting)."""
        try:
            target_id = request.target if request.target is not None else 0
            target = self._capabilities.get(target_id)

            if target is None:
                return RpcResponse(
                    id=request.id,
                    error={
                        "type": "Error",
                        "message": f"Unknown capability: {target_id}",
                    },
                )

            # Handle pipeline operations
            if request.pipeline:
                for op in request.pipeline:
                    op_type = op.get("type")
                    if op_type == "get" and "property" in op:
                        target = getattr(target, op["property"])
                    elif op_type == "call" and "method" in op:
                        method = getattr(target, op["method"], None)
                        if not callable(method):
                            return RpcResponse(
                                id=request.id,
                                error={
                                    "type": "Error",
                                    "message": f"{op['method']} is not a function",
                                },
                            )
                        target = method(*(op.get("args") or []))

            # Resolve capability references in args
            resolved_args = self._resolve_capability_refs(request.args)

            # Call the method
            method = getattr(target, request.method, None)
            if not callable(method):
                return RpcResponse(
                    id=request.id,
                    error={
                        "type": "Error",
                        "message": f"{request.method} is not a function",
                    },
                )

            result = method(*resolved_args)

            # If result is a capability, store it
            if self._is_capability(result):
                cap_id = self._next_cap_id
                self._next_cap_id += 1
                self._capabilities[cap_id] = result
                return RpcResponse(
                    id=request.id,
                    result={"__capabilityId": cap_id},
                    capabilityId=cap_id,
                )

            return RpcResponse(
                id=request.id,
                result=result,
            )

        except Exception as e:
            return RpcResponse(
                id=request.id,
                error={
                    "type": type(e).__name__,
                    "message": str(e),
                },
            )

    def _execute_map(
        self,
        value: Any,
        expression: str,
        captures: dict[str, Any],
    ) -> Any:
        """Execute a map expression on a value."""
        if value is None:
            return None

        # Parse the expression (e.g., "x => self.square(x)")
        # Split on => to get parameter and body
        if "=>" not in expression:
            raise ValueError(f"Invalid map expression: {expression}")

        parts = expression.split("=>", 1)
        param = parts[0].strip()
        body = parts[1].strip()

        # Build a function to evaluate the expression
        def evaluate_item(item: Any) -> Any:
            # Handle capability wrapping for auto-calling zero-arg methods
            wrapped_item = self._wrap_for_map(item)

            # Parse and execute the body
            return self._evaluate_map_body(body, param, wrapped_item, captures)

        if isinstance(value, list):
            results = []
            for item in value:
                result = evaluate_item(item)
                # Check if result is a capability
                if self._is_capability(result):
                    cap_id = self._next_cap_id
                    self._next_cap_id += 1
                    self._capabilities[cap_id] = result
                    results.append({"__capabilityId": cap_id})
                else:
                    results.append(result)
            return results
        else:
            result = evaluate_item(value)
            if self._is_capability(result):
                cap_id = self._next_cap_id
                self._next_cap_id += 1
                self._capabilities[cap_id] = result
                return {"__capabilityId": cap_id}
            return result

    def _wrap_for_map(self, item: Any) -> Any:
        """Wrap capabilities for map operations (auto-call zero-arg methods)."""
        if item is None or isinstance(item, (int, float, str, bool, list)):
            return item

        # If it's a capability reference, resolve it
        if isinstance(item, dict):
            if "__capabilityId" in item:
                return self._capabilities.get(item["__capabilityId"])
            if "$ref" in item:
                return self._capabilities.get(item["$ref"])

        return item

    def _evaluate_map_body(
        self,
        body: str,
        param: str,
        item: Any,
        captures: dict[str, Any],
    ) -> Any:
        """Evaluate a map body expression."""
        # Handle different expression patterns

        # Pattern: "self.method(param)" - call method on capture with item as arg
        for cap_name, cap_value in captures.items():
            if body.startswith(f"{cap_name}."):
                method_call = body[len(cap_name) + 1:]
                # Parse method call like "square(x)" or "returnNumber(x * 2)"
                if "(" in method_call:
                    method_name = method_call.split("(")[0]
                    args_str = method_call.split("(")[1].rstrip(")")

                    method = getattr(cap_value, method_name, None)
                    if callable(method):
                        # Evaluate the argument
                        if args_str == param:
                            return method(item)
                        elif f"{param} * " in args_str or f" * {param}" in args_str:
                            # Simple multiplication
                            multiplier = int(
                                args_str.replace(param, "").replace("*", "").strip()
                            )
                            return method(item * multiplier)
                        else:
                            # Try to evaluate as Python expression
                            try:
                                arg_value = eval(args_str, {param: item})
                                return method(arg_value)
                            except Exception:
                                return method(item)

        # Pattern: "param.method()" - call method on item
        if body.startswith(f"{param}."):
            method_part = body[len(param) + 1:]

            # Check if it's a method call or property access
            if "(" in method_part:
                method_name = method_part.split("(")[0]
                args_str = method_part.split("(")[1].rstrip(")")

                method = getattr(item, method_name, None)
                if callable(method):
                    if args_str:
                        # Parse arguments
                        try:
                            args = [int(a.strip()) for a in args_str.split(",") if a.strip()]
                            return method(*args)
                        except ValueError:
                            return method()
                    else:
                        return method()
            else:
                # Property access - could be a zero-arg method
                attr = getattr(item, method_part, None)
                if callable(attr):
                    return attr()
                return attr

        # Fallback: try to evaluate as expression
        try:
            local_vars = {param: item}
            local_vars.update(captures)
            return eval(body, {}, local_vars)
        except Exception:
            return item
