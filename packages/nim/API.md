# Cap'n Web Nim Client API

A zero-cost, pragma-driven RPC client that feels native to Nim.

---

## Design Philosophy

This API embraces what makes Nim beautiful:

1. **Pragmas are the Nim way** - `{.rpc.}`, `{.target.}`, `{.expose.}` feel natural alongside `{.async.}`
2. **UFCS enables fluency** - Every API works as both `api.users.get(id)` and `get(api.users, id)`
3. **Templates for zero-cost** - Compile-time expansion, no runtime overhead
4. **Concepts for generics** - Duck-typed constraints checked at compile time
5. **Multi-backend by default** - Same code compiles to C, C++, and JavaScript

---

## Quick Start

```nim
import capnweb

# Connect and call
withSession("wss://api.example.com"):
  let user = await api.users.get(123)
  echo user.name
```

That's it. Pipelining, serialization, and transport are handled automatically.

---

## Core API

### Connection

```nim
import capnweb

# Scoped session (recommended)
withSession("wss://api.example.com"):
  let result = await api.greet("World")

# Explicit session management
let session = await connect("wss://api.example.com")
defer: await session.close()

# With configuration
let session = await connect("wss://api.example.com",
  timeout = 30.seconds,
  reconnect = true,
  headers = {"Authorization": "Bearer token"}.toTable
)

# HTTP batch mode for request/response APIs
withBatch("https://api.example.com"):
  let a = api.foo()  # Queued
  let b = api.bar()  # Queued
  # Batch sent on block exit
  echo await a, await b
```

### Type Definitions

Types use familiar Nim constructs with the `{.rpc.}` pragma:

```nim
import capnweb

type
  # Mark types as RPC-enabled
  UserService {.rpc.} = ref object
  ProfileService {.rpc.} = ref object

  # Plain data types serialize automatically
  User = object
    id: int
    name: string
    email: string
    roles: seq[string]

  Profile = object
    displayName: string
    bio: string
    avatar: string

# Define methods with the rpc pragma
proc get(svc: UserService, id: int): RpcPromise[User] {.rpc.}
proc list(svc: UserService): RpcPromise[seq[User]] {.rpc.}
proc create(svc: UserService, name, email: string): RpcPromise[User] {.rpc.}

proc profile(svc: UserService, userId: int): RpcPromise[ProfileService] {.rpc.}
proc displayName(svc: ProfileService): RpcPromise[string] {.rpc.}
proc bio(svc: ProfileService): RpcPromise[string] {.rpc.}
```

### RPC Calls

Natural Nim syntax with full UFCS support:

```nim
withSession("wss://api.example.com"):
  # Method calls
  let user = await api.users.get(123)

  # Named parameters (native Nim feature)
  let newUser = await api.users.create(
    name = "Alice",
    email = "alice@example.com"
  )

  # UFCS - these are equivalent
  let a = await api.users.get(123)
  let b = await get(api.users, 123)

  # Index access
  let item = await api.items[0]
  let config = await api.settings["theme"]

  # Chaining
  let name = await api.users.get(123).profile.displayName
```

---

## Pipelining

Cap'n Web's promise pipelining eliminates round trips. In Nim, this is implicit and zero-cost.

### Implicit Pipelining

Don't await intermediate steps:

```nim
withSession("wss://api.example.com"):
  # One round trip, not three
  let name = await api.users.get(123).profile.displayName

  # Each unawaited call pipelines through the previous
  let auth = api.authenticate(token)        # RpcPromise, not awaited
  let profile = auth.getProfile()           # Pipelines through auth
  let bio = profile.getBio()                # Pipelines through profile

  echo await bio  # Single round trip for entire chain
```

### Fork Pattern

Multiple operations from one promise:

```nim
withSession("wss://api.example.com"):
  let auth = api.authenticate(token)  # Not awaited

  # Both pipeline through auth concurrently
  let (userId, notifications) = await all(
    auth.getUserId(),
    auth.getNotifications()
  )
```

### Pipeline Block

Explicit batching for complex workflows:

