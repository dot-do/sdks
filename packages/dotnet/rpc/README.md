# Rpc.Do

[![NuGet](https://img.shields.io/nuget/v/Rpc.Do.svg)](https://www.nuget.org/packages/Rpc.Do)
[![NuGet Downloads](https://img.shields.io/nuget/dt/Rpc.Do.svg)](https://www.nuget.org/packages/Rpc.Do)

**The managed RPC layer for .NET that makes any `.do` service feel like local code.**

```csharp
await using var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();

// Call any method with full pipelining support
var profile = await client.Call<User>("getUser", 42)
    .Then<UserProfile>("getProfile");
```

One round-trip. Full type safety. Pure C#.

---

## What is Rpc.Do?

`Rpc.Do` is the managed RPC layer for the `.do` ecosystem on .NET. It sits between raw [CapnWeb](https://www.nuget.org/packages/CapnWeb) (the protocol) and domain-specific SDKs like `Mongo.Do`, `Database.Do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method dynamically** - No schema generation required
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Use LINQ-style Select()** - Server-side mapping eliminates N+1

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  Rpc.Do  | --> | CapnWeb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- RpcPromise<T> (lazy, composable)
    +--- LINQ Select() for server-side mapping
    +--- Promise pipelining
    +--- IAsyncDisposable lifecycle
```

---

## Rpc.Do vs CapnWeb

| Feature | CapnWeb | Rpc.Do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses CapnWeb |
| Type-safe with interfaces | Yes (source generators) | Yes (dynamic) |
| Schema-free dynamic calls | No | Yes |
| Auto `.do` domain routing | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side `Select()` | Yes | Yes (LINQ-style) |
| Records/Pattern matching | Yes | Yes |

**Use CapnWeb** when you're building a custom RPC server with defined interfaces and want compile-time type checking via source generators.

**Use Rpc.Do** when you're calling `.do` services and want maximum flexibility with C# idioms.

---

## Installation

```bash
dotnet add package Rpc.Do
```

Requires .NET 8.0 or later.

For ASP.NET Core integration (coming soon):

```bash
dotnet add package Rpc.Do.AspNetCore
```

---

## Quick Start

### Basic Connection

```csharp
using DotDo.Rpc;

// Connect to any .do service
await using var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();

// Make RPC calls
var greeting = await client.Call<string>("greet", "World");
Console.WriteLine(greeting);  // "Hello, World!"

// Client is disposed automatically via await using
```

### With Authentication

```csharp
await using var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();

// Authenticate and get capabilities
var auth = await client.Call<AuthSession>("authenticate", apiToken);
var user = await client.Call<User>("getUser", auth.UserId);
```

### Type Your Results

```csharp
// Define your models as records (recommended)
public record User(int Id, string Name, string Email, UserProfile Profile);
public record UserProfile(string DisplayName, string? Bio, string AvatarUrl);
public record AuthSession(int UserId, string Token, DateTime ExpiresAt);

// Full type inference
User user = await client.Call<User>("getUser", 42);
Console.WriteLine($"Hello, {user.Name}!");
Console.WriteLine($"Bio: {user.Profile.Bio ?? "No bio"}");
```

---

## The RpcPromise

The core abstraction in Rpc.Do is `RpcPromise<T>` - a lazy, composable promise that enables pipelining and server-side transformations.

### How It Works

```csharp
// Every Call<T>() returns an RpcPromise<T> - no network traffic yet
RpcPromise<User> userPromise = client.Call<User>("getUser", 42);

// Chain operations - still no network traffic
RpcPromise<string> namePromise = userPromise.Then<string>("getName");

// Only when you await does the request fire
string name = await namePromise;  // Single round trip for entire chain
```

### The Pipeline Expression

You can inspect what will be sent to the server:

```csharp
var promise = client.Call<int[]>("generateNumbers", 10)
    .Select(x => client.Call<int>("square", x));

Console.WriteLine(promise.ExpressionString);
// Output: generateNumbers(10).Select(x => $element.square(x))
```

### Implicit Task Conversion

`RpcPromise<T>` converts implicitly to `Task<T>`:

```csharp
// These are equivalent
string name1 = await client.Call<string>("getName", 42);
Task<string> task = client.Call<string>("getName", 42);
string name2 = await task;
```

---

## Promise Pipelining

The killer feature. Chain dependent calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response:

```csharp
// BAD: Three round trips
var session = await client.Call<AuthSession>("authenticate", token);   // Wait...
var userId = await client.Call<int>("getUserId", session.Token);       // Wait...
var profile = await client.Call<UserProfile>("getProfile", userId);    // Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```csharp
// GOOD: One round trip
var profile = await client.Call<AuthSession>("authenticate", token)
    .Then<int>("getUserId")
    .Then<UserProfile>("getProfile");
```

### How Pipelining Works

1. **Recording phase**: `Call<T>()` and `Then<T>()` return `RpcPromise` objects without sending anything
2. **Pipeline building**: Each operation extends the pipeline expression
3. **Single request**: When you `await`, the entire pipeline is sent
4. **Server resolution**: The server evaluates dependencies and returns results

```csharp
await using var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();

// Build the pipeline (no network yet)
var auth = client.Call<AuthSession>("authenticate", token);
var user = auth.Then<User>("getUser");
var profile = user.Then<UserProfile>("getProfile");
var settings = profile.Then<UserSettings>("getSettings");

// Send and await (one round trip)
UserSettings result = await settings;
```

### Parallel Composition

Use `Task.WhenAll()` for parallel independent calls:

```csharp
// Three independent calls - still benefits from connection reuse
var (greeting, serverTime, stats) = await (
    client.Call<string>("greet", "World").ExecuteAsync(),
    client.Call<DateTime>("getServerTime").ExecuteAsync(),
    client.Call<ServerStats>("getStats").ExecuteAsync()
).WhenAll();

// Helper extension for tuple WhenAll
public static class TupleExtensions
{
    public static async Task<(T1, T2, T3)> WhenAll<T1, T2, T3>(
        this (Task<T1>, Task<T2>, Task<T3>) tasks)
    {
        await Task.WhenAll(tasks.Item1, tasks.Item2, tasks.Item3);
        return (await tasks.Item1, await tasks.Item2, await tasks.Item3);
    }
}
```

---

## Server-Side LINQ Select()

Transform collections on the server to eliminate N+1 round trips. This is the signature feature of Rpc.Do.

### The N+1 Problem

```csharp
// BAD: N+1 round trips
int[] userIds = await client.Call<int[]>("listUserIds");  // 1 round trip
var profiles = new List<UserProfile>();
foreach (var id in userIds)
{
    profiles.Add(await client.Call<UserProfile>("getProfile", id));  // N round trips!
}
```

### The Solution: Server-Side Select()

```csharp
// GOOD: 1 round trip total
UserProfile[] profiles = await client.Call<int[]>("listUserIds")
    .Select(id => client.Call<UserProfile>("getProfile", id));
```

### How Select() Works

1. **Expression capture**: Your lambda is analyzed to build a server-side expression
2. **Pipeline extension**: The Select is appended to the pipeline
3. **Server execution**: The server applies the expression to each array element
4. **Single response**: All results return in one response

```csharp
// Generate Fibonacci numbers and square them - all server-side!
int[] squared = await client.Call<int[]>("generateFibonacci", 10)
    .Select(x => client.Call<int>("square", x));

Console.WriteLine(string.Join(", ", squared));
// Output: 0, 1, 1, 4, 9, 25, 64, 169, 441, 1156
```

### Complex Transformations

Chain multiple operations:

```csharp
// Get users, enrich with profiles, extract display names
string[] displayNames = await client
    .Call<int[]>("getActiveUserIds")
    .Select(id => client.Call<User>("getUser", id))
    .Select(user => client.Call<UserProfile>("getProfile", user.Id))
    .Select(profile => client.Call<string>("formatDisplayName", profile));
```

### Select with Local Transforms

For simple local transformations, use the non-RPC overload:

```csharp
// Server returns users, local code extracts names
string[] names = await client.Call<User[]>("getUsers")
    .Select(user => user.Name);  // This happens locally after the RPC
```

---

## Error Handling

Rpc.Do provides a rich exception hierarchy for different failure scenarios.

### Exception Types

```csharp
try
{
    var user = await client.Call<User>("getUser", invalidId);
}
catch (NotFoundException ex)
{
    // HTTP 404 equivalent
    Console.WriteLine($"User not found: {ex.Message}");
}
catch (UnauthorizedException ex)
{
    // HTTP 401 equivalent
    await RefreshTokenAndRetryAsync();
}
catch (ForbiddenException ex)
{
    // HTTP 403 equivalent
    Console.WriteLine($"Access denied: {ex.Message}");
}
catch (RpcTimeoutException ex)
{
    // Request timed out
    Console.WriteLine("The server took too long to respond");
}
catch (RpcException ex)
{
    // Base class for all RPC errors
    Console.WriteLine($"RPC Error [{ex.ErrorType}]: {ex.Message}");
    if (ex.ErrorCode.HasValue)
    {
        Console.WriteLine($"Error code: {ex.ErrorCode}");
    }
}
```

### Pattern Matching with Exceptions

Use C# pattern matching for elegant error dispatch:

```csharp
try
{
    var result = await client.Call<User>("getUser", userId);
    ProcessUser(result);
}
catch (RpcException ex)
{
    var message = ex switch
    {
        NotFoundException => "User does not exist",
        UnauthorizedException => "Please log in to continue",
        ForbiddenException => "You don't have permission to view this user",
        RpcTimeoutException => "Request timed out, please try again",
        { ErrorType: "RateLimited" } => "Too many requests, slow down",
        { ErrorCode: 500 } => "Internal server error",
        _ => $"Unexpected error: {ex.Message}"
    };

    Console.WriteLine(message);
}
```

### Creating Custom Exceptions

```csharp
public class ValidationException : RpcException
{
    public Dictionary<string, string[]> Errors { get; }

    public ValidationException(string message, Dictionary<string, string[]> errors)
        : base(message, "Validation", 422)
    {
        Errors = errors;
    }
}

// Usage
catch (RpcException ex) when (ex.ErrorType == "Validation")
{
    // Handle validation errors
}
```

### Retry Patterns

Implement exponential backoff for transient failures:

```csharp
public static class RetryPolicy
{
    public static async Task<T> WithRetryAsync<T>(
        Func<Task<T>> operation,
        int maxAttempts = 3,
        TimeSpan? initialDelay = null)
    {
        var delay = initialDelay ?? TimeSpan.FromMilliseconds(100);
        Exception? lastException = null;

        for (int attempt = 0; attempt < maxAttempts; attempt++)
        {
            try
            {
                return await operation();
            }
            catch (RpcTimeoutException ex)
            {
                lastException = ex;
                // Retry on timeout
            }
            catch (RpcException ex) when (ex.ErrorCode >= 500)
            {
                lastException = ex;
                // Retry on server errors
            }
            catch (RpcException)
            {
                // Don't retry client errors (4xx)
                throw;
            }

            if (attempt < maxAttempts - 1)
            {
                await Task.Delay(delay);
                delay *= 2; // Exponential backoff
            }
        }

        throw lastException!;
    }
}

// Usage
var user = await RetryPolicy.WithRetryAsync(
    () => client.Call<User>("getUser", 42).ExecuteAsync()
);
```

---

## Streaming with IAsyncEnumerable

Rpc.Do integrates naturally with C#'s async streams.

### Server-to-Client Streaming

```csharp
public interface IEventService
{
    IAsyncEnumerable<Event> SubscribeEventsAsync(string? filter = null);
}

// Client consumption
await foreach (var evt in eventService.SubscribeEventsAsync("user."))
{
    Console.WriteLine($"Event: {evt.Type} - {evt.Data}");

    if (evt.Type == "user.shutdown")
        break;
}
```

### Streaming with Cancellation

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));

try
{
    await foreach (var item in stream.WithCancellation(cts.Token))
    {
        await ProcessItemAsync(item);
    }
}
catch (OperationCanceledException)
{
    Console.WriteLine("Stream processing cancelled");
}
```

### Buffered Processing

Process streams in batches for efficiency:

```csharp
public static class AsyncEnumerableExtensions
{
    public static async IAsyncEnumerable<T[]> BufferAsync<T>(
        this IAsyncEnumerable<T> source,
        int size,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var buffer = new List<T>(size);

        await foreach (var item in source.WithCancellation(ct))
        {
            buffer.Add(item);
            if (buffer.Count >= size)
            {
                yield return buffer.ToArray();
                buffer.Clear();
            }
        }

        if (buffer.Count > 0)
            yield return buffer.ToArray();
    }
}

// Usage: Process events in batches of 100
await foreach (var batch in eventStream.BufferAsync(100))
{
    await ProcessBatchAsync(batch);
}
```

### Real-time Dashboard Example

```csharp
public class DashboardService : IHostedService
{
    private readonly RpcClient _client;
    private readonly IHubContext<DashboardHub> _hubContext;
    private CancellationTokenSource? _cts;

    public DashboardService(RpcClient client, IHubContext<DashboardHub> hubContext)
    {
        _client = client;
        _hubContext = hubContext;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _ = Task.Run(async () =>
        {
            await foreach (var metric in SubscribeMetricsAsync(_cts.Token))
            {
                await _hubContext.Clients.All.SendAsync("MetricUpdate", metric, _cts.Token);
            }
        }, _cts.Token);
    }

    private async IAsyncEnumerable<Metric> SubscribeMetricsAsync(
        [EnumeratorCancellation] CancellationToken ct)
    {
        await _client.ConnectAsync(ct);

        // Simulated stream - in production this would be an RPC streaming call
        while (!ct.IsCancellationRequested)
        {
            var metrics = await _client.Call<Metric[]>("getLatestMetrics").ExecuteAsync(ct);
            foreach (var metric in metrics)
            {
                yield return metric;
            }
            await Task.Delay(1000, ct);
        }
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _cts?.Cancel();
        return Task.CompletedTask;
    }
}
```

---

## Records and Pattern Matching

Rpc.Do is designed to work beautifully with C# records and pattern matching.

### Using Records for DTOs

```csharp
// Immutable, value-semantic DTOs with records
public record User(
    int Id,
    string Name,
    string Email,
    UserProfile Profile,
    DateTime CreatedAt);

public record UserProfile(
    string DisplayName,
    string? Bio,
    string AvatarUrl,
    UserSettings Settings);

public record UserSettings(
    bool DarkMode,
    string Locale,
    NotificationPrefs Notifications);

public record NotificationPrefs(
    bool Email,
    bool Push,
    bool Sms);

// Clean, expressive code
var user = await client.Call<User>("getUser", 42);
var (id, name, email, profile, _) = user;  // Deconstruction
var updatedUser = user with { Name = "New Name" };  // Non-destructive mutation
```

### Pattern Matching on Results

```csharp
var response = await client.Call<ApiResponse>("getResource", id);

var message = response switch
{
    { Status: "success", Data: User user } => $"Found user: {user.Name}",
    { Status: "success", Data: null } => "Resource found but empty",
    { Status: "error", Error: { Code: "NOT_FOUND" } } => "Resource not found",
    { Status: "error", Error: { Code: "FORBIDDEN" } } => "Access denied",
    { Status: "error", Error: var e } => $"Error: {e?.Message ?? "Unknown"}",
    _ => "Unexpected response format"
};
```

### Discriminated Unions with Records

```csharp
// Base type for union
public abstract record ApiResult;
public record Success<T>(T Value) : ApiResult;
public record Failure(string Error, int Code) : ApiResult;
public record Loading : ApiResult;

// Pattern match exhaustively
ApiResult result = await FetchDataAsync();

var output = result switch
{
    Success<User> { Value: var user } => $"Loaded: {user.Name}",
    Success<User[]> { Value: var users } => $"Loaded {users.Length} users",
    Failure { Error: var msg, Code: 404 } => "Not found",
    Failure { Error: var msg } => $"Failed: {msg}",
    Loading => "Please wait...",
    _ => throw new InvalidOperationException("Unexpected result type")
};
```

### Init-Only Properties

```csharp
public record CreateUserRequest
{
    public required string Name { get; init; }
    public required string Email { get; init; }
    public string? Bio { get; init; }
    public UserRole Role { get; init; } = UserRole.User;
}

// Usage with object initializer
var request = new CreateUserRequest
{
    Name = "Alice",
    Email = "alice@example.com",
    Bio = "Software developer"
};

var user = await client.Call<User>("createUser", request);
```

---

## ASP.NET Core Integration

Integrate Rpc.Do into your ASP.NET Core applications.

### Service Registration

```csharp
// Program.cs
using DotDo.Rpc;

var builder = WebApplication.CreateBuilder(args);

// Register RpcClient as a singleton (single connection)
builder.Services.AddSingleton<RpcClient>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    return new RpcClient(config["RpcEndpoint"] ?? "wss://api.example.do");
});

// Register initialization as a hosted service
builder.Services.AddHostedService<RpcConnectionService>();

var app = builder.Build();
```

### Connection Lifecycle Service

```csharp
public class RpcConnectionService : IHostedService
{
    private readonly RpcClient _client;
    private readonly ILogger<RpcConnectionService> _logger;

    public RpcConnectionService(RpcClient client, ILogger<RpcConnectionService> logger)
    {
        _client = client;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Connecting to RPC server at {Url}", _client.Url);

        try
        {
            await _client.ConnectAsync(cancellationToken);
            _logger.LogInformation("Connected to RPC server");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to RPC server");
            throw;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Disconnecting from RPC server");
        await _client.CloseAsync(cancellationToken);
    }
}
```

### Using in Controllers

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly RpcClient _rpc;
    private readonly ILogger<UsersController> _logger;

    public UsersController(RpcClient rpc, ILogger<UsersController> logger)
    {
        _rpc = rpc;
        _logger = logger;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<UserDto>> GetUser(int id, CancellationToken ct)
    {
        try
        {
            var user = await _rpc.Call<User>("getUser", id).ExecuteAsync(ct);
            return Ok(UserDto.FromDomain(user));
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedException)
        {
            return Unauthorized();
        }
        catch (RpcException ex)
        {
            _logger.LogError(ex, "RPC error getting user {Id}", id);
            return StatusCode(502, "Upstream service error");
        }
    }

    [HttpGet]
    public async Task<ActionResult<UserDto[]>> ListUsers(
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        var userIds = await _rpc.Call<int[]>("listUserIds", limit ?? 100).ExecuteAsync(ct);

        // Server-side mapping - single round trip for all profiles!
        var users = await _rpc.Call<int[]>("listUserIds", limit ?? 100)
            .Select(id => _rpc.Call<User>("getUser", id))
            .ExecuteAsync(ct);

        return Ok(users.Select(UserDto.FromDomain).ToArray());
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> CreateUser(
        CreateUserRequest request,
        CancellationToken ct)
    {
        var user = await _rpc.Call<User>("createUser", request).ExecuteAsync(ct);
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, UserDto.FromDomain(user));
    }
}
```

### Minimal API Example

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<RpcClient>(new RpcClient("wss://api.example.do"));
builder.Services.AddHostedService<RpcConnectionService>();

var app = builder.Build();

app.MapGet("/users/{id}", async (int id, RpcClient rpc, CancellationToken ct) =>
{
    try
    {
        var user = await rpc.Call<User>("getUser", id).ExecuteAsync(ct);
        return Results.Ok(user);
    }
    catch (NotFoundException)
    {
        return Results.NotFound();
    }
});

app.MapGet("/users", async (RpcClient rpc, int? limit, CancellationToken ct) =>
{
    var users = await rpc.Call<int[]>("listUserIds", limit ?? 100)
        .Select(id => rpc.Call<User>("getUser", id))
        .ExecuteAsync(ct);

    return Results.Ok(users);
});

app.MapPost("/users", async (CreateUserRequest req, RpcClient rpc, CancellationToken ct) =>
{
    var user = await rpc.Call<User>("createUser", req).ExecuteAsync(ct);
    return Results.Created($"/users/{user.Id}", user);
});

app.Run();
```

### Health Checks

```csharp
public class RpcHealthCheck : IHealthCheck
{
    private readonly RpcClient _client;

    public RpcHealthCheck(RpcClient client)
    {
        _client = client;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken ct = default)
    {
        if (!_client.IsConnected)
        {
            return HealthCheckResult.Unhealthy("RPC client is not connected");
        }

        try
        {
            // Call a lightweight health endpoint
            var pong = await _client.Call<string>("ping").ExecuteAsync(ct);
            return pong == "pong"
                ? HealthCheckResult.Healthy("RPC connection is healthy")
                : HealthCheckResult.Degraded("Unexpected ping response");
        }
        catch (RpcTimeoutException)
        {
            return HealthCheckResult.Degraded("RPC server is slow to respond");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("RPC health check failed", ex);
        }
    }
}

// Registration
builder.Services.AddHealthChecks()
    .AddCheck<RpcHealthCheck>("rpc");
```

### Middleware for Request Context

```csharp
public class RpcContextMiddleware
{
    private readonly RequestDelegate _next;

    public RpcContextMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Add request context that can be accessed by RPC calls
        var requestId = context.Request.Headers["X-Request-ID"].FirstOrDefault()
            ?? Guid.NewGuid().ToString();

        context.Items["RpcRequestId"] = requestId;

        await _next(context);
    }
}

// Usage in controller
public class MyController : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> Get()
    {
        var requestId = HttpContext.Items["RpcRequestId"] as string;
        // Include requestId in RPC calls for distributed tracing
        // ...
    }
}
```

---

## Dependency Injection Patterns

### Factory Pattern for Multiple Endpoints

```csharp
public interface IRpcClientFactory
{
    RpcClient GetClient(string serviceName);
}

public class RpcClientFactory : IRpcClientFactory, IAsyncDisposable
{
    private readonly IConfiguration _config;
    private readonly ConcurrentDictionary<string, RpcClient> _clients = new();

    public RpcClientFactory(IConfiguration config)
    {
        _config = config;
    }

    public RpcClient GetClient(string serviceName)
    {
        return _clients.GetOrAdd(serviceName, name =>
        {
            var endpoint = _config[$"RpcEndpoints:{name}"]
                ?? throw new InvalidOperationException($"No endpoint configured for {name}");
            return new RpcClient(endpoint);
        });
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var client in _clients.Values)
        {
            await client.DisposeAsync();
        }
        _clients.Clear();
    }
}

// Registration
builder.Services.AddSingleton<IRpcClientFactory, RpcClientFactory>();

// Usage
public class OrderService
{
    private readonly RpcClient _userClient;
    private readonly RpcClient _inventoryClient;

    public OrderService(IRpcClientFactory factory)
    {
        _userClient = factory.GetClient("users");
        _inventoryClient = factory.GetClient("inventory");
    }
}
```

### Scoped Clients with Authentication

```csharp
public interface IAuthenticatedRpcClient : IAsyncDisposable
{
    RpcClient Client { get; }
    string UserId { get; }
}

public class AuthenticatedRpcClient : IAuthenticatedRpcClient
{
    private readonly RpcClient _client;

    public RpcClient Client => _client;
    public string UserId { get; }

    public AuthenticatedRpcClient(RpcClient client, string userId)
    {
        _client = client;
        UserId = userId;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;  // Shared client
}

// Registration with HttpContext
builder.Services.AddScoped<IAuthenticatedRpcClient>(sp =>
{
    var client = sp.GetRequiredService<RpcClient>();
    var httpContext = sp.GetRequiredService<IHttpContextAccessor>().HttpContext;
    var userId = httpContext?.User.FindFirst("sub")?.Value ?? "anonymous";
    return new AuthenticatedRpcClient(client, userId);
});
```

---

## Connection Management

### Connection Options

```csharp
public class RpcClientOptions
{
    public string Endpoint { get; set; } = "";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan KeepAliveInterval { get; set; } = TimeSpan.FromSeconds(30);
    public int MaxRetries { get; set; } = 3;
    public TimeSpan InitialRetryDelay { get; set; } = TimeSpan.FromMilliseconds(100);
}

// Usage
builder.Services.Configure<RpcClientOptions>(
    builder.Configuration.GetSection("Rpc"));

builder.Services.AddSingleton<RpcClient>(sp =>
{
    var options = sp.GetRequiredService<IOptions<RpcClientOptions>>().Value;
    return new RpcClient(options.Endpoint);
});
```

### Reconnection Logic

```csharp
public class ResilientRpcClient : IAsyncDisposable
{
    private readonly string _url;
    private RpcClient? _client;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly ILogger<ResilientRpcClient> _logger;

    public ResilientRpcClient(string url, ILogger<ResilientRpcClient> logger)
    {
        _url = url;
        _logger = logger;
    }

    public async Task<RpcClient> GetClientAsync(CancellationToken ct = default)
    {
        if (_client?.IsConnected == true)
            return _client;

        await _lock.WaitAsync(ct);
        try
        {
            if (_client?.IsConnected == true)
                return _client;

            _client?.Dispose();
            _client = new RpcClient(_url);

            var retryDelay = TimeSpan.FromMilliseconds(100);
            for (int i = 0; i < 5; i++)
            {
                try
                {
                    await _client.ConnectAsync(ct);
                    _logger.LogInformation("Connected to RPC server");
                    return _client;
                }
                catch (Exception ex) when (i < 4)
                {
                    _logger.LogWarning(ex, "Connection attempt {Attempt} failed", i + 1);
                    await Task.Delay(retryDelay, ct);
                    retryDelay *= 2;
                }
            }

            throw new InvalidOperationException("Failed to connect after 5 attempts");
        }
        finally
        {
            _lock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_client != null)
            await _client.DisposeAsync();
        _lock.Dispose();
    }
}
```

---

## Cancellation

All async operations support `CancellationToken`:

### Timeout with CancellationTokenSource

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

try
{
    var result = await client.Call<LargeData>("processData", input)
        .ExecuteAsync(cts.Token);
    Console.WriteLine("Processing complete");
}
catch (OperationCanceledException)
{
    Console.WriteLine("Operation timed out after 10 seconds");
}
```

### Linked Cancellation

```csharp
public async Task<Result> ProcessWithTimeout(
    CancellationToken requestCt,
    TimeSpan timeout)
{
    using var timeoutCts = new CancellationTokenSource(timeout);
    using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
        requestCt, timeoutCts.Token);

    try
    {
        return await client.Call<Result>("process")
            .ExecuteAsync(linkedCts.Token);
    }
    catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
    {
        throw new TimeoutException("Operation timed out");
    }
}
```

### Cancellation in Controllers

```csharp
[HttpGet("{id}")]
public async Task<ActionResult<User>> GetUser(int id, CancellationToken ct)
{
    // ASP.NET Core passes a CancellationToken that cancels when the client disconnects
    var user = await _rpc.Call<User>("getUser", id).ExecuteAsync(ct);
    return Ok(user);
}
```

---

## Serialization

Rpc.Do uses `System.Text.Json` for serialization.

### Default Configuration

```csharp
// The client uses these default options
var options = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};
```

### Custom Serialization Attributes

```csharp
public record Event(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("data")] JsonElement Data,
    [property: JsonPropertyName("ts")] DateTimeOffset Timestamp,
    [property: JsonIgnore] string? LocalOnlyField
);
```

### Custom Converters

```csharp
public class DateOnlyConverter : JsonConverter<DateOnly>
{
    public override DateOnly Read(ref Utf8JsonReader reader, Type typeToConvert,
        JsonSerializerOptions options)
    {
        return DateOnly.Parse(reader.GetString()!);
    }

    public override void Write(Utf8JsonWriter writer, DateOnly value,
        JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToString("yyyy-MM-dd"));
    }
}

// Register converter
var options = new JsonSerializerOptions();
options.Converters.Add(new DateOnlyConverter());
```

### AOT Compatibility

For Native AOT deployment, use source-generated serialization:

```csharp
[JsonSerializable(typeof(User))]
[JsonSerializable(typeof(UserProfile))]
[JsonSerializable(typeof(User[]))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public partial class AppJsonContext : JsonSerializerContext { }

// Configure the context (future API)
var client = new RpcClient("wss://api.example.do", new RpcClientOptions
{
    JsonSerializerContext = AppJsonContext.Default
});
```

---

## Testing

### Mocking RpcClient

```csharp
using Moq;
using Xunit;

public class UserServiceTests
{
    [Fact]
    public async Task GetUser_ReturnsUser()
    {
        // Arrange
        var mockClient = new Mock<IRpcClient>();
        mockClient.Setup(c => c.Call<User>("getUser", 42))
            .ReturnsAsync(new User(42, "Alice", "alice@test.com", new UserProfile("Alice", null, "")));

        var service = new UserService(mockClient.Object);

        // Act
        var user = await service.GetUserAsync(42);

        // Assert
        Assert.Equal("Alice", user.Name);
    }
}
```

### In-Memory Test Server

```csharp
public class MockRpcServer
{
    private readonly Dictionary<string, Func<object?[], object>> _handlers = new();

    public void On<T>(string method, Func<object?[], T> handler)
    {
        _handlers[method] = args => handler(args)!;
    }

    public T Call<T>(string method, params object?[] args)
    {
        if (!_handlers.TryGetValue(method, out var handler))
            throw new InvalidOperationException($"No handler for method: {method}");

        return (T)handler(args);
    }
}

// Usage in tests
[Fact]
public async Task Integration_Pipeline()
{
    var server = new MockRpcServer();
    server.On<int[]>("generateFibonacci", args => new[] { 0, 1, 1, 2, 3, 5, 8 });
    server.On<int>("square", args => (int)args[0]! * (int)args[0]!);

    // Test your pipeline logic
    var result = server.Call<int[]>("generateFibonacci", 7);
    var squared = result.Select(x => server.Call<int>("square", x)).ToArray();

    Assert.Equal(new[] { 0, 1, 1, 4, 9, 25, 64 }, squared);
}
```

### Integration Testing with TestServer

```csharp
public class IntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public IntegrationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Replace real RpcClient with mock
                services.RemoveAll<RpcClient>();
                services.AddSingleton(_ => CreateMockClient());
            });
        });
    }

    [Fact]
    public async Task GetUser_ReturnsOk()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/users/42");

        response.EnsureSuccessStatusCode();
        var user = await response.Content.ReadFromJsonAsync<UserDto>();
        Assert.Equal("Alice", user!.Name);
    }

    private static RpcClient CreateMockClient()
    {
        // Return a mock or test double
        // ...
    }
}
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```csharp
#!/usr/bin/env dotnet run
/**
 * Complete Rpc.Do example: A todo application with pipelining,
 * server-side mapping, and error handling.
 */

using DotDo.Rpc;

// ---- Type Definitions ----

public record User(int Id, string Name, string Email);
public record Todo(int Id, string Title, bool Done, int OwnerId);
public record AuthSession(int UserId, string Token);
public record CreateTodoRequest(string Title);

// ---- Main Application ----

await RunDemoAsync();

static async Task RunDemoAsync()
{
    var token = Environment.GetEnvironmentVariable("API_TOKEN") ?? "demo-token";

    Console.WriteLine("Connecting to Todo API...\n");

    await using var client = new RpcClient("wss://todo.example.do");
    await client.ConnectAsync();

    try
    {
        // ---- Pipelined Authentication ----
        Console.WriteLine("1. Pipelined authentication (one round trip)");

        var user = await client.Call<AuthSession>("authenticate", token)
            .Then<User>("getUser");

        Console.WriteLine($"   Welcome, {user.Name}!");

        // ---- Server-Side Mapping ----
        Console.WriteLine("\n2. Server-side mapping (eliminates N+1)");

        // Generate Fibonacci numbers and square them - all server-side!
        var fibs = await client.Call<int[]>("generateFibonacci", 8);
        Console.WriteLine($"   Fibonacci: [{string.Join(", ", fibs)}]");

        var squared = await client.Call<int[]>("generateFibonacci", 8)
            .Select(x => client.Call<int>("square", x));
        Console.WriteLine($"   Squared:   [{string.Join(", ", squared)}]");

        // ---- Chained Pipeline ----
        Console.WriteLine("\n3. Complex pipeline chain");

        var profileName = await client.Call<AuthSession>("authenticate", token)
            .Then<User>("getUser")
            .Then<UserProfile>("getProfile")
            .Property<string>("DisplayName");

        Console.WriteLine($"   Profile display name: {profileName}");

        // ---- Error Handling ----
        Console.WriteLine("\n4. Error handling with pattern matching");

        try
        {
            await client.Call<Todo>("getTodo", 99999);
        }
        catch (RpcException ex)
        {
            var message = ex switch
            {
                NotFoundException => "   Expected: Todo not found",
                UnauthorizedException => "   Unexpected: Not authorized",
                _ => $"   Error [{ex.ErrorType}]: {ex.Message}"
            };
            Console.WriteLine(message);
        }

        // ---- Records and Deconstruction ----
        Console.WriteLine("\n5. Records and deconstruction");

        var (id, name, email) = user;
        Console.WriteLine($"   User {id}: {name} <{email}>");

        Console.WriteLine("\nDone!");
    }
    catch (RpcException ex)
    {
        Console.Error.WriteLine($"RPC Error: {ex.ErrorType} - {ex.Message}");
    }
}

// Additional model for the example
public record UserProfile(string DisplayName, string? Bio, string AvatarUrl);
```

