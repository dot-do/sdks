# rpcdo

**Managed RPC proxies with automatic routing for Nim.**

```nim
let name = await api.users.get(42).profile.displayName
```

One line. One round-trip. Native Nim idioms.

[![nimble](https://img.shields.io/badge/nimble-rpcdo-blue.svg)](https://nimble.directory/pkg/rpcdo)

---

## What is rpcdo?

`rpcdo` is a high-level RPC client for Nim that adds **managed proxies** and **automatic routing** on top of the raw [capnweb](https://nimble.directory/pkg/capnweb) protocol. While `capnweb` gives you the wire protocol and low-level primitives, `rpcdo` gives you:

| Feature | capnweb | rpcdo |
|---------|---------|-------|
| WebSocket transport | Yes | Yes |
| Promise pipelining | Manual | Automatic |
| Magic proxy API | No | Yes |
| Stub management | Manual | Automatic |
| Server-side remap | Protocol only | Full API |
| Callback exports | Manual | Managed |
| Connection lifecycle | Manual | Automatic |
| Reconnection | No | Built-in |

Think of `rpcdo` as "what you actually want to write" versus "how the wire protocol works."

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  rpcdo   | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Magic proxy (api.users.get(id))
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining
    +--- {.rpc.} pragmas
```

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [The RpcClient](#the-rpcclient)
  - [Magic Proxy](#magic-proxy)
  - [Stubs: Remote Capabilities](#stubs-remote-capabilities)
  - [RpcPromise: Pipelining Made Easy](#rpcpromise-pipelining-made-easy)
- [Making RPC Calls](#making-rpc-calls)
  - [Simple Calls](#simple-calls)
  - [Typed Calls](#typed-calls)
  - [Calls on Stubs](#calls-on-stubs)
- [Pipelining](#pipelining)
  - [Why Pipelining Matters](#why-pipelining-matters)
  - [Building Pipelines](#building-pipelines)
  - [Pipeline Execution](#pipeline-execution)
  - [Pipeline Template](#pipeline-template)
- [Server-Side Remap Operations](#server-side-remap-operations)
  - [The N+1 Problem](#the-n1-problem)
  - [Using remap](#using-remap)
  - [Remap Expressions](#remap-expressions)
- [Bidirectional RPC](#bidirectional-rpc)
  - [Exporting Callbacks](#exporting-callbacks)
  - [Server-to-Client Calls](#server-to-client-calls)
- [Error Handling](#error-handling)
  - [Exception-Based (Default)](#exception-based-default)
  - [Result Type (Optional)](#result-type-optional)
  - [Error Types](#error-types)
- [Connection Management](#connection-management)
  - [Configuration](#configuration)
  - [Reconnection](#reconnection)
  - [Session Templates](#session-templates)
- [Streaming](#streaming)
  - [RpcStream Type](#rpcstream-type)
  - [Stream Combinators](#stream-combinators)
  - [Backpressure](#backpressure)
- [Nim-Specific Features](#nim-specific-features)
  - [Pragmas](#pragmas)
  - [Templates](#templates)
  - [Macros](#macros)
  - [UFCS](#ufcs)
  - [Concepts](#concepts)
  - [Multi-Backend Support](#multi-backend-support)
- [Advanced Patterns](#advanced-patterns)
  - [Concurrent Requests](#concurrent-requests)
  - [Request Cancellation](#request-cancellation)
  - [Typed Client Builder](#typed-client-builder)
- [Complete Examples](#complete-examples)
- [API Reference](#api-reference)
- [Protocol Reference](#protocol-reference)
- [License](#license)

---

## Installation

```bash
nimble install rpcdo
```

Or add to your `.nimble` file:

```nimble
requires "rpcdo >= 0.1.0"
```

### Dependencies

`rpcdo` depends on:
- `capnweb` - Low-level Cap'n Web protocol
- `ws` - WebSocket implementation
- `asyncdispatch` / `asyncjs` - Async runtime

---

## Quick Start

### 1. Connect to an RPC Server

```nim
import rpcdo

proc main() {.async.} =
  # Connect to the RPC endpoint
  let client = await connect("wss://api.example.com")
  defer: await client.close()

  # Make a simple RPC call
  let result = await client.call("square", %*[5])
  echo "5 squared = ", result.getInt

waitFor main()
```

### 2. Use the Magic Proxy

```nim
import rpcdo

proc main() {.async.} =
  withClient("wss://api.example.com"):
    # Magic proxy - chain property access and method calls
    let user = await api.users.get(42)
    echo "User: ", user["name"].getStr

    # Deep chaining works naturally
    let displayName = await api.users.get(42).profile.settings.displayName
    echo "Display name: ", displayName.getStr

waitFor main()
```

### 3. Work with Capabilities (Stubs)

```nim
import rpcdo

proc main() {.async.} =
  withClient("wss://api.example.com"):
    # Create a capability (stub) on the server
    let counter = await api.makeCounter(10)

    # counter is now a proxy to the remote Counter object
    let value = await counter.getValue()
    echo "Initial value: ", value.getInt

    # Call methods on the capability
    let newValue = await counter.increment(5)
    echo "After increment: ", newValue.getInt

waitFor main()
```

### 4. Use Pipelining

```nim
import rpcdo

proc main() {.async.} =
  withClient("wss://api.example.com"):
    # Build a pipeline - no network yet
    let pipeline = api.authenticate(token)
                     .getUser()
                     .profile
                     .displayName

    # Execute entire pipeline in one round-trip
    let name = await pipeline
    echo "Welcome, ", name.getStr

waitFor main()
```

---

## Core Concepts

### The RpcClient

`RpcClient` is the main entry point for all RPC operations. It manages:

- **WebSocket connection** to the server
- **Request/response correlation** via message IDs
- **Pending request tracking** with timeouts
- **Exported callbacks** for bidirectional RPC
- **Connection lifecycle** (connect, reconnect, close)

```nim
import rpcdo

# Simple connection
let client = await connect("wss://api.example.com")

# With custom configuration
let config = RpcClientConfig(
  timeout: 60.seconds,
  maxRetries: 5,
  autoReconnect: true,
  healthCheckInterval: 30.seconds
)
let client = await connect("wss://api.example.com", config)

# Using session template (recommended)
withClient("wss://api.example.com"):
  # client auto-closes on block exit
  discard
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `connect(endpoint)` | Connect with default config |
| `connect(endpoint, config)` | Connect with custom config |
| `call(method, args)` | Make raw RPC call |
| `callOn(stub, method, args)` | Call method on a stub |
| `pipeline(steps)` | Execute pipeline |
| `export(name, handler)` | Export callback for server |
| `close()` | Close connection gracefully |
| `isConnected()` | Check connection status |

### Magic Proxy

The magic proxy intercepts property access and method calls, building an expression tree that executes as a single RPC request.

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Every property access and call is recorded
  api                           # proxy
  api.users                     # proxy with path ["users"]
  api.users.get                 # proxy with path ["users", "get"]
  api.users.get(42)             # RPC call to "get" with args [42]

  # Deep chaining
  let result = await api.users.get(42).profile.settings.theme
  #                    ^---- entire path sent as single request
```

**How it works:**

1. Property access adds to the path: `api.users` -> `["users"]`
2. Method calls add with arguments: `api.users.get(42)` -> `[("users", []), ("get", [42])]`
3. `await` triggers execution of the entire path
4. Server evaluates the expression and returns the result

### Stubs: Remote Capabilities

A `Stub` represents a reference to an object on the server. When you call a method that returns a capability, you get back a stub ID that you can use for further calls.

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Create a capability on the server
  let session = await api.authenticate(token)
  # session is now a Stub

  # Check if something is a stub
  if session.isStub:
    echo "Stub ID: ", session.stubId

  # Call methods on the stub
  let user = await session.getUser()
  let permissions = await session.getPermissions()

  # Pass stubs as arguments to other calls
  await api.processSession(session)
```

**Stubs are lightweight:**

```nim
# Clone the stub reference
let session2 = session

# Both refer to the same server-side capability
asyncCheck session.ping()
asyncCheck session2.ping()
```

### RpcPromise: Pipelining Made Easy

`RpcPromise[T]` is a lazy RPC result that supports method chaining for automatic pipelining:

```nim
import rpcdo

type
  User = object
    id: int
    name: string

withClient("wss://api.example.com"):
  # RpcPromise is both awaitable and chainable
  let userPromise: RpcPromise[User] = api.users.get(42)

  # No network yet - just building the expression tree
  let namePromise = userPromise.profile.displayName

  # NOW we send everything
  let name = await namePromise
```

**The magic:** When you chain `.property` or `.method()` on an `RpcPromise`, no network request is made. The calls are accumulated into a pipeline. Only when you `.await` does the entire chain execute as a single request.

```nim
# No network yet - just building the expression tree
let promise = api
  .users
  .get(42)
  .posts
  .latest

# NOW we send one request with the entire pipeline
let post = await promise
```

---

## Making RPC Calls

### Simple Calls

The most basic way to make an RPC call:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Returns JsonNode
  let result = await client.call("echo", %*["hello"])
  echo "Echo: ", result.getStr

  # With multiple arguments
  let sum = await client.call("add", %*[1, 2, 3])
  echo "Sum: ", sum.getInt
```

### Typed Calls

When you know the return type at compile time, use generics:

```nim
import rpcdo

type
  User = object
    id: int
    name: string
    email: string

withClient("wss://api.example.com"):
  # Automatically deserialize to the target type
  let user = await client.call[:User]("getUser", %*[42])
  echo "User: ", user.name

  # Works with sequences
  let users = await client.call[:seq[User]]("listUsers", %*[])
  for u in users:
    echo "- ", u.name

  # And tables
  let counts = await client.call[:Table[string, int]]("getCounts", %*[])
```

**Type inference:**

```nim
proc getUserName(client: RpcClient, id: int): Future[string] {.async.} =
  let user = await client.call[:User]("getUser", %*[id])
  return user.name
```

### Calls on Stubs

When you have a reference to a server-side object:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Get a stub from a call
  let counter = await api.makeCounter(10)

  # Method 1: Using the magic proxy on the stub
  let value = await counter.getValue()
  echo "Value: ", value.getInt

  # Method 2: Using callOn for raw access
  let value2 = await client.callOn(counter, "getValue", %*[])
  echo "Value: ", value2.getInt

  # Method 3: Using typed callOn
  let value3 = await client.callOn[:int](counter, "getValue", %*[])
  echo "Value: ", value3
```

---

## Pipelining

### Why Pipelining Matters

Consider fetching a user's latest post title. Without pipelining:

```nim
# WITHOUT pipelining: 3 sequential round-trips
let user = await api.getUser(42)           # Round trip 1
let posts = await api.getUserPosts(user)   # Round trip 2
let title = await posts[0].getTitle()      # Round trip 3

# Total latency: 3x network round-trip time
```

With pipelining:

```nim
# WITH pipelining: 1 round-trip
let title = await api.getUser(42).posts.latest.title

# Total latency: 1x network round-trip time
```

For a 100ms network latency:
- Without pipelining: 300ms minimum
- With pipelining: 100ms minimum

**That's 3x faster**, and the difference grows with chain length.

### Building Pipelines

#### Using Method Chaining

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Build pipeline through chaining
  let result = await api
    .authenticate(token)
    .session
    .user
    .profile
    .displayName

  echo "Name: ", result.getStr
```

#### Using Explicit Pipeline

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Build pipeline explicitly
  let result = await client.pipeline(@[
    PipelineStep(call: "makeCounter", args: @[%10], alias: "counter"),
    PipelineStep(call: "increment", args: @[%5], alias: "afterInc", target: some("counter")),
    PipelineStep(call: "getValue", args: @[], alias: "final", target: some("counter"))
  ])

  echo "Counter created: ", result["counter"]
  echo "After increment: ", result["afterInc"]
  echo "Final value: ", result["final"]
```

### Pipeline Execution

When you execute a pipeline, the server:

1. Receives all steps in a single message
2. Executes step 1, stores result under its alias
3. Executes step 2, using step 1's result as target if specified
4. Continues until all steps complete
5. Returns all results in a single response

```nim
# Server receives:
{
  "type": "pipeline",
  "id": 123,
  "steps": [
    { "call": "makeCounter", "args": [10], "as": "counter" },
    { "call": "increment", "args": [5], "as": "afterInc", "target": "counter" },
    { "call": "getValue", "args": [], "as": "final", "target": "counter" }
  ]
}

# Server responds:
{
  "type": "pipeline_result",
  "id": 123,
  "results": {
    "counter": { "$stub": "stub_abc123" },
    "afterInc": 15,
    "final": 15
  }
}
```

### Pipeline Template

For cleaner pipeline building with the `{.pipeline.}` pragma:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Pipeline block - all calls batched into single request
  let result = await pipeline:
    let auth = api.authenticate(token)
    let user = auth.getUser()
    let friends = api.friends.list(user.id)
    (user: user, friends: friends)

  echo "User: ", result.user
  echo "Friends: ", result.friends
```

---

## Server-Side Remap Operations

### The N+1 Problem

A common anti-pattern in RPC systems:

```nim
# DON'T DO THIS - N+1 round trips!
let numbers = await client.call[:seq[int]]("generateFibonacci", %*[10])

var squared: seq[int] = @[]
for n in numbers:
  # Each iteration is a network round-trip!
  let sq = await client.call[:int]("square", %*[n])
  squared.add(sq)
# For 10 numbers: 11 round trips (1 + 10)
```

This is terrible for performance. If you have 100 items and 50ms latency, that's 5+ seconds just in network time.

### Using remap

The `remap` operation executes the transformation entirely on the server:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # DO THIS - 1 round trip!
  let squared = await client.callWithRemap[:seq[int]](
    "generateFibonacci",
    %*[10],
    "x => self.square(x)",
    @["$self"]
  )
  # For 10 numbers: 1 round trip, always
```

**How it works:**

1. Client sends a `remap` message with source call and expression
2. Server executes the source call to get the collection
3. Server applies the expression to each element
4. Server returns the transformed collection
5. Client receives all results in one response

### Remap Expressions

Remap expressions are evaluated on the server. The syntax is:

```
parameter => expression
```

**Simple property access:**

```nim
# Extract just the names from users
let names = await api.listUsers().remap[:seq[string]]("user => user.name")
```

**Method calls on elements:**

```nim
# Call a method on each element
let lengths = await api.listStrings().remap[:seq[int]]("s => s.length()")
```

**Using captured capabilities:**

```nim
# Use a capability reference in the expression
let calculator = await api.getCalculator()

let results = await client.callWithRemap[:seq[int]](
  "generateNumbers",
  %*[5],
  "x => $calc.square(x)",
  @[calculator.stubId]  # Capture the calculator
)
```

**With do notation:**

```nim
# Using Nim's do notation for cleaner syntax
let enriched = await api.listUserIds().remap do (id: int) -> auto:
  (id: id, profile: api.profiles.get(id), avatar: api.avatars.get(id))
```

### Remap Template

For a more natural syntax:

```nim
import rpcdo

withClient("wss://api.example.com"):
  let userIds = await api.listUserIds()

  # Using remap template
  let profiles = await userIds.remap(proc(id: int): auto =
    api.profiles.get(id)
  )

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

## Bidirectional RPC

### Exporting Callbacks

The server can call back to the client by invoking exported callbacks:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Export a callback that the server can call
  let callbackId = await client.export("onProgress", proc(args: seq[JsonNode]): JsonNode =
    let percent = args[0].getInt
    echo "Progress: ", percent, "%"
    result = newJNull()
  )

  # Pass the callback to a server method
  await client.call("startLongOperation", %*{"callbackId": callbackId})
```

**Typed callbacks with closures:**

```nim
import rpcdo

var totalProgress = 0

withClient("wss://api.example.com"):
  # Export with captured state
  await client.export("onProgress", proc(args: seq[JsonNode]): JsonNode =
    totalProgress = args[0].getInt
    result = %*{"received": true}
  )

  # Start operation
  await client.call("startLongOperation", %*[])

  echo "Final progress: ", totalProgress
```

### Server-to-Client Calls

When the server invokes an exported callback, the flow is:

1. Server sends a `callback` message with the export ID and arguments
2. Client looks up the handler in its export table
3. Client invokes the handler with the arguments
4. Client sends a `callback_result` message with the return value
5. Server receives the result

```nim
# Server sends:
{
  "type": "callback",
  "id": 456,
  "exportId": "export_1",
  "args": [50]
}

# Client handler executes, then sends:
{
  "type": "callback_result",
  "id": 456,
  "value": {"received": true}
}
```

**Real-world example - Event streaming:**

```nim
import rpcdo
import std/asyncdispatch

withClient("wss://events.example.com"):
  var events: seq[Event] = @[]

  # Export event handler
  await client.export("onEvent", proc(args: seq[JsonNode]): JsonNode =
    let event = args[0].to(Event)
    events.add(event)
    result = newJNull()
  )

  # Subscribe to events
  await client.call("subscribe", %*["user.events"])

  # Process events as they arrive
  while true:
    await sleepAsync(100)
    for event in events:
      echo "Event: ", event.kind
    events = @[]
```

---

## Error Handling

### Exception-Based (Default)

Nim's natural exception handling:

```nim
import rpcdo

withClient("wss://api.example.com"):
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
import rpcdo

withClient("wss://api.example.com"):
  let res = await api.getUser(id).toResult()

  if res.isOk:
    echo res.get().name
  else:
    echo "Error: ", res.error().msg
```

### Option Type

For operations where failure is expected:

```nim
import rpcdo

withClient("wss://api.example.com"):
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
    ## Error returned by remote server
    errorType*: string      # Remote error class name
    remoteStack*: string    # Remote stack trace (if enabled)
    code*: int              # Numeric error code
    details*: Option[JsonNode]

  ConnectionError* = object of CatchableError
    ## Network or WebSocket failure

  TimeoutError* = object of CatchableError
    ## Request exceeded timeout

  ProtocolError* = object of CatchableError
    ## Protocol violation

  NotFoundError* = object of RpcError
    ## Resource not found (404 equivalent)

  UnauthorizedError* = object of RpcError
    ## Authentication required or failed

  ForbiddenError* = object of RpcError
    ## Permission denied for this operation
```

**Pattern matching on errors:**

```nim
import rpcdo

proc handleError(e: ref Exception) =
  if e of NotFoundError:
    echo "Resource not found"
  elif e of UnauthorizedError:
    echo "Please log in"
  elif e of ForbiddenError:
    echo "Access denied"
  elif e of TimeoutError:
    echo "Request timed out"
  elif e of ConnectionError:
    echo "Connection lost"
  elif e of RpcError:
    let rpcErr = RpcError(e)
    echo "RPC error [", rpcErr.errorType, "]: ", rpcErr.msg
  else:
    echo "Unknown error: ", e.msg

withClient("wss://api.example.com"):
  try:
    let result = await api.riskyOperation()
  except CatchableError as e:
    handleError(e)
```

---

## Connection Management

### Configuration

Customize connection behavior with `RpcClientConfig`:

```nim
import rpcdo

let config = RpcClientConfig(
  timeout: 30.seconds,              # Request timeout
  maxRetries: 3,                    # Maximum retry attempts
  autoReconnect: true,              # Automatically reconnect on disconnect
  healthCheckInterval: 30.seconds,  # Health check interval (0 to disable)
  headers: {"Authorization": "Bearer token"}.toTable
)

let client = await connect("wss://api.example.com", config)
```

**Configuration presets:**

```nim
# High-latency network (satellite, intercontinental)
let highLatencyConfig = RpcClientConfig(
  timeout: 120.seconds,
  maxRetries: 5,
  autoReconnect: true,
  healthCheckInterval: 60.seconds
)

# Local development
let devConfig = RpcClientConfig(
  timeout: 5.seconds,
  maxRetries: 0,
  autoReconnect: false,
  healthCheckInterval: 0.seconds
)

# Production with aggressive health checks
let prodConfig = RpcClientConfig(
  timeout: 30.seconds,
  maxRetries: 3,
  autoReconnect: true,
  healthCheckInterval: 15.seconds
)
```

### Reconnection

When `autoReconnect` is enabled, the client will automatically attempt to reconnect on connection loss:

```nim
import rpcdo

let config = RpcClientConfig(
  autoReconnect: true,
  maxRetries: 5
)

let client = await connect("wss://api.example.com", config)

# If connection drops, pending requests will fail with ConnectionError
# but the client will attempt to reconnect in the background

# Check connection status
if not client.isConnected:
  echo "Connection lost, waiting for reconnect..."
```

**Connection callbacks:**

```nim
import rpcdo

let client = await connect("wss://api.example.com")

client.onBroken = proc(error: ref Exception) {.async.} =
  echo "Connection broken: ", error.msg

client.onReconnect = proc() {.async.} =
  echo "Reconnected"
```

### Session Templates

The recommended way to manage client lifecycle:

```nim
import rpcdo

# Session auto-closes on block exit
withClient("wss://api.example.com"):
  let result = await api.greet("World")
  echo result
```

The `withClient` template expands to:

```nim
block:
  let client = waitFor connect("wss://api.example.com")
  let api = client.proxy
  try:
    let result = await api.greet("World")
    echo result
  finally:
    waitFor client.close()
```

**With configuration:**

```nim
import rpcdo

withClient("wss://api.example.com", timeout = 60.seconds, autoReconnect = true):
  let result = await api.greet("World")
```

**HTTP Batch Mode:**

For request/response APIs without WebSocket:

```nim
import rpcdo

withBatch("https://api.example.com"):
  let a = api.foo()  # Queued
  let b = api.bar()  # Queued
  # Batch sent on block exit
  echo await a, await b
```

---

## Streaming

### RpcStream Type

Async iterators for real-time data:

```nim
import rpcdo

type
  Event = object
    kind: string
    data: string

withClient("wss://events.example.com"):
  # Get a stream
  let stream = api.events.stream()

  # Async iteration
  for event in stream:
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
import rpcdo

withClient("wss://api.example.com"):
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

### Backpressure

```nim
import rpcdo

withClient("wss://api.example.com"):
  var pending = 0
  var paused = false

  await client.export("onChunk", proc(args: seq[JsonNode]): JsonNode =
    inc pending

    # Signal backpressure if too many pending
    if pending > 100:
      paused = true
      result = %*{"pause": true}
    else:
      result = %*{"pause": false}
  )

  # Process chunks
  asyncCheck (proc() {.async.} =
    while true:
      await sleepAsync(100)
      if pending < 50 and paused:
        await client.call("resumeStream", %*[])
        paused = false
  )()
```

---

## Nim-Specific Features

### Pragmas

`rpcdo` uses pragmas to integrate seamlessly with Nim's metaprogramming:

```nim
import rpcdo

type
  # Mark types as RPC interfaces
  BlogApi {.rpc.} = ref object
  Posts {.rpc.} = ref object

  # Mark types as exportable targets
  Calculator {.target.} = ref object
    memory: float

# Mark procs as RPC methods
proc posts(api: BlogApi): RpcPromise[Posts] {.rpc.}
proc list(posts: Posts): RpcPromise[seq[Post]] {.rpc.}

# Mark methods for explicit exposure
proc add(calc: Calculator, a, b: float): float {.expose.} =
  a + b
```

| Pragma | Target | Description |
|--------|--------|-------------|
| `{.rpc.}` | type, proc | Marks type as RPC stub or proc as RPC method |
| `{.target.}` | type | Marks type as exportable RPC target |
| `{.expose.}` | proc | Explicitly exposes method on target |
| `{.pipeline.}` | block | Groups calls for single round trip |
| `{.stream.}` | proc | Marks method as returning stream |

### Templates

All abstractions expand at compile time for zero runtime overhead.

**withClient Template:**

```nim
# This template:
withClient("wss://api.example.com"):
  let user = await api.users.get(42)

# Expands to:
block:
  let client = waitFor connect("wss://api.example.com")
  let api = client.proxy
  try:
    let user = await api.users.get(42)
  finally:
    waitFor client.close()
```

**pipeline Template:**

```nim
# This template:
let result = await pipeline:
  let a = api.foo()
  let b = api.bar(a)
  b

# Expands to batched request building
```

**remap Template:**

```nim
# remap compiles to efficient expression tree
template remap*[T, R](p: RpcPromise[seq[T]], f: proc(x: T): R): RpcPromise[seq[R]] =
  p.session.buildRemap(p, f)
```

### Macros

Compile-time code generation for type-safe interfaces:

```nim
import rpcdo
import macros

# Generate typed client from interface definition
generateClient(MyApi):
  proc getUser(id: int): User
  proc listUsers(): seq[User]
  proc createUser(name, email: string): User

# Usage
let client = await connect[:MyApi]("wss://api.example.com")
let user: User = await client.getUser(42)
```

**Schema generation:**

```nim
import rpcdo

# Export interface schema at compile time
const schema = exportSchema(MyApi)
echo schema  # JSON schema for the API
```

### UFCS

Both method and function syntax work identically:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Method syntax
  let user = await api.users.get(42)

  # Function syntax (UFCS)
  let user2 = await get(users(api), 42)

  # Mixed
  let profile = await api.users.get(42).getProfile()
  let profile2 = await getProfile(get(users(api), 42))
```

### Concepts

Define what an RPC interface looks like using concepts:

```nim
import rpcdo

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

**Distinct types for type safety:**

```nim
type
  UserId = distinct int
  PostId = distinct int

proc get(svc: Users, id: UserId): RpcPromise[User] {.rpc.}
proc get(svc: Posts, id: PostId): RpcPromise[Post] {.rpc.}

# Compile error: type mismatch
# let user = await api.users.get(postId)
```

### Multi-Backend Support

Same code compiles to native and browser targets.

**Native (C Backend):**

```nim
# Compiled with: nim c myapp.nim
import rpcdo
import asyncdispatch

proc main() {.async.} =
  withClient("wss://api.example.com"):
    let data = await api.getData()

waitFor main()
```

**JavaScript Backend:**

```nim
# Compiled with: nim js myapp.nim
import rpcdo
import asyncjs

proc main() {.async.} =
  withClient("wss://api.example.com"):
    let data = await api.getData()

discard main()
```

**Browser MessagePort:**

```nim
when defined(js):
  import rpcdo/transport/messageport

  let worker = newWorker("worker.js")
  let session = await connectPort(worker.port)
```

**Backend Detection:**

```nim
when defined(js):
  # Browser-specific code
  import dom
else:
  # Native-specific code
  import os
```

---

## Advanced Patterns

### Concurrent Requests

Execute multiple independent requests concurrently:

```nim
import rpcdo
import std/asyncfutures

withClient("wss://api.example.com"):
  # Three independent requests executed concurrently
  let (users, posts, stats) = await all(
    api.listUsers(),
    api.listPosts(),
    api.getStats()
  )

  echo "Got ", users.len, " users, ", posts.len, " posts"
```

**Using asyncCheck for fire-and-forget:**

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Fire and forget - don't wait for response
  asyncCheck api.recordMetric("page_view")
  asyncCheck api.recordMetric("user_action")

  # Continue with main flow
  let data = await api.getData()
```

**Semaphore for bounded concurrency:**

```nim
import rpcdo
import std/asyncsync

withClient("wss://api.example.com"):
  let semaphore = newAsyncSemaphore(10)  # Max 10 concurrent requests
  let ids = toSeq(1..100)

  var futures: seq[Future[User]] = @[]
  for id in ids:
    futures.add((proc(id: int): Future[User] {.async.} =
      await semaphore.acquire()
      defer: semaphore.release()
      return await api.users.get(id)
    )(id))

  let results = await all(futures)
```

### Request Cancellation

Dropping a future cancels the request:

```nim
import rpcdo

withClient("wss://api.example.com"):
  # Cancel if not complete within 5 seconds
  let result = await api.slowOperation().withTimeout(5.seconds)

  if result.isNone:
    echo "Operation timed out, request canceled"
  else:
    echo "Got result: ", result.get()
```

**Manual cancellation:**

```nim
import rpcdo

withClient("wss://api.example.com"):
  var cancelled = false

  let operation = api.slowOperation()

  # Cancel after some condition
  asyncCheck (proc() {.async.} =
    await sleepAsync(2.seconds)
    if shouldCancel():
      cancelled = true
      operation.cancel()
  )()

  try:
    let result = await operation
    echo "Result: ", result
  except CancelledError:
    echo "Operation was cancelled"
```

### Typed Client Builder

Build strongly-typed clients from interface definitions:

```nim
import rpcdo

type
  MyApi = ref object
    users: UsersService
    posts: PostsService

  UsersService = ref object

  PostsService = ref object

  User = object
    id: int
    name: string

  Post = object
    id: int
    title: string

# Define the interface
proc get(svc: UsersService, id: int): Future[User] {.rpc.}
proc list(svc: UsersService): Future[seq[User]] {.rpc.}
proc get(svc: PostsService, id: int): Future[Post] {.rpc.}

# Create typed client
proc newMyApiClient(url: string): Future[TypedClient[MyApi]] {.async.} =
  let client = await connect(url)
  result = TypedClient[MyApi](
    client: client,
    stub: MyApi()
  )

# Usage
let api = await newMyApiClient("wss://api.example.com")
defer: await api.client.close()

let user: User = await api.stub.users.get(42)
let posts: seq[Post] = await api.stub.posts.list()
```

---

## Complete Examples

### Counter Service Client

```nim
## Example: Counter service demonstrating stubs and method calls.

import rpcdo
import std/asyncdispatch

proc main() {.async.} =
  withClient("wss://counter.example.com"):
    # Create a new counter with initial value 10
    let counter = await api.makeCounter(10)

    # Increment the counter
    let value1 = await counter.increment(5)
    echo "After increment(5): ", value1.getInt  # 15

    # Decrement
    let value2 = await counter.decrement(3)
    echo "After decrement(3): ", value2.getInt  # 12

    # Get current value
    let value3 = await counter.getValue()
    echo "Current value: ", value3.getInt  # 12

    # Reset to a new value
    await counter.reset(100)
    let value4 = await counter.getValue()
    echo "After reset(100): ", value4.getInt  # 100

waitFor main()
```

### Pipeline Orchestration

```nim
## Example: Complex pipeline demonstrating multi-step operations.

import rpcdo
import std/asyncdispatch

type
  Order = object
    id: int
    userId: int
    total: float

  Shipment = object
    trackingNumber: string
    carrier: string
    estimatedDelivery: string

proc main() {.async.} =
  withClient("wss://orders.example.com"):
    # Complex pipeline: create order, process payment, create shipment
    # All in a single round-trip
    let result = await client.pipeline(@[
      # Step 1: Create order
      PipelineStep(
        call: "createOrder",
        args: @[%*{
          "userId": 42,
          "items": [
            {"productId": 1, "quantity": 2},
            {"productId": 5, "quantity": 1}
          ]
        }],
        alias: "order"
      ),
      # Step 2: Process payment using order total
      PipelineStep(
        call: "processPayment",
        args: @[%*{"cardToken": "tok_visa"}],
        alias: "payment",
        target: some("order")
      ),
      # Step 3: Create shipment for the order
      PipelineStep(
        call: "createShipment",
        args: @[%*{"method": "express"}],
        alias: "shipment",
        target: some("order")
      ),
      # Step 4: Send confirmation email
      PipelineStep(
        call: "sendConfirmation",
        args: @[],
        alias: "notification",
        target: some("order")
      )
    ])

    # Parse results
    let order = result["order"].to(Order)
    let shipment = result["shipment"].to(Shipment)

    echo "Order #", order.id, " created"
    echo "Total: $", order.total
    echo "Tracking: ", shipment.trackingNumber, " via ", shipment.carrier
    echo "Estimated delivery: ", shipment.estimatedDelivery

waitFor main()
```

### Server-Side Data Transformation

```nim
## Example: Using remap operations to avoid N+1 queries.

import rpcdo
import std/asyncdispatch

type
  ProductSummary = object
    id: int
    name: string
    price: float
    inStock: bool

proc main() {.async.} =
  withClient("wss://store.example.com"):
    echo "--- N+1 Pattern (slow) ---"
    # BAD: N+1 pattern
    let productIds = await client.call[:seq[int]]("listProductIds", %*[])
    for id in productIds:
      let product = await client.call[:ProductSummary]("getProduct", %*[id])
      echo product.name, ": $", product.price

    echo ""
    echo "--- Server-side Remap (fast) ---"
    # GOOD: Server-side remap
    let products = await client.callWithRemap[:seq[ProductSummary]](
      "listProductIds",
      %*[],
      "id => self.getProduct(id)",
      @["$self"]
    )

    for product in products:
      let stockStatus = if product.inStock: "(in stock)" else: "(out of stock)"
      echo product.name, ": $", product.price, " ", stockStatus

    echo ""
    echo "--- Projected Remap ---"
    # Extract just names and prices
    let summaries = await client.callWithRemap[:seq[(string, float)]](
      "listProductIds",
      %*[],
      "id => { let p = self.getProduct(id); [p.name, p.price] }",
      @["$self"]
    )

    for (name, price) in summaries:
      echo name, ": $", price

waitFor main()
```

### Real-time Dashboard with Callbacks

```nim
## Example: Real-time metrics dashboard using bidirectional RPC.

import rpcdo
import std/asyncdispatch

type
  Metrics = object
    requestsPerSecond: float
    activeConnections: int
    errorRate: float
    p99LatencyMs: float

var currentMetrics = Metrics()

proc main() {.async.} =
  withClient("wss://metrics.example.com"):
    # Export callback for receiving metric updates
    await client.export("onMetrics", proc(args: seq[JsonNode]): JsonNode =
      currentMetrics = args[0].to(Metrics)
      result = newJNull()
    )

    # Subscribe to metrics stream
    await client.call("subscribeMetrics", %*{
      "intervalMs": 1000,
      "metrics": ["requestsPerSecond", "activeConnections", "errorRate", "p99LatencyMs"]
    })

    echo "Dashboard started. Press Ctrl+C to exit.\n"

    # Display loop
    while true:
      await sleepAsync(1000)

      # Clear screen and print dashboard
      stdout.write "\x1B[2J\x1B[1;1H"
      echo "=================================="
      echo "      REAL-TIME DASHBOARD         "
      echo "=================================="
      echo "Requests/sec:     ", currentMetrics.requestsPerSecond.formatFloat(ffDecimal, 1)
      echo "Active Conns:     ", currentMetrics.activeConnections
      echo "Error Rate:       ", (currentMetrics.errorRate * 100).formatFloat(ffDecimal, 2), "%"
      echo "P99 Latency:      ", currentMetrics.p99LatencyMs.formatFloat(ffDecimal, 1), "ms"
      echo "=================================="

waitFor main()
```

### Todo Application

A comprehensive example demonstrating all major features:

```nim
## Complete rpcdo example: A todo application with capabilities,
## pipelining, server-side remap, and error handling.

import rpcdo
import std/[asyncdispatch, os]

# ---- Type Definitions ----

type
  User = object
    id: int
    name: string
    email: string

  Todo = object
    id: int
    title: string
    done: bool
    ownerId: int

# ---- Interface Definitions ----

type
  TodoApi {.rpc.} = ref object
  AuthSession {.rpc.} = ref object
  TodoList {.rpc.} = ref object

proc authenticate(api: TodoApi, token: string): RpcPromise[AuthSession] {.rpc.}
proc square(api: TodoApi, x: int): RpcPromise[int] {.rpc.}
proc generateFibonacci(api: TodoApi, n: int): RpcPromise[seq[int]] {.rpc.}

proc me(session: AuthSession): RpcPromise[User] {.rpc.}
proc todos(session: AuthSession): RpcPromise[TodoList] {.rpc.}

proc list(todos: TodoList): RpcPromise[seq[Todo]] {.rpc.}
proc add(todos: TodoList, title: string): RpcPromise[Todo] {.rpc.}
proc complete(todos: TodoList, id: int): RpcPromise[Todo] {.rpc.}
proc delete(todos: TodoList, id: int): RpcPromise[void] {.rpc.}

# ---- Main Application ----

proc main() {.async.} =
  let token = getEnv("API_TOKEN", "demo-token")

  echo "Connecting to Todo API...\n"

  withClient("wss://todo.example.do", timeout = 30.seconds):
    try:
      # ---- Pipelined Authentication ----
      echo "1. Pipelined authentication (one round trip)"

      # These calls are pipelined - only one round trip!
      let session = api.authenticate(token)
      let userPromise = session.me()
      let todosPromise = session.todos()

      let (user, todos) = await all(userPromise, todosPromise)
      echo "   Welcome, ", user.name, "!"

      # ---- Capability Usage ----
      echo "\n2. Using capabilities"

      # todos is a capability - we can call methods on it
      let allTodos = await todos.list()
      echo "   You have ", allTodos.len, " todos"

      # Create a new todo
      let newTodo = await todos.add("Learn rpcdo")
      echo "   Created: \"", newTodo.title, "\" (id: ", newTodo.id, ")"

      # ---- Server-Side Remap ----
      echo "\n3. Server-side remap (eliminates N+1)"

      # Generate fibonacci numbers and square them - all server-side
      let fibs = await api.generateFibonacci(8)
      echo "   Fibonacci: ", fibs

      let squared = await client.callWithRemap[:seq[int]](
        "generateFibonacci",
        %*[8],
        "x => self.square(x)",
        @["$self"]
      )
      echo "   Squared:   ", squared

      # ---- Pipeline Builder ----
      echo "\n4. Complex pipeline with named results"

      let results = await client.pipeline(@[
        PipelineStep(call: "generateFibonacci", args: @[%5], alias: "fibs"),
        PipelineStep(call: "square", args: @[%7], alias: "squared")
      ])

      echo "   Fibs: ", results["fibs"]
      echo "   Squared: ", results["squared"]

      # ---- Error Handling ----
      echo "\n5. Error handling"

      try:
        await todos.delete(99999)
      except RpcError as e:
        echo "   Expected error: ", e.code, " - ", e.msg

      # ---- Cleanup ----
      echo "\n6. Cleanup"

      await todos.delete(newTodo.id)
      echo "   Deleted todo ", newTodo.id

      echo "\nDone!"

    except UnauthorizedError:
      echo "Authentication failed - check your API token"
    except ConnectionError as e:
      echo "Connection error: ", e.msg
    except RpcError as e:
      echo "RPC error: ", e.msg

waitFor main()
```

### Robust Client with Retry Logic

```nim
## Example: Production-grade client with retry and error handling.

import rpcdo
import std/[asyncdispatch, times]

type
  RobustClient = ref object
    client: RpcClient
    maxRetries: int
    retryDelay: Duration

proc connect(url: string): Future[RobustClient] {.async.} =
  let config = RpcClientConfig(
    timeout: 30.seconds,
    maxRetries: 3,
    autoReconnect: true,
    healthCheckInterval: 15.seconds
  )

  let client = await rpcdo.connect(url, config)

  result = RobustClient(
    client: client,
    maxRetries: 3,
    retryDelay: 500.milliseconds
  )

proc callWithRetry[T](self: RobustClient, methodName: string, args: JsonNode): Future[T] {.async.} =
  var lastError: ref Exception = nil

  for attempt in 0..self.maxRetries:
    if attempt > 0:
      # Exponential backoff
      let delay = self.retryDelay * (1 shl (attempt - 1))
      await sleepAsync(delay.inMilliseconds.int)

      # Check connection
      if not self.client.isConnected:
        echo "Connection lost, waiting for reconnect..."
        await sleepAsync(1000)

    try:
      return await self.client.call[:T](methodName, args)
    except NotFoundError, UnauthorizedError, ForbiddenError:
      # Don't retry these errors
      raise
    except TimeoutError, ConnectionError as e:
      echo "Attempt ", attempt + 1, " failed: ", e.msg, ", retrying..."
      lastError = e
    except Exception as e:
      lastError = e

  if lastError != nil:
    raise lastError
  else:
    raise newException(RpcError, "Unknown error")

proc main() {.async.} =
  let client = await connect("wss://api.example.com")
  defer: await client.client.close()

  # Calls will automatically retry on transient errors
  let user = await client.callWithRetry[:JsonNode]("getUser", %*[42])
  echo "User: ", user

waitFor main()
```

---

## API Reference

### Module: `rpcdo`

Main module - re-exports everything you need:

```nim
import rpcdo

# Includes:
# - connect, RpcClient, RpcClientConfig
# - RpcPromise, RpcStream
# - RpcError, ConnectionError, TimeoutError
# - withClient, pipeline templates
# - remap, all, typed helpers
```

### Module: `rpcdo/client`

| Type | Description |
|------|-------------|
| `RpcClient` | Main client for making RPC calls |
| `RpcClientConfig` | Configuration options |
| `PipelineStep` | A step in a pipeline call |
| `connect(endpoint)` | Connect with default config |
| `connect(endpoint, config)` | Connect with custom config |

### Module: `rpcdo/proxy`

| Type | Description |
|------|-------------|
| `MagicProxy` | Intercepts property access and method calls |
| `Stub` | Reference to a remote capability |
| `isStub` | Check if a value is a stub reference |
| `stubId` | Get the stub ID from a stub |

### Module: `rpcdo/promise`

| Type | Description |
|------|-------------|
| `RpcPromise[T]` | Lazy RPC result with pipelining support |
| `toResult()` | Convert to Result type |
| `toOption()` | Convert to Option type |
| `withTimeout(duration)` | Add timeout to promise |

### Module: `rpcdo/stream`

| Type | Description |
|------|-------------|
| `RpcStream[T]` | Async iterator for streaming data |
| `filter(predicate)` | Filter stream elements |
| `map(transform)` | Transform stream elements |
| `toSeq()` | Collect stream to sequence |
| `window(size)` | Window operations |

### Module: `rpcdo/error`

| Type | Description |
|------|-------------|
| `RpcError` | Base RPC error type |
| `ConnectionError` | Network/connection errors |
| `TimeoutError` | Request timeout |
| `ProtocolError` | Protocol violations |
| `NotFoundError` | Resource not found |
| `UnauthorizedError` | Authentication failed |
| `ForbiddenError` | Permission denied |

### Module: `rpcdo/templates`

| Template | Description |
|----------|-------------|
| `withClient` | Scoped session management |
| `withBatch` | HTTP batch mode |
| `pipeline` | Build pipelined requests |

---

## Protocol Reference

`rpcdo` implements the Cap'n Web protocol over WebSocket. Key message types:

### Call Message

```json
{
  "type": "call",
  "id": 123,
  "method": "methodName",
  "args": ["arg1", "arg2"],
  "target": "stub_id"
}
```

### Pipeline Message

```json
{
  "type": "pipeline",
  "id": 123,
  "steps": [
    { "call": "method1", "args": [], "as": "alias1" },
    { "call": "method2", "args": [], "as": "alias2", "target": "alias1" }
  ]
}
```

### Remap Message

```json
{
  "type": "remap",
  "id": 123,
  "sourceCall": "listItems",
  "sourceArgs": [],
  "expression": "x => x.transform()",
  "captures": ["$self"]
}
```

### Result Message

```json
{
  "type": "result",
  "id": 123,
  "value": { "data": "..." }
}
```

### Error Message

```json
{
  "type": "error",
  "id": 123,
  "errorType": "NotFound",
  "message": "Resource not found",
  "code": 404
}
```

### Export Message

```json
{
  "type": "export",
  "id": "export_1",
  "name": "onProgress"
}
```

### Callback Message

```json
{
  "type": "callback",
  "id": 456,
  "exportId": "export_1",
  "args": [50]
}
```

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

## Key Differences from capnweb

| Feature | capnweb | rpcdo |
|---------|---------|-------|
| API style | Low-level | High-level |
| Proxy | Manual | Magic proxy |
| Pipelining | Manual building | Automatic chaining |
| Connection | Manual lifecycle | Managed with templates |
| Remap | Protocol encoding | Clean API |
| Error handling | Basic | Rich type hierarchy |
| Reconnection | Manual | Automatic |

**Use capnweb** when you need full control over the protocol or are building a server.

**Use rpcdo** when you're a client calling `.do` services and want maximum ergonomics.

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Nim idioms first** | Pragmas, templates, UFCS, concepts |
| **Zero-cost abstractions** | Templates expand at compile time |
| **One round trip** | Pipelining by default |
| **Type safety** | Generics and concepts |
| **Multi-backend** | Same code for native and JS |
| **Ergonomic errors** | Rich exception hierarchy |

---

## Security Considerations

### Remote Stack Traces

By default, remote stack traces are redacted. Enable only in development:

```nim
let config = RpcClientConfig(
  exposeStacks: true  # Development only!
)
let client = await connect("wss://api.example.com", config)
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
type
  TodoService {.target.} = ref object

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

---

## See Also

- [capnweb](https://nimble.directory/pkg/capnweb) - Low-level Cap'n Web protocol for Nim
- [rpc.do](https://rpc.do) - Official documentation
- [Cap'n Web Specification](https://capnweb.org) - Protocol specification
