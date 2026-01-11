# Cap'n Web Nim Client: Syntax Exploration

This document explores four divergent approaches to designing an idiomatic Nim client for Cap'n Web RPC. Each approach leverages different aspects of Nim's unique language features to optimize for different trade-offs.

---

## Background: What Makes Nim Unique

Nim offers a distinctive combination of features that influence API design:

- **Python-like Syntax with Static Typing**: Clean, readable syntax with powerful compile-time type checking
- **Powerful Macro System**: Compile-time AST transformation enables DSLs and code generation
- **Templates**: Zero-cost inline abstractions
- **UFCS (Uniform Function Call Syntax)**: `x.f(y)` and `f(x, y)` are equivalent, enabling fluent APIs
- **Async/Await with Pragmas**: `{.async.}` pragma for coroutines, works with multiple backends
- **Multi-Backend Compilation**: Compiles to C, C++, JavaScript, enabling browser and native targets
- **Distinct Types**: Create semantically different types with same representation
- **Object Variants**: Algebraic data types via case objects
- **Concepts**: Compile-time duck typing for generics

The challenge: Cap'n Web stubs are "infinite" proxies where any method/property could be valid. Nim's static type system needs to accommodate this dynamism elegantly.

---

## Approach 1: Pragma-Based with Macros (The "Nim Way")

Inspired by Nim's own `{.async.}` pragma pattern. Uses macros and pragmas to generate stub types from interface definitions.

### Philosophy
Leverage Nim's pragma system and macros for maximum Nim idiomaticity. Interfaces are defined declaratively, and the compiler generates all necessary code.

### Connection/Session Creation

```nim
import capnweb

# Async context manager pattern with withSession template
withSession("wss://api.example.com"):
  let user = await api.getUser(123)
  echo user.name

# Explicit session for long-running connections
let session = await connect("wss://api.example.com")
defer: await session.close()

let api = session.stub
let greeting = await api.greet("World")

# HTTP batch mode
withBatch("https://api.example.com"):
  let profile = api.getProfile(userId)  # Not awaited - batched
  let friends = api.getFriends(userId)  # Also batched
  # Batch sent on block exit
  echo await profile
  echo await friends

# With options
let session = await connect("wss://api.example.com",
  timeout = 30.seconds,
  reconnect = true,
  headers = {"Authorization": "Bearer xxx"}.toTable
)
```

### Defining Remote Interfaces

```nim
import capnweb/rpc

# Define interfaces using the rpc pragma
type
  UserApi {.rpc.} = ref object

  User = object
    id: int
    name: string
    email: string

# Methods are defined in a proc block with rpc pragma
proc getUser(api: UserApi, id: int): Future[User] {.rpc.} = discard
proc listUsers(api: UserApi): Future[seq[User]] {.rpc.} = discard
proc createUser(api: UserApi, name, email: string): Future[User] {.rpc.} = discard

# The macro generates:
# - UserApiStub with RpcPromise-returning methods
# - Serialization/deserialization for User

# Alternatively, use a macro block for grouped definitions
rpcInterface UserService:
  proc getUser(id: int): User
  proc listUsers(): seq[User]
  proc profile(): ProfileService

rpcInterface ProfileService:
  proc getName(): string
  proc getBio(): string
  proc updateBio(bio: string)
```

### Making RPC Calls

```nim
withSession("wss://api.example.com") as api:
  # Simple method call
  let user = await api.users.get(123)

  # Property access via UFCS
  let name = await api.currentUser.name

  # Chained calls - all using UFCS
  let friendCount = await api.users.get(123).friends.len

  # Named parameters (Nim supports this natively)
  let newUser = await api.users.create(
    name = "Alice",
    email = "alice@example.com",
    roles = @["admin", "user"]
  )

  # Index access
  let item = await api.items[0]
  let config = await api.settings["theme"]
```

### Pipelining Syntax

