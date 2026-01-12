# rpc.do

**The magic proxy that makes any `.do` service feel like native Elixir.**

[![Hex.pm](https://img.shields.io/hexpm/v/rpc_do.svg)](https://hex.pm/packages/rpc_do)
[![Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/rpc_do)

```elixir
# The pipe operator IS promise pipelining:
name = RPC.mongo()
|> RPC.users()
|> RPC.find_one(%{_id: user_id})
|> RPC.profile()
|> RPC.name()
|> RPC.await!()
```

One import. Any `.do` service. Zero boilerplate.

---

## What is rpc.do?

`rpc_do` is the managed RPC layer for the `.do` ecosystem. It sits between raw [capnweb](https://hex.pm/packages/capnweb) (the protocol) and domain-specific SDKs like `mongo.do`, `kafka.do`, `database.do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `RPC.service().anything().you().want()` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls with `|>`, pay one round trip
4. **Authenticate seamlessly** - Integrates with `oauth.do`
5. **Supervise connections** - Full OTP integration with supervision trees

```
Your Code
    |
    v
+----------+     +----------+     +-------------+
|  rpc_do  | --> | capnweb  | --> | *.do Server |
+----------+     +----------+     +-------------+
    |
    +--- Magic proxy (RPC.service().method())
    +--- Auto-routing (mongo.do, kafka.do, etc.)
    +--- Promise pipelining via |>
    +--- OTP supervision & fault tolerance
    +--- Broadway/GenStage streaming
```

---

## rpc.do vs capnweb

| Feature | capnweb | rpc_do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| OAuth integration | No | Yes |
| Promise pipelining | Yes | Yes (enhanced) |
| Server-side `rmap` | Yes | Yes (enhanced) |
| OTP supervision | Manual | Built-in |
| Broadway integration | No | Yes |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc_do** when you're calling `.do` services and want maximum flexibility with Elixir idioms.

---

## Installation

Add `rpc_do` to your dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:rpc_do, "~> 0.1.0"}
  ]
end
```

Then fetch dependencies:

```bash
mix deps.get
```

Requires Elixir 1.14+ and OTP 25+.

---

## Quick Start

### The Magic Proxy

The `RPC` module provides a magic proxy. Every function call routes to a `.do` domain:

```elixir
# Import for convenient access
import RPC

# RPC.mongo() -> mongo.do
# RPC.stripe() -> stripe.do
# RPC.github() -> github.do

# Find users in MongoDB
users = mongo()
|> users()
|> find(%{status: "active"})
|> await!()

# Create a Stripe charge
charge = stripe()
|> charges()
|> create(%{
  amount: 2000,
  currency: "usd",
  source: "tok_visa"
})
|> await!()

# Call any .do service
result = myservice()
|> do_something(arg1: "value")
|> await!()
```

### How Does It Work?

When you access `RPC.mongo()`, the proxy:

1. Resolves `mongo` to `mongo.do`
2. Establishes a WebSocket connection to `wss://mongo.do/rpc`
3. Authenticates using your `RPC_DO_TOKEN` environment variable
4. Returns a capability stub for making RPC calls
5. Pools and reuses the connection for subsequent calls

```elixir
# These all route automatically:
RPC.mongo()          # -> wss://mongo.do/rpc
RPC.database()       # -> wss://database.do/rpc
RPC.agents()         # -> wss://agents.do/rpc
RPC.workflows()      # -> wss://workflows.do/rpc
RPC.functions()      # -> wss://functions.do/rpc
```

### Authentication

Set your API token as an environment variable:

```bash
export RPC_DO_TOKEN="your-api-token"
```

Or configure in your application:

```elixir
# config/config.exs
config :rpc_do,
  token: System.get_env("RPC_DO_TOKEN"),
  default_timeout: 30_000
```

Or pass it explicitly:

```elixir
{:ok, api} = RPC.connect("wss://api.example.do",
  token: "your-api-token",
  headers: [{"x-custom-header", "value"}]
)
```

---

## Why Elixir?

The pipe operator **is** promise pipelining. This is not a metaphor:

| Elixir Syntax | Cap'n Web Protocol |
|---------------|-------------------|
| `\|> RPC.users()` | Property access on stub |
| `\|> RPC.get(123)` | Method call, returns promise |
| `\|> RPC.profile()` | Pipelined call through promise |
| `\|> RPC.await!()` | Execute pipeline, pull result |

The entire chain becomes a single `["push", ...]` message. The server evaluates `api.users.get(123).profile.name` in one shot. No intermediate awaits, no wasted round-trips.

**OTP is the runtime.** Sessions are GenServers. Supervision trees manage connection lifecycle. Process linking handles cleanup. rpc_do doesn't fight BEAM - it leverages it.

---

## Pipelining in Depth

### The Mental Model

Every call through `|>` builds a **pipeline** - a description of work to be done. Nothing executes until you `await`.

```elixir
# Build the pipeline (no network activity)
pipeline = api
|> RPC.users()        # stub - property access
|> RPC.get(123)       # promise - method call
|> RPC.profile()      # pipelined through promise
|> RPC.settings()     # pipelined further

# Execute everything in one round-trip
result = RPC.await!(pipeline)
```

### The Anti-Pattern: Premature Await

Each `await` forces a round-trip. Avoid this:

```elixir
# BAD: Three round-trips
user = api |> RPC.users() |> RPC.get(123) |> RPC.await!()
profile = user |> RPC.profile() |> RPC.await!()
name = profile |> RPC.name() |> RPC.await!()
```

Instead, chain first, await last:

```elixir
# GOOD: One round-trip
name = api
|> RPC.users()
|> RPC.get(123)
|> RPC.profile()
|> RPC.name()
|> RPC.await!()
```

### Forking Pipelines

Multiple operations can share a common prefix:

```elixir
# Authenticate once
session = api |> RPC.authenticate(token)

# Fork into parallel branches
user_promise = session |> RPC.user()
perms_promise = session |> RPC.permissions()
prefs_promise = session |> RPC.preferences()

# Resolve all branches in one round-trip
{:ok, [user, perms, prefs]} = RPC.batch([
  user_promise,
  perms_promise,
  prefs_promise
])
```

The `batch/1` function executes multiple promises from a shared stem in a single network round-trip.

### Cross-Service Pipelining

Pipeline across different `.do` services:

```elixir
# Get user from database, then enrich from multiple services
user = RPC.database() |> RPC.users() |> RPC.get(user_id)

# All resolve together in minimal round trips
{:ok, [user_data, avatar, activity, subscription]} = RPC.batch([
  user,
  RPC.storage() |> RPC.avatars() |> RPC.get(user |> RPC.avatar_id()),
  RPC.analytics() |> RPC.users() |> RPC.activity(user |> RPC.id()),
  RPC.billing() |> RPC.subscriptions() |> RPC.get(user |> RPC.subscription_id())
])
```

---

## Server-Side Map with rmap

Transform collections on the server to avoid N+1 round-trips.

### The N+1 Problem

```elixir
# BAD: N+1 round trips
user_ids = api |> RPC.users() |> RPC.list_ids() |> RPC.await!()

profiles = Enum.map(user_ids, fn id ->
  api |> RPC.profiles() |> RPC.get(id) |> RPC.await!()  # N round trips!
end)
```

### The Solution: rmap

```elixir
# GOOD: 1 round trip total
profiles = api
|> RPC.users()
|> RPC.list()
|> RPC.rmap(fn user ->
  user |> RPC.profile()
end)
|> RPC.await!()

# Complex transforms with captured references
enriched = api
|> RPC.users()
|> RPC.list()
|> RPC.rmap(fn user ->
  %{
    id: user |> RPC.id(),
    name: user |> RPC.name(),
    profile: RPC.profiles() |> RPC.get(user |> RPC.id()),
    avatar: RPC.storage() |> RPC.avatars() |> RPC.get(user |> RPC.avatar_id())
  }
end)
|> RPC.await!()
```

### How rmap Works

The mapping function is serialized and sent to the server. The server applies the expression to each array element and returns results in one response:

```elixir
# This block
fn user -> user |> RPC.email() end

# Becomes this expression sent to server
"user => user.email"
```

### rmap Constraints

| Allowed | Not Allowed |
|---------|-------------|
| Property access | Arbitrary code execution |
| Method calls on captured refs | Async operations |
| Simple expressions | Side effects |
| Captured capability refs | Local variables |

```elixir
# GOOD: Simple property access
emails = api
|> RPC.mongo()
|> RPC.users()
|> RPC.find(%{})
|> RPC.rmap(fn u -> u |> RPC.email() end)
|> RPC.await!()

# GOOD: Captured service references
storage = RPC.storage()

enriched = api
|> RPC.mongo()
|> RPC.users()
|> RPC.find(%{})
|> RPC.rmap(fn u ->
  %{user: u, avatar: storage |> RPC.avatars() |> RPC.get(u |> RPC.avatar_id())}
end)
|> RPC.await!()

# BAD: Arbitrary function calls (won't work)
fn u -> custom_transform(u) end

# BAD: Local database queries (won't work)
fn u -> MyApp.Repo.get(User, u.id) end
```

For complex transformations, fetch and transform locally:

```elixir
users = api |> RPC.mongo() |> RPC.users() |> RPC.find(%{}) |> RPC.await!()
transformed = Enum.map(users, &custom_transform/1)
```

### Additional Collection Operations

```elixir
# Filter remotely
active_users = api
|> RPC.users()
|> RPC.list()
|> RPC.rfilter(fn user ->
  user |> RPC.active?()
end)
|> RPC.await!()

# Reduce remotely
total = api
|> RPC.orders()
|> RPC.amounts()
|> RPC.rreduce(0, fn amount, acc ->
  acc + amount
end)
|> RPC.await!()
```

---

## Error Handling

### Tagged Tuples (Idiomatic Elixir)

```elixir
case api |> RPC.users() |> RPC.get(id) |> RPC.await() do
  {:ok, user} ->
    process_user(user)

  {:error, %RPC.Error{type: :not_found}} ->
    Logger.warning("User #{id} not found")
    nil

  {:error, %RPC.Error{type: :disconnected}} ->
    :reconnect

  {:error, %RPC.Error{type: :timeout}} ->
    Logger.error("Request timed out")
    :retry
end
```

### Bang Functions

```elixir
# Raises RPC.Error on failure
user = api
|> RPC.users()
|> RPC.get(123)
|> RPC.await!()
```

### Pattern Matching with Guards

```elixir
defmodule MyApp.Users do
  def fetch(id) do
    case RPC.mongo() |> RPC.users() |> RPC.find_one(%{_id: id}) |> RPC.await() do
      {:ok, nil} -> {:error, :not_found}
      {:ok, user} -> {:ok, user}
      {:error, %RPC.Error{type: type}} when type in [:timeout, :disconnected] -> {:error, :transient}
      {:error, error} -> {:error, error}
    end
  end
end
```

### Pipeline Rescue

Handle errors without breaking the pipeline:

```elixir
user = api
|> RPC.users()
|> RPC.get(123)
|> RPC.rescue(fn
  %RPC.Error{type: :not_found} -> default_user()
  error -> raise error
end)
|> RPC.await!()
```

### When to Use `with`

The `with` construct is appropriate when you need to **use the result** of one call to make another - true data dependencies that cannot be pipelined:

```elixir
# Each call depends on data from the previous result
with {:ok, user} <- api |> RPC.users() |> RPC.get(id) |> RPC.await(),
     {:ok, team} <- api |> RPC.teams() |> RPC.get(user.team_id) |> RPC.await(),
     {:ok, org} <- api |> RPC.orgs() |> RPC.get(team.org_id) |> RPC.await() do
  {:ok, %{user: user, team: team, org: org}}
end
```

Note: This requires 3 round-trips because `user.team_id` and `team.org_id` are data dependencies - we need the actual values to make the next call. This is unavoidable.

However, if the API supports traversal, prefer pipelining:

```elixir
# One round-trip - the server traverses the relationships
org = api
|> RPC.users()
|> RPC.get(id)
|> RPC.team()      # Returns team capability
|> RPC.org()       # Returns org capability
|> RPC.await!()
```

### Error Hierarchy

```
RPC.Error
  RPC.ConnectionError     # Network/transport failures
  RPC.TimeoutError        # Request timed out
  RPC.NotFoundError       # Resource not found
  RPC.PermissionError     # Access denied
  RPC.ValidationError     # Invalid arguments
```

### Retry with Exponential Backoff

```elixir
defmodule MyApp.RPC.Retry do
  @max_attempts 3
  @base_delay 1_000
  @max_delay 30_000

  def with_retry(fun, opts \\ []) do
    max_attempts = Keyword.get(opts, :max_attempts, @max_attempts)
    do_retry(fun, 0, max_attempts, nil)
  end

  defp do_retry(_fun, attempt, max_attempts, last_error) when attempt >= max_attempts do
    {:error, last_error}
  end

  defp do_retry(fun, attempt, max_attempts, _last_error) do
    case fun.() do
      {:ok, result} ->
        {:ok, result}

      {:error, %RPC.Error{type: type} = error}
      when type in [:timeout, :disconnected, :connection_error] ->
        delay = calculate_delay(attempt)
        Process.sleep(delay)
        do_retry(fun, attempt + 1, max_attempts, error)

      {:error, error} ->
        # Don't retry client errors
        {:error, error}
    end
  end

  defp calculate_delay(attempt) do
    delay = @base_delay * :math.pow(2, attempt) |> round()
    jitter = :rand.uniform(round(delay * 0.1))
    min(delay + jitter, @max_delay)
  end
end

# Usage
{:ok, user} = MyApp.RPC.Retry.with_retry(fn ->
  RPC.mongo() |> RPC.users() |> RPC.find_one(%{_id: id}) |> RPC.await()
end)
```

### Timeouts

```elixir
# Per-call timeout
{:ok, user} = api
|> RPC.users()
|> RPC.get(123)
|> RPC.await(timeout: 5_000)

# Session-level default
{:ok, api} = RPC.connect("wss://api.example.com",
  default_timeout: 10_000
)
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
      {RPC.Session,
        name: MyApp.API,
        url: System.get_env("API_URL"),
        reconnect: :exponential,
        max_attempts: :infinity,
        on_connect: &MyApp.RPC.on_connect/1,
        on_disconnect: &MyApp.RPC.on_disconnect/1}
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end

defmodule MyApp.RPC do
  require Logger

  def on_connect(session) do
    Logger.info("RPC connected to #{session.url}")
  end

  def on_disconnect(reason) do
    Logger.warning("RPC disconnected: #{inspect(reason)}")
  end

  def api, do: RPC.session(MyApp.API)
end
```

Use anywhere in your application:

```elixir
user = MyApp.RPC.api()
|> RPC.users()
|> RPC.get(123)
|> RPC.await!()
```

### Connection Pooling

For high-throughput applications:

```elixir
children = [
  {RPC.Pool,
    name: MyApp.APIPool,
    url: "wss://api.example.com",
    size: 10,
    overflow: 5}
]

# Automatically uses a connection from the pool
api = RPC.session(MyApp.APIPool)
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

    case RPC.session(name) do
      {:ok, session} -> {:ok, session}
      {:error, :not_found} -> start_session(user_id, token, name)
    end
  end

  defp start_session(user_id, token, name) do
    spec = {RPC.Session,
      name: name,
      url: "wss://api.example.com",
      headers: [{"authorization", "Bearer #{token}"}]}

    case DynamicSupervisor.start_child(__MODULE__, spec) do
      {:ok, _pid} -> RPC.session(name)
      {:error, {:already_started, _}} -> RPC.session(name)
      error -> error
    end
  end
end
```

### GenServer-Based Stateful Service

```elixir
defmodule MyApp.OrderProcessor do
  use GenServer

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def process_order(order_id) do
    GenServer.call(__MODULE__, {:process, order_id})
  end

  @impl GenServer
  def init(_opts) do
    {:ok, api} = RPC.connect("wss://orders.do")
    {:ok, %{api: api, processed: 0}}
  end

  @impl GenServer
  def handle_call({:process, order_id}, _from, state) do
    result = state.api
    |> RPC.orders()
    |> RPC.get(order_id)
    |> RPC.process()
    |> RPC.await()

    case result do
      {:ok, processed} ->
        {:reply, {:ok, processed}, %{state | processed: state.processed + 1}}
      {:error, _} = error ->
        {:reply, error, state}
    end
  end

  @impl GenServer
  def handle_info({:rpc_disconnected, reason}, state) do
    Logger.warning("RPC disconnected: #{inspect(reason)}")
    # Session will auto-reconnect if configured
    {:noreply, state}
  end
end
```

---

## Capabilities: Passing Targets as Arguments

The power of capability-based RPC is that capabilities can flow in both directions. Your client can export local objects for the server to call back.

### Reporter Pattern: Server Calls Client

A common pattern is passing a "reporter" or "callback" capability to a long-running server operation:

```elixir
defmodule MyApp.ProgressReporter do
  use RPC.Target

  @impl RPC.Target
  def handle(:on_progress, %{percent: pct, message: msg}) do
    IO.puts("[#{pct}%] #{msg}")
    :ok
  end

  @impl RPC.Target
  def handle(:on_complete, %{result: result}) do
    IO.puts("Complete: #{inspect(result)}")
    :ok
  end

  @impl RPC.Target
  def handle(:on_error, %{error: error}) do
    IO.puts("Error: #{error}")
    :ok
  end
end

# Export the reporter as a capability
{:ok, reporter} = RPC.export(api, MyApp.ProgressReporter)

# Pass it to a server method - server will call back with progress
api
|> RPC.jobs()
|> RPC.start_import(file_url, reporter)  # <-- Capability as argument
|> RPC.await!()

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
  use RPC.Target

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
  @impl RPC.Target
  def handle_rpc(:on_item, [item], state) do
    new_state = %{state | items: [item | state.items], count: state.count + 1}
    {:reply, :ok, new_state}
  end

  @impl RPC.Target
  def handle_rpc(:on_done, [], state) do
    {:reply, state.count, state}
  end
end

# Start supervised collector
{:ok, collector} = MyApp.StreamCollector.start_link([])

# Export and pass to server
{:ok, collector_cap} = RPC.export(api, collector)

api
|> RPC.data()
|> RPC.stream_query("SELECT * FROM users", collector_cap)
|> RPC.await!()

# Server streamed items to our collector
results = MyApp.StreamCollector.get_results(collector)
```

### Bidirectional Communication

Capabilities enable true bidirectional patterns:

```elixir
defmodule MyApp.ChatClient do
  use GenServer
  use RPC.Target

  def start_link(api, room_id) do
    GenServer.start_link(__MODULE__, {api, room_id})
  end

  def send_message(pid, text) do
    GenServer.call(pid, {:send, text})
  end

  @impl GenServer
  def init({api, room_id}) do
    # Export ourselves so server can call us
    {:ok, me} = RPC.export(api, self())

    # Join room, passing our capability
    room = api
    |> RPC.rooms()
    |> RPC.join(room_id, me)  # Server now has reference to us
    |> RPC.await!()

    {:ok, %{room: room, api: api}}
  end

  @impl GenServer
  def handle_call({:send, text}, _from, state) do
    # Call server through room capability
    result = state.room
    |> RPC.send_message(text)
    |> RPC.await()

    {:reply, result, state}
  end

  # Server calls us when messages arrive
  @impl RPC.Target
  def handle_rpc(:on_message, [%{sender: sender, text: text}], state) do
    IO.puts("#{sender}: #{text}")
    {:reply, :ok, state}
  end

  @impl RPC.Target
  def handle_rpc(:on_user_joined, [%{user: user}], state) do
    IO.puts("* #{user} joined the room")
    {:reply, :ok, state}
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
      |> RPC.users()
      |> RPC.get(String.to_integer(id))
      |> RPC.profile()
      |> RPC.await!()
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

### LiveView with Real-Time Updates

```elixir
defmodule MyAppWeb.DashboardLive do
  use MyAppWeb, :live_view
  use RPC.Target

  def mount(_params, _session, socket) do
    if connected?(socket) do
      # Subscribe to real-time updates
      {:ok, handler} = RPC.export(MyApp.RPC.api(), self())

      MyApp.RPC.api()
      |> RPC.events()
      |> RPC.subscribe(handler)
      |> RPC.await!()
    end

    {:ok, assign(socket, events: [], stats: %{})}
  end

  # Server calls this when events occur
  @impl RPC.Target
  def handle_rpc(:on_event, [event], socket) do
    send(self(), {:new_event, event})
    {:reply, :ok, socket}
  end

  def handle_info({:new_event, event}, socket) do
    events = [event | socket.assigns.events] |> Enum.take(100)
    {:noreply, assign(socket, events: events)}
  end
end
```

### PubSub Bridge

Route RPC events to Phoenix PubSub:

```elixir
defmodule MyApp.RpcEventBridge do
  use GenServer
  use RPC.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl GenServer
  def init(_opts) do
    api = MyApp.RPC.api()

    # Export ourselves as event handler
    {:ok, handler} = RPC.export(api, self())

    # Subscribe to server events, passing our capability
    api
    |> RPC.events()
    |> RPC.subscribe(handler)
    |> RPC.await!()

    {:ok, %{api: api}}
  end

  # Server calls these methods when events occur
  @impl RPC.Target
  def handle_rpc(:on_event, [event], state) do
    Phoenix.PubSub.broadcast(MyApp.PubSub, "rpc:events", {:rpc_event, event})
    {:reply, :ok, state}
  end

  @impl RPC.Target
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

### Phoenix Controllers

```elixir
defmodule MyAppWeb.UserController do
  use MyAppWeb, :controller

  def index(conn, params) do
    case fetch_users(params) do
      {:ok, users} ->
        render(conn, :index, users: users)

      {:error, %RPC.Error{type: :timeout}} ->
        conn
        |> put_flash(:error, "Request timed out. Please try again.")
        |> redirect(to: ~p"/")

      {:error, error} ->
        conn
        |> put_status(:internal_server_error)
        |> render(:error, error: error)
    end
  end

  def show(conn, %{"id" => id}) do
    case MyApp.RPC.api() |> RPC.users() |> RPC.get(id) |> RPC.await() do
      {:ok, user} ->
        render(conn, :show, user: user)

      {:error, %RPC.Error{type: :not_found}} ->
        conn
        |> put_status(:not_found)
        |> render(MyAppWeb.ErrorHTML, :"404")

      {:error, error} ->
        conn
        |> put_status(:internal_server_error)
        |> render(:error, error: error)
    end
  end

  defp fetch_users(params) do
    MyApp.RPC.api()
    |> RPC.users()
    |> RPC.search(query: params["q"], page: params["page"] || 1, per_page: 20)
    |> RPC.await()
  end
end
```

### Channel Transport

Use Phoenix Channels as the transport layer:

```elixir
defmodule MyAppWeb.RpcSocket do
  use Phoenix.Socket
  use RPC.Phoenix.Socket

  channel "rpc:*", RPC.Phoenix.Channel

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

## Streaming with GenStage and Broadway

### GenStage Producer

```elixir
defmodule MyApp.EventProducer do
  use GenStage
  use RPC.Target

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl GenStage
  def init(opts) do
    {:ok, api} = RPC.connect(opts[:url])
    {:ok, handler} = RPC.export(api, self())

    # Subscribe to server events
    api
    |> RPC.events()
    |> RPC.subscribe(handler)
    |> RPC.await!()

    {:producer, %{api: api, events: :queue.new(), demand: 0}}
  end

  @impl GenStage
  def handle_demand(incoming_demand, state) do
    {events, new_state} = take_events(incoming_demand + state.demand, state)
    {:noreply, events, new_state}
  end

  # Server calls this when events occur
  @impl RPC.Target
  def handle_rpc(:on_event, [event], state) do
    new_events = :queue.in(event, state.events)
    {events, new_state} = take_events(state.demand, %{state | events: new_events})
    {:noreply, events, new_state}
  end

  defp take_events(demand, state) when demand > 0 do
    case :queue.out(state.events) do
      {{:value, event}, new_queue} ->
        {more_events, final_state} = take_events(demand - 1, %{state | events: new_queue})
        {[event | more_events], final_state}
      {:empty, _} ->
        {[], %{state | demand: demand}}
    end
  end

  defp take_events(_demand, state), do: {[], state}
end
```

### GenStage Consumer

```elixir
defmodule MyApp.EventConsumer do
  use GenStage

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl GenStage
  def init(_opts) do
    {:consumer, %{}, subscribe_to: [{MyApp.EventProducer, max_demand: 100}]}
  end

  @impl GenStage
  def handle_events(events, _from, state) do
    Enum.each(events, fn event ->
      process_event(event)
    end)

    {:noreply, [], state}
  end

  defp process_event(event) do
    Logger.info("Processing event: #{inspect(event)}")
    # Your event processing logic
  end
end
```

### Flow for Parallel Processing

```elixir
defmodule MyApp.UserEnricher do
  def enrich_all_users do
    MyApp.RPC.api()
    |> RPC.users()
    |> RPC.list_ids()
    |> RPC.await!()
    |> Flow.from_enumerable(max_demand: 50, stages: 4)
    |> Flow.map(fn user_id ->
      # Each mapper builds a pipeline
      MyApp.RPC.api()
      |> RPC.users()
      |> RPC.get(user_id)
      |> RPC.profile()
      |> RPC.await!()
    end)
    |> Flow.partition(key: {:key, :region}, stages: 4)
    |> Flow.reduce(fn -> %{} end, fn profile, acc ->
      region = profile.region
      Map.update(acc, region, [profile], &[profile | &1])
    end)
    |> Enum.to_list()
  end
end
```

### Broadway Integration

Broadway provides robust, fault-tolerant event processing:

```elixir
defmodule MyApp.EventBroadway do
  use Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {RPC.Broadway.Producer,
          url: "wss://events.do",
          subscription: [:events, :all],
          token: System.get_env("RPC_DO_TOKEN")
        },
        concurrency: 1
      ],
      processors: [
        default: [concurrency: 10]
      ],
      batchers: [
        default: [
          batch_size: 100,
          batch_timeout: 1_000
        ],
        analytics: [
          batch_size: 500,
          batch_timeout: 5_000
        ]
      ]
    )
  end

  @impl Broadway
  def handle_message(_, message, _) do
    event = message.data

    case event.type do
      "user." <> _ ->
        message
        |> Message.update_data(&process_user_event/1)
        |> Message.put_batcher(:default)

      "analytics." <> _ ->
        message
        |> Message.update_data(&process_analytics_event/1)
        |> Message.put_batcher(:analytics)

      _ ->
        message
    end
  end

  @impl Broadway
  def handle_batch(:default, messages, _batch_info, _context) do
    # Process user events in batches
    events = Enum.map(messages, & &1.data)
    MyApp.Users.sync_batch(events)
    messages
  end

  @impl Broadway
  def handle_batch(:analytics, messages, _batch_info, _context) do
    # Bulk insert analytics events
    events = Enum.map(messages, & &1.data)
    MyApp.Analytics.insert_batch(events)
    messages
  end

  defp process_user_event(event) do
    %{type: event.type, user_id: event.user_id, data: event.data}
  end

  defp process_analytics_event(event) do
    %{timestamp: event.timestamp, metric: event.metric, value: event.value}
  end
