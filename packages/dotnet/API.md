# CapnWeb C# Client API

> The definitive API design for `CapnWeb` - a modern C# client for Cap'n Web RPC.

## Design Philosophy

This API synthesizes four divergent approaches into one cohesive design:

- **Source-generated interfaces** for compile-time type safety and excellent IDE support
- **LINQ query syntax** for elegant, declarative pipelining
- **Pattern matching on Result types** for expressive error handling
- **Fluent async/await** that feels native to modern C#

The result is an API where every line of code is idiomatic C#.

---

## Quick Start

```csharp
await using var session = await CapnWeb.ConnectAsync<IMyApi>("wss://api.example.com");
var api = session.Stub;

// Simple call
string greeting = await api.Greet("World");

// Pipelining with LINQ - executes in a single round-trip
var profile = await (
    from auth in api.Authenticate(token)
    from userId in auth.GetUserId()
    from p in api.GetProfile(userId)
    select p
);

// Error handling with pattern matching
var result = await api.GetUser(id).AsResult();
var name = result switch
{
    { IsSuccess: true, Value: var user } => user.Name,
    { Error.Type: "NotFound" } => "Unknown",
    _ => throw result.Error.ToException()
};
```

---

## Core Types

### RpcPromise\<T\>

The foundational type enabling pipelining. Represents a pending RPC result that can be composed before awaiting.

```csharp
public readonly struct RpcPromise<T> : INotifyCompletion
{
    // Awaitable - use with async/await
    public TaskAwaiter<T> GetAwaiter();

    // LINQ operators for composition
    public RpcPromise<TResult> Select<TResult>(Func<T, TResult> selector);
    public RpcPromise<TResult> SelectMany<TResult>(Func<T, RpcPromise<TResult>> selector);
    public RpcPromise<TResult> SelectMany<TIntermediate, TResult>(
        Func<T, RpcPromise<TIntermediate>> collectionSelector,
        Func<T, TIntermediate, TResult> resultSelector);

    // Error handling
    public RpcPromise<Result<T>> AsResult();
    public RpcPromise<T> Catch(Func<RpcError, T> handler);
    public RpcPromise<T> Catch(Func<RpcError, RpcPromise<T>> handler);

    // Collection operations (when T is enumerable)
    public RpcPromise<TResult[]> Map<TResult>(Func<TElement, RpcPromise<TResult>> selector);
}
```

### Result\<T\>

Functional error handling without exceptions.

```csharp
public readonly struct Result<T>
{
    public bool IsSuccess { get; }
    public T Value { get; }          // Throws if not success
    public RpcError Error { get; }   // Throws if success

    public TResult Match<TResult>(Func<T, TResult> success, Func<RpcError, TResult> failure);
    public Result<TResult> Select<TResult>(Func<T, TResult> selector);
    public Result<TResult> SelectMany<TResult>(Func<T, Result<TResult>> selector);
}

public sealed record RpcError(string Type, string Message, string? Stack = null)
{
    public RpcException ToException() => new RpcException(this);
}
```

### Session Interfaces

```csharp
public interface IRpcSession : IAsyncDisposable
{
    ConnectionState State { get; }
    event EventHandler<RpcError>? OnError;
    event EventHandler<ConnectionState>? OnStateChanged;

    Task ReconnectAsync(CancellationToken cancellationToken = default);
}

public interface IRpcSession<TStub> : IRpcSession
{
    TStub Stub { get; }
    dynamic Dynamic { get; }  // Escape hatch for untyped access
}
```

---

## Interface Definition

Define RPC contracts using annotated interfaces. Source generators produce typed stubs.

```csharp
[RpcInterface]
public partial interface IMyApi
{
    // Simple async method
    Task<string> GreetAsync(string name);

    // Returns a capability - enables pipelining
    [RpcCapability]
    IAuthedApi Authenticate(string token);

    // Standard async method
    Task<UserProfile> GetProfileAsync(int userId);

    // Streaming (server-to-client)
    IAsyncEnumerable<Event> SubscribeEventsAsync(CancellationToken cancellationToken = default);
}

[RpcInterface]
public partial interface IAuthedApi : IAsyncDisposable
{
    Task<int> GetUserIdAsync();
    Task<int[]> GetFriendIdsAsync();
    Task<UserProfile> GetProfileAsync();
}
```

### Generated Code

The source generator produces:

```csharp
// Auto-generated - do not modify
public partial interface IMyApi
{
    // Non-async overloads returning RpcPromise<T> for pipelining
    RpcPromise<string> Greet(string name);
    RpcPromise<UserProfile> GetProfile(int userId);
}

internal sealed class MyApiStub : IMyApi, IAsyncDisposable
{
    private readonly RpcSession _session;
    private readonly ImportId _id;

    public RpcPromise<string> Greet(string name)
        => _session.Call<string>(_id, "greet", name);

    async Task<string> IMyApi.GreetAsync(string name)
        => await Greet(name);

    // ... additional generated members
}
```

---

## Connection

### WebSocket (Bidirectional)

```csharp
// Simple connection
await using var session = await CapnWeb.ConnectAsync<IMyApi>("wss://api.example.com");
var api = session.Stub;

// With options
await using var session = await CapnWeb.ConnectAsync<IMyApi>(new CapnWebOptions
{
    Endpoint = new Uri("wss://api.example.com"),
    Timeout = TimeSpan.FromSeconds(30),
    ReconnectPolicy = ReconnectPolicy.ExponentialBackoff(maxRetries: 5),
    JsonSerializerOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }
});
```

### HTTP Batch Mode

```csharp
// Batch multiple calls into a single HTTP request
await using var batch = CapnWeb.CreateBatch<IMyApi>("https://api.example.com/rpc");
var api = batch.Stub;

var greeting = api.Greet("World");
var profile = api.GetProfile(42);

// Execute batch - single HTTP round-trip
var (g, p) = await batch.ExecuteAsync(greeting, profile);
```

### Multiple Capabilities

```csharp
// Connect with multiple root capabilities
await using var session = await CapnWeb.ConnectAsync<(IUserApi Users, IAdminApi Admin)>(url);
var (users, admin) = session.Stub;

await users.GetProfileAsync(123);
await admin.ResetCacheAsync();
```

---

## Pipelining

Pipelining chains calls without awaiting intermediate results. The entire chain executes in a single network round-trip.

### Fluent Chaining

```csharp
// Each call returns RpcPromise<T> - no network traffic yet
RpcPromise<IAuthedApi> auth = api.Authenticate(token);
RpcPromise<int> userId = auth.GetUserId();          // Pipelined on auth
RpcPromise<UserProfile> profile = api.GetProfile(userId);  // Uses userId promise

// Single await executes the entire pipeline
UserProfile result = await profile;
```

### LINQ Query Syntax

```csharp
// Elegant declarative pipelines
var profile = await (
    from auth in api.Authenticate(token)
    from userId in auth.GetUserId()
    from friendIds in auth.GetFriendIds()
    from p in api.GetProfile(userId)
    select new
    {
        Profile = p,
        FriendCount = friendIds.Length
    }
);
```

### Parallel Composition

```csharp
// Independent calls execute in parallel
var (greeting, time, stats) = await (
    api.Greet("World"),
    api.GetServerTime(),
    api.GetStats()
).WhenAll();

// Or with LINQ (parallel when no data dependencies)
var data = await (
    from g in api.Greet("World")
    from t in api.GetServerTime()
    from s in api.GetStats()
    select (g, t, s)
);
```

### Collection Mapping

```csharp
// Map over remote collections without pulling data locally
RpcPromise<int[]> friendIds = auth.GetFriendIds();

// Each GetProfile call is pipelined
var profiles = await friendIds.Map(id => api.GetProfile(id));

// LINQ equivalent
var profiles = await (
    from ids in auth.GetFriendIds()
    from profile in ids.AsRpc().SelectMany(id => api.GetProfile(id))
    select profile
);
```

---

## Error Handling

### Traditional Exceptions

```csharp
try
{
    var user = await api.GetUser(invalidId);
}
catch (RpcException ex) when (ex.Error.Type == "NotFound")
{
    Console.WriteLine($"User not found: {ex.Message}");
}
catch (RpcException ex) when (ex.Error.Type == "Unauthorized")
{
    await RefreshTokenAndRetry();
}
```

### Result\<T\> Pattern

```csharp
// Convert to Result<T> - no exceptions thrown
var result = await api.GetUser(id).AsResult();

if (result.IsSuccess)
{
    Console.WriteLine(result.Value.Name);
}
else
{
    LogError(result.Error);
}
```