```nim
import capnweb

# Pipelining is automatic - don't await intermediate steps
withSession("wss://api.example.com") as api:
  # This is ONE round trip due to pipelining
  let name = await api.users.get(123).profile.displayName

  # Explicit pipeline block for clarity
  pipeline:
    let auth = api.authenticate(token)      # RpcPromise, not awaited
    let userId = auth.getUserId()           # Pipelined through promise
    let profile = api.profiles.get(userId)  # Uses promise as parameter
    # All sent as single batch

  let finalProfile = await profile

  # Fork: multiple leaves from one stem
  let auth = api.authenticate(token)  # Not awaited

  # Both pipeline through auth
  let (userId, notifications) = await all(
    auth.getUserId(),
    auth.getNotifications()
  )

# Pipeline macro with arrow syntax
let result = await pipeline:
  api.authenticate(token) ->
  getProfile() ->
  displayName
```

### The `map()` Operation

```nim
withSession("wss://api.example.com") as api:
  # Map over remote array - single round trip
  let userIds = api.listUserIds()

  let profiles = await userIds.map(id => api.profiles.get(id))

  # With transformation
  let enriched = await userIds.map do (id: int) -> auto:
    (id: id, profile: api.profiles.get(id), avatar: api.avatars.get(id))

  # Functional style with UFCS
  let activeEmails = await api.users.list()
    .filter(u => u.isActive)
    .map(u => u.email)

  # Parallel map with concurrency limit
  let results = await userIds.mapParallel(10, id => api.process(id))
```

### Error Handling

```nim
import capnweb/errors

withSession("wss://api.example.com") as api:
  # Nim's exception handling
  try:
    let result = await api.riskyOperation()
  except RpcError as e:
    echo "RPC failed: ", e.message
    echo "Remote type: ", e.errorType
    echo "Stack trace: ", e.remoteStack
  except ConnectionError as e:
    echo "Connection lost: ", e.msg
  except TimeoutError as e:
    echo "Timeout: ", e.msg

# Option-based for recoverable errors (no exceptions)
let result = await api.mayFail().toOption()
if result.isSome:
  echo result.get()
else:
  echo "Operation failed"

# Result type pattern
let res: Result[User, RpcError] = await api.getUser(id).toResult()
case res.isOk:
of true: echo res.get().name
of false: echo res.error().message

# Broken connection callback
api.onBroken = proc(error: ref Exception) {.async.} =
  echo "Connection broken: ", error.msg
  # Attempt reconnection
```

### Exposing Local Objects as RPC Targets

```nim
import capnweb/target

# Use the target pragma to mark a type as RPC-exposed
type
  Calculator {.target.} = ref object
    memory: float

# Methods are automatically exposed
proc add(calc: Calculator, a, b: float): float =
  a + b

proc multiply(calc: Calculator, a, b: float): float =
  a * b

# Async methods work too
proc slowCompute(calc: Calculator, n: int): Future[int] {.async.} =
  await sleepAsync(1000)
  return n * 2

# Private methods (prefixed with underscore) are NOT exposed
proc internalHelper(calc: Calculator) =
  discard

# Properties via getters/setters
proc memory(calc: Calculator): float = calc.memory
proc `memory=`(calc: Calculator, value: float) = calc.memory = value

# Disposal callback
proc dispose(calc: Calculator) =
  echo "Calculator disposed"

# Register with server
withSession("wss://api.example.com") as api:
  let calc = Calculator(memory: 0.0)
  await api.registerCalculator(calc)  # Server can now call calc
```

### Type Hints and IDE Support

