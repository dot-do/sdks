# Cap'n Web Elixir Client: Syntax Exploration

This document explores four divergent approaches to designing an idiomatic Elixir client for Cap'n Web RPC (package: `capnweb` on Hex.pm). Each approach represents a different philosophy about how Elixir developers should interact with the library.

---

## Background: What Makes Elixir Unique

Elixir brings distinctive features that shape API design:

- **Processes & OTP**: GenServer, Supervision trees, fault-tolerant design
- **Pattern Matching**: Destructuring at function heads, case statements, guards
- **Pipe Operator**: `|>` for data transformation pipelines
- **Macros & DSLs**: Compile-time metaprogramming, domain-specific languages
- **Immutability**: Data flows through transformations, no mutation
- **Behaviours & Protocols**: Polymorphism through contracts
- **Phoenix Integration**: Channels, LiveView, PubSub for real-time apps
- **GenStage/Flow**: Backpressure-aware data processing

The challenge: Cap'n Web's promise pipelining maps beautifully to Elixir's pipe operator, but we need to balance OTP patterns with ergonomic RPC calls.

---

## Approach 1: "Process-Centric OTP" (GenServer-Based)

**Philosophy**: Every RPC connection is a supervised process. Embrace OTP patterns fully. Sessions are GenServers, stubs are process references, and supervision trees manage fault tolerance. This feels like building with Erlang/OTP primitives.

### Connection/Session Creation

```elixir
# In your application supervision tree
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    children = [
      # CapnWeb session as a supervised child
      {CapnWeb.Session,
        name: MyApp.RPC,
        url: "wss://api.example.com",
        reconnect: :exponential,
        max_reconnect_attempts: 10
      }
    ]

    opts = [strategy: :one_for_one, name: MyApp.Supervisor]
    Supervisor.start_link(children, opts)
  end
end

# Or start dynamically
{:ok, session} = CapnWeb.Session.start_link(
  url: "wss://api.example.com",
  name: {:global, :my_api}
)

# HTTP batch mode (stateless, no GenServer needed)
{:ok, session} = CapnWeb.Session.connect(
  url: "https://api.example.com/rpc",
  transport: :http_batch
)
```

### Making RPC Calls

```elixir
# Get a stub reference (lightweight, just stores session + path)
api = CapnWeb.stub(MyApp.RPC)

# Synchronous call (blocks calling process)
{:ok, user} = CapnWeb.call(api, [:users, :get], [123])

# Asynchronous call (returns immediately with ref)
ref = CapnWeb.cast(api, [:users, :get], [123])
# ... do other work ...
{:ok, user} = CapnWeb.await(ref)
# Or with timeout
{:ok, user} = CapnWeb.await(ref, 5_000)

# Pattern matching on results
case CapnWeb.call(api, [:users, :get], [123]) do
  {:ok, %{name: name, email: email}} ->
    IO.puts("Found: #{name}")

  {:error, %CapnWeb.Error{type: :not_found}} ->
    IO.puts("User not found")

  {:error, %CapnWeb.Error{type: :connection_lost}} ->
    IO.puts("Connection failed")
end

# Multiple concurrent calls (spawns tasks)
tasks = [
  Task.async(fn -> CapnWeb.call(api, [:users, :get], [1]) end),
  Task.async(fn -> CapnWeb.call(api, [:users, :get], [2]) end),
  Task.async(fn -> CapnWeb.call(api, [:users, :get], [3]) end)
]
results = Task.await_many(tasks)
```

### Pipelining Syntax

