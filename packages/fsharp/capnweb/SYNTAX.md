# Cap'n Web F# Client: Syntax Exploration

This document explores four divergent approaches to designing an idiomatic F# client for Cap'n Web RPC (`CapnWeb` on NuGet). Each approach optimizes for different trade-offs between functional purity, type safety, ergonomics, and interoperability with the .NET ecosystem.

---

## Background: What Makes F# Unique

F# brings distinctive features that shape API design:

- **Computation Expressions**: Custom DSLs for async, result handling, and more
- **Pipe Operator (`|>`)**: Left-to-right composition for readable data flow
- **Discriminated Unions**: Algebraic data types with exhaustive pattern matching
- **Type Providers**: Compile-time types from external schemas
- **Active Patterns**: Custom pattern matching decompositions
- **Currying & Partial Application**: Functions compose naturally
- **Railway-Oriented Programming**: `Result<'T, 'E>` for error handling without exceptions
- **Immutability by Default**: Encourages pure functional style

The challenge: Cap'n Web's pipelining model (chaining calls through unresolved promises) must feel natural in F#'s functional paradigm while remaining practical for real-world async I/O.

---

## Approach 1: Computation Expression Pipeline Builder

**Philosophy**: Leverage F#'s most powerful abstraction - computation expressions - to create a domain-specific language for RPC pipelines. This feels like writing natural F# while the CE handles pipelining mechanics.

### Connection/Session Creation

```fsharp
open CapnWeb

// Simple connection with async workflow
let session =
    CapnWeb.connect "wss://api.example.com"
    |> Async.RunSynchronously

// Builder pattern for configuration
let session =
    capnweb {
        endpoint "wss://api.example.com"
        timeout (TimeSpan.FromSeconds 30.0)
        reconnect { maxRetries 3; backoff Exponential }
        onDisconnect (fun err -> printfn "Disconnected: %A" err)
    }
    |> Async.RunSynchronously

// Async workflow integration
async {
    use! session = CapnWeb.connectAsync "wss://api.example.com"
    // session implements IAsyncDisposable
    return ()
}
```

### Making RPC Calls

```fsharp
// Get the root stub
let api = session.Stub

// Simple call with async
async {
    let! user = api.["getUser"] [| 42 |]
    printfn "User: %s" (user.["name"].ToString())
}

// Using the dynamic operator
async {
    let! user = api?getUser(42)
    let! name = user?profile?name
    printfn "Name: %s" name
}
```

### Pipelining Syntax (The Key Feature)

```fsharp
// The `rpc` computation expression handles pipelining
let getName (api: RpcStub) (token: string) =
    rpc {
        let! auth = api?authenticate(token)    // Step 1
        let! profile = auth?getProfile()        // Step 2 (pipelined)
        let! name = profile?displayName         // Step 3 (pipelined)
        return name                             // Single round trip!
    }

// Execute the pipeline
async {
    let! name = getName api myToken |> RpcPipeline.execute
    printfn "Hello, %s!" name
}

// Parallel pipelines with `and!`
let getProfileAndFriends api token =
    rpc {
        let! auth = api?authenticate(token)
        let! profile = auth?getProfile()
        and! friends = auth?getFriendIds()      // Parallel branch!
        return (profile, friends)
    }

// Map operation (transforms on server side)
let getFriendNames api token =
    rpc {
        let! auth = api?authenticate(token)
        let! friendIds = auth?getFriendIds()

        // Server-side map - doesn't pull friendIds locally
        let! names =
            friendIds
            |> RpcPipeline.map (fun id -> api?getUser(id)?name)

        return names
    }
```

### Error Handling

