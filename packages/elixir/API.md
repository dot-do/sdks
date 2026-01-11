# CapnWeb Elixir API

*A beautiful, idiomatic Elixir client for Cap'n Web RPC*

```elixir
# The essence of CapnWeb for Elixir
user_name = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.profile()
|> CapnWeb.name()
|> CapnWeb.await!()
```

---

## Design Principles

1. **Pipes are first-class** - The `|>` operator drives everything
2. **OTP is the foundation** - Sessions are supervised, faults are expected
3. **Explicit is better than magic** - No hidden network calls
4. **Phoenix belongs here** - Seamless integration with Channels and LiveView
5. **Elixir conventions everywhere** - Tagged tuples, bang functions, behaviours

---

## Quick Start

### Installation

```elixir
# mix.exs
def deps do
  [
    {:capnweb, "~> 1.0"}
  ]
end
```

### Basic Usage

```elixir
# Connect
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# Make a call (single round trip)
{:ok, user} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await()

# Pipeline through capabilities (still single round trip!)
{:ok, name} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.profile()
|> CapnWeb.name()
|> CapnWeb.await()
```

---

## Connection Management

### Simple Connection

```elixir
# Basic WebSocket connection
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# With options
{:ok, api} = CapnWeb.connect("wss://api.example.com",
  timeout: 30_000,
  headers: [{"authorization", "Bearer #{token}"}]
)

# HTTP batch transport (for serverless/edge)
{:ok, api} = CapnWeb.connect("https://api.example.com/rpc",
  transport: :http
)
```

### Supervised Sessions (Production)

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # CapnWeb session as supervised child
      {CapnWeb.Session,
        name: MyApp.API,
        url: "wss://api.example.com",
        reconnect: :exponential,
        max_attempts: 10}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

# Use the supervised session anywhere in your app
api = CapnWeb.session(MyApp.API)

{:ok, user} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await()
```

### Connection Pool

```elixir
# In your supervision tree
{CapnWeb.Pool,
  name: MyApp.APIPool,
  url: "wss://api.example.com",
  size: 10,
  overflow: 5}

# Automatically uses pool
api = CapnWeb.session(MyApp.APIPool)
```

---

## The Pipe Operator

The `|>` operator is central to CapnWeb's design. Every operation returns a pipeable value.

### Stubs and Promises

```elixir
# Property access returns a stub (no network call yet)
users_stub = api |> CapnWeb.users()

# Method calls return a promise (still no network call)
user_promise = users_stub |> CapnWeb.get(123)

# await/await! executes and returns the result
{:ok, user} = user_promise |> CapnWeb.await()
user = user_promise |> CapnWeb.await!()
```

### The Pipeline Secret

**Don't await between operations.** Each `|>` before the final `await` adds to the pipeline:

```elixir
# ONE round trip for all four operations
name = api
|> CapnWeb.users()        # stub
|> CapnWeb.get(123)       # promise (pipelined)
|> CapnWeb.profile()      # chains through promise
|> CapnWeb.name()         # chains further
|> CapnWeb.await!()       # NOW execute everything

# vs THREE round trips (anti-pattern)
user = api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()
profile = user |> CapnWeb.profile() |> CapnWeb.await!()
name = profile |> CapnWeb.name() |> CapnWeb.await!()
```

### Multiple Arguments

```elixir
# Named arguments via keyword list
{:ok, user} = api
|> CapnWeb.users()
|> CapnWeb.create(name: "Alice", email: "alice@example.com")
|> CapnWeb.await()

# Positional arguments via list
{:ok, result} = api
|> CapnWeb.math()
|> CapnWeb.add([1, 2, 3])
|> CapnWeb.await()
```

---

## Promise Batching

### Parallel Execution

```elixir
# Build multiple promises from the same stem
auth = api |> CapnWeb.authenticate(token)

# Execute in a single batch (one round trip)
{:ok, [user_id, permissions, preferences]} = CapnWeb.batch([
  auth |> CapnWeb.user_id(),
  auth |> CapnWeb.permissions(),
  auth |> CapnWeb.preferences()
])
```

### Task Integration

```elixir
# For truly independent calls, use Task
results = [1, 2, 3]
|> Task.async_stream(fn id ->
  api |> CapnWeb.users() |> CapnWeb.get(id) |> CapnWeb.await!()
end, max_concurrency: 10)
|> Enum.map(fn {:ok, user} -> user end)
```

### The Map Operation

Server-side iteration with pipelining:

```elixir
# Get names of all friends (pipelined on server)
{:ok, friend_names} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.friend_ids()
|> CapnWeb.map(fn id ->
  CapnWeb.chain()
  |> CapnWeb.users()
  |> CapnWeb.get(id)
  |> CapnWeb.name()
end)
|> CapnWeb.await()
```

---

## Error Handling

### Tagged Tuples (Idiomatic Elixir)

```elixir
case api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await() do
  {:ok, user} ->
    IO.puts("Found: #{user.name}")

  {:error, %CapnWeb.Error{type: :not_found}} ->
    IO.puts("User not found")

  {:error, %CapnWeb.Error{type: :disconnected}} ->
    IO.puts("Connection lost")