```nim
withSession("wss://api.example.com"):
  # Everything inside pipelines together
  let result = await pipeline:
    let auth = api.authenticate(token)
    let user = api.users.get(auth.userId)
    let friends = api.friends.list(auth.userId)
    (user: user, friends: friends)
```

### Arrow Syntax (Optional)

For those who prefer explicit flow:

```nim
import capnweb/sugar

let name = await (
  api.authenticate(token) ~>
  getProfile() ~>
  displayName
)
```

---

## The `map` Operation

Transform remote collections without N+1 queries:

```nim
withSession("wss://api.example.com"):
  let userIds = api.listUserIds()  # RpcPromise[seq[int]]

  # Single round trip: remap expression sent to server
  let profiles = await userIds.remap(id => api.profiles.get(id))

  # With transformation
  let enriched = await userIds.remap do (id: int) -> auto:
    (id: id, profile: api.profiles.get(id), avatar: api.avatars.get(id))

  # Functional chain
  let activeEmails = await api.users.list()
    .filter(u => u.isActive)
    .remap(u => u.email)
```

### Parallel Map

For operations that can't be expressed as remap:

```nim
# Limited concurrency for external resources
let results = await userIds.mapParallel(concurrency = 10):
  id => api.externalService.process(id)
```

---

## Streaming

Async iterators for real-time data:

```nim
import capnweb

type
  EventService {.rpc.} = ref object
  Event = object
    kind: string
    data: string

proc stream(svc: EventService): RpcStream[Event] {.rpc.}

withSession("wss://api.example.com"):
  # Async iteration
  for event in api.events.stream():
    echo event.kind
    if event.kind == "close":
      break  # Early break sends cancel

  # Collect to sequence
  let allEvents = await api.events.stream().toSeq()

  # Stream transformations
  let filtered = api.events.stream()
    .filter(e => e.kind == "message")
    .map(e => e.data)

  for data in filtered:
    echo data
```

### Stream Combinators

```nim
# Join multiple streams
let combined = join(
  api.notifications.stream(),
  api.messages.stream()
)

# Window operations
let batched = api.metrics.stream()
  .window(size = 10)
  .map(batch => batch.average())

# Timeout per element
let bounded = api.events.stream()
  .timeout(5.seconds)
```

---

## Error Handling

### Exception-Based (Default)

```nim
import capnweb

withSession("wss://api.example.com"):
  try:
    let result = await api.riskyOperation()
  except RpcError as e:
    echo "RPC failed: ", e.message
    echo "Remote type: ", e.errorType
    echo "Remote stack: ", e.remoteStack
  except ConnectionError:
    echo "Connection lost"
  except TimeoutError:
    echo "Operation timed out"
```

### Result Type (Optional)

For those who prefer explicit error handling:

```nim
import capnweb

withSession("wss://api.example.com"):
  let res = await api.getUser(id).toResult()

  case res.isOk:
  of true:
    echo res.get().name
  of false:
    echo "Error: ", res.error().message
```

### Option Type

For operations where failure is expected:

```nim
let maybeUser = await api.findUser(email).toOption()

if maybeUser.isSome:
  echo maybeUser.get().name
else:
  echo "User not found"
```

### Connection Callbacks

```nim
let session = await connect("wss://api.example.com")

session.onBroken = proc(error: ref Exception) {.async.} =
  echo "Connection broken: ", error.msg

session.onReconnect = proc() {.async.} =
  echo "Reconnected"
```

---

## Exposing Local Objects

Make Nim objects callable by remote peers.

### Target Pragma

```nim
import capnweb

type
  Calculator {.target.} = ref object
    memory: float

# Public methods are automatically exposed
proc add(calc: Calculator, a, b: float): float =
  a + b

proc multiply(calc: Calculator, a, b: float): float =
  a * b

# Async methods work seamlessly
proc slowCompute(calc: Calculator, n: int): Future[int] {.async.} =
  await sleepAsync(1000)
  return n * 2

# Private methods (underscore prefix) are NOT exposed
proc _internalHelper(calc: Calculator) =
  discard

# Properties via getter/setter
proc memory(calc: Calculator): float = calc.memory
proc `memory=`(calc: Calculator, value: float) = calc.memory = value

# Disposal callback
proc dispose(calc: Calculator) =
  echo "Calculator disposed"
```