```fsharp
// Result-based error handling in the CE
let safeGetUser api userId =
    rpc {
        try
            let! user = api?getUser(userId)
            return Ok user
        with
        | RpcException e when e.ErrorType = "NotFound" ->
            return Error (NotFound userId)
        | RpcException e ->
            return Error (RpcFailed e.Message)
    }

// Pattern matching on RPC errors
let handleResult result =
    match result with
    | Ok user -> printfn "Found: %s" user.Name
    | Error (NotFound id) -> printfn "User %d not found" id
    | Error (RpcFailed msg) -> printfn "RPC error: %s" msg

// Using Result CE integration
let workflow api =
    rpc {
        let! user = api?getUser(42) |> RpcPipeline.catch
        match user with
        | Ok u -> return! u?profile?name
        | Error e -> return "Unknown"
    }
```

### Exposing Local Objects as RPC Targets

```fsharp
// Define a target with a record and functions
type UserServiceTarget =
    { GetUser: int -> Async<User>
      ListUsers: unit -> Async<User list> }

let myUserService db =
    { GetUser = fun id -> db.FindUser id
      ListUsers = fun () -> db.AllUsers() }

// Register as RPC target
let target = RpcTarget.fromRecord (myUserService myDb)
let session = CapnWeb.acceptAsync webSocket target

// Or using a class with attributes
[<RpcTarget>]
type MyApiServer(db: Database) =

    [<RpcMethod>]
    member _.GetUser(id: int) =
        async { return! db.FindUser id }

    [<RpcMethod("authenticate")>]
    member _.Auth(token: string) =
        async {
            let! user = validateToken token
            return AuthedApiServer(user, db) :> obj
        }
```

---

## Approach 2: Pipe-Centric with Operators

**Philosophy**: Embrace F#'s pipe operator as the primary composition mechanism. Every operation is a function that can be piped, creating a Unix-like feel for RPC chains.

### Connection/Session Creation

```fsharp
open CapnWeb
open CapnWeb.Operators

// Pipe-based configuration
let session =
    "wss://api.example.com"
    |> CapnWeb.withTimeout (seconds 30)
    |> CapnWeb.withRetry 3
    |> CapnWeb.connect
    |> Async.RunSynchronously

// Or direct
let session = CapnWeb.connect "wss://api.example.com" |> Async.RunSynchronously
let api = session |> Session.stub
```

### Making RPC Calls

```fsharp
// Functions for RPC operations
module Rpc =
    let call name args stub = ...
    let get prop stub = ...
    let await pipeline = ...

// Pipe-based calls
let user =
    api
    |> Rpc.call "getUser" [| 42 |]
    |> Rpc.await
    |> Async.RunSynchronously

// Chained property access
let name =
    api
    |> Rpc.call "getUser" [| 42 |]
    |> Rpc.get "profile"
    |> Rpc.get "name"
    |> Rpc.await
    |> Async.RunSynchronously
```

### Pipelining Syntax

```fsharp
// Custom operators for RPC
let (|>>) stub methodCall = Rpc.call methodCall stub
let (|>.) stub prop = Rpc.get prop stub
let (!) pipeline = Rpc.await pipeline

// Natural left-to-right pipelining
let getName api token =
    api
    |>> ("authenticate", [| token |])
    |>. "profile"
    |>. "displayName"
    |> Rpc.await

// Or with operator shorthand
let getName' api token =
    api
    |>> ("authenticate", [| token |])
    |>. "profile"
    |>. "displayName"
    |> !

// Parallel branches with fork/join
let getProfileAndFriends api token =
    let auth = api |>> ("authenticate", [| token |])

    // Fork into two pipelines
    let profile = auth |>. "profile"
    let friends = auth |>> ("getFriendIds", [||])

    // Join executes both in one round trip
    (profile, friends)
    |> Rpc.join2
    |> Async.RunSynchronously

// Map with pipe
let getFriendNames api token =
    api
    |>> ("authenticate", [| token |])
    |>> ("getFriendIds", [||])
    |> Rpc.map (fun id ->
        api
        |>> ("getUser", [| id |])
        |>. "name")
    |> Rpc.await
```

### Error Handling