```nim
import capnweb

# Full generic typing
type
  Api = RpcStub[ApiInterface]

  ApiInterface = object
    users: UsersInterface
    config: ConfigInterface

  UsersInterface = object

  User = object
    id: int
    name: string
    email: string

# Typed stubs with IDE autocomplete
proc get(users: RpcStub[UsersInterface], id: int): RpcPromise[User] {.rpc.}
proc list(users: RpcStub[UsersInterface]): RpcPromise[seq[User]] {.rpc.}

# Usage with full type inference
withSession[ApiInterface]("wss://api.example.com") as api:
  let user = await api.users.get(123)  # IDE knows user is User
  echo user.name  # IDE autocomplete works
```

---

## Approach 2: Template-Based DSL (The "Zero-Cost" Way)

Inspired by Nim's template system for zero-overhead abstractions. All RPC logic is inlined at compile time.

### Philosophy
Use templates extensively for zero runtime overhead. The DSL compiles down to efficient procedural code.

### Connection/Session Creation

```nim
import capnweb/dsl

# Template-based connection
rpc "wss://api.example.com":
  call getUser(123) -> user
  echo user.name

# Session object with template helpers
var session = initSession("wss://api.example.com")
session.connect()

defer: session.disconnect()

# Template for scoped sessions
withRpc "wss://api.example.com":
  # Session automatically available as `rpc`
  let result = rpc.call("greet", "World")
```

### Defining Remote Interfaces

```nim
import capnweb/dsl

# Schema DSL compiles to types at compile time
defineSchema:
  service UserService:
    method getUser(id: int): User
    method listUsers(): seq[User]
    property currentUser: User

  service ProfileService:
    method getName(): string
    method updateBio(bio: string): void

  type User:
    id: int
    name: string
    email: string

# Generates:
# type UserService = distinct RpcStub
# type ProfileService = distinct RpcStub
# template getUser(s: UserService, id: int): RpcPromise[User]
# etc.
```

### Making RPC Calls

```nim
import capnweb/dsl

withRpc "wss://api.example.com":
  # Template-based call syntax
  let user = call users.get(123)

  # Property access
  let name = get users[123].profile.name

  # Method chaining via templates
  let friends = call:
    users.get(123).friends.list()

  # Batch multiple calls
  batch:
    let a = call foo()
    let b = call bar()
    let c = call baz()
  # All executed in single round trip
```

### Pipelining Syntax

```nim
import capnweb/dsl

withRpc "wss://api.example.com":
  # Pipeline DSL
  let result = pipe:
    authenticate(token)
    .getProfile()
    .displayName

  # Arrow syntax with template
  let name = authenticate(token) |> getProfile |> displayName |> await

  # Explicit pipelining block
  pipeline auth = authenticate(token):
    let userId = auth.getUserId()
    let profile = getProfile(userId)
    let notifications = auth.getNotifications()
  # Single round trip

  echo await profile
  echo await notifications
```

### The `map()` Operation

```nim
import capnweb/dsl

withRpc "wss://api.example.com":
  # Template-based map
  let userIds = call listUserIds()

  # Map template expands to remap expression
  let names = rmap userIds: (id) =>
    call getProfile(id).name

  # Complex transformation
  let enriched = rmap userIds: (id) =>
    {
      id: id,
      profile: call getProfile(id),
      avatar: call getAvatar(id)
    }

  # Compile-time optimized filter-map
  let active = filterMap call listUsers():
    if it.isActive: some(it.email)
    else: none(string)
```

### Error Handling

```nim
import capnweb/dsl

withRpc "wss://api.example.com":
  # Template-based try-catch with auto-unwrap
  tryRpc:
    let result = call riskyOperation()
    echo result
  onError RpcError:
    echo "RPC failed: ", error.message
  onError ConnectionError:
    echo "Connection lost"

  # Result template
  let res = callResult getUser(id):
    ok: echo "Found: ", it.name
    err: echo "Error: ", it.message

  # Option template
  let maybeUser = callOption getUser(id)
  if maybeUser.isSome:
    echo maybeUser.get().name
```

### Exposing Local Objects as RPC Targets

