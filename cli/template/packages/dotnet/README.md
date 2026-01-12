# {{Name}}.Do

[![NuGet](https://img.shields.io/nuget/v/{{Name}}.Do.svg)](https://www.nuget.org/packages/{{Name}}.Do)

{{Name}}.do SDK for .NET - {{description}}

## Installation

```bash
dotnet add package {{Name}}.Do
```

## Quick Start

```csharp
using {{Name}}.Do;

// Create client with API key
await using var client = new {{Name}}Client(new {{Name}}ClientOptions
{
    ApiKey = Environment.GetEnvironmentVariable("DOTDO_KEY")
});

// Connect to the service
await client.ConnectAsync();

// Make RPC calls through the client
var rpc = client.Rpc;
// ...
```

## Configuration

```csharp
var client = new {{Name}}Client(new {{Name}}ClientOptions
{
    ApiKey = "your-api-key",
    BaseUrl = "https://{{name}}.do",           // Custom endpoint
    Timeout = TimeSpan.FromSeconds(30)          // Connection timeout
});
```

## Error Handling

```csharp
try
{
    await client.ConnectAsync();
    // ...
}
catch ({{Name}}AuthException ex)
{
    Console.WriteLine($"Authentication failed: {ex}");
}
catch ({{Name}}ConnectionException ex)
{
    Console.WriteLine($"Connection failed: {ex}");
}
catch ({{Name}}Exception ex)
{
    Console.WriteLine($"Error: {ex}");
}
```

## Async/Await Pattern

The client implements `IAsyncDisposable` for proper resource cleanup:

```csharp
await using var client = new {{Name}}Client("api-key");
await client.ConnectAsync();
// Client automatically disconnects when disposed
```

## License

MIT