```elixir
# Build a pipeline (accumulates operations, doesn't execute)
pipeline = api
|> CapnWeb.pipeline()
|> CapnWeb.prop(:users)
|> CapnWeb.invoke(:get, [123])
|> CapnWeb.prop(:profile)
|> CapnWeb.prop(:name)

# Execute pipeline (single round trip!)
{:ok, name} = CapnWeb.execute(pipeline)

# Shorthand with sigil
import CapnWeb.Sigils

# ~p builds a pipeline expression
{:ok, name} = ~p"api.users.get(123).profile.name"
|> CapnWeb.on(api)
|> CapnWeb.execute()

# Fork pipeline: multiple leaves from one stem
auth_pipeline = api
|> CapnWeb.pipeline()
|> CapnWeb.invoke(:authenticate, [token])

{:ok, [user_id, friends]} = CapnWeb.execute_many([
  auth_pipeline |> CapnWeb.invoke(:get_user_id, []),
  auth_pipeline |> CapnWeb.invoke(:get_friends, [])
])

# The map operation (server-side transformation)
{:ok, friend_names} = api
|> CapnWeb.pipeline()
|> CapnWeb.prop(:users)
|> CapnWeb.invoke(:get, [123])
|> CapnWeb.prop(:friend_ids)
|> CapnWeb.map(fn id ->
  CapnWeb.pipeline()
  |> CapnWeb.prop(:profiles)
  |> CapnWeb.invoke(:get, [id])
  |> CapnWeb.prop(:name)
end)
|> CapnWeb.execute()
```

### Error Handling

```elixir
# Tagged tuples (Elixir convention)
case CapnWeb.call(api, [:users, :get], [123]) do
  {:ok, user} ->
    process_user(user)

  {:error, %CapnWeb.Error{type: :not_found, message: msg}} ->
    Logger.warn("User not found: #{msg}")
    nil

  {:error, %CapnWeb.Error{type: :timeout}} ->
    Logger.error("Request timed out")
    :retry
end

# With `with` for happy path
with {:ok, user} <- CapnWeb.call(api, [:users, :get], [id]),
     {:ok, profile} <- CapnWeb.call(api, [:profiles, :for], [user]),
     {:ok, perms} <- CapnWeb.call(api, [:permissions, :get], [profile.role]) do
  {:ok, %{user: user, profile: profile, permissions: perms}}
else
  {:error, reason} -> {:error, reason}
end

# Bang versions (raise on error)
user = CapnWeb.call!(api, [:users, :get], [123])

# Circuit breaker via Fuse library
case Fuse.check(:api_circuit) do
  :ok ->
    case CapnWeb.call(api, [:users, :get], [123]) do
      {:ok, user} -> {:ok, user}
      {:error, _} = error ->
        Fuse.melt(:api_circuit)
        error
    end
  :blown ->
    {:error, :circuit_open}
end
```

### Exposing Local Objects as RPC Targets

```elixir
# Implement the CapnWeb.Target behaviour
defmodule MyApp.NotificationHandler do
  use CapnWeb.Target

  # Define which functions are RPC-callable
  @impl CapnWeb.Target
  def __rpc_methods__, do: [:on_message, :on_disconnect]

  def on_message(%{content: content, sender_id: sender_id}) do
    Logger.info("Message from #{sender_id}: #{content}")
    :ok
  end

  def on_disconnect(reason) do
    Logger.warn("Disconnected: #{reason}")
    :ok
  end
end

# Register target with session
{:ok, target_ref} = CapnWeb.export(MyApp.RPC, MyApp.NotificationHandler)

# Pass to server
CapnWeb.call(api, [:subscribe], [target_ref])

# GenServer-based target (stateful)
defmodule MyApp.StatefulHandler do
  use GenServer
  use CapnWeb.Target

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl GenServer
  def init(opts) do
    {:ok, %{count: 0}}
  end

  # RPC calls become GenServer calls
  @impl CapnWeb.Target
  def handle_rpc(:on_event, [event], state) do
    new_state = %{state | count: state.count + 1}
    {:reply, :ok, new_state}
  end
end
```

### Pros & Cons

**Pros:**
- Fits naturally into OTP supervision trees
- Fault-tolerant by default (supervised processes)
- Clear process boundaries and message passing
- Easy to reason about concurrency
- Familiar to Erlang/Elixir developers

**Cons:**
- Verbose for simple use cases
- Pipeline syntax not as elegant as it could be
- Requires understanding of OTP patterns
- More ceremony for one-off scripts

---

## Approach 2: "Pipe-First Functional" (Pipeline Operator Native)

**Philosophy**: The pipe operator is Elixir's signature. Build an API where RPC calls flow naturally through `|>`. Stubs are data structures, operations are pure functions. Pipelining "just works" when you chain pipes.

