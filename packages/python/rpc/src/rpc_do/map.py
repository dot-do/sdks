"""
Server-side .map() with lambda capture.

This module provides utilities for serializing Python lambdas into
expressions that can be executed on the server, enabling server-side
collection transformations.
"""

from __future__ import annotations

import ast
import inspect
import textwrap
from dataclasses import dataclass, field
from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from .client import RpcClient

__all__ = ["MapExpression", "serialize_map_expression", "capture_lambda"]


@dataclass
class MapExpression:
    """
    Represents a serialized map expression for server-side execution.

    Attributes:
        expression: The expression string (e.g., "x => self.square(x)")
        captures: Dict of captured variable names to their values
        param_name: The parameter name used in the lambda
    """

    expression: str
    captures: dict[str, Any] = field(default_factory=dict)
    param_name: str = "x"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result: dict[str, Any] = {
            "expression": self.expression,
        }
        if self.captures:
            result["captures"] = {
                name: _serialize_capture(value)
                for name, value in self.captures.items()
            }
        return result


def _serialize_capture(value: Any) -> Any:
    """
    Serialize a captured value for transmission.

    Args:
        value: The captured value

    Returns:
        Serialized representation
    """
    # If it's a capability proxy, serialize as capability reference
    if hasattr(value, "_capability_id"):
        return {"__capability__": value._capability_id}

    # If it's an RpcClient, serialize as self reference
    if hasattr(value, "_ws") and hasattr(value, "_execute_call"):
        return {"__self__": True}

    # Otherwise, serialize directly (must be JSON-serializable)
    return value


def serialize_map_expression(
    fn: Callable[[Any], Any],
    client: RpcClient | None = None,
) -> MapExpression:
    """
    Serialize a Python lambda for server-side execution.

    This function analyzes the lambda's AST to extract:
    1. The parameter name
    2. The expression body
    3. Any captured variables from the enclosing scope

    Args:
        fn: The lambda function to serialize
        client: Optional client reference for $self substitution

    Returns:
        MapExpression containing the serialized form

    Example:
        # Lambda: lambda x: client.square(x)
        # Serializes to: "x => self.square(x)" with self captured
    """
    try:
        source = inspect.getsource(fn)
    except (OSError, TypeError):
        # Can't get source - return a placeholder
        return MapExpression(
            expression="x => x",
            captures={"self": client} if client else {},
        )

    # Clean up the source (remove leading whitespace, etc.)
    source = textwrap.dedent(source).strip()

    # Parse the AST
    try:
        tree = ast.parse(source, mode="eval")
    except SyntaxError:
        # Try wrapping in parentheses
        try:
            tree = ast.parse(f"({source})", mode="eval")
        except SyntaxError:
            return MapExpression(
                expression="x => x",
                captures={"self": client} if client else {},
            )

    # Extract lambda node
    lambda_node = _find_lambda(tree)
    if lambda_node is None:
        return MapExpression(
            expression="x => x",
            captures={"self": client} if client else {},
        )

    # Get parameter name
    if lambda_node.args.args:
        param_name = lambda_node.args.args[0].arg
    else:
        param_name = "x"

    # Convert body to expression string
    expression_body = _ast_to_expression(lambda_node.body, param_name)

    # Find captured variables
    captures = _find_captures(lambda_node, fn, client)

    return MapExpression(
        expression=f"{param_name} => {expression_body}",
        captures=captures,
        param_name=param_name,
    )