### Explicit Exposure

Fine-grained control with `{.expose.}`:

```nim
type
  Service {.target.} = ref object

# Only methods marked expose are available
proc public(svc: Service, x: int): int {.expose.} =
  x * 2

proc alsoPublic(svc: Service): string {.expose.} =
  "hello"

proc notExposed(svc: Service) =
  # This method is not callable remotely
  discard
```

### Registration

```nim
withSession("wss://api.example.com"):
  let calc = Calculator(memory: 0.0)

  # Export to the remote peer
  await api.registerCalculator(calc)

  # Now remote can call calc.add(1, 2), calc.multiply(3, 4), etc.
```

---

## Type System Integration

### Concepts for Generic Programming

```nim
import capnweb

# Define what a UserService-like thing looks like
type
  UserServiceConcept = concept s
    s.get(int) is RpcPromise[User]
    s.list() is RpcPromise[seq[User]]

# Generic functions over RPC interfaces
proc fetchAllUsers[T: UserServiceConcept](svc: T): Future[seq[User]] {.async.} =
  result = await svc.list()

# Compile-time verification
static:
  assert UserService is UserServiceConcept
```

### Distinct Types

Semantic type safety with zero overhead:

```nim
type
  UserId = distinct int
  PostId = distinct int

proc get(svc: UserService, id: UserId): RpcPromise[User] {.rpc.}
proc get(svc: PostService, id: PostId): RpcPromise[Post] {.rpc.}

# Compile error: type mismatch
# let user = await api.users.get(postId)
```

### Object Variants

Algebraic data types for discriminated responses:

```nim
type
  ApiResult = object
    case kind: ResultKind
    of rkSuccess:
      data: JsonNode
    of rkError:
      error: RpcError
    of rkPending:
      ticket: string
```

---

## Compile-Time Schema Validation

Validate schemas at compile time:

```nim
import capnweb/schema

# Schema definition
const apiSchema = """
service UserService:
  method get(id: int): User
  method list(): seq[User]

type User:
  id: int
  name: string
"""

# Generate types at compile time
generateFromSchema(apiSchema)

# Or validate existing types
static:
  validateSchema(UserService, apiSchema)
```

---

## Multi-Backend Support

Same code compiles to native and browser:

```nim
import capnweb

# Works on all backends
withSession("wss://api.example.com"):
  let data = await api.getData()

# Backend-specific transports
when defined(js):
  # Browser: WebSocket or MessagePort
  import capnweb/transport/messageport

  let worker = newWorker("worker.js")
  let session = await connectPort(worker.port)

else:
  # Native: WebSocket over asyncdispatch or chronos
  import capnweb/transport/websocket

  let session = await connect("wss://api.example.com")
```

---

## Module Structure

```
capnweb/
  capnweb.nim                 # Main module, public API
  capnweb/
    core/
      session.nim             # Session management
      promise.nim             # RpcPromise[T]
      stream.nim              # RpcStream[T]
      error.nim               # Error types
    transport/
      base.nim                # Transport concept
      websocket.nim           # WebSocket (native)
      websocket_js.nim        # WebSocket (JS)
      http.nim                # HTTP batch
      messageport.nim         # MessagePort (JS)
    macros/
      rpc.nim                 # {.rpc.} pragma
      target.nim              # {.target.} pragma
      pipeline.nim            # pipeline block
      schema.nim              # compile-time schema
    sugar.nim                 # Optional syntax sugar (~>, etc.)
```

---

## Key Types

