# PlatformDo

The official Elixir SDK for the DotDo platform. This library provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`platform_do` is the highest-level SDK in the DotDo stack, built on top of:

- **rpc_do** - Type-safe RPC client
- **capnweb_do** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Elixir API using OTP patterns.

```
+------------------+
|   platform_do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc_do       |  <-- RPC client layer
+------------------+
|   capnweb_do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections via Finch
- **Automatic Retries**: Exponential backoff with configurable policies
- **OTP Integration**: Supervised processes with fault tolerance
- **Telemetry Support**: Built-in metrics and tracing
- **NimbleOptions**: Validated configuration

## Requirements

- Elixir 1.14+
- OTP 25+

## Installation

Add to your `mix.exs`:

```elixir
def deps do
  [
    {:platform_do, "~> 0.1.0"}
  ]
end
```

Then run:

```bash
mix deps.get
```

## Quick Start

### Basic Usage

```elixir
# Start the application
{:ok, _} = Application.ensure_all_started(:platform_do)

# Configure the client
DotDo.configure(api_key: System.get_env("DOTDO_API_KEY"))

# Make an RPC call
{:ok, result} = DotDo.call("ai.generate", %{
  prompt: "Hello, world!",
  model: "claude-3"
})

IO.inspect(result)
```

### Supervised Client

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {DotDo,
        api_key: System.get_env("DOTDO_API_KEY"),
        endpoint: "wss://api.dotdo.dev/rpc",
        pool_size: 10
      }
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
```

### Using Named Clients

```elixir
# Start a named client
{:ok, _pid} = DotDo.start_link(
  name: :ai_client,
  api_key: System.get_env("DOTDO_API_KEY")
)

# Use the named client
{:ok, result} = DotDo.call(:ai_client, "ai.generate", %{prompt: "Hello!"})
```

## Configuration

### Options

```elixir
DotDo.start_link(
  # Authentication
  api_key: "your-api-key",
  access_token: "oauth-token",
  headers: %{"X-Custom" => "value"},

  # Endpoint
  endpoint: "wss://api.dotdo.dev/rpc",

  # Connection Pool
  pool_size: 10,
  pool_timeout: :timer.seconds(30),

  # Retry Policy
  max_retries: 3,
  retry_delay: 100,
  retry_max_delay: :timer.seconds(30),
  retry_multiplier: 2.0,

  # Request Settings
  timeout: :timer.seconds(30),

  # Debug
  debug: false,

  # Name (optional)
  name: :my_client
)
```

### Application Config

In `config/config.exs`:

```elixir
config :platform_do,
  api_key: System.get_env("DOTDO_API_KEY"),
  endpoint: "wss://api.dotdo.dev/rpc",
  pool_size: 10,
  timeout: :timer.seconds(30),
  debug: Mix.env() == :dev
```

### Runtime Config

In `config/runtime.exs`:

```elixir
config :platform_do,
  api_key: System.get_env("DOTDO_API_KEY"),
  endpoint: System.get_env("DOTDO_ENDPOINT", "wss://api.dotdo.dev/rpc")
```

## Authentication

### API Key

```elixir
DotDo.start_link(api_key: "your-api-key")
```

### OAuth Token

```elixir
DotDo.start_link(access_token: "oauth-access-token")
```

### Custom Headers

```elixir
DotDo.start_link(
  api_key: "your-api-key",
  headers: %{
    "X-Tenant-ID" => "tenant-123",
    "X-Request-ID" => UUID.uuid4()
  }
)
```

### Dynamic Authentication

```elixir
DotDo.start_link(
  auth_provider: fn ->
    {:ok, token} = MyAuth.fetch_token()
    %{"Authorization" => "Bearer #{token}"}
  end
)
```

## Connection Pooling

The SDK uses Finch for efficient connection pooling:

```elixir
DotDo.start_link(
  pool_size: 20,                      # Maximum concurrent connections
  pool_timeout: :timer.seconds(60)    # Wait up to 60s for available connection
)
```

### Pool Behavior

1. Connections are created on-demand up to `pool_size`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, calls wait up to `pool_timeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```elixir
stats = DotDo.pool_stats()
IO.inspect(stats)
# %{available: 8, in_use: 2, total: 10}
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```elixir
DotDo.start_link(
  max_retries: 5,
  retry_delay: 200,                   # Start with 200ms
  retry_max_delay: :timer.seconds(60), # Cap at 60 seconds
  retry_multiplier: 2.0               # Double each time
)
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Custom Retry Policy

```elixir
retry_policy = fn
  {:error, %DotDo.RateLimitError{retry_after: delay}}, _attempt ->
    Process.sleep(delay)
    :retry

  {:error, %DotDo.ConnectionError{}}, attempt when attempt < 5 ->
    :retry

  _error, _attempt ->
    :stop