```fsharp
// Result-returning versions
module Rpc =
    let tryCall name args stub : Async<Result<RpcPromise, RpcError>> = ...
    let tryAwait pipeline : Async<Result<'T, RpcError>> = ...

// Pipe with Result
let safeGetUser api userId =
    api
    |> Rpc.tryCall "getUser" [| userId |]
    |> AsyncResult.bind (Rpc.get "profile" >> Rpc.tryAwait)

// Railway-oriented with custom operator
let (>=>) f g x =
    async {
        match! f x with
        | Ok y -> return! g y
        | Error e -> return Error e
    }

let workflow =
    Rpc.tryCall "authenticate" [| token |]
    >=> (Rpc.get "profile" >> Rpc.tryAwait)
    >=> (fun profile -> async { return Ok profile.Name })

// Active patterns for error matching
let (|NotFound|Unauthorized|OtherError|) (error: RpcError) =
    match error.ErrorType with
    | "NotFound" -> NotFound error.Message
    | "Unauthorized" -> Unauthorized
    | _ -> OtherError error

let handleError error =
    match error with
    | NotFound msg -> printfn "Not found: %s" msg
    | Unauthorized -> printfn "Please log in"
    | OtherError e -> printfn "Error: %A" e
```

### Exposing Local Objects as RPC Targets

```fsharp
// Function-based target definition
let myApi =
    RpcTarget.create()
    |> RpcTarget.method "greet" (fun name ->
        async { return sprintf "Hello, %s!" name })
    |> RpcTarget.method "add" (fun (a, b) ->
        async { return a + b })
    |> RpcTarget.nested "users" (fun () ->
        RpcTarget.create()
        |> RpcTarget.method "get" findUser
        |> RpcTarget.method "list" listUsers)

// Serve
let session =
    webSocket
    |> CapnWeb.accept myApi
    |> Async.RunSynchronously
```

---

## Approach 3: Type Provider Based

**Philosophy**: Use F#'s type provider mechanism to generate strongly-typed stubs from a schema at compile time. Maximum type safety with zero runtime reflection.

### Schema Definition

```fsharp
// Reference the schema file or URL
type Api = CapnWeb.TypeProvider<"schema.capnweb">

// Or inline schema
type Api = CapnWeb.TypeProvider<"""
    interface Api {
        authenticate(token: string): AuthedApi
        getPublicUser(id: int): User
    }

    interface AuthedApi {
        getProfile(): Profile
        getFriendIds(): int[]
    }

    interface Profile {
        name: string
        bio: string
        update(bio: string): void
    }

    type User = {
        id: int
        name: string
        email: string
    }
""">
```

### Connection/Session Creation

```fsharp
// Type-safe connection
let session = Api.Connect("wss://api.example.com") |> Async.RunSynchronously
let api = session.Root  // Typed as Api.ApiStub
```

### Making RPC Calls

```fsharp
// Full type inference and IDE support
async {
    let! user = api.GetPublicUser(42)
    printfn "User: %s" user.Name  // user is typed as Api.User

    // Nested interfaces are typed
    let! auth = api.Authenticate(token)
    let! profile = auth.GetProfile()
    printfn "Profile: %s - %s" profile.Name profile.Bio
}
```

### Pipelining Syntax

```fsharp
// Type provider generates pipelineable types
// Each method returns RpcPromise<T> which supports chaining

let getName api token =
    api.Authenticate(token)     // RpcPromise<AuthedApi>
       .GetProfile()            // RpcPromise<Profile> (pipelined)
       .Name                    // RpcPromise<string> (pipelined)
    |> RpcPromise.await         // Async<string> - single round trip!

// Parallel with typed tuples
let getProfileAndFriends api token =
    let auth = api.Authenticate(token)

    RpcPromise.parallel2
        (auth.GetProfile())
        (auth.GetFriendIds())
    |> Async.RunSynchronously   // (Profile, int array)

// Type-safe map
let getFriendProfiles api token =
    api.Authenticate(token)
       .GetFriendIds()
       .Map(fun id -> api.GetPublicUser(id))  // RpcPromise<User array>
    |> RpcPromise.await

// The compiler catches errors!
// api.Authenticate(token).GetFriendIds().Name  // ERROR: int array has no Name
```