---

## API Reference

### RpcClient

```csharp
public class RpcClient : IAsyncDisposable
{
    // Constructor
    public RpcClient(string url);

    // Properties
    public string Url { get; }
    public bool IsConnected { get; }

    // Connection
    public Task ConnectAsync(CancellationToken ct = default);
    public Task CloseAsync(CancellationToken ct = default);
    public ValueTask DisposeAsync();

    // RPC calls
    public RpcPromise<T> Call<T>(string method, params object?[] args);
}
```

### RpcPromise<T>

```csharp
public class RpcPromise<T>
{
    // Pipeline building
    public RpcPromise<TResult> Then<TResult>(string method, params object?[] args);
    public RpcPromise<TResult> Property<TResult>(string propertyName);

    // Server-side mapping
    public RpcPromise<TResult[]> Select<TResult>(
        Func<RpcPromise<T>, RpcPromise<TResult>> selector);
    public RpcPromise<TResult[]> Select<TResult>(Func<T, TResult> selector);

    // Execution
    public Task<T> ExecuteAsync(CancellationToken ct = default);
    public TaskAwaiter<T> GetAwaiter();

    // Debugging
    public string ExpressionString { get; }

    // Implicit conversion
    public static implicit operator Task<T>(RpcPromise<T> promise);
}
```