end
```

### Bang Functions

```elixir
# Raises on error
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()

# Catch specific errors
try do
  api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()
rescue
  e in CapnWeb.NotFoundError ->
    Logger.warn("User not found: #{e.message}")
    nil
end
```

### With Blocks (Happy Path)

```elixir
with {:ok, user} <- api |> CapnWeb.users() |> CapnWeb.get(id) |> CapnWeb.await(),
     {:ok, profile} <- api |> CapnWeb.profiles() |> CapnWeb.for(user) |> CapnWeb.await(),
     {:ok, perms} <- api |> CapnWeb.perms() |> CapnWeb.get(profile.role) |> CapnWeb.await() do
  {:ok, %{user: user, profile: profile, permissions: perms}}
end
```

### Pipeline Rescue

```elixir
# Provide fallback on error (like Promise.catch)
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.rescue(fn _error -> default_user() end)
|> CapnWeb.await!()
```

### Timeouts

```elixir
# Per-call timeout
{:ok, user} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await(timeout: 5_000)

# Session-level default
{:ok, api} = CapnWeb.connect("wss://api.example.com",
  default_timeout: 10_000
)
```

---

## Exposing Local Targets

Make local functions callable from the remote server.

### Module-Based Targets

```elixir
defmodule MyApp.NotificationHandler do
  use CapnWeb.Target

  @impl CapnWeb.Target
  def handle(:on_message, %{content: content, sender: sender}) do
    Logger.info("Message from #{sender}: #{content}")
    :ok
  end

  @impl CapnWeb.Target
  def handle(:on_disconnect, reason) do
    Logger.warn("Disconnected: #{reason}")
    :ok
  end
end

# Export and pass to server
{:ok, handler} = CapnWeb.export(api, MyApp.NotificationHandler)

api
|> CapnWeb.notifications()
|> CapnWeb.subscribe(handler)
|> CapnWeb.await!()
```

### Stateful Targets (GenServer)

```elixir
defmodule MyApp.Counter do
  use GenServer
  use CapnWeb.Target

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, 0, opts)
  end

  @impl GenServer
  def init(count), do: {:ok, count}

  @impl CapnWeb.Target
  def handle_rpc(:increment, [], state) do
    {:reply, state + 1, state + 1}
  end

  @impl CapnWeb.Target
  def handle_rpc(:get, [], state) do
    {:reply, state, state}
  end
end

# Start and export
{:ok, counter} = MyApp.Counter.start_link()
{:ok, ref} = CapnWeb.export(api, counter)
```

### Anonymous Targets

```elixir
# Quick callback function
callback = CapnWeb.target(fn event ->
  IO.inspect(event, label: "Event received")
  :ok
end)

api
|> CapnWeb.events()
|> CapnWeb.on(:user_created, callback)
|> CapnWeb.await!()
```

---

## Phoenix Integration

### Channel-Based Transport

```elixir
# lib/my_app_web/channels/rpc_socket.ex
defmodule MyAppWeb.RpcSocket do
  use Phoenix.Socket
  use CapnWeb.Phoenix.Socket

  channel "rpc:*", CapnWeb.Phoenix.Channel

  def connect(%{"token" => token}, socket, _info) do
    case verify_token(token) do
      {:ok, user_id} -> {:ok, assign(socket, :user_id, user_id)}
      :error -> :error
    end
  end

  def id(socket), do: "rpc:#{socket.assigns.user_id}"
end

# Client-side: CapnWeb automatically uses Phoenix channels
{:ok, api} = CapnWeb.connect(socket,
  transport: :phoenix_channel,
  topic: "rpc:main"
)
```

### LiveView Integration

```elixir
defmodule MyAppWeb.UserLive do
  use MyAppWeb, :live_view
  use CapnWeb.Phoenix.LiveView

  def mount(_params, _session, socket) do
    api = CapnWeb.session(MyApp.API)
    {:ok, assign(socket, api: api, user: nil, loading: false)}
  end

  def handle_event("load_user", %{"id" => id}, socket) do
    # Async RPC with automatic LiveView update
    socket = start_async(socket, :load_user, fn ->
      socket.assigns.api
      |> CapnWeb.users()
      |> CapnWeb.get(String.to_integer(id))
      |> CapnWeb.await!()
    end)

    {:noreply, assign(socket, loading: true)}
  end

  def handle_async(:load_user, {:ok, user}, socket) do
    {:noreply, assign(socket, user: user, loading: false)}
  end

  def handle_async(:load_user, {:error, reason}, socket) do
    {:noreply, socket |> put_flash(:error, "Failed: #{reason}") |> assign(loading: false)}
  end
