# Cap'n Web Python Client: Syntax Exploration

This document explores divergent syntax approaches for `capnweb`, a Python client library for Cap'n Web RPC. The goal is to find the most Pythonic, elegant, and developer-friendly API.

---

## Table of Contents

1. [Approach 1: The Async Context Manager Pattern](#approach-1-the-async-context-manager-pattern)
2. [Approach 2: The Descriptor/Property Protocol Pattern](#approach-2-the-descriptorproperty-protocol-pattern)
3. [Approach 3: The Dataclass + Protocol Pattern](#approach-3-the-dataclass--protocol-pattern)
4. [Approach 4: The Fluent Builder Pattern](#approach-4-the-fluent-builder-pattern)
5. [Comparison Matrix](#comparison-matrix)
6. [Recommendations](#recommendations)

---

## Approach 1: The Async Context Manager Pattern

**Inspiration**: `aiohttp`, `httpx`, `asyncpg`, `aiosqlite`

This approach leans heavily into Python's context manager protocol, making resource lifecycle management explicit and safe. It feels familiar to anyone who has used `async with` for database connections or HTTP sessions.

### Connection / Session Creation

```python
import capnweb
from capnweb import RpcTarget

# WebSocket session with async context manager
async with capnweb.connect("wss://api.example.com") as api:
    result = await api.hello("World")
    print(result)  # "Hello, World!"

# HTTP batch session (single round-trip)
async with capnweb.batch("https://api.example.com") as api:
    user = api.get_user(123)  # Not awaited yet
    profile = api.get_profile(user.id)  # Pipelined
    # Batch sent when exiting context
    print(await profile)

# Explicit session for long-running connections
session = await capnweb.connect("wss://api.example.com")
try:
    result = await session.api.greet("Alice")
finally:
    await session.close()
```

### Making RPC Calls

```python
async with capnweb.connect("wss://api.example.com") as api:
    # Simple method call
    greeting = await api.greet("Alice")

    # Property access (returns RpcPromise)
    name = await api.current_user.name

    # Chained method calls
    friends = await api.users.get(123).friends.list()

    # Passing keyword arguments
    user = await api.users.create(
        name="Bob",
        email="bob@example.com",
        roles=["admin", "user"]
    )
```

### Pipelining Syntax

```python
async with capnweb.batch("https://api.example.com") as api:
    # All these calls are batched into a single request
    authed = api.authenticate(token)  # RpcPromise, not awaited
    user_id = authed.get_user_id()    # Pipelined through promise
    profile = api.get_profile(user_id)  # Uses promise as parameter
    notifications = authed.get_notifications()

    # Await multiple at once - batch sent here
    user_profile, notifs = await capnweb.gather(profile, notifications)

    # Or use standard asyncio
    import asyncio
    user_profile, notifs = await asyncio.gather(profile, notifications)
```

### The `map()` Operation

```python
async with capnweb.batch("https://api.example.com") as api:
    user_ids = api.list_user_ids()

    # Map over remote array - single round trip!
    user_data = await user_ids.map(lambda id: {
        "id": id,
        "profile": api.get_profile(id)
    })

    # Async map for complex transformations
    async def enrich(user_promise):
        return {
            "user": user_promise,
            "avatar": api.get_avatar(user_promise.id)
        }

    enriched = await user_ids.map(enrich)
```

### Error Handling

```python
from capnweb import RpcError, ConnectionError, TimeoutError

async with capnweb.connect("wss://api.example.com") as api:
    try:
        result = await api.dangerous_operation()
    except RpcError as e:
        # Remote error with stack trace
        print(f"RPC failed: {e.message}")
        print(f"Remote type: {e.error_type}")  # e.g., "ValueError"
        print(f"Remote stack: {e.stack}")
    except ConnectionError as e:
        # Connection lost
        print(f"Connection lost: {e}")
    except TimeoutError as e:
        # Request timed out
        print(f"Timeout: {e}")

# Broken connection callback
async with capnweb.connect("wss://api.example.com") as api:
    @api.on_broken
    async def handle_disconnect(error):
        print(f"Connection broken: {error}")

    # ... use api ...
```

### Exposing Local Objects as RPC Targets

```python
from capnweb import RpcTarget, rpc_method, rpc_property

class Calculator(RpcTarget):
    """A calculator exposed over RPC."""

    def __init__(self):
        self._memory = 0

    # All public methods are automatically exposed
    def add(self, a: float, b: float) -> float:
        return a + b

    def multiply(self, a: float, b: float) -> float:
        return a * b

    # Async methods work too
    async def slow_compute(self, n: int) -> int:
        await asyncio.sleep(1)
        return n * 2

    # Properties are exposed as remote properties
    @property
    def memory(self) -> float:
        return self._memory

    @memory.setter
    def memory(self, value: float):
        self._memory = value

    # Private methods (prefixed with _) are NOT exposed
    def _internal_helper(self):
        pass

    # Cleanup when all references released
    def __dispose__(self):
        print("Calculator disposed")


# Passing target as callback
async with capnweb.connect("wss://api.example.com") as api:
    calc = Calculator()
    await api.register_calculator(calc)  # Server can now call calc
```

### Type Hints Support

```python
from typing import Protocol, TypeVar
from capnweb import RpcStub, RpcPromise

# Define interface as Protocol
class UserApi(Protocol):
    def get_user(self, id: int) -> "User": ...
    def list_users(self) -> list["User"]: ...
    def authenticate(self, token: str) -> "AuthedApi": ...

class AuthedApi(Protocol):
    def get_notifications(self) -> list["Notification"]: ...
    def get_user_id(self) -> int: ...

class User(Protocol):
    name: str
    email: str

    def get_friends(self) -> list["User"]: ...

# Typed connection
async with capnweb.connect[UserApi]("wss://api.example.com") as api:
    # Full IDE autocomplete and type checking!
    user = await api.get_user(123)
    print(user.name)  # IDE knows this is str
```

---

## Approach 2: The Descriptor/Property Protocol Pattern

**Inspiration**: Django ORM, SQLAlchemy, attrs

This approach uses Python's descriptor protocol to create a declarative, model-like API. It trades some explicitness for extreme elegance in common cases.

### Connection / Session Creation

```python
from capnweb import Session, WebSocket, HttpBatch, MessagePort

# Sessions are created explicitly
session = Session(WebSocket("wss://api.example.com"))

# Alternative transports
session = Session(HttpBatch("https://api.example.com"))
session = Session(MessagePort(channel.port1))

# With options
session = Session(
    WebSocket("wss://api.example.com"),
    timeout=30.0,
    reconnect=True,
    headers={"Authorization": "Bearer xxx"}
)

# Lifecycle
await session.connect()
api = session.stub  # Get the root stub
# ... use api ...
await session.close()

# Or use as context manager
async with Session(WebSocket("wss://api.example.com")) as session:
    api = session.stub
```

### Making RPC Calls

```python
async with Session(WebSocket("wss://api.example.com")) as session:
    api = session.stub

    # Method calls - dot notation just works
    result = await api.users.get(123)

    # Property chains
    name = await api.users.get(123).profile.display_name

    # Subscript access for dynamic keys
    item = await api.items["some-key"]
    element = await api.array[0]

    # Mixed access
    value = await api.config["features"].get_feature("dark_mode").enabled
```

### Pipelining Syntax

```python
from capnweb import pipeline

async with Session(WebSocket("wss://api.example.com")) as session:
    api = session.stub

    # Explicit pipeline block
    async with pipeline() as p:
        auth = api.authenticate(token)
        user_id = auth.user_id
        profile = api.profiles.get(user_id)
        notifications = auth.notifications.recent(limit=10)

        # Mark what we want
        p.pull(profile, notifications)

    # Results available after block
    print(profile.result)
    print(notifications.result)

    # Alternative: Pipeline decorator
    @pipeline
    async def get_user_data(api, token):
        auth = api.authenticate(token)
        return {
            "profile": api.profiles.get(auth.user_id),
            "notifications": auth.notifications.all()
        }

    data = await get_user_data(api, my_token)
```

### The `map()` Operation

```python
async with Session(WebSocket("wss://api.example.com")) as session:
    api = session.stub

    # Functional map
    names = await api.users.list().map(lambda u: u.name)

    # With capture - explicitly declare remote references used
    enriched = await api.user_ids.map(
        lambda id: {"id": id, "profile": api.profiles.get(id)},
        captures=[api.profiles]  # Explicit capture list
    )

    # Filter + map combo
    active = await (
        api.users.list()
        .filter(lambda u: u.is_active)
        .map(lambda u: u.email)
    )
```

### Error Handling

```python
from capnweb import RemoteError, Disconnected

async with Session(WebSocket("wss://api.example.com")) as session:
    api = session.stub

    try:
        result = await api.risky_operation()
    except RemoteError as e:
        # Matches remote exception type
        if e.matches(ValueError):
            print("Invalid value on server")
        elif e.matches("CustomError"):
            print("Custom server error")
        else:
            raise

    # Error boundaries with recovery
    async with session.error_boundary() as boundary:
        await api.operation_that_might_fail()

        if boundary.failed:
            await api.rollback()
```

### Exposing Local Objects as RPC Targets

```python
from capnweb import target, expose, hidden

@target
class GameState:
    """A game state exposed over RPC."""

    def __init__(self):
        self.score = 0
        self._secret_key = "abc123"  # Underscore = hidden

    @expose
    def get_score(self) -> int:
        return self.score

    @expose
    def add_points(self, points: int):
        self.score += points

    @hidden  # Explicit hide even without underscore
    def reset_for_testing(self):
        self.score = 0

    # Properties are exposed by default if not private
    @property
    @expose
    def high_score(self) -> int:
        return self._load_high_score()


# Callback registration style
@target
class EventHandler:
    async def on_message(self, message: str):
        print(f"Received: {message}")

    async def on_error(self, error: str):
        print(f"Error: {error}")

handler = EventHandler()
await api.subscribe(handler)  # Pass target to remote
```

### Type Hints Support

```python
from capnweb import Stub, Promise, Remote
from typing import Generic, TypeVar

T = TypeVar("T")

# Stub wrapper for IDE support
class Api(Stub):
    users: "Users"
    config: "Config"

    async def authenticate(self, token: str) -> "AuthedApi": ...

class Users(Stub):
    async def get(self, id: int) -> "User": ...
    async def list(self) -> list["User"]: ...
    async def create(self, **kwargs) -> "User": ...

class User(Stub):
    id: Promise[int]
    name: Promise[str]
    email: Promise[str]
    profile: "Profile"

    async def delete(self) -> None: ...

# Usage with full typing
async with Session[Api](WebSocket("wss://api.example.com")) as session:
    api: Api = session.stub
    user = await api.users.get(123)  # Returns User
    name = await user.name  # Returns str
```

---

## Approach 3: The Dataclass + Protocol Pattern

**Inspiration**: Pydantic, FastAPI, strawberry-graphql

This approach uses dataclasses and protocols to define strongly-typed RPC schemas, enabling validation, serialization, and excellent IDE support.

### Connection / Session Creation

```python
from dataclasses import dataclass
from capnweb import Client, connect
from typing import Optional

# Define your API schema as dataclasses
@dataclass
class UserProfile:
    id: int
    name: str
    email: str
    avatar_url: Optional[str] = None

@dataclass
class ApiConfig:
    url: str
    token: Optional[str] = None
    timeout: float = 30.0
    retry_count: int = 3

# Connect with typed client
config = ApiConfig(url="wss://api.example.com", token="xxx")
client = await connect(config)

# Or inline
client = await connect("wss://api.example.com")

# Context manager style
async with connect("wss://api.example.com") as client:
    pass

# HTTP batch with explicit typing
async with connect("https://api.example.com", batch=True) as client:
    pass
```

### Making RPC Calls

```python
from capnweb import remote, returns

# Define the remote interface
class UserService:
    @remote
    async def get_user(self, id: int) -> UserProfile:
        """Fetch a user by ID."""
        ...

    @remote
    async def create_user(
        self,
        name: str,
        email: str,
        roles: list[str] = None
    ) -> UserProfile:
        """Create a new user."""
        ...

    @remote
    @returns(list[UserProfile])
    async def list_users(self, limit: int = 100):
        """List all users."""
        ...

# Get typed service
async with connect("wss://api.example.com") as client:
    users = client.service(UserService)

    # Full typing and validation
    user = await users.get_user(123)  # Returns UserProfile
    print(user.name)  # IDE knows this is str

    # Validation on client side before sending
    new_user = await users.create_user(
        name="Alice",
        email="alice@example.com"
    )
```

### Pipelining Syntax

```python
from capnweb import Pipeline, Ref

async with connect("https://api.example.com", batch=True) as client:
    users = client.service(UserService)
    auth = client.service(AuthService)

    # Create pipeline
    pipe = Pipeline()

    # Build pipeline with refs
    auth_result = pipe.add(auth.authenticate(token))  # Ref[AuthResult]
    user_id = auth_result.user_id  # Ref[int] - property access on ref
    profile = pipe.add(users.get_profile(user_id))  # Uses ref as param

    # Execute pipeline
    results = await pipe.execute()

    # Access results
    my_profile = results[profile]  # Typed as UserProfile

    # Fluent alternative
    results = await (
        Pipeline()
        .call(auth.authenticate, token).as_("auth")
        .call(users.get_profile, Ref("auth").user_id).as_("profile")
        .call(auth.get_notifications, Ref("auth")).as_("notifs")
        .execute()
    )
```

### The `map()` Operation

```python
from capnweb import Map, Each

async with connect("wss://api.example.com") as client:
    users = client.service(UserService)

    # Get user IDs
    ids_promise = users.list_user_ids()

    # Map with typed lambda
    profiles = await Map(ids_promise).apply(
        lambda id: users.get_profile(id)
    )  # list[UserProfile]

    # With Each helper for complex transforms
    @Each
    async def enrich_user(user_id: int) -> dict:
        return {
            "id": user_id,
            "profile": users.get_profile(user_id),
            "avatar": users.get_avatar(user_id)
        }

    enriched = await ids_promise.map(enrich_user)

    # Parallel map with concurrency limit
    results = await Map(ids_promise).apply(
        users.get_profile,
        concurrency=10
    )
```

### Error Handling

```python
from capnweb import RpcException, ValidationError, NetworkError
from capnweb.errors import ErrorCode

@dataclass
class ApiError:
    code: ErrorCode
    message: str
    details: Optional[dict] = None

async with connect("wss://api.example.com") as client:
    users = client.service(UserService)

    try:
        user = await users.get_user(999)
    except RpcException as e:
        # Structured error from server
        error: ApiError = e.as_type(ApiError)
        if error.code == ErrorCode.NOT_FOUND:
            print(f"User not found: {error.message}")
    except ValidationError as e:
        # Client-side validation failed
        for field_error in e.errors:
            print(f"{field_error.field}: {field_error.message}")
    except NetworkError as e:
        # Connection issue
        print(f"Network error: {e}")

# Result type pattern (no exceptions)
from capnweb import Result, Ok, Err

result: Result[UserProfile, ApiError] = await users.get_user_safe(123)
match result:
    case Ok(user):
        print(user.name)
    case Err(error):
        print(error.message)
```

### Exposing Local Objects as RPC Targets

```python
from capnweb import Target, expose, on_dispose

@dataclass
class Subscription(Target):
    """A subscription that receives events."""

    topic: str
    callback: callable

    @expose
    async def on_event(self, event: dict):
        """Called when an event occurs."""
        await self.callback(event)

    @expose
    async def on_error(self, error: str):
        """Called on error."""
        print(f"Subscription error: {error}")

    @on_dispose
    async def cleanup(self):
        """Called when subscription is released."""
        print(f"Subscription to {self.topic} ended")


# Register with server
async with connect("wss://api.example.com") as client:
    events = client.service(EventService)

    sub = Subscription(
        topic="user.created",
        callback=lambda e: print(f"New user: {e}")
    )

    await events.subscribe(sub)

    # Server can now call sub.on_event() and sub.on_error()
```

### Type Hints Support

```python
from typing import Protocol, TypeVar, Generic
from capnweb import Stub, ServiceProxy

T = TypeVar("T")

# Full protocol support
class IUserService(Protocol):
    async def get_user(self, id: int) -> UserProfile: ...
    async def list_users(self) -> list[UserProfile]: ...

class IAuthService(Protocol):
    async def authenticate(self, token: str) -> AuthResult: ...
    async def refresh(self) -> AuthResult: ...

# Generic service proxy
class TypedClient(Generic[T]):
    def service(self, protocol: type[T]) -> T: ...

# Usage
async with connect("wss://api.example.com") as client:
    users: IUserService = client.service(IUserService)
    auth: IAuthService = client.service(IAuthService)

    # Full IDE support
    user = await users.get_user(123)
    result = await auth.authenticate(token)
```

---

## Approach 4: The Fluent Builder Pattern

**Inspiration**: SQLAlchemy Query API, Elasticsearch DSL, requests-futures

This approach creates a fluent, chainable API that reads like English and allows sophisticated query/call building.

### Connection / Session Creation

```python
from capnweb import CapnWeb

# Fluent connection builder
client = (
    CapnWeb()
    .url("wss://api.example.com")
    .timeout(seconds=30)
    .retry(times=3, backoff="exponential")
    .on_disconnect(lambda: print("Lost connection"))
    .build()
)

await client.connect()

# Shorthand
client = await CapnWeb.connect("wss://api.example.com")

# HTTP batch mode
client = await CapnWeb.batch("https://api.example.com")

# With auth
client = await (
    CapnWeb()
    .url("wss://api.example.com")
    .bearer_token("xxx")
    .connect()
)
```

### Making RPC Calls

```python
client = await CapnWeb.connect("wss://api.example.com")

# Simple call
result = await client.call("greet", "World")

# Fluent call builder
user = await (
    client
    .stub("users")
    .method("get")
    .args(123)
    .timeout(5.0)
    .execute()
)

# Property chain with builder
name = await (
    client
    .stub("users")
    .get(123)
    .property("profile")
    .property("name")
    .execute()
)

# Magic method style (simpler for common cases)
name = await client.api.users.get(123).profile.name
```

### Pipelining Syntax

```python
from capnweb import Pipeline

# Build a pipeline
result = await (
    Pipeline(client)
    .step("auth", lambda api: api.authenticate(token))
    .step("user_id", lambda api, auth: auth.user_id)
    .step("profile", lambda api, user_id: api.profiles.get(user_id))
    .step("notifications", lambda api, auth: auth.notifications.all())
    .select("profile", "notifications")  # What to return
    .execute()
)

profile = result.profile
notifications = result.notifications

# Simpler syntax with refs
result = await (
    Pipeline(client)
    .do(api.authenticate(token)).as_ref("auth")
    .do(api.profiles.get, ref("auth").user_id).as_ref("profile")
    .do(ref("auth").notifications.all()).as_ref("notifs")
    .returning("profile", "notifs")
)

# One-liner for simple pipelines
profile = await (
    client.pipeline()
    .then(lambda api: api.authenticate(token))
    .then(lambda auth: auth.get_profile())
    .value()
)
```

### The `map()` Operation

```python
# Fluent map
names = await (
    client.api.users.list()
    .map(lambda u: u.name)
    .execute()
)

# With filtering
active_emails = await (
    client.api.users.list()
    .filter(lambda u: u.is_active)
    .map(lambda u: u.email)
    .execute()
)

# Complex transformation
enriched = await (
    client.api.user_ids()
    .map()
        .field("id", lambda x: x)
        .field("profile", lambda id: client.api.profiles.get(id))
        .field("avatar", lambda id: client.api.avatars.get(id))
    .build()
    .execute()
)

# Aggregate operations
stats = await (
    client.api.users.list()
    .map(lambda u: u.age)
    .reduce(lambda ages: {
        "min": min(ages),
        "max": max(ages),
        "avg": sum(ages) / len(ages)
    })
    .execute()
)
```

### Error Handling

```python
from capnweb import CapnWebError

# Fluent error handling
result = await (
    client.api.risky_operation()
    .on_error(ValueError, lambda e: default_value)
    .on_error(ConnectionError, lambda e: retry())
    .on_timeout(lambda: cached_value)
    .execute()
)

# With explicit try/catch
try:
    result = await (
        client
        .with_timeout(5.0)
        .api.slow_operation()
    )
except CapnWebError as e:
    print(f"Failed: {e}")
    result = e.recovery_value

# Circuit breaker pattern
client_with_breaker = (
    client
    .with_circuit_breaker(
        failure_threshold=5,
        recovery_timeout=30
    )
)

result = await client_with_breaker.api.flaky_operation()
```

### Exposing Local Objects as RPC Targets

```python
from capnweb import Target

# Builder pattern for targets
handler = (
    Target.builder()
    .method("on_message", lambda msg: print(f"Got: {msg}"))
    .method("on_error", lambda err: print(f"Error: {err}"))
    .property("status", lambda: "running")
    .on_dispose(lambda: print("Disposed"))
    .build()
)

await client.api.subscribe(handler)

# Class-based with decorators
class MyHandler(Target):
    @Target.method
    async def handle(self, data: dict):
        return process(data)

    @Target.property
    def status(self) -> str:
        return "active"

# Or use simple functions as targets
@client.expose
async def my_callback(event):
    print(f"Event: {event}")

await client.api.on_event(my_callback)
```

### Type Hints Support

```python
from capnweb import TypedClient
from typing import TypedDict

class UserProfile(TypedDict):
    id: int
    name: str
    email: str

class ApiSchema:
    """Type hints for IDE support."""

    class users:
        @staticmethod
        async def get(id: int) -> UserProfile: ...

        @staticmethod
        async def list() -> list[UserProfile]: ...

        @staticmethod
        async def create(
            name: str,
            email: str
        ) -> UserProfile: ...

# Typed client
client: TypedClient[ApiSchema] = await CapnWeb.connect("wss://api.example.com")

# Full autocomplete
user = await client.api.users.get(123)  # Returns UserProfile
users = await client.api.users.list()   # Returns list[UserProfile]
```

---

## Comparison Matrix

| Feature | Approach 1 (Context Manager) | Approach 2 (Descriptor) | Approach 3 (Dataclass) | Approach 4 (Fluent) |
|---------|------------------------------|-------------------------|------------------------|---------------------|
| **Learning Curve** | Low | Medium | Medium | Medium |
| **IDE Support** | Excellent | Good | Excellent | Good |
| **Type Safety** | Strong | Medium | Very Strong | Medium |
| **Verbosity** | Low | Very Low | Medium | Variable |
| **Flexibility** | High | High | Medium | Very High |
| **Familiar To** | aiohttp/httpx users | Django/SQLAlchemy users | FastAPI/Pydantic users | Query builder users |
| **Pipelining** | Natural | Explicit | Explicit | Builder-based |
| **Error Handling** | Pythonic exceptions | Pythonic exceptions | Result types option | Fluent chains |
| **Magic Methods** | Heavy use | Heavy use | Minimal | Moderate |

---

## Recommendations

### Primary Recommendation: Hybrid of Approaches 1 and 3

The most Pythonic and developer-friendly API would combine:

1. **Connection handling from Approach 1** - Context managers are idiomatic Python
2. **Type definitions from Approach 3** - Dataclasses/Protocols provide excellent IDE support
3. **Simple syntax from Approach 1** - `await api.users.get(123)` just works

```python
from dataclasses import dataclass
from capnweb import connect, RpcTarget
from typing import Protocol

# Schema definition (optional but recommended)
@dataclass
class User:
    id: int
    name: str
    email: str

class UserApi(Protocol):
    async def get(self, id: int) -> User: ...
    async def create(self, name: str, email: str) -> User: ...

# Usage - clean and typed
async with connect[UserApi]("wss://api.example.com") as api:
    # Simple calls
    user = await api.users.get(123)

    # Pipelining (natural, no special syntax)
    async with api.batch() as batch:
        auth = batch.authenticate(token)
        profile = batch.get_profile(auth.user_id)
        result = await profile

    # Expose local targets
    class MyHandler(RpcTarget):
        async def on_event(self, data: dict):
            print(data)

    await api.subscribe(MyHandler())
```

### Key Design Principles

1. **Pipelining should be invisible** - Just don't `await` and it pipelines
2. **Type hints should be optional but powerful** - Works untyped, shines with types
3. **Errors should be exceptions** - This is Python, not Rust
4. **Magic methods enable elegance** - `__getattr__`, `__await__`, `__aenter__`
5. **Context managers manage lifecycle** - No manual cleanup needed

### Features That Would Make Python Developers Say "Wow"

```python
# 1. Seamless async/sync bridge
user = api.users.get(123)  # Returns RpcPromise
user = await api.users.get(123)  # Returns User

# 2. Property pipelining
name = await api.users.get(123).profile.name  # Single request

# 3. Magic map that feels like list comprehension
names = await [u.name async for u in api.users.list()]

# 4. Context-aware batching
async with api.batch():
    # Everything here is batched automatically
    a = api.foo()
    b = api.bar()
    c = api.baz(a.result)  # Uses a's result without await
# All results available after block

# 5. Typed without boilerplate
reveal_type(await api.users.get(123))  # Inferred as User

# 6. Python-native disposal
async with api.users.get(123) as user:
    # Use user
# Automatically released
```

---

## Implementation Notes

### Core Classes

```python
class RpcPromise(Generic[T]):
    """Awaitable that also supports attribute access for pipelining."""

    def __await__(self) -> Generator[Any, None, T]: ...
    def __getattr__(self, name: str) -> "RpcPromise[Any]": ...
    def __call__(self, *args, **kwargs) -> "RpcPromise[Any]": ...
    def map(self, func: Callable[[T], R]) -> "RpcPromise[R]": ...

class RpcStub(Generic[T]):
    """Proxy object for remote interface."""

    def __getattr__(self, name: str) -> "RpcPromise[Any]": ...
    def __call__(self, *args, **kwargs) -> "RpcPromise[Any]": ...

class RpcSession:
    """Manages connection and import/export tables."""

    async def __aenter__(self) -> RpcStub: ...
    async def __aexit__(self, *exc) -> None: ...
```

### Transport Abstraction

```python
from abc import ABC, abstractmethod

class Transport(ABC):
    @abstractmethod
    async def send(self, message: str) -> None: ...

    @abstractmethod
    async def receive(self) -> str: ...

    @abstractmethod
    async def close(self) -> None: ...

class WebSocketTransport(Transport): ...
class HttpBatchTransport(Transport): ...
class MessagePortTransport(Transport): ...
```

---

*This document is a living exploration. As implementation proceeds, specific syntax choices may evolve based on practical experience and user feedback.*