### Error Handling

```fsharp
// Type provider generates error union types
type Api.RpcResult<'T> =
    | Success of 'T
    | NotFound of string
    | Unauthorized
    | ValidationError of field: string * message: string
    | ServerError of message: string

// Pattern matching with full exhaustiveness checking
let handleUser result =
    match result with
    | Api.RpcResult.Success user ->
        printfn "Found: %s" user.Name
    | Api.RpcResult.NotFound id ->
        printfn "User %s not found" id
    | Api.RpcResult.Unauthorized ->
        printfn "Please authenticate"
    | Api.RpcResult.ValidationError (field, msg) ->
        printfn "Invalid %s: %s" field msg
    | Api.RpcResult.ServerError msg ->
        printfn "Server error: %s" msg

// Safe call returns RpcResult
async {
    let! result = api.GetPublicUser(42) |> RpcPromise.awaitSafe
    handleUser result
}
```

### Exposing Local Objects as RPC Targets

```fsharp
// Implement the generated interface
type MyApiServer(db: Database) =
    interface Api.IApiTarget with
        member _.Authenticate(token) =
            async {
                let! user = validateToken token
                return MyAuthedApiServer(user, db) :> Api.IAuthedApiTarget
            }

        member _.GetPublicUser(id) =
            async {
                return! db.FindUser(id)
            }

// Type-safe serving
let server = Api.Serve(MyApiServer(db), webSocket) |> Async.RunSynchronously
```

---

## Approach 4: Discriminated Union Message Passing

**Philosophy**: Model RPC as explicit message passing using discriminated unions. Inspired by Elm/Redux architecture. Maximum explicitness and testability at the cost of some verbosity.

### Message Types

```fsharp
// Define messages as discriminated unions
type ApiMessage =
    | Authenticate of token: string
    | GetUser of id: int
    | GetProfile
    | GetFriendIds
    | UpdateBio of bio: string

type ApiResponse =
    | AuthToken of AuthedStub
    | User of User
    | Profile of Profile
    | FriendIds of int list
    | Updated
    | Error of RpcError

// Pipeline as a list of messages
type Pipeline = ApiMessage list
```

### Connection/Session Creation

```fsharp
open CapnWeb.Messages

// Create a dispatcher
let dispatcher = CapnWeb.connect "wss://api.example.com" |> Async.RunSynchronously

// Or with configuration
let dispatcher =
    CapnWeb.configure {
        Endpoint = "wss://api.example.com"
        Timeout = TimeSpan.FromSeconds 30.0
        Serializer = JsonSerializer()
    }
    |> CapnWeb.connect
    |> Async.RunSynchronously
```

### Making RPC Calls

```fsharp
// Single message dispatch
async {
    let! response = dispatcher.Send(GetUser 42)
    match response with
    | User u -> printfn "Found: %s" u.Name
    | Error e -> printfn "Error: %A" e
    | _ -> failwith "Unexpected response"
}

// Using a response handler
let handleResponse = function
    | User u -> printfn "User: %s" u.Name
    | Profile p -> printfn "Profile: %s" p.Bio
    | Error (NotFoundError id) -> printfn "Not found: %d" id
    | Error (OtherError msg) -> printfn "Error: %s" msg
    | _ -> ()

async {
    let! response = dispatcher.Send(GetUser 42)
    handleResponse response
}
```

### Pipelining Syntax