end
```

### PubSub Bridge

```elixir
# Bridge CapnWeb subscriptions to Phoenix PubSub
defmodule MyApp.RpcBridge do
  use GenServer

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def init(opts) do
    api = CapnWeb.session(MyApp.API)

    # Subscribe to remote events
    handler = CapnWeb.target(fn event ->
      # Broadcast to Phoenix PubSub
      Phoenix.PubSub.broadcast(MyApp.PubSub, "events", event)
    end)

    api
    |> CapnWeb.events()
    |> CapnWeb.subscribe(handler)
    |> CapnWeb.await!()

    {:ok, %{api: api}}
  end
end
```

---

## Streaming & GenStage

### Stream Subscriptions

```elixir
# Subscribe returns a Stream
api
|> CapnWeb.events()
|> CapnWeb.subscribe!()
|> Stream.each(fn event ->
  IO.puts("Event: #{event.type}")
end)
|> Stream.run()
```

### Flow Integration

```elixir
# High-throughput parallel processing
api
|> CapnWeb.events()
|> CapnWeb.subscribe!()
|> Flow.from_enumerable(max_demand: 100)
|> Flow.partition(key: {:key, :type})
|> Flow.reduce(fn -> %{} end, fn event, counts ->
  Map.update(counts, event.type, 1, &(&1 + 1))
end)
|> Enum.to_list()
```

### Broadway Producer

```elixir
defmodule MyApp.EventProcessor do
  use Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {CapnWeb.Broadway.Producer,
          session: MyApp.API,
          subscription: [:events, :all]
        },
        concurrency: 1
      ],
      processors: [
        default: [concurrency: 10]
      ],
      batchers: [
        default: [batch_size: 100, batch_timeout: 1000]
      ]
    )
  end

  @impl Broadway
  def handle_message(_processor, message, _context) do
    message
    |> Broadway.Message.update_data(&process_event/1)
  end

  @impl Broadway
  def handle_batch(_batcher, messages, _batch_info, _context) do
    # Batch insert to database
    events = Enum.map(messages, & &1.data)
    MyApp.Repo.insert_all(Event, events)
    messages
  end
end
```

---

## Optional: Type-Safe DSL

For teams wanting compile-time validation, use the optional schema DSL.

### Define Your API

```elixir
defmodule MyApi do
  use CapnWeb.Schema

  endpoint "wss://api.example.com"

  namespace :users do
    call :get, args: [id: :integer], returns: :user
    call :list, args: [limit: :integer], returns: {:list, :user}
    call :create, args: [params: :user_params], returns: :user
  end

  namespace :profiles do
    call :for_user, args: [user: :user], returns: :profile
  end

  # Type definitions
  type :user do
    field :id, :integer
    field :name, :string
    field :email, :string
  end

  type :profile do
    field :bio, :string
    field :avatar_url, :string
  end
end
```

### Use Generated Functions

```elixir
# Connect via schema
{:ok, api} = MyApi.connect()

# Generated functions with IDE completion
user = MyApi.users_get!(api, 123)
# ^ IDE knows user has :id, :name, :email

# Pattern matching on known types
%{name: name, email: email} = MyApi.users_get!(api, 123)

# Compile-time errors for wrong types
# MyApi.users_get!(api, "not_an_integer")  # Won't compile!
```

### Pipeline DSL

```elixir
# Block-based pipeline builder
result = MyApi.pipeline api do
  user = users_get(123)
  profile = profiles_for_user(user)

  # Return tuple
  {user.name, profile.bio}
end
```

---

## Telemetry

CapnWeb emits telemetry events for observability.

```elixir
# Events emitted:
# [:capnweb, :call, :start]
# [:capnweb, :call, :stop]
# [:capnweb, :call, :exception]
# [:capnweb, :connection, :up]
# [:capnweb, :connection, :down]

# Attach handlers
:telemetry.attach_many(
  "capnweb-logger",
  [
    [:capnweb, :call, :stop],
    [:capnweb, :call, :exception]
  ],
  &MyApp.Telemetry.handle_event/4,
  nil
)

# Example handler
defmodule MyApp.Telemetry do
  def handle_event([:capnweb, :call, :stop], measurements, metadata, _config) do
    Logger.info("RPC #{metadata.method} completed in #{measurements.duration}ms")
  end

  def handle_event([:capnweb, :call, :exception], _measurements, metadata, _config) do
    Logger.error("RPC #{metadata.method} failed: #{metadata.reason}")
  end
