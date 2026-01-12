"""
rpc-do - Zero-schema RPC client for .do services.

This package provides a Python client for connecting to .do RPC services
with support for:
- Zero-schema method access via attribute-based invocation
- Promise pipelining for reduced round trips
- Server-side .map() transformations
- Async/await native API

Example usage:
    from rpc_do import connect

    async def main():
        # Connect to a .do service
        client = await connect("api.do")

        # Zero-schema method calls
        result = await client.square(5)
        print(result)  # 25

        # Promise pipelining
        counter = client.makeCounter(10)
        value = await counter.increment(5)
        print(value)  # 15

        # Server-side map
        fibs = await client.generateFibonacci(6)
        squares = await client.generateFibonacci(6).map(
            lambda x: client.square(x)
        )
        print(squares)  # [0, 1, 1, 4, 9, 25]

        await client.close()

    import asyncio
    asyncio.run(main())
"""

from __future__ import annotations

__version__ = "0.1.0"

from .client import RpcClient, RpcError, connect
from .promise import RpcPromise
from .proxy import RpcProxy
from .map import MapExpression, serialize_map_expression, capture_lambda

__all__ = [
    # Main API
    "connect",
    "RpcClient",
    "RpcPromise",
    "RpcProxy",
    "RpcError",
    # Map utilities
    "MapExpression",
    "serialize_map_expression",
    "capture_lambda",
    # Version
    "__version__",
]