```fsharp
// Build a pipeline as a message list
let pipeline = [
    Authenticate token
    GetProfile
    // Messages after the first chain through the result
]

// Execute returns all responses
async {
    let! responses = dispatcher.SendPipeline(pipeline)
    // responses: ApiResponse list
}

// Pipeline builder DSL
let profilePipeline token =
    pipeline {
        send (Authenticate token)
        chain GetProfile       // Chains through previous result
        chain GetFriendIds     // Branches in parallel
        collect                // Returns tuple of results
    }

// Execute with typed result
async {
    let! (profile, friendIds) =
        profilePipeline myToken
        |> dispatcher.Execute<Profile * int list>

    printfn "Profile: %s, Friends: %d" profile.Name (List.length friendIds)
}

// Branching pipelines
let complexPipeline token =
    pipeline {
        let! auth = send (Authenticate token)

        // Parallel branches
        let! profile = chain GetProfile
        and! friends = chain GetFriendIds

        // Further chaining on profile
        let! bio = profile |> chain (fun p -> GetBio p.Id)

        return (profile, friends, bio)
    }
```

### Error Handling

```fsharp
// Errors are explicit in the response union
type ApiResponse =
    | Success of obj
    | NotFound of entityType: string * id: string
    | Unauthorized of reason: string
    | ValidationFailed of errors: (string * string) list
    | ServerError of message: string * stack: string option

// Active patterns for common error cases
let (|AuthError|_|) = function
    | Unauthorized reason -> Some reason
    | _ -> None

let (|EntityNotFound|_|) = function
    | NotFound (entity, id) -> Some (entity, id)
    | _ -> None

// Handler with active patterns
let handleResponse response =
    match response with
    | Success data ->
        processData data
    | AuthError reason ->
        redirectToLogin reason
    | EntityNotFound (entity, id) ->
        showNotFound entity id
    | ValidationFailed errors ->
        showValidationErrors errors
    | ServerError (msg, stack) ->
        logAndShowError msg stack

// Result-based workflow
let safeWorkflow dispatcher token =
    asyncResult {
        let! authResponse = dispatcher.Send(Authenticate token)
        let! auth =
            match authResponse with
            | AuthToken a -> Ok a
            | Error e -> Error e
            | _ -> Error (UnexpectedResponse "Expected AuthToken")

        let! profileResponse = auth.Send(GetProfile)
        let! profile =
            match profileResponse with
            | Profile p -> Ok p
            | Error e -> Error e
            | _ -> Error (UnexpectedResponse "Expected Profile")

        return profile
    }
```

### Exposing Local Objects as RPC Targets

```fsharp
// Message handler function
let handleMessage (state: ServerState) (message: ApiMessage) : Async<ApiResponse * ServerState> =
    async {
        match message with
        | Authenticate token ->
            match! validateToken token with
            | Some user ->
                let authedState = { state with CurrentUser = Some user }
                return (AuthToken (createStub user), authedState)
            | None ->
                return (Error (Unauthorized "Invalid token"), state)

        | GetUser id ->
            match! state.Db.FindUser(id) with
            | Some user -> return (User user, state)
            | None -> return (Error (NotFound ("User", string id)), state)

        | GetProfile ->
            match state.CurrentUser with
            | Some user ->
                let! profile = state.Db.GetProfile(user.Id)
                return (Profile profile, state)
            | None ->
                return (Error (Unauthorized "Not authenticated"), state)

        | _ ->
            return (Error (ServerError ("Unknown message", None)), state)
    }

// Create target from handler
let target = RpcTarget.fromHandler handleMessage initialState

// Or using the Elmish-style update function
type Model = { Db: Database; User: User option }
type Msg = ApiMessage
type Response = ApiResponse

let update (msg: Msg) (model: Model) : Response * Model =
    match msg with
    | Authenticate token -> // ...
    | GetUser id -> // ...

let target = RpcTarget.elmish { Init = init; Update = update }
```

---

## Comparison Matrix

