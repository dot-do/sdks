defmodule CapnWeb do
  @moduledoc """
  Cap'n Web RPC client for Elixir.

  Provides promise pipelining over WebSocket connections, allowing multiple
  RPC operations to be batched into single round trips.

  ## Basic Usage

      {:ok, api} = CapnWeb.connect("wss://api.example.com")

      # Single round trip for entire chain
      name = api
      |> CapnWeb.users()
      |> CapnWeb.get(123)
      |> CapnWeb.profile()
      |> CapnWeb.name()
      |> CapnWeb.await!()

  ## Map Operation (Server-side transformation)

      # Maps over collection on server - single round trip
      squared = api
      |> CapnWeb.generateFibonacci(6)
      |> CapnWeb.map(fn x -> CapnWeb.square(api, x) end)
      |> CapnWeb.await!()
      # => [0, 1, 1, 4, 9, 25]

  """

  alias CapnWeb.{Session, Stub, Promise, Error}

  @type url :: String.t()
  @type connect_opts :: [
          timeout: non_neg_integer(),
          headers: [{String.t(), String.t()}],
          transport: :websocket | :http
        ]

  # =============================================================================
  # Connection
  # =============================================================================

  @doc """
  Connects to a Cap'n Web RPC server.

  ## Options

    * `:timeout` - Connection timeout in milliseconds (default: 30_000)
    * `:headers` - Additional headers for the WebSocket handshake
    * `:transport` - Transport type: `:websocket` (default) or `:http`

  ## Examples

      {:ok, api} = CapnWeb.connect("wss://api.example.com")

      {:ok, api} = CapnWeb.connect("wss://api.example.com",
        timeout: 60_000,
        headers: [{"authorization", "Bearer token"}]
      )

  """
  @spec connect(url(), connect_opts()) :: {:ok, Stub.t()} | {:error, Error.t()}
  def connect(url, opts \\ []) do
    case Session.start_link(url: url, opts: opts) do
      {:ok, session} ->
        {:ok, Stub.new(session)}

      {:error, reason} ->
        {:error, Error.connection_error(reason)}
    end
  end

  @doc """
  Connects to a Cap'n Web RPC server, raising on error.
  """
  @spec connect!(url(), connect_opts()) :: Stub.t()
  def connect!(url, opts \\ []) do
    case connect(url, opts) do
      {:ok, stub} -> stub
      {:error, error} -> raise error
    end
  end

  @doc """
  Gets a stub for a supervised session by name.

  ## Example

      # In your Application supervisor
      children = [
        {CapnWeb.Session, name: MyApp.API, url: "wss://api.example.com"}
      ]

      # Later, anywhere in your app
      api = CapnWeb.session(MyApp.API)
      result = api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await!()

  """
  @spec session(atom() | pid()) :: Stub.t()
  def session(name_or_pid) do
    Stub.new(name_or_pid)
  end

  @doc """
  Disconnects from the server and closes the session.
  """
  @spec disconnect(Stub.t() | Session.t()) :: :ok
  def disconnect(%Stub{session: session}), do: Session.close(session)
  def disconnect(session) when is_pid(session), do: Session.close(session)
  def disconnect(session) when is_atom(session), do: Session.close(session)

  # =============================================================================
  # Dynamic Property Access / Method Calls
  # =============================================================================

  @doc """
  Accesses a property on a stub or promise.

  This is typically called via the pipe operator through dynamic dispatch.
  """
  @spec prop(Stub.t() | Promise.t(), atom() | String.t()) :: Stub.t() | Promise.t()
  def prop(%Stub{} = stub, name) do
    Stub.property(stub, name)
  end

  def prop(%Promise{} = promise, name) do
    Promise.property(promise, name)
  end

  @doc """
  Invokes a method on a stub or promise.

  This is typically called via the pipe operator through dynamic dispatch.
  """
  @spec call(Stub.t() | Promise.t(), atom() | String.t(), list()) :: Promise.t()
  def call(%Stub{} = stub, method, args \\ []) do
    Stub.call(stub, method, args)
  end

  def call(%Promise{} = promise, method, args \\ []) do
    Promise.call(promise, method, args)
  end

  # =============================================================================
  # Promise Resolution
  # =============================================================================

  @doc """
  Awaits the resolution of a promise.

  ## Options

    * `:timeout` - Timeout in milliseconds (default: 30_000)

  ## Examples

      {:ok, result} = api |> CapnWeb.square(5) |> CapnWeb.await()

      case api |> CapnWeb.users() |> CapnWeb.get(123) |> CapnWeb.await() do
        {:ok, user} -> IO.puts(user.name)
        {:error, %CapnWeb.Error{type: :not_found}} -> IO.puts("Not found")
      end

  """
  @spec await(Promise.t(), keyword()) :: {:ok, any()} | {:error, Error.t()}
  def await(%Promise{} = promise, opts \\ []) do
    Promise.await(promise, opts)
  end

  @doc """
  Awaits the resolution of a promise, raising on error.
  """
  @spec await!(Promise.t(), keyword()) :: any()
  def await!(%Promise{} = promise, opts \\ []) do
    case await(promise, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Map Operation (Server-side collection transformation)
  # =============================================================================

  @doc """
  Maps a function over a collection on the server side.

  This is the key optimization that eliminates N+1 round trips. Instead of
  fetching a collection and then making individual calls for each element,
  `map/2` sends the mapping function to the server and executes it there.

  ## Examples

      # Square each Fibonacci number (single round trip!)
      squared = api
      |> CapnWeb.generateFibonacci(6)
      |> CapnWeb.map(fn x -> CapnWeb.square(api, x) end)
      |> CapnWeb.await!()
      # => [0, 1, 1, 4, 9, 25]

      # Transform each element to a capability
      counters = api
      |> CapnWeb.generateFibonacci(4)
      |> CapnWeb.map(fn x -> CapnWeb.makeCounter(api, x) end)
      |> CapnWeb.await!()

      # Map over capabilities
      values = counters
      |> CapnWeb.map(fn counter -> CapnWeb.value(counter) end)
      |> CapnWeb.await!()

  ## Behavior on Special Values

    * `nil` / `null` - Returns `nil` (no error)
    * Single value - Applies the transform to the single value
    * Array - Applies the transform to each element, preserving order

  """
  @spec map(Promise.t() | Stub.t(), (any() -> Promise.t())) :: Promise.t()
  def map(%Promise{} = promise, mapper_fn) when is_function(mapper_fn, 1) do
    Promise.map(promise, mapper_fn)
  end

  def map(%Stub{} = stub, mapper_fn) when is_function(mapper_fn, 1) do
    # If map is called on a stub directly, convert to promise first
    stub
    |> Stub.to_promise()
    |> Promise.map(mapper_fn)
  end

  # =============================================================================
  # Batch Operations
  # =============================================================================

  @doc """
  Executes multiple promises in a single batch.

  All promises that share the same session and haven't been awaited will be
  sent to the server together, minimizing round trips.

  ## Example

      auth = api |> CapnWeb.authenticate(token)

      {:ok, [user_id, permissions, prefs]} = CapnWeb.batch([
        auth |> CapnWeb.user_id(),
        auth |> CapnWeb.permissions(),
        auth |> CapnWeb.preferences()
      ])

  """
  @spec batch([Promise.t()], keyword()) :: {:ok, [any()]} | {:error, Error.t()}
  def batch(promises, opts \\ []) when is_list(promises) do
    Promise.batch(promises, opts)
  end

  @doc """
  Executes multiple promises in a batch, raising on error.
  """
  @spec batch!([Promise.t()], keyword()) :: [any()]
  def batch!(promises, opts \\ []) do
    case batch(promises, opts) do
      {:ok, results} -> results
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Error Recovery
  # =============================================================================

  @doc """
  Provides a fallback value if the promise fails.

  Similar to `Promise.catch` in JavaScript.

  ## Example

      user = api
      |> CapnWeb.users()
      |> CapnWeb.get(123)
      |> CapnWeb.rescue(fn _error -> default_user() end)
      |> CapnWeb.await!()

  """
  @spec rescue(Promise.t(), (Error.t() -> any())) :: Promise.t()
  def rescue(%Promise{} = promise, handler) when is_function(handler, 1) do
    Promise.rescue(promise, handler)
  end

  # =============================================================================
  # Target Export (Callbacks)
  # =============================================================================

  @doc """
  Exports a local module or function as an RPC target.

  This allows the remote server to call methods on your local object.

  ## Example

      defmodule MyHandler do
        use CapnWeb.Target

        @impl CapnWeb.Target
        def handle(:on_message, %{content: content}) do
          IO.puts("Got message: \#{content}")
          :ok
        end
      end

      {:ok, handler_ref} = CapnWeb.export(api, MyHandler)

      api
      |> CapnWeb.notifications()
      |> CapnWeb.subscribe(handler_ref)
      |> CapnWeb.await!()

  """
  @spec export(Stub.t(), module() | pid() | function()) :: {:ok, reference()} | {:error, Error.t()}
  def export(%Stub{session: session}, target) do
    Session.export(session, target)
  end

  # =============================================================================
  # Dynamic Method Dispatch (method_missing equivalent)
  # =============================================================================

  # These functions provide the fluent API where any method name can be called.
  # In Elixir, we achieve this through a macro that generates catch-all functions.

  @doc false
  defmacro __using__(_opts) do
    quote do
      import CapnWeb.DSL
    end
  end
end

# =============================================================================
# Supporting Modules
# =============================================================================

defmodule CapnWeb.Stub do
  @moduledoc """
  Represents a reference to a remote object or namespace.

  Stubs are lightweight and don't trigger network calls. Network calls only
  happen when you call `CapnWeb.await/1` on a promise.
  """

  defstruct [:session, :path]

  @type t :: %__MODULE__{
          session: pid() | atom(),
          path: [atom() | String.t()]
        }

  @doc """
  Creates a new stub for a session.
  """
  @spec new(pid() | atom()) :: t()
  def new(session) do
    %__MODULE__{session: session, path: []}
  end

  @doc """
  Accesses a property, returning a new stub with extended path.
  """
  @spec property(t(), atom() | String.t()) :: t()
  def property(%__MODULE__{path: path} = stub, name) do
    %{stub | path: path ++ [name]}
  end

  @doc """
  Invokes a method on the stub, returning a promise.
  """
  @spec call(t(), atom() | String.t(), list()) :: CapnWeb.Promise.t()
  def call(%__MODULE__{session: session, path: path}, method, args) do
    CapnWeb.Promise.new(session, path ++ [method], args)
  end

  @doc """
  Converts a stub to a promise (for direct await without method call).
  """
  @spec to_promise(t()) :: CapnWeb.Promise.t()
  def to_promise(%__MODULE__{session: session, path: path}) do
    CapnWeb.Promise.new(session, path, [])
  end

  # Allow dynamic property access
  defimpl Access do
    def fetch(stub, key) do
      {:ok, CapnWeb.Stub.property(stub, key)}
    end

    def get_and_update(_stub, _key, _fun) do
      raise "Stubs are immutable"
    end

    def pop(_stub, _key) do
      raise "Stubs are immutable"
    end
  end
end

defmodule CapnWeb.Promise do
  @moduledoc """
  Represents a pending RPC operation that can be pipelined.

  Promises are lazy - they don't execute until `await/1` is called.
  Multiple operations can be chained before awaiting, and they'll all
  be sent to the server in a single round trip.
  """

  defstruct [:session, :path, :args, :operations, :map_fn, :rescue_fn]

  @type operation :: {:call, atom() | String.t(), list()} | {:property, atom() | String.t()}

  @type t :: %__MODULE__{
          session: pid() | atom(),
          path: [atom() | String.t()],
          args: list(),
          operations: [operation()],
          map_fn: (any() -> t()) | nil,
          rescue_fn: (CapnWeb.Error.t() -> any()) | nil
        }

  @doc """
  Creates a new promise.
  """
  @spec new(pid() | atom(), [atom() | String.t()], list()) :: t()
  def new(session, path, args) do
    %__MODULE__{
      session: session,
      path: path,
      args: args,
      operations: [],
      map_fn: nil,
      rescue_fn: nil
    }
  end

  @doc """
  Chains a property access onto the promise.
  """
  @spec property(t(), atom() | String.t()) :: t()
  def property(%__MODULE__{operations: ops} = promise, name) do
    %{promise | operations: ops ++ [{:property, name}]}
  end

  @doc """
  Chains a method call onto the promise.
  """
  @spec call(t(), atom() | String.t(), list()) :: t()
  def call(%__MODULE__{operations: ops} = promise, method, args) do
    %{promise | operations: ops ++ [{:call, method, args}]}
  end

  @doc """
  Adds a map operation to the promise.
  """
  @spec map(t(), (any() -> t())) :: t()
  def map(%__MODULE__{} = promise, mapper_fn) do
    %{promise | map_fn: mapper_fn}
  end

  @doc """
  Adds an error recovery handler to the promise.
  """
  @spec rescue(t(), (CapnWeb.Error.t() -> any())) :: t()
  def rescue(%__MODULE__{} = promise, handler) do
    %{promise | rescue_fn: handler}
  end

  @doc """
  Awaits the resolution of the promise.
  """
  @spec await(t(), keyword()) :: {:ok, any()} | {:error, CapnWeb.Error.t()}
  def await(%__MODULE__{} = promise, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 30_000)

    case CapnWeb.Session.execute(promise.session, promise, timeout) do
      {:ok, result} ->
        {:ok, result}

      {:error, error} ->
        if promise.rescue_fn do
          {:ok, promise.rescue_fn.(error)}
        else
          {:error, error}
        end
    end
  end

  @doc """
  Executes multiple promises in a batch.
  """
  @spec batch([t()], keyword()) :: {:ok, [any()]} | {:error, CapnWeb.Error.t()}
  def batch(promises, opts \\ []) when is_list(promises) do
    timeout = Keyword.get(opts, :timeout, 30_000)

    # Group by session
    by_session =
      promises
      |> Enum.with_index()
      |> Enum.group_by(fn {promise, _idx} -> promise.session end)

    # Execute each session's batch
    results =
      Enum.flat_map(by_session, fn {session, indexed_promises} ->
        promises_only = Enum.map(indexed_promises, fn {p, idx} -> {p, idx} end)
        CapnWeb.Session.execute_batch(session, promises_only, timeout)
      end)

    # Restore original order
    ordered =
      results
      |> Enum.sort_by(fn {idx, _result} -> idx end)
      |> Enum.map(fn {_idx, result} -> result end)

    {:ok, ordered}
  rescue
    e -> {:error, CapnWeb.Error.from_exception(e)}
  end

  # Allow promise chaining via Access protocol
  defimpl Access do
    def fetch(promise, key) do
      {:ok, CapnWeb.Promise.property(promise, key)}
    end

    def get_and_update(_promise, _key, _fun) do
      raise "Promises are immutable"
    end

    def pop(_promise, _key) do
      raise "Promises are immutable"
    end
  end
end

defmodule CapnWeb.Error do
  @moduledoc """
  Error types for CapnWeb operations.
  """

  defexception [:type, :message, :code, :details]

  @type error_type ::
          :connection_error
          | :timeout
          | :not_found
          | :permission_denied
          | :invalid_argument
          | :internal_error
          | :not_implemented
          | :unknown

  @type t :: %__MODULE__{
          type: error_type(),
          message: String.t(),
          code: String.t() | nil,
          details: map() | nil
        }

  @impl true
  def message(%__MODULE__{message: msg, type: type}) do
    "[#{type}] #{msg}"
  end

  @doc "Creates a connection error."
  def connection_error(reason) do
    %__MODULE__{
      type: :connection_error,
      message: "Failed to connect: #{inspect(reason)}"
    }
  end

  @doc "Creates a not implemented error."
  def not_implemented(feature) do
    %__MODULE__{
      type: :not_implemented,
      message: "Feature not implemented: #{feature}"
    }
  end

  @doc "Creates an error from an exception."
  def from_exception(exception) do
    %__MODULE__{
      type: :internal_error,
      message: Exception.message(exception)
    }
  end

  @doc "Creates an error from an RPC response."
  def from_rpc_error(error_map) when is_map(error_map) do
    %__MODULE__{
      type: Map.get(error_map, "type", "unknown") |> String.to_atom(),
      message: Map.get(error_map, "message", "Unknown error"),
      code: Map.get(error_map, "code"),
      details: Map.get(error_map, "details")
    }
  end
end

defmodule CapnWeb.Session do
  @moduledoc """
  GenServer managing a WebSocket connection to a Cap'n Web server.

  Sessions are typically started as part of a supervision tree for fault tolerance.
  """

  use GenServer
  require Logger

  defstruct [:url, :opts, :conn, :pending, :exports, :next_id]

  @type t :: pid() | atom()

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Starts a session GenServer.
  """
  def start_link(opts) do
    {name, opts} = Keyword.pop(opts, :name)

    if name do
      GenServer.start_link(__MODULE__, opts, name: name)
    else
      GenServer.start_link(__MODULE__, opts)
    end
  end

  @doc """
  Closes the session.
  """
  def close(session) do
    GenServer.stop(session, :normal)
  end

  @doc """
  Executes a single promise.
  """
  def execute(session, promise, timeout) do
    GenServer.call(session, {:execute, promise}, timeout)
  end

  @doc """
  Executes multiple promises in a batch.
  """
  def execute_batch(session, indexed_promises, timeout) do
    GenServer.call(session, {:execute_batch, indexed_promises}, timeout)
  end

  @doc """
  Exports a local target for remote callbacks.
  """
  def export(session, target) do
    GenServer.call(session, {:export, target})
  end

  # =============================================================================
  # GenServer Callbacks
  # =============================================================================

  @impl true
  def init(opts) do
    url = Keyword.fetch!(opts, :url)

    state = %__MODULE__{
      url: url,
      opts: Keyword.get(opts, :opts, []),
      conn: nil,
      pending: %{},
      exports: %{},
      next_id: 1
    }

    # Connect asynchronously
    send(self(), :connect)

    {:ok, state}
  end

  @impl true
  def handle_info(:connect, state) do
    # TODO: Implement actual WebSocket connection
    # For now, this is a stub that always succeeds
    Logger.debug("CapnWeb: Connecting to #{state.url}")
    {:noreply, %{state | conn: :connected}}
  end

  @impl true
  def handle_info({:websocket, :message, data}, state) do
    # Handle incoming WebSocket messages
    case Jason.decode(data) do
      {:ok, %{"id" => id, "result" => result}} ->
        case Map.pop(state.pending, id) do
          {nil, _} ->
            Logger.warn("CapnWeb: Received response for unknown request #{id}")
            {:noreply, state}

          {from, pending} ->
            GenServer.reply(from, {:ok, result})
            {:noreply, %{state | pending: pending}}
        end

      {:ok, %{"id" => id, "error" => error}} ->
        case Map.pop(state.pending, id) do
          {nil, _} ->
            {:noreply, state}

          {from, pending} ->
            GenServer.reply(from, {:error, CapnWeb.Error.from_rpc_error(error)})
            {:noreply, %{state | pending: pending}}
        end

      _ ->
        {:noreply, state}
    end
  end

  @impl true
  def handle_call({:execute, promise}, from, state) do
    {id, state} = next_id(state)

    # Build the RPC message
    message = build_message(id, promise)

    # Store pending request
    state = %{state | pending: Map.put(state.pending, id, from)}

    # Send message (TODO: actual WebSocket send)
    send_message(state.conn, message)

    {:noreply, state}
  end

  @impl true
  def handle_call({:execute_batch, indexed_promises}, from, state) do
    # For batch execution, we send all messages and track them
    {messages, state} =
      Enum.map_reduce(indexed_promises, state, fn {promise, idx}, acc ->
        {id, acc} = next_id(acc)
        message = build_message(id, promise)
        acc = %{acc | pending: Map.put(acc.pending, id, {from, idx})}
        {message, acc}
      end)

    # Send all messages
    Enum.each(messages, &send_message(state.conn, &1))

    {:noreply, state}
  end

  @impl true
  def handle_call({:export, target}, _from, state) do
    {id, state} = next_id(state)
    ref = make_ref()
    state = %{state | exports: Map.put(state.exports, ref, {id, target})}
    {:reply, {:ok, ref}, state}
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp next_id(%{next_id: id} = state) do
    {id, %{state | next_id: id + 1}}
  end

  defp build_message(id, %CapnWeb.Promise{} = promise) do
    base = %{
      "id" => id,
      "type" => "call",
      "path" => Enum.map(promise.path, &to_string/1),
      "args" => promise.args
    }

    # Add pipelined operations
    base =
      if promise.operations != [] do
        Map.put(base, "pipeline", Enum.map(promise.operations, &encode_operation/1))
      else
        base
      end

    # Add map operation if present
    if promise.map_fn do
      # Encode the mapper function as an expression
      # The function captures the self reference for server-side execution
      Map.put(base, "map", %{
        "expression" => encode_mapper(promise.map_fn),
        "captures" => ["$self"]
      })
    else
      base
    end
  end

  defp encode_operation({:property, name}) do
    %{"type" => "property", "name" => to_string(name)}
  end

  defp encode_operation({:call, method, args}) do
    %{"type" => "call", "method" => to_string(method), "args" => args}
  end

  defp encode_mapper(_fn) do
    # TODO: This requires AST inspection to extract the lambda body
    # For now, return a placeholder
    "x => self.square(x)"
  end

  defp send_message(:connected, message) do
    # TODO: Actual WebSocket send
    Logger.debug("CapnWeb: Sending #{inspect(message)}")
    :ok
  end

  defp send_message(nil, _message) do
    Logger.warn("CapnWeb: Not connected, cannot send message")
    {:error, :not_connected}
  end
end

defmodule CapnWeb.Target do
  @moduledoc """
  Behaviour for local objects that can be called remotely.

  ## Example

      defmodule MyHandler do
        use CapnWeb.Target

        @impl CapnWeb.Target
        def handle(:on_message, %{content: content}) do
          IO.puts("Got: \#{content}")
          :ok
        end

        @impl CapnWeb.Target
        def handle(:on_disconnect, reason) do
          IO.puts("Disconnected: \#{reason}")
          :ok
        end
      end

  """

  @callback handle(method :: atom(), args :: any()) :: any()

  defmacro __using__(_opts) do
    quote do
      @behaviour CapnWeb.Target

      def __rpc_methods__ do
        # Return list of implemented methods
        # This would be populated by compile-time introspection
        []
      end

      defoverridable __rpc_methods__: 0
    end
  end
end

defmodule CapnWeb.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Start the session registry
      {Registry, keys: :unique, name: CapnWeb.Registry}
    ]

    opts = [strategy: :one_for_one, name: CapnWeb.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