### Connection/Session Creation

```elixir
# Simple connection
{:ok, api} = CapnWeb.connect("wss://api.example.com")

# With options (returns a context struct)
{:ok, api} = "wss://api.example.com"
|> CapnWeb.connect(timeout: 30_000, pool_size: 5)

# HTTP batch mode
{:ok, api} = "https://api.example.com/rpc"
|> CapnWeb.connect(transport: :http)

# Resource management with try/after
api = CapnWeb.connect!("wss://api.example.com")
try do
  # use api
finally
  CapnWeb.disconnect(api)
end
```

### Making RPC Calls

```elixir
# Everything flows through pipes
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()

# Property access returns new stub
profile = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await!()
|> CapnWeb.profile()
|> CapnWeb.await!()

# Multiple arguments
result = api
|> CapnWeb.math()
|> CapnWeb.add(1, 2)
|> CapnWeb.await!()

# Pattern match on await
{:ok, %{name: name}} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await()

# Parallel calls with Task
[user1, user2, user3] = [1, 2, 3]
|> Task.async_stream(fn id ->
  api |> CapnWeb.users() |> CapnWeb.get(id) |> CapnWeb.await!()
end)
|> Enum.map(fn {:ok, user} -> user end)
```

### Pipelining Syntax

```elixir
# The magic: DON'T await between calls!
# This entire chain is ONE round trip:
name = api
|> CapnWeb.users()           # stub
|> CapnWeb.get(123)          # promise (not awaited)
|> CapnWeb.profile()         # pipelined through promise
|> CapnWeb.name()            # pipelined further
|> CapnWeb.await!()          # NOW execute entire chain

# Compare to non-pipelined (3 round trips):
user = api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()
profile = user |> CapnWeb.profile() |> CapnWeb.await!()
name = profile |> CapnWeb.name() |> CapnWeb.await!()

# Multiple pipelines from same stem
auth = api |> CapnWeb.authenticate(token)

# These both pipeline through `auth`, single round trip
{user_id, friends} = {
  auth |> CapnWeb.get_user_id() |> CapnWeb.await!(),
  auth |> CapnWeb.get_friends() |> CapnWeb.await!()
}

# Or use CapnWeb.batch/1 for explicit batching
{:ok, [user_id, friends]} = CapnWeb.batch([
  auth |> CapnWeb.get_user_id(),
  auth |> CapnWeb.get_friends()
])

# Server-side map
friend_names = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.friend_ids()
|> CapnWeb.map(fn id ->
  api |> CapnWeb.profiles() |> CapnWeb.get(id) |> CapnWeb.name()
end)
|> CapnWeb.await!()
```

### Error Handling

```elixir
# Non-bang returns {:ok, _} | {:error, _}
case api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await() do
  {:ok, user} -> IO.puts(user.name)
  {:error, error} -> IO.puts("Failed: #{error.message}")
end

# Bang raises CapnWeb.Error
try do
  user = api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()
rescue
  e in CapnWeb.NotFoundError ->
    Logger.warn("Not found: #{e.message}")
    nil
  e in CapnWeb.ConnectionError ->
    Logger.error("Connection lost")
    reraise e, __STACKTRACE__
end

# Rescue in pipeline (like Promise.catch)
user = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.rescue(fn _error -> default_user() end)
|> CapnWeb.await!()

# Timeout per call
{:ok, user} = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.await(timeout: 5_000)
```

### Exposing Local Objects as RPC Targets

```elixir
# Module-based target
defmodule MyHandler do
  use CapnWeb.Target

  target :on_message do
    def handle(%{content: content}) do
      IO.puts("Got: #{content}")
      :ok
    end
  end

  target :on_disconnect do
    def handle(reason) do
      IO.puts("Disconnected: #{reason}")
      :ok
    end
  end
end

# Export and pass
handler = api |> CapnWeb.export(MyHandler)
api |> CapnWeb.subscribe(handler) |> CapnWeb.await!()

# Anonymous function target (for simple callbacks)
callback = CapnWeb.target(fn event ->
  IO.puts("Event: #{inspect(event)}")
end)
api |> CapnWeb.on_event(callback) |> CapnWeb.await!()

# Struct-based target with state
defmodule Counter do
  defstruct count: 0

  use CapnWeb.Target

  target :increment do
    def handle(%Counter{count: n} = counter) do
      {n + 1, %Counter{counter | count: n + 1}}
    end
  end
end

counter = %Counter{} |> CapnWeb.export(api)
```