```nim
import capnweb/dsl

# Template-based target definition
defineTarget Calculator:
  var memory: float = 0.0

  expose add(a, b: float): float =
    a + b

  expose multiply(a, b: float): float =
    a * b

  expose async slowCompute(n: int): int =
    await sleepAsync(1000)
    n * 2

  property memory: float

  onDispose:
    echo "Calculator disposed"

# Usage
withRpc "wss://api.example.com":
  let calc = newCalculator()
  await rpc.register("calculator", calc)
```

---

## Approach 3: Concept-Based Generics (The "Type-Safe" Way)

Uses Nim's concepts for compile-time interface checking with maximum type safety.

### Philosophy
Leverage Nim's concept system for duck-typed generics that are checked at compile time. Interfaces are concepts, stubs are generic over these concepts.

### Connection/Session Creation

```nim
import capnweb/concepts

# Concept for connection configuration
type
  Connectable = concept c
    c.url is string
    connect(c) is Future[Session]

# Multiple connection types satisfy Connectable
type
  WebSocketConfig = object
    url: string
    timeout: Duration
    headers: Table[string, string]

  HttpBatchConfig = object
    url: string
    maxBatchSize: int

proc connect(cfg: WebSocketConfig): Future[Session] {.async.} =
  # Implementation
  discard

proc connect(cfg: HttpBatchConfig): Future[Session] {.async.} =
  # Implementation
  discard

# Generic connect that works with any Connectable
proc connectTo[T: Connectable](config: T): Future[Session] =
  connect(config)

# Usage
let ws = WebSocketConfig(
  url: "wss://api.example.com",
  timeout: 30.seconds,
  headers: initTable[string, string]()
)
let session = await connectTo(ws)

# Shorthand
let session = await connect("wss://api.example.com")
```

### Defining Remote Interfaces with Concepts

```nim
import capnweb/concepts

# Define what a UserService looks like
type
  UserServiceConcept = concept s
    s.getUser(int) is RpcPromise[User]
    s.listUsers() is RpcPromise[seq[User]]
    s.createUser(string, string) is RpcPromise[User]

  ProfileServiceConcept = concept s
    s.getName() is RpcPromise[string]
    s.getBio() is RpcPromise[string]
    s.getProfile() is RpcPromise[ProfileServiceConcept]

  User = object
    id: int
    name: string
    email: string

# Stub types implement the concept
type
  UserService = object
    stub: RpcStub

  ProfileService = object
    stub: RpcStub

# Concept implementation via templates
template getUser(s: UserService, id: int): RpcPromise[User] =
  s.stub.call("getUser", id).as(User)

template listUsers(s: UserService): RpcPromise[seq[User]] =
  s.stub.call("listUsers").as(seq[User])

# Compile-time check that UserService satisfies UserServiceConcept
static:
  assert UserService is UserServiceConcept
```

### Making RPC Calls

```nim
import capnweb/concepts

# Generic function that works with any UserService-like type
proc fetchUser[T: UserServiceConcept](service: T, id: int): Future[User] {.async.} =
  result = await service.getUser(id)

# Usage with concrete stub
withSession("wss://api.example.com") as session:
  let users: UserService = session.stub(UserService)

  # Typed calls with concept constraints
  let user = await users.getUser(123)

  # Generic function works
  let user2 = await fetchUser(users, 456)

  # Chaining with type inference
  let bio = await users.getUser(123).getProfile().getBio()
```

### Pipelining Syntax

```nim
import capnweb/concepts

# Pipeline concept
type
  Pipelineable = concept p
    pipeline(p) is PipelineBuilder
    p.then(proc) is Pipelineable

  PipelineBuilder = concept b
    b.add(RpcPromise) is PipelineBuilder
    b.execute() is Future[void]

# Pipelining with concepts
withSession("wss://api.example.com") as session:
  let users = session.stub(UserService)

  # Concept-constrained pipeline
  proc buildAuthPipeline[T: Pipelineable](p: T, token: string): auto =
    p.then(auth => auth.getProfile())
     .then(profile => profile.getName())

  let name = await session.pipeline()
    .add(session.api.authenticate(token))
    .buildAuthPipeline(token)
    .execute()

# Infix operator for fluent pipelining
template `~>`[T](promise: RpcPromise[T], next: untyped): auto =
  promise.pipeline(next)

let result = await (
  api.authenticate(token) ~>
  getProfile() ~>
  displayName
)
```

