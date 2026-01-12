# rpc-do

**The managed RPC proxy for .do services.**

```python
from rpc_do import rpc

# Magic proxy: attribute access routes to *.do domains
users = await rpc.mongo.find({"active": True})     # -> mongo.do
payment = await rpc.stripe.charges.create(...)     # -> stripe.do
result = await rpc.openai.chat.completions(...)    # -> openai.do
```

One import. Any service. Zero configuration.

---

## What is rpc.do?

`rpc-do` is a managed RPC proxy layer built on top of [capnweb](https://pypi.org/project/capnweb/). While capnweb provides the low-level capability-based RPC protocol, rpc.do adds:

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| Manual connection setup | `capnweb.connect("wss://...")` | Automatic |
| Service discovery | You provide URLs | Magic `rpc.{service}` routing |
| Authentication | Manual headers | Managed via `RPC_DO_TOKEN` |
| Connection pooling | DIY | Built-in |
| Retries & circuit breakers | DIY | Configurable defaults |
| Multi-service orchestration | Manual | Single `rpc` proxy |

**rpc.do turns this:**

```python
import capnweb

async with capnweb.connect("wss://mongo.do/rpc", headers={"Authorization": f"Bearer {token}"}) as mongo:
    async with capnweb.connect("wss://redis.do/rpc", headers={"Authorization": f"Bearer {token}"}) as redis:
        user = await mongo.users.findOne({"_id": user_id})
        await redis.set(f"user:{user_id}", user)
```

**Into this:**

```python
from rpc_do import rpc

user = await rpc.mongo.users.findOne({"_id": user_id})
await rpc.redis.set(f"user:{user_id}", user)
```

---

## Installation

```bash
pip install rpc-do
```

Requires Python 3.11+.

### Optional Dependencies

```bash
# For msgpack serialization (faster than JSON)
pip install rpc-do[msgpack]

# For development/testing
pip install rpc-do[dev]

# Everything
pip install rpc-do[all]
```

---

## Quick Start

### The Magic Proxy

The `rpc` object is a magic proxy. Every attribute access creates a route to a `.do` domain:

```python
from rpc_do import rpc

async def main():
    # rpc.mongo -> mongo.do
    # rpc.stripe -> stripe.do
    # rpc.github -> github.do

    # Find users in MongoDB
    users = await rpc.mongo.users.find({"status": "active"})

    # Create a Stripe charge
    charge = await rpc.stripe.charges.create(
        amount=2000,
        currency="usd",
        source="tok_visa",
    )

    # Call any .do service
    result = await rpc.myservice.doSomething(arg1="value")
```

### How Does It Work?

When you access `rpc.mongo`, the proxy:

1. Resolves `mongo` to `mongo.do`
2. Establishes a WebSocket connection to `wss://mongo.do/rpc`
3. Authenticates using your `RPC_DO_TOKEN` environment variable
4. Returns a capability stub for making RPC calls
5. Pools and reuses the connection for subsequent calls

```python
# These all route automatically:
rpc.mongo          # -> wss://mongo.do/rpc
rpc.database       # -> wss://database.do/rpc
rpc.agents         # -> wss://agents.do/rpc
rpc.workflows      # -> wss://workflows.do/rpc
rpc.functions      # -> wss://functions.do/rpc
```

### Authentication

Set your API token as an environment variable:

```bash
export RPC_DO_TOKEN="your-api-token"
```

Or configure programmatically:

```python
from rpc_do import configure

configure(token="your-api-token")
```

---

## Pipelining

The killer feature inherited from capnweb. Chain method calls without awaiting intermediate results.

### The Problem

```python
# Traditional approach: THREE round trips
auth = await rpc.auth.authenticate(token)           # Wait for network...
user = await rpc.users.get(auth["user_id"])         # Wait for network...
profile = await rpc.profiles.get(user["profile_id"]) # Wait for network...
```

### The Solution

```python
# With pipelining: ONE round trip
profile = await rpc.auth.authenticate(token).user.profile
```

### How Pipelining Works

Every attribute access and method call returns an `RpcPromise` - a lazy proxy that records operations without executing them. When you finally `await`, rpc.do sends the entire chain as a single request:

```python
# Build the pipeline - nothing sent yet
auth = rpc.auth.authenticate(token)      # RpcPromise
user = auth.user                         # RpcPromise (pipelines through auth)
profile = user.profile                   # RpcPromise (pipelines through user)

# NOW we send everything - one round trip
result = await profile
```

The server receives the complete expression graph and resolves dependencies internally.

### Parallel Pipelines

Fork a pipeline to fetch multiple things at once:

```python
from rpc_do import rpc
import asyncio

async def fetch_dashboard_data(token: str):
    # Start from authentication - not sent yet
    session = rpc.auth.authenticate(token)

    # Branch from the same session
    user_promise = session.user
    permissions_promise = session.permissions
    settings_promise = session.settings
    notifications_promise = session.notifications.unread()

    # Single round trip resolves all branches
    user, permissions, settings, notifications = await asyncio.gather(
        user_promise,
        permissions_promise,
        settings_promise,
        notifications_promise,
    )

    return {
        "user": user,
        "permissions": permissions,
        "settings": settings,
        "notifications": notifications,
    }
```

### Cross-Service Pipelining

Pipeline across different `.do` services:

```python
async def enrich_user_data(user_id: str):
    # Get user from database
    user = rpc.database.users.get(user_id)

    # Pipeline to other services using the user data
    avatar = rpc.storage.avatars.get(user.avatar_id)
    activity = rpc.analytics.users.activity(user.id)
    subscription = rpc.billing.subscriptions.get(user.subscription_id)

    # All resolve together
    return await asyncio.gather(user, avatar, activity, subscription)
```

---

## Type Hints

rpc.do works without types, but add them for IDE autocomplete and static analysis.

### Defining Service Protocols

```python
from typing import Protocol
from dataclasses import dataclass
from rpc_do import RpcPromise

@dataclass
class User:
    id: str
    name: str
    email: str
    avatar_id: str | None

@dataclass
class Profile:
    display_name: str
    bio: str
    avatar_url: str | None

class UsersCollection(Protocol):
    def find(self, query: dict) -> RpcPromise[list[User]]: ...
    def findOne(self, query: dict) -> RpcPromise[User | None]: ...
    def insertOne(self, doc: dict) -> RpcPromise[dict]: ...
    def updateOne(self, query: dict, update: dict) -> RpcPromise[dict]: ...
    def deleteOne(self, query: dict) -> RpcPromise[dict]: ...

class MongoService(Protocol):
    users: UsersCollection
    profiles: "ProfilesCollection"

    def collection(self, name: str) -> "Collection": ...

class ProfilesCollection(Protocol):
    def get(self, user_id: str) -> RpcPromise[Profile]: ...
    def update(self, user_id: str, data: dict) -> RpcPromise[Profile]: ...
```

### Using Typed Services

```python
from rpc_do import rpc

# Type assertion for IDE support
mongo: MongoService = rpc.mongo  # type: ignore

async def get_user_with_profile(user_id: str) -> tuple[User, Profile]:
    # IDE now knows the return types
    user = await mongo.users.findOne({"_id": user_id})
    if user is None:
        raise ValueError(f"User {user_id} not found")

    profile = await mongo.profiles.get(user.id)
    return user, profile
```

### Generic Type Parameters

```python
from typing import TypeVar, Generic
from rpc_do import RpcPromise

T = TypeVar("T")

class TypedCollection(Protocol, Generic[T]):
    def find(self, query: dict) -> RpcPromise[list[T]]: ...
    def findOne(self, query: dict) -> RpcPromise[T | None]: ...
    def insertOne(self, doc: T) -> RpcPromise[dict]: ...

# Usage
users: TypedCollection[User] = rpc.mongo.users  # type: ignore
user = await users.findOne({"email": "alice@example.com"})  # IDE knows: User | None
```

---

## Async Context Managers

### Basic Usage

```python
from rpc_do import RpcClient

async def main():
    async with RpcClient() as client:
        # Client handles connection lifecycle
        result = await client.mongo.users.find({})
    # Connection automatically closed
```

### Explicit Connection Management

For long-lived connections or more control:

```python
from rpc_do import RpcClient

client = RpcClient()
await client.connect()

try:
    # Use the client
    result = await client.mongo.users.find({})
finally:
    await client.close()
```

### Scoped Connections to Specific Services

```python
from rpc_do import connect

async def database_operations():
    async with connect("mongo.do") as mongo:
        # Dedicated connection to mongo.do
        users = await mongo.users.find({"active": True})

        # Transaction-like scope
        session = await mongo.startSession()
        try:
            await mongo.users.updateOne(
                {"_id": "123"},
                {"$set": {"processed": True}},
                session=session,
            )
            await mongo.logs.insertOne(
                {"action": "processed", "user_id": "123"},
                session=session,
            )
            await session.commit()
        except Exception:
            await session.abort()
            raise
```

### Connection Options

```python
from rpc_do import RpcClient, configure

# Global configuration
configure(
    token="your-api-token",
    timeout=30.0,
    retry_attempts=3,
    retry_delay=1.0,
)

# Per-client configuration
async with RpcClient(
    token="override-token",
    timeout=60.0,
    headers={"X-Custom-Header": "value"},
) as client:
    result = await client.mongo.users.find({})
```

---

## Streaming

Subscribe to real-time data with async iterators.

### Basic Streaming

```python
from rpc_do import rpc

async def watch_for_changes():
    # Stream change events from MongoDB
    async for change in rpc.mongo.users.watch():
        print(f"Change detected: {change['operationType']}")

        if change["operationType"] == "insert":
            new_user = change["fullDocument"]
            print(f"New user: {new_user['name']}")

        # Break to stop the stream
        if should_stop():
            break
```

### Streaming with Filters

```python
async def watch_specific_changes():
    # Watch for specific operations
    pipeline = [
        {"$match": {"operationType": {"$in": ["insert", "update"]}}},
        {"$match": {"fullDocument.status": "active"}},
    ]

    async for change in rpc.mongo.users.watch(pipeline=pipeline):
        yield change["fullDocument"]
```

### Bidirectional Streaming

For bidirectional streaming, implement a Target class:

```python
from rpc_do import Target

class OrderProcessor(Target):
    """Receives real-time order updates from the server."""

    def __init__(self):
        self.orders_processed = 0

    async def on_order(self, order: dict) -> dict:
        """Called by the server when a new order arrives."""
        print(f"Processing order: {order['id']}")

        # Process the order
        result = await self._process(order)
        self.orders_processed += 1

        # Return response to server
        return {"status": "processed", "order_id": order["id"]}

    async def on_batch(self, orders: list[dict]) -> list[dict]:
        """Handle batch of orders."""
        return [await self.on_order(order) for order in orders]

    async def _process(self, order: dict) -> dict:
        # Your processing logic
        return {"processed": True}

    def __dispose__(self):
        """Called when the server releases all references."""
        print(f"Processor disposed. Processed {self.orders_processed} orders.")

# Register the processor
async def main():
    processor = OrderProcessor()

    # Pass the processor to the server
    subscription = await rpc.orders.subscribe(processor, region="us-west")

    # Server can now call processor.on_order(), etc.
    # Keep alive while processing
    await asyncio.sleep(3600)

    # Cleanup
    await subscription.cancel()
```

### Async Generator Patterns

Create async generators that handle pagination:

```python
from rpc_do import rpc
from typing import AsyncGenerator, Any

async def paginate(
    service: str,
    collection: str,
    query: dict,
    page_size: int = 100,
) -> AsyncGenerator[dict, None]:
    """Async generator that handles cursor-based pagination."""
    cursor = None

    while True:
        # Get next page
        page = await getattr(rpc, service)[collection].find(
            query,
            limit=page_size,
            cursor=cursor,
        )

        for doc in page["documents"]:
            yield doc

        if not page.get("has_more"):
            break

        cursor = page["next_cursor"]

# Usage
async def process_all_users():
    async for user in paginate("mongo", "users", {"status": "active"}):
        print(f"Processing: {user['name']}")
```

### Server-Sent Events Pattern

```python
async def subscribe_to_events(event_types: list[str]):
    """Subscribe to multiple event streams."""
    from rpc_do import rpc

    # Create event source
    events = rpc.events.subscribe(types=event_types)

    async for event in events:
        match event["type"]:
            case "user.created":
                await handle_user_created(event["data"])
            case "order.completed":
                await handle_order_completed(event["data"])
            case "system.alert":
                await handle_system_alert(event["data"])
            case _:
                print(f"Unknown event type: {event['type']}")
```

---

## Map Operations

Transform collections server-side with `.map()`:

```python
from rpc_do import rpc

async def transform_data():
    # Extract emails from all users - server does the mapping
    emails = await rpc.mongo.users.find({}).map(lambda u: u["email"])

    # Transform with RPC calls
    users = await rpc.mongo.users.find({"status": "active"})
    enriched = await rpc.mongo.users.find({}).map(
        lambda u: {
            "id": u["_id"],
            "name": u["name"],
            "profile": rpc.profiles.get(u["_id"]),
            "avatar": rpc.storage.avatars.get(u["avatar_id"]),
        }
    )
```

### How `.map()` Works

The lambda is serialized and sent to the server. The server executes the mapping operation and returns results:

```python
# This lambda
lambda u: u["email"]

# Becomes this expression sent to server
"u => u.email"
```

### Lambda Capture

Captured variables are included in the serialization:

```python
threshold = 100

# Captured variable 'threshold' is sent to server
filtered = await rpc.mongo.orders.find({}).map(
    lambda o: o if o["amount"] > threshold else None
)
```

### Lambda Constraints

**WARNING:** Lambda serialization has constraints:

1. **Only simple lambdas** - Single-expression lambdas that access the parameter and captured references
2. **No arbitrary code** - You cannot call arbitrary Python functions inside the lambda
3. **Captured values must be serializable** - Numbers, strings, API stubs are fine; database connections are not
4. **No side effects** - The lambda should be pure; side effects may execute multiple times or not at all

```python
# GOOD: Simple property access
emails = await rpc.mongo.users.find({}).map(lambda u: u["email"])

# GOOD: Simple transformation
names = await rpc.mongo.users.find({}).map(
    lambda u: f"{u['first_name']} {u['last_name']}"
)

# GOOD: Captured service references
storage = rpc.storage
enriched = await rpc.mongo.users.find({}).map(
    lambda u: {"user": u, "avatar": storage.avatars.get(u["avatar_id"])}
)

# BAD: Arbitrary function calls
def custom_transform(u):
    return database.lookup(u["id"])  # Won't work!

# BAD: Complex control flow
await rpc.users.find({}).map(
    lambda u: u["name"] if u["active"] else "inactive"  # May not work
)
```

For complex transformations, fetch and transform locally:

```python
users = await rpc.mongo.users.find({})
transformed = [custom_transform(u) for u in users]
```

### Chained Maps

```python
result = await (
    rpc.mongo.orders.find({"status": "pending"})
    .map(lambda o: o["items"])      # Extract items
    .map(lambda items: len(items))  # Count items
)
```

---

## Error Handling

rpc.do uses Python exceptions with full remote error information.

### Basic Error Handling

```python
from rpc_do import rpc, RpcError, ConnectionError, TimeoutError

async def safe_operation():
    try:
        result = await rpc.mongo.users.findOne({"_id": "nonexistent"})
    except RpcError as e:
        print(f"Server error: {e.message}")
        print(f"Error code: {e.code}")
        if e.data:
            print(f"Additional data: {e.data}")
    except ConnectionError as e:
        print(f"Connection lost: {e}")
    except TimeoutError:
        print("Request timed out")
```

### Pattern Matching on Error Types

```python
from rpc_do import RpcError

async def handle_user_operation(user_id: str):
    try:
        user = await rpc.mongo.users.findOne({"_id": user_id})
        return user
    except RpcError as e:
        match e.code:
            case "NotFoundError":
                return None
            case "PermissionDeniedError":
                raise PermissionError(f"Access denied to user {user_id}") from e
            case "ValidationError":
                raise ValueError(e.message) from e
            case "RateLimitError":
                # Retry after delay
                await asyncio.sleep(float(e.data.get("retry_after", 60)))
                return await handle_user_operation(user_id)
            case _:
                raise
```

### Custom Exception Mapping

```python
from rpc_do import RpcError
from dataclasses import dataclass

@dataclass
class UserNotFoundError(Exception):
    user_id: str

@dataclass
class ValidationError(Exception):
    field: str
    message: str

def map_rpc_error(e: RpcError) -> Exception:
    """Map RPC errors to domain exceptions."""
    match e.code:
        case "UserNotFound":
            return UserNotFoundError(user_id=e.data.get("user_id", "unknown"))
        case "ValidationError":
            return ValidationError(
                field=e.data.get("field", "unknown"),
                message=e.message,
            )
        case _:
            return e

async def get_user(user_id: str):
    try:
        return await rpc.users.get(user_id)
    except RpcError as e:
        raise map_rpc_error(e) from e
```

### Retry with Exponential Backoff

```python
import asyncio
import random
from rpc_do import RpcError, ConnectionError

async def with_retry(
    coro_fn,
    *,
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    jitter: bool = True,
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
            if jitter:
                delay += random.uniform(0, delay * 0.1)
            await asyncio.sleep(delay)

        except RpcError as e:
            # Don't retry client errors
            if e.code in ("ValidationError", "NotFoundError", "PermissionDeniedError"):
                raise

            last_error = e
            if attempt == max_attempts - 1:
                raise

            delay = min(base_delay * (2 ** attempt), max_delay)
            await asyncio.sleep(delay)

    raise last_error

# Usage
user = await with_retry(lambda: rpc.users.get("123"))
```

### Circuit Breaker Pattern

```python
import time
from enum import Enum
from rpc_do import ConnectionError, RpcError

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    """Circuit breaker for RPC calls."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max_calls: int = 3,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

        self.failures = 0
        self.last_failure_time = 0.0
        self.state = CircuitState.CLOSED
        self.half_open_calls = 0

    async def call(self, coro_fn):
        """Execute a call through the circuit breaker."""
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
            else:
                raise ConnectionError("Circuit breaker is open")

        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_calls >= self.half_open_max_calls:
                raise ConnectionError("Circuit breaker half-open limit reached")
            self.half_open_calls += 1

        try:
            result = await coro_fn()
            self._on_success()
            return result
        except (ConnectionError, RpcError) as e:
            self._on_failure()
            raise

    def _on_success(self):
        self.failures = 0
        if self.state == CircuitState.HALF_OPEN:
            self.state = CircuitState.CLOSED

    def _on_failure(self):
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN

# Usage
mongo_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=30.0)

async def get_user_safe(user_id: str):
    try:
        return await mongo_breaker.call(
            lambda: rpc.mongo.users.findOne({"_id": user_id})
        )
    except ConnectionError as e:
        if "Circuit breaker" in str(e):
            # Fall back to cache
            return get_cached_user(user_id)
        raise
```

### Bulkhead Pattern

```python
import asyncio
from contextlib import asynccontextmanager

class Bulkhead:
    """Limit concurrent calls to a service."""

    def __init__(self, max_concurrent: int = 10):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.max_concurrent = max_concurrent

    @asynccontextmanager
    async def acquire(self):
        async with self.semaphore:
            yield

    async def call(self, coro_fn):
        async with self.acquire():
            return await coro_fn()

# Service-specific bulkheads
bulkheads = {
    "mongo": Bulkhead(max_concurrent=20),
    "stripe": Bulkhead(max_concurrent=5),
    "openai": Bulkhead(max_concurrent=3),
}

async def protected_call(service: str, coro_fn):
    """Call with bulkhead protection."""
    bulkhead = bulkheads.get(service, Bulkhead())
    return await bulkhead.call(coro_fn)
```

---

## Workflow Orchestration

Build complex workflows with task dependencies.

### Sequential Tasks

```python
from rpc_do import rpc

async def onboard_user(user_data: dict) -> dict:
    """Multi-step workflow with explicit dependencies."""

    # Step 1: Create user
    user = await rpc.users.create(**user_data)

    # Step 2: Create profile (depends on user)
    profile = await rpc.profiles.create(
        user_id=user["id"],
        display_name=user_data["name"],
    )

    # Step 3: Setup workspace (depends on user)
    workspace = await rpc.workspaces.create(
        owner_id=user["id"],
        name=f"{user_data['name']}'s Workspace",
    )

    # Step 4: Send welcome email (depends on user)
    await rpc.notifications.send_welcome(
        user_id=user["id"],
        email=user_data["email"],
    )

    return {
        "user": user,
        "profile": profile,
        "workspace": workspace,
    }
```

### Parallel with Dependencies (DAG)

```python
import asyncio
from rpc_do import rpc

async def provision_infrastructure(project_id: str) -> dict:
    """
    Workflow DAG:

        create_project
             |
        +----+----+----+
        |         |    |
    setup_db  storage  cdn
        |         |    |
        +----+----+----+
             |
        configure_dns
             |
        deploy_app
    """

    # Step 1: Create project
    project = await rpc.platform.projects.create(project_id)

    # Step 2: Parallel infrastructure setup
    db_task = rpc.database.provision(
        project_id=project["id"],
        type="postgres",
        size="small",
    )
    storage_task = rpc.storage.provision(
        project_id=project["id"],
        type="s3",
        region="us-east-1",
    )
    cdn_task = rpc.cdn.provision(
        project_id=project["id"],
        origins=["api", "static"],
    )

    db, storage, cdn = await asyncio.gather(db_task, storage_task, cdn_task)

    # Step 3: Configure DNS (depends on all infrastructure)
    dns = await rpc.dns.configure(
        project_id=project["id"],
        database_host=db["host"],
        storage_endpoint=storage["endpoint"],
        cdn_domain=cdn["domain"],
    )

    # Step 4: Deploy application (depends on DNS)
    app = await rpc.apps.deploy(
        project_id=project["id"],
        environment={
            "DATABASE_URL": db["connection_string"],
            "STORAGE_BUCKET": storage["bucket"],
            "CDN_URL": cdn["url"],
        },
    )

    return {
        "project": project,
        "database": db,
        "storage": storage,
        "cdn": cdn,
        "dns": dns,
        "app": app,
    }
```

### Saga Pattern with Compensation

```python
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any

@dataclass
class SagaStep:
    """A step in a saga with action and compensation."""
    name: str
    action: Callable[[], Awaitable[Any]]
    compensate: Callable[[], Awaitable[None]]
    result: Any = None

@dataclass
class Saga:
    """Execute steps with automatic rollback on failure."""
    steps: list[SagaStep] = field(default_factory=list)
    completed: list[SagaStep] = field(default_factory=list)

    def add_step(
        self,
        name: str,
        action: Callable[[], Awaitable[Any]],
        compensate: Callable[[], Awaitable[None]],
    ) -> "Saga":
        self.steps.append(SagaStep(name, action, compensate))
        return self

    async def execute(self) -> dict[str, Any]:
        """Execute all steps; rollback on failure."""
        results = {}

        try:
            for step in self.steps:
                print(f"Executing: {step.name}")
                step.result = await step.action()
                results[step.name] = step.result
                self.completed.append(step)

            return results

        except Exception as e:
            print(f"Saga failed at {step.name}: {e}")
            await self._rollback()
            raise

    async def _rollback(self):
        """Compensate completed steps in reverse order."""
        for step in reversed(self.completed):
            try:
                print(f"Compensating: {step.name}")
                await step.compensate()
            except Exception as comp_error:
                print(f"Compensation failed for {step.name}: {comp_error}")
                # Continue rollback despite errors

async def transfer_funds(
    from_account: str,
    to_account: str,
    amount: float,
) -> dict:
    """Bank transfer with saga-based rollback."""
    from rpc_do import rpc

    withdrawal_id = None
    deposit_id = None

    saga = Saga()

    saga.add_step(
        name="withdraw",
        action=lambda: withdraw_funds(),
        compensate=lambda: refund_withdrawal(),
    )

    saga.add_step(
        name="deposit",
        action=lambda: deposit_funds(),
        compensate=lambda: reverse_deposit(),
    )

    saga.add_step(
        name="notify",
        action=lambda: send_notifications(),
        compensate=lambda: asyncio.sleep(0),  # No compensation needed
    )

    async def withdraw_funds():
        nonlocal withdrawal_id
        result = await rpc.banking.accounts.withdraw(
            account_id=from_account,
            amount=amount,
        )
        withdrawal_id = result["transaction_id"]
        return result

    async def refund_withdrawal():
        if withdrawal_id:
            await rpc.banking.accounts.deposit(
                account_id=from_account,
                amount=amount,
                reason="saga_rollback",
                original_transaction=withdrawal_id,
            )

    async def deposit_funds():
        nonlocal deposit_id
        result = await rpc.banking.accounts.deposit(
            account_id=to_account,
            amount=amount,
        )
        deposit_id = result["transaction_id"]
        return result

    async def reverse_deposit():
        if deposit_id:
            await rpc.banking.accounts.withdraw(
                account_id=to_account,
                amount=amount,
                reason="saga_rollback",
                original_transaction=deposit_id,
            )

    async def send_notifications():
        await asyncio.gather(
            rpc.notifications.send(
                user_id=from_account,
                message=f"Sent ${amount} to {to_account}",
            ),
            rpc.notifications.send(
                user_id=to_account,
                message=f"Received ${amount} from {from_account}",
            ),
        )

    return await saga.execute()
```

### Workflow State Machine

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any

class OrderState(Enum):
    CREATED = "created"
    VALIDATED = "validated"
    PAYMENT_PENDING = "payment_pending"
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

@dataclass
class OrderWorkflow:
    """State machine for order processing."""
    order_id: str
    state: OrderState = OrderState.CREATED
    history: list[tuple[OrderState, str]] = field(default_factory=list)

    # Valid state transitions
    transitions: dict[OrderState, list[OrderState]] = field(default_factory=lambda: {
        OrderState.CREATED: [OrderState.VALIDATED, OrderState.CANCELLED],
        OrderState.VALIDATED: [OrderState.PAYMENT_PENDING, OrderState.CANCELLED],
        OrderState.PAYMENT_PENDING: [OrderState.PAID, OrderState.CANCELLED],
        OrderState.PAID: [OrderState.SHIPPED, OrderState.CANCELLED],
        OrderState.SHIPPED: [OrderState.DELIVERED],
        OrderState.DELIVERED: [],
        OrderState.CANCELLED: [],
    })

    async def transition(self, new_state: OrderState, reason: str = "") -> bool:
        """Attempt to transition to a new state."""
        if new_state not in self.transitions[self.state]:
            raise ValueError(
                f"Invalid transition: {self.state.value} -> {new_state.value}"
            )

        old_state = self.state
        self.state = new_state
        self.history.append((new_state, reason))

        # Persist state change
        from rpc_do import rpc
        await rpc.orders.updateState(
            order_id=self.order_id,
            state=new_state.value,
            reason=reason,
        )

        return True

    async def validate(self) -> bool:
        """Validate order and transition state."""
        from rpc_do import rpc

        # Check inventory
        order = await rpc.orders.get(self.order_id)
        for item in order["items"]:
            stock = await rpc.inventory.check(item["sku"])
            if stock["available"] < item["quantity"]:
                await self.transition(OrderState.CANCELLED, f"Insufficient stock: {item['sku']}")
                return False

        await self.transition(OrderState.VALIDATED, "All items in stock")
        return True

    async def process_payment(self, payment_method: str) -> bool:
        """Process payment."""
        from rpc_do import rpc

        await self.transition(OrderState.PAYMENT_PENDING, "Payment initiated")

        try:
            order = await rpc.orders.get(self.order_id)
            payment = await rpc.payments.charge(
                amount=order["total"],
                method=payment_method,
                order_id=self.order_id,
            )

            await self.transition(OrderState.PAID, f"Payment {payment['id']} successful")
            return True

        except Exception as e:
            await self.transition(OrderState.CANCELLED, f"Payment failed: {e}")
            return False
```

---

## Service Discovery

### Default Routing

By default, `rpc.{service}` routes to `{service}.do`:

```python
rpc.mongo     # -> wss://mongo.do/rpc
rpc.redis     # -> wss://redis.do/rpc
rpc.stripe    # -> wss://stripe.do/rpc
```

### Custom Service Registry

```python
from rpc_do import configure, ServiceRegistry

# Define custom service mappings
registry = ServiceRegistry()
registry.register("mongo", "wss://custom-mongo.example.com/rpc")
registry.register("internal-api", "wss://internal.example.com/rpc")

# Use environment-based routing
registry.register(
    "database",
    dev="wss://dev-db.example.com/rpc",
    staging="wss://staging-db.example.com/rpc",
    prod="wss://prod-db.example.com/rpc",
)

configure(registry=registry)

# Now routes to your custom endpoints
result = await rpc.mongo.users.find({})  # -> custom-mongo.example.com
```

### Environment-Based Configuration

```python
import os
from rpc_do import configure

environment = os.getenv("ENVIRONMENT", "dev")

configure(
    environment=environment,
    endpoints={
        "dev": {"suffix": ".dev.do"},
        "staging": {"suffix": ".staging.do"},
        "prod": {"suffix": ".do"},
    },
)

# In dev: rpc.mongo -> mongo.dev.do
# In staging: rpc.mongo -> mongo.staging.do
# In prod: rpc.mongo -> mongo.do
```

---

## Connection Pooling

### Automatic Pooling

rpc.do automatically pools connections by service:

```python
# These reuse the same connection to mongo.do
await rpc.mongo.users.find({})
await rpc.mongo.orders.find({})
await rpc.mongo.products.find({})

# This uses a different connection (redis.do)
await rpc.redis.get("key")
```

### Pool Configuration

```python
from rpc_do import configure

configure(
    pool_size=10,           # Max connections per service
    pool_timeout=30.0,      # Timeout waiting for connection
    idle_timeout=300.0,     # Close idle connections after 5 minutes
    health_check_interval=60.0,  # Health check every minute
)
```

### Manual Pool Management

```python
from rpc_do import ConnectionPool

# Create a dedicated pool for a service
pool = ConnectionPool(
    service="mongo.do",
    size=5,
    timeout=30.0,
)

async with pool.acquire() as conn:
    result = await conn.users.find({})

# Drain pool on shutdown
await pool.drain()
```

---

## Testing

### Mock Services

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from rpc_do import RpcPromise

def create_mock_service():
    """Create a mock service for testing."""
    service = MagicMock()

    # Mock a simple call
    service.users.findOne = AsyncMock(return_value={
        "_id": "123",
        "name": "Test User",
        "email": "test@example.com",
    })

    # Mock a list call
    service.users.find = AsyncMock(return_value=[
        {"_id": "1", "name": "User 1"},
        {"_id": "2", "name": "User 2"},
    ])

    return service

@pytest.fixture
def mock_mongo():
    return create_mock_service()

async def test_get_user(mock_mongo):
    # Use the mock
    user = await mock_mongo.users.findOne({"_id": "123"})

    assert user["name"] == "Test User"
    mock_mongo.users.findOne.assert_called_once_with({"_id": "123"})
```

### Patching the Global Proxy

```python
import pytest
from unittest.mock import patch, AsyncMock

@pytest.fixture
def mock_rpc():
    """Patch the global rpc proxy."""
    with patch("rpc_do.rpc") as mock:
        # Configure mock returns
        mock.mongo.users.findOne = AsyncMock(return_value={
            "_id": "123",
            "name": "Test User",
        })
        mock.mongo.users.find = AsyncMock(return_value=[])

        yield mock

async def test_user_service(mock_rpc):
    from myapp.services import get_user

    user = await get_user("123")

    assert user["name"] == "Test User"
    mock_rpc.mongo.users.findOne.assert_called_once()
```

### Local Test Server

```python
import pytest
from rpc_do import Target
from rpc_do.testing import LocalServer, TestClient

class MockUsersService(Target):
    """Mock implementation of the users service."""

    def __init__(self):
        self._users = {
            "123": {"_id": "123", "name": "Alice"},
            "456": {"_id": "456", "name": "Bob"},
        }

    def findOne(self, query: dict) -> dict | None:
        user_id = query.get("_id")
        return self._users.get(user_id)

    def find(self, query: dict) -> list[dict]:
        return list(self._users.values())

    def insertOne(self, doc: dict) -> dict:
        doc["_id"] = str(len(self._users) + 1)
        self._users[doc["_id"]] = doc
        return {"inserted_id": doc["_id"]}

@pytest.fixture
async def test_server():
    """Create a local test server."""
    server = LocalServer()
    server.register("users", MockUsersService())

    async with server:
        yield server

@pytest.fixture
async def client(test_server):
    """Create a test client connected to the local server."""
    async with TestClient(test_server) as client:
        yield client

async def test_find_user(client):
    user = await client.users.findOne({"_id": "123"})
    assert user["name"] == "Alice"

async def test_create_user(client):
    result = await client.users.insertOne({"name": "Charlie"})
    assert "inserted_id" in result
```

### Recording and Replay

```python
import os
from rpc_do import configure

# Record mode: capture all RPC calls
if os.getenv("RPC_RECORD"):
    configure(
        record=True,
        record_path="tests/fixtures/recordings",
    )

# Replay mode: use recorded responses
if os.getenv("RPC_REPLAY"):
    configure(
        replay=True,
        replay_path="tests/fixtures/recordings",
    )
```

### Integration Testing

```python
import pytest
from rpc_do import rpc, configure

@pytest.fixture(scope="session")
def integration_setup():
    """Setup for integration tests."""
    configure(
        token=os.getenv("TEST_RPC_TOKEN"),
        environment="test",
    )

@pytest.mark.integration
async def test_real_mongo_connection(integration_setup):
    """Test against real mongo.do service."""
    # Create test document
    result = await rpc.mongo.test_collection.insertOne({
        "test": True,
        "timestamp": time.time(),
    })

    assert "inserted_id" in result

    # Read it back
    doc = await rpc.mongo.test_collection.findOne({
        "_id": result["inserted_id"]
    })

    assert doc["test"] is True

    # Cleanup
    await rpc.mongo.test_collection.deleteOne({
        "_id": result["inserted_id"]
    })
```

---

## Observability

### Logging

```python
import logging
from rpc_do import configure

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger("rpc_do")
logger.setLevel(logging.DEBUG)

# Or configure programmatically
configure(
    log_level="DEBUG",
    log_format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
```

### Metrics

```python
from rpc_do import configure
from prometheus_client import Counter, Histogram

# Define metrics
rpc_calls = Counter(
    "rpc_calls_total",
    "Total RPC calls",
    ["service", "method", "status"],
)

rpc_latency = Histogram(
    "rpc_call_duration_seconds",
    "RPC call latency",
    ["service", "method"],
)

async def metrics_hook(call_info: dict):
    """Hook called after each RPC call."""
    rpc_calls.labels(
        service=call_info["service"],
        method=call_info["method"],
        status=call_info["status"],
    ).inc()

    rpc_latency.labels(
        service=call_info["service"],
        method=call_info["method"],
    ).observe(call_info["duration"])

configure(
    hooks={
        "after_call": metrics_hook,
    },
)
```

### Tracing

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind
from rpc_do import configure

tracer = trace.get_tracer(__name__)

async def tracing_hook(call_info: dict):
    """Create spans for RPC calls."""
    with tracer.start_as_current_span(
        f"rpc.{call_info['service']}.{call_info['method']}",
        kind=SpanKind.CLIENT,
    ) as span:
        span.set_attribute("rpc.service", call_info["service"])
        span.set_attribute("rpc.method", call_info["method"])
        span.set_attribute("rpc.system", "dotdo")

        if "error" in call_info:
            span.set_status(trace.Status(trace.StatusCode.ERROR))
            span.record_exception(call_info["error"])

configure(
    hooks={
        "around_call": tracing_hook,
    },
)
```

---

## Security

### Token Management

```python
from rpc_do import configure

# Use environment variable (recommended)
# export RPC_DO_TOKEN="your-token"
configure()  # Automatically reads RPC_DO_TOKEN

# Or pass explicitly
configure(token="your-token")

# Token rotation
async def rotate_token():
    new_token = await fetch_new_token()
    configure(token=new_token)
```

### Secure Connections

```python
import ssl
from rpc_do import configure

# Always use secure WebSockets (default)
configure(
    verify_ssl=True,  # Default
    ssl_context=ssl.create_default_context(),
)

# For development with self-signed certs (NOT for production!)
if os.getenv("ENVIRONMENT") == "development":
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    configure(ssl_context=ssl_ctx)
```

### Request Signing

```python
import hmac
import hashlib
import time
from rpc_do import configure

def sign_request(request: dict) -> str:
    """Sign a request for additional security."""
    secret = os.getenv("RPC_SIGNING_SECRET")
    timestamp = str(int(time.time()))

    payload = f"{timestamp}.{request['method']}.{request['args']}"
    signature = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()

    return f"{timestamp}.{signature}"

configure(
    hooks={
        "before_call": lambda req: req.update({"signature": sign_request(req)}),
    },
)
```

### Lambda Security

**WARNING:** Lambda serialization sends code representations to the server. Be aware:

1. **Server-controlled execution** - The server decides how to interpret the lambda
2. **Captured values are transmitted** - Any values captured in the lambda closure are serialized and sent
3. **Don't capture secrets** - Never capture API keys, passwords, or sensitive data in map lambdas

```python
# DANGEROUS: Don't do this!
secret_key = os.environ["SECRET_KEY"]
await rpc.data.map(lambda x: {"key": secret_key, "value": x})  # Leaks secret!

# SAFE: Let the server handle authentication
await rpc.authenticated_data.map(lambda x: x["value"])
```

---

## API Reference

### Module Functions

```python
def configure(**options) -> None:
    """
    Configure the global rpc proxy.

    Args:
        token: API token for authentication
        timeout: Default timeout for RPC calls (default: 30.0)
        retry_attempts: Number of retry attempts (default: 3)
        retry_delay: Base delay between retries (default: 1.0)
        pool_size: Max connections per service (default: 10)
        environment: Environment name for routing (default: "prod")
        registry: Custom ServiceRegistry instance
        hooks: Dict of hook functions
        log_level: Logging level (default: "INFO")
    """

async def connect(service: str, **options) -> AsyncContextManager[RpcClient]:
    """
    Connect to a specific .do service.

    Args:
        service: Service name (e.g., "mongo.do") or full URL
        **options: Connection options (same as configure)

    Returns:
        Context manager yielding an RpcClient
    """
```

### Classes

```python
class RpcClient:
    """
    RPC client for .do services.

    Supports both the magic proxy pattern and explicit method calls.
    """

    async def connect(self) -> None:
        """Establish connection to the service."""

    async def close(self) -> None:
        """Close the connection."""

    async def call(self, method: str, **kwargs) -> Any:
        """Make an explicit RPC call."""

    def __getattr__(self, name: str) -> RpcProxy:
        """Magic proxy access."""


class RpcPromise(Generic[T]):
    """
    Lazy RPC reference supporting pipelining.

    Attribute access and method calls return new RpcPromise instances,
    building a pipeline. The network request is sent when you await.
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
        """Map a function over a collection server-side."""


class Target:
    """
    Base class for objects exposed over RPC.

    Subclass Target to create objects that the remote side can call.
    Public methods are exposed; private methods (underscore prefix) are hidden.
    """

    def __dispose__(self) -> None:
        """Called when all remote references are released."""
```

### Exceptions

```python
class RpcError(Exception):
    """
    Error from the server.

    Attributes:
        message: Error message
        code: Error code (e.g., "NotFoundError", "ValidationError")
        data: Additional error data
    """
    message: str
    code: str | None
    data: dict[str, Any]


class ConnectionError(Exception):
    """
    Connection lost or failed to establish.
    """


class TimeoutError(Exception):
    """
    Request timed out.
    """
```

### The Global `rpc` Proxy

```python
from rpc_do import rpc

# The global proxy is always available
# Each attribute access routes to a .do service

rpc.mongo          # -> mongo.do
rpc.redis          # -> redis.do
rpc.stripe         # -> stripe.do
rpc.custom         # -> custom.do
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```python
#!/usr/bin/env python3
"""
Complete rpc.do example: An e-commerce order system demonstrating
pipelining, streaming, error handling, and workflow orchestration.
"""

import asyncio
import os
from dataclasses import dataclass
from typing import Protocol

from rpc_do import rpc, Target, RpcPromise, RpcError, configure


# ─── Configuration ───────────────────────────────────────────────────────────

configure(
    token=os.getenv("RPC_DO_TOKEN"),
    timeout=30.0,
    retry_attempts=3,
)


# ─── Type Definitions ────────────────────────────────────────────────────────

@dataclass
class Product:
    id: str
    name: str
    price: float
    stock: int


@dataclass
class Order:
    id: str
    user_id: str
    items: list[dict]
    total: float
    status: str


@dataclass
class User:
    id: str
    name: str
    email: str


class ProductsService(Protocol):
    def get(self, product_id: str) -> RpcPromise[Product]: ...
    def list(self, query: dict) -> RpcPromise[list[Product]]: ...
    def update_stock(self, product_id: str, delta: int) -> RpcPromise[Product]: ...


class OrdersService(Protocol):
    def create(self, user_id: str, items: list[dict]) -> RpcPromise[Order]: ...
    def get(self, order_id: str) -> RpcPromise[Order]: ...
    def update_status(self, order_id: str, status: str) -> RpcPromise[Order]: ...


# ─── Event Handler (Target for bidirectional RPC) ────────────────────────────

class OrderEventHandler(Target):
    """Receives real-time order updates from the server."""

    def __init__(self):
        self.orders_received: list[dict] = []

    async def on_order_created(self, order: dict) -> None:
        print(f"  [Event] Order created: {order['id']}")
        self.orders_received.append(order)

    async def on_order_shipped(self, order: dict) -> None:
        print(f"  [Event] Order shipped: {order['id']}")

    async def on_order_delivered(self, order: dict) -> None:
        print(f"  [Event] Order delivered: {order['id']}")

    def __dispose__(self) -> None:
        print(f"  [Event] Handler disposed. Received {len(self.orders_received)} orders.")


# ─── Business Logic ──────────────────────────────────────────────────────────

async def get_product_with_recommendations(product_id: str) -> dict:
    """
    Fetch a product with its recommendations using pipelining.
    Single round trip for all data.
    """
    # Build pipeline - nothing sent yet
    product = rpc.products.get(product_id)
    recommendations = rpc.recommendations.for_product(product_id)
    reviews = rpc.reviews.for_product(product_id).limit(5)

    # Single round trip resolves all
    p, r, rv = await asyncio.gather(product, recommendations, reviews)

    return {
        "product": p,
        "recommendations": r,
        "reviews": rv,
    }


async def create_order_workflow(user_id: str, items: list[dict]) -> dict:
    """
    Create an order with full workflow:
    1. Validate stock
    2. Create order
    3. Process payment
    4. Update inventory
    5. Send notifications
    """
    print(f"Creating order for user {user_id}...")

    # Step 1: Validate stock (parallel checks)
    stock_checks = [
        rpc.products.get(item["product_id"])
        for item in items
    ]
    products = await asyncio.gather(*stock_checks)

    for product, item in zip(products, items):
        if product["stock"] < item["quantity"]:
            raise ValueError(f"Insufficient stock for {product['name']}")

    print("  Stock validated")

    # Step 2: Calculate total
    total = sum(
        product["price"] * item["quantity"]
        for product, item in zip(products, items)
    )

    # Step 3: Create order
    order = await rpc.orders.create(
        user_id=user_id,
        items=items,
        total=total,
    )
    print(f"  Order created: {order['id']}")

    # Step 4: Process payment
    try:
        payment = await rpc.payments.charge(
            user_id=user_id,
            amount=total,
            order_id=order["id"],
        )
        print(f"  Payment processed: {payment['id']}")
    except RpcError as e:
        # Rollback order
        await rpc.orders.cancel(order["id"], reason="payment_failed")
        raise

    # Step 5: Update inventory (parallel)
    inventory_updates = [
        rpc.products.update_stock(item["product_id"], -item["quantity"])
        for item in items
    ]
    await asyncio.gather(*inventory_updates)
    print("  Inventory updated")

    # Step 6: Send notifications (fire and forget)
    asyncio.create_task(
        rpc.notifications.send_order_confirmation(
            user_id=user_id,
            order_id=order["id"],
        )
    )

    # Step 7: Update order status
    order = await rpc.orders.update_status(order["id"], "paid")
    print(f"  Order status: {order['status']}")

    return order


async def stream_order_updates(handler: OrderEventHandler) -> None:
    """Subscribe to real-time order updates."""
    print("Subscribing to order updates...")

    subscription = await rpc.orders.subscribe(handler)

    # Keep alive for demo
    await asyncio.sleep(60)

    await subscription.cancel()


async def search_products_with_transform(query: str) -> list[dict]:
    """
    Search products and transform results server-side.
    """
    # Search and transform in one round trip
    results = await rpc.products.search(query).map(
        lambda p: {
            "id": p["id"],
            "name": p["name"],
            "price": p["price"],
            "in_stock": p["stock"] > 0,
        }
    )

    return results


# ─── Error Handling Examples ─────────────────────────────────────────────────

async def safe_get_user(user_id: str) -> dict | None:
    """Get user with proper error handling."""
    try:
        return await rpc.users.get(user_id)
    except RpcError as e:
        match e.code:
            case "NotFoundError":
                return None
            case "PermissionDeniedError":
                raise PermissionError(f"Cannot access user {user_id}") from e
            case _:
                raise


async def get_with_retry(getter, max_attempts: int = 3) -> dict:
    """Get with exponential backoff retry."""
    import random

    for attempt in range(max_attempts):
        try:
            return await getter()
        except (ConnectionError, TimeoutError) as e:
            if attempt == max_attempts - 1:
                raise
            delay = (2 ** attempt) + random.uniform(0, 1)
            await asyncio.sleep(delay)


# ─── Main Application ────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("rpc.do E-Commerce Demo")
    print("=" * 60)

    # ─── Pipelining Demo ─────────────────────────────────────────────────────
    print("\n1. Pipelining Demo")
    print("-" * 40)

    try:
        result = await get_product_with_recommendations("prod-123")
        print(f"  Product: {result['product']['name']}")
        print(f"  Recommendations: {len(result['recommendations'])} items")
        print(f"  Reviews: {len(result['reviews'])} reviews")
    except RpcError as e:
        print(f"  Error: {e.message}")

    # ─── Order Workflow Demo ─────────────────────────────────────────────────
    print("\n2. Order Workflow Demo")
    print("-" * 40)

    try:
        order = await create_order_workflow(
            user_id="user-456",
            items=[
                {"product_id": "prod-123", "quantity": 2},
                {"product_id": "prod-789", "quantity": 1},
            ],
        )
        print(f"  Final order: {order['id']} - ${order['total']}")
    except RpcError as e:
        print(f"  Workflow failed: {e.code} - {e.message}")
    except ValueError as e:
        print(f"  Validation failed: {e}")

    # ─── Search with Transform Demo ──────────────────────────────────────────
    print("\n3. Search with Server-Side Transform")
    print("-" * 40)

    try:
        products = await search_products_with_transform("electronics")
        for p in products[:3]:
            status = "In Stock" if p["in_stock"] else "Out of Stock"
            print(f"  {p['name']}: ${p['price']} ({status})")
    except RpcError as e:
        print(f"  Search failed: {e.message}")

    # ─── Error Handling Demo ─────────────────────────────────────────────────
    print("\n4. Error Handling Demo")
    print("-" * 40)

    user = await safe_get_user("nonexistent-user")
    if user is None:
        print("  User not found (handled gracefully)")
    else:
        print(f"  User: {user['name']}")

    # ─── Streaming Demo (shortened) ──────────────────────────────────────────
    print("\n5. Streaming Demo")
    print("-" * 40)

    handler = OrderEventHandler()
    print("  (Streaming would run here in production)")
    print(f"  Handler ready to receive events")

    print("\n" + "=" * 60)
    print("Demo Complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
```

---

## Comparison with Direct capnweb

| Task | capnweb | rpc.do |
|------|---------|--------|
| **Connect to mongo.do** | `async with capnweb.connect("wss://mongo.do/rpc", headers={"Authorization": "Bearer ..."}) as mongo:` | `rpc.mongo` |
| **Multiple services** | Manage multiple connections manually | Single `rpc` proxy routes automatically |
| **Authentication** | Pass headers to each connection | Set `RPC_DO_TOKEN` once |
| **Connection pooling** | Implement yourself | Built-in |
| **Retries** | Implement yourself | Configurable defaults |
| **Service discovery** | You provide URLs | Magic routing via `rpc.{service}` |

**Use capnweb directly when:**
- You need full control over the connection
- You're building a custom RPC server
- You need features not exposed by rpc.do

**Use rpc.do when:**
- You're consuming `.do` services
- You want zero-configuration service discovery
- You need managed connection pooling and retries
- You're orchestrating calls to multiple services

---

## Migration from capnweb

```python
# Before (capnweb)
import capnweb

async def main():
    async with capnweb.connect("wss://mongo.do/rpc") as mongo:
        users = await mongo.users.find({})

# After (rpc.do)
from rpc_do import rpc

async def main():
    users = await rpc.mongo.users.find({})
```

```python
# Before (multiple services)
async with capnweb.connect("wss://mongo.do/rpc") as mongo:
    async with capnweb.connect("wss://redis.do/rpc") as redis:
        user = await mongo.users.findOne({"_id": "123"})
        await redis.set(f"user:123", user)

# After (single proxy)
from rpc_do import rpc

user = await rpc.mongo.users.findOne({"_id": "123"})
await rpc.redis.set(f"user:123", user)
```

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Simple things simple** | `await rpc.mongo.find({})` just works |
| **Complex things possible** | Full pipelining, streaming, workflows |
| **Zero configuration** | Environment variables, sensible defaults |
| **Python idioms** | Context managers, async/await, type hints |
| **Service mesh ready** | Connection pooling, circuit breakers, retries |
| **Observable** | Hooks for metrics, tracing, logging |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](https://pypi.org/project/capnweb/) | Low-level capability-based RPC |
| [mongo-do](https://pypi.org/project/mongo-do/) | MongoDB-specific client |
| [database-do](https://pypi.org/project/database-do/) | Multi-database client |
| [agents-do](https://pypi.org/project/agents-do/) | AI agents framework |

---

## License

MIT
