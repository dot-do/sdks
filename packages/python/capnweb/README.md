# capnweb

**Capability-based RPC that feels like Python.**

```python
async with capnweb.connect("wss://api.example.com") as api:
    name = await api.users.get(123).profile.display_name
```

One import. One connection. One round trip.

---

## Why capnweb?

- **Invisible pipelining** - Chain method calls without awaiting; capnweb batches everything into minimal round trips
- **Python-native** - Context managers, exceptions, `async`/`await`, decorators, type hints
- **Bidirectional** - Export local objects as RPC targets; the server can call you back
- **Zero boilerplate** - No code generation, no schema files, no build step
- **Full typing support** - `Protocol` classes give you IDE autocomplete and type checking

```python
# Three dependent calls, ONE network round trip:
profile = await api.authenticate(token).user.profile
```

---

## Installation

```bash
pip install capnweb-do
```

Requires Python 3.10+.

> **Note:** The package is published as `capnweb-do` on PyPI (since PyPI doesn't allow dots in package names). After installation, import it as `capnweb`.

---

## Quick Start

```python
import asyncio
import capnweb

async def main():
    async with capnweb.connect("wss://api.example.com") as api:
        # Simple call
        user = await api.users.get(123)
        print(f"Hello, {user['name']}")

        # Pipelined chain - still one round trip
        avatar_url = await api.users.get(123).profile.avatar.url

        # Keyword arguments
        new_user = await api.users.create(
            name="Alice",
            email="alice@example.com",
            roles=["admin", "developer"]
        )

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Pipelining

The killer feature. Chain method calls without waiting for intermediate results.

### The Problem

```python
# Traditional RPC: THREE round trips
auth = await api.authenticate(token)      # Wait for network...
user = await api.users.get(auth.user_id)  # Wait for network...
profile = await api.profiles.get(user.id) # Wait for network...
```

### The Solution

```python
# capnweb: ONE round trip
profile = await api.authenticate(token).user.profile
```

### How does it work?

Every attribute access and method call returns an `RpcPromise` - a lazy proxy that records the operation without executing it. When you finally `await`, capnweb sends the entire chain as a single request. The server evaluates dependencies internally and returns the final result.

```python
# Build the pipeline - nothing sent yet
auth = api.authenticate(token)        # RpcPromise
user_id = auth.user_id                # RpcPromise (pipelines through auth)
profile = api.profiles.get(user_id)   # RpcPromise (uses user_id before it resolves)

# NOW we send everything - one round trip
result = await profile
```

The server receives the complete expression graph and resolves it in the optimal order.

### Parallel Pipelines

Fork a pipeline to fetch multiple things at once:

```python
async with capnweb.connect("wss://api.example.com") as api:
    session = api.authenticate(token)  # Not sent yet

    # Branch from the same session
    user_promise = session.user
    permissions_promise = session.permissions
    settings_promise = session.settings

    # Single round trip resolves all branches
    user, permissions, settings = await asyncio.gather(
        user_promise,
        permissions_promise,
        settings_promise
    )
```

---

## Type Hints

capnweb works without types, but add them for IDE autocomplete and static analysis.

```python
from typing import Protocol
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
    email: str

@dataclass
class Profile:
    display_name: str
    avatar_url: str | None

class UsersApi(Protocol):
    def get(self, id: int) -> "RpcPromise[User]": ...
    def create(self, *, name: str, email: str) -> "RpcPromise[User]": ...
    def list(self) -> "RpcPromise[list[User]]": ...

class ProfilesApi(Protocol):
    def get(self, user_id: int) -> "RpcPromise[Profile]": ...

class Api(Protocol):
    users: UsersApi
    profiles: ProfilesApi

    def authenticate(self, token: str) -> "RpcPromise[AuthenticatedApi]": ...
```

Type the connection using generic subscript syntax:

```python
from capnweb import RpcPromise

async with capnweb.connect[Api]("wss://api.example.com") as api:
    user = await api.users.get(123)   # IDE knows: User
    print(user.name)                   # IDE knows: str

    # Pipelining through typed interfaces
    name = await api.users.get(123).profile.display_name  # IDE knows: str
```

**Note:** Types are purely for tooling. The runtime does not validate them against the actual API responses.

---

## Async Iteration and Streaming

Subscribe to real-time data with async iterators:

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Stream events as they arrive
    async for event in api.events.subscribe("user.created"):
        print(f"New user: {event['name']}")

        if event["name"] == "stop":
            break  # Breaking closes the subscription
```

### Implementing a Stream Handler

For bidirectional streaming, use a Target:

```python
from capnweb import Target

class EventProcessor(Target):
    def __init__(self):
        self.events: list[dict] = []

    async def on_event(self, event: dict) -> None:
        self.events.append(event)
        print(f"Received: {event}")

    async def on_complete(self) -> None:
        print(f"Stream complete. Processed {len(self.events)} events.")

    async def on_error(self, error: str) -> None:
        print(f"Stream error: {error}")

async with capnweb.connect("wss://api.example.com") as api:
    processor = EventProcessor()
    subscription = await api.events.subscribe("orders", processor)

    # Server calls processor.on_event() as events arrive
    await asyncio.sleep(60)

    await subscription.cancel()
```

### Async Generator Pattern

Create async generators that yield from remote streams:

```python
async def fetch_all_pages(api, query: str):
    """Async generator that handles pagination automatically."""
    cursor = None
    while True:
        page = await api.search(query, cursor=cursor)
        for item in page.items:
            yield item

        if not page.has_more:
            break
        cursor = page.next_cursor

# Usage
async with capnweb.connect("wss://api.example.com") as api:
    async for result in fetch_all_pages(api, "python"):
        print(result["title"])
```

---

## Error Handling

capnweb uses Python exceptions with full remote error information.

```python
from capnweb import RpcError, ConnectionError, TimeoutError

async with capnweb.connect("wss://api.example.com") as api:
    try:
        result = await api.dangerous_operation()
    except RpcError as e:
        print(f"Server error: {e.message}")
        print(f"Error type: {e.error_type}")  # e.g., "ValueError", "NotFoundError"
        if e.stack:
            print(f"Remote traceback:\n{e.stack}")
    except ConnectionError as e:
        print(f"Connection lost: {e}")
    except TimeoutError:
        print("Request timed out")
```

### Pattern Matching on Error Types

```python
try:
    user = await api.users.get(999)
except RpcError as e:
    match e.error_type:
        case "NotFoundError":
            return None
        case "PermissionDeniedError":
            raise PermissionError("Access denied") from e
        case "ValidationError":
            raise ValueError(e.message) from e
        case _:
            raise
```

### Retry with Exponential Backoff

```python
from capnweb import RpcError, ConnectionError
import asyncio
import random

async def with_retry(
    coro_fn,
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
):
    """Retry an RPC call with exponential backoff and jitter."""
    last_error = None

    for attempt in range(max_attempts):
        try:
            return await coro_fn()
        except ConnectionError as e:
            last_error = e
            if attempt == max_attempts - 1:
                raise

            delay = min(base_delay * (2 ** attempt), max_delay)
            jitter = random.uniform(0, delay * 0.1)
            await asyncio.sleep(delay + jitter)
        except RpcError as e:
            # Don't retry client errors
            if e.error_type in ("ValidationError", "NotFoundError", "PermissionDeniedError"):
                raise
            last_error = e
            if attempt == max_attempts - 1:
                raise

            delay = min(base_delay * (2 ** attempt), max_delay)
            await asyncio.sleep(delay)

    raise last_error

# Usage
user = await with_retry(lambda: api.users.get(123))
```

### Circuit Breaker Pattern

```python
import time
from enum import Enum
from capnweb import ConnectionError, RpcError

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure_time = 0.0
        self.state = CircuitState.CLOSED

    async def call(self, coro_fn):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
            else:
                raise ConnectionError("Circuit breaker is open")

        try:
            result = await coro_fn()
            self._on_success()
            return result
        except (ConnectionError, RpcError) as e:
            self._on_failure()
            raise

    def _on_success(self):
        self.failures = 0
        self.state = CircuitState.CLOSED

    def _on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN

# Usage
breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)

try:
    user = await breaker.call(lambda: api.users.get(123))
except ConnectionError as e:
    if "Circuit breaker" in str(e):
        # Fall back to cache or return error
        return get_cached_user(123)
    raise
```

---

## Workflow Orchestration

Build complex workflows with task dependencies.

### Sequential Tasks

```python
async def onboard_user(api, user_data: dict) -> dict:
    """Multi-step workflow with explicit dependencies."""

    # Step 1: Create user
    user = await api.users.create(**user_data)

    # Step 2: Create profile (depends on user)
    profile = await api.profiles.create(
        user_id=user["id"],
        display_name=user_data["name"],
    )

    # Step 3: Send welcome email (depends on user)
    await api.notifications.send_welcome(user_id=user["id"])

    # Step 4: Setup defaults (depends on user)
    await api.settings.create_defaults(user_id=user["id"])

    return {"user": user, "profile": profile}
```

### Parallel with Dependencies (DAG)

```python
async def provision_workspace(api, owner_id: int) -> dict:
    """
    Workflow DAG:

        create_workspace
             |
        +----+----+
        |         |
    setup_db   setup_storage
        |         |
        +----+----+
             |
       deploy_app
    """

    # Step 1: Create workspace
    workspace = await api.workspaces.create(owner_id=owner_id)
    ws_id = workspace["id"]

    # Step 2: Parallel setup (both depend on workspace)
    db_task = api.databases.provision(workspace_id=ws_id)
    storage_task = api.storage.provision(workspace_id=ws_id)

    db, storage = await asyncio.gather(db_task, storage_task)

    # Step 3: Deploy app (depends on both db and storage)
    app = await api.apps.deploy(
        workspace_id=ws_id,
        database_url=db["connection_url"],
        storage_bucket=storage["bucket"],
    )

    return {
        "workspace": workspace,
        "database": db,
        "storage": storage,
        "app": app,
    }
```

### Saga Pattern with Compensation

```python
from contextlib import asynccontextmanager
from typing import Callable, Awaitable

class SagaStep:
    def __init__(
        self,
        action: Callable[[], Awaitable],
        compensate: Callable[[], Awaitable],
    ):
        self.action = action
        self.compensate = compensate

class Saga:
    def __init__(self):
        self.completed_steps: list[SagaStep] = []

    async def execute(self, steps: list[SagaStep]):
        """Execute steps; rollback on failure."""
        try:
            for step in steps:
                await step.action()
                self.completed_steps.append(step)
        except Exception as e:
            await self._rollback()
            raise

    async def _rollback(self):
        """Compensate in reverse order."""
        for step in reversed(self.completed_steps):
            try:
                await step.compensate()
            except Exception as comp_error:
                # Log but continue rollback
                print(f"Compensation failed: {comp_error}")

async def transfer_funds(api, from_account: str, to_account: str, amount: float):
    """Bank transfer with saga-based rollback."""
    withdrawal_id = None
    deposit_id = None

    saga = Saga()
    await saga.execute([
        SagaStep(
            action=lambda: _withdraw(),
            compensate=lambda: _refund_withdrawal(),
        ),
        SagaStep(
            action=lambda: _deposit(),
            compensate=lambda: _reverse_deposit(),
        ),
    ])

    async def _withdraw():
        nonlocal withdrawal_id
        result = await api.accounts.withdraw(from_account, amount)
        withdrawal_id = result["transaction_id"]

    async def _refund_withdrawal():
        if withdrawal_id:
            await api.accounts.deposit(from_account, amount, reason="saga_rollback")

    async def _deposit():
        nonlocal deposit_id
        result = await api.accounts.deposit(to_account, amount)
        deposit_id = result["transaction_id"]

    async def _reverse_deposit():
        if deposit_id:
            await api.accounts.withdraw(to_account, amount, reason="saga_rollback")

    return {"withdrawal_id": withdrawal_id, "deposit_id": deposit_id}
```

---

## Map Operations

Transform collections server-side with `.map()`:

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Extract emails from all users - server does the mapping
    emails = await api.users.list().map(lambda u: u.email)

    # Complex transforms with captured references
    enriched = await api.user_ids.map(lambda id: {
        "id": id,
        "profile": api.profiles.get(id),
        "avatar": api.avatars.get(id),
        "recent_posts": api.posts.by_author(id).limit(5)
    })
```

### How does `.map()` work?

The lambda is serialized to an instruction set and sent to the server. The server executes the mapping operation and returns results.

**WARNING:** Lambda serialization has constraints:

1. **Only simple lambdas** - Single-expression lambdas that access the parameter and captured API references
2. **No arbitrary code** - You cannot call arbitrary Python functions inside the lambda
3. **Captured values must be serializable** - Numbers, strings, API stubs are fine; database connections are not
4. **No side effects** - The lambda should be pure; side effects may execute multiple times or not at all

```python
# GOOD: Simple property access
emails = await api.users.list().map(lambda u: u.email)

# GOOD: Captured API references
profile_api = api.profiles
enriched = await api.users.list().map(lambda u: {
    "user": u,
    "profile": profile_api.get(u.id)
})

# BAD: Arbitrary function calls
def custom_transform(u):
    return database.lookup(u.id)  # Won't work!

# BAD: Complex logic
await api.users.list().map(lambda u: u.name if u.active else "inactive")  # May not work
```

For complex transformations, fetch the data and transform locally:

```python
users = await api.users.list()
transformed = [custom_transform(u) for u in users]
```

---

## Exposing Local Objects

Pass Python objects to the server as RPC targets using the `Target` base class.

```python
from capnweb import Target

class Calculator(Target):
    """Methods on this object can be called by the server."""

    def __init__(self):
        self._memory = 0.0

    def add(self, a: float, b: float) -> float:
        return a + b

    def multiply(self, a: float, b: float) -> float:
        return a * b

    async def compute_slowly(self, n: int) -> int:
        """Async methods work too."""
        await asyncio.sleep(1)
        return n * 2

    @property
    def memory(self) -> float:
        return self._memory

    @memory.setter
    def memory(self, value: float):
        self._memory = value

    def _internal_helper(self):
        """Private methods (underscore prefix) are NOT exposed."""
        pass

    def __dispose__(self):
        """Called when the server releases all references."""
        print("Calculator disposed")

# Register with the server
async with capnweb.connect("wss://api.example.com") as api:
    calc = Calculator()
    await api.register_calculator(calc)

    # Server can now call calc.add(2, 3), etc.
    # Keep the connection alive while the server uses the calculator
    await asyncio.sleep(60)
```

### Target Rules

| Rule | Description |
|------|-------------|
| Public methods exposed | Methods without underscore prefix are callable remotely |
| Private methods hidden | `_prefixed` and `__dunder__` methods (except `__dispose__`) are not exposed |
| Properties work | `@property` getters and setters are accessible |
| Async supported | Both sync and async methods work |
| `__dispose__` cleanup | Called when all remote references are released |

### Decorator-Based Exposure Control

```python
from capnweb import Target, expose, hide

class SelectiveApi(Target):
    @expose
    def public_method(self) -> str:
        return "visible"

    @hide
    def seemingly_public_but_hidden(self) -> str:
        return "not exposed"

    def normal_public(self) -> str:
        return "visible by default"
```

---

## Connection Lifecycle

### Basic Connection (Context Manager)

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Connection is open
    user = await api.users.get(123)
# Connection automatically closed
```

### Manual Session Management

For long-lived connections or when you need more control:

```python
session = await capnweb.connect("wss://api.example.com")
try:
    api = session.root  # or just use session directly as the API
    await api.do_something()
finally:
    await session.close()
```

### Connection Options

```python
async with capnweb.connect(
    "wss://api.example.com",
    headers={"Authorization": "Bearer xxx"},
    timeout=30.0,
    ping_interval=25.0,  # WebSocket keepalive
) as api:
    ...
```

### Reconnection Handling

capnweb does not auto-reconnect by default. Implement reconnection logic for your use case:

```python
import asyncio
from capnweb import ConnectionError

class ReconnectingClient:
    def __init__(self, url: str, max_retries: int = 5):
        self.url = url
        self.max_retries = max_retries
        self.session = None
        self._reconnect_delay = 1.0

    async def connect(self):
        for attempt in range(self.max_retries):
            try:
                self.session = await capnweb.connect(self.url)
                self._reconnect_delay = 1.0  # Reset on success
                return
            except ConnectionError:
                if attempt == self.max_retries - 1:
                    raise
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, 30.0)

    async def call(self, method_path: str, *args, **kwargs):
        """Call with automatic reconnection."""
        if self.session is None:
            await self.connect()

        try:
            # Navigate to the method
            obj = self.session
            for part in method_path.split("."):
                obj = getattr(obj, part)
            return await obj(*args, **kwargs)
        except ConnectionError:
            self.session = None
            await self.connect()
            # Retry once after reconnect
            obj = self.session
            for part in method_path.split("."):
                obj = getattr(obj, part)
            return await obj(*args, **kwargs)

    async def close(self):
        if self.session:
            await self.session.close()

# Usage
client = ReconnectingClient("wss://api.example.com")
await client.connect()
try:
    user = await client.call("users.get", 123)
finally:
    await client.close()
```

### Connection Events

```python
from capnweb import Session

async def main():
    session = Session("wss://api.example.com")

    @session.on("connected")
    async def on_connected():
        print("Connected!")

    @session.on("disconnected")
    async def on_disconnected(error):
        print(f"Disconnected: {error}")

    @session.on("error")
    async def on_error(error):
        print(f"Error: {error}")

    await session.connect()
    api = session.root
    # ...
```

---

## HTTP Batch Mode

For REST-like APIs or environments without WebSocket support:

```python
async with capnweb.batch("https://api.example.com/rpc") as api:
    # Queue up calls - nothing sent yet
    user = api.get_user(123)
    profile = api.get_profile(user.id)      # Pipelines through user
    settings = api.get_settings(user.id)
    notifications = api.get_notifications(user.id)

    # Await all promises - ONE HTTP POST request
    u, p, s, n = await asyncio.gather(user, profile, settings, notifications)
```

The batch context manager collects all pending calls and sends them as a single HTTP POST when you await.

---

## Subscript Access

Access dynamic keys with bracket notation:

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Dictionary-style access
    config = await api.config["feature_flags"]["dark_mode"]

    # Array indexing
    first_user = await api.users.list()[0]

    # Mix freely
    value = await api.data["users"][0].settings["theme"]

    # Dynamic keys
    key = "some_dynamic_key"
    result = await api.config[key]
```

---

## Transports

capnweb supports multiple transport mechanisms:

```python
from capnweb import Session
from capnweb.transports import WebSocket, HttpBatch, MessagePort

# WebSocket (default)
session = Session(WebSocket("wss://api.example.com"))

# HTTP batch mode
session = Session(HttpBatch("https://api.example.com/rpc"))

# Browser MessagePort (for iframe/worker communication)
# This is for environments like Pyodide running in the browser
session = Session(MessagePort(port))

await session.connect()
api = session.root
```

---

## Testing

### Mock Sessions

```python
from unittest.mock import AsyncMock, MagicMock
from capnweb import RpcPromise

def create_mock_api():
    """Create a mock API for testing."""
    api = MagicMock()

    # Mock a simple call
    api.users.get = AsyncMock(return_value={"id": 123, "name": "Test User"})

    # Mock a pipelined call
    profile_mock = MagicMock()
    profile_mock.display_name = AsyncMock(return_value="Test Display Name")
    api.users.get.return_value.profile = profile_mock

    return api

async def test_user_service():
    api = create_mock_api()

    user = await api.users.get(123)
    assert user["name"] == "Test User"

    api.users.get.assert_called_once_with(123)
```

### Integration Testing with Local Server

```python
import pytest
from capnweb import Target
from capnweb.testing import LocalSession

class MockUsersApi(Target):
    def __init__(self):
        self.users = {
            123: {"id": 123, "name": "Alice"},
            456: {"id": 456, "name": "Bob"},
        }

    def get(self, id: int) -> dict:
        if id not in self.users:
            raise ValueError(f"User {id} not found")
        return self.users[id]

    def list(self) -> list[dict]:
        return list(self.users.values())

@pytest.fixture
async def api():
    """Create a local session for testing."""
    mock_root = MagicMock()
    mock_root.users = MockUsersApi()

    async with LocalSession(mock_root) as session:
        yield session.root

async def test_get_user(api):
    user = await api.users.get(123)
    assert user["name"] == "Alice"

async def test_user_not_found(api):
    with pytest.raises(RpcError) as exc_info:
        await api.users.get(999)
    assert "not found" in str(exc_info.value)
```

---

## Security Considerations

### Lambda Serialization

**WARNING:** The `.map()` lambda serialization sends code representations to the server. While designed to be safe, be aware:

1. **Server-controlled execution** - The server decides how to interpret the lambda. A malicious server could log or misuse the captured values.
2. **Captured values are transmitted** - Any values captured in the lambda closure are serialized and sent to the server.
3. **Don't capture secrets** - Never capture API keys, passwords, or sensitive data in map lambdas.

```python
# DANGEROUS: Don't do this!
secret_key = os.environ["SECRET_KEY"]
await api.data.map(lambda x: {"key": secret_key, "value": x})  # Leaks secret!

# SAFE: Let the server handle authentication
await api.authenticated_data.map(lambda x: x.value)
```

### Target Exposure

When exposing `Target` objects:

1. **Only public methods** - Private methods (`_prefixed`) are not exposed
2. **No magic methods** - `__init__`, `__dict__`, etc. are never exposed (except `__dispose__`)
3. **Validate inputs** - The server can call your methods with any arguments; validate them

```python
class SecureTarget(Target):
    def process_data(self, data: dict) -> dict:
        # ALWAYS validate inputs from remote calls
        if not isinstance(data, dict):
            raise TypeError("Expected dict")
        if "user_id" not in data:
            raise ValueError("Missing user_id")
        if not isinstance(data["user_id"], int):
            raise TypeError("user_id must be int")

        return self._do_processing(data)
```

### Connection Security

- Always use `wss://` (WebSocket Secure) in production
- Validate server certificates (default behavior)
- Use authentication headers for protected APIs

```python
async with capnweb.connect(
    "wss://api.example.com",
    headers={"Authorization": f"Bearer {token}"},
    # For self-signed certs in development only:
    # ssl_context=create_insecure_context(),  # NEVER in production!
) as api:
    ...
```

---

## API Reference

### Module Functions

```python
async def connect(url: str, **options) -> AsyncContextManager[RpcPromise]:
    """
    Connect via WebSocket.

    Args:
        url: WebSocket URL (wss:// or ws://)
        headers: Optional dict of HTTP headers
        timeout: Connection timeout in seconds (default: 30.0)
        ping_interval: WebSocket ping interval in seconds (default: 25.0)

    Returns:
        Context manager yielding the root RpcPromise stub
    """

async def batch(url: str, **options) -> AsyncContextManager[RpcPromise]:
    """
    Connect via HTTP with automatic request batching.

    Args:
        url: HTTP URL (https:// or http://)
        headers: Optional dict of HTTP headers
        timeout: Request timeout in seconds (default: 30.0)

    Returns:
        Context manager yielding the root RpcPromise stub
    """
```

### Classes

```python
class RpcPromise(Generic[T]):
    """
    A lazy RPC reference supporting pipelining.

    RpcPromise is both awaitable and chainable. Attribute access and method
    calls return new RpcPromise instances, building a pipeline. The actual
    network request is only sent when you await.
    """

    def __await__(self) -> T:
        """Await to get the resolved value."""

    def __getattr__(self, name: str) -> "RpcPromise[Any]":
        """Access an attribute, returning a pipelined promise."""

    def __getitem__(self, key: Any) -> "RpcPromise[Any]":
        """Access by key/index, returning a pipelined promise."""

    def __call__(self, *args: Any, **kwargs: Any) -> "RpcPromise[Any]":
        """Call as a method, returning a pipelined promise."""

    def map(self, fn: Callable[[T], R]) -> "RpcPromise[list[R]]":
        """
        Map a function over a collection server-side.

        WARNING: The lambda is serialized and sent to the server.
        Only simple lambdas with API references are supported.
        """


class Target:
    """
    Base class for objects exposed over RPC.

    Subclass Target to create objects that the remote side can call methods on.
    Public methods (no underscore prefix) are exposed. Private methods are hidden.
    """

    def __dispose__(self) -> None:
        """
        Called when all remote references are released.

        Override to perform cleanup when the remote side no longer
        references this object.
        """


class Session:
    """
    Low-level session management.

    Use this for fine-grained control over the connection lifecycle.
    """

    def __init__(self, transport: Transport): ...

    async def connect(self) -> None: ...

    async def close(self) -> None: ...

    @property
    def root(self) -> RpcPromise:
        """The root API stub."""

    def on(self, event: str) -> Callable:
        """Decorator to register event handlers."""
```

### Exceptions

```python
class RpcError(Exception):
    """
    Remote exception from the server.

    Attributes:
        message: Error message from the server
        error_type: The type name of the remote exception (e.g., "ValueError")
        stack: Remote stack trace, if available (may be None for security)
    """
    message: str
    error_type: str
    stack: str | None


class ConnectionError(Exception):
    """
    Connection lost or failed to establish.

    Raised when the WebSocket connection drops or cannot be established.
    """


class TimeoutError(Exception):
    """
    Request timed out.

    Raised when a request exceeds the configured timeout.
    """
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```python
#!/usr/bin/env python3
"""
Complete capnweb example: A todo application with bidirectional RPC,
pipelining, streaming, and error handling.
"""

import asyncio
from dataclasses import dataclass
from typing import Protocol

import capnweb
from capnweb import Target, RpcPromise, RpcError


# ─── Type Definitions ───────────────────────────────────────────────────────

@dataclass
class User:
    id: int
    name: str
    email: str


@dataclass
class Todo:
    id: int
    title: str
    done: bool
    owner_id: int


class TodosApi(Protocol):
    def list(self) -> RpcPromise[list[Todo]]: ...
    def get(self, id: int) -> RpcPromise[Todo]: ...
    def create(self, *, title: str) -> RpcPromise[Todo]: ...
    def update(self, id: int, *, done: bool) -> RpcPromise[Todo]: ...
    def delete(self, id: int) -> RpcPromise[None]: ...


class AuthenticatedApi(Protocol):
    todos: TodosApi

    def me(self) -> RpcPromise[User]: ...


class Api(Protocol):
    def authenticate(self, token: str) -> RpcPromise[AuthenticatedApi]: ...
    def todos(self) -> TodosApi: ...  # Read-only access


# ─── Event Handler (Target for bidirectional RPC) ───────────────────────────

class TodoEventHandler(Target):
    """Receives real-time todo updates from the server."""

    def __init__(self):
        self.events: list[dict] = []

    async def on_created(self, todo: dict) -> None:
        print(f"  [Event] Todo created: {todo['title']}")
        self.events.append({"type": "created", "todo": todo})

    async def on_updated(self, todo: dict) -> None:
        status = "completed" if todo["done"] else "reopened"
        print(f"  [Event] Todo {status}: {todo['title']}")
        self.events.append({"type": "updated", "todo": todo})

    async def on_deleted(self, todo_id: int) -> None:
        print(f"  [Event] Todo deleted: #{todo_id}")
        self.events.append({"type": "deleted", "todo_id": todo_id})

    def __dispose__(self) -> None:
        print("  [Event] Subscription ended")


# ─── Main Application ───────────────────────────────────────────────────────

async def main():
    token = "demo-token-12345"

    async with capnweb.connect[Api]("wss://todo.example.com") as api:
        print("Connected to Todo API\n")

        # ─── Public read: list all todos ────────────────────────────────────
        print("Public todos:")
        todos = await api.todos().list()
        for todo in todos:
            status = "[x]" if todo.done else "[ ]"
            print(f"  {status} {todo.title}")

        # ─── Authenticate ───────────────────────────────────────────────────
        print("\nAuthenticating...")
        session = api.authenticate(token)

        # ─── Pipelined calls: get user AND todos in one round trip ──────────
        me_promise = session.me()
        my_todos_promise = session.todos.list()

        me, my_todos = await asyncio.gather(me_promise, my_todos_promise)
        print(f"\nWelcome, {me.name}!")
        print(f"You have {len(my_todos)} todos")

        # ─── Subscribe to real-time updates ─────────────────────────────────
        print("\nSubscribing to updates...")
        handler = TodoEventHandler()
        subscription = await session.todos.subscribe(handler)

        # ─── Create a new todo ──────────────────────────────────────────────
        print("\nCreating new todo...")
        new_todo = await session.todos.create(title="Learn capnweb")
        print(f"Created: {new_todo.title} (#{new_todo.id})")

        # ─── Mark it complete ───────────────────────────────────────────────
        print("\nMarking as complete...")
        updated = await session.todos.update(new_todo.id, done=True)
        print(f"Updated: {updated.title} - done={updated.done}")

        # ─── Error handling ─────────────────────────────────────────────────
        print("\nTrying to get non-existent todo...")
        try:
            await session.todos.get(99999)
        except RpcError as e:
            print(f"Expected error: {e.error_type} - {e.message}")

        # ─── Cleanup ────────────────────────────────────────────────────────
        print("\nCleaning up...")
        await session.todos.delete(new_todo.id)

        # Cancel subscription
        await subscription.cancel()

        print(f"\nReceived {len(handler.events)} events during session")
        print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
```

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Simple things simple** | `await api.users.get(123)` just works |
| **Complex things possible** | Full pipelining, bidirectional RPC, custom transports |
| **Pipelining invisible** | Don't await = automatic pipelining |
| **Python idioms** | Context managers, exceptions, async/await, decorators |
| **Types optional but powerful** | Works without types, shines with them |

---

## License

MIT
