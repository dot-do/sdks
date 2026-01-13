# .NET Installation (C# / F#)

The .NET SDK provides async/await-based access to Cap'n Web RPC for C# and F#.

## Installation

```bash
dotnet add package CapnWeb
```

Or add to your `.csproj`:

```xml
<PackageReference Include="CapnWeb" Version="0.1.0" />
```

## Requirements

- .NET 6.0 or later
- C# 10+ (for file-scoped namespaces, etc.)
- F# 6+ (for F# usage)

## C# Usage

### Basic Client

```csharp
using CapnWeb;

// Connect to server
await using var session = await CapnWeb.ConnectAsync("wss://api.example.com");

// Make RPC calls
var greeting = await session.CallAsync<string>("greet", "World");
Console.WriteLine(greeting);  // "Hello, World!"
```

### Typed Stubs

```csharp
using CapnWeb;

// Define your API interface
public interface IMyApi : IRpcTarget
{
    Task<string> GreetAsync(string name);
    Task<User> GetUserAsync(int id);
}

public record User(int Id, string Name, string Email);

// Usage
await using var session = await CapnWeb.ConnectAsync<IMyApi>("wss://api.example.com");

var greeting = await session.Api.GreetAsync("World");
Console.WriteLine(greeting);

var user = await session.Api.GetUserAsync(123);
Console.WriteLine($"User: {user.Name}");
```

### Promise Pipelining

```csharp
using CapnWeb;

await using var session = await CapnWeb.ConnectAsync("wss://api.example.com");

// Start call without awaiting
var userPromise = session.CallAsync("getUser", 123);

// Pipeline another call using the promise
var profile = await session.CallAsync<Profile>("getProfile", userPromise.Field("id"));

Console.WriteLine($"Profile: {profile.Name}");
```

### Server Implementation

```csharp
using CapnWeb;
using Microsoft.AspNetCore.Builder;

public class MyApi : RpcTarget, IMyApi
{
    public Task<string> GreetAsync(string name)
    {
        return Task.FromResult($"Hello, {name}!");
    }

    public Task<User> GetUserAsync(int id)
    {
        return Task.FromResult(new User(id, "Alice", "alice@example.com"));
    }
}

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/api", async context =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var webSocket = await context.WebSockets.AcceptWebSocketAsync();
        await CapnWeb.ServeAsync(webSocket, new MyApi());
    }
});

app.Run();
```

## F# Usage

### Basic Client

```fsharp
open CapnWeb

let main () = task {
    use! session = CapnWeb.ConnectAsync("wss://api.example.com")

    let! greeting = session.CallAsync<string>("greet", "World")
    printfn "%s" greeting  // "Hello, World!"
}
```

### Typed Stubs

```fsharp
open CapnWeb

type User = { Id: int; Name: string; Email: string }

type IMyApi =
    inherit IRpcTarget
    abstract member GreetAsync: string -> Task<string>
    abstract member GetUserAsync: int -> Task<User>

let main () = task {
    use! session = CapnWeb.ConnectAsync<IMyApi>("wss://api.example.com")

    let! greeting = session.Api.GreetAsync("World")
    printfn "%s" greeting

    let! user = session.Api.GetUserAsync(123)
    printfn "User: %s" user.Name
}
```

### Server Implementation

```fsharp
open CapnWeb

type MyApi() =
    inherit RpcTarget()
    interface IMyApi with
        member _.GreetAsync(name) =
            Task.FromResult(sprintf "Hello, %s!" name)
        member _.GetUserAsync(id) =
            Task.FromResult({ Id = id; Name = "Alice"; Email = "alice@example.com" })
```

## Error Handling

### C#

```csharp
try
{
    await using var session = await CapnWeb.ConnectAsync("wss://api.example.com");
    var result = await session.CallAsync<string>("riskyOperation");
}
catch (RpcException ex)
{
    Console.WriteLine($"RPC failed: {ex.Message}");
}
catch (ConnectionException ex)
{
    Console.WriteLine($"Connection lost: {ex.Message}");
}
```

### F#

```fsharp
try
    use! session = CapnWeb.ConnectAsync("wss://api.example.com")
    let! result = session.CallAsync<string>("riskyOperation")
    ()
with
| :? RpcException as ex ->
    printfn "RPC failed: %s" ex.Message
| :? ConnectionException as ex ->
    printfn "Connection lost: %s" ex.Message
```

## Configuration Options

```csharp
var session = await CapnWeb.ConnectAsync("wss://api.example.com", options =>
{
    options.Timeout = TimeSpan.FromSeconds(30);
    options.Headers.Add("Authorization", $"Bearer {token}");
    options.Reconnect = true;
});
```

## HTTP Batch Mode

```csharp
await using var batch = CapnWeb.HttpBatch("https://api.example.com");

var greeting1 = batch.CallAsync<string>("greet", "Alice");
var greeting2 = batch.CallAsync<string>("greet", "Bob");

await batch.ExecuteAsync();

Console.WriteLine(await greeting1);
Console.WriteLine(await greeting2);
```

## ASP.NET Core Integration

### Minimal API

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<MyApi>();

var app = builder.Build();

app.UseWebSockets();

app.Map("/api", async (HttpContext context, MyApi api) =>
{
    if (context.WebSockets.IsWebSocketRequest)
    {
        var ws = await context.WebSockets.AcceptWebSocketAsync();
        await CapnWeb.ServeAsync(ws, api);
    }
    else
    {
        context.Response.StatusCode = 400;
    }
});

app.Run();
```

### Controller-based

```csharp
[ApiController]
[Route("[controller]")]
public class RpcController : ControllerBase
{
    private readonly MyApi _api;

    public RpcController(MyApi api)
    {
        _api = api;
    }

    [HttpGet("/api")]
    public async Task<IActionResult> WebSocket()
    {
        if (HttpContext.WebSockets.IsWebSocketRequest)
        {
            var ws = await HttpContext.WebSockets.AcceptWebSocketAsync();
            await CapnWeb.ServeAsync(ws, _api);
            return new EmptyResult();
        }
        return BadRequest();
    }
}
```

## Dependency Injection

```csharp
// Registration
builder.Services.AddSingleton<IRpcSession>(sp =>
    CapnWeb.ConnectAsync<IMyApi>("wss://api.example.com").Result);

// Usage
public class MyService
{
    private readonly IRpcSession<IMyApi> _session;

    public MyService(IRpcSession<IMyApi> session)
    {
        _session = session;
    }

    public async Task<string> GreetAsync(string name)
    {
        return await _session.Api.GreetAsync(name);
    }
}
```

## Troubleshooting

### Disposal Issues

Always use `await using` for async disposal:

```csharp
// WRONG - may not dispose properly
using var session = await CapnWeb.ConnectAsync("wss://...");

// CORRECT - async disposal
await using var session = await CapnWeb.ConnectAsync("wss://...");
```

### Deadlocks

Don't block on async code:

```csharp
// WRONG - can deadlock
var result = session.CallAsync<string>("method").Result;

// CORRECT - use await
var result = await session.CallAsync<string>("method");
```

### JSON Serialization

Use System.Text.Json attributes for custom serialization:

```csharp
public record User(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("email")] string Email
);
```