### Pattern Matching

```csharp
var message = await api.GetUser(id).AsResult() switch
{
    { IsSuccess: true, Value: var user } => $"Hello, {user.Name}!",
    { Error.Type: "NotFound" } => "User not found",
    { Error.Type: "Unauthorized" } => "Please log in",
    { Error: var e } => $"Error: {e.Message}"
};
```

### Recovery Chains

```csharp
// Fallback chain for resilience
var user = await api.GetUser(id)
    .Catch(e => e.Type == "NotFound" ? api.GetDefaultUser() : throw e.ToException())
    .Catch(_ => RpcPromise.FromResult(User.Anonymous));
```

---

## Implementing Servers

### Interface Implementation

```csharp
public class MyApiServer : IMyApi
{
    public Task<string> GreetAsync(string name)
        => Task.FromResult($"Hello, {name}!");

    public IAuthedApi Authenticate(string token)
    {
        var user = ValidateToken(token);
        return new AuthedApiServer(user);  // Returns another capability
    }

    public async Task<UserProfile> GetProfileAsync(int userId)
        => await _db.GetProfileAsync(userId);

    public async IAsyncEnumerable<Event> SubscribeEventsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var evt in _eventStream.WithCancellation(cancellationToken))
        {
            yield return evt;
        }
    }
}

// Capability with lifecycle management
public class AuthedApiServer : IAuthedApi, IAsyncDisposable
{
    private readonly User _user;

    public Task<int> GetUserIdAsync() => Task.FromResult(_user.Id);
    public Task<int[]> GetFriendIdsAsync() => Task.FromResult(_user.FriendIds);

    public async ValueTask DisposeAsync()
    {
        // Called when remote client releases this capability
        await _auditLog.LogLogoutAsync(_user.Id);
    }
}
```

### Accepting Connections

```csharp
// ASP.NET Core WebSocket
app.Map("/rpc", async context =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var ws = await context.WebSockets.AcceptWebSocketAsync();
        await using var session = CapnWeb.Accept(ws, new MyApiServer());
        await session.RunAsync(context.RequestAborted);
    }
});

// HTTP batch endpoint
app.MapPost("/rpc", async (HttpRequest request) =>
{
    var server = new MyApiServer();
    return await CapnWeb.HandleBatchAsync(request.Body, server);
});
```

### Attribute-Based Methods

```csharp
public class FlexibleServer
{
    [RpcMethod]
    public string Greet(string name) => $"Hello, {name}!";

    [RpcMethod("getUserProfile")]  // Custom wire name
    public Task<UserProfile> GetProfileAsync(int id) => _db.GetAsync(id);

    [RpcMethod]
    public IAuthedApi Authenticate(string token, RpcContext context)
    {
        // RpcContext provides session metadata
        Log.Info($"Auth from {context.RemoteAddress}");
        return new AuthedApiServer(ValidateToken(token));
    }
}
```

---

## Advanced Patterns

### Cancellation

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

var result = await api.LongRunningOperation()
    .WithCancellation(cts.Token);

// Or pass directly to async methods
await api.ProcessDataAsync(data, cts.Token);
```

### Streaming

```csharp
// Server-to-client streaming
await foreach (var evt in api.SubscribeEventsAsync())
{
    Console.WriteLine($"Event: {evt.Type}");
}

// With cancellation
await foreach (var evt in api.SubscribeEventsAsync().WithCancellation(cts.Token))
{
    if (evt.Type == "done") break;
}
```

### Dynamic Access

For prototyping or untyped scenarios:

```csharp
// Escape hatch to dynamic
dynamic flex = session.Dynamic;
var result = await flex.SomeUndefinedMethod(arg1, arg2);

// Useful during development before interfaces are finalized
```

### Custom Serialization

```csharp
// For AOT compatibility
[JsonSerializable(typeof(UserProfile))]
[JsonSerializable(typeof(RpcMessage))]
public partial class MyJsonContext : JsonSerializerContext { }

await using var session = await CapnWeb.ConnectAsync<IMyApi>(new CapnWebOptions
{
    Endpoint = new Uri("wss://api.example.com"),
    JsonTypeInfo = MyJsonContext.Default
});
```

---

## Type Signatures

### Core Interfaces

```csharp
namespace CapnWeb;

public static class CapnWeb
{
    public static Task<IRpcSession<TStub>> ConnectAsync<TStub>(
        string endpoint,
        CancellationToken cancellationToken = default);

