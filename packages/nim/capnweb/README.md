# capnweb

**Pragma-driven, zero-cost RPC for Nim.**

```nim
let name = await api.users.get(42).profile.displayName
```

One line. One round-trip. Native Nim idioms.

[![nimble](https://img.shields.io/badge/nimble-capnweb-blue.svg)](https://nimble.directory/pkg/capnweb)

---

## The Nim Way

Cap'n Web brings capability-based RPC to Nim with an API that embraces what makes Nim beautiful:

- **Pragmas** - `{.rpc.}` and `{.target.}` feel native alongside `{.async.}`
- **UFCS** - `api.users.get(id)` and `get(api.users, id)` are equivalent
- **Templates** - Zero-cost abstractions expand at compile time
- **Concepts** - Duck-typed generics checked at compile time
- **Multi-backend** - Same code compiles to C, C++, and JavaScript

```nim
import capnweb

type
  Api {.rpc.} = ref object
  Users {.rpc.} = ref object
  User = object
    id: int
    name: string

proc users(api: Api): RpcPromise[Users] {.rpc.}
proc get(users: Users, id: int): RpcPromise[User] {.rpc.}

withSession("wss://api.example.com"):
  let user = await api.users.get(42)
  echo "Hello, ", user.name
```

---

## Installation

```bash
nimble install capnweb
```

Or add to your `.nimble` file:

```nimble
requires "capnweb >= 0.1.0"
```

---

## Quick Start

### 1. Define Your Interfaces

Interfaces use Nim's type system with the `{.rpc.}` pragma:

```nim
import capnweb

type
  BlogApi {.rpc.} = ref object
  Posts {.rpc.} = ref object
  Authors {.rpc.} = ref object

  Post = object
    id: int
    title: string
    body: string

  Author = object
    id: int
    name: string
    bio: string

# Methods are procs with the rpc pragma
proc posts(api: BlogApi): RpcPromise[Posts] {.rpc.}
proc authors(api: BlogApi): RpcPromise[Authors] {.rpc.}

proc get(posts: Posts, id: int): RpcPromise[Post] {.rpc.}
proc list(posts: Posts): RpcPromise[seq[Post]] {.rpc.}
proc create(posts: Posts, title, body: string): RpcPromise[Post] {.rpc.}

proc get(authors: Authors, id: int): RpcPromise[Author] {.rpc.}
```

### 2. Connect and Call

```nim
import capnweb

withSession("wss://blog.example.com"):
  let posts = await api.posts.list()

  for post in posts:
    echo post.title
```

---

## Pipelining

The killer feature. Chain method calls without waiting for intermediate results.

```nim
# WITHOUT pipelining: 3 round-trips
let users = await api.users
let user = await users.get(42)
let profile = await user.profile
let name = profile.displayName

# WITH pipelining: 1 round-trip
let name = await api.users.get(42).profile.displayName
```

### How It Works

Every method returns an `RpcPromise[T]`. An `RpcPromise` is both awaitable and chainable - you can call methods on it before awaiting.

```nim
let users = api.users           # RpcPromise[Users], no network yet
let user = users.get(42)        # RpcPromise[User], still no network
let profile = user.profile      # Building the pipeline...
let name = await profile.name   # NOW we send everything
```

The entire chain collapses into a single request. The server evaluates `api.users.get(42).profile.name` in one shot and returns the result.

### Fork Pattern

Multiple operations from one promise:

```nim
withSession("wss://api.example.com"):
  let session = api.authenticate(token)  # Not awaited

  # Both pipeline through session concurrently
  let (profile, notifications) = await all(
    session.getProfile(),
    session.getNotifications()
  )
```

### Pipeline Block

Explicit batching for complex workflows:

```nim
withSession("wss://api.example.com"):
  let result = await pipeline:
    let auth = api.authenticate(token)
    let user = api.users.get(auth.userId)
    let friends = api.friends.list(auth.userId)
    (user: user, friends: friends)
```

---

## The `remap` Operation

Transform remote collections without N+1 queries:

```nim
withSession("wss://api.example.com"):
  let userIds = api.listUserIds()  # RpcPromise[seq[int]]

  # Single round trip: remap expression sent to server
  let profiles = await userIds.remap(proc(id: int): auto =
    api.profiles.get(id)
  )

  # With do notation
  let enriched = await userIds.remap do (id: int) -> auto:
    (id: id, profile: api.profiles.get(id), avatar: api.avatars.get(id))
```

### Functional Chains

```nim
# Filter and transform
let activeEmails = await api.users.list()
  .filter(proc(u: User): bool = u.isActive)
  .remap(proc(u: User): auto = u.email)

# Parallel map with concurrency limit
let results = await userIds.mapParallel(10, proc(id: int): auto =
  api.externalService.process(id)
)
```

---

## Error Handling

### Exception-Based (Default)

Nim's natural exception handling:

```nim
import capnweb

withSession("wss://api.example.com"):
  try:
    let result = await api.riskyOperation()
  except RpcError as e:
    echo "RPC failed: ", e.msg
    echo "Remote type: ", e.errorType
    echo "Remote stack: ", e.remoteStack
  except ConnectionError as e:
    echo "Connection lost: ", e.msg
  except TimeoutError as e:
    echo "Timeout: ", e.msg
```

### Result Type (Optional)

For those who prefer explicit error handling:

```nim
import capnweb

withSession("wss://api.example.com"):
  let res = await api.getUser(id).toResult()

  if res.isOk:
    echo res.get().name
  else:
    echo "Error: ", res.error().msg
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

### Error Types

```nim
type
  RpcError* = object of CatchableError
    errorType*: string      # Remote error class name
    remoteStack*: string    # Remote stack trace (if enabled)
    code*: int              # Numeric error code

  ConnectionError* = object of CatchableError
    ## Network or WebSocket failure

  TimeoutError* = object of CatchableError
    ## Request exceeded timeout
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

Make Nim objects callable by remote peers using `{.target.}`.

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
    .filter(proc(e: Event): bool = e.kind == "message")
    .map(proc(e: Event): string = e.data)

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
  .map(proc(batch: seq[Metric]): float = batch.average())

# Timeout per element
let bounded = api.events.stream()
  .timeout(5.seconds)
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
  assert Users is UserServiceConcept
```

### Distinct Types

Semantic type safety with zero overhead:

```nim
type
  UserId = distinct int
  PostId = distinct int

proc get(svc: Users, id: UserId): RpcPromise[User] {.rpc.}
proc get(svc: Posts, id: PostId): RpcPromise[Post] {.rpc.}

# Compile error: type mismatch
# let user = await api.users.get(postId)
```

### Object Variants

Algebraic data types for discriminated responses:

```nim
type
  ResultKind = enum
    rkSuccess, rkError, rkPending

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

## Connection Management

### Scoped Session (Recommended)

```nim
import capnweb

# Session auto-closes on block exit
withSession("wss://api.example.com"):
  let result = await api.greet("World")
```

### Explicit Session

```nim
let session = await connect("wss://api.example.com")
defer: await session.close()

let api = session.stub
let greeting = await api.greet("World")
```

### Configuration Options

```nim
let session = await connect("wss://api.example.com",
  timeout = 30.seconds,
  reconnect = true,
  headers = {"Authorization": "Bearer token"}.toTable
)
```

### HTTP Batch Mode

For request/response APIs without WebSocket:

```nim
withBatch("https://api.example.com"):
  let a = api.foo()  # Queued
  let b = api.bar()  # Queued
  # Batch sent on block exit
  echo await a, await b
```

---

## Multi-Backend Support

Same code compiles to native and browser targets.

### Native (C Backend)

```nim
# Compiled with: nim c myapp.nim
import capnweb
import asyncdispatch

proc main() {.async.} =
  withSession("wss://api.example.com"):
    let data = await api.getData()

waitFor main()
```

### JavaScript Backend

```nim
# Compiled with: nim js myapp.nim
import capnweb
import asyncjs

proc main() {.async.} =
  withSession("wss://api.example.com"):
    let data = await api.getData()

discard main()
```

### Browser MessagePort

For iframe and worker communication:

```nim
when defined(js):
  import capnweb/transport/messageport

  let worker = newWorker("worker.js")
  let session = await connectPort(worker.port)
```

### Backend Detection

```nim
when defined(js):
  # Browser-specific code
  import dom
else:
  # Native-specific code
  import os
```

---

## Templates and Zero-Cost

All abstractions expand at compile time for zero runtime overhead.

### withSession Template

```nim
# This template:
withSession("wss://api.example.com"):
  let user = await api.users.get(42)

# Expands to:
block:
  let session = waitFor connect("wss://api.example.com")
  let api = session.stub
  try:
    let user = await api.users.get(42)
  finally:
    waitFor session.close()
```

### remap Template

```nim
# remap compiles to efficient expression tree
template remap*[T, R](p: RpcPromise[seq[T]], f: proc(x: T): R): RpcPromise[seq[R]] =
  p.session.buildRemap(p, f)
```

### UFCS Everywhere

Both styles work identically:

```nim
# Method syntax
let user = await api.users.get(42)

# Function syntax
let user = await get(users(api), 42)

# Mixed
let profile = await api.users.get(42).getProfile()
let profile = await getProfile(get(users(api), 42))
```

---

## Complete Example

A todo app demonstrating all major features:

```nim
import capnweb
import asyncdispatch

# ─── Interface Definitions ───────────────────────────────────────────

type
  TodoApi {.rpc.} = ref object
  Todos {.rpc.} = ref object
  AuthSession {.rpc.} = ref object
  MutableTodos {.rpc.} = ref object

  Todo = object
    id: int
    title: string
    done: bool

  User = object
    id: int
    name: string

proc todos(api: TodoApi): RpcPromise[Todos] {.rpc.}
proc authenticate(api: TodoApi, token: string): RpcPromise[AuthSession] {.rpc.}

proc list(todos: Todos): RpcPromise[seq[Todo]] {.rpc.}
proc get(todos: Todos, id: int): RpcPromise[Todo] {.rpc.}

proc me(session: AuthSession): RpcPromise[User] {.rpc.}
proc todos(session: AuthSession): RpcPromise[MutableTodos] {.rpc.}

proc create(todos: MutableTodos, title: string): RpcPromise[Todo] {.rpc.}
proc update(todos: MutableTodos, id: int, done: bool): RpcPromise[Todo] {.rpc.}
proc delete(todos: MutableTodos, id: int): RpcPromise[void] {.rpc.}

# ─── Local Target ────────────────────────────────────────────────────

type
  Logger {.target.} = ref object
    prefix: string

proc log(logger: Logger, msg: string) {.expose.} =
  echo logger.prefix, msg

# ─── Application ─────────────────────────────────────────────────────

proc main() {.async.} =
  withSession("wss://todo.example.com"):
    # Public read: list all todos (one round-trip)
    echo "All todos:"
    for todo in await api.todos.list():
      let status = if todo.done: "[x]" else: "[ ]"
      echo "  ", status, " ", todo.title

    # Authenticate
    let token = getEnv("API_TOKEN")
    let session = api.authenticate(token)

    # Fork the pipeline: create a todo AND fetch user info
    let newTodo = session.todos.create("Learn Nim")
    let me = session.me()

    # Single round-trip resolves both
    let (todo, user) = await all(newTodo, me)

    echo ""
    echo user.name, " created: ", todo.title

    # Mark it done (another single round-trip through the session)
    let updated = await session.todos.update(todo.id, true)
    echo "Completed: ", updated.title

    # Export local target
    let logger = Logger(prefix: "[remote] ")
    await api.registerLogger(logger)

    echo "Done"

waitFor main()
```

---

## Protocol Reference

Cap'n Web uses a JSON-based bidirectional protocol derived from Cap'n Proto's CapTP.

### Message Types

| Message | Direction | Description |
|---------|-----------|-------------|
| `push` | Client -> Server | Evaluate expression, assign import ID |
| `pull` | Client -> Server | Request result for import ID |
| `resolve` | Server -> Client | Return successful result |
| `reject` | Server -> Client | Return error |
| `release` | Client -> Server | Dispose import reference |
| `abort` | Either | Terminate session with error |

### Expression Types

| Expression | Description |
|------------|-------------|
| `["import", id, path?, args?]` | Reference import, optionally access property/call method |
| `["pipeline", id, path?, args?]` | Promise pipeline through unresolved import |
| `["export", id]` | Export new stub |
| `["promise", id]` | Export new promise |
| `["remap", id, path, captures, instructions]` | Map operation |

### Special Value Encoding

| Type | Encoding |
|------|----------|
| Array | `[["a", "b", "c"]]` |
| undefined | `["undefined"]` |
| Infinity | `["inf"]`, `["-inf"]` |
| NaN | `["nan"]` |
| bytes | `["bytes", "base64..."]` |
| bigint | `["bigint", "decimal"]` |
| Date | `["date", milliseconds]` |
| Error | `["error", type, message, stack?]` |

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
    sugar.nim                 # Optional syntax sugar
```

---

## Key Types

```nim
type
  ## A session manages one RPC connection
  Session* = ref object
    transport: Transport
    imports: Table[int, Import]
    exports: Table[int, Export]

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

## Pragma Reference

| Pragma | Target | Description |
|--------|--------|-------------|
| `{.rpc.}` | type, proc | Marks type as RPC stub or proc as RPC method |
| `{.target.}` | type | Marks type as exportable RPC target |
| `{.expose.}` | proc | Explicitly exposes method on target |
| `{.pipeline.}` | block | Groups calls for single round trip |
| `{.stream.}` | proc | Marks method as returning stream |

---

## Why This Design

| Decision | Rationale |
|----------|-----------|
| Pragmas over decorators | `{.rpc.}` alongside `{.async.}` is the Nim way |
| UFCS-friendly API | Both `api.users.get(id)` and `get(api.users, id)` work |
| Templates for core abstractions | Zero runtime overhead, compile-time expansion |
| Concepts for generics | Duck-typed constraints checked at compile time |
| Multi-backend by default | Same source for native and browser targets |
| `defer` for cleanup | Nim idiom for resource management |
| `proc` lambdas | Correct Nim syntax (not `=>` arrow syntax) |

---

## Security Considerations

### Remote Stack Traces

By default, remote stack traces are redacted. Enable only in development:

```nim
let session = await connect("wss://api.example.com",
  exposeStacks = true  # Development only!
)
```

### Capability Security

Stubs are capabilities - holding a stub grants the ability to call it. Design your API accordingly:

```nim
# Good: authenticate returns limited capability
let session = api.authenticate(token)
let todos = session.todos  # Only authenticated users can access

# Bad: everything accessible from root
let todos = api.todos  # Anyone can access
```

### Input Validation

Always validate inputs in your target implementations:

```nim
proc createTodo(svc: TodoService, title: string): Future[Todo] {.async, expose.} =
  if title.len == 0:
    raise newException(ValueError, "Title cannot be empty")
  if title.len > 200:
    raise newException(ValueError, "Title too long")
  # ...
```

---

## License

MIT OR Apache-2.0
