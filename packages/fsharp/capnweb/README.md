# CapnWeb.FSharp

[![NuGet](https://img.shields.io/nuget/v/CapnWeb.FSharp.svg)](https://www.nuget.org/packages/CapnWeb.FSharp)

**Capability-based RPC with computation expressions, railway-oriented error handling, and the `?` dynamic operator.**

```fsharp
// One round-trip. Three pipelined operations.
let! name =
    rpc {
        let! auth = api?authenticate(token)
        let! profile = auth?getProfile()
        return! profile?displayName
    }
    |> Rpc.execute
```

F# 8+ computation expressions meet Cap'n Web promise pipelining.

---

## Installation

### NuGet

```bash
dotnet add package CapnWeb.FSharp
```

### Paket

```
paket add CapnWeb.FSharp
```

### For type-safe schemas (optional)

```bash
dotnet add package CapnWeb.FSharp.TypeProvider
```

---

## Quick Start

```fsharp
open CapnWeb

[<EntryPoint>]
let main _ =
    async {
        // Connect and auto-dispose when done
        use! session = CapnWeb.connect "wss://api.example.com"
        let api = session.Root

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

---

## The `?` Dynamic Operator

F# developers expect `obj?member` for dynamic access. CapnWeb leverages this convention:

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

### When to Use TypeProvider Instead

For compile-time type safety, use the TypeProvider package:

```fsharp
open CapnWeb.TypeProvider

type Api = CapnWebProvider<"https://api.example.com/schema.json">

async {
    use! session = CapnWeb.connect "wss://api.example.com"
    let api = session.Root :?> Api.Root

    // Full IntelliSense, compile-time checking
    let! user = api.Users.Get(42) |> Rpc.execute
    printfn "%s" user.Profile.DisplayName
}
```

---

## Error Handling with Railway-Oriented Programming

F# excels at making error paths explicit. CapnWeb provides first-class support.

### The `asyncResult { }` Builder

```fsharp
open CapnWeb.Railway

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
    | ValidationFailed of errors: ValidationError list
    | ServerError of message: string * stackTrace: string option
    | Cancelled

type ValidationError = {
    Field: string
    Message: string
    Code: string option
}
```

### Active Patterns for Clean Matching

Define custom active patterns to categorize errors:

```fsharp
let (|AuthRequired|NotFound|ServerFault|Other|) = function
    | Unauthorized _ -> AuthRequired
    | NotFound _ -> NotFound
    | ServerError _ -> ServerFault
    | err -> Other err

let handleResult result =
    match result with
    | Ok data -> processData data
    | Error AuthRequired -> redirectToLogin()
    | Error NotFound -> showNotFoundPage()
    | Error ServerFault -> showErrorPage "Something went wrong"
    | Error (Other err) -> logError err
```

### Kleisli Composition with `>=>`

Compose fallible functions into pipelines:

```fsharp
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

### Recovery and Retry

```fsharp
let getProfileWithFallback api token =
    api?authenticate(token)?getProfile()
    |> Rpc.tryExecute
    |> AsyncResult.orElse (fun _ ->
        async { return Ok Profile.Guest })

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

---

## Server-Side Transformations

Transform data on the server before it crosses the network.

### How Lambda Serialization Works

When you pass a lambda to `Rpc.serverFilter` or `Rpc.serverMap`, CapnWeb serializes it as a **remap instruction** - a small expression tree that the server evaluates. This is NOT arbitrary code execution; only property access and method calls on the input are supported.

```fsharp
let getActiveUserNames api =
    rpc {
        let! users = api?listUsers()

        // Serialized as: ["remap", importId, [], [["import", 0, ["isActive"]]]]
        // The server filters without sending inactive users over the wire
        let! active =
            users
            |> Rpc.serverFilter (fun u -> u?isActive)

        // Serialized as: ["remap", importId, [], [["import", 0, ["displayName"]]]]
        // Only names are returned, not full user objects
        let! names =
            active
            |> Rpc.serverMap (fun u -> u?displayName)

        return names
    }
```

### Supported Lambda Operations

```fsharp
// Property access
Rpc.serverMap (fun u -> u?name)

// Method calls
Rpc.serverMap (fun u -> u?toString())

// Chained access
Rpc.serverMap (fun u -> u?profile?avatar?url)

// Calling captured stubs (serialized as captures)
let formatter = api?getFormatter()
Rpc.serverMap (fun u -> formatter?format(u?name))
```

### What Cannot Be Serialized

```fsharp
// These will raise at runtime - no local computation in server lambdas
Rpc.serverFilter (fun u -> u?age > 18)              // Comparison operators
Rpc.serverMap (fun u -> sprintf "%s!" u?name)       // String interpolation
Rpc.serverFilter (fun u -> String.IsNullOrEmpty u?name)  // Static methods
```

For complex transformations, call a server-side method instead:

```fsharp
let! adults = api?filterAdults(users) |> Rpc.execute
```

---

## Streaming and Events

### Subscribing to Event Streams

```fsharp
open FSharp.Control

let subscribeToMessages api roomId =
    async {
        use! session = CapnWeb.connect "wss://api.example.com"

        // Get a stream of messages as AsyncSeq
        let! messages =
            rpc {
                let! room = session.Root?joinRoom(roomId)
                return! room?messages |> Rpc.asAsyncSeq
            }
            |> Rpc.execute

        // Process messages as they arrive
        do! messages
            |> AsyncSeq.iterAsync (fun msg ->
                async {
                    printfn "[%s] %s" (msg?author |> string) (msg?content |> string)
                })
    }
```

### Bidirectional Streaming

```fsharp
let chat api roomId =
    async {
        let! room =
            api?joinRoom(roomId)
            |> Rpc.execute

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
                async { printfn "< %s" (msg?content |> string) })

        let sendTask =
            asyncSeq {
                while true do
                    let! line = Console.In.ReadLineAsync() |> Async.AwaitTask
                    yield line
            }
            |> AsyncSeq.iterAsync sendMessage

        do! Async.Parallel [receiveTask; sendTask] |> Async.Ignore
    }
```

### Server-Sent Events Pattern

```fsharp
let subscribeToNotifications api userId onNotification =
    async {
        // Create a callback target that the server can invoke
        let handler =
            RpcTarget.empty
            |> RpcTarget.method "onNotification" (fun (notification: obj) ->
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

### Consuming Observable Streams

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
```

---

## Connection and Transport

### WebSocket (Default)

```fsharp
async {
    use! session = CapnWeb.connect "wss://api.example.com"
    // ...
}
```

### With Configuration

```fsharp
async {
    use! session =
        CapnWeb.connectWith {
            Endpoint = "wss://api.example.com"
            Timeout = Some (TimeSpan.FromSeconds 30.0)
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
    // ...
}
```

### HTTP Batch Transport

For serverless environments or when WebSockets are not available:

```fsharp
async {
    use! session =
        CapnWeb.connectHttp "https://api.example.com/rpc"

    // All operations in a single rpc {} block become one HTTP POST
    let! result =
        rpc {
            let! auth = session.Root?authenticate(token)
            let! profile = auth?getProfile()
            and! settings = auth?getSettings()
            return (profile, settings)
        }
        |> Rpc.execute

    // Each Rpc.execute triggers one HTTP request containing the full batch
}
```

HTTP batch mode is ideal for:
- AWS Lambda, Azure Functions, Cloudflare Workers
- Environments with firewall restrictions on WebSockets
- Simple request-response patterns without streaming

### MessagePort (Browser via Fable)

```fsharp
open Browser.Dom
open Fable.Core.JsInterop

let connectToWorker (worker: Worker) =
    async {
        use! session = CapnWeb.connectMessagePort worker.postMessage
        let! result = session.Root?compute(data) |> Rpc.execute
        return result
    }
```

---

## Implementing RPC Targets

Expose F# functions as remote capabilities.

### Function-Based Targets

```fsharp
open CapnWeb.Server

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

Return new capabilities from method calls - the core of capability-based security:

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
type IUserService = {
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

### Interface-Based Targets (C# Interop)

When interoperating with C# code:

```fsharp
type ICalculator =
    abstract Add: int * int -> Async<int>
    abstract Subtract: int * int -> Async<int>

[<RpcTarget>]
type Calculator() =
    interface ICalculator with
        member _.Add(a, b) = async { return a + b }
        member _.Subtract(a, b) = async { return a - b }

let target = RpcTarget.fromInterface<ICalculator>(Calculator())
```

### Accepting Connections

```fsharp
// Accept a WebSocket connection
let serve (webSocket: WebSocket) =
    async {
        use! session = CapnWeb.acceptAsync webSocket myApi
        do! session.WaitForClose()
    }

// With configuration via computation expression
let serveConfigured (webSocket: WebSocket) =
    capnwebServer {
        target myApi
        maxConcurrentCalls 100
        callTimeout (TimeSpan.FromSeconds 30.0)
        onCall (fun method args ->
            printfn "Called: %s with %d args" method (Array.length args))
    }
    |> CapnWeb.acceptWith webSocket
```

---

## Type Definitions

### Core Interfaces

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
    /// Transform the result (pipelines on server)
    abstract member Map: ('T -> 'U) -> RpcPromise<'U>
    /// Execute and await the result
    abstract member Await: unit -> Async<'T>

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
    // ... additional members for and! with more sources

/// The builder instance
let rpc = RpcPipelineBuilder()
```

### Session Types

```fsharp
/// A Cap'n Web session
type IRpcSession =
    /// The root capability stub
    abstract member Root: IRpcStub
    /// Close the session
    abstract member Close: unit -> Async<unit>
    /// IAsyncDisposable for use! binding
    interface IAsyncDisposable

/// Connection configuration
type ConnectionConfig = {
    Endpoint: string
    Timeout: TimeSpan option
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

## Resource Management

### Automatic Disposal with `use!`

```fsharp
async {
    // Session closes automatically when scope exits
    use! session = CapnWeb.connect "wss://api.example.com"

    let! result = session.Root?doWork() |> Rpc.execute
    return result
}
// Session is closed here, server notified
```

### Manual Lifecycle Control

```fsharp
let session = ref None

let connect () =
    async {
        let! s = CapnWeb.connect "wss://api.example.com"
        session := Some s
    }

let disconnect () =
    async {
        match !session with
        | Some s ->
            do! s.Close()
            session := None
        | None -> ()
    }
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

---

## Framework Integration

### Giraffe

```fsharp
open Giraffe
open CapnWeb.Giraffe

let webApp =
    choose [
        route "/api/rpc" >=> capnwebHandler myApi
        route "/" >=> text "Hello World"
    ]

let configureApp (app: IApplicationBuilder) =
    app.UseWebSockets()
       .UseGiraffe webApp

let configureServices (services: IServiceCollection) =
    services.AddGiraffe() |> ignore
    services.AddCapnWeb(myApi) |> ignore
```

### Saturn

```fsharp
open Saturn
open CapnWeb.Saturn

let app =
    application {
        use_router (router {
            get "/" (text "Hello World")
        })
        use_capnweb "/api/rpc" myApi
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
open CapnWeb.Server

let api = {
    GetUsers = fun () -> async { return! db.GetUsers() }
    GetUser = fun id -> async { return! db.GetUser id }
}

let webApp =
    choose [
        route "/api/rpc" >=> capnwebHandler (RpcTarget.fromRecord api)
    ]

// Client/Client.fs (Fable)
open CapnWeb.Fable

let loadUsers () =
    async {
        use! session = CapnWeb.connect "wss://localhost:8080/api/rpc"
        let! users = session.Root?GetUsers() |> Rpc.execute
        return users
    }
```

### Fable (Browser)

```fsharp
open CapnWeb.Fable
open Fable.Core

[<EntryPoint>]
let main _ =
    async {
        use! api = CapnWeb.connect "wss://api.example.com"

        let! user =
            api.Root?getUser(42)?profile?name
            |> Rpc.execute

        Browser.Dom.document.getElementById("result").innerText <- user
    }
    |> Async.StartImmediate
    0
```

---

## Complete Example

A workflow demonstrating error handling, pipelining, and streaming:

```fsharp
open CapnWeb
open CapnWeb.Railway
open FSharp.Control

// Domain errors
type AppError =
    | AuthenticationFailed of reason: string
    | UserNotFound of userId: int
    | PermissionDenied of action: string
    | NetworkError of RpcError

// Lift RPC errors into domain errors
let mapRpcError = function
    | Unauthorized reason -> AuthenticationFailed reason
    | NotFound (_, id) -> UserNotFound (int id)
    | err -> NetworkError err

// Composable operations
module Api =
    let authenticate api credentials =
        api?authenticate(credentials.Username, credentials.Password)
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let getUser api auth userId =
        auth?getUser(userId)
        |> Rpc.tryExecute
        |> AsyncResult.mapError mapRpcError

    let checkPermission api auth action =
        asyncResult {
            let! allowed =
                auth?hasPermission(action)
                |> Rpc.tryExecute
                |> AsyncResult.mapError mapRpcError

            if allowed then return ()
            else return! AsyncResult.error (PermissionDenied action)
        }

    let deleteUser api auth userId =
        asyncResult {
            do! checkPermission api auth "delete_user"
            let! _ =
                auth?deleteUser(userId)
                |> Rpc.tryExecute
                |> AsyncResult.mapError mapRpcError
            return ()
        }

    let subscribeToEvents api auth onEvent =
        async {
            let! eventStream =
                auth?events
                |> Rpc.asAsyncSeq
                |> Rpc.execute

            do! eventStream
                |> AsyncSeq.iterAsync (fun event ->
                    async { onEvent event })
        }

// Compose into a workflow
let deleteUserWorkflow api credentials userId =
    asyncResult {
        let! auth = Api.authenticate api credentials
        do! Api.deleteUser api auth userId
        return sprintf "User %d deleted successfully" userId
    }

// Main application
[<EntryPoint>]
let main argv =
    async {
        use! session = CapnWeb.connect "wss://api.example.com"
        let api = session.Root

        let credentials = { Username = "admin"; Password = "secret" }

        match! deleteUserWorkflow api credentials 42 with
        | Ok message ->
            printfn "%s" message
            return 0
        | Error (AuthenticationFailed reason) ->
            eprintfn "Login failed: %s" reason
            return 1
        | Error (UserNotFound id) ->
            eprintfn "User %d not found" id
            return 2
        | Error (PermissionDenied action) ->
            eprintfn "Permission denied for: %s" action
            return 3
        | Error (NetworkError err) ->
            eprintfn "Network error: %A" err
            return 4
    }
    |> Async.RunSynchronously
```

---

## Module Reference

| Module | Purpose |
|--------|---------|
| `CapnWeb` | Connection and session management |
| `CapnWeb.Railway` | `asyncResult { }` builder and error composition |
| `CapnWeb.Server` | `RpcTarget` for exposing services |
| `CapnWeb.Giraffe` | Giraffe middleware |
| `CapnWeb.Saturn` | Saturn integration |
| `CapnWeb.Fable` | Browser/Fable support |
| `CapnWeb.TypeProvider` | Compile-time typed stubs (separate package) |

---

## Why This Design

### `rpc { }` Returns `RpcPipeline<'T>`, Not `Async<'T>`

The computation expression builds an unevaluated pipeline, enabling:

- **Composition before execution** - combine pipelines without triggering network calls
- **Explicit control** - you decide when the round trip happens via `Rpc.execute`
- **Efficient batching** - `and!` branches share a single round trip

### The `?` Dynamic Operator

F# developers expect `obj?member` for dynamic access. CapnWeb provides:

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

### `IRpcStub` Interface Convention

Following .NET conventions, stub types implement the `IRpcStub` interface. This enables:

- Easier mocking in unit tests
- Interoperability with dependency injection
- Clear contract between client code and RPC infrastructure

---

## License

MIT
