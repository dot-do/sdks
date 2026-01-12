# platform-do

The official Python SDK for the DotDo platform. This package provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform-do` is the highest-level SDK in the DotDo stack, built on top of:

- **[rpc-do](../rpc)** - Type-safe RPC client
- **[capnweb-do](../capnweb)** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic async Python API.

```
+------------------+
|   platform-do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc-do       |  <-- RPC client layer
+------------------+
|   capnweb-do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **Async/Await**: Native asyncio support for modern Python
- **Type Hints**: Full typing support for IDE autocompletion
- **Context Managers**: Clean resource management with `async with`

## Installation

```bash
# pip
pip install platform-do

# poetry
poetry add platform-do

# uv
uv add platform-do

# pipx (for CLI tools)
pipx install platform-do
```

## Quick Start

### Basic Usage

```python
import asyncio
from platform_do import DotDo

async def main():
    # Create a client
    client = DotDo(api_key="your-api-key")

    # Connect to a service
    async with client:
        result = await client.call("ai.generate", {
            "prompt": "Hello, world!",
            "model": "claude-3"
        })
        print(result)

asyncio.run(main())
```

### Using Environment Variables

```bash
export DOTDO_API_KEY=your-api-key
```

```python
import asyncio
from platform_do import DotDo

async def main():
    # Automatically reads DOTDO_API_KEY
    client = DotDo()

    async with client:
        result = await client.call("ai.generate", {"prompt": "Hello!"})
        print(result)

asyncio.run(main())
```

## Configuration

### DotDo Class

```python
from platform_do import DotDo

client = DotDo(
    # Authentication
    api_key="your-api-key",        # Or use DOTDO_API_KEY env var
    access_token="oauth-token",     # For OAuth authentication
    headers={"X-Custom": "value"},  # Custom headers

    # Endpoint
    endpoint="wss://api.dotdo.dev/rpc",

    # Connection Pool
    pool_size=10,                   # Max concurrent connections
    pool_timeout=30.0,              # Connection acquire timeout

    # Retry Policy
    max_retries=3,                  # Number of retry attempts
    retry_delay=0.1,                # Initial retry delay (seconds)
    retry_max_delay=30.0,           # Maximum retry delay
    retry_multiplier=2.0,           # Exponential backoff multiplier

    # Request Settings
    timeout=30.0,                   # Default request timeout

    # Debug
    debug=False,                    # Enable debug logging
)
```

### Configuration via Environment

```bash
# Authentication
export DOTDO_API_KEY=your-api-key
export DOTDO_ACCESS_TOKEN=oauth-token

# Endpoint
export DOTDO_ENDPOINT=wss://api.dotdo.dev/rpc

# Connection Pool
export DOTDO_POOL_SIZE=10
export DOTDO_POOL_TIMEOUT=30

# Retry
export DOTDO_MAX_RETRIES=3
export DOTDO_RETRY_DELAY=0.1

# Request
export DOTDO_TIMEOUT=30

# Debug
export DOTDO_DEBUG=true
```

## Authentication

### API Key

```python
from platform_do import DotDo

client = DotDo(api_key="your-api-key")
```

### OAuth Token

```python
from platform_do import DotDo

client = DotDo(access_token="oauth-access-token")
```

### Custom Headers

```python
from platform_do import DotDo

client = DotDo(
    api_key="your-api-key",
    headers={
        "X-Tenant-ID": "tenant-123",
        "X-Request-ID": "req-456",
    }
)
```

## Connection Pooling

The SDK maintains a pool of WebSocket connections for efficiency:

```python
from platform_do import DotDo

client = DotDo(
    pool_size=20,        # Maximum concurrent connections
    pool_timeout=60.0,   # Wait up to 60s for available connection
)
```

### Pool Behavior

1. Connections are created on-demand up to `pool_size`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, requests wait up to `pool_timeout`
4. Connections are automatically cleaned up on context exit

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```python
from platform_do import DotDo

client = DotDo(
    max_retries=5,
    retry_delay=0.2,       # Start with 200ms
    retry_max_delay=60.0,  # Cap at 60 seconds
    retry_multiplier=2.0,  # Double each time
)
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Retryable Errors

The following errors trigger automatic retries:
- Connection errors
- Timeout errors
- HTTP 408, 429, 500, 502, 503, 504

## Making RPC Calls

### Basic Call

```python
result = await client.call("method.name", {"param": "value"})
```

### With Timeout Override

```python
result = await client.call(
    "ai.generate",
    {"prompt": "Long task..."},
    timeout=120.0  # 2 minute timeout for this call
)
```

### Streaming Responses

```python
async for chunk in client.stream("ai.generate", {"prompt": "Hello"}):
    print(chunk, end="", flush=True)
```

## Context Manager Usage

### Async Context Manager

```python
async with DotDo(api_key="key") as client:
    result = await client.call("method", params)
    # Connection pool is automatically cleaned up
```

### Manual Lifecycle

```python
client = DotDo(api_key="key")
await client.connect()

try:
    result = await client.call("method", params)
finally:
    await client.close()
```

## Error Handling

### Exception Types

```python
from platform_do import (
    DotDoError,          # Base exception
    AuthError,           # Authentication failed
    ConnectionError,     # Connection issues
    TimeoutError,        # Request timed out
    RateLimitError,      # Rate limit exceeded
    RpcError,            # RPC method error
)
```

### Error Handling Example

```python
from platform_do import DotDo, AuthError, RateLimitError, TimeoutError