end
```

### Broadway with Acknowledgment

```elixir
defmodule MyApp.TaskBroadway do
  use Broadway

  @impl Broadway
  def handle_message(_, message, _) do
    task = message.data

    case process_task(task) do
      {:ok, result} ->
        Message.update_data(message, fn _ -> result end)

      {:error, reason} ->
        Message.failed(message, reason)
    end
  end

  @impl Broadway
  def handle_failed(messages, _context) do
    # Log failed messages and potentially send to dead letter queue
    Enum.each(messages, fn message ->
      Logger.error("Task failed: #{inspect(message.data)}, reason: #{inspect(message.status)}")

      MyApp.RPC.api()
      |> RPC.dead_letter()
      |> RPC.push(message.data, message.status)
      |> RPC.await()
    end)

    messages
  end

  defp process_task(task) do
    MyApp.RPC.api()
    |> RPC.tasks()
    |> RPC.process(task)
    |> RPC.await()
  end
end
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
      {RPC.Session,
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
{:ok, session} = api |> RPC.authenticate(token) |> RPC.await()

# Use it...
user = session |> RPC.user() |> RPC.await!()

# Explicitly release when done (sends release message)
:ok = RPC.release(session)
```

### Capability Scope with `with_capability`

Ensure cleanup even if code raises:

```elixir
RPC.with_capability api |> RPC.authenticate(token) do
  fn session ->
    # session is automatically released when this block exits
    session |> RPC.do_work() |> RPC.await!()
  end
end
```

### Process Death = Release

When a process holding a capability dies, release messages are sent automatically:

```elixir
# Spawn a task that holds a capability
task = Task.async(fn ->
  {:ok, session} = api |> RPC.authenticate(token) |> RPC.await()
  # ... use session ...
end)

# If we kill the task, session is released
Task.shutdown(task, :brutal_kill)  # Release message sent
```

---

## Telemetry

rpc_do emits telemetry events for observability:

```elixir
# Events emitted:
# [:rpc_do, :call, :start]     - RPC call started
# [:rpc_do, :call, :stop]      - RPC call completed
# [:rpc_do, :call, :exception] - RPC call failed
# [:rpc_do, :connection, :up]       - Connected
# [:rpc_do, :connection, :down]     - Disconnected
# [:rpc_do, :connection, :reconnect] - Reconnecting
# [:rpc_do, :release, :sent]  - Release message sent

defmodule MyApp.Telemetry do
  require Logger

  def setup do
    :telemetry.attach_many(
      "rpc-do-logger",
      [
        [:rpc_do, :call, :stop],
        [:rpc_do, :call, :exception],
        [:rpc_do, :release, :sent]
      ],
      &handle_event/4,
      nil
    )
  end

  def handle_event([:rpc_do, :call, :stop], measurements, metadata, _config) do
    Logger.info("RPC #{inspect(metadata.path)} completed",
      duration_ms: measurements.duration / 1_000_000
    )
  end

  def handle_event([:rpc_do, :call, :exception], _measurements, metadata, _config) do
    Logger.error("RPC #{inspect(metadata.path)} failed: #{inspect(metadata.error)}")
  end

  def handle_event([:rpc_do, :release, :sent], _measurements, metadata, _config) do
    Logger.debug("Released capability #{metadata.import_id}")
  end
end
```

### Prometheus Metrics

```elixir
defmodule MyApp.RpcMetrics do
  use Prometheus.Metric

  def setup do
    Counter.declare(
      name: :rpc_calls_total,
      help: "Total RPC calls",
      labels: [:service, :method, :status]
    )

    Histogram.declare(
      name: :rpc_call_duration_seconds,
      help: "RPC call duration",
      labels: [:service, :method],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
    )

    :telemetry.attach_many(
      "rpc-prometheus",
      [
        [:rpc_do, :call, :stop],
        [:rpc_do, :call, :exception]
      ],
      &handle_event/4,
      nil
    )
  end

  def handle_event([:rpc_do, :call, :stop], measurements, metadata, _config) do
    Counter.inc(
      name: :rpc_calls_total,
      labels: [metadata.service, metadata.method, "success"]
    )

    Histogram.observe(
      [name: :rpc_call_duration_seconds, labels: [metadata.service, metadata.method]],
      measurements.duration / 1_000_000_000
    )
  end

  def handle_event([:rpc_do, :call, :exception], measurements, metadata, _config) do
    Counter.inc(
      name: :rpc_calls_total,
      labels: [metadata.service, metadata.method, "error"]
    )

    Histogram.observe(
      [name: :rpc_call_duration_seconds, labels: [metadata.service, metadata.method]],
      measurements.duration / 1_000_000_000
    )
  end
end
```

---

## Configuration

### Application Config

```elixir
# config/config.exs
config :rpc_do,
  default_timeout: 30_000,
  reconnect_strategy: :exponential,
  reconnect_base_delay: 1_000,
  reconnect_max_delay: 30_000,
  telemetry_prefix: [:my_app, :rpc]

# config/prod.exs
config :rpc_do,
  token: System.get_env("RPC_DO_TOKEN")
```

### Per-Session Options

```elixir
{:ok, api} = RPC.connect("wss://api.example.com",
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
{:ok, api} = RPC.connect("https://api.example.com/rpc",
  transport: :http
)
```

---

## Testing

### Mock Services with Mox

```elixir
# test/support/mocks.ex
Mox.defmock(RPC.MockClient, for: RPC.Client)

# test/test_helper.exs
Application.put_env(:my_app, :rpc_client, RPC.MockClient)

# test/users_test.exs
defmodule MyApp.UsersTest do
  use ExUnit.Case, async: true
  import Mox

  setup :verify_on_exit!

  describe "get_user/1" do
    test "returns user when found" do
      expect(RPC.MockClient, :call, fn _api, [:users, :get], [123] ->
        {:ok, %{id: 123, name: "Test User", email: "test@example.com"}}
      end)

      assert {:ok, user} = MyApp.Users.get(123)
      assert user.name == "Test User"
    end

    test "returns error when not found" do
      expect(RPC.MockClient, :call, fn _api, [:users, :get], [999] ->
        {:error, %RPC.Error{type: :not_found, message: "User not found"}}
      end)

      assert {:error, :not_found} = MyApp.Users.get(999)
    end
  end
end
```

### Local Test Server

```elixir
defmodule MyApp.TestServer do
  use RPC.TestServer

  def handle_call([:users, :get], [id]) do
    case id do
      123 -> {:ok, %{id: 123, name: "Test User"}}
      _ -> {:error, %{type: :not_found}}
    end
  end

  def handle_call([:users, :list], []) do
    {:ok, [
      %{id: 1, name: "User 1"},
      %{id: 2, name: "User 2"}
    ]}
  end
end

# In tests
defmodule MyApp.UsersTest do
  use ExUnit.Case

  setup do
    {:ok, server} = MyApp.TestServer.start_link()
    {:ok, api} = RPC.connect(server)
    {:ok, api: api}
  end

  test "finds a user", %{api: api} do
    {:ok, user} = api |> RPC.users() |> RPC.get(123) |> RPC.await()
    assert user.name == "Test User"
  end
end
```

### Bypass for HTTP Testing

```elixir
defmodule MyApp.HttpRpcTest do
  use ExUnit.Case

  setup do
    bypass = Bypass.open()
    {:ok, api} = RPC.connect("http://localhost:#{bypass.port}/rpc", transport: :http)
    {:ok, bypass: bypass, api: api}
  end

  test "makes HTTP RPC call", %{bypass: bypass, api: api} do
    Bypass.expect(bypass, "POST", "/rpc", fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      request = Jason.decode!(body)

      response = %{"result" => %{"id" => 123, "name" => "Test User"}}

      conn
      |> Plug.Conn.put_resp_header("content-type", "application/json")
      |> Plug.Conn.resp(200, Jason.encode!(response))
    end)

    {:ok, user} = api |> RPC.users() |> RPC.get(123) |> RPC.await()
    assert user["name"] == "Test User"
  end
end
```

### Property-Based Testing

```elixir
defmodule MyApp.RpcPropertyTest do
  use ExUnit.Case
  use ExUnitProperties

  property "pipeline operations are associative" do
    check all operations <- list_of(operation_generator(), min_length: 1, max_length: 5) do
      # Build pipeline from operations
      pipeline = Enum.reduce(operations, RPC.stub(:test), fn op, acc ->
        apply(RPC, op.name, [acc | op.args])
      end)

      # Verify pipeline structure is valid
      assert is_struct(pipeline, RPC.Pipeline)
    end
  end

  defp operation_generator do
    gen all name <- member_of([:users, :get, :profile, :settings]),
            args <- list_of(term(), max_length: 2) do
      %{name: name, args: args}
    end
  end
end
```

---

## Type Specifications

rpc_do provides comprehensive typespecs:

```elixir
@spec connect(String.t(), keyword()) :: {:ok, RPC.Session.t()} | {:error, term()}
@spec await(RPC.Promise.t()) :: {:ok, term()} | {:error, RPC.Error.t()}
@spec await!(RPC.Promise.t()) :: term()
@spec batch([RPC.Promise.t()]) :: {:ok, [term()]} | {:error, RPC.Error.t()}
@spec export(RPC.Session.t(), module() | pid()) :: {:ok, RPC.Capability.t()} | {:error, term()}
@spec release(RPC.Capability.t()) :: :ok
```

Use Dialyzer for static analysis:

```elixir
# mix.exs
def project do
  [
    dialyzer: [plt_add_apps: [:rpc_do]]
  ]
end
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      {Registry, keys: :unique, name: MyApp.SessionRegistry},
      MyApp.UserSessions,
      {RPC.Session,
        name: MyApp.API,
        url: System.get_env("API_URL"),
        reconnect: :exponential},
      MyApp.RpcEventBridge,
      MyApp.EventBroadway
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

defmodule MyApp.Users do
  @moduledoc "User operations via rpc.do"

  def api, do: RPC.session(MyApp.API)

  @spec get(integer()) :: {:ok, map()} | {:error, RPC.Error.t()}
  def get(id) do
    api()
    |> RPC.users()
    |> RPC.get(id)
    |> RPC.await()
  end

  @spec get_with_profile(integer()) :: {:ok, map()} | {:error, RPC.Error.t()}
  def get_with_profile(id) do
    # Single round-trip: pipeline through user to profile
    api()
    |> RPC.users()
    |> RPC.get(id)
    |> RPC.profile()
    |> RPC.await()
  end

  @spec get_full(integer()) :: {:ok, map()} | {:error, RPC.Error.t()}
  def get_full(id) do
    # Fork pipeline for parallel fetches
    user_promise = api() |> RPC.users() |> RPC.get(id)

    with {:ok, [user, profile, settings]} <- RPC.batch([
           user_promise,
           user_promise |> RPC.profile(),
           user_promise |> RPC.settings()
         ]) do
      {:ok, %{user: user, profile: profile, settings: settings}}
    end
  end

  @spec import_users(String.t(), pid()) :: {:ok, integer()} | {:error, term()}
  def import_users(file_url, progress_reporter) do
    # Pass capability for progress callbacks
    {:ok, reporter_cap} = RPC.export(api(), progress_reporter)

    api()
    |> RPC.users()
    |> RPC.import_batch(file_url, reporter_cap)
    |> RPC.await()
  end

  @spec search(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def search(query, opts \\ []) do
    page = Keyword.get(opts, :page, 1)
    per_page = Keyword.get(opts, :per_page, 20)

    api()
    |> RPC.users()
    |> RPC.search(query: query, skip: (page - 1) * per_page, limit: per_page)
    |> RPC.await()
  end
end

defmodule MyApp.ImportProgress do
  use GenServer
  use RPC.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(opts) do
    {:ok, %{callback: opts[:on_progress], total: 0}}
  end

  @impl RPC.Target
  def handle_rpc(:on_progress, [%{current: current, total: total}], state) do
    if state.callback, do: state.callback.(current, total)
    {:reply, :ok, %{state | total: total}}
  end

  @impl RPC.Target
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
    live_view_pid = self()

    {:ok, reporter} = MyApp.ImportProgress.start_link(
      on_progress: fn current, total ->
        send(live_view_pid, {:progress, current, total})
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

## API Reference

### Module Exports

```elixir
# Main entry point
defmodule RPC do
  # Connection management
  @spec connect(String.t(), keyword()) :: {:ok, Session.t()} | {:error, term()}
  @spec connect!(String.t(), keyword()) :: Session.t()
  @spec session(atom() | {:via, module(), term()}) :: Session.t()
  @spec disconnect(Session.t()) :: :ok

  # Magic proxy - generates stubs for any .do service
  # RPC.mongo() -> mongo.do
  # RPC.stripe() -> stripe.do
  # etc.

  # Promise resolution
  @spec await(Promise.t(), keyword()) :: {:ok, term()} | {:error, Error.t()}
  @spec await!(Promise.t(), keyword()) :: term()
  @spec batch([Promise.t()]) :: {:ok, [term()]} | {:error, Error.t()}

  # Remote map operations
  @spec rmap(Promise.t(), (term() -> Promise.t())) :: Promise.t()
  @spec rfilter(Promise.t(), (term() -> Promise.t())) :: Promise.t()
  @spec rreduce(Promise.t(), term(), (term(), term() -> term())) :: Promise.t()

  # Capability management
  @spec export(Session.t(), module() | pid()) :: {:ok, Capability.t()} | {:error, term()}
  @spec release(Capability.t()) :: :ok
  @spec with_capability(Promise.t(), (Capability.t() -> term())) :: term()

  # Error handling
  @spec rescue(Promise.t(), (Error.t() -> term())) :: Promise.t()
end
```

### Error Types

```elixir
defmodule RPC.Error do
  defexception [:type, :message, :code, :details, :status]

  @type error_type ::
    :connection_error
    | :timeout
    | :not_found
    | :permission_denied
    | :invalid_argument
    | :internal_error
    | :http_error
    | :unknown

  @type t :: %__MODULE__{
    type: error_type(),
    message: String.t(),
    code: String.t() | nil,
    details: map() | nil,
    status: integer() | nil
  }
end
```

### Target Behaviour

```elixir
defmodule RPC.Target do
  @callback handle(atom(), map() | list()) :: term()
  @callback handle_rpc(atom(), list(), state :: term()) ::
    {:reply, term(), state :: term()} |
    {:noreply, state :: term()}
end
```

---

## Migration from capnweb

```elixir
# Before (capnweb)
{:ok, api} = CapnWeb.connect("wss://mongo.do")

user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()

# After (rpc_do)
user = RPC.mongo()
|> RPC.users()
|> RPC.get(123)
|> RPC.await!()
```

```elixir
# Before (multiple services)
{:ok, mongo} = CapnWeb.connect("wss://mongo.do")
{:ok, redis} = CapnWeb.connect("wss://redis.do")

user = mongo |> CapnWeb.users() |> CapnWeb.find_one(%{_id: "123"}) |> CapnWeb.await!()
:ok = redis |> CapnWeb.set("user:123", user) |> CapnWeb.await!()

# After (single proxy)
user = RPC.mongo() |> RPC.users() |> RPC.find_one(%{_id: "123"}) |> RPC.await!()
:ok = RPC.redis() |> RPC.set("user:123", user) |> RPC.await!()
```

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Pipe operator native** | `\|>` is promise pipelining |
| **OTP integration** | Sessions are GenServers, supervision built-in |
| **Pattern matching** | Tagged tuples, error destructuring |
| **Zero boilerplate** | Magic proxy, auto-routing |
| **Elixir idioms** | Bang methods, `with` chains, behaviours |
| **Observable** | Telemetry events for metrics and tracing |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](https://hex.pm/packages/capnweb) | Low-level capability-based RPC |
| [mongo.do](https://hex.pm/packages/mongo_do) | MongoDB-specific client |
| [database.do](https://hex.pm/packages/database_do) | Multi-database client |
| [agents.do](https://hex.pm/packages/agents_do) | AI agents framework |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