### Exception Types

```csharp
public class RpcException : Exception
{
    public string ErrorType { get; }
    public int? ErrorCode { get; }
}

public class NotFoundException : RpcException { }
public class UnauthorizedException : RpcException { }
public class ForbiddenException : RpcException { }
public class RpcTimeoutException : RpcException { }
```

---

## Best Practices

### 1. Use `await using` for Connection Lifecycle

```csharp
// GOOD: Connection is properly disposed
await using var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();
// ... use client ...
// Automatically disposed

// BAD: Manual disposal can be forgotten
var client = new RpcClient("wss://api.example.do");
await client.ConnectAsync();
// ... use client ...
await client.CloseAsync();  // Easy to forget!
```

### 2. Prefer Records for DTOs

```csharp
// GOOD: Immutable, value semantics, less boilerplate
public record User(int Id, string Name, string Email);

// LESS IDEAL: Mutable, reference semantics
public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
}
```

### 3. Use Select() for Collection Operations

```csharp
// GOOD: Single round trip
var profiles = await client.Call<int[]>("getUserIds")
    .Select(id => client.Call<UserProfile>("getProfile", id));

// BAD: N+1 round trips
var ids = await client.Call<int[]>("getUserIds");
var profiles = new List<UserProfile>();
foreach (var id in ids)
{
    profiles.Add(await client.Call<UserProfile>("getProfile", id));
}
```

