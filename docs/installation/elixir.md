# Elixir Installation

The Elixir SDK provides OTP-based access to Cap'n Web RPC with supervision trees.

## Installation

Add to your `mix.exs`:

```elixir
def deps do
  [
    {:capnweb, "~> 0.1"}
  ]
end
```

Then run:

```bash
mix deps.get
```

## Requirements

- Elixir 1.14 or later
- OTP 25 or later

## Basic Usage

### Client

```elixir
# Connect and make calls
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# Make RPC calls
{:ok, greeting} = CapnWeb.call(api, :greet, ["World"])
IO.puts(greeting)  # "Hello, World!"

# Using pipe operator
api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()
|> IO.inspect()

# Close connection
CapnWeb.close(api)
```

### With `with` Statement

```elixir
with {:ok, api} <- CapnWeb.connect("wss://api.example.com"),
     {:ok, user} <- CapnWeb.call(api, :get_user, [123]),
     {:ok, profile} <- CapnWeb.call(api, :get_profile, [user.id]) do
  IO.puts("Profile: #{profile.name}")
after
  CapnWeb.close(api)
end
```

### Promise Pipelining

```elixir
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# Pipeline calls (single round trip)
user = CapnWeb.async(api, :get_user, [123])
profile = CapnWeb.call(api, :get_profile, [CapnWeb.field(user, :id)])

IO.puts("Profile: #{profile.name}")
```

## Server Implementation

### Basic Server

```elixir
defmodule MyApi do
  use CapnWeb.RpcTarget

  def greet(name) do
    "Hello, #{name}!"
  end

  def get_user(id) do
    %{
      id: id,
      name: "Alice",
      email: "alice@example.com"
    }
  end
end

# Start server
{:ok, _pid} = CapnWeb.Server.start_link(
  port: 8080,
  path: "/api",
  handler: MyApi
)
```

### Phoenix Integration

```elixir
# In your endpoint.ex
socket "/api", CapnWeb.Phoenix.Socket,
  websocket: [handler: MyApp.Api]

# In your API module
defmodule MyApp.Api do
  use CapnWeb.RpcTarget

  def greet(name) do
    "Hello, #{name}!"
  end
end
```

### With GenServer

```elixir
defmodule MyApi.Server do
  use GenServer
  use CapnWeb.RpcTarget

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def init(opts) do
    {:ok, %{counter: 0}}
  end

  # RPC method
  def increment() do
    GenServer.call(__MODULE__, :increment)
  end

  def handle_call(:increment, _from, state) do
    new_count = state.counter + 1
    {:reply, new_count, %{state | counter: new_count}}
  end
end
```

## Error Handling

```elixir
case CapnWeb.connect("wss://api.example.com") do
  {:ok, api} ->
    case CapnWeb.call(api, :risky_operation, []) do
      {:ok, result} ->
        IO.puts("Success: #{result}")
      {:error, %CapnWeb.RpcError{message: msg}} ->
        IO.puts("RPC failed: #{msg}")
    end
  {:error, %CapnWeb.ConnectionError{reason: reason}} ->
    IO.puts("Connection failed: #{reason}")
end
```

### Using `try/rescue`

```elixir
try do
  {:ok, api} = CapnWeb.connect!("wss://api.example.com")
  result = CapnWeb.call!(api, :risky_operation, [])
  IO.puts("Result: #{result}")
rescue
  e in CapnWeb.RpcError ->
    IO.puts("RPC failed: #{e.message}")
  e in CapnWeb.ConnectionError ->
    IO.puts("Connection failed: #{e.reason}")
end
```

## Configuration

```elixir
# config/config.exs
config :capnweb,
  timeout: 30_000,  # 30 seconds
  reconnect: true,
  pool_size: 10

# Or per-connection
{:ok, api} = CapnWeb.connect("wss://api.example.com",
  timeout: 30_000,
  headers: [{"Authorization", "Bearer #{token}"}]
)
```

## HTTP Batch Mode

```elixir
{:ok, batch} = CapnWeb.http_batch("https://api.example.com")

greeting1 = CapnWeb.async(batch, :greet, ["Alice"])
greeting2 = CapnWeb.async(batch, :greet, ["Bob"])

{:ok, results} = CapnWeb.execute(batch)

IO.puts(CapnWeb.await!(greeting1))
IO.puts(CapnWeb.await!(greeting2))
```

## Supervision

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {CapnWeb.ConnectionPool, [
        name: MyApp.RpcPool,
        url: "wss://api.example.com",
        size: 10
      ]},
      MyApp.ApiSupervisor
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end

# Using the pool
defmodule MyApp.Client do
  def greet(name) do
    CapnWeb.ConnectionPool.call(MyApp.RpcPool, :greet, [name])
  end
end
```

## Streaming and Callbacks

```elixir
defmodule MyCallback do
  use CapnWeb.RpcTarget

  def on_message(message) do
    IO.puts("Received: #{message}")
  end
end

{:ok, api} = CapnWeb.connect("wss://api.example.com")

# Subscribe with callback
callback = MyCallback.new()
CapnWeb.call(api, :subscribe, [callback])

# Messages will be received via on_message/1
```

## Testing

```elixir
defmodule MyApp.ApiTest do
  use ExUnit.Case

  setup do
    # Start mock server
    {:ok, server} = CapnWeb.MockServer.start_link()
    {:ok, server: server}
  end

  test "greet returns greeting", %{server: server} do
    CapnWeb.MockServer.expect(server, :greet, fn [name] ->
      "Hello, #{name}!"
    end)

    {:ok, api} = CapnWeb.connect(server.url)
    {:ok, result} = CapnWeb.call(api, :greet, ["World"])

    assert result == "Hello, World!"
  end
end
```

## Troubleshooting

### Process Crashes

Use supervision:

```elixir
# WRONG - no supervision
{:ok, api} = CapnWeb.connect("wss://...")

# CORRECT - supervised
children = [{CapnWeb.Connection, url: "wss://..."}]
Supervisor.start_link(children, strategy: :one_for_one)
```

### Timeout Errors

Increase timeout for slow operations:

```elixir
# Global config
config :capnweb, timeout: 60_000

# Per-call
CapnWeb.call(api, :slow_operation, [], timeout: 60_000)
```

### Pattern Matching

Remember that calls return `{:ok, result}` or `{:error, reason}`:

```elixir
# WRONG - ignores errors
result = CapnWeb.call(api, :method, [])

# CORRECT - handle both cases
case CapnWeb.call(api, :method, []) do
  {:ok, result} -> result
  {:error, reason} -> handle_error(reason)
end

# Or use bang version
result = CapnWeb.call!(api, :method, [])
```