### Pros & Cons

**Pros:**
- Pipe operator makes code flow beautifully
- Pipelining is intuitive (just don't await early)
- Functional, immutable data flow
- Clean, readable code
- Easy to compose operations

**Cons:**
- Magic in distinguishing stub vs promise
- Less explicit about network boundaries
- Needs care to avoid accidental early await
- Process management less obvious

---

## Approach 3: "Macro DSL" (Domain-Specific Language)

**Philosophy**: Elixir's macros enable powerful DSLs. Define your API contract at compile time, generate typed stubs, and get compile-time guarantees. Think Ecto schemas or Phoenix routes.

### Connection/Session Creation

```elixir
# Define API schema (compile-time)
defmodule MyApi do
  use CapnWeb.Api

  endpoint "wss://api.example.com"

  namespace :users do
    call :get, args: [id: :integer], returns: :user
    call :list, returns: {:list, :user}
    call :create, args: [params: :user_params], returns: :user
  end

  namespace :profiles do
    call :for, args: [user: :user], returns: :profile
    call :update, args: [profile: :profile, changes: :map], returns: :profile
  end

  # Define types
  type :user do
    field :id, :integer
    field :name, :string
    field :email, :string
  end

  type :profile do
    field :bio, :string
    field :avatar_url, :string
  end

  # Callbacks/middleware
  before_call :log_call
  after_call :measure_latency
  on_error :handle_error

  defp log_call(call) do
    Logger.debug("RPC: #{call.namespace}.#{call.method}")
    call
  end
end

# Connect using the schema
{:ok, api} = MyApi.connect()

# Or with runtime options
{:ok, api} = MyApi.connect(timeout: 30_000)
```

### Making RPC Calls

```elixir
# Generated functions with full type hints
user = MyApi.users_get!(api, 123)
# IDE knows: user has fields :id, :name, :email

# Or pipe style
user = api |> MyApi.users_get!(123)

# List with pattern matching
[first | rest] = api |> MyApi.users_list!()

# Compile-time validation
# This won't compile - wrong argument type:
# MyApi.users_get!(api, "not_an_integer")

# Async versions
ref = MyApi.users_get_async(api, 123)
user = MyApi.await!(ref)
```

### Pipelining Syntax

```elixir
# DSL for building pipelines
import MyApi.Pipeline

# Use `~>` operator for pipelined calls (doesn't await)
name = api
~> users_get(123)
~> profile()
~> name()
|> MyApi.execute!()

# Or block-based pipeline builder
result = MyApi.pipeline api do
  user = users_get(123)
  profile = profiles_for(user)

  # Multiple values
  {user.name, profile.bio}
end

# Dependency tracking - optimal batching
MyApi.batch api do
  # These run in parallel (no dependencies)
  user = users_get(123)
  notifications = notifications_list()

  # This waits for user (has dependency)
  profile = profiles_for(user)

  {user, profile, notifications}
end

# The map operation
friend_names = MyApi.pipeline api do
  friend_ids = users_get(123).friend_ids

  map friend_ids, fn id ->
    profiles_get(id).name
  end
end
```

### Error Handling

```elixir
# Declarative error handling in schema
defmodule MyApi do
  use CapnWeb.Api

  # Map remote errors to local exceptions
  error :user_not_found, as: MyApp.UserNotFoundError
  error :permission_denied, as: MyApp.PermissionDeniedError

  # Retry policy
  retry :users_get,
    on: [CapnWeb.ConnectionError, CapnWeb.TimeoutError],
    times: 3,
    backoff: :exponential
end

# In use - raises mapped exceptions
try do
  MyApi.users_get!(api, 123)
rescue
  e in MyApp.UserNotFoundError ->
    Logger.warn("User not found: #{e.id}")
    nil
end

# Non-bang returns {:ok, _} | {:error, _}
case MyApi.users_get(api, 123) do
  {:ok, user} -> process(user)
  {:error, %MyApp.UserNotFoundError{}} -> nil
  {:error, error} -> reraise error, __STACKTRACE__
end

# Pattern matching on specific errors
with {:ok, user} <- MyApi.users_get(api, id),
     {:ok, profile} <- MyApi.profiles_for(api, user) do
  {:ok, %{user: user, profile: profile}}
end
```

### Exposing Local Objects as RPC Targets

```elixir
# DSL for defining targets
defmodule MyHandler do
  use CapnWeb.Target

  # Declare interface
  interface do
    callback :on_message, args: [content: :string, sender_id: :integer]
    callback :on_disconnect, args: [reason: :string]
  end

  # Implement callbacks
  @impl true
  def on_message(content: content, sender_id: sender_id) do
    Logger.info("From #{sender_id}: #{content}")
    :ok
  end

  @impl true
  def on_disconnect(reason: reason) do
    Logger.warn("Disconnected: #{reason}")
    :ok
  end
end

# Compile-time validation ensures all callbacks implemented

# Export
handler = MyHandler.export(api)
MyApi.subscribe!(api, handler)

# Inline handler with macro
MyApi.subscribe! api, handler do
  on :message, fn content, sender_id ->
    IO.puts("Got: #{content}")
  end

  on :disconnect, fn reason ->
    IO.puts("Bye: #{reason}")
  end
end
```

### Phoenix Integration

```elixir
# In your Phoenix application
defmodule MyAppWeb.RpcSocket do
  use Phoenix.Socket
  use CapnWeb.Phoenix.Socket

  # Automatically handles Cap'n Web protocol
  channel "rpc:*", CapnWeb.Phoenix.Channel

  def connect(params, socket, _connect_info) do
    {:ok, assign(socket, :user_id, params["user_id"])}
  end
end

# In a LiveView
defmodule MyAppWeb.UserLive do
  use MyAppWeb, :live_view
  use CapnWeb.Phoenix.LiveView

  def mount(_params, _session, socket) do
    {:ok, api} = MyApi.connect()
    {:ok, assign(socket, :api, api)}
  end

  def handle_event("load_user", %{"id" => id}, socket) do
    # Async RPC that updates LiveView when complete
    socket = socket
    |> start_async(:load_user, fn ->
      MyApi.users_get!(socket.assigns.api, String.to_integer(id))
    end)

    {:noreply, socket}
  end

  def handle_async(:load_user, {:ok, user}, socket) do
    {:noreply, assign(socket, :user, user)}
  end
end
```

### Pros & Cons

**Pros:**
- Compile-time type checking
- Excellent IDE support (generated functions)
- Self-documenting API contract
- Phoenix integration is seamless
- Catches errors early

**Cons:**
- Requires upfront schema definition
- Cannot call undefined methods
- More initial setup
- Less flexible for exploratory APIs

---

## Approach 4: "GenStage Streaming" (Backpressure-Aware)

**Philosophy**: Treat RPC as data streams. Use GenStage/Flow for backpressure handling. Perfect for high-throughput scenarios, real-time subscriptions, and when you need to process large amounts of data from RPC calls.

### Connection/Session Creation

```elixir
# Session as a GenStage producer
defmodule MyApp.RpcProducer do
  use GenStage
  use CapnWeb.Producer

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def init(opts) do
    {:ok, session} = CapnWeb.connect(opts[:url])
    {:producer, %{session: session, demand: 0}}
  end
end

# Add to supervision tree
children = [
  {MyApp.RpcProducer, url: "wss://api.example.com"},
  {MyApp.RpcConsumer, subscribe_to: [MyApp.RpcProducer]}
]

# Or use the built-in streaming client
{:ok, stream} = CapnWeb.Stream.connect("wss://api.example.com")
```

### Making RPC Calls

```elixir
# Regular calls still work
{:ok, user} = CapnWeb.call(stream, [:users, :get], [123])

# But the power is in streaming
# Subscribe to a stream of events
stream
|> CapnWeb.subscribe([:events, :user_updates])
|> Stream.each(fn event ->
  IO.puts("User updated: #{event.user_id}")
end)
|> Stream.run()

# With Flow for parallel processing
stream
|> CapnWeb.subscribe([:events, :all])
|> Flow.from_enumerable()
|> Flow.partition(key: {:key, :type})
|> Flow.reduce(fn -> %{} end, fn event, acc ->
  Map.update(acc, event.type, 1, &(&1 + 1))
end)
|> Enum.to_list()

# Batched calls with backpressure
user_ids
|> Stream.chunk_every(100)
|> Task.async_stream(fn batch ->
  CapnWeb.batch_call(stream, Enum.map(batch, fn id ->
    {[:users, :get], [id]}
  end))
end, max_concurrency: 4)
|> Stream.flat_map(fn {:ok, results} -> results end)
|> Enum.to_list()
```

### Pipelining Syntax

```elixir
# Streaming pipelines
defmodule UserProfilePipeline do
  use GenStage
  use CapnWeb.Stage

  def init(opts) do
    {:producer_consumer, %{api: opts[:api]}}
  end

  # Transform user IDs to full profiles
  def handle_events(user_ids, _from, state) do
    profiles = user_ids
    |> Enum.map(fn id ->
      state.api
      |> CapnWeb.pipeline()
      |> CapnWeb.users()
      |> CapnWeb.get(id)
      |> CapnWeb.profile()
    end)
    |> CapnWeb.execute_batch!()

    {:noreply, profiles, state}
  end
end

# Wire up the pipeline
{:ok, producer} = UserIdProducer.start_link()
{:ok, transformer} = UserProfilePipeline.start_link(api: api)
{:ok, consumer} = ProfileConsumer.start_link()

GenStage.sync_subscribe(transformer, to: producer)
GenStage.sync_subscribe(consumer, to: transformer)

# Using Flow for RPC pipelining
user_ids
|> Flow.from_enumerable(max_demand: 50)
|> Flow.map(fn id ->
  # Each mapper builds a pipeline
  api
  |> CapnWeb.pipeline()
  |> CapnWeb.users()
  |> CapnWeb.get(id)
  |> CapnWeb.profile()
  |> CapnWeb.name()
end)
|> Flow.partition(stages: 4)
|> Flow.map(&CapnWeb.execute!/1)  # Execute pipelines
|> Enum.to_list()
```

### Error Handling

```elixir
# Stream error handling
stream
|> CapnWeb.subscribe([:events, :all])
|> Stream.transform(fn -> :ok end,
  fn
    {:ok, event}, acc -> {[event], acc}
    {:error, error}, acc ->
      Logger.error("Stream error: #{inspect(error)}")
      {[], acc}  # Skip errors, continue stream
  end,
  fn _acc -> :ok end
)
|> Stream.each(&process/1)
|> Stream.run()

# Circuit breaker with streaming
defmodule ResilientStream do
  use GenStage

  def handle_events(events, _from, state) do
    case Fuse.check(:rpc_circuit) do
      :ok ->
        results = process_events(events, state)
        {:noreply, results, state}

      :blown ->
        # Buffer events or apply backpressure
        Process.send_after(self(), :retry, 1000)
        {:noreply, [], %{state | buffered: events}}
    end
  end
end

# Dead letter queue for failed RPC
stream
|> CapnWeb.subscribe([:tasks, :pending])
|> Stream.map(fn task ->
  case CapnWeb.call(api, [:tasks, :process], [task]) do
    {:ok, result} -> {:ok, result}
    {:error, error} ->
      DeadLetterQueue.push(task, error)
      {:error, error}
  end
end)
|> Stream.filter(&match?({:ok, _}, &1))
|> Stream.run()
```

### Exposing Local Objects as RPC Targets

```elixir
# GenStage-based target (handles backpressure)
defmodule EventSink do
  use GenStage
  use CapnWeb.Target

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  def init(opts) do
    {:consumer, %{handler: opts[:handler]}}
  end

  # RPC calls are delivered as GenStage events
  @impl GenStage
  def handle_events(events, _from, state) do
    Enum.each(events, state.handler)
    {:noreply, [], state}
  end

  # Define RPC interface
  @impl CapnWeb.Target
  def __rpc_interface__ do
    [
      {:on_event, 1},
      {:on_batch, 1}
    ]
  end
end

# Export with backpressure config
sink = EventSink.start_link(handler: &process_event/1)
handler = CapnWeb.export(api, sink,
  max_demand: 100,
  buffer_size: 1000
)

api |> CapnWeb.subscribe(handler) |> CapnWeb.await!()

# Broadway integration for robust event processing
defmodule MyBroadway do
  use Broadway
  use CapnWeb.Broadway

  def start_link(_opts) do
    Broadway.start_link(__MODULE__,
      name: __MODULE__,
      producer: [
        module: {CapnWeb.Broadway.Producer,
          url: "wss://api.example.com",
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
  def handle_message(_, message, _) do
    message
    |> Message.update_data(&process_event/1)
  end

  @impl Broadway
  def handle_batch(_, messages, _, _) do
    # Batch processing
    messages
  end
end
```

### Pros & Cons

**Pros:**
- Excellent for high-throughput scenarios
- Built-in backpressure handling
- Natural fit for real-time subscriptions
- Scales horizontally with GenStage/Flow
- Broadway integration for production robustness

**Cons:**
- Overkill for simple request/response
- Steeper learning curve (GenStage)
- More infrastructure setup
- Not as intuitive for basic RPC

---

## Comparison Matrix

| Feature | Approach 1: OTP | Approach 2: Pipe-First | Approach 3: Macro DSL | Approach 4: GenStage |
|---------|-----------------|------------------------|----------------------|---------------------|
| **Learning Curve** | Medium | Low | Medium | High |
| **Type Safety** | Runtime | Runtime | Compile-time | Runtime |
| **IDE Support** | Basic | Basic | Excellent | Basic |
| **Pipeline Ergonomics** | Verbose | Excellent | Good (DSL) | Good (Flow) |
| **Supervision/Fault Tolerance** | Excellent | Manual | Good | Excellent |
| **Streaming/Subscriptions** | Manual | Manual | Manual | Excellent |
| **Phoenix Integration** | Manual | Manual | Excellent | Good |
| **Best For** | OTP apps | Scripts, APIs | Large teams | High-throughput |
| **Elixir Feel** | Erlang/OTP | Functional | Phoenix-like | Data engineering |

---

## Recommended Hybrid Approach

After analyzing all four approaches, the ideal `capnweb` Hex package should combine elements based on use case:

### Core: Pipe-First Functional (Approach 2)

The default API should feel like natural Elixir with pipes:

```elixir
# The simple, beautiful case
{:ok, api} = CapnWeb.connect("wss://api.example.com")

name = api
|> CapnWeb.users()
|> CapnWeb.get(123)
|> CapnWeb.profile()
|> CapnWeb.name()
|> CapnWeb.await!()
```

### Supervision: OTP Integration (Approach 1)

For production apps, integrate with OTP:

```elixir
# In supervision tree
children = [
  {CapnWeb.Session, name: MyApp.RPC, url: "wss://api.example.com"}
]

# Use supervised session
api = CapnWeb.stub(MyApp.RPC)
```

### Type Safety: Optional DSL (Approach 3)

For teams wanting compile-time checks:

```elixir
defmodule MyApi do
  use CapnWeb.Api

  endpoint "wss://api.example.com"

  namespace :users do
    call :get, args: [id: :integer], returns: :user
  end
end

# Generated functions with types
user = MyApi.users_get!(api, 123)
```

### Streaming: GenStage/Broadway Integration (Approach 4)

For subscriptions and high-throughput:

```elixir
# Stream processing
api
|> CapnWeb.subscribe([:events, :all])
|> Flow.from_enumerable()
|> Flow.map(&process/1)
|> Flow.run()
```

### The Unified API

```elixir
defmodule CapnWeb do
  # Simple connection
  def connect(url, opts \\ [])

  # Property access (returns stub or promise)
  def prop(stub_or_promise, name)

  # Method invocation (returns promise)
  def call(stub_or_promise, method, args \\ [])

  # Await resolution
  def await(promise, opts \\ [])
  def await!(promise, opts \\ [])

  # Batch multiple promises
  def batch(promises)

  # Export local target
  def export(session, target)

  # Stream subscription
  def subscribe(stub, path)
end
```

---

## Implementation Notes

### Package Structure

```
capnweb/
  lib/
    capnweb.ex              # Main module, public API
    capnweb/
      session.ex            # GenServer for connection management
      stub.ex               # Stub struct and operations
      promise.ex            # Promise struct, pipelining
      target.ex             # Behaviour for local targets
      pipeline.ex           # Pipeline builder
      transport/
        websocket.ex        # WebSocket via :gun or :mint
        http.ex             # HTTP batch transport
      protocol/
        encoder.ex          # JSON + special types
        decoder.ex          # Expression evaluation
        messages.ex         # push, pull, resolve, etc.
      otp/
        supervisor.ex       # Default supervision tree
        registry.ex         # Session registry
      integrations/
        phoenix/
          socket.ex
          channel.ex
          live_view.ex
        genstage/
          producer.ex
          consumer.ex
        broadway/
          producer.ex
  mix.exs
```

### Key Modules

```elixir
defmodule CapnWeb.Session do
  use GenServer

  # State: connection, import/export tables, pending promises
  defstruct [:conn, :imports, :exports, :pending, :next_id]
end

defmodule CapnWeb.Stub do
  # Lightweight struct: session reference + path
  defstruct [:session, :path]
end

defmodule CapnWeb.Promise do
  # Lazy promise with pipelining support
  defstruct [:session, :id, :operations]
end

defmodule CapnWeb.Target do
  @callback __rpc_methods__() :: [atom()]
  @callback handle_rpc(method :: atom(), args :: list()) :: term()
end
```

### Dependencies

```elixir
# mix.exs
defp deps do
  [
    {:jason, "~> 1.4"},           # JSON encoding
    {:gun, "~> 2.0"},             # WebSocket client
    {:mint, "~> 1.5"},            # HTTP client
    {:nimble_options, "~> 1.0"},  # Options validation

    # Optional
    {:gen_stage, "~> 1.2", optional: true},
    {:flow, "~> 1.2", optional: true},
    {:broadway, "~> 1.0", optional: true},
    {:phoenix, "~> 1.7", optional: true}
  ]
end
```

---

## What Makes Elixir Developers Happy

1. **Pipe operator compatibility** - Data flows naturally through `|>`
2. **Pattern matching everywhere** - Tagged tuples, destructuring
3. **OTP integration** - Supervision, fault tolerance built-in
4. **Immutability** - No surprises, easy to reason about
5. **Clear error handling** - `{:ok, _}` / `{:error, _}` convention
6. **Macros for power users** - DSLs when you need them
7. **Phoenix ecosystem** - First-class integration

The goal: A library that feels like it grew from the BEAM, leveraging processes, pipes, and patterns to make RPC feel like local function calls while embracing the distributed nature of Elixir applications.

---

## Open Questions

1. **Process per stub or shared session?** Should each stub be its own process, or share the session process?

2. **Pipeline execution timing**: When exactly does a pipeline execute? On first `await`? Explicitly?

3. **Supervision strategy**: What happens when the session dies mid-pipeline? Restart? Fail all pending?

4. **Backpressure on targets**: How to handle a flood of incoming RPC calls to local targets?

5. **Telemetry integration**: Should we emit `:telemetry` events for observability?

6. **LiveView integration**: How deep should Phoenix LiveView integration go? Auto-reconnect? State sync?

---

## Next Steps

1. Implement core session GenServer with WebSocket transport
2. Build pipe-friendly stub/promise API
3. Add basic pipelining support
4. Create `CapnWeb.Target` behaviour
5. Add optional DSL macro layer
6. Integrate with Phoenix Channels
7. Add GenStage producer for subscriptions
8. Publish to Hex.pm as `capnweb`