### 4. Chain Pipelines for Dependent Calls

```csharp
// GOOD: Single round trip
var settings = await client.Call<AuthSession>("authenticate", token)
    .Then<User>("getUser")
    .Then<UserSettings>("getSettings");

// BAD: Multiple round trips
var session = await client.Call<AuthSession>("authenticate", token);
var user = await client.Call<User>("getUser", session.UserId);
var settings = await client.Call<UserSettings>("getSettings", user.Id);
```

### 5. Use Pattern Matching for Error Handling

```csharp
// GOOD: Exhaustive, expressive
catch (RpcException ex)
{
    var message = ex switch
    {
        NotFoundException => "Not found",
        UnauthorizedException => "Please log in",
        { ErrorCode: >= 500 } => "Server error",
        _ => $"Error: {ex.Message}"
    };
}

// LESS IDEAL: Nested if-else
catch (RpcException ex)
{
    string message;
    if (ex is NotFoundException)
        message = "Not found";
    else if (ex is UnauthorizedException)
        message = "Please log in";
    else if (ex.ErrorCode >= 500)
        message = "Server error";
    else
        message = $"Error: {ex.Message}";
}
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [CapnWeb](https://nuget.org/packages/CapnWeb) | Low-level RPC protocol with source generators |
| [Rpc.Do.AspNetCore](https://nuget.org/packages/Rpc.Do.AspNetCore) | ASP.NET Core integration (coming soon) |
| [Mongo.Do](https://nuget.org/packages/Mongo.Do) | MongoDB client built on Rpc.Do |
| [Database.Do](https://nuget.org/packages/Database.Do) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Modern C#** | Records, pattern matching, nullable references, async streams |
| **Zero boilerplate** | No schemas, no codegen, no build step |
| **One round trip** | Pipelining and server-side Select() by default |
| **Type safety** | Full generics, nullable annotations, IntelliSense |
| **Familiar patterns** | LINQ, async/await, IAsyncDisposable |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