def _find_lambda(tree: ast.AST) -> ast.Lambda | None:
    """Find the first lambda node in an AST."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Lambda):
            return node
    return None


def _ast_to_expression(node: ast.expr, param_name: str) -> str:
    """
    Convert an AST expression to a string expression.

    Args:
        node: The AST expression node
        param_name: The lambda parameter name

    Returns:
        String representation of the expression
    """
    if isinstance(node, ast.Name):
        return node.id

    elif isinstance(node, ast.Num):  # Python 3.7 compatibility
        return str(node.n)

    elif isinstance(node, ast.Constant):
        if isinstance(node.value, str):
            return f'"{node.value}"'
        return str(node.value)

    elif isinstance(node, ast.BinOp):
        left = _ast_to_expression(node.left, param_name)
        right = _ast_to_expression(node.right, param_name)
        op = _binop_to_str(node.op)
        return f"{left} {op} {right}"

    elif isinstance(node, ast.UnaryOp):
        operand = _ast_to_expression(node.operand, param_name)
        op = _unaryop_to_str(node.op)
        return f"{op}{operand}"

    elif isinstance(node, ast.Call):
        func = _ast_to_expression(node.func, param_name)
        args = [_ast_to_expression(arg, param_name) for arg in node.args]
        return f"{func}({', '.join(args)})"

    elif isinstance(node, ast.Attribute):
        value = _ast_to_expression(node.value, param_name)
        return f"{value}.{node.attr}"

    elif isinstance(node, ast.Subscript):
        value = _ast_to_expression(node.value, param_name)
        slice_val = _ast_to_expression(node.slice, param_name)
        return f"{value}[{slice_val}]"

    elif isinstance(node, ast.List):
        elts = [_ast_to_expression(e, param_name) for e in node.elts]
        return f"[{', '.join(elts)}]"

    elif isinstance(node, ast.Dict):
        pairs = []
        for k, v in zip(node.keys, node.values):
            if k is not None:
                key = _ast_to_expression(k, param_name)
                val = _ast_to_expression(v, param_name)
                pairs.append(f"{key}: {val}")
        return "{" + ", ".join(pairs) + "}"

    elif isinstance(node, ast.IfExp):
        test = _ast_to_expression(node.test, param_name)
        body = _ast_to_expression(node.body, param_name)
        orelse = _ast_to_expression(node.orelse, param_name)
        return f"{body} if {test} else {orelse}"

    elif isinstance(node, ast.Compare):
        left = _ast_to_expression(node.left, param_name)
        result = left
        for op, comparator in zip(node.ops, node.comparators):
            comp = _ast_to_expression(comparator, param_name)
            op_str = _cmpop_to_str(op)
            result = f"{result} {op_str} {comp}"
        return result

    else:
        # Fallback: just use the parameter
        return param_name


def _binop_to_str(op: ast.operator) -> str:
    """Convert binary operator to string."""
    ops = {
        ast.Add: "+",
        ast.Sub: "-",
        ast.Mult: "*",
        ast.Div: "/",
        ast.Mod: "%",
        ast.Pow: "**",
        ast.FloorDiv: "//",
        ast.BitAnd: "&",
        ast.BitOr: "|",
        ast.BitXor: "^",
        ast.LShift: "<<",
        ast.RShift: ">>",
    }
    return ops.get(type(op), "+")


def _unaryop_to_str(op: ast.unaryop) -> str:
    """Convert unary operator to string."""
    ops = {
        ast.UAdd: "+",
        ast.USub: "-",
        ast.Not: "!",
        ast.Invert: "~",
    }
    return ops.get(type(op), "-")


def _cmpop_to_str(op: ast.cmpop) -> str:
    """Convert comparison operator to string."""
    ops = {
        ast.Eq: "==",
        ast.NotEq: "!=",
        ast.Lt: "<",
        ast.LtE: "<=",
        ast.Gt: ">",
        ast.GtE: ">=",
        ast.Is: "===",
        ast.IsNot: "!==",
        ast.In: "in",
        ast.NotIn: "not in",
    }
    return ops.get(type(op), "==")


def _find_captures(
    lambda_node: ast.Lambda,
    fn: Callable[[Any], Any],
    client: RpcClient | None,
) -> dict[str, Any]:
    """
    Find captured variables in a lambda.

    Args:
        lambda_node: The lambda AST node
        fn: The actual lambda function
        client: Optional client reference

    Returns:
        Dict of captured variable names to their values
    """
    captures: dict[str, Any] = {}

    # Get parameter names (these are not captures)
    param_names = {arg.arg for arg in lambda_node.args.args}

    # Walk the body to find all Name references
    for node in ast.walk(lambda_node.body):
        if isinstance(node, ast.Name) and node.id not in param_names:
            name = node.id
            # Try to get the value from closure or globals
            if hasattr(fn, "__closure__") and fn.__closure__:
                # Check closure
                code = fn.__code__
                if name in code.co_freevars:
                    idx = code.co_freevars.index(name)
                    if idx < len(fn.__closure__):
                        value = fn.__closure__[idx].cell_contents
                        # Replace client with "self"
                        if client is not None and value is client:
                            captures["self"] = client
                        else:
                            captures[name] = value
            elif hasattr(fn, "__globals__") and name in fn.__globals__:
                value = fn.__globals__[name]
                if client is not None and value is client:
                    captures["self"] = client
                else:
                    captures[name] = value

    return captures


def capture_lambda(
    fn: Callable[[Any], Any],
    **captures: Any,
) -> tuple[Callable[[Any], Any], dict[str, Any]]:
    """
    Capture variables to be sent with a lambda for server-side execution.

    This is a helper for explicitly specifying captures when automatic
    detection doesn't work.

    Args:
        fn: The lambda function
        **captures: Named captures to include

    Returns:
        Tuple of (lambda, captures dict)

    Example:
        result = await source.map(*capture_lambda(
            lambda x: api.square(x),
            api=client,
        ))
    """
    return fn, captures