end
```

---

## Module Reference

### Core Modules

| Module | Purpose |
|--------|---------|
| `CapnWeb` | Main entry point, connection and call functions |
| `CapnWeb.Session` | Supervised GenServer for connections |
| `CapnWeb.Pool` | Connection pooling |
| `CapnWeb.Target` | Behaviour for exposable local objects |
| `CapnWeb.Error` | Error struct and types |

### Phoenix Integration

| Module | Purpose |
|--------|---------|
| `CapnWeb.Phoenix.Socket` | Phoenix socket integration |
| `CapnWeb.Phoenix.Channel` | Channel-based transport |
| `CapnWeb.Phoenix.LiveView` | LiveView helpers |

### Streaming

| Module | Purpose |
|--------|---------|
| `CapnWeb.Stream` | Enumerable subscription streams |
| `CapnWeb.Broadway.Producer` | Broadway producer for subscriptions |

### Optional DSL

| Module | Purpose |
|--------|---------|
| `CapnWeb.Schema` | Compile-time API schema definition |

---

## Complete Example

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Supervised CapnWeb session
      {CapnWeb.Session,
        name: MyApp.API,
        url: System.get_env("API_URL"),
        reconnect: :exponential}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

defmodule MyApp.Users do
  @api CapnWeb.session(MyApp.API)

  def get(id) do
    @api
    |> CapnWeb.users()
    |> CapnWeb.get(id)
    |> CapnWeb.await()
  end

  def get_with_profile(id) do
    # Single round trip for user + profile + settings
    @api
    |> CapnWeb.users()
    |> CapnWeb.get(id)
    |> then(fn user_promise ->
      CapnWeb.batch([
        user_promise,
        user_promise |> CapnWeb.profile(),
        user_promise |> CapnWeb.settings()
      ])
    end)
    |> case do
      {:ok, [user, profile, settings]} ->
        {:ok, %{user: user, profile: profile, settings: settings}}
      {:error, _} = error ->
        error
    end
  end

  def list_with_names(ids) do
    ids
    |> Enum.map(fn id ->
      @api
      |> CapnWeb.users()
      |> CapnWeb.get(id)
      |> CapnWeb.name()
    end)
    |> CapnWeb.batch()
  end
end

defmodule MyApp.NotificationHandler do
  use CapnWeb.Target
  require Logger

  @impl CapnWeb.Target
  def handle(:new_message, %{from: from, content: content}) do
    Logger.info("New message from #{from}: #{content}")
    Phoenix.PubSub.broadcast(MyApp.PubSub, "notifications", {:message, from, content})
    :ok
  end

  @impl CapnWeb.Target
  def handle(:user_online, %{user_id: user_id}) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "presence", {:online, user_id})
    :ok
  end
end

defmodule MyAppWeb.DashboardLive do
  use MyAppWeb, :live_view

  def mount(_params, session, socket) do
    api = CapnWeb.session(MyApp.API)

    # Subscribe to notifications
    if connected?(socket) do
      {:ok, handler} = CapnWeb.export(api, MyApp.NotificationHandler)
      api |> CapnWeb.notifications() |> CapnWeb.subscribe(handler) |> CapnWeb.await!()
      Phoenix.PubSub.subscribe(MyApp.PubSub, "notifications")
    end

    {:ok, assign(socket, api: api, user: nil, messages: [])}
  end

  def handle_event("load_user", %{"id" => id}, socket) do
    socket = start_async(socket, :load_user, fn ->
      socket.assigns.api
      |> CapnWeb.users()
      |> CapnWeb.get(String.to_integer(id))
      |> CapnWeb.profile()
      |> CapnWeb.await!()
    end)

    {:noreply, socket}
  end

  def handle_async(:load_user, {:ok, profile}, socket) do
    {:noreply, assign(socket, user: profile)}
  end

  def handle_info({:message, from, content}, socket) do
    messages = [{from, content} | socket.assigns.messages]
    {:noreply, assign(socket, messages: Enum.take(messages, 50))}
  end
end
```

---

## What Makes This Beautiful

This API design embraces what Elixir developers love:

1. **Pipe operator is king** - Everything flows through `|>`, making code read like prose
2. **OTP supervision built-in** - Production apps get fault tolerance for free
3. **Pattern matching everywhere** - Tagged tuples, destructuring, guards
4. **Explicit execution** - Network calls only happen at `await`, never hidden
5. **Phoenix is a first-class citizen** - Channels, LiveView, PubSub integration
6. **Gradual complexity** - Simple for scripts, powerful for production
7. **Immutable data flow** - No surprises, easy reasoning

The result: RPC that feels like local function calls while respecting the distributed nature of Elixir applications.