end

DotDo.start_link(retry_policy: retry_policy)
```

## Making RPC Calls

### Basic Call

```elixir
{:ok, result} = DotDo.call("method.name", %{param: "value"})
```

### With Timeout Override

```elixir
{:ok, result} = DotDo.call("ai.generate", %{prompt: "Long task..."},
  timeout: :timer.minutes(2)
)
```

### Bang Version

```elixir
# Raises on error
result = DotDo.call!("ai.generate", %{prompt: "Hello!"})
```

### With Named Client

```elixir
{:ok, result} = DotDo.call(:ai_client, "ai.generate", %{prompt: "Hello!"})
```

### Streaming Responses

```elixir
DotDo.stream("ai.generate", %{prompt: "Hello"}, fn chunk ->
  IO.write(chunk)
end)
```

### Stream as Enumerable

```elixir
"ai.generate"
|> DotDo.stream!(%{prompt: "Hello"})
|> Stream.each(&IO.write/1)
|> Stream.run()
```

## Error Handling

### Error Types

```elixir
defmodule DotDo.Error do
  defexception [:message]
end

defmodule DotDo.AuthError do
  defexception [:message]
end

defmodule DotDo.ConnectionError do
  defexception [:message]
end

defmodule DotDo.TimeoutError do
  defexception [:message]
end

defmodule DotDo.RateLimitError do
  defexception [:message, :retry_after]
end

defmodule DotDo.RpcError do
  defexception [:code, :message]
end

defmodule DotDo.PoolExhaustedError do
  defexception [:message]
end
```

### Error Handling Example

```elixir
case DotDo.call("ai.generate", %{prompt: "Hello"}) do
  {:ok, result} ->
    IO.inspect(result)

  {:error, %DotDo.AuthError{message: msg}} ->
    Logger.error("Authentication failed: #{msg}")
    # Re-authenticate

  {:error, %DotDo.RateLimitError{retry_after: delay}} ->
    Logger.warn("Rate limited. Retry after: #{delay}ms")
    Process.sleep(delay)
    # Retry

  {:error, %DotDo.TimeoutError{}} ->
    Logger.warn("Request timed out")

  {:error, %DotDo.RpcError{code: code, message: msg}} ->
    Logger.error("RPC error (#{code}): #{msg}")

  {:error, error} ->
    Logger.error("DotDo error: #{inspect(error)}")
end
```

### Using `with`

```elixir
with {:ok, user} <- DotDo.call("users.get", %{id: user_id}),
     {:ok, posts} <- DotDo.call("posts.list", %{user_id: user["id"]}) do
  {:ok, %{user: user, posts: posts}}
else
  {:error, %DotDo.RpcError{code: 404}} ->
    {:error, :not_found}

  {:error, error} ->
    {:error, error}
end
```

## Collections API

### Working with Collections

```elixir
users = DotDo.collection("users")

# Create a document
:ok = DotDo.Collection.set(users, "user-123", %{
  name: "Alice",
  email: "alice@example.com"
})

# Read a document
{:ok, user} = DotDo.Collection.get(users, "user-123")
IO.inspect(user)

# Update a document
:ok = DotDo.Collection.update(users, "user-123", %{name: "Alice Smith"})

# Delete a document
:ok = DotDo.Collection.delete(users, "user-123")
```

### Querying Collections

```elixir
users = DotDo.collection("users")

# Build a query
{:ok, results} =
  users
  |> DotDo.Query.where(:status, :==, "active")
  |> DotDo.Query.where(:age, :>=, 18)
  |> DotDo.Query.order_by(:created_at, :desc)
  |> DotDo.Query.limit(10)
  |> DotDo.Query.execute()

Enum.each(results, &IO.inspect/1)
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `:==`    | Equal to |
| `:!=`    | Not equal to |
| `:<`     | Less than |
| `:<=`    | Less than or equal |
| `:>`     | Greater than |
| `:>=`    | Greater than or equal |
| `:in`    | In list |
| `:not_in`| Not in list |

## Telemetry

The SDK emits telemetry events for monitoring:

### Events