### The `map()` Operation

```nim
import capnweb/concepts

# Mappable concept
type
  Mappable = concept m, T, R
    m.map(proc(x: T): R) is RpcPromise[seq[R]]
    m.filter(proc(x: T): bool) is RpcPromise[seq[T]]

# Implementation for RpcPromise[seq[T]]
proc map[T, R](promise: RpcPromise[seq[T]], f: proc(x: T): R): RpcPromise[seq[R]] =
  # Generates remap expression
  discard

# Usage with concept bounds
proc enrichUsers[M: Mappable](users: M, api: Api): auto =
  users.map(user => (
    user: user,
    profile: api.profiles.get(user.id)
  ))

withSession("wss://api.example.com") as session:
  let api = session.stub(Api)

  let enriched = await api.users.list().enrichUsers(api)
```

### Error Handling

```nim
import capnweb/concepts

# Error concept
type
  RpcErrorLike = concept e
    e.message is string
    e.errorType is string
    e.isRetryable is bool

# Generic error handler
proc handleError[E: RpcErrorLike](error: E) =
  if error.isRetryable:
    echo "Retryable error: ", error.message
  else:
    echo "Fatal error: ", error.message

# Concept-based Result
type
  RpcResult[T] = object
    case isOk: bool
    of true:
      value: T
    of false:
      error: RpcError

proc map[T, R](res: RpcResult[T], f: proc(x: T): R): RpcResult[R] =
  if res.isOk:
    RpcResult[R](isOk: true, value: f(res.value))
  else:
    RpcResult[R](isOk: false, error: res.error)

# Usage
let result = await api.getUser(id).toRpcResult()
case result.isOk:
of true:
  echo result.value.name
of false:
  handleError(result.error)
```

### Exposing Local Objects as RPC Targets

```nim
import capnweb/concepts

# Target concept
type
  RpcTargetConcept = concept t
    t.handleCall(string, JsonNode) is Future[JsonNode]
    dispose(t) is void

# Mixin template for common target behavior
template rpcTargetMixin*(T: typedesc) =
  proc handleCall(target: T, methodName: string, args: JsonNode): Future[JsonNode] {.async.} =
    # Dispatch table generated at compile time
    discard

  proc dispose(target: T) =
    when compiles(target.cleanup()):
      target.cleanup()

# Usage
type
  Calculator = object
    memory: float

proc add(calc: Calculator, a, b: float): float = a + b
proc multiply(calc: Calculator, a, b: float): float = a * b

rpcTargetMixin(Calculator)

# Now Calculator satisfies RpcTargetConcept
static:
  assert Calculator is RpcTargetConcept

withSession("wss://api.example.com") as session:
  let calc = Calculator(memory: 0.0)
  await session.export(calc)
```

---

## Approach 4: Async Iterator Pattern (The "Streaming" Way)

Inspired by Nim's closure iterators and async streams. Optimized for streaming and reactive patterns.

### Philosophy
Treat RPC as streams of data. Leverage Nim's iterator protocol and async streams for natural data flow.

### Connection/Session Creation

```nim
import capnweb/streams

# Connection returns an async stream source
let stream = openRpcStream("wss://api.example.com")
defer: stream.close()

# Pull-based consumption
for message in stream:
  echo message

# Or get a session handle
let session = stream.session()

# Reactive connection with callbacks
let connection = connect("wss://api.example.com")
  .onMessage(proc(msg: RpcMessage) = echo msg)
  .onError(proc(err: ref Exception) = echo err.msg)
  .onClose(proc() = echo "Closed")

await connection.start()
```