    public static Task<IRpcSession<TStub>> ConnectAsync<TStub>(
        CapnWebOptions options,
        CancellationToken cancellationToken = default);

    public static IRpcBatch<TStub> CreateBatch<TStub>(string endpoint);

    public static IRpcSession Accept<TTarget>(
        WebSocket webSocket,
        TTarget target) where TTarget : class;

    public static Task<Stream> HandleBatchAsync<TTarget>(
        Stream requestBody,
        TTarget target) where TTarget : class;
}

public interface IRpcSession : IAsyncDisposable
{
    ConnectionState State { get; }
    event EventHandler<RpcError>? OnError;
    event EventHandler<ConnectionState>? OnStateChanged;
    Task RunAsync(CancellationToken cancellationToken = default);
    Task ReconnectAsync(CancellationToken cancellationToken = default);
}

public interface IRpcSession<TStub> : IRpcSession
{
    TStub Stub { get; }
    dynamic Dynamic { get; }
}

public interface IRpcBatch<TStub> : IAsyncDisposable
{
    TStub Stub { get; }
    Task<T> ExecuteAsync<T>(RpcPromise<T> promise);
    Task<(T1, T2)> ExecuteAsync<T1, T2>(RpcPromise<T1> p1, RpcPromise<T2> p2);
    Task<(T1, T2, T3)> ExecuteAsync<T1, T2, T3>(RpcPromise<T1> p1, RpcPromise<T2> p2, RpcPromise<T3> p3);
    // ... up to reasonable arity
}

public enum ConnectionState { Connecting, Connected, Reconnecting, Disconnected }
```

### Configuration

```csharp
public sealed record CapnWebOptions
{
    public required Uri Endpoint { get; init; }
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
    public ReconnectPolicy ReconnectPolicy { get; init; } = ReconnectPolicy.None;
    public JsonSerializerOptions? JsonSerializerOptions { get; init; }
    public IJsonTypeInfoResolver? JsonTypeInfo { get; init; }  // For AOT
    public CancellationToken CancellationToken { get; init; }
}

public abstract record ReconnectPolicy
{
    public static ReconnectPolicy None { get; } = new NoReconnect();
    public static ReconnectPolicy ExponentialBackoff(int maxRetries = 5)
        => new ExponentialBackoffPolicy(maxRetries);

    private sealed record NoReconnect : ReconnectPolicy;
    private sealed record ExponentialBackoffPolicy(int MaxRetries) : ReconnectPolicy;
}
```

### Attributes

```csharp
[AttributeUsage(AttributeTargets.Interface)]
public sealed class RpcInterfaceAttribute : Attribute { }

[AttributeUsage(AttributeTargets.Method)]
public sealed class RpcCapabilityAttribute : Attribute { }

[AttributeUsage(AttributeTargets.Method)]
public sealed class RpcMethodAttribute : Attribute
{
    public string? Name { get; init; }
    public RpcMethodAttribute() { }
    public RpcMethodAttribute(string name) => Name = name;
}
```

---

## Why This Design

### Idiomatic C#

- **async/await**: Every I/O operation is awaitable
- **IAsyncDisposable**: Proper resource cleanup with `await using`
- **Nullable reference types**: Full null-safety throughout
- **CancellationToken**: Standard cancellation pattern everywhere
- **Records**: Immutable configuration and error types

### LINQ Integration

The `RpcPromise<T>` type implements `Select` and `SelectMany`, enabling:
- Query comprehension syntax (`from ... in ... select`)
- Method chaining (`.Select().SelectMany()`)
- Familiar patterns for C# developers

### Type Safety

- Source generators produce typed stubs at compile time
- No runtime reflection for core paths
- AOT-compatible with explicit serialization contexts
- IDE autocompletion and refactoring support

### Flexibility

- Strong types for production code
- Dynamic escape hatch for prototyping
- Both exception and Result-based error handling
- WebSocket and HTTP transports

---

## Package Structure

```
CapnWeb                    # Core library
CapnWeb.Generators         # Source generators (compile-time dependency)
CapnWeb.AspNetCore         # ASP.NET Core integration
CapnWeb.Testing            # Test utilities and mocks
```

Install:
```bash
dotnet add package CapnWeb
```

The source generator is automatically included and requires no additional configuration.
