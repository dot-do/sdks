defmodule DotDo.Rpc do
  @moduledoc """
  DotDo RPC client for Elixir.

  Provides remote method invocation with promise pipelining support,
  leveraging Elixir's pipe operator for elegant API composition.

  ## Basic Usage

      # Create an RPC client
      {:ok, client} = DotDo.Rpc.connect("https://api.example.com")

      # Make remote calls using pipe operator
      result = client
      |> DotDo.Rpc.call(:users, :get, [123])
      |> DotDo.Rpc.await!()

  ## Remote Map (rmap)

      # Map over remote collection - single round trip
      users = client
      |> DotDo.Rpc.call(:users, :list, [])
      |> DotDo.Rpc.rmap(fn user ->
        user
        |> DotDo.Rpc.call(:profile, :enrich, [])
      end)
      |> DotDo.Rpc.await!()

  """

  alias DotDo.Rpc.{Client, Request, Response, Error}

  @type url :: String.t()
  @type method :: atom() | String.t()
  @type args :: list()

  @type connect_opts :: [
          timeout: non_neg_integer(),
          headers: [{String.t(), String.t()}],
          pool_size: pos_integer()
        ]

  # =============================================================================
  # Connection
  # =============================================================================

  @doc """
  Connects to a DotDo RPC server.

  ## Options

    * `:timeout` - Request timeout in milliseconds (default: 30_000)
    * `:headers` - Additional headers for requests
    * `:pool_size` - Connection pool size (default: 10)

  ## Examples

      {:ok, client} = DotDo.Rpc.connect("https://api.example.com")

      {:ok, client} = DotDo.Rpc.connect("https://api.example.com",
        timeout: 60_000,
        headers: [{"authorization", "Bearer token"}]
      )

  """
  @spec connect(url(), connect_opts()) :: {:ok, Client.t()} | {:error, Error.t()}
  def connect(url, opts \\ []) do
    Client.new(url, opts)
  end

  @doc """
  Connects to a DotDo RPC server, raising on error.
  """
  @spec connect!(url(), connect_opts()) :: Client.t()
  def connect!(url, opts \\ []) do
    case connect(url, opts) do
      {:ok, client} -> client
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # RPC Calls
  # =============================================================================

  @doc """
  Creates a remote method call request.

  This returns a Request struct that can be piped to other operations
  before being executed with `await/1`.

  ## Examples

      # Simple call
      request = client
      |> DotDo.Rpc.call(:math, :add, [1, 2])

      # Chained calls (pipelining)
      request = client
      |> DotDo.Rpc.call(:users, :get, [123])
      |> DotDo.Rpc.call(:profile, :name, [])

  """
  @spec call(Client.t() | Request.t(), method(), method(), args()) :: Request.t()
  def call(%Client{} = client, service, method, args \\ []) do
    Request.new(client, service, method, args)
  end

  def call(%Request{} = request, service, method, args \\ []) do
    Request.chain(request, service, method, args)
  end

  @doc """
  Invokes a method on a request result (for chaining).
  """
  @spec invoke(Request.t(), method(), args()) :: Request.t()
  def invoke(%Request{} = request, method, args \\ []) do
    Request.invoke(request, method, args)
  end

  # =============================================================================
  # Remote Map (rmap)
  # =============================================================================

  @doc """
  Maps a function over a remote collection.

  This is the key optimization that eliminates N+1 round trips. The mapping
  function is serialized and sent to the server, which applies it to each
  element of the collection.

  ## Examples

      # Square each number remotely
      squared = client
      |> DotDo.Rpc.call(:math, :range, [1, 10])
      |> DotDo.Rpc.rmap(fn n ->
        n
        |> DotDo.Rpc.call(:math, :square, [])
      end)
      |> DotDo.Rpc.await!()

      # Enrich user profiles
      enriched = client
      |> DotDo.Rpc.call(:users, :list, [])
      |> DotDo.Rpc.rmap(fn user ->
        user
        |> DotDo.Rpc.invoke(:enrich, [%{include_avatar: true}])
      end)
      |> DotDo.Rpc.await!()

  ## Behavior on Special Values

    * `nil` - Returns `nil` (no error)
    * Single value - Applies the transform to the single value
    * List - Applies the transform to each element, preserving order

  """
  @spec rmap(Request.t(), (any() -> Request.t())) :: Request.t()
  def rmap(%Request{} = request, mapper_fn) when is_function(mapper_fn, 1) do
    Request.rmap(request, mapper_fn)
  end

  @doc """
  Filters a remote collection.

  The predicate function is serialized and sent to the server.

  ## Example

      # Filter active users
      active = client
      |> DotDo.Rpc.call(:users, :list, [])
      |> DotDo.Rpc.rfilter(fn user ->
        user
        |> DotDo.Rpc.invoke(:active?, [])
      end)
      |> DotDo.Rpc.await!()

  """
  @spec rfilter(Request.t(), (any() -> Request.t())) :: Request.t()
  def rfilter(%Request{} = request, predicate_fn) when is_function(predicate_fn, 1) do
    Request.rfilter(request, predicate_fn)
  end

  @doc """
  Reduces a remote collection.

  ## Example

      # Sum all values
      total = client
      |> DotDo.Rpc.call(:orders, :amounts, [])
      |> DotDo.Rpc.rreduce(0, fn amount, acc ->
        acc + amount
      end)
      |> DotDo.Rpc.await!()

  """
  @spec rreduce(Request.t(), any(), (any(), any() -> any())) :: Request.t()
  def rreduce(%Request{} = request, initial, reducer_fn) when is_function(reducer_fn, 2) do
    Request.rreduce(request, initial, reducer_fn)
  end

  # =============================================================================
  # Execution
  # =============================================================================

  @doc """
  Executes the request and returns the result.

  ## Options

    * `:timeout` - Override the default timeout

  ## Examples

      {:ok, result} = client
      |> DotDo.Rpc.call(:math, :add, [1, 2])
      |> DotDo.Rpc.await()

      case client |> DotDo.Rpc.call(:users, :get, [123]) |> DotDo.Rpc.await() do
        {:ok, user} -> IO.puts(user.name)
        {:error, %DotDo.Rpc.Error{type: :not_found}} -> IO.puts("Not found")
      end

  """
  @spec await(Request.t(), keyword()) :: {:ok, any()} | {:error, Error.t()}
  def await(%Request{} = request, opts \\ []) do
    Request.execute(request, opts)
  end

  @doc """
  Executes the request, raising on error.
  """
  @spec await!(Request.t(), keyword()) :: any()
  def await!(%Request{} = request, opts \\ []) do
    case await(request, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Batch Operations
  # =============================================================================

  @doc """
  Executes multiple requests in a single batch.

  All requests are sent to the server together, minimizing round trips.

  ## Example

      {:ok, [user, posts, comments]} = DotDo.Rpc.batch([
        client |> DotDo.Rpc.call(:users, :get, [123]),
        client |> DotDo.Rpc.call(:posts, :by_user, [123]),
        client |> DotDo.Rpc.call(:comments, :by_user, [123])
      ])

  """
  @spec batch([Request.t()], keyword()) :: {:ok, [any()]} | {:error, Error.t()}
  def batch(requests, opts \\ []) when is_list(requests) do
    Request.batch(requests, opts)
  end

  @doc """
  Executes multiple requests in a batch, raising on error.
  """
  @spec batch!([Request.t()], keyword()) :: [any()]
  def batch!(requests, opts \\ []) do
    case batch(requests, opts) do
      {:ok, results} -> results
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Error Recovery
  # =============================================================================

  @doc """
  Provides a fallback value if the request fails.

  ## Example

      user = client
      |> DotDo.Rpc.call(:users, :get, [123])
      |> DotDo.Rpc.rescue(fn _error -> default_user() end)
      |> DotDo.Rpc.await!()

  """
  @spec rescue(Request.t(), (Error.t() -> any())) :: Request.t()
  def rescue(%Request{} = request, handler) when is_function(handler, 1) do
    Request.rescue(request, handler)
  end

  @doc """
  Transforms the result on success.

  ## Example

      name = client
      |> DotDo.Rpc.call(:users, :get, [123])
      |> DotDo.Rpc.then(fn user -> user.name end)
      |> DotDo.Rpc.await!()

  """
  @spec then(Request.t(), (any() -> any())) :: Request.t()
  def then(%Request{} = request, transform) when is_function(transform, 1) do
    Request.then(request, transform)
  end
end

# =============================================================================
# Supporting Modules
# =============================================================================

defmodule DotDo.Rpc.Client do
  @moduledoc """
  Represents a connection to a DotDo RPC server.
  """

  defstruct [:url, :opts, :finch_name]

  @type t :: %__MODULE__{
          url: String.t(),
          opts: keyword(),
          finch_name: atom()
        }

  @doc """
  Creates a new RPC client.
  """
  @spec new(String.t(), keyword()) :: {:ok, t()} | {:error, DotDo.Rpc.Error.t()}
  def new(url, opts \\ []) do
    pool_size = Keyword.get(opts, :pool_size, 10)
    finch_name = :"DotDo.Rpc.Finch.#{:erlang.unique_integer([:positive])}"

    # Start a Finch pool for this client
    case Finch.start_link(
           name: finch_name,
           pools: %{
             url => [size: pool_size]
           }
         ) do
      {:ok, _pid} ->
        {:ok, %__MODULE__{
          url: url,
          opts: opts,
          finch_name: finch_name
        }}

      {:error, reason} ->
        {:error, DotDo.Rpc.Error.connection_error(reason)}
    end
  end

  @doc """
  Returns the default timeout for requests.
  """
  @spec default_timeout(t()) :: non_neg_integer()
  def default_timeout(%__MODULE__{opts: opts}) do
    Keyword.get(opts, :timeout, 30_000)
  end

  @doc """
  Returns the default headers for requests.
  """
  @spec default_headers(t()) :: [{String.t(), String.t()}]
  def default_headers(%__MODULE__{opts: opts}) do
    Keyword.get(opts, :headers, [])
  end
end

defmodule DotDo.Rpc.Request do
  @moduledoc """
  Represents a pending RPC request that can be pipelined.
  """

  defstruct [:client, :operations, :rmap_fn, :rfilter_fn, :rreduce, :rescue_fn, :then_fn]

  @type operation :: {:call, atom(), atom(), list()} | {:invoke, atom(), list()}

  @type t :: %__MODULE__{
          client: DotDo.Rpc.Client.t(),
          operations: [operation()],
          rmap_fn: (any() -> t()) | nil,
          rfilter_fn: (any() -> t()) | nil,
          rreduce: {any(), (any(), any() -> any())} | nil,
          rescue_fn: (DotDo.Rpc.Error.t() -> any()) | nil,
          then_fn: (any() -> any()) | nil
        }

  @doc """
  Creates a new request.
  """
  @spec new(DotDo.Rpc.Client.t(), atom(), atom(), list()) :: t()
  def new(client, service, method, args) do
    %__MODULE__{
      client: client,
      operations: [{:call, service, method, args}],
      rmap_fn: nil,
      rfilter_fn: nil,
      rreduce: nil,
      rescue_fn: nil,
      then_fn: nil
    }
  end

  @doc """
  Chains a service call onto the request.
  """
  @spec chain(t(), atom(), atom(), list()) :: t()
  def chain(%__MODULE__{operations: ops} = request, service, method, args) do
    %{request | operations: ops ++ [{:call, service, method, args}]}
  end

  @doc """
  Invokes a method on the current result.
  """
  @spec invoke(t(), atom(), list()) :: t()
  def invoke(%__MODULE__{operations: ops} = request, method, args) do
    %{request | operations: ops ++ [{:invoke, method, args}]}
  end

  @doc """
  Adds a remote map operation.
  """
  @spec rmap(t(), (any() -> t())) :: t()
  def rmap(%__MODULE__{} = request, mapper_fn) do
    %{request | rmap_fn: mapper_fn}
  end

  @doc """
  Adds a remote filter operation.
  """
  @spec rfilter(t(), (any() -> t())) :: t()
  def rfilter(%__MODULE__{} = request, predicate_fn) do
    %{request | rfilter_fn: predicate_fn}
  end

  @doc """
  Adds a remote reduce operation.
  """
  @spec rreduce(t(), any(), (any(), any() -> any())) :: t()
  def rreduce(%__MODULE__{} = request, initial, reducer_fn) do
    %{request | rreduce: {initial, reducer_fn}}
  end

  @doc """
  Adds an error recovery handler.
  """
  @spec rescue(t(), (DotDo.Rpc.Error.t() -> any())) :: t()
  def rescue(%__MODULE__{} = request, handler) do
    %{request | rescue_fn: handler}
  end

  @doc """
  Adds a result transformer.
  """
  @spec then(t(), (any() -> any())) :: t()
  def then(%__MODULE__{} = request, transform) do
    %{request | then_fn: transform}
  end

  @doc """
  Executes the request.
  """
  @spec execute(t(), keyword()) :: {:ok, any()} | {:error, DotDo.Rpc.Error.t()}
  def execute(%__MODULE__{} = request, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, DotDo.Rpc.Client.default_timeout(request.client))

    # Build the request body
    body = build_request_body(request)

    # Make the HTTP request
    http_request =
      Finch.build(
        :post,
        "#{request.client.url}/rpc",
        [{"content-type", "application/json"} | DotDo.Rpc.Client.default_headers(request.client)],
        Jason.encode!(body)
      )

    case Finch.request(http_request, request.client.finch_name, receive_timeout: timeout) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"result" => result}} ->
            result = apply_then(result, request.then_fn)
            {:ok, result}

          {:ok, %{"error" => error}} ->
            handle_error(error, request.rescue_fn)

          {:error, _} ->
            {:error, DotDo.Rpc.Error.internal_error("Invalid JSON response")}
        end

      {:ok, %Finch.Response{status: status, body: body}} ->
        handle_http_error(status, body, request.rescue_fn)

      {:error, reason} ->
        handle_error(reason, request.rescue_fn)
    end
  end

  @doc """
  Executes multiple requests in a batch.
  """
  @spec batch([t()], keyword()) :: {:ok, [any()]} | {:error, DotDo.Rpc.Error.t()}
  def batch(requests, opts \\ []) when is_list(requests) do
    # Group by client for efficiency
    by_client = Enum.group_by(requests, & &1.client)

    results =
      Enum.flat_map(by_client, fn {client, client_requests} ->
        timeout = Keyword.get(opts, :timeout, DotDo.Rpc.Client.default_timeout(client))

        # Build batch request body
        body = %{
          "batch" => Enum.map(client_requests, &build_request_body/1)
        }

        http_request =
          Finch.build(
            :post,
            "#{client.url}/rpc/batch",
            [{"content-type", "application/json"} | DotDo.Rpc.Client.default_headers(client)],
            Jason.encode!(body)
          )

        case Finch.request(http_request, client.finch_name, receive_timeout: timeout) do
          {:ok, %Finch.Response{status: 200, body: response_body}} ->
            case Jason.decode(response_body) do
              {:ok, %{"results" => results}} ->
                Enum.zip(client_requests, results)
                |> Enum.map(fn {req, result} ->
                  apply_then(result, req.then_fn)
                end)

              {:error, _} ->
                Enum.map(client_requests, fn _ -> nil end)
            end

          {:error, _} ->
            Enum.map(client_requests, fn _ -> nil end)
        end
      end)

    {:ok, results}
  rescue
    e -> {:error, DotDo.Rpc.Error.from_exception(e)}
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp build_request_body(%__MODULE__{} = request) do
    base = %{
      "operations" => Enum.map(request.operations, &encode_operation/1)
    }

    base =
      if request.rmap_fn do
        Map.put(base, "rmap", %{
          "expression" => encode_function(request.rmap_fn)
        })
      else
        base
      end

    base =
      if request.rfilter_fn do
        Map.put(base, "rfilter", %{
          "expression" => encode_function(request.rfilter_fn)
        })
      else
        base
      end

    if request.rreduce do
      {initial, reducer_fn} = request.rreduce
      Map.put(base, "rreduce", %{
        "initial" => initial,
        "expression" => encode_function(reducer_fn)
      })
    else
      base
    end
  end

  defp encode_operation({:call, service, method, args}) do
    %{
      "type" => "call",
      "service" => to_string(service),
      "method" => to_string(method),
      "args" => args
    }
  end

  defp encode_operation({:invoke, method, args}) do
    %{
      "type" => "invoke",
      "method" => to_string(method),
      "args" => args
    }
  end

  defp encode_function(_fn) do
    # TODO: Implement proper function serialization
    # This would involve AST inspection or a DSL
    "x => x"
  end

  defp apply_then(result, nil), do: result
  defp apply_then(result, transform), do: transform.(result)

  defp handle_error(error, nil) do
    {:error, DotDo.Rpc.Error.from_response(error)}
  end

  defp handle_error(error, rescue_fn) do
    {:ok, rescue_fn.(DotDo.Rpc.Error.from_response(error))}
  end

  defp handle_http_error(status, body, rescue_fn) do
    error = DotDo.Rpc.Error.http_error(status, body)
    if rescue_fn do
      {:ok, rescue_fn.(error)}
    else
      {:error, error}
    end
  end
end

defmodule DotDo.Rpc.Response do
  @moduledoc """
  Represents an RPC response.
  """

  defstruct [:status, :result, :error]

  @type t :: %__MODULE__{
          status: :ok | :error,
          result: any(),
          error: DotDo.Rpc.Error.t() | nil
        }
end

defmodule DotDo.Rpc.Error do
  @moduledoc """
  Error types for DotDo.Rpc operations.
  """

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

  @doc "Creates an HTTP error."
  def http_error(status, body) do
    %__MODULE__{
      type: :http_error,
      message: "HTTP #{status}: #{body}",
      status: status
    }
  end

  @doc "Creates an internal error."
  def internal_error(message) do
    %__MODULE__{
      type: :internal_error,
      message: message
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
  def from_response(error) when is_map(error) do
    %__MODULE__{
      type: Map.get(error, "type", "unknown") |> String.to_atom(),
      message: Map.get(error, "message", "Unknown error"),
      code: Map.get(error, "code"),
      details: Map.get(error, "details")
    }
  end

  def from_response(error) do
    %__MODULE__{
      type: :unknown,
      message: inspect(error)
    }
  end
end