```elixir
# Request start
[:dotdo, :request, :start]
# metadata: %{method: String.t(), params: map()}

# Request stop
[:dotdo, :request, :stop]
# metadata: %{method: String.t(), duration: integer()}

# Request exception
[:dotdo, :request, :exception]
# metadata: %{method: String.t(), error: term(), duration: integer()}

# Retry
[:dotdo, :retry]
# metadata: %{method: String.t(), attempt: integer(), delay: integer()}
```

### Attaching Handlers

```elixir
:telemetry.attach_many(
  "dotdo-logger",
  [
    [:dotdo, :request, :stop],
    [:dotdo, :request, :exception]
  ],
  fn event, measurements, metadata, _config ->
    Logger.info("#{inspect(event)}: #{inspect(measurements)} #{inspect(metadata)}")
  end,
  nil
)
```

### With Telemetry.Metrics

```elixir
defmodule MyApp.Telemetry do
  import Telemetry.Metrics

  def metrics do
    [
      counter("dotdo.request.stop.count"),
      distribution("dotdo.request.stop.duration",
        unit: {:native, :millisecond}
      ),
      counter("dotdo.retry.count")
    ]
  end
end
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```elixir
# Auth is handled automatically
DotDo.start_link(api_key: System.get_env("DOTDO_API_KEY"))
```

### Usage Metrics

```elixir
# Platform tracks usage automatically
# View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```elixir
# Usage is metered and billed through the platform
# Configure billing at https://platform.do/billing
```

### Centralized Logging

```elixir
# Enable debug mode for verbose logging
DotDo.start_link(debug: true)
```

## Best Practices

### 1. Use Supervision

```elixir
# Good - supervised client
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {DotDo, api_key: System.get_env("DOTDO_API_KEY")}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

### 2. Use Named Clients

```elixir
# Good - named clients for different purposes
children = [
  {DotDo, name: :ai_client, api_key: ai_key, pool_size: 10},
  {DotDo, name: :data_client, api_key: data_key, pool_size: 5}
]

# Use specific client
DotDo.call(:ai_client, "ai.generate", params)
DotDo.call(:data_client, "data.query", params)
```

### 3. Handle All Error Cases

```elixir
# Good - exhaustive pattern matching
case DotDo.call("method", params) do
  {:ok, result} -> handle_success(result)
  {:error, %DotDo.RateLimitError{} = e} -> handle_rate_limit(e)
  {:error, %DotDo.AuthError{} = e} -> handle_auth_error(e)
  {:error, e} -> handle_error(e)
end

# Bad - ignoring errors
{:ok, result} = DotDo.call("method", params)
```

### 4. Use Timeouts

```elixir
# Good - explicit timeout
DotDo.call("ai.generate", params, timeout: :timer.seconds(60))

# Consider operation duration
DotDo.call("data.export", params, timeout: :timer.minutes(5))
```

## API Reference

### DotDo Module

```elixir
# Start a client
@spec start_link(keyword()) :: GenServer.on_start()

# Make an RPC call
@spec call(atom() | pid(), String.t(), map(), keyword()) ::
  {:ok, term()} | {:error, term()}

# Make an RPC call (raises on error)
@spec call!(atom() | pid(), String.t(), map(), keyword()) :: term()

# Stream a response
@spec stream(atom() | pid(), String.t(), map(), (term() -> any())) ::
  :ok | {:error, term()}

# Stream as enumerable
@spec stream!(atom() | pid(), String.t(), map()) :: Enumerable.t()

# Get a collection reference
@spec collection(String.t()) :: DotDo.Collection.t()

# Get pool statistics
@spec pool_stats(atom() | pid()) :: map()

# Configure the default client
@spec configure(keyword()) :: :ok
```

### DotDo.Collection Module

```elixir
@spec get(t(), String.t()) :: {:ok, map()} | {:error, term()}
@spec set(t(), String.t(), map()) :: :ok | {:error, term()}
@spec update(t(), String.t(), map()) :: :ok | {:error, term()}
@spec delete(t(), String.t()) :: :ok | {:error, term()}
```

### DotDo.Query Module

```elixir
@spec where(t(), atom(), atom(), term()) :: t()
@spec order_by(t(), atom(), :asc | :desc) :: t()
@spec limit(t(), non_neg_integer()) :: t()
@spec offset(t(), non_neg_integer()) :: t()
@spec execute(t()) :: {:ok, [map()]} | {:error, term()}
@spec first(t()) :: {:ok, map() | nil} | {:error, term()}
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/elixir)
- [Hex.pm](https://hex.pm/packages/platform_do)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [HexDocs Reference](https://hexdocs.pm/platform_do)
