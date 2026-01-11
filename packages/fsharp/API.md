# CapnWeb F# API Design

*A beautiful F# client for Cap'n Web RPC - designed to feel native to the language.*

---

## Design Principles

This API is built on three pillars that make F# code elegant:

1. **Computation Expressions** - The `rpc { }` builder for complex pipelines with `let!` and `and!`
2. **Pipe Operators** - Left-to-right composition with `|>` for readable data flow
3. **Railway-Oriented Programming** - `Result<'T, RpcError>` with `asyncResult { }` for graceful error handling

The result is an API where pipelining feels as natural as writing any other F# code.

---

## Quick Start

```fsharp
open CapnWeb
open CapnWeb.Operators

// Connect to a Cap'n Web server
let session = CapnWeb.connect "wss://api.example.com" |> Async.RunSynchronously
let api = session.Root

// Make a pipelined call - three operations, one round trip
let getUserProfile userId =
    rpc {
        let! user = api?getUser(userId)
        let! profile = user?profile
        return profile
    }
    |> Rpc.execute
```

---

## Core API

### Connection

```fsharp
open CapnWeb

// Simple connection
let session =
    CapnWeb.connect "wss://api.example.com"
    |> Async.RunSynchronously

// Configured connection using the builder
let session =
    capnweb {
        endpoint "wss://api.example.com"
        timeout (TimeSpan.FromSeconds 30.0)
        reconnect (Exponential { maxRetries = 5; baseDelay = 100<ms> })
        onDisconnect (fun reason -> printfn "Disconnected: %A" reason)
        onReconnect (fun attempt -> printfn "Reconnecting... attempt %d" attempt)
    }
    |> Async.RunSynchronously

// Async workflow integration with automatic disposal
async {
    use! session = CapnWeb.connectAsync "wss://api.example.com"
    let api = session.Root
    // ... use api
} |> Async.RunSynchronously
```

### The Root Stub

```fsharp
// Get the root capability
let api = session.Root

// The stub supports dynamic member access via the ? operator
api?methodName(arg1, arg2)    // Call a method
api?propertyName              // Access a property
```

---

## The `rpc { }` Computation Expression

The heart of the API. Build pipelined RPC calls that execute in a single round trip.

### Basic Usage

```fsharp
// Sequential pipelining with let!
let getName api token =
    rpc {
        let! auth = api?authenticate(token)     // Step 1
        let! profile = auth?getProfile()         // Step 2 (pipelined)
        let! name = profile?displayName          // Step 3 (pipelined)
        return name                              // Single round trip!
    }

// Execute the pipeline
async {
    let! name = getName api myToken |> Rpc.execute
    printfn "Hello, %s!" name
}
```

### Parallel Branches with `and!`

```fsharp
// Parallel execution - profile and friends load simultaneously
let getProfileWithFriends api token =
    rpc {
        let! auth = api?authenticate(token)

        let! profile = auth?getProfile()
        and! friends = auth?getFriends()         // Parallel branch!
        and! settings = auth?getSettings()       // Another parallel branch!

        return {|
            Profile = profile
            Friends = friends
            Settings = settings
        |}
    }
```

### Server-Side Transformations

```fsharp
// Map executes on the server - data never leaves until final result
let getFriendNames api token =
    rpc {
        let! auth = api?authenticate(token)
        let! friendIds = auth?getFriendIds()

        // This map runs on the server, not locally
        let! names =
            friendIds
            |> Rpc.serverMap (fun id -> api?getUser(id)?name)

        return names
    }

// Filter on the server
let getActiveFriends api token =
    rpc {
        let! auth = api?authenticate(token)
        let! friends = auth?getFriends()

        let! active =
            friends
            |> Rpc.serverFilter (fun f -> f?isActive)

        return active
    }
```

### Conditional Pipelining

```fsharp
let getProfileOrDefault api userId =
    rpc {
        let! user = api?getUser(userId)
        let! hasProfile = user?hasProfile

        if hasProfile then
            return! user?profile
        else
            return Profile.Default
    }
```

---

## Pipe Operators