| Feature | Approach 1: Computation Expression | Approach 2: Pipe Operators | Approach 3: Type Provider | Approach 4: Message Passing |
|---------|-----------------------------------|---------------------------|--------------------------|----------------------------|
| **Type Safety** | Medium (runtime) | Low (stringly-typed) | Maximum (compile-time) | High (union types) |
| **IDE Support** | Good | Limited | Excellent | Good |
| **Pipelining** | `let!`/`and!` in CE | `\|>` chains | Method chaining | Pipeline builder |
| **Learning Curve** | Medium | Low | Medium | Medium-High |
| **F# Idiomaticity** | Very High | High | High | Very High |
| **Boilerplate** | Low | Very Low | Medium (schema) | High |
| **Testability** | Good | Medium | Excellent | Excellent |
| **Dynamic APIs** | Yes | Yes | No (schema required) | No (message types required) |
| **Interop with C#** | Good | Medium | Good | Medium |
| **AOT Compatible** | Partial | Yes | Yes | Yes |

---

## Recommended Hybrid Approach

After analyzing all four approaches, the ideal F# Cap'n Web client should combine strengths:

### Primary: Computation Expression (Approach 1) + Pipes (Approach 2)

```fsharp
open CapnWeb
open CapnWeb.Operators

// Computation expression for complex pipelines
let complexWorkflow api token =
    rpc {
        let! auth = api?authenticate(token)
        let! profile = auth?getProfile()
        and! friends = auth?getFriendIds()  // Parallel

        // Map on server
        let! friendNames =
            friends
            |> RpcPipeline.map (fun id -> api?getUser(id)?name)

        return {| Profile = profile; FriendNames = friendNames |}
    }
    |> RpcPipeline.execute

// Pipe operators for simple chains
let quickLookup api userId =
    api
    |>> ("getUser", [| userId |])
    |>. "profile"
    |>. "name"
    |> Rpc.await
```

### Optional: Type Provider for Enterprise Use

```fsharp
// When you have a stable schema
type Api = CapnWeb.TypeProvider<"api-schema.capnweb">

async {
    let! session = Api.Connect(url)
    let! profile = session.Root.Authenticate(token).GetProfile() |> RpcPromise.await
    printfn "Welcome, %s!" profile.Name
}
```

### Error Handling: Railway-Oriented with Active Patterns

```fsharp
// Result-based async
let safeWorkflow api token =
    asyncResult {
        let! auth = api?authenticate(token) |> RpcPipeline.tryExecute
        let! profile = auth?getProfile() |> RpcPipeline.tryExecute
        return profile
    }

// Active patterns for matching
let (|NotFound|Unauthorized|ServerError|) error = // ...

match! safeWorkflow api token with
| Ok profile -> handleProfile profile
| Error (NotFound msg) -> showNotFound msg
| Error Unauthorized -> redirectToLogin()
| Error (ServerError msg) -> logError msg
```

### Targets: Function-Based with Optional Types

```fsharp
// Simple function-based
let api =
    RpcTarget.create()
    |> RpcTarget.method "greet" (fun name -> async { return sprintf "Hello, %s!" name })
    |> RpcTarget.method "getUser" (findUser db)

// Or with interfaces when interop matters
type IMyApi =
    abstract Greet: string -> Async<string>
    abstract GetUser: int -> Async<User>

[<RpcTarget>]
type MyApi(db) =
    interface IMyApi with
        member _.Greet(name) = async { return sprintf "Hello, %s!" name }
        member _.GetUser(id) = db.FindUser(id)
```

---

## Implementation Notes

### Project Structure

```
CapnWeb.FSharp/
  src/
    CapnWeb.FSharp/
      Core.fs           # Core types: RpcStub, RpcPromise, RpcError
      Session.fs        # Session management
      Pipeline.fs       # RpcPipeline computation expression
      Operators.fs      # Pipe operators module
      Target.fs         # RpcTarget and handler types
      AsyncResult.fs    # Railway-oriented async helpers

    CapnWeb.FSharp.TypeProvider/
      Provider.fs       # Type provider implementation
      Schema.fs         # Schema parsing

  tests/
    CapnWeb.FSharp.Tests/
      PipelineTests.fs
      OperatorTests.fs
      TargetTests.fs
```

### Key Types

