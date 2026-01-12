# Cap'n Web Python API

The definitive API for `capnweb` - designed to feel like native Python.

---

## Philosophy

```
Simple things should be simple.
Complex things should be possible.
Pipelining should be invisible.
```

---

## The API

### Connect

```python
import capnweb

async with capnweb.connect("wss://api.example.com") as api:
    result = await api.greet("World")
```

That's it. One import. One line to connect. One line to call.

---

### Call Methods

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Method calls
    user = await api.users.get(123)

    # With arguments
    user = await api.users.create(name="Alice", email="alice@example.com")

    # Chain properties and methods freely
    name = await api.users.get(123).profile.display_name
    friends = await api.users.get(123).friends.list(limit=10)
```

Every attribute access returns an `RpcPromise`. Await it when you want the value.

---

### Pipeline Automatically

Don't await? It pipelines.

```python
async with capnweb.connect("wss://api.example.com") as api:
    # These chain without waiting - one round trip
    auth = api.authenticate(token)          # RpcPromise
    profile = api.profiles.get(auth.user_id)  # Pipelines through auth

    # Await only what you need
    result = await profile
```

For HTTP batch mode:

```python
async with capnweb.batch("https://api.example.com") as api:
    # Everything batches into one request
    user = api.get_user(123)
    profile = api.get_profile(user.id)
    settings = api.get_settings(user.id)

    # Sent when you await (or exit the context)
    u, p, s = await capnweb.gather(user, profile, settings)
```

---

### Map Over Remote Data

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Map executes server-side - one round trip
    names = await api.users.list().map(lambda u: u.name)

    # Complex transforms
    enriched = await api.user_ids.map(lambda id: {
        "id": id,
        "profile": api.profiles.get(id),
        "avatar": api.avatars.get(id)
    })
```

---

### Type Your API (Optional)

```python
from typing import Protocol
from dataclasses import dataclass

@dataclass
class User:
    id: int
    name: str
    email: str

class UserApi(Protocol):
    async def get(self, id: int) -> User: ...
    async def create(self, name: str, email: str) -> User: ...

class Api(Protocol):
    users: UserApi

# Full IDE autocomplete and type checking
async with capnweb.connect[Api]("wss://api.example.com") as api:
    user = await api.users.get(123)  # IDE knows this returns User
    print(user.name)                  # IDE knows this is str
```

Types are optional. The API works perfectly without them.

---

### Expose Local Objects

```python
from capnweb import Target

class Calculator(Target):
    def add(self, a: float, b: float) -> float:
        return a + b

    def multiply(self, a: float, b: float) -> float:
        return a * b

    def __dispose__(self):
        print("Calculator released")

async with capnweb.connect("wss://api.example.com") as api:
    calc = Calculator()
    await api.register_calculator(calc)  # Server can now call calc
```

Public methods are exposed. Private methods (`_prefixed`) are hidden.

---

### Handle Errors

```python
from capnweb import RpcError, ConnectionError

async with capnweb.connect("wss://api.example.com") as api:
    try:
        result = await api.dangerous_operation()
    except RpcError as e:
        print(f"Remote error: {e.message}")
        print(f"Type: {e.error_type}")
    except ConnectionError as e:
        print(f"Connection lost: {e}")
```

---

## Core Type Signatures

```python
from typing import TypeVar, Generic, Generator, Callable, Any

T = TypeVar("T")
R = TypeVar("R")

class RpcPromise(Generic[T]):
    """An awaitable that supports chaining for pipelining."""

    def __await__(self) -> Generator[Any, None, T]:
        """Await to get the resolved value."""
        ...

    def __getattr__(self, name: str) -> "RpcPromise[Any]":
        """Access properties on the future result."""
        ...

    def __call__(self, *args, **kwargs) -> "RpcPromise[Any]":
        """Call methods on the future result."""
        ...

    def map(self, fn: Callable[[T], R]) -> "RpcPromise[list[R]]":
        """Map a function over a remote collection."""
        ...


class Target:
    """Base class for objects exposed over RPC."""

    def __dispose__(self) -> None:
        """Called when all remote references are released."""
        ...


async def connect(url: str) -> "AsyncContextManager[RpcPromise]":
    """Connect via WebSocket."""
    ...

async def batch(url: str) -> "AsyncContextManager[RpcPromise]":
    """Connect via HTTP with request batching."""
    ...

async def gather(*promises: RpcPromise) -> tuple:
    """Await multiple promises concurrently."""
    ...
```

---

## Why This Design

**From Approach 1 (Context Managers):**
- `async with connect()` for lifecycle management
- `RpcError`, `ConnectionError` for Pythonic exceptions
- `gather()` for concurrent awaiting

**From Approach 2 (Descriptors):**
- Invisible pipelining through `__getattr__`
- Subscript access: `api.items["key"]`
- Minimal boilerplate

**From Approach 3 (Dataclasses):**
- Protocol-based type hints
- Dataclass return types
- Strong IDE integration

**From Approach 4 (Fluent):**
- Method chaining that reads naturally
- `map()` on promises

---

## The Beauty

```python
import capnweb

async with capnweb.connect("wss://api.example.com") as api:
    # One line to get deeply nested data - one round trip
    name = await api.users.get(123).profile.display_name

    # Pipeline without thinking about it
    auth = api.authenticate(token)
    data = await api.dashboard.get(auth.user_id)

    # Transform remote data elegantly
    emails = await api.users.list().map(lambda u: u.email)

    # Pass callbacks naturally
    class Handler(capnweb.Target):
        async def on_event(self, data):
            print(data)

    await api.subscribe(Handler())
```

No ceremony. No configuration. Just Python.