For simple, linear operations, pipe operators provide a clean alternative.

```fsharp
open CapnWeb.Operators

// Custom operators for RPC pipelining
// |>>  method call
// |>.  property access
// |>!  execute and await

// Linear pipeline with operators
let getUserName api userId =
    api
    |>> ("getUser", [| userId |])
    |>. "profile"
    |>. "displayName"
    |>! Async.RunSynchronously

// Shorthand property chain
let getEmail api userId =
    api?getUser(userId)?profile?email
    |> Rpc.execute

// Mix pipes with computation expressions
let workflow api =
    api?authenticate(token)
    |> Rpc.andThen (fun auth ->
        rpc {
            let! profile = auth?getProfile()
            and! friends = auth?getFriends()
            return (profile, friends)
        })
    |> Rpc.execute
```

### Operator Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `\|>>` | Method call | `api \|>> ("method", [args])` |
| `\|>.` | Property access | `stub \|>. "property"` |
| `\|>!` | Execute pipeline | `pipeline \|>!` |
| `?>` | Optional chain | `stub ?> "maybeProperty"` |

---

## Railway-Oriented Error Handling

Errors flow through the railway without exceptions. Compose fallible operations elegantly.

### The `asyncResult { }` Builder

```fsharp
open CapnWeb.Railway

// Compose operations that might fail
let safeGetProfile api token =
    asyncResult {
        let! auth = api?authenticate(token) |> Rpc.tryExecute
        let! profile = auth?getProfile() |> Rpc.tryExecute
        let! avatar = profile?avatar |> Rpc.tryExecute
        return (profile, avatar)
    }

// Usage
async {
    match! safeGetProfile api myToken with
    | Ok (profile, avatar) ->
        displayProfile profile avatar
    | Error err ->
        handleError err
}
```

### Error Types

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

### Active Patterns for Matching

```fsharp
// Built-in active patterns for common error scenarios
let (|Auth|NotFound|Server|Other|) error =
    match error with
    | Unauthorized _ -> Auth error
    | NotFound _ -> NotFound error
    | ServerError _ -> Server error
    | _ -> Other error

// Clean error handling
let handleResult result =
    match result with
    | Ok data ->
        processData data
    | Error (Auth err) ->
        redirectToLogin err
    | Error (NotFound (entity, id)) ->
        showNotFoundPage entity id
    | Error (Server err) ->
        logAndDisplayError err
    | Error (Other err) ->
        genericErrorHandler err
```

### Kleisli Composition

```fsharp
// The fish operator >=> for composing Result-returning functions
let (>=>) f g x =
    asyncResult {
        let! y = f x
        return! g y
    }

// Build pipelines from smaller functions
let authenticate token = api?authenticate(token) |> Rpc.tryExecute
let getProfile auth = auth?getProfile() |> Rpc.tryExecute
let getAvatar profile = profile?avatar |> Rpc.tryExecute

let workflow =
    authenticate
    >=> getProfile
    >=> getAvatar

// Execute
async {
    match! workflow myToken with
    | Ok avatar -> displayAvatar avatar
    | Error err -> handleError err
}
```

### Recovery and Fallback

```fsharp
// Provide fallbacks for failures
let getProfileWithFallback api token =
    asyncResult {
        let! profile =
            api?authenticate(token)?getProfile()
            |> Rpc.tryExecute
            |> AsyncResult.orElse (fun _ ->
                async { return Ok Profile.Guest })

        return profile
    }

// Retry with backoff
let resilientCall api =
    api?expensiveOperation()
    |> Rpc.tryExecute
    |> AsyncResult.retry {
        maxAttempts = 3
        backoff = Exponential { baseDelay = 100<ms>; maxDelay = 5000<ms> }
        shouldRetry = function
            | Timeout _ -> true
            | ConnectionFailed _ -> true
            | _ -> false
    }
```

---

## Exposing Local Services

Serve F# functions as RPC targets.

### Function-Based Targets