```nim
type
  ## A session manages one RPC connection
  Session* = ref object
    transport: Transport
    imports: Table[ImportId, Import]
    exports: Table[ExportId, Export]

  ## A lazy promise supporting pipelining
  RpcPromise*[T] = ref object
    session: Session
    path: seq[PathElement]
    fulfilled: bool
    value: Option[T]
    error: Option[ref RpcError]

  ## An async stream of values
  RpcStream*[T] = ref object
    promise: RpcPromise[AsyncIterator[T]]

  ## RPC error with remote context
  RpcError* = object of CatchableError
    errorType*: string
    remoteStack*: string
    code*: int

# RpcPromise integrates with await
proc await*[T](p: RpcPromise[T]): Future[T]

# Attribute access for pipelining
template `.`*[T](p: RpcPromise[T], field: untyped): auto

# Method call for pipelining
template `()`*[T](p: RpcPromise[T], args: varargs[untyped]): auto

# Index access for pipelining
template `[]`*[T](p: RpcPromise[T], key: untyped): auto
```

---

## Templates for Zero-Cost

All abstractions expand at compile time:

```nim
# withSession expands to:
template withSession*(url: string, body: untyped) =
  let session {.inject.} = waitFor connect(url)
  let api {.inject.} = session.stub
  try:
    body
  finally:
    waitFor session.close()

# remap expands to efficient expression tree
template remap*[T, R](p: RpcPromise[seq[T]], f: proc(x: T): R): RpcPromise[seq[R]] =
  p.session.buildRemap(p, f)
```

---

## Complete Example

```nim
import capnweb

# Define the interface
type
  Api {.rpc.} = ref object
  UserService {.rpc.} = ref object
  ProfileService {.rpc.} = ref object

  User = object
    id: int
    name: string
    email: string

  Profile = object
    displayName: string
    bio: string

proc users(api: Api): RpcPromise[UserService] {.rpc.}
proc get(svc: UserService, id: int): RpcPromise[User] {.rpc.}
proc list(svc: UserService): RpcPromise[seq[User]] {.rpc.}
proc profile(svc: UserService, userId: int): RpcPromise[ProfileService] {.rpc.}
proc displayName(svc: ProfileService): RpcPromise[string] {.rpc.}

# Local target
type
  Logger {.target.} = ref object
    prefix: string

proc log(logger: Logger, msg: string) {.expose.} =
  echo logger.prefix, msg

# Main program
proc main() {.async.} =
  withSession("wss://api.example.com"):
    # Simple call
    let user = await api.users.get(123)
    echo "User: ", user.name

    # Pipelining (single round trip)
    let name = await api.users.get(123).profile.displayName
    echo "Display name: ", name

    # Fork pattern
    let auth = api.authenticate(token)
    let (profile, notifications) = await all(
      auth.getProfile(),
      auth.getNotifications()
    )

    # Remap
    let userIds = api.listUserIds()
    let enriched = await userIds.remap do (id: int) -> auto:
      (id: id, user: api.users.get(id))

    for item in enriched:
      echo item.id, ": ", item.user.name

    # Export local target
    let logger = Logger(prefix: "[remote] ")
    await api.registerLogger(logger)

    echo "Done"

waitFor main()
```

---

## Why Nim Developers Will Love This

1. **Pragmas feel native** - `{.rpc.}` alongside `{.async.}` is the Nim way
2. **UFCS everywhere** - Fluent and functional styles both work
3. **Zero-cost abstractions** - Templates expand at compile time
4. **Type safety** - Concepts and distinct types catch errors early
5. **Multi-backend** - Same code on server and browser
6. **Pipelining is invisible** - Just don't await, and it works
7. **Streaming with iterators** - Native async for loop syntax
8. **Named parameters** - Nim's feature shines for RPC calls

---

## Appendix: Pragma Reference

| Pragma | Target | Description |
|--------|--------|-------------|
| `{.rpc.}` | type, proc | Marks type as RPC stub or proc as RPC method |
| `{.target.}` | type | Marks type as exportable RPC target |
| `{.expose.}` | proc | Explicitly exposes method on target |
| `{.pipeline.}` | block | Groups calls for single round trip |
| `{.stream.}` | proc | Marks method as returning stream |

---

*This API is designed to feel like Nim, not like an RPC library that happens to use Nim.*