```fsharp
/// A stub representing a remote object
type RpcStub =
    abstract member Item: string -> RpcStub with get
    abstract member Call: string * obj array -> RpcPromise<obj>

/// A lazy promise that supports pipelining
type RpcPromise<'T> =
    abstract member Then: ('T -> RpcPromise<'U>) -> RpcPromise<'U>
    abstract member Map: ('T -> 'U) -> RpcPromise<'U>
    abstract member Await: unit -> Async<'T>

/// RPC-specific errors
type RpcError =
    | TransportError of exn
    | RemoteError of errorType: string * message: string * stack: string option
    | Timeout
    | Cancelled

/// Result type alias
type RpcResult<'T> = Result<'T, RpcError>

/// Computation expression builder
type RpcPipelineBuilder() =
    member _.Bind(promise, f) = promise.Then(f)
    member _.Return(x) = RpcPromise.return' x
    member _.ReturnFrom(promise) = promise
    member _.MergeSources(p1, p2) = RpcPromise.parallel2 p1 p2
    // ...

let rpc = RpcPipelineBuilder()
```

### Feature Flags

```xml
<!-- CapnWeb.FSharp.fsproj -->
<PropertyGroup>
  <TargetFrameworks>net8.0;netstandard2.1</TargetFrameworks>
</PropertyGroup>

<ItemGroup>
  <!-- Core dependencies -->
  <PackageReference Include="FSharp.Core" Version="8.0.0" />
  <PackageReference Include="System.Text.Json" Version="8.0.0" />

  <!-- Optional: Type Provider -->
  <PackageReference Include="FSharp.TypeProviders.SDK" Version="*"
                    Condition="'$(IncludeTypeProvider)' == 'true'" />
</ItemGroup>
```

### Async Considerations

```fsharp
// Support both Async and Task
module RpcPromise =
    let await (promise: RpcPromise<'T>) : Async<'T> =
        promise.Await()

    let awaitTask (promise: RpcPromise<'T>) : Task<'T> =
        promise.Await() |> Async.StartAsTask

// TaskBuilder support for C# interop
task {
    let! result = promise |> RpcPromise.awaitTask
    return result
}
```

### Cancellation

```fsharp
// All async operations support CancellationToken
module RpcPipeline =
    let executeWithCancellation
        (ct: CancellationToken)
        (pipeline: RpcPromise<'T>)
        : Async<'T> =
        async {
            use! _ = Async.OnCancel(fun () -> pipeline.Cancel())
            return! pipeline.Await()
        }

// Usage
async {
    use cts = new CancellationTokenSource()
    cts.CancelAfter(TimeSpan.FromSeconds 10.0)

    let! result =
        myPipeline
        |> RpcPipeline.executeWithCancellation cts.Token

    return result
}
```

---

## Open Questions

1. **Computation Expression Design**: Should `rpc { }` return `RpcPromise<'T>` or `Async<'T>`? The former enables further composition, but the latter is more familiar.

2. **Dynamic Operator**: F# supports `?` for dynamic member access. Should we use it (`api?getUser(42)`) or explicit methods (`api.Call("getUser", 42)`)?

3. **Type Provider Scope**: Should the type provider support runtime schema discovery, or require compile-time schema files only?

4. **Error Union Generation**: Should the type provider generate custom error unions per API, or use a generic `RpcError` type?

5. **C# Interop**: How much should we optimize for C# consumers vs. pure F# idioms?

6. **Streaming**: How should we represent server-sent events or streaming responses? `IAsyncEnumerable<'T>` or F#'s `AsyncSeq`?

---

## Next Steps

1. **Prototype Computation Expression** (Approach 1) as the primary API
2. **Add Pipe Operators** (Approach 2) as `CapnWeb.Operators` module
3. **Implement core transport** (WebSocket first, then HTTP batch)
4. **Develop Type Provider** as optional `CapnWeb.TypeProvider` package
5. **Write comprehensive tests** with FsCheck property-based testing
6. **Benchmark pipelining** vs sequential calls
7. **Publish to NuGet** as `CapnWeb.FSharp`
