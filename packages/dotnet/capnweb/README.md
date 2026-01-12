# CapnWeb

[![NuGet](https://img.shields.io/nuget/v/CapnWeb.svg)](https://www.nuget.org/packages/CapnWeb)
[![NuGet Downloads](https://img.shields.io/nuget/dt/CapnWeb.svg)](https://www.nuget.org/packages/CapnWeb)

**Capability-based RPC for .NET with LINQ-powered pipelining.**

```csharp
var profile = await (
    from auth in api.AuthenticateAsync(token)
    from user in auth.GetCurrentUserAsync()
    select user.Profile
);
```

One round-trip. Full type safety. Pure C#.

---

## Why CapnWeb for .NET?

- **LINQ Query Syntax** - Chain RPC calls using familiar `from`/`select` comprehensions
- **Source Generators** - Zero reflection, full AOT compatibility, IntelliSense everywhere
- **Pattern Matching** - Idiomatic C# error handling with `switch` expressions
- **Nullable Reference Types** - First-class null safety throughout
- **IAsyncDisposable** - Proper resource cleanup with `await using`
- **Dependency Injection** - Native integration with `Microsoft.Extensions.DependencyInjection`

---

## Installation

```bash
dotnet add package CapnWeb
```

For ASP.NET Core integration:

```bash
dotnet add package CapnWeb.AspNetCore
```

The source generator is included automatically - no additional packages required.

---

## Quick Start

### 1. Define Your Interface

```csharp
using CapnWeb;

[RpcInterface]
public partial interface IUserApi
{
    Task<string> GreetAsync(string name);
    IAuthenticatedApi AuthenticateAsync(string token);
    Task<UserProfile> GetProfileAsync(int userId);
}

[RpcInterface]
public partial interface IAuthenticatedApi : IAsyncDisposable
{
    Task<User> GetCurrentUserAsync();
    Task<int[]> GetFriendIdsAsync();
}

public record User(int Id, string Name, string Email, UserProfile Profile);
public record UserProfile(string DisplayName, string? Bio, string AvatarUrl);
```

### 2. Connect and Call

```csharp
await using var session = await CapnWeb.ConnectAsync<IUserApi>("wss://api.example.com");
var api = session.Api;

// Simple async call
string greeting = await api.GreetAsync("World");
Console.WriteLine(greeting); // "Hello, World!"

// Get a capability, use it, dispose when done
await using var auth = api.AuthenticateAsync(token);
var user = await auth.GetCurrentUserAsync();
Console.WriteLine($"Welcome, {user.Name}!");
```

That's it. The source generator creates typed stubs from your interfaces at compile time.

---

## Pipelining with LINQ

Pipelining chains calls without awaiting intermediate results. The entire chain executes in a single network round-trip.

### Query Comprehension Syntax

The `RpcPromise<T>` type implements `Select` and `SelectMany`, enabling LINQ query syntax:

```csharp
var userData = await (
    from auth in api.AuthenticateAsync(token)
    from user in auth.GetCurrentUserAsync()
    from friends in auth.GetFriendIdsAsync()
    select new
    {
        user.Name,
        user.Email,
        FriendCount = friends.Length
    }
);
```

This compiles to a single pipelined request. No intermediate awaits. No wasted round-trips.

### Fluent Method Chaining

Every RPC method returns `RpcPromise<T>` - a lazy, composable promise:

```csharp
// No network traffic yet - just building a pipeline
RpcPromise<IAuthenticatedApi> auth = api.AuthenticateAsync(token);
RpcPromise<User> user = auth.GetCurrentUserAsync();
RpcPromise<string> name = user.Select(u => u.Name);

// Single await sends the entire pipeline
string result = await name;
```

### Parallel Composition with WhenAll

The `WhenAll` extension method on tuples enables type-safe parallel execution:

```csharp
// Execute three independent calls in parallel
var (greeting, serverTime, stats) = await (
    api.GreetAsync("World"),
    api.GetServerTimeAsync(),
    api.GetStatsAsync()
).WhenAll();
```

> **Note**: The tuple `WhenAll()` extension is provided by the `CapnWeb` package via source-generated extensions for tuples up to 8 elements. Each element must be an `RpcPromise<T>` or `Task<T>`.

### Collection Mapping

Map over remote collections without pulling data locally:

```csharp
RpcPromise<int[]> friendIds = auth.GetFriendIdsAsync();

// Each GetProfileAsync call is pipelined - server executes them
IEnumerable<UserProfile> profiles = await friendIds.MapAsync(id => api.GetProfileAsync(id));
```

---

## Dependency Injection Integration

CapnWeb integrates seamlessly with the .NET dependency injection container.

### Service Registration

```csharp
using CapnWeb.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Register CapnWeb services
builder.Services.AddCapnWeb(options =>
{
    options.DefaultEndpoint = new Uri("wss://api.example.com");
    options.DefaultTimeout = TimeSpan.FromSeconds(30);
    options.ReconnectPolicy = ReconnectPolicy.ExponentialBackoff(maxRetries: 5);
});

// Register typed API clients
builder.Services.AddCapnWebClient<IUserApi>();
builder.Services.AddCapnWebClient<IOrderApi>(options =>
{
    options.Endpoint = new Uri("wss://orders.example.com");
});

var app = builder.Build();
```

### Consuming in Controllers

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IUserApi _userApi;
    private readonly ILogger<UsersController> _logger;

    public UsersController(IUserApi userApi, ILogger<UsersController> logger)
    {
        _userApi = userApi;
        _logger = logger;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UserProfile>> GetProfile(int id, CancellationToken ct)
    {
        try
        {
            var profile = await _userApi.GetProfileAsync(id).WithCancellation(ct);
            return Ok(profile);
        }
        catch (RpcException ex) when (ex.ErrorType == "NotFound")
        {
            return NotFound();
        }
    }
}
```

### Scoped Sessions

For request-scoped sessions with authentication context:

```csharp
builder.Services.AddCapnWeb(options =>
{
    options.DefaultEndpoint = new Uri("wss://api.example.com");
});

// Register a factory that creates authenticated sessions per request
builder.Services.AddScoped<IAuthenticatedApi>(sp =>
{
    var sessionFactory = sp.GetRequiredService<ICapnWebSessionFactory>();
    var httpContext = sp.GetRequiredService<IHttpContextAccessor>().HttpContext;
    var token = httpContext?.Request.Headers.Authorization.ToString();

    var session = sessionFactory.CreateSession<IUserApi>();
    return session.Api.AuthenticateAsync(token ?? "");
});
```

### Hosted Service for Background Processing

```csharp
public class EventProcessorService : BackgroundService
{
    private readonly ICapnWebSessionFactory _sessionFactory;
    private readonly ILogger<EventProcessorService> _logger;

    public EventProcessorService(
        ICapnWebSessionFactory sessionFactory,
        ILogger<EventProcessorService> logger)
    {
        _sessionFactory = sessionFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await using var session = await _sessionFactory
            .CreateSessionAsync<IEventApi>(stoppingToken);

        await foreach (var evt in session.Api.SubscribeEventsAsync()
            .WithCancellation(stoppingToken))
        {
            _logger.LogInformation("Event received: {Type}", evt.Type);
            await ProcessEventAsync(evt, stoppingToken);
        }
    }
}
```

---

## Error Handling

### Exception-Based Handling

RPC errors throw `RpcException` with strongly-typed error information:

```csharp
try
{
    var user = await api.GetProfileAsync(invalidId);
}
catch (RpcException ex) when (ex.ErrorType == "NotFound")
{
    Console.WriteLine($"User not found: {ex.Message}");
}
catch (RpcException ex) when (ex.ErrorType == "Unauthorized")
{
    await RefreshTokenAndRetryAsync();
}
catch (RpcException ex) when (ex.ErrorType == "RateLimited")
{
    await Task.Delay(ex.RetryAfter ?? TimeSpan.FromSeconds(1));
    // Retry...
}
```

### Result Pattern

Prefer functional error handling? Convert to `Result<T, RpcError>`:

```csharp
Result<UserProfile, RpcError> result = await api.GetProfileAsync(id).AsResultAsync();

if (result.IsSuccess)
{
    Console.WriteLine(result.Value.DisplayName);
}
else
{
    Logger.Error("Failed: {Error}", result.Error);
}
```

### Pattern Matching

Combine with C# pattern matching for elegant dispatch:

```csharp
string message = await api.GetProfileAsync(id).AsResultAsync() switch
{
    { IsSuccess: true, Value: var user } => $"Hello, {user.DisplayName}!",
    { Error.Type: "NotFound" } => "User not found",
    { Error.Type: "Unauthorized" } => "Please log in",
    { Error.Type: "RateLimited", Error.RetryAfter: var delay }
        => $"Too many requests. Retry in {delay?.TotalSeconds}s",
    { Error: var e } => $"Error: {e.Message}"
};
```

### Recovery Chains

Build resilient pipelines with fallback logic:

```csharp
var user = await api.GetProfileAsync(id)
    .CatchAsync(e => e.Type == "NotFound"
        ? api.GetDefaultProfileAsync()
        : throw e.ToException())
    .CatchAsync(_ => RpcPromise.FromResult(UserProfile.Anonymous));
```

---

## Workflow and Saga Patterns

For complex multi-step operations that require coordination and compensation.

### Saga Pattern

```csharp
[RpcInterface]
public partial interface IOrderSaga : IAsyncDisposable
{
    Task<Order> CreateOrderAsync(CreateOrderRequest request);
    Task ReserveInventoryAsync(int orderId);
    Task ProcessPaymentAsync(int orderId, PaymentInfo payment);
    Task ShipOrderAsync(int orderId);

    // Compensation methods
    Task CancelOrderAsync(int orderId);
    Task ReleaseInventoryAsync(int orderId);
    Task RefundPaymentAsync(int orderId);
}

public class OrderSagaOrchestrator
{
    private readonly IOrderSaga _saga;

    public async Task<OrderResult> ExecuteOrderSagaAsync(
        CreateOrderRequest request,
        PaymentInfo payment,
        CancellationToken ct)
    {
        Order? order = null;
        bool inventoryReserved = false;
        bool paymentProcessed = false;

        try
        {
            // Step 1: Create order
            order = await _saga.CreateOrderAsync(request).WithCancellation(ct);

            // Step 2: Reserve inventory
            await _saga.ReserveInventoryAsync(order.Id).WithCancellation(ct);
            inventoryReserved = true;

            // Step 3: Process payment
            await _saga.ProcessPaymentAsync(order.Id, payment).WithCancellation(ct);
            paymentProcessed = true;

            // Step 4: Ship order
            await _saga.ShipOrderAsync(order.Id).WithCancellation(ct);

            return OrderResult.Success(order);
        }
        catch (RpcException ex)
        {
            // Compensate in reverse order
            if (paymentProcessed)
                await _saga.RefundPaymentAsync(order!.Id);

            if (inventoryReserved)
                await _saga.ReleaseInventoryAsync(order!.Id);

            if (order is not null)
                await _saga.CancelOrderAsync(order.Id);

            return OrderResult.Failed(ex.Message);
        }
    }
}
```

### Workflow Orchestration

For long-running workflows with checkpointing:

```csharp
[RpcInterface]
public partial interface IWorkflowEngine
{
    IWorkflowInstance StartWorkflowAsync(string workflowId, object input);
    Task<WorkflowStatus> GetStatusAsync(string instanceId);
    Task SignalAsync(string instanceId, string signalName, object? data = null);
}

[RpcInterface]
public partial interface IWorkflowInstance : IAsyncDisposable
{
    Task<T> WaitForSignalAsync<T>(string signalName);
    Task<T> ExecuteActivityAsync<T>(string activityName, object input);
    Task SetCheckpointAsync(string name, object state);
}

// Usage
await using var workflow = engine.StartWorkflowAsync("order-fulfillment", orderRequest);

// The workflow runs on the server, client can monitor progress
var status = await engine.GetStatusAsync(workflow.InstanceId);

// Send signals to influence workflow execution
await engine.SignalAsync(workflow.InstanceId, "payment-confirmed", paymentResult);
```

---

## Implementing Servers

### Interface Implementation

Implement your RPC interface directly:

```csharp
public class UserApiServer : IUserApi
{
    private readonly IUserRepository _users;
    private readonly ILogger<UserApiServer> _logger;

    public UserApiServer(IUserRepository users, ILogger<UserApiServer> logger)
    {
        _users = users;
        _logger = logger;
    }

    public Task<string> GreetAsync(string name)
        => Task.FromResult($"Hello, {name}!");

    public IAuthenticatedApi AuthenticateAsync(string token)
    {
        var claims = ValidateToken(token);
        return new AuthenticatedApiServer(claims, _users);
    }

    public async Task<UserProfile> GetProfileAsync(int userId)
    {
        var user = await _users.GetByIdAsync(userId);
        return user?.Profile ?? throw new RpcException("NotFound", $"User {userId} not found");
    }
}
```

### Capability Lifecycle

Capabilities implement `IAsyncDisposable`. The runtime calls `DisposeAsync` when the remote client releases its reference:

```csharp
public class AuthenticatedApiServer : IAuthenticatedApi
{
    private readonly ClaimsPrincipal _user;
    private readonly IUserRepository _users;
    private readonly AuditLogger _audit;

    public async Task<User> GetCurrentUserAsync()
        => await _users.GetByIdAsync(_user.GetUserId());

    public async Task<int[]> GetFriendIdsAsync()
        => await _users.GetFriendIdsAsync(_user.GetUserId());

    public async ValueTask DisposeAsync()
    {
        // Called when remote client disposes their stub
        await _audit.LogSessionEndAsync(_user.GetUserId());
    }
}
```

### ASP.NET Core Hosting

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCapnWeb();
builder.Services.AddScoped<IUserApi, UserApiServer>();

var app = builder.Build();

// WebSocket endpoint for persistent connections
app.MapCapnWebSocket<IUserApi>("/rpc");

// HTTP batch endpoint for stateless scenarios
app.MapCapnWebBatch<IUserApi>("/rpc/batch");

app.Run();
```

For more control over the WebSocket handling:

```csharp
app.Map("/rpc", async (HttpContext context, IServiceProvider sp) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = 400;
        return;
    }

    var ws = await context.WebSockets.AcceptWebSocketAsync();
    var server = sp.GetRequiredService<IUserApi>();

    await using var session = CapnWeb.Accept(ws, server);
    await session.RunAsync(context.RequestAborted);
});
```

---

## Streaming

### Server-to-Client Streaming

Use `IAsyncEnumerable<T>` for streaming data:

```csharp
[RpcInterface]
public partial interface IEventApi
{
    IAsyncEnumerable<Event> SubscribeEventsAsync(string? filter = null);
}

// Server implementation
public class EventApiServer : IEventApi
{
    private readonly IEventBus _eventBus;

    public async IAsyncEnumerable<Event> SubscribeEventsAsync(
        string? filter = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        await foreach (var evt in _eventBus.SubscribeAsync(ct))
        {
            if (filter is null || evt.Type.Contains(filter))
            {
                yield return evt;
            }
        }
    }
}

// Client consumption
await foreach (var evt in api.SubscribeEventsAsync("user."))
{
    Console.WriteLine($"Event: {evt.Type} - {evt.Data}");

    if (evt.Type == "user.shutdown")
        break;
}
```

### Bidirectional Streaming

```csharp
[RpcInterface]
public partial interface IChatApi
{
    IAsyncEnumerable<ChatMessage> JoinRoomAsync(
        string roomId,
        IAsyncEnumerable<ChatMessage> outgoing);
}
```

---

## Cancellation

All async operations support `CancellationToken`:

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

try
{
    var result = await api.LongRunningOperationAsync()
        .WithCancellation(cts.Token);
}
catch (OperationCanceledException)
{
    Console.WriteLine("Operation timed out");
}
```

Cancellation propagates to the server, which can use it to abort expensive operations.

---

## HTTP Batch Mode

For request/response scenarios without persistent connections:

```csharp
await using var batch = CapnWeb.CreateBatch<IUserApi>("https://api.example.com/rpc");
var api = batch.Api;

// Queue up calls
var greeting = api.GreetAsync("Alice");
var profile = api.GetProfileAsync(42);
var stats = api.GetStatsAsync();

// Execute as single HTTP POST request
var (g, p, s) = await batch.ExecuteAsync(greeting, profile, stats);
```

---

## Source Generator Deep Dive

The `[RpcInterface]` attribute triggers compile-time code generation.

### What Gets Generated

For this interface:

```csharp
[RpcInterface]
public partial interface IUserApi
{
    Task<string> GreetAsync(string name);
    IAuthenticatedApi AuthenticateAsync(string token);
}
```

The source generator produces:

1. **Stub class** - `UserApiStub` that implements `IUserApi` and forwards calls over RPC
2. **Promise extensions** - Methods on `RpcPromise<IUserApi>` for pipelining
3. **Serialization metadata** - Type information for System.Text.Json (AOT-safe)
4. **LINQ operators** - `Select` and `SelectMany` for query syntax

### Viewing Generated Code

In Visual Studio, expand Dependencies > Analyzers > CapnWeb.SourceGenerator to see generated files.

Or add to your `.csproj`:

```xml
<PropertyGroup>
    <EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>
    <CompilerGeneratedFilesOutputPath>Generated</CompilerGeneratedFilesOutputPath>
</PropertyGroup>
```

### Serialization Constraints

Types used in RPC interfaces must be serializable with System.Text.Json:

```csharp
// Records work great - immutable, value semantics
public record UserProfile(string DisplayName, string? Bio, string AvatarUrl);

// Classes need public properties with getters/setters
public class UserProfile
{
    public string DisplayName { get; set; } = "";
    public string? Bio { get; set; }
    public string AvatarUrl { get; set; } = "";
}

// For custom serialization, use attributes
public record Event(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("data")] JsonElement Data,
    [property: JsonPropertyName("ts")] DateTimeOffset Timestamp
);
```

Types that **cannot** be used directly:
- `Span<T>`, `ReadOnlySpan<T>` (stack-only)
- Unmanaged pointers
- `delegate` types (use interfaces instead)

---

## AOT Compatibility

For Native AOT deployment, provide explicit serialization context:

```csharp
[JsonSerializable(typeof(UserProfile))]
[JsonSerializable(typeof(User))]
[JsonSerializable(typeof(Event))]
[JsonSerializable(typeof(RpcError))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public partial class AppJsonContext : JsonSerializerContext { }

await using var session = await CapnWeb.ConnectAsync<IUserApi>(new CapnWebOptions
{
    Endpoint = new Uri("wss://api.example.com"),
    JsonSerializerContext = AppJsonContext.Default
});
```

The source generator automatically includes common types, but custom DTOs need explicit registration.

---

## Platform Integration

### Blazor WebAssembly

```csharp
// Program.cs
builder.Services.AddCapnWeb(options =>
{
    options.DefaultEndpoint = new Uri("wss://api.example.com");
    options.Transport = CapnWebTransport.WebSocket; // Uses browser WebSocket
});
builder.Services.AddCapnWebClient<IUserApi>();

// Component
@inject IUserApi UserApi

@code {
    private User? _user;

    protected override async Task OnInitializedAsync()
    {
        _user = await UserApi.GetCurrentUserAsync();
    }
}
```

### Blazor Server

```csharp
builder.Services.AddCapnWeb();
builder.Services.AddCapnWebClient<IUserApi>();

// Inject into components as usual
```

### MAUI

```csharp
// MauiProgram.cs
builder.Services.AddCapnWeb(options =>
{
    options.DefaultEndpoint = new Uri("wss://api.example.com");
    options.ReconnectPolicy = ReconnectPolicy.ExponentialBackoff(maxRetries: 10);
});
builder.Services.AddCapnWebClient<IUserApi>();
```

### Console Applications

```csharp
using var host = Host.CreateDefaultBuilder(args)
    .ConfigureServices(services =>
    {
        services.AddCapnWeb(options =>
        {
            options.DefaultEndpoint = new Uri("wss://api.example.com");
        });
        services.AddCapnWebClient<IUserApi>();
    })
    .Build();

var api = host.Services.GetRequiredService<IUserApi>();
var greeting = await api.GreetAsync("Console");
```

---

## Connection Management

### Connection Options

```csharp
await using var session = await CapnWeb.ConnectAsync<IUserApi>(new CapnWebOptions
{
    Endpoint = new Uri("wss://api.example.com"),
    Timeout = TimeSpan.FromSeconds(30),
    ReconnectPolicy = ReconnectPolicy.ExponentialBackoff(
        initialDelay: TimeSpan.FromSeconds(1),
        maxDelay: TimeSpan.FromSeconds(30),
        maxRetries: 5
    ),
    KeepAliveInterval = TimeSpan.FromSeconds(30),
    JsonSerializerContext = AppJsonContext.Default, // For AOT
});
```

### Connection Events

```csharp
session.StateChanged += (sender, state) =>
{
    Console.WriteLine($"Connection state: {state}");
};

session.Error += (sender, error) =>
{
    Logger.Error("RPC error: {Type} - {Message}", error.Type, error.Message);
};

session.Reconnecting += (sender, attempt) =>
{
    Console.WriteLine($"Reconnection attempt {attempt}...");
};
```

### Manual Reconnection

```csharp
if (session.State == ConnectionState.Disconnected)
{
    await session.ReconnectAsync();
}
```

---

## Security

### Transport Security

Always use `wss://` (WebSocket over TLS) in production:

```csharp
var session = await CapnWeb.ConnectAsync<IUserApi>("wss://api.example.com");
```

### Authentication

```csharp
// Bearer token authentication
var session = await CapnWeb.ConnectAsync<IUserApi>(new CapnWebOptions
{
    Endpoint = new Uri("wss://api.example.com"),
    Authentication = new BearerTokenAuthentication(token),
});

// Or authenticate via capability
await using var session = await CapnWeb.ConnectAsync<IUserApi>("wss://api.example.com");
await using var auth = session.Api.AuthenticateAsync(token);
// auth now represents an authenticated capability
```

### Capability-Based Security

Capabilities are unforgeable references. If you have a capability, you have permission to use it.

```csharp
// Server grants limited capability based on permissions
IReadOnlyUserApi readOnly = auth.GetReadOnlyAccessAsync();

// Client can only call read methods - enforced by the type system
var profile = await readOnly.GetProfileAsync(id);
// readOnly.DeleteUserAsync(id);  // Won't compile - method doesn't exist
```

### Input Validation

Always validate inputs on the server:

```csharp
public async Task<UserProfile> GetProfileAsync(int userId)
{
    if (userId <= 0)
        throw new RpcException("InvalidArgument", "userId must be positive");

    // ...
}
```

---

## Testing

### Mocking Interfaces

```csharp
public class MockUserApi : IUserApi
{
    public Task<string> GreetAsync(string name)
        => Task.FromResult($"Hello, {name}!");

    public IAuthenticatedApi AuthenticateAsync(string token)
        => new MockAuthenticatedApi();

    public Task<UserProfile> GetProfileAsync(int userId)
        => Task.FromResult(new UserProfile("Test User", null, "https://example.com/avatar.png"));
}

[Fact]
public async Task GreetAsync_ReturnsGreeting()
{
    var api = new MockUserApi();
    var result = await api.GreetAsync("World");
    Assert.Equal("Hello, World!", result);
}
```

### In-Memory Transport

```csharp
using CapnWeb.Testing;

[Fact]
public async Task Integration_FullPipeline()
{
    // Create in-memory connected pair
    var (client, server) = InMemoryTransport.CreatePair();

    // Set up server
    var serverTask = Task.Run(async () =>
    {
        await using var session = CapnWeb.Accept(server, new UserApiServer());
        await session.RunAsync();
    });

    // Connect client
    await using var session = await CapnWeb.ConnectAsync<IUserApi>(client);

    var profile = await (
        from auth in session.Api.AuthenticateAsync("test-token")
        from user in auth.GetCurrentUserAsync()
        select user.Profile
    );

    Assert.NotNull(profile);
}
```

---

## Interface Definition Reference

### Method Signatures

All RPC methods should be async and follow the `Async` suffix convention:

```csharp
[RpcInterface]
public partial interface ICalculator
{
    // Standard async method
    Task<int> AddAsync(int a, int b);

    // Method returning another capability (pipelineable)
    ISession CreateSessionAsync();

    // Void-returning async method
    Task LogEventAsync(string message);

    // Nullable parameters and returns
    Task<User?> FindUserAsync(string? email);

    // Streaming return
    IAsyncEnumerable<Event> SubscribeAsync(string topic);
}
```

### Custom Wire Names

```csharp
[RpcInterface]
public partial interface ILegacyApi
{
    [RpcMethod("getUserById")]  // Custom method name on the wire
    Task<User> GetUserAsync(int id);

    [RpcMethod("v2.createUser")]  // Namespaced method
    Task<User> CreateUserV2Async(CreateUserRequest request);
}
```

### Context Injection

Access session metadata in server implementations:

```csharp
public class ApiServer : IMyApi
{
    public Task<string> WhoAmIAsync(RpcContext context)
    {
        return Task.FromResult($"You are connecting from {context.RemoteAddress}");
    }
}
```

---

## Package Structure

| Package | Description |
|---------|-------------|
| `CapnWeb` | Core library with source generators |
| `CapnWeb.AspNetCore` | ASP.NET Core middleware, DI integration, hosting |
| `CapnWeb.Testing` | Test utilities, mocks, and in-memory transport |

---

## Why Cap'n Web?

### Capability-Based Security

Pass around *capabilities* - object references that carry both identity and authority. No more checking permissions on every call. If you have the reference, you have the permission.

### Pipelining Eliminates Latency

Traditional RPC:

```
Client: Authenticate(token) -----> Server
Client: <----- auth reference
Client: GetUserId(auth) -----> Server
Client: <----- userId
Client: GetProfile(userId) -----> Server
Client: <----- profile

3 round-trips = 3x latency
```

Cap'n Web with pipelining:

```
Client: Authenticate(token)
        .GetCurrentUser()
        .Profile -----> Server
Client: <----- profile

1 round-trip = 1x latency
```

### Type Safety Without Ceremony

Source generators create typed stubs at compile time:

- Full IntelliSense and autocompletion
- Compile-time errors for mismatched types
- Refactoring support across client and server
- No reflection at runtime (AOT compatible)

---

## License

MIT

## Contributing

Contributions welcome. Please read CONTRIBUTING.md before submitting PRs.