### Making RPC Calls with Streams

```nim
import capnweb/streams

let session = await connect("wss://api.example.com")

# Call returns an async iterator for streaming responses
let userStream = session.api.streamUsers()

for user in userStream:
  echo user.name
  if user.name == "Alice":
    break  # Early termination sends cancel

# Single value calls still work
let user = await session.api.getUser(123).one()

# Collect stream to sequence
let allUsers = await session.api.streamUsers().toSeq()

# Transform streams
let names = session.api.streamUsers()
  .map(u => u.name)
  .filter(n => n.startsWith("A"))

for name in names:
  echo name
```

### Pipelining Syntax

```nim
import capnweb/streams

let session = await connect("wss://api.example.com")

# Streams naturally pipeline
let profileNames = session.api.listUserIds()      # Stream[int]
  .mapAsync(id => session.api.getProfile(id))     # Stream[Profile]
  .map(p => p.name)                               # Stream[string]

# Consume the pipeline (single batched request)
for name in profileNames:
  echo name

# Join streams from different sources
let auth = session.api.authenticate(token)
let combinedStream = join(
  auth.streamNotifications(),
  auth.streamMessages()
)

for event in combinedStream:
  case event.kind:
  of Notification: handleNotification(event.notification)
  of Message: handleMessage(event.message)
```

### The `map()` Operation

```nim
import capnweb/streams

let session = await connect("wss://api.example.com")

# flatMap for nested streams
let allFriends = session.api.listUsers()
  .flatMap(user => session.api.getFriends(user.id))

# groupBy creates grouped streams
let byDepartment = session.api.listEmployees()
  .groupBy(e => e.department)

for dept, employees in byDepartment:
  echo "Department: ", dept
  for emp in employees:
    echo "  - ", emp.name

# Windowed operations
let averages = session.api.streamMetrics()
  .window(10)  # Groups of 10
  .map(batch => batch.sum() / batch.len)

# Async collect with transformation
let enriched = await session.api.listUserIds()
  .mapAsync(id => session.api.enrichUser(id))
  .take(100)
  .toSeq()
```

### Error Handling

```nim
import capnweb/streams

let session = await connect("wss://api.example.com")

# Stream-level error handling
let users = session.api.streamUsers()
  .onError(proc(e: ref RpcError) =
    echo "Error in stream: ", e.msg
  )
  .recover(proc(e: ref RpcError): User =
    User(id: 0, name: "fallback")
  )

for user in users:
  echo user.name  # Errors become fallback values

# Retry logic
let robust = session.api.streamUsers()
  .retry(maxAttempts = 3, delay = 1.seconds)

# Circuit breaker
let protected = session.api.streamUsers()
  .circuitBreaker(
    failureThreshold = 5,
    recoveryTimeout = 30.seconds
  )

# Timeout per element
let withTimeout = session.api.streamUsers()
  .timeout(5.seconds)  # Per-element timeout
```

### Exposing Local Objects as RPC Targets

```nim
import capnweb/streams

# Target as async stream source
type
  EventSource = ref object
    subscribers: seq[proc(event: Event)]

proc subscribe(source: EventSource, callback: proc(event: Event)) {.target.} =
  source.subscribers.add(callback)

proc emit(source: EventSource, event: Event) =
  for sub in source.subscribers:
    sub(event)

# Streaming target with backpressure
type
  DataProducer = ref object
    buffer: AsyncQueue[Data]

proc stream(producer: DataProducer): AsyncIterator[Data] {.target.} =
  iterator stream(): Data {.async.} =
    while true:
      yield await producer.buffer.get()

# Register and use
let session = await connect("wss://api.example.com")
let producer = DataProducer(buffer: newAsyncQueue[Data]())
await session.export(producer)

# Remote can now call producer.stream() and iterate
```

