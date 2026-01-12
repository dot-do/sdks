# Rpc.Do (F#)

[![NuGet](https://img.shields.io/nuget/v/Rpc.Do.svg)](https://www.nuget.org/packages/Rpc.Do)
[![NuGet Downloads](https://img.shields.io/nuget/dt/Rpc.Do.svg)](https://www.nuget.org/packages/Rpc.Do)

**The managed RPC layer for F# that makes any `.do` service feel like local code - with computation expressions, railway-oriented error handling, and the `?` dynamic operator.**

```fsharp
open RpcDo

// One connection. One round-trip. Zero boilerplate.
let! profile =
    rpc {
        let! auth = api?authenticate(token)
        let! user = auth?getUser()
        return! user?profile?displayName
    }
    |> Rpc.execute
```

Functional F# idioms meet capability-based RPC with promise pipelining.

---

## What is Rpc.Do?

`Rpc.Do` is the managed RPC layer for the `.do` ecosystem on F#. It sits between raw [CapnWeb.FSharp](https://www.nuget.org/packages/CapnWeb.FSharp) (the protocol) and domain-specific SDKs like `Mongo.Do`, `Database.Do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method dynamically** - `api?anything?you?want()` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Compose with F# idioms** - `rpc { }`, `asyncResult { }`, `|>` pipelines, discriminated unions

```
Your F# Code
    |
    v
+-----------+     +-----------+     +-------------+
|  Rpc.Do   | --> | CapnWeb   | --> | *.do Server |
+-----------+     +-----------+     +-------------+
    |
    +--- rpc { } computation expression
    +--- ? dynamic operator
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Railway-oriented error handling
    +--- Promise pipelining (and!)
```

---

## Rpc.Do vs CapnWeb.FSharp

| Feature | CapnWeb.FSharp | Rpc.Do |
|---------|----------------|--------|
| Protocol implementation | Yes | Uses CapnWeb |
| `rpc { }` computation expression | Yes | Yes (enhanced) |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side transformations | Yes | Yes (LINQ-style) |
| `asyncResult { }` builder | Yes | Yes (enhanced) |
| Managed proxy lifecycle | No | Yes |
| OAuth integration | No | Yes |

**Use CapnWeb.FSharp** when you're building a custom RPC server with defined interfaces and want maximum control over the protocol.

**Use Rpc.Do** when you're calling `.do` services and want managed proxies, automatic routing, and rich F# idioms.

---

## Installation

### NuGet

```bash
dotnet add package Rpc.Do
```

### Paket

```
paket add Rpc.Do
```

### With Type Provider (optional)

```bash
dotnet add package Rpc.Do.TypeProvider
```

Requires .NET 8.0+ and F# 8.0+.

---

## Quick Start

```fsharp
open RpcDo

[<EntryPoint>]
let main _ =
    async {
        // Connect and auto-dispose when done
        use! client = RpcClient.connect "wss://api.example.do"
        let api = client.Root

        // Simple call with the ? operator
        let! user = api?getUser(42) |> Rpc.execute
        printfn "Found: %s" (user?name |> Rpc.unwrap<string>)

        // Pipelined call - single round trip for the entire chain
        let! name =
            api?getUser(42)?profile?displayName
            |> Rpc.execute

        printfn "Hello, %s!" name
        return 0
    }
    |> Async.RunSynchronously
```

The `?` operator provides dynamic member access. Each chained call pipelines through unresolved promises - no intermediate network round trips until `Rpc.execute`.

---

## The `rpc { }` Computation Expression

Build complex pipelines with F#'s most powerful abstraction.

### Sequential Pipelining

```fsharp
let authenticate api credentials =
    rpc {
        let! session = api?login(credentials.Username, credentials.Password)
        let! user = session?getCurrentUser()
        let! permissions = user?getPermissions()
        return {| User = user; Permissions = permissions |}
    }
```

Every `let!` chains through the previous result. The entire pipeline executes in a single round trip.

### Parallel Branches with `and!`

The `and!` keyword (F# 6+) creates parallel branches that execute simultaneously:

```fsharp
let loadDashboard api token =
    rpc {
        let! auth = api?authenticate(token)

        // All three requests execute in parallel after auth resolves
        let! profile = auth?getProfile()
        and! notifications = auth?getNotifications(10)
        and! friends = auth?getFriends()

        return {|
            Profile = profile
            Notifications = notifications
            Friends = friends
        |}
    }
```

This compiles to `RpcPromise.parallel3` internally. The server receives a single batched request containing all three pipelined operations branching from the authentication result.

### Return vs ReturnFrom

```fsharp
rpc {
    let! user = api?getUser(42)
    return user  // Wrap a value in RpcPipeline
}

rpc {
    return! api?getUser(42)?profile?name  // Forward an RpcPromise directly
}
```

### Combining Multiple Pipelines

```fsharp
let combinedWorkflow api =
    rpc {
        // First pipeline
        let! users = api?listUsers(100)

        // Use result in second pipeline
        let! enriched =
            users
            |> Rpc.serverMap (fun u -> u?profile?displayName)

        return enriched
    }
```

---

## The `?` Dynamic Operator

F# developers expect `obj?member` for dynamic access. Rpc.Do leverages this convention:

```fsharp
// Property access
let profile = user?profile         // Returns IRpcStub

// Method call
let friends = user?getFriends()    // Returns RpcPromise<obj>

// Chained access
let name = api?getUser(42)?profile?displayName

// Multiple arguments
let result = api?search("query", 10, 0)

// Named arguments via anonymous record
let result = api?createUser({| name = "Alice"; email = "alice@example.com" |})
```

### How the Magic Proxy Works

```fsharp
let client = RpcClient.connect "wss://api.example.do" |> Async.RunSynchronously
let api = client.Root

// Every property access is recorded
api                     // IRpcStub
api?users               // IRpcStub with path ["users"]
api?users?get           // IRpcStub with path ["users", "get"]
api?users?get(123)      // RpcPromise with call ["users", "get", [123]]
```

The proxy doesn't know what methods exist on the server. It records the path and sends it when you invoke a function.

### Nested Access

Access deeply nested APIs naturally:

```fsharp
// All of these work
let! user = api?users?get(123) |> Rpc.execute
let! theme = api?users?profiles?settings?theme?get() |> Rpc.execute
let! result = api?api?v2?admin?users?deactivate(userId) |> Rpc.execute
```

### Dynamic Keys

Use the indexer for dynamic property names:

```fsharp
let tableName = "users"
let! result = api.[tableName]?find({| active = true |}) |> Rpc.execute

// Equivalent to
let! result = api?users?find({| active = true |}) |> Rpc.execute
```

---

## Promise Pipelining

The killer feature inherited from CapnWeb. Chain dependent calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response:

```fsharp
// BAD: Three round trips
let! session = api?authenticate(token) |> Rpc.execute     // Wait...
let! userId = session?getUserId() |> Rpc.execute          // Wait...
let! profile = api?getUserProfile(userId) |> Rpc.execute  // Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```fsharp
// GOOD: One round trip
let! profile =
    rpc {
        let! session = api?authenticate(token)
        let! user = session?getUser()
        return! user?profile
    }
    |> Rpc.execute
```

Or using the fluent chain:

```fsharp
// Also one round trip
let! profile =
    api?authenticate(token)?getUser()?profile
    |> Rpc.execute
```

### How Pipelining Works

1. **Recording phase**: Method calls return `RpcPromise` objects without sending anything
2. **Pipeline building**: Each `let!` or `?` extends the pipeline expression
3. **Single request**: When you `await` via `Rpc.execute`, the entire pipeline is sent
4. **Server resolution**: The server evaluates dependencies and returns results

```fsharp
// Build the pipeline (no network yet)
let auth = api?authenticate(token)
let user = auth?getUser()
let profile = user?profile
let settings = profile?settings

// Send and await (one round trip)
let! result = settings |> Rpc.execute
```

### Parallel Pipelines

Fork a pipeline to fetch multiple things at once:

```fsharp
let! dashboard =
    rpc {
        let! session = api?authenticate(token)

        // Branch into parallel requests (still one round trip!)
        let! user = session?getUser()
        and! permissions = session?getPermissions()
        and! settings = session?getSettings()

        return {| User = user; Permissions = permissions; Settings = settings |}
    }
    |> Rpc.execute
```

### Using Async.Parallel

For independent calls that don't share a pipeline root:

```fsharp
let! (users, products, orders) =
    [|
        api?getUsers() |> Rpc.execute
        api?getProducts() |> Rpc.execute
        api?getOrders() |> Rpc.execute
    |]
    |> Async.Parallel
    |> Async.map (fun arr -> arr.[0], arr.[1], arr.[2])
```

---

## Server-Side Transformations

Transform collections on the server to eliminate N+1 round trips.

### The N+1 Problem

```fsharp
// BAD: N+1 round trips
let! userIds = api?listUserIds() |> Rpc.execute  // 1 round trip
let! profiles =
    userIds
    |> Array.map (fun id -> api?getProfile(id) |> Rpc.execute)
    |> Async.Parallel  // N round trips!
```

### The Solution: Server-Side Map

```fsharp
// GOOD: 1 round trip total
let! profiles =
    api?listUserIds()
    |> Rpc.serverMap (fun id -> api?getProfile(id))
    |> Rpc.execute
```

### How serverMap Works

1. **Expression capture**: Your lambda is analyzed to build a server-side expression
2. **Pipeline extension**: The map operation extends the pipeline
3. **Server execution**: The server applies the expression to each array element
4. **Single response**: All results return in one response

```fsharp
// Generate Fibonacci numbers and square them - all server-side!
let! squared =
    api?generateFibonacci(10)
    |> Rpc.serverMap (fun x -> api?square(x))
    |> Rpc.execute

printfn "Squared Fibonacci: %A" squared
// Output: [|0; 1; 1; 4; 9; 25; 64; 169; 441; 1156|]
```

### Server-Side Filter

```fsharp
// Filter on the server - only active users cross the wire
let! activeUsers =
    api?listUsers()
    |> Rpc.serverFilter (fun u -> u?isActive)
    |> Rpc.execute
```

### Chained Transformations

```fsharp
// Get users, filter active, map to names - all server-side
let! activeNames =
    api?listUsers()
    |> Rpc.serverFilter (fun u -> u?isActive)
    |> Rpc.serverMap (fun u -> u?profile?displayName)
    |> Rpc.execute
```

### Supported Lambda Operations

```fsharp
// Property access - supported
Rpc.serverMap (fun u -> u?name)

// Method calls - supported
Rpc.serverMap (fun u -> u?toString())

// Chained access - supported
Rpc.serverMap (fun u -> u?profile?avatar?url)

// Calling captured stubs - supported
let formatter = api?getFormatter()
Rpc.serverMap (fun u -> formatter?format(u?name))
```

### What Cannot Be Serialized

```fsharp
// These will raise at runtime - no local computation in server lambdas
Rpc.serverFilter (fun u -> u?age > 18)              // Comparison operators
Rpc.serverMap (fun u -> sprintf "%s!" u?name)       // String formatting
Rpc.serverFilter (fun u -> String.IsNullOrEmpty u?name)  // Static methods
```

For complex transformations, call a server-side method:

```fsharp
let! adults = api?filterAdults(users) |> Rpc.execute
```

---

## Error Handling with Result Type

F# excels at making error paths explicit. Rpc.Do provides first-class support for railway-oriented programming.

### The `asyncResult { }` Builder

```fsharp
open RpcDo.Railway

let safeGetProfile api token =
    asyncResult {
        let! auth =
            api?authenticate(token)
            |> Rpc.tryExecute

        let! profile =
            auth?getProfile()
            |> Rpc.tryExecute

        return profile
    }

// Usage
async {
    match! safeGetProfile api myToken with
    | Ok profile -> displayProfile profile
    | Error err -> handleError err
}
```

### RpcError Discriminated Union

```fsharp
type RpcError =
    | ConnectionFailed of reason: string
    | Timeout of operation: string * elapsed: TimeSpan
    | NotFound of entity: string * id: string
    | Unauthorized of reason: string
    | Forbidden of reason: string
    | ValidationFailed of errors: ValidationError list
    | ServerError of message: string * stackTrace: string option
    | Cancelled
    | Unknown of message: string

type ValidationError = {
    Field: string
    Message: string
    Code: string option
}
```

### Active Patterns for Clean Matching

Define custom active patterns to categorize errors:

```fsharp
let (|AuthRequired|NotFound|ServerFault|Transient|Other|) = function
    | Unauthorized _ -> AuthRequired
    | Forbidden _ -> AuthRequired
    | NotFound _ -> NotFound
    | ServerError _ -> ServerFault
    | ConnectionFailed _ -> Transient
    | Timeout _ -> Transient
    | err -> Other err

let handleResult result =
    match result with
    | Ok data -> processData data
    | Error AuthRequired -> redirectToLogin()
    | Error NotFound -> showNotFoundPage()
    | Error ServerFault -> showErrorPage "Something went wrong"
    | Error Transient -> retryWithBackoff()
    | Error (Other err) -> logAndShowGenericError err
```

### Pattern Matching on Results

```fsharp
let! result = api?getUser(42) |> Rpc.tryExecute

match result with
| Ok user when user?isAdmin |> Rpc.unwrap<bool> ->
    showAdminDashboard user
| Ok user ->
    showUserDashboard user
| Error (NotFound _) ->
    showNotFoundPage()
| Error (Unauthorized reason) ->
    printfn "Auth failed: %s" reason
    redirectToLogin()
| Error (ValidationFailed errors) ->
    errors |> List.iter (fun e -> printfn "  - %s: %s" e.Field e.Message)
| Error err ->
    printfn "Unexpected error: %A" err
```

### Kleisli Composition with `>=>`

Compose fallible functions into pipelines:

```fsharp
open RpcDo.Railway

// Define small, testable functions
let authenticate token =
    api?authenticate(token) |> Rpc.tryExecute

let getProfile auth =
    auth?getProfile() |> Rpc.tryExecute

let getAvatar profile =
    profile?avatar |> Rpc.tryExecute

// Compose them - short-circuits on first error
let getAvatarForToken =
    authenticate >=> getProfile >=> getAvatar

// Use
async {
    match! getAvatarForToken myToken with
    | Ok avatar -> displayAvatar avatar
    | Error _ -> showPlaceholder()
}
```

### The `>>=` Bind Operator

```fsharp
// Monadic bind for Result
let (>>=) result f =
    match result with
    | Ok x -> f x
    | Error e -> Error e

// Usage
let! result =
    api?authenticate(token)
    |> Rpc.tryExecute
    >>= fun auth -> auth?getProfile() |> Rpc.tryExecute
    >>= fun profile -> profile?settings |> Rpc.tryExecute
```

### Recovery and Fallback

```fsharp
let getProfileWithFallback api token =
    api?authenticate(token)?getProfile()
    |> Rpc.tryExecute
    |> AsyncResult.orElse (fun _ ->
        async { return Ok Profile.Guest })

let getProfileOrDefault api token defaultProfile =
    api?authenticate(token)?getProfile()
    |> Rpc.tryExecute
    |> AsyncResult.defaultValue defaultProfile
```

### Retry with Exponential Backoff

```fsharp
let resilientCall api =
    api?expensiveOperation()
    |> Rpc.tryExecute
    |> AsyncResult.retry {
        MaxAttempts = 3
        Backoff = Exponential { BaseDelay = 100<ms>; MaxDelay = 5000<ms> }
        ShouldRetry = function
            | Timeout _ | ConnectionFailed _ -> true
            | _ -> false
    }
```

### Combining Results with `traverse`

```fsharp
// Process a list, collecting all errors or all successes
let processUsers userIds =
    userIds
    |> List.map (fun id -> api?getUser(id) |> Rpc.tryExecute)
    |> Async.Parallel
    |> Async.map Result.sequence  // Result<User list, RpcError list>
```

---

## The `RpcPromise<'T>` Type

The core abstraction enabling lazy, composable pipelines.

### Creating Promises

```fsharp
// Promises are created by calling methods on stubs
let userPromise = api?getUser(42)  // RpcPromise<obj>

// Or with explicit typing
let userPromise: RpcPromise<User> = api?getUser(42) |> Rpc.typed
```

### Chaining with Then

```fsharp
let profilePromise =
    api?getUser(42)
    |> Rpc.then' (fun user -> user?getProfile())
    |> Rpc.then' (fun profile -> profile?settings)
```

### Mapping Values

```fsharp
// Transform the result (local transformation)
let uppercaseName =
    api?getUser(42)?name
    |> Rpc.map (fun name -> name.ToUpper())

// Server-side transformation
let uppercaseName =
    api?getUser(42)
    |> Rpc.serverMap (fun u -> u?name?toUpperCase())
```

### The Pipeline Expression

You can inspect what will be sent to the server:

```fsharp
let promise =
    api?generateNumbers(10)
    |> Rpc.serverMap (fun x -> api?square(x))

printfn "%s" (Rpc.expressionString promise)
// Output: generateNumbers(10).Select(x => $root.square(x))
```

### Executing Promises

```fsharp
// Execute and await
let! result = promise |> Rpc.execute

// Execute with Result
let! result = promise |> Rpc.tryExecute

// Execute with cancellation
let! result = promise |> Rpc.executeWithCancellation cts.Token

// Execute with timeout
let! result = promise |> Rpc.executeWithTimeout (TimeSpan.FromSeconds 10.0)
```

---

## Capabilities (Object References)

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object instance.

### Receiving Capabilities

```fsharp
// Server returns a capability reference
let! counter = api?makeCounter(10) |> Rpc.execute

// counter is now a proxy to the remote Counter object
printfn "Capability ID: %d" (Rpc.capabilityId counter)

// Call methods on the capability
let! value = counter?value() |> Rpc.execute       // 10
let! newValue = counter?increment(5) |> Rpc.execute  // 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```fsharp
// Create two counters
let! counter1 = api?makeCounter(10) |> Rpc.execute
let! counter2 = api?makeCounter(20) |> Rpc.execute

// Pass counter1 to a method
let! result = api?addCounters(counter1, counter2) |> Rpc.execute
printfn "Sum: %d" result  // 30
```

### Capability Lifecycle

Capabilities are automatically serialized when passed over RPC:

```fsharp
// When you pass a capability...
let! _ = api?doSomething(counter) |> Rpc.execute

// Rpc.Do converts it to: { $ref: counter.capabilityId }
// The server knows to look up the capability by ID
```

### Scoped Capabilities

Capabilities returned from authentication enable capability-based security:

```fsharp
// Each authenticated session gets its own scoped capabilities
let! session = api?authenticate(token) |> Rpc.execute

// session.todos is a capability scoped to this user
let! myTodos = session?todos?list() |> Rpc.execute

// Cannot access other users' todos - capability determines scope
```

---

## Streaming with AsyncSeq

### Server-to-Client Streaming

```fsharp
open FSharp.Control

let subscribeToMessages api roomId =
    async {
        use! client = RpcClient.connect "wss://chat.example.do"

        // Get a stream of messages as AsyncSeq
        let! messages =
            rpc {
                let! room = client.Root?joinRoom(roomId)
                return! room?messages |> Rpc.asAsyncSeq
            }
            |> Rpc.execute

        // Process messages as they arrive
        do! messages
            |> AsyncSeq.iterAsync (fun msg ->
                async {
                    printfn "[%s] %s"
                        (msg?author |> Rpc.unwrap<string>)
                        (msg?content |> Rpc.unwrap<string>)
                })
    }
```

### Bidirectional Streaming

```fsharp
let chat api roomId =
    async {
        let! room = api?joinRoom(roomId) |> Rpc.execute

        // Send messages
        let sendMessage content =
            room?sendMessage(content)
            |> Rpc.execute
            |> Async.Ignore

        // Receive messages
        let! incomingStream =
            room?messages
            |> Rpc.asAsyncSeq
            |> Rpc.execute

        // Run send and receive concurrently
        let receiveTask =
            incomingStream
            |> AsyncSeq.iterAsync (fun msg ->
                async { printfn "< %s" (msg?content |> Rpc.unwrap<string>) })

        let sendTask =
            asyncSeq {
                while true do
                    let! line = Console.In.ReadLineAsync() |> Async.AwaitTask
                    yield line
            }
            |> AsyncSeq.iterAsync sendMessage

        do! Async.Parallel [| receiveTask; sendTask |] |> Async.Ignore
    }
```

### Server-Sent Events Pattern

```fsharp
let subscribeToNotifications api userId onNotification =
    async {
        // Create a callback target that the server can invoke
        let handler =
            RpcTarget.empty
            |> RpcTarget.method "onNotification" (fun notification ->
                async {
                    onNotification notification
                    return ()
                })

        // Pass our callback to the server
        do!
            api?notifications?subscribe(userId, handler)
            |> Rpc.execute

        // The server will now call handler.onNotification for each event
    }
```

### Converting to IObservable

```fsharp
open System

let toObservable (asyncSeq: AsyncSeq<'T>) : IObservable<'T> =
    { new IObservable<'T> with
        member _.Subscribe(observer) =
            let cts = new CancellationTokenSource()
            Async.Start(
                asyncSeq
                |> AsyncSeq.iterAsync (fun item ->
                    async { observer.OnNext(item) })
                |> Async.bind (fun () ->
                    async { observer.OnCompleted() }),
                cts.Token)
            { new IDisposable with
                member _.Dispose() = cts.Cancel() }
    }

// Usage with Rx
let! messageStream = api?room?messages |> Rpc.asAsyncSeq |> Rpc.execute

messageStream
|> toObservable
|> Observable.throttle (TimeSpan.FromMilliseconds 100.0)
|> Observable.subscribe (fun msg -> printfn "%A" msg)
|> ignore
```

---

## Connection Management

### Basic Connection

```fsharp
async {
    use! client = RpcClient.connect "wss://api.example.do"
    // Use client...
}
// Connection disposed automatically
```

### With Configuration

```fsharp
async {
    use! client =
        RpcClient.connectWith {
            Endpoint = "wss://api.example.do"
            Timeout = Some (TimeSpan.FromSeconds 30.0)
            Headers = Map.ofList [
                "Authorization", sprintf "Bearer %s" token
                "X-Request-ID", Guid.NewGuid().ToString()
            ]
            Reconnect = Some (Exponential {
                MaxRetries = 5
                BaseDelay = 1000<ms>
                MaxDelay = 30000<ms>
            })
            OnDisconnect = Some (fun reason ->
                printfn "Disconnected: %A" reason)
            OnReconnect = Some (fun attempt ->
                printfn "Reconnected (attempt %d)" attempt)
        }
    // Use client...
}
```

### HTTP Batch Transport

For serverless environments or when WebSockets are not available:

```fsharp
async {
    use! client = RpcClient.connectHttp "https://api.example.do/rpc"

    // All operations in a single rpc {} block become one HTTP POST
    let! result =
        rpc {
            let! auth = client.Root?authenticate(token)
            let! profile = auth?getProfile()
            and! settings = auth?getSettings()
            return (profile, settings)
        }
        |> Rpc.execute
}
```

HTTP batch mode is ideal for:
- Azure Functions, AWS Lambda, Cloudflare Workers
- Environments with firewall restrictions on WebSockets
- Simple request-response patterns without streaming

### Multiple Connections

```fsharp
async {
    // Connect to different services
    use! mongo = RpcClient.connect "wss://mongo.do"
    use! kafka = RpcClient.connect "wss://kafka.do"
    use! cache = RpcClient.connect "wss://cache.do"

    // Use them together
    let! users =
        mongo.Root?users?find({| active = true |})
        |> Rpc.execute

    for user in users do
        do! kafka.Root?events?publish("user.sync", user) |> Rpc.execute
        do! cache.Root?users?set(user?id, user) |> Rpc.execute
}
```

---

## Implementing RPC Targets

Expose F# functions as remote capabilities.

### Function-Based Targets

```fsharp
open RpcDo.Server

let calculator =
    RpcTarget.empty
    |> RpcTarget.method "add" (fun (a: int, b: int) ->
        async { return a + b })
    |> RpcTarget.method "multiply" (fun (a: int, b: int) ->
        async { return a * b })
    |> RpcTarget.method "divide" (fun (a: int, b: int) ->
        async {
            if b = 0 then
                return! Async.raise (DivideByZeroException())
            else
                return a / b
        })
```

### Nested Capabilities (Capability-Based Security)

Return new capabilities from method calls:

```fsharp
let createApi db =
    RpcTarget.empty
    |> RpcTarget.method "authenticate" (fun token ->
        async {
            match! validateToken db token with
            | Some user ->
                // Return a new capability scoped to this user
                return
                    RpcTarget.empty
                    |> RpcTarget.method "getProfile" (fun () ->
                        db.GetProfile user.Id)
                    |> RpcTarget.method "updateProfile" (fun updates ->
                        db.UpdateProfile user.Id updates)
                    |> RpcTarget.method "getFriends" (fun () ->
                        db.GetFriends user.Id)
            | None ->
                return! Async.raise (UnauthorizedException "Invalid token")
        })
    |> RpcTarget.method "getPublicUser" (fun userId ->
        db.GetPublicUser userId)
```

### Record-Based Targets

Define your API as a record for cleaner code:

```fsharp
type UserService = {
    GetUser: int -> Async<User>
    ListUsers: int -> int -> Async<User list>
    CreateUser: CreateUserRequest -> Async<User>
}

let userService db = {
    GetUser = fun id -> db.FindUser id
    ListUsers = fun skip take -> db.ListUsers skip take
    CreateUser = fun req -> db.CreateUser req.Name req.Email
}

let target = RpcTarget.fromRecord (userService myDb)
```

### Module-Based Targets

Expose a module as a target:

```fsharp
module Calculator =
    let add a b = async { return a + b }
    let subtract a b = async { return a - b }
    let multiply a b = async { return a * b }

let target = RpcTarget.fromModule typeof<Calculator>
```

### Accepting Connections

```fsharp
// Accept a WebSocket connection
let serve (webSocket: WebSocket) =
    async {
        use! session = RpcServer.acceptAsync webSocket myApi
        do! session.WaitForClose()
    }

// With configuration
let serveConfigured (webSocket: WebSocket) =
    rpcServer {
        target myApi
        maxConcurrentCalls 100
        callTimeout (TimeSpan.FromSeconds 30.0)
        onCall (fun method args ->
            printfn "Called: %s with %d args" method (Array.length args))
    }
    |> RpcServer.acceptWith webSocket
```

---

## Type Definitions

### Core Types

```fsharp
/// A stub representing a remote object
type IRpcStub =
    /// Access a property dynamically
    abstract member Item: string -> IRpcStub with get
    /// Call a method with arguments
    abstract member Call: string * obj array -> RpcPromise<obj>

/// A lazy promise supporting pipelining
type RpcPromise<'T> =
    /// Chain another operation (pipelines on server)
    abstract member Then: ('T -> RpcPromise<'U>) -> RpcPromise<'U>
    /// Transform the result (local)
    abstract member Map: ('T -> 'U) -> RpcPromise<'U>
    /// Get the pipeline expression string
    abstract member ExpressionString: string

/// Result type alias for RPC operations
type RpcResult<'T> = Result<'T, RpcError>
```

### The RpcPipelineBuilder

```fsharp
/// The RPC pipeline computation expression builder
type RpcPipelineBuilder() =
    member _.Bind(promise, f) = promise.Then(f)
    member _.Return(x) = RpcPromise.return' x
    member _.ReturnFrom(promise) = promise
    member _.MergeSources(p1, p2) = RpcPromise.parallel2 p1 p2
    member _.MergeSources3(p1, p2, p3) = RpcPromise.parallel3 p1 p2 p3
    member _.Zero() = RpcPromise.unit
    member _.Delay(f) = f
    member _.Run(f) = f()

/// The builder instance
let rpc = RpcPipelineBuilder()
```

### Connection Types

```fsharp
/// An RPC client session
type RpcClient =
    /// The root capability stub
    abstract member Root: IRpcStub
    /// Close the connection
    abstract member Close: unit -> Async<unit>
    /// Connection state
    abstract member IsConnected: bool
    interface IAsyncDisposable

/// Connection configuration
type ConnectionConfig = {
    Endpoint: string
    Timeout: TimeSpan option
    Headers: Map<string, string>
    Reconnect: ReconnectPolicy option
    OnDisconnect: (DisconnectReason -> unit) option
    OnReconnect: (int -> unit) option
}

type ReconnectPolicy =
    | NoReconnect
    | Exponential of ExponentialBackoff
    | Linear of linearDelay: TimeSpan * maxRetries: int

type ExponentialBackoff = {
    MaxRetries: int
    BaseDelay: int<ms>
    MaxDelay: int<ms>
}
```

---

## Discriminated Unions for Domain Modeling

F#'s discriminated unions work beautifully with Rpc.Do.

### Modeling API Responses

```fsharp
type ApiResponse<'T> =
    | Success of data: 'T
    | NotFound of message: string
    | ValidationError of errors: ValidationError list
    | ServerError of message: string

let handleResponse response =
    match response with
    | Success data -> Some data
    | NotFound msg ->
        printfn "Not found: %s" msg
        None
    | ValidationError errors ->
        errors |> List.iter (fun e -> printfn "  %s: %s" e.Field e.Message)
        None
    | ServerError msg ->
        printfn "Server error: %s" msg
        None
```

### State Machines

```fsharp
type OrderState =
    | Pending
    | Processing of startedAt: DateTime
    | Shipped of trackingNumber: string
    | Delivered of deliveredAt: DateTime
    | Cancelled of reason: string

let processOrderUpdate api orderId =
    asyncResult {
        let! order = api?orders?get(orderId) |> Rpc.tryExecute
        let state = order?state |> Rpc.unwrap<OrderState>

        match state with
        | Pending ->
            return! api?orders?startProcessing(orderId) |> Rpc.tryExecute
        | Processing _ ->
            return! api?orders?ship(orderId) |> Rpc.tryExecute
        | Shipped _ ->
            printfn "Order already shipped"
            return order
        | Delivered _ ->
            printfn "Order already delivered"
            return order
        | Cancelled reason ->
            return! Error (RpcError.ValidationFailed [
                { Field = "state"; Message = sprintf "Order cancelled: %s" reason; Code = None }
            ])
    }
```

### Option Types

```fsharp
// Handle nullable server responses
let getUserBio api userId =
    async {
        let! user = api?getUser(userId) |> Rpc.execute

        // Server may return null for bio
        let bio = user?bio |> Rpc.tryUnwrap<string>

        match bio with
        | Some b -> return b
        | None -> return "No bio provided"
    }
```

---

## Pipe Operators and Function Composition

### The `|>` Pipeline

```fsharp
// Chain transformations naturally
let! processedUsers =
    api?listUsers()
    |> Rpc.serverFilter (fun u -> u?isActive)
    |> Rpc.serverMap (fun u -> u?profile)
    |> Rpc.execute
    |> Async.map (Array.filter (fun p -> p?verified |> Rpc.unwrap<bool>))
    |> Async.map (Array.sortBy (fun p -> p?createdAt |> Rpc.unwrap<DateTime>))
```

### Custom Operators

```fsharp
// Define custom pipe operators
let (|>>) promise f = Rpc.map f promise
let (|>!) promise f = Rpc.serverMap f promise

// Usage
let! names =
    api?listUsers()
    |>! (fun u -> u?name)  // Server-side
    |>> Array.map String.toUpper  // Local
    |> Rpc.execute
```

### Function Composition

```fsharp
// Compose functions
let getUser id = api?getUser(id) |> Rpc.tryExecute
let getProfile user = user?getProfile() |> Rpc.tryExecute
let getSettings profile = profile?settings |> Rpc.tryExecute

let getUserSettings = getUser >> AsyncResult.bind getProfile >> AsyncResult.bind getSettings

// Use the composed function
let! settings = getUserSettings 42
```

---

## Resource Management

### Automatic Disposal with `use!`

```fsharp
async {
    // Client closes automatically when scope exits
    use! client = RpcClient.connect "wss://api.example.do"

    let! result = client.Root?doWork() |> Rpc.execute
    return result
}
// Client is closed here, server notified
```

### Bracket Pattern

```fsharp
let withClient endpoint f =
    async {
        use! client = RpcClient.connect endpoint
        return! f client.Root
    }

// Usage
let! result =
    withClient "wss://api.example.do" (fun api ->
        api?doSomething() |> Rpc.execute)
```

### Cancellation

```fsharp
let fetchWithTimeout api userId =
    async {
        use cts = new CancellationTokenSource()
        cts.CancelAfter(TimeSpan.FromSeconds 10.0)

        try
            let! user =
                api?getUser(userId)
                |> Rpc.executeWithCancellation cts.Token
            return Some user
        with
        | :? OperationCanceledException ->
            return None
    }
```

### Linked Cancellation

```fsharp
let processWithTimeout requestCt timeout operation =
    async {
        use timeoutCts = new CancellationTokenSource(timeout)
        use linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            requestCt, timeoutCts.Token)

        try
            return! operation linkedCts.Token
        with
        | :? OperationCanceledException when timeoutCts.IsCancellationRequested ->
            return! Async.raise (TimeoutException "Operation timed out")
    }
```

---

## Framework Integration

### Giraffe

```fsharp
open Giraffe
open RpcDo.Giraffe

let webApp =
    choose [
        route "/api/rpc" >=> rpcHandler myApi
        route "/" >=> text "Hello World"
    ]

let configureApp (app: IApplicationBuilder) =
    app.UseWebSockets()
       .UseGiraffe webApp

let configureServices (services: IServiceCollection) =
    services.AddGiraffe() |> ignore
    services.AddRpcDo(myApi) |> ignore
```

### Saturn

```fsharp
open Saturn
open RpcDo.Saturn

let app =
    application {
        use_router (router {
            get "/" (text "Hello World")
        })
        use_rpc "/api/rpc" myApi
    }

run app
```

### SAFE Stack

```fsharp
// Shared/Shared.fs
type IApi = {
    GetUsers: unit -> Async<User list>
    GetUser: int -> Async<User option>
}

// Server/Server.fs
open RpcDo.Server

let api = {
    GetUsers = fun () -> async { return! db.GetUsers() }
    GetUser = fun id -> async { return! db.GetUser id }
}

let webApp =
    choose [
        route "/api/rpc" >=> rpcHandler (RpcTarget.fromRecord api)
    ]

// Client/Client.fs (Fable)
open RpcDo.Fable

let loadUsers () =
    async {
        use! client = RpcClient.connect "wss://localhost:8080/api/rpc"
        let! users = client.Root?GetUsers() |> Rpc.execute
        return users
    }
```

### Fable (Browser)

```fsharp
open RpcDo.Fable
open Browser.Dom

let main () =
    async {
        use! client = RpcClient.connect "wss://api.example.do"

        let! name =
            client.Root?getUser(42)?profile?name
            |> Rpc.execute

        document.getElementById("result").innerText <- name
    }
    |> Async.StartImmediate
```

---

## Testing

### Mocking with FsUnit

```fsharp
open FsUnit
open NUnit.Framework
open RpcDo.Testing

[<Test>]
let ``should get user by id`` () =
    async {
        // Arrange
        let mockServer = MockServer.create()
        mockServer.On("getUser", fun args ->
            {| id = args.[0]; name = "Alice"; email = "alice@test.com" |})

        use! client = RpcClient.connectMock mockServer

        // Act
        let! user = client.Root?getUser(42) |> Rpc.execute

        // Assert
        user?name |> Rpc.unwrap<string> |> should equal "Alice"
    }
    |> Async.RunSynchronously

[<Test>]
let ``should handle pipeline`` () =
    async {
        // Arrange
        let mockServer = MockServer.create()
        mockServer.On("authenticate", fun _ ->
            {| userId = 1; token = "abc" |})
        mockServer.On("getUser", fun args ->
            {| id = args.[0]; profile = {| name = "Alice" |} |})

        use! client = RpcClient.connectMock mockServer

        // Act
        let! profile =
            rpc {
                let! auth = client.Root?authenticate("token")
                return! auth?getUser()?profile
            }
            |> Rpc.execute

        // Assert
        profile?name |> Rpc.unwrap<string> |> should equal "Alice"
    }
    |> Async.RunSynchronously
```

### Property-Based Testing with FsCheck

```fsharp
open FsCheck
open FsCheck.NUnit

[<Property>]
let ``server-side square should match local square`` (x: int) =
    async {
        use! client = RpcClient.connectMock mockServer

        let! serverResult =
            client.Root?square(x)
            |> Rpc.execute
            |> Async.map Rpc.unwrap<int>

        return serverResult = x * x
    }
    |> Async.RunSynchronously
```

### Testing Railway-Oriented Code

```fsharp
open Expecto

let tests =
    testList "Railway tests" [
        testAsync "authenticate should return error on invalid token" {
            let! result =
                api?authenticate("invalid")
                |> Rpc.tryExecute

            match result with
            | Error (Unauthorized _) -> ()
            | other -> failwithf "Expected Unauthorized, got %A" other
        }

        testAsync "composed workflow should short-circuit on error" {
            let workflow =
                authenticate "bad-token"
                >=> getProfile
                >=> getSettings

            let! result = workflow

            Expect.isError result "Should short-circuit on auth failure"
        }
    ]
```

---

## Complete Example

A comprehensive workflow demonstrating error handling, pipelining, and F# idioms:

```fsharp
#!/usr/bin/env dotnet fsi
(**
 * Complete Rpc.Do F# example: A todo application with
 * computation expressions, railway-oriented programming,
 * pipelining, and discriminated unions.
 *)

#r "nuget: Rpc.Do"

open RpcDo
open RpcDo.Railway

// ---- Domain Types ----

type User = {
    Id: int
    Name: string
    Email: string
}

type Todo = {
    Id: int
    Title: string
    Done: bool
    OwnerId: int
}

type AppError =
    | AuthenticationFailed of reason: string
    | UserNotFound of userId: int
    | TodoNotFound of todoId: int
    | PermissionDenied of action: string
    | NetworkError of RpcError

// ---- Error Mapping ----

let mapRpcError = function
    | Unauthorized reason -> AuthenticationFailed reason
    | NotFound (entity, id) when entity = "user" -> UserNotFound (int id)
    | NotFound (entity, id) when entity = "todo" -> TodoNotFound (int id)
    | err -> NetworkError err

// ---- Active Patterns ----

let (|Retriable|Fatal|) = function
    | NetworkError (ConnectionFailed _) -> Retriable
    | NetworkError (Timeout _) -> Retriable
    | err -> Fatal err

// ---- Composable Operations ----

module Api =
    let authenticate api credentials =
        api?authenticate(credentials.Username, credentials.Password)
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let getUser api auth userId =
        auth?getUser(userId)
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let getTodos api auth =
        auth?todos?list()
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let createTodo api auth title =
        auth?todos?create({| title = title |})
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let deleteTodo api auth todoId =
        asyncResult {
            let! _ =
                auth?todos?delete(todoId)
                |> Rpc.tryExecute
                |> AsyncResult.mapError mapRpcError
            return ()
        }

// ---- Workflows ----

let dashboardWorkflow api credentials =
    asyncResult {
        // Authenticate
        let! auth = Api.authenticate api credentials

        // Fetch in parallel using and!
        let! user = auth?getCurrentUser() |> Rpc.tryExecute |> AsyncResult.mapError mapRpcError
        and! todos = auth?todos?list() |> Rpc.tryExecute |> AsyncResult.mapError mapRpcError
        and! stats = auth?getStats() |> Rpc.tryExecute |> AsyncResult.mapError mapRpcError

        return {|
            User = user
            Todos = todos
            Stats = stats
        |}
    }

let createAndListTodosWorkflow api credentials title =
    asyncResult {
        let! auth = Api.authenticate api credentials

        // Create a new todo
        let! newTodo = Api.createTodo api auth title
        printfn "Created: %s (id: %d)" (newTodo?title |> Rpc.unwrap<string>) (newTodo?id |> Rpc.unwrap<int>)

        // List all todos
        let! todos = Api.getTodos api auth
        return todos
    }

// ---- Main Application ----

let main () =
    async {
        let credentials = {| Username = "admin"; Password = "secret" |}

        printfn "Connecting to Todo API...\n"

        use! client = RpcClient.connect "wss://todo.example.do"
        let api = client.Root

        // 1. Pipelined authentication (one round trip)
        printfn "1. Pipelined authentication"
        let! userResult =
            rpc {
                let! auth = api?authenticate(credentials.Username, credentials.Password)
                return! auth?getCurrentUser()
            }
            |> Rpc.tryExecute
            |> AsyncResult.mapError mapRpcError

        match userResult with
        | Ok user ->
            printfn "   Welcome, %s!\n" (user?name |> Rpc.unwrap<string>)
        | Error err ->
            printfn "   Auth failed: %A\n" err

        // 2. Server-side mapping
        printfn "2. Server-side mapping"
        let! squaredResult =
            api?generateFibonacci(8)
            |> Rpc.serverMap (fun x -> api?square(x))
            |> Rpc.tryExecute

        match squaredResult with
        | Ok squared ->
            let values = squared |> Array.map (Rpc.unwrap<int>)
            printfn "   Squared Fibonacci: [%s]\n" (String.concat ", " (values |> Array.map string))
        | Error err ->
            printfn "   Error: %A\n" err

        // 3. Railway-oriented workflow
        printfn "3. Railway-oriented workflow"
        match! dashboardWorkflow api credentials with
        | Ok dashboard ->
            printfn "   User: %s" (dashboard.User?name |> Rpc.unwrap<string>)
            printfn "   Todos: %d items" (dashboard.Todos |> Array.length)
            printfn "   Stats: %A\n" dashboard.Stats
        | Error (AuthenticationFailed reason) ->
            printfn "   Login failed: %s\n" reason
        | Error (Retriable) ->
            printfn "   Transient error, would retry...\n"
        | Error (Fatal err) ->
            printfn "   Fatal error: %A\n" err

        // 4. Error handling with pattern matching
        printfn "4. Error handling"
        let! todoResult =
            api?authenticate(credentials.Username, credentials.Password)
            |> Rpc.then' (fun auth -> auth?todos?get(99999))
            |> Rpc.tryExecute
            |> AsyncResult.mapError mapRpcError

        match todoResult with
        | Ok todo ->
            printfn "   Found: %A" todo
        | Error (TodoNotFound id) ->
            printfn "   Expected: Todo %d not found\n" id
        | Error err ->
            printfn "   Error: %A\n" err

        printfn "Done!"
        return 0
    }
    |> Async.RunSynchronously

main ()
```

---

## API Reference

### Module Exports

```fsharp
module RpcDo

// Connection
val connect: string -> Async<RpcClient>
val connectWith: ConnectionConfig -> Async<RpcClient>
val connectHttp: string -> Async<RpcClient>

// Execution
val execute: RpcPromise<'T> -> Async<'T>
val tryExecute: RpcPromise<'T> -> Async<Result<'T, RpcError>>
val executeWithCancellation: CancellationToken -> RpcPromise<'T> -> Async<'T>
val executeWithTimeout: TimeSpan -> RpcPromise<'T> -> Async<Result<'T, RpcError>>

// Transformations
val map: ('T -> 'U) -> RpcPromise<'T> -> RpcPromise<'U>
val then': ('T -> RpcPromise<'U>) -> RpcPromise<'T> -> RpcPromise<'U>
val serverMap: ('T -> RpcPromise<'U>) -> RpcPromise<'T array> -> RpcPromise<'U array>
val serverFilter: ('T -> RpcPromise<bool>) -> RpcPromise<'T array> -> RpcPromise<'T array>

// Streaming
val asAsyncSeq: RpcPromise<'T> -> RpcPromise<AsyncSeq<'T>>

// Utilities
val unwrap: obj -> 'T
val tryUnwrap: obj -> 'T option
val typed: RpcPromise<obj> -> RpcPromise<'T>
val capabilityId: obj -> int
val expressionString: RpcPromise<'T> -> string

// Builder
val rpc: RpcPipelineBuilder
```

### Railway Module

```fsharp
module RpcDo.Railway

// Computation expression
val asyncResult: AsyncResultBuilder

// Composition
val (>>=): Async<Result<'T, 'E>> -> ('T -> Async<Result<'U, 'E>>) -> Async<Result<'U, 'E>>
val (>=>): ('T -> Async<Result<'U, 'E>>) -> ('U -> Async<Result<'V, 'E>>) -> ('T -> Async<Result<'V, 'E>>)

// Utilities
val mapError: ('E1 -> 'E2) -> Async<Result<'T, 'E1>> -> Async<Result<'T, 'E2>>
val orElse: ('E -> Async<Result<'T, 'E>>) -> Async<Result<'T, 'E>> -> Async<Result<'T, 'E>>
val defaultValue: 'T -> Async<Result<'T, 'E>> -> Async<'T>
val retry: RetryConfig -> Async<Result<'T, RpcError>> -> Async<Result<'T, RpcError>>
```

### Server Module

```fsharp
module RpcDo.Server

// Target creation
val empty: RpcTarget
val method: string -> ('A -> Async<'R>) -> RpcTarget -> RpcTarget
val fromRecord: 'T -> RpcTarget
val fromModule: Type -> RpcTarget

// Server
val acceptAsync: WebSocket -> RpcTarget -> Async<RpcSession>
val acceptWith: WebSocket -> RpcServerConfig -> Async<RpcSession>
```

---

## Best Practices

### 1. Use `rpc { }` for Complex Pipelines

```fsharp
// GOOD: Clear structure, parallel branches with and!
let! result =
    rpc {
        let! auth = api?authenticate(token)
        let! user = auth?getUser()
        and! settings = auth?getSettings()
        return {| User = user; Settings = settings |}
    }
    |> Rpc.execute

// LESS IDEAL: Harder to read, no parallel branching
let! auth = api?authenticate(token) |> Rpc.execute
let! user = auth?getUser() |> Rpc.execute
let! settings = auth?getSettings() |> Rpc.execute
```

### 2. Prefer `asyncResult { }` for Error Handling

```fsharp
// GOOD: Explicit error handling, composable
let! result =
    asyncResult {
        let! auth = authenticate token
        let! user = getUser auth userId
        let! profile = getProfile user
        return profile
    }

// LESS IDEAL: Nested matches, hard to follow
let! authResult = authenticate token
match authResult with
| Error e -> Error e
| Ok auth ->
    let! userResult = getUser auth userId
    match userResult with
    | Error e -> Error e
    | Ok user -> // ...
```

### 3. Use Active Patterns for Error Classification

```fsharp
// GOOD: Semantic error handling
match error with
| Retriable -> retryWithBackoff()
| Fatal err -> logAndFail err

// LESS IDEAL: Direct type matching
match error with
| ConnectionFailed _ -> retryWithBackoff()
| Timeout _ -> retryWithBackoff()
| _ -> logAndFail error
```

### 4. Leverage Server-Side Transformations

```fsharp
// GOOD: Single round trip
let! names =
    api?listUsers()
    |> Rpc.serverFilter (fun u -> u?isActive)
    |> Rpc.serverMap (fun u -> u?name)
    |> Rpc.execute

// BAD: N+1 round trips
let! users = api?listUsers() |> Rpc.execute
let! names =
    users
    |> Array.filter (fun u -> u?isActive |> Rpc.unwrap<bool>)
    |> Array.map (fun u -> u?name |> Rpc.unwrap<string>)
```

### 5. Use Records for Domain Types

```fsharp
// GOOD: Immutable, structural equality, pattern matching
type User = {
    Id: int
    Name: string
    Profile: UserProfile option
}

// LESS IDEAL: Mutable, reference equality
type User() =
    member val Id = 0 with get, set
    member val Name = "" with get, set
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [CapnWeb.FSharp](https://nuget.org/packages/CapnWeb.FSharp) | Low-level RPC protocol |
| [Rpc.Do.TypeProvider](https://nuget.org/packages/Rpc.Do.TypeProvider) | Compile-time typed stubs |
| [Rpc.Do.Giraffe](https://nuget.org/packages/Rpc.Do.Giraffe) | Giraffe integration |
| [Rpc.Do.Saturn](https://nuget.org/packages/Rpc.Do.Saturn) | Saturn integration |
| [Rpc.Do.Fable](https://nuget.org/packages/Rpc.Do.Fable) | Browser/Fable support |
| [Mongo.Do](https://nuget.org/packages/Mongo.Do) | MongoDB client |
| [Database.Do](https://nuget.org/packages/Database.Do) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Functional F#** | Computation expressions, railway-oriented programming, immutable data |
| **Zero boilerplate** | No schemas, no codegen, `?` operator for dynamic access |
| **One round trip** | Pipelining with `let!`/`and!`, server-side map/filter |
| **Explicit errors** | `Result` types, discriminated unions, `asyncResult { }` |
| **Composition** | `>=>` Kleisli, `>>=` bind, `\|>` pipelines |
| **Type safety when needed** | TypeProvider for compile-time checking |

---

## Why This Design

### `rpc { }` Returns `RpcPipeline<'T>`, Not `Async<'T>`

The computation expression builds an unevaluated pipeline, enabling:

- **Composition before execution** - combine pipelines without triggering network calls
- **Explicit control** - you decide when the round trip happens via `Rpc.execute`
- **Efficient batching** - `and!` branches share a single round trip

### The `?` Dynamic Operator

F# developers expect `obj?member` for dynamic access. Rpc.Do provides:

- Familiar syntax matching F# conventions
- Concise chaining: `api?getUser(42)?profile?name`
- Clear visual distinction from statically-typed code

For compile-time type safety, use the TypeProvider package.

### `asyncResult { }` Over Exceptions

Railway-oriented programming makes error paths explicit:

- Errors compose naturally with `>=>` (Kleisli composition)
- Pattern matching is exhaustive - the compiler ensures you handle every case
- No hidden control flow from exceptions
- Easy to test error scenarios

### Discriminated Unions for Everything

F# discriminated unions model:

- Error types with `RpcError`
- API responses with success/failure variants
- State machines for complex workflows
- Domain events and commands

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