```fsharp
open CapnWeb.Server

// Build a target from functions using pipes
let myApi =
    RpcTarget.empty
    |> RpcTarget.method "greet" (fun name ->
        async { return sprintf "Hello, %s!" name })
    |> RpcTarget.method "add" (fun (a: int, b: int) ->
        async { return a + b })
    |> RpcTarget.asyncMethod "getUser" (fun id ->
        db.FindUser id)

// Nested capabilities
let myApi =
    RpcTarget.empty
    |> RpcTarget.method "authenticate" (fun token ->
        async {
            let! user = validateToken token
            return
                RpcTarget.empty
                |> RpcTarget.method "getProfile" (fun () ->
                    db.GetProfile user.Id)
                |> RpcTarget.method "updateBio" (fun bio ->
                    db.UpdateBio user.Id bio)
        })
```

### Record-Based Targets

```fsharp
// Define capabilities as records
type UserApi = {
    GetUser: int -> Async<User>
    ListUsers: int -> int -> Async<User list>
    CreateUser: CreateUserRequest -> Async<User>
}

let userApi db = {
    GetUser = db.FindUser
    ListUsers = fun skip take -> db.ListUsers skip take
    CreateUser = fun req -> db.CreateUser req.Name req.Email
}

// Expose as RPC target
let target = RpcTarget.fromRecord (userApi myDb)
```

### Interface-Based Targets (for C# interop)

```fsharp
type ICalculator =
    abstract Add: int * int -> Async<int>
    abstract Multiply: int * int -> Async<int>

[<RpcTarget>]
type Calculator() =
    interface ICalculator with
        member _.Add(a, b) = async { return a + b }
        member _.Multiply(a, b) = async { return a * b }

let target = RpcTarget.fromInterface<ICalculator>(Calculator())
```

### Accepting Connections

```fsharp
// Accept incoming connection with your target
let serve webSocket =
    async {
        use! session = CapnWeb.acceptAsync webSocket myApi
        do! session.WaitForClose()
    }

// With configuration
let serve webSocket =
    capnwebServer {
        target myApi
        maxConcurrentCalls 100
        callTimeout (TimeSpan.FromSeconds 30.0)
        onCall (fun method -> printfn "Called: %s" method)
    }
    |> CapnWeb.acceptWith webSocket
```

---

## Type Provider (Optional)

For schemas known at compile time, gain full type safety and IDE support.

```fsharp
open CapnWeb.TypeProvider

// Reference a schema file
type Api = CapnWebProvider<"schema.capnweb">

// Or define inline
type Api = CapnWebProvider<"""
    interface Api {
        authenticate(token: string): AuthedApi
        getPublicUser(id: int): User
    }

    interface AuthedApi {
        getProfile(): Profile
        updateProfile(name: string, bio: string): Profile
        getFriends(): User[]
    }

    type User = { id: int; name: string; email: string }
    type Profile = { user: User; bio: string; avatar: string }
""">

// Fully typed API calls
async {
    use! session = Api.Connect("wss://api.example.com")

    // IDE autocomplete and type checking work!
    let! auth = session.Root.Authenticate(myToken)
    let! profile = auth.GetProfile()   // profile: Api.Profile

    printfn "Welcome, %s!" profile.User.Name
}

// Pipelining still works
let getName session token =
    session.Root
        .Authenticate(token)
        .GetProfile()
        .User
        .Name
    |> Rpc.execute   // Single round trip, fully typed
```

---

## Streaming

Handle server-sent events and streaming responses.

```fsharp
// AsyncSeq for streaming (F# idiomatic)
let streamMessages api roomId =
    rpc {
        let! room = api?joinRoom(roomId)
        return! room?messages |> Rpc.asAsyncSeq
    }

// Consume the stream
async {
    let! messages = streamMessages api "general"

    do! messages
        |> AsyncSeq.iter (fun msg ->
            printfn "[%s] %s" msg.Author msg.Content)
}

// IAsyncEnumerable for C# interop
let streamForCSharp api roomId =
    rpc {
        let! room = api?joinRoom(roomId)
        return! room?messages |> Rpc.asAsyncEnumerable
    }
```

---

## Cancellation

All operations support cooperative cancellation.

