# CapnWeb

**Capability-based RPC for Elixir where `|>` is promise pipelining.**

[![Hex.pm](https://img.shields.io/hexpm/v/capnweb.svg)](https://hex.pm/packages/capnweb)
[![Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/capnweb)

```elixir
# This is a single network round-trip:
name = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.profile()
|> CapnWeb.name()
|> CapnWeb.await!()
```

In most languages, promise pipelining requires special syntax or explicit batching. In Elixir, it is the pipe operator you already use. Chain operations with `|>`, await at the end, and multiple RPC calls collapse into a single network round-trip.

---

## Why Elixir?

The pipe operator **is** promise pipelining. This is not a metaphor:

| Elixir Syntax | Cap'n Web Protocol |
|---------------|-------------------|
| `|> CapnWeb.users()` | Property access on stub |
| `|> CapnWeb.get(123)` | Method call, returns promise |
| `|> CapnWeb.profile()` | Pipelined call through promise |
| `|> CapnWeb.await!()` | Execute pipeline, pull result |

The entire chain becomes a single `["push", ...]` message. The server evaluates `api.users.get(123).profile.name` in one shot. No intermediate awaits, no wasted round-trips.

**OTP is the runtime.** Sessions are GenServers. Supervision trees manage connection lifecycle. Process linking handles cleanup. CapnWeb doesn't fight BEAM - it leverages it.

---

## Installation

Add `capnweb` to your dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:capnweb, "~> 1.0"}
  ]
end
```

Then fetch dependencies:

```bash
mix deps.get
```

---

## Quick Start

```elixir
# Connect to a Cap'n Web server
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# Single round-trip for the entire chain
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()

# Pattern match the result
%{name: name, email: email} = user
IO.puts("Hello, #{name}!")
```

---

## Pipelining in Depth

### The Mental Model

Every call through `|>` builds a **pipeline** - a description of work to be done. Nothing executes until you `await`.

```elixir
# Build the pipeline (no network activity)
pipeline = api
|> CapnWeb.users()        # stub - property access
|> CapnWeb.get(123)       # promise - method call
|> CapnWeb.profile()      # pipelined through promise
|> CapnWeb.settings()     # pipelined further

# Execute everything in one round-trip
result = CapnWeb.await!(pipeline)
```

### The Anti-Pattern: Premature Await

Each `await` forces a round-trip. Avoid this:

```elixir
# BAD: Three round-trips
user = api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()
profile = user |> CapnWeb.profile() |> CapnWeb.await!()
name = profile |> CapnWeb.name() |> CapnWeb.await!()
```

Instead, chain first, await last:

```elixir
# GOOD: One round-trip
name = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.profile()
|> CapnWeb.name()
|> CapnWeb.await!()
```

### Forking Pipelines

Multiple operations can share a common prefix:

```elixir
# Authenticate once
session = api |> CapnWeb.authenticate(token)

# Fork into parallel branches
user_promise = session |> CapnWeb.user()
perms_promise = session |> CapnWeb.permissions()
prefs_promise = session |> CapnWeb.preferences()

# Resolve all branches in one round-trip
{:ok, [user, perms, prefs]} = CapnWeb.batch([
  user_promise,
  perms_promise,
  prefs_promise
])
```

The `batch/1` function executes multiple promises from a shared stem in a single network round-trip.

---

## Error Handling

### Tagged Tuples (Idiomatic Elixir)

```elixir
case api |> CapnWeb.users() |> CapnWeb.get(id) |> CapnWeb.await() do
  {:ok, user} ->
    process_user(user)

  {:error, %CapnWeb.Error{type: :not_found}} ->
    Logger.warning("User #{id} not found")
    nil

  {:error, %CapnWeb.Error{type: :disconnected}} ->
    :reconnect
end
```

### Bang Functions

```elixir
# Raises CapnWeb.Error on failure
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()
```

### Pipeline Rescue

Handle errors without breaking the pipeline:

```elixir
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.rescue(fn
  %CapnWeb.Error{type: :not_found} -> default_user()
  error -> raise error
end)
|> CapnWeb.await!()
```

### When to Use `with`

The `with` construct is appropriate when you need to **use the result** of one call to make another - true data dependencies that cannot be pipelined:

```elixir
# Each call depends on data from the previous result
with {:ok, user} <- api |> CapnWeb.users() |> CapnWeb.get(id) |> CapnWeb.await(),
     {:ok, team} <- api |> CapnWeb.teams() |> CapnWeb.get(user.team_id) |> CapnWeb.await(),
     {:ok, org} <- api |> CapnWeb.orgs() |> CapnWeb.get(team.org_id) |> CapnWeb.await() do
  {:ok, %{user: user, team: team, org: org}}
end
```

Note: This requires 3 round-trips because `user.team_id` and `team.org_id` are data dependencies - we need the actual values to make the next call. This is unavoidable.

However, if the API supports traversal, prefer pipelining:

```elixir
# One round-trip - the server traverses the relationships
org = api
|> CapnWeb.users()
|> CapnWeb.get(id)
|> CapnWeb.team()      # Returns team capability
|> CapnWeb.org()       # Returns org capability
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

## Capabilities: Passing Targets as Arguments

The power of capability-based RPC is that capabilities can flow in both directions. Your client can export local objects for the server to call back.

### Reporter Pattern: Server Calls Client

A common pattern is passing a "reporter" or "callback" capability to a long-running server operation:

```elixir
defmodule MyApp.ProgressReporter do
  use CapnWeb.Target

  @impl CapnWeb.Target
  def handle(:on_progress, %{percent: pct, message: msg}) do
    IO.puts("[#{pct}%] #{msg}")
    :ok
  end

  @impl CapnWeb.Target
  def handle(:on_complete, %{result: result}) do
    IO.puts("Complete: #{inspect(result)}")
    :ok
  end

  @impl CapnWeb.Target
  def handle(:on_error, %{error: error}) do
    IO.puts("Error: #{error}")
    :ok
  end
end

# Export the reporter as a capability
{:ok, reporter} = CapnWeb.export(api, MyApp.ProgressReporter)

# Pass it to a server method - server will call back with progress
api
|> CapnWeb.jobs()
|> CapnWeb.start_import(file_url, reporter)  # <-- Capability as argument
|> CapnWeb.await!()

# Server now has a reference to YOUR reporter and can call it:
# reporter.on_progress(%{percent: 25, message: "Parsing..."})
# reporter.on_progress(%{percent: 50, message: "Validating..."})
# reporter.on_complete(%{result: %{imported: 1000}})
```

### Stateful Callbacks with GenServer

When your callback needs state, use a GenServer:

```elixir
defmodule MyApp.StreamCollector do
  use GenServer
  use CapnWeb.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def get_results(pid) do
    GenServer.call(pid, :get_results)
  end

  # GenServer callbacks
  @impl GenServer
  def init(_opts) do
    {:ok, %{items: [], count: 0}}
  end

  @impl GenServer
  def handle_call(:get_results, _from, state) do
    {:reply, Enum.reverse(state.items), state}
  end

  # RPC Target callbacks - called by remote server
  @impl CapnWeb.Target
  def handle_rpc(:on_item, [item], state) do
    new_state = %{state | items: [item | state.items], count: state.count + 1}
    {:reply, :ok, new_state}
  end

  @impl CapnWeb.Target
  def handle_rpc(:on_done, [], state) do
    {:reply, state.count, state}
  end
end

# Start supervised collector
{:ok, collector} = MyApp.StreamCollector.start_link([])

# Export and pass to server
{:ok, collector_cap} = CapnWeb.export(api, collector)

api
|> CapnWeb.data()
|> CapnWeb.stream_query("SELECT * FROM users", collector_cap)
|> CapnWeb.await!()

# Server streamed items to our collector
results = MyApp.StreamCollector.get_results(collector)
```

### Bidirectional Communication

Capabilities enable true bidirectional patterns:

```elixir
defmodule MyApp.ChatClient do
  use GenServer
  use CapnWeb.Target

  def start_link(api, room_id) do
    GenServer.start_link(__MODULE__, {api, room_id})
  end

  def send_message(pid, text) do
    GenServer.call(pid, {:send, text})
  end

  @impl GenServer
  def init({api, room_id}) do
    # Export ourselves so server can call us
    {:ok, me} = CapnWeb.export(api, self())

    # Join room, passing our capability
    room = api
    |> CapnWeb.rooms()
    |> CapnWeb.join(room_id, me)  # Server now has reference to us
    |> CapnWeb.await!()

    {:ok, %{room: room, api: api}}
  end

  @impl GenServer
  def handle_call({:send, text}, _from, state) do
    # Call server through room capability
    result = state.room
    |> CapnWeb.send_message(text)
    |> CapnWeb.await()

    {:reply, result, state}
  end

  # Server calls us when messages arrive
  @impl CapnWeb.Target
  def handle_rpc(:on_message, [%{sender: sender, text: text}], state) do
    IO.puts("#{sender}: #{text}")
    {:reply, :ok, state}
  end

  @impl CapnWeb.Target
  def handle_rpc(:on_user_joined, [%{user: user}], state) do
    IO.puts("* #{user} joined the room")
    {:reply, :ok, state}
  end
end
```

---

## Server-Side Iteration with Map

When you have a collection on the server and want to transform each element, use `CapnWeb.map/2` to avoid N round-trips:

```elixir
# Get names of all friends in a SINGLE round-trip
{:ok, friend_names} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.friend_ids()
|> CapnWeb.map(fn id, root ->
  # `id` is each item from friend_ids
  # `root` is a reference back to the API root for pipelining
  root
  |> CapnWeb.users()
  |> CapnWeb.get(id)
  |> CapnWeb.name()
end)
|> CapnWeb.await()
```

The mapper function receives:
- `id` - The current element from the collection
- `root` - A stub referencing the API root, allowing you to make pipelined calls

The entire map operation executes server-side. The wire protocol uses `["remap", ...]` with captured instructions - no round-trip per item.

### Map with External Capabilities

Map can also capture capabilities from your current scope:

```elixir
# Cache service is a separate capability
cache = api |> CapnWeb.cache()

# Map over items, calling cache for each
{:ok, enriched} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.friend_ids()
|> CapnWeb.map(fn id, root ->
  root
  |> CapnWeb.users()
  |> CapnWeb.get(id)
end, captures: [cache])  # Cache is captured in the closure
|> CapnWeb.await()
```

---

## Resource Lifecycle

### The Release Protocol

When you're done with a capability, the protocol sends a `["release", importId, refcount]` message to notify the server. This allows garbage collection of server-side resources.

In Elixir, this happens automatically through process linking and supervision.

### Supervised Sessions Handle Cleanup

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {CapnWeb.Session,
        name: MyApp.API,
        url: "wss://api.example.com",
        reconnect: :exponential}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end
```

When `MyApp.API` is stopped or crashes:
1. The WebSocket connection closes
2. The server receives disconnection notification
3. All capabilities exported to that session are released server-side

### Manual Release

For fine-grained control, explicitly release capabilities:

```elixir
# Get a capability
{:ok, session} = api |> CapnWeb.authenticate(token) |> CapnWeb.await()

# Use it...
user = session |> CapnWeb.user() |> CapnWeb.await!()

# Explicitly release when done (sends release message)
:ok = CapnWeb.release(session)
```

### Capability Scope with `with_capability`

Ensure cleanup even if code raises:

```elixir
CapnWeb.with_capability api |> CapnWeb.authenticate(token) do
  fn session ->
    # session is automatically released when this block exits
    session |> CapnWeb.do_work() |> CapnWeb.await!()
  end
end
```

### Process Death = Release

When a process holding a capability dies, release messages are sent automatically:

```elixir
# Spawn a task that holds a capability
task = Task.async(fn ->
  {:ok, session} = api |> CapnWeb.authenticate(token) |> CapnWeb.await()
  # ... use session ...
end)

# If we kill the task, session is released
Task.shutdown(task, :brutal_kill)  # Release message sent
```

---

## OTP Integration

### Supervised Sessions

For production, always supervise your sessions:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # Main API connection
      {CapnWeb.Session,
        name: MyApp.API,
        url: System.get_env("API_URL"),
        reconnect: :exponential,
        max_attempts: :infinity,
        on_connect: &MyApp.RPC.on_connect/1,
        on_disconnect: &MyApp.RPC.on_disconnect/1}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

defmodule MyApp.RPC do
  require Logger

  def on_connect(session) do
    Logger.info("RPC connected")
  end

  def on_disconnect(reason) do
    Logger.warning("RPC disconnected: #{inspect(reason)}")
  end

  def api, do: CapnWeb.session(MyApp.API)
end
```

Use anywhere in your application:

```elixir
user = MyApp.RPC.api()
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()
```

### Connection Pooling

For high-throughput applications:

```elixir
children = [
  {CapnWeb.Pool,
    name: MyApp.APIPool,
    url: "wss://api.example.com",
    size: 10,
    overflow: 5}
]

# Automatically uses a connection from the pool
api = CapnWeb.session(MyApp.APIPool)
```

### Dynamic Sessions per User

```elixir
defmodule MyApp.UserSessions do
  use DynamicSupervisor

  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def init(_opts) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  def get_or_start(user_id, token) do
    name = {:via, Registry, {MyApp.SessionRegistry, user_id}}

    case CapnWeb.session(name) do
      {:ok, session} -> {:ok, session}
      {:error, :not_found} -> start_session(user_id, token, name)
    end
  end

  defp start_session(user_id, token, name) do
    spec = {CapnWeb.Session,
      name: name,
      url: "wss://api.example.com",
      headers: [{"authorization", "Bearer #{token}"}]}

    case DynamicSupervisor.start_child(__MODULE__, spec) do
      {:ok, _pid} -> CapnWeb.session(name)
      {:error, {:already_started, _}} -> CapnWeb.session(name)
      error -> error
    end
  end
end
```

---

## Phoenix Integration

### LiveView

```elixir
defmodule MyAppWeb.UserLive do
  use MyAppWeb, :live_view

  def mount(_params, _session, socket) do
    {:ok, assign(socket, user: nil, loading: false)}
  end

  def handle_event("load_user", %{"id" => id}, socket) do
    # Use start_async for non-blocking RPC
    socket = start_async(socket, :load_user, fn ->
      MyApp.RPC.api()
      |> CapnWeb.users()
      |> CapnWeb.get(String.to_integer(id))
      |> CapnWeb.profile()
      |> CapnWeb.await!()
    end)

    {:noreply, assign(socket, loading: true)}
  end

  def handle_async(:load_user, {:ok, profile}, socket) do
    {:noreply, assign(socket, user: profile, loading: false)}
  end

  def handle_async(:load_user, {:exit, reason}, socket) do
    {:noreply,
     socket
     |> put_flash(:error, "Failed to load user: #{inspect(reason)}")
     |> assign(loading: false)}
  end
end
```

### PubSub Bridge

Route RPC events to Phoenix PubSub:

```elixir
defmodule MyApp.RpcEventBridge do
  use GenServer
  use CapnWeb.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl GenServer
  def init(_opts) do
    api = MyApp.RPC.api()

    # Export ourselves as event handler
    {:ok, handler} = CapnWeb.export(api, self())

    # Subscribe to server events, passing our capability
    api
    |> CapnWeb.events()
    |> CapnWeb.subscribe(handler)
    |> CapnWeb.await!()

    {:ok, %{api: api}}
  end

  # Server calls these methods when events occur
  @impl CapnWeb.Target
  def handle_rpc(:on_event, [event], state) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "rpc:events", {:rpc_event, event})
    {:reply, :ok, state}
  end

  @impl CapnWeb.Target
  def handle_rpc(:on_user_update, [user], state) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "users:#{user.id}", {:user_updated, user})
    {:reply, :ok, state}
  end
end
```

LiveViews can then subscribe to these events:

```elixir
def mount(%{"id" => id}, _session, socket) do
  if connected?(socket) do
    Phoenix.PubSub.subscribe(MyApp.PubSub, "users:#{id}")
  end
  {:ok, assign(socket, user_id: id)}
end

def handle_info({:user_updated, user}, socket) do
  {:noreply, assign(socket, user: user)}
end
```

### Channel Transport

Use Phoenix Channels as the transport layer:

```elixir
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
```

---

## Telemetry

CapnWeb emits telemetry events for observability:

```elixir
# Events emitted:
# [:capnweb, :call, :start]     - RPC call started
# [:capnweb, :call, :stop]      - RPC call completed
# [:capnweb, :call, :exception] - RPC call failed
# [:capnweb, :connection, :up]       - Connected
# [:capnweb, :connection, :down]     - Disconnected
# [:capnweb, :connection, :reconnect] - Reconnecting
# [:capnweb, :release, :sent]  - Release message sent

:telemetry.attach_many(
  "capnweb-logger",
  [
    [:capnweb, :call, :stop],
    [:capnweb, :call, :exception],
    [:capnweb, :release, :sent]
  ],
  &MyApp.Telemetry.handle_event/4,
  nil
)

defmodule MyApp.Telemetry do
  require Logger

  def handle_event([:capnweb, :call, :stop], measurements, metadata, _config) do
    Logger.info("RPC #{inspect(metadata.path)} completed",
      duration_ms: measurements.duration / 1_000_000
    )
  end

  def handle_event([:capnweb, :call, :exception], _measurements, metadata, _config) do
    Logger.error("RPC #{inspect(metadata.path)} failed: #{inspect(metadata.error)}")
  end

  def handle_event([:capnweb, :release, :sent], _measurements, metadata, _config) do
    Logger.debug("Released capability #{metadata.import_id}")
  end
end
```

---

## Configuration

### Application Config

```elixir
# config/config.exs
config :capnweb,
  default_timeout: 30_000,
  reconnect_strategy: :exponential,
  reconnect_base_delay: 1_000,
  reconnect_max_delay: 30_000,
  telemetry_prefix: [:my_app, :rpc]
```

### Per-Session Options

```elixir
{:ok, api} = CapnWeb.connect("wss://api.example.com",
  timeout: 30_000,
  headers: [{"authorization", "Bearer #{token}"}],
  reconnect: :exponential,
  max_attempts: 10,
  transport: :websocket
)
```

### HTTP Batch Transport

For serverless or edge environments:

```elixir
{:ok, api} = CapnWeb.connect("https://api.example.com/rpc",
  transport: :http
)
```

---

## Type Specifications

CapnWeb provides comprehensive typespecs:

```elixir
@spec connect(String.t(), keyword()) :: {:ok, CapnWeb.Session.t()} | {:error, term()}
@spec await(CapnWeb.Promise.t()) :: {:ok, term()} | {:error, CapnWeb.Error.t()}
@spec await!(CapnWeb.Promise.t()) :: term()
@spec batch([CapnWeb.Promise.t()]) :: {:ok, [term()]} | {:error, CapnWeb.Error.t()}
@spec export(CapnWeb.Session.t(), module() | pid()) :: {:ok, CapnWeb.Capability.t()} | {:error, term()}
@spec release(CapnWeb.Capability.t()) :: :ok
```

Use Dialyzer for static analysis:

```elixir
# mix.exs
def project do
  [
    dialyzer: [plt_add_apps: [:capnweb]]
  ]
end
```

---

## Complete Example

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {Registry, keys: :unique, name: MyApp.SessionRegistry},
      MyApp.UserSessions,
      {CapnWeb.Session,
        name: MyApp.API,
        url: System.get_env("API_URL"),
        reconnect: :exponential},
      MyApp.RpcEventBridge
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

defmodule MyApp.Users do
  @moduledoc "User operations via Cap'n Web RPC"

  def api, do: CapnWeb.session(MyApp.API)

  @spec get(integer()) :: {:ok, map()} | {:error, CapnWeb.Error.t()}
  def get(id) do
    api()
    |> CapnWeb.users()
    |> CapnWeb.get(id)
    |> CapnWeb.await()
  end

  @spec get_with_profile(integer()) :: {:ok, map()} | {:error, CapnWeb.Error.t()}
  def get_with_profile(id) do
    # Single round-trip: pipeline through user to profile
    api()
    |> CapnWeb.users()
    |> CapnWeb.get(id)
    |> CapnWeb.profile()
    |> CapnWeb.await()
  end

  @spec get_full(integer()) :: {:ok, map()} | {:error, CapnWeb.Error.t()}
  def get_full(id) do
    # Fork pipeline for parallel fetches
    user_promise = api() |> CapnWeb.users() |> CapnWeb.get(id)

    with {:ok, [user, profile, settings]} <- CapnWeb.batch([
           user_promise,
           user_promise |> CapnWeb.profile(),
           user_promise |> CapnWeb.settings()
         ]) do
      {:ok, %{user: user, profile: profile, settings: settings}}
    end
  end

  @spec import_users(String.t(), pid()) :: {:ok, integer()} | {:error, term()}
  def import_users(file_url, progress_reporter) do
    # Pass capability for progress callbacks
    {:ok, reporter_cap} = CapnWeb.export(api(), progress_reporter)

    api()
    |> CapnWeb.users()
    |> CapnWeb.import_batch(file_url, reporter_cap)
    |> CapnWeb.await()
  end
end

defmodule MyApp.ImportProgress do
  use GenServer
  use CapnWeb.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(opts) do
    {:ok, %{callback: opts[:on_progress], total: 0}}
  end

  @impl CapnWeb.Target
  def handle_rpc(:on_progress, [%{current: current, total: total}], state) do
    if state.callback, do: state.callback.(current, total)
    {:reply, :ok, %{state | total: total}}
  end

  @impl CapnWeb.Target
  def handle_rpc(:on_complete, [%{imported: count}], state) do
    {:reply, :ok, %{state | total: count}}
  end
end

defmodule MyAppWeb.UserImportLive do
  use MyAppWeb, :live_view

  def mount(_params, _session, socket) do
    {:ok, assign(socket, progress: 0, importing: false)}
  end

  def handle_event("start_import", %{"url" => url}, socket) do
    # Start progress reporter that sends updates to this LiveView
    {:ok, reporter} = MyApp.ImportProgress.start_link(
      on_progress: fn current, total ->
        send(self(), {:progress, current, total})
      end
    )

    # Start async import
    socket = start_async(socket, :import, fn ->
      MyApp.Users.import_users(url, reporter)
    end)

    {:noreply, assign(socket, importing: true, progress: 0)}
  end

  def handle_info({:progress, current, total}, socket) do
    progress = if total > 0, do: round(current / total * 100), else: 0
    {:noreply, assign(socket, progress: progress)}
  end

  def handle_async(:import, {:ok, {:ok, count}}, socket) do
    {:noreply,
     socket
     |> put_flash(:info, "Imported #{count} users")
     |> assign(importing: false, progress: 100)}
  end

  def handle_async(:import, {:ok, {:error, reason}}, socket) do
    {:noreply,
     socket
     |> put_flash(:error, "Import failed: #{inspect(reason)}")
     |> assign(importing: false)}
  end
end
```

---

## Security

### Capability Discipline

Capabilities are unforgeable references. Never:

- Serialize capability IDs manually
- Store capability references in databases
- Pass capabilities to untrusted code

The protocol handles capability passing securely through the import/export tables.

### Authentication

Authenticate at connection time:

```elixir
{:ok, api} = CapnWeb.connect("wss://api.example.com",
  headers: [{"authorization", "Bearer #{token}"}]
)
```

Or through the bootstrap interface:

```elixir
{:ok, api} = CapnWeb.connect("wss://api.example.com")

session = api
|> CapnWeb.authenticate(credentials)
|> CapnWeb.await!()

# `session` is now the authenticated capability
```

### Least Privilege

Only export the capabilities you need to expose:

```elixir
# Good: Export minimal interface
{:ok, reporter} = CapnWeb.export(api, MyApp.ProgressReporter)

# Bad: Don't export overly-privileged modules
# {:ok, admin} = CapnWeb.export(api, MyApp.AdminOperations)  # Don't do this
```

---

## License

MIT