async def make_request():
    client = DotDo(api_key="key")

    try:
        async with client:
            result = await client.call("ai.generate", {"prompt": "Hello"})
            return result
    except AuthError as e:
        print(f"Authentication failed: {e}")
        # Re-authenticate or check API key
    except RateLimitError as e:
        print(f"Rate limited. Retry after: {e.retry_after}s")
        await asyncio.sleep(e.retry_after)
        # Retry the request
    except TimeoutError:
        print("Request timed out")
        # Maybe try with longer timeout
    except DotDoError as e:
        print(f"DotDo error: {e}")
        raise
```

## Collections API

### Working with Collections

```python
async with DotDo(api_key="key") as client:
    users = client.collection("users")

    # Create a document
    await users.set("user-123", {
        "name": "Alice",
        "email": "alice@example.com",
    })

    # Read a document
    user = await users.get("user-123")
    print(user)

    # Update a document
    await users.update("user-123", {"name": "Alice Smith"})

    # Delete a document
    await users.delete("user-123")
```

### Querying Collections

```python
async with DotDo(api_key="key") as client:
    users = client.collection("users")

    # Build a query
    results = await (
        users.query()
        .where("status", "==", "active")
        .where("age", ">=", 18)
        .order_by("created_at", descending=True)
        .limit(10)
        .offset(0)
        .execute()
    )

    for user in results:
        print(user)
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `==`     | Equal to |
| `!=`     | Not equal to |
| `<`      | Less than |
| `<=`     | Less than or equal |
| `>`      | Greater than |
| `>=`     | Greater than or equal |
| `in`     | In list |
| `not_in` | Not in list |

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```python
# Auth is handled automatically
client = DotDo(api_key=os.environ["DOTDO_API_KEY"])
```

### Usage Metrics

```python
# Platform tracks usage automatically
# View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```python
# Usage is metered and billed through the platform
# Configure billing at https://platform.do/billing
```

### Centralized Logging

```python
# Enable debug mode for verbose logging
client = DotDo(debug=True)
```

## Type Hints

The SDK provides full type hint support:

```python
from platform_do import DotDo
from typing import TypedDict

class GenerateParams(TypedDict):
    prompt: str
    model: str
    max_tokens: int | None

class GenerateResult(TypedDict):
    text: str
    usage: dict[str, int]

async def generate(client: DotDo, params: GenerateParams) -> GenerateResult:
    result = await client.call("ai.generate", params)
    return result  # Type checked
```

## Best Practices

### 1. Use Context Managers

```python
# Good - automatic cleanup
async with DotDo(api_key="key") as client:
    await client.call("method", params)

# Bad - may leak connections
client = DotDo(api_key="key")
await client.call("method", params)
# Forgot to close!
```

### 2. Reuse Client Instances

```python
# Good - single client instance
client = DotDo(api_key="key")

async def handler1():
    await client.call("method1", {})

async def handler2():
    await client.call("method2", {})

# Bad - new client per request
async def bad_handler():
    client = DotDo(api_key="key")  # Creates new connection pool!
    await client.call("method", {})
```

### 3. Handle Specific Errors

```python
# Good - specific error handling
try:
    await client.call("method", params)
except RateLimitError as e:
    await asyncio.sleep(e.retry_after)
except AuthError:
    await refresh_token()
except DotDoError:
    raise

# Bad - catch-all
try:
    await client.call("method", params)
except Exception:
    pass
```

### 4. Use Type Hints

```python
# Good - type hints for safety
from typing import TypedDict

class Params(TypedDict):
    prompt: str

result: dict = await client.call("ai.generate", Params(prompt="Hello"))

# Works but no type safety
result = await client.call("ai.generate", {"prompt": "Hello"})
```

## API Reference

### DotDo Class

```python
class DotDo:
    def __init__(
        self,
        api_key: str | None = None,
        access_token: str | None = None,
        endpoint: str = "wss://api.dotdo.dev/rpc",
        headers: dict[str, str] | None = None,
        pool_size: int = 10,
        pool_timeout: float = 30.0,
        max_retries: int = 3,
        retry_delay: float = 0.1,
        retry_max_delay: float = 30.0,
        retry_multiplier: float = 2.0,
        timeout: float = 30.0,
        debug: bool = False,
    ) -> None: ...

    async def connect(self) -> None: ...
    async def close(self) -> None: ...

    async def call(
        self,
        method: str,
        params: dict[str, Any],
        timeout: float | None = None,
    ) -> Any: ...

    async def stream(
        self,
        method: str,
        params: dict[str, Any],
    ) -> AsyncIterator[Any]: ...

    def collection(self, name: str) -> Collection: ...

    async def __aenter__(self) -> "DotDo": ...
    async def __aexit__(self, *args) -> None: ...
```

### Collection Class

```python
class Collection:
    async def get(self, id: str) -> dict[str, Any]: ...
    async def set(self, id: str, data: dict[str, Any]) -> None: ...
    async def update(self, id: str, data: dict[str, Any]) -> None: ...
    async def delete(self, id: str) -> None: ...
    def query(self) -> QueryBuilder: ...
```

### QueryBuilder Class

```python
class QueryBuilder:
    def where(
        self,
        field: str,
        op: str,
        value: Any,
    ) -> "QueryBuilder": ...

    def order_by(
        self,
        field: str,
        descending: bool = False,
    ) -> "QueryBuilder": ...

    def limit(self, n: int) -> "QueryBuilder": ...
    def offset(self, n: int) -> "QueryBuilder": ...

    async def execute(self) -> list[dict[str, Any]]: ...
    async def first(self) -> dict[str, Any] | None: ...
```

## Requirements

- Python 3.11+
- asyncio

## Development

```bash
# Install dev dependencies
pip install platform-do[dev]

# Run tests
pytest

# Type checking
mypy src/

# Linting
ruff check src/
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/python)
- [PyPI](https://pypi.org/project/platform-do/)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