---

## Comparison Matrix

| Feature | Approach 1 (Pragma) | Approach 2 (Template DSL) | Approach 3 (Concepts) | Approach 4 (Streams) |
|---------|---------------------|---------------------------|----------------------|----------------------|
| **Nim Idiomaticity** | High | Medium | High | High |
| **Type Safety** | Compile-time | Compile-time | Compile-time | Compile-time |
| **Zero-Cost** | Near-zero | Zero | Near-zero | Small overhead |
| **Pipelining** | Implicit | DSL-based | Operator-based | Stream-based |
| **Learning Curve** | Low | Medium | Medium | Medium |
| **IDE Support** | Excellent | Limited | Good | Good |
| **Streaming** | Basic | Basic | Basic | Excellent |
| **Flexibility** | High | Medium | High | High |
| **Verbosity** | Low | Low | Medium | Low |
| **Macro Complexity** | Medium | High | Low | Medium |
| **JS Backend** | Full | Full | Full | Full |
| **Debugging** | Easy | Hard | Medium | Medium |

---

## Recommendations

### Primary Recommendation: Hybrid of Approaches 1 and 4

The most idiomatic Nim API would combine:

1. **Pragmas and macros from Approach 1** - Nim developers expect `{.async.}` style pragmas
2. **UFCS-friendly design** - Enable both `api.users.get(id)` and `get(api.users, id)`
3. **Stream support from Approach 4** - For subscriptions and real-time data
4. **Concept constraints from Approach 3** - For generic programming

```nim
import capnweb

# Interface definition with rpc pragma
type
  UserService {.rpc.} = ref object

proc getUser(svc: UserService, id: int): RpcPromise[User] {.rpc.}
proc listUsers(svc: UserService): RpcPromise[seq[User]] {.rpc.}
proc streamEvents(svc: UserService): RpcStream[Event] {.rpc.}

# Clean usage
withSession("wss://api.example.com") as api:
  # Simple calls
  let user = await api.users.getUser(123)

  # Pipelining (natural, no await on intermediate)
  let name = await api.users.getUser(123).profile.name

  # Streaming
  for event in api.events.streamEvents():
    echo event.kind
    if event.kind == EventKind.Close:
      break

  # Local target with pragma
  type
    MyHandler {.target.} = ref object

  proc onEvent(h: MyHandler, event: Event) {.expose.} =
    echo "Got event: ", event

  await api.subscribe(MyHandler())
```

### Key Design Principles for Nim

1. **Pragmas over decorators** - Use `{.rpc.}`, `{.target.}`, `{.expose.}` pragmas
2. **UFCS everywhere** - Design all APIs to work with `x.f()` style
3. **Templates for zero-cost** - Use templates for inline abstractions
4. **Concepts for generics** - Enable duck-typed generic programming
5. **Result types optional** - Support both exceptions and Result[T, E]
6. **Multi-backend ready** - Same code compiles to C and JS

### Features That Would Make Nim Developers Say "Wow"

```nim
# 1. Pragma-based interface definition
type Api {.rpc.} = ref object

# 2. Natural pipelining via lazy promises
let name = await api.users[id].profile.name  # Single round trip

# 3. Template-based DSL for complex pipelines
pipeline:
  let auth = api.authenticate(token)
  (userId: auth.id, profile: api.profiles[auth.id])

# 4. Concept-constrained generic targets
proc serve[T: RpcTargetConcept](target: T) = ...

# 5. Async iterators for streaming
for msg in api.messages.stream():
  echo msg

# 6. Compile-time schema validation
static:
  assert Api is ApiSchemaConcept

# 7. Works on JS backend for browser
when defined(js):
  let api = await connect("wss://api.example.com")
```

---

## Implementation Notes

### Crate Structure