```fsharp
// Using CancellationToken
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

// Computation expression with built-in timeout
let fetchWithBuiltinTimeout api userId =
    rpc {
        timeout (TimeSpan.FromSeconds 10.0)

        let! user = api?getUser(userId)
        return user
    }
    |> Rpc.execute
```

---

## Complete Example

A real-world workflow combining all features.

```fsharp
open CapnWeb
open CapnWeb.Operators
open CapnWeb.Railway

/// Fetch a user's dashboard data with full error handling
let loadDashboard api token =
    asyncResult {
        // Authenticate
        let! auth =
            api?authenticate(token)
            |> Rpc.tryExecute

        // Load dashboard data in parallel
        let! dashboardData =
            rpc {
                let! profile = auth?getProfile()
                and! notifications = auth?getNotifications(10)
                and! recentActivity = auth?getRecentActivity(20)
                and! friends = auth?getFriends()

                // Server-side transformation
                let! friendsOnline =
                    friends
                    |> Rpc.serverFilter (fun f -> f?isOnline)

                return {|
                    Profile = profile
                    Notifications = notifications
                    RecentActivity = recentActivity
                    FriendsOnline = friendsOnline
                |}
            }
            |> Rpc.tryExecute

        return dashboardData
    }

/// Handle the result with pattern matching
let showDashboard api token =
    async {
        match! loadDashboard api token with
        | Ok data ->
            printfn "Welcome back, %s!" data.Profile?displayName
            printfn "You have %d notifications" (data.Notifications |> Seq.length)
            printfn "%d friends online" (data.FriendsOnline |> Seq.length)

        | Error (Unauthorized reason) ->
            printfn "Session expired: %s" reason
            redirectToLogin()

        | Error (Timeout (op, elapsed)) ->
            printfn "Request timed out after %A" elapsed
            showRetryButton()

        | Error err ->
            printfn "Error loading dashboard: %A" err
            showErrorPage err
    }

/// Server-side implementation
let dashboardApi db =
    RpcTarget.empty
    |> RpcTarget.method "authenticate" (fun token ->
        asyncResult {
            let! user = validateToken db token
            return
                RpcTarget.empty
                |> RpcTarget.method "getProfile" (fun () ->
                    db.GetProfile user.Id)
                |> RpcTarget.method "getNotifications" (fun count ->
                    db.GetNotifications user.Id count)
                |> RpcTarget.method "getRecentActivity" (fun count ->
                    db.GetActivity user.Id count)
                |> RpcTarget.method "getFriends" (fun () ->
                    db.GetFriends user.Id)
        })
```

---

## Module Reference

| Module | Purpose |
|--------|---------|
| `CapnWeb` | Connection and session management |
| `CapnWeb.Operators` | Pipe operators (`\|>>`, `\|>.`, etc.) |
| `CapnWeb.Railway` | `asyncResult { }` and error handling |
| `CapnWeb.Server` | `RpcTarget` for exposing services |
| `CapnWeb.TypeProvider` | Compile-time typed stubs |

---

## Design Decisions

### Why `rpc { }` returns `RpcPipeline<'T>` not `Async<'T>`

The computation expression returns an unevaluated pipeline, enabling:
- Further composition before execution
- Explicit control over when network calls happen
- Combining multiple pipelines efficiently

Execute with `|> Rpc.execute` when ready.

### Why the `?` dynamic operator

F# developers expect `api?method(args)` for dynamic member access. It provides:
- Familiar syntax for F# developers
- Concise call chains: `api?getUser(42)?profile?name`
- Clear visual distinction from typed calls

For type safety, use the Type Provider.

### Why `asyncResult { }` over exceptions

Railway-oriented programming:
- Makes error paths explicit and composable
- Enables `>=>` Kleisli composition
- Pattern matching is exhaustive and compiler-checked
- No hidden control flow

---

## Installation

```bash
dotnet add package CapnWeb.FSharp
dotnet add package CapnWeb.FSharp.TypeProvider  # Optional
```

---

*This is Cap'n Web for F# - where pipelining meets the pipe operator.*