```
capnweb/
  capnweb.nim           # Main module, re-exports
  capnweb/
    session.nim         # Session management
    transport/
      websocket.nim     # WebSocket transport
      http.nim          # HTTP batch transport
      messageport.nim   # Browser MessagePort (JS)
    stub.nim            # RpcStub, RpcPromise
    target.nim          # RpcTarget pragma/macros
    pipeline.nim        # Pipelining machinery
    stream.nim          # Async iterators
    error.nim           # Error types
    macros/
      rpc.nim           # {.rpc.} pragma macro
      target.nim        # {.target.} pragma macro
      pipeline.nim      # pipeline block macro
```

### Key Types

```nim
type
  ## A session manages one RPC connection
  Session* = ref object
    transport: Transport
    imports: Table[int, Import]
    exports: Table[int, Export]
    nextImportId: int
    nextExportId: int

  ## A lazy promise that supports pipelining
  RpcPromise*[T] = ref object
    session: Session
    importId: int
    path: seq[PathElement]
    resolved: bool
    value: T
    error: ref RpcError

  ## A streaming result
  RpcStream*[T] = ref object
    promise: RpcPromise[seq[T]]
    iterator: AsyncIterator[T]

  ## Base type for RPC targets
  RpcTarget* = ref object of RootObj

  ## Error type for RPC operations
  RpcError* = object of CatchableError
    errorType*: string
    remoteStack*: string
    code*: int

# RpcPromise is awaitable
proc `await`*[T](p: RpcPromise[T]): Future[T] {.async.}

# RpcPromise supports attribute access for pipelining
proc `.`*[T](p: RpcPromise[T], name: string): RpcPromise[auto]

# RpcPromise supports call for method pipelining
proc `()`*[T](p: RpcPromise[T], args: varargs[JsonNode]): RpcPromise[auto]
```

### Transport Abstraction

```nim
type
  Transport* = ref object of RootObj

method send*(t: Transport, message: string): Future[void] {.base, async.} =
  raise newException(NotImplementedError, "send not implemented")

method receive*(t: Transport): Future[string] {.base, async.} =
  raise newException(NotImplementedError, "receive not implemented")

method close*(t: Transport): Future[void] {.base, async.} =
  raise newException(NotImplementedError, "close not implemented")

type
  WebSocketTransport* = ref object of Transport
    socket: WebSocket

  HttpBatchTransport* = ref object of Transport
    client: HttpClient
    url: string
    batch: seq[string]

  MessagePortTransport* = ref object of Transport
    port: MessagePort  # JS only
```

### Compile Targets

```nim
# Native (C backend)
when not defined(js):
  import asyncdispatch
  import websocket

  proc connect*(url: string): Future[Session] {.async.} =
    let ws = await newWebSocket(url)
    result = Session(transport: WebSocketTransport(socket: ws))

# Browser (JS backend)
when defined(js):
  import asyncjs
  import jsffi

  proc connect*(url: string): Future[Session] {.async.} =
    let ws = newWebSocket(url.cstring)
    result = Session(transport: WebSocketTransport(socket: ws))
```

---

## Open Questions

1. **Async runtime**: Support both `asyncdispatch` and `chronos`? Feature flags?

2. **JSON library**: Use `std/json` or `jsony` for better performance?

3. **Disposal mapping**: How does Nim's GC interact with RPC reference counting?

4. **Error types**: Object variants vs exception hierarchy?

5. **Streaming backpressure**: How to signal backpressure in async iterators?

6. **JS interop**: How to expose Nim targets to pure JS callers?

---

## Next Steps

1. Prototype Approach 1 (pragma-based) as the primary API
2. Add stream support from Approach 4 for subscriptions
3. Implement WebSocket transport for native and JS backends
4. Write comprehensive tests with mock server
5. Benchmark pipelining vs sequential calls
6. Publish to Nimble as `capnweb`

---

*This document is a living exploration. As implementation proceeds, specific syntax choices may evolve based on practical experience and community feedback.*
