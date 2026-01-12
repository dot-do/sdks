defmodule DotDo do
  @moduledoc """
  DotDo platform SDK for Elixir.

  Provides authentication, connection pooling, and retry logic for
  interacting with the DotDo platform.

  ## Quick Start

      # Configure in your application
      config :dotdo,
        api_key: "your-api-key",
        base_url: "https://api.dotdo.io"

      # Use in your code
      {:ok, client} = DotDo.connect()

      result = client
      |> DotDo.request(:get, "/users/123")
      |> DotDo.await!()

  ## Connection Pooling

      # Start a supervised connection pool
      children = [
        {DotDo.ConnectionPool, name: MyApp.DotDo, pool_size: 20}
      ]

      # Use the pool
      client = DotDo.from_pool(MyApp.DotDo)

  ## Retry Logic

      # Requests automatically retry on transient failures
      result = client
      |> DotDo.request(:get, "/data")
      |> DotDo.with_retry(max_attempts: 5, backoff: :exponential)
      |> DotDo.await!()

  """

  alias DotDo.{Auth, Client, ConnectionPool, Retry, Error}

  @type method :: :get | :post | :put | :patch | :delete
  @type path :: String.t()
  @type body :: map() | nil

  @type connect_opts :: [
          api_key: String.t(),
          base_url: String.t(),
          timeout: non_neg_integer(),
          pool_size: pos_integer()
        ]

  # =============================================================================
  # Connection
  # =============================================================================

  @doc """
  Creates a new DotDo client.

  ## Options

    * `:api_key` - API key for authentication (falls back to config)
    * `:base_url` - Base URL for the API (falls back to config)
    * `:timeout` - Request timeout in milliseconds (default: 30_000)
    * `:pool_size` - Connection pool size (default: 10)

  ## Examples

      # Using configuration
      {:ok, client} = DotDo.connect()

      # With explicit options
      {:ok, client} = DotDo.connect(
        api_key: "your-api-key",
        base_url: "https://api.dotdo.io"
      )

  """
  @spec connect(connect_opts()) :: {:ok, Client.t()} | {:error, Error.t()}
  def connect(opts \\ []) do
    api_key = opts[:api_key] || Application.get_env(:dotdo, :api_key)
    base_url = opts[:base_url] || Application.get_env(:dotdo, :base_url, "https://api.dotdo.io")

    unless api_key do
      {:error, Error.config_error("API key not configured. Set :api_key option or config :dotdo, :api_key")}
    else
      Client.new(base_url, api_key, opts)
    end
  end

  @doc """
  Creates a client from a supervised connection pool.

  ## Example

      client = DotDo.from_pool(MyApp.DotDo)

  """
  @spec from_pool(atom()) :: Client.t()
  def from_pool(pool_name) do
    ConnectionPool.get_client(pool_name)
  end

  # =============================================================================
  # Authentication
  # =============================================================================

  @doc """
  Authenticates with the DotDo platform using OAuth2.

  ## Options

    * `:client_id` - OAuth2 client ID
    * `:client_secret` - OAuth2 client secret
    * `:scopes` - List of requested scopes

  ## Example

      {:ok, auth} = DotDo.authenticate(
        client_id: "your-client-id",
        client_secret: "your-client-secret",
        scopes: ["read", "write"]
      )

      client = DotDo.with_auth(client, auth)

  """
  @spec authenticate(keyword()) :: {:ok, Auth.t()} | {:error, Error.t()}
  def authenticate(opts) do
    Auth.oauth2_authenticate(opts)
  end

  @doc """
  Applies authentication to a client.
  """
  @spec with_auth(Client.t(), Auth.t()) :: Client.t()
  def with_auth(%Client{} = client, %Auth{} = auth) do
    Client.with_auth(client, auth)
  end

  @doc """
  Refreshes the authentication token.
  """
  @spec refresh_auth(Auth.t()) :: {:ok, Auth.t()} | {:error, Error.t()}
  def refresh_auth(%Auth{} = auth) do
    Auth.refresh(auth)
  end

  # =============================================================================
  # Requests
  # =============================================================================

  @doc """
  Creates a request to the DotDo API.

  ## Examples

      # GET request
      request = client |> DotDo.request(:get, "/users/123")

      # POST request with body
      request = client |> DotDo.request(:post, "/users", %{name: "Alice"})

      # With query parameters
      request = client
      |> DotDo.request(:get, "/users")
      |> DotDo.with_params(page: 1, limit: 10)

  """
  @spec request(Client.t(), method(), path(), body()) :: DotDo.Request.t()
  def request(%Client{} = client, method, path, body \\ nil) do
    DotDo.Request.new(client, method, path, body)
  end

  @doc """
  Adds query parameters to a request.
  """
  @spec with_params(DotDo.Request.t(), keyword() | map()) :: DotDo.Request.t()
  def with_params(%DotDo.Request{} = request, params) do
    DotDo.Request.with_params(request, params)
  end

  @doc """
  Adds headers to a request.
  """
  @spec with_headers(DotDo.Request.t(), [{String.t(), String.t()}]) :: DotDo.Request.t()
  def with_headers(%DotDo.Request{} = request, headers) do
    DotDo.Request.with_headers(request, headers)
  end

  # =============================================================================
  # Retry Logic
  # =============================================================================

  @doc """
  Configures retry behavior for a request.

  ## Options

    * `:max_attempts` - Maximum number of retry attempts (default: 3)
    * `:backoff` - Backoff strategy: `:linear`, `:exponential` (default: :exponential)
    * `:base_delay` - Base delay in milliseconds (default: 1000)
    * `:max_delay` - Maximum delay in milliseconds (default: 30_000)
    * `:retry_on` - List of error types to retry on (default: [:timeout, :connection_error])

  ## Example

      result = client
      |> DotDo.request(:get, "/data")
      |> DotDo.with_retry(max_attempts: 5, backoff: :exponential)
      |> DotDo.await!()

  """
  @spec with_retry(DotDo.Request.t(), keyword()) :: DotDo.Request.t()
  def with_retry(%DotDo.Request{} = request, opts \\ []) do
    DotDo.Request.with_retry(request, opts)
  end

  # =============================================================================
  # Execution
  # =============================================================================

  @doc """
  Executes the request and returns the result.

  ## Options

    * `:timeout` - Override the default timeout

  """
  @spec await(DotDo.Request.t(), keyword()) :: {:ok, any()} | {:error, Error.t()}
  def await(%DotDo.Request{} = request, opts \\ []) do
    DotDo.Request.execute(request, opts)
  end

  @doc """
  Executes the request, raising on error.
  """
  @spec await!(DotDo.Request.t(), keyword()) :: any()
  def await!(%DotDo.Request{} = request, opts \\ []) do
    case await(request, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Batch Operations
  # =============================================================================

  @doc """
  Executes multiple requests in parallel.

  ## Example

      {:ok, [user, posts, comments]} = DotDo.parallel([
        client |> DotDo.request(:get, "/users/123"),
        client |> DotDo.request(:get, "/posts?user_id=123"),
        client |> DotDo.request(:get, "/comments?user_id=123")
      ])

  """
  @spec parallel([DotDo.Request.t()], keyword()) :: {:ok, [any()]} | {:error, Error.t()}
  def parallel(requests, opts \\ []) when is_list(requests) do
    DotDo.Request.parallel(requests, opts)
  end

  @doc """
  Executes multiple requests in parallel, raising on error.
  """
  @spec parallel!([DotDo.Request.t()], keyword()) :: [any()]
  def parallel!(requests, opts \\ []) do
    case parallel(requests, opts) do
      {:ok, results} -> results
      {:error, error} -> raise error
    end
  end
end

# =============================================================================
# Supporting Modules
# =============================================================================

defmodule DotDo.Auth do
  @moduledoc """
  Authentication management for DotDo.
  """

  defstruct [:token, :token_type, :expires_at, :refresh_token, :scopes]

  @type t :: %__MODULE__{
          token: String.t(),
          token_type: String.t(),
          expires_at: DateTime.t() | nil,
          refresh_token: String.t() | nil,
          scopes: [String.t()]
        }

  @doc """
  Authenticates using OAuth2 client credentials.
  """
  @spec oauth2_authenticate(keyword()) :: {:ok, t()} | {:error, DotDo.Error.t()}
  def oauth2_authenticate(opts) do
    client_id = Keyword.fetch!(opts, :client_id)
    client_secret = Keyword.fetch!(opts, :client_secret)
    scopes = Keyword.get(opts, :scopes, [])
    token_url = Keyword.get(opts, :token_url, "https://auth.dotdo.io/oauth/token")

    body = %{
      "grant_type" => "client_credentials",
      "client_id" => client_id,
      "client_secret" => client_secret,
      "scope" => Enum.join(scopes, " ")
    }

    # Make token request
    request = Finch.build(:post, token_url, [
      {"content-type", "application/x-www-form-urlencoded"}
    ], URI.encode_query(body))

    case Finch.request(request, DotDo.Finch) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, token_data} ->
            {:ok, from_token_response(token_data, scopes)}

          {:error, _} ->
            {:error, DotDo.Error.auth_error("Invalid token response")}
        end

      {:ok, %Finch.Response{status: status, body: body}} ->
        {:error, DotDo.Error.auth_error("OAuth2 error: HTTP #{status} - #{body}")}

      {:error, reason} ->
        {:error, DotDo.Error.auth_error("OAuth2 request failed: #{inspect(reason)}")}
    end
  end

  @doc """
  Refreshes the authentication token.
  """
  @spec refresh(t()) :: {:ok, t()} | {:error, DotDo.Error.t()}
  def refresh(%__MODULE__{refresh_token: nil}) do
    {:error, DotDo.Error.auth_error("No refresh token available")}
  end

  def refresh(%__MODULE__{refresh_token: refresh_token, scopes: scopes}) do
    token_url = "https://auth.dotdo.io/oauth/token"

    body = %{
      "grant_type" => "refresh_token",
      "refresh_token" => refresh_token
    }

    request = Finch.build(:post, token_url, [
      {"content-type", "application/x-www-form-urlencoded"}
    ], URI.encode_query(body))

    case Finch.request(request, DotDo.Finch) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, token_data} ->
            {:ok, from_token_response(token_data, scopes)}

          {:error, _} ->
            {:error, DotDo.Error.auth_error("Invalid token response")}
        end

      {:error, reason} ->
        {:error, DotDo.Error.auth_error("Token refresh failed: #{inspect(reason)}")}
    end
  end

  @doc """
  Checks if the authentication token is expired.
  """
  @spec expired?(t()) :: boolean()
  def expired?(%__MODULE__{expires_at: nil}), do: false
  def expired?(%__MODULE__{expires_at: expires_at}) do
    DateTime.compare(DateTime.utc_now(), expires_at) == :gt
  end

  @doc """
  Returns the authorization header value.
  """
  @spec header_value(t()) :: String.t()
  def header_value(%__MODULE__{token: token, token_type: token_type}) do
    "#{token_type} #{token}"
  end

  defp from_token_response(data, scopes) do
    expires_at =
      if expires_in = data["expires_in"] do
        DateTime.add(DateTime.utc_now(), expires_in, :second)
      else
        nil
      end

    %__MODULE__{
      token: data["access_token"],
      token_type: data["token_type"] || "Bearer",
      expires_at: expires_at,
      refresh_token: data["refresh_token"],
      scopes: scopes
    }
  end
end

defmodule DotDo.Client do
  @moduledoc """
  Represents a DotDo API client.
  """

  defstruct [:base_url, :api_key, :auth, :opts, :finch_name]

  @type t :: %__MODULE__{
          base_url: String.t(),
          api_key: String.t(),
          auth: DotDo.Auth.t() | nil,
          opts: keyword(),
          finch_name: atom()
        }

  @doc """
  Creates a new client.
  """
  @spec new(String.t(), String.t(), keyword()) :: {:ok, t()} | {:error, DotDo.Error.t()}
  def new(base_url, api_key, opts \\ []) do
    pool_size = Keyword.get(opts, :pool_size, 10)
    finch_name = :"DotDo.Client.Finch.#{:erlang.unique_integer([:positive])}"

    case Finch.start_link(
           name: finch_name,
           pools: %{
             base_url => [size: pool_size]
           }
         ) do
      {:ok, _pid} ->
        {:ok, %__MODULE__{
          base_url: base_url,
          api_key: api_key,
          auth: nil,
          opts: opts,
          finch_name: finch_name
        }}

      {:error, reason} ->
        {:error, DotDo.Error.connection_error(reason)}
    end
  end

  @doc """
  Applies authentication to the client.
  """
  @spec with_auth(t(), DotDo.Auth.t()) :: t()
  def with_auth(%__MODULE__{} = client, %DotDo.Auth{} = auth) do
    %{client | auth: auth}
  end

  @doc """
  Returns the default timeout.
  """
  @spec default_timeout(t()) :: non_neg_integer()
  def default_timeout(%__MODULE__{opts: opts}) do
    Keyword.get(opts, :timeout, 30_000)
  end

  @doc """
  Builds authorization headers for a request.
  """
  @spec auth_headers(t()) :: [{String.t(), String.t()}]
  def auth_headers(%__MODULE__{api_key: api_key, auth: nil}) do
    [{"x-api-key", api_key}]
  end

  def auth_headers(%__MODULE__{auth: %DotDo.Auth{} = auth}) do
    [{"authorization", DotDo.Auth.header_value(auth)}]
  end
end

defmodule DotDo.Request do
  @moduledoc """
  Represents a pending DotDo API request.
  """

  defstruct [:client, :method, :path, :body, :params, :headers, :retry_opts]

  @type t :: %__MODULE__{
          client: DotDo.Client.t(),
          method: atom(),
          path: String.t(),
          body: map() | nil,
          params: map(),
          headers: [{String.t(), String.t()}],
          retry_opts: keyword() | nil
        }

  @doc """
  Creates a new request.
  """
  @spec new(DotDo.Client.t(), atom(), String.t(), map() | nil) :: t()
  def new(client, method, path, body) do
    %__MODULE__{
      client: client,
      method: method,
      path: path,
      body: body,
      params: %{},
      headers: [],
      retry_opts: nil
    }
  end

  @doc """
  Adds query parameters.
  """
  @spec with_params(t(), keyword() | map()) :: t()
  def with_params(%__MODULE__{params: existing} = request, params) do
    new_params = Map.merge(existing, Map.new(params))
    %{request | params: new_params}
  end

  @doc """
  Adds headers.
  """
  @spec with_headers(t(), [{String.t(), String.t()}]) :: t()
  def with_headers(%__MODULE__{headers: existing} = request, headers) do
    %{request | headers: existing ++ headers}
  end

  @doc """
  Configures retry behavior.
  """
  @spec with_retry(t(), keyword()) :: t()
  def with_retry(%__MODULE__{} = request, opts) do
    %{request | retry_opts: opts}
  end

  @doc """
  Executes the request.
  """
  @spec execute(t(), keyword()) :: {:ok, any()} | {:error, DotDo.Error.t()}
  def execute(%__MODULE__{} = request, opts \\ []) do
    if request.retry_opts do
      DotDo.Retry.execute(request, opts)
    else
      execute_once(request, opts)
    end
  end

  @doc """
  Executes multiple requests in parallel.
  """
  @spec parallel([t()], keyword()) :: {:ok, [any()]} | {:error, DotDo.Error.t()}
  def parallel(requests, opts \\ []) do
    tasks =
      Enum.map(requests, fn request ->
        Task.async(fn -> execute(request, opts) end)
      end)

    results =
      tasks
      |> Task.await_many(Keyword.get(opts, :timeout, 60_000))
      |> Enum.map(fn
        {:ok, result} -> result
        {:error, _} = error -> error
      end)

    errors = Enum.filter(results, &match?({:error, _}, &1))

    if Enum.empty?(errors) do
      {:ok, results}
    else
      {:error, List.first(errors) |> elem(1)}
    end
  rescue
    e -> {:error, DotDo.Error.from_exception(e)}
  end

  @doc """
  Executes the request once (without retry).
  """
  @spec execute_once(t(), keyword()) :: {:ok, any()} | {:error, DotDo.Error.t()}
  def execute_once(%__MODULE__{} = request, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, DotDo.Client.default_timeout(request.client))

    url = build_url(request)
    headers = build_headers(request)
    body = if request.body, do: Jason.encode!(request.body), else: nil

    http_request = Finch.build(request.method, url, headers, body)

    # Emit telemetry
    start_time = System.monotonic_time()
    :telemetry.execute([:dotdo, :request, :start], %{}, %{
      method: request.method,
      path: request.path
    })

    result =
      case Finch.request(http_request, request.client.finch_name, receive_timeout: timeout) do
        {:ok, %Finch.Response{status: status, body: response_body}} when status in 200..299 ->
          case Jason.decode(response_body) do
            {:ok, data} -> {:ok, data}
            {:error, _} -> {:ok, response_body}
          end

        {:ok, %Finch.Response{status: status, body: response_body}} ->
          {:error, DotDo.Error.http_error(status, response_body)}

        {:error, %Mint.TransportError{reason: :timeout}} ->
          {:error, DotDo.Error.timeout_error(timeout)}

        {:error, reason} ->
          {:error, DotDo.Error.connection_error(reason)}
      end

    # Emit completion telemetry
    duration = System.monotonic_time() - start_time
    :telemetry.execute([:dotdo, :request, :stop], %{duration: duration}, %{
      method: request.method,
      path: request.path,
      result: if(match?({:ok, _}, result), do: :ok, else: :error)
    })

    result
  end

  defp build_url(%__MODULE__{client: client, path: path, params: params}) do
    base = "#{client.base_url}#{path}"

    if map_size(params) > 0 do
      "#{base}?#{URI.encode_query(params)}"
    else
      base
    end
  end

  defp build_headers(%__MODULE__{client: client, headers: custom_headers}) do
    base_headers = [
      {"content-type", "application/json"},
      {"accept", "application/json"}
    ]

    auth_headers = DotDo.Client.auth_headers(client)

    base_headers ++ auth_headers ++ custom_headers
  end
end

defmodule DotDo.Retry do
  @moduledoc """
  Retry logic for DotDo requests.
  """

  @default_opts [
    max_attempts: 3,
    backoff: :exponential,
    base_delay: 1_000,
    max_delay: 30_000,
    retry_on: [:timeout, :connection_error]
  ]

  @doc """
  Executes a request with retry logic.
  """
  @spec execute(DotDo.Request.t(), keyword()) :: {:ok, any()} | {:error, DotDo.Error.t()}
  def execute(%DotDo.Request{retry_opts: retry_opts} = request, opts) do
    config = Keyword.merge(@default_opts, retry_opts || [])
    max_attempts = Keyword.get(config, :max_attempts)

    do_execute(request, opts, config, 1, max_attempts)
  end

  defp do_execute(request, opts, config, attempt, max_attempts) when attempt > max_attempts do
    # Final attempt without retry
    DotDo.Request.execute_once(request, opts)
  end

  defp do_execute(request, opts, config, attempt, max_attempts) do
    case DotDo.Request.execute_once(request, opts) do
      {:ok, result} ->
        {:ok, result}

      {:error, %DotDo.Error{type: error_type} = error} ->
        retry_on = Keyword.get(config, :retry_on)

        if error_type in retry_on and attempt < max_attempts do
          delay = calculate_delay(config, attempt)

          :telemetry.execute([:dotdo, :retry], %{delay: delay, attempt: attempt}, %{
            method: request.method,
            path: request.path,
            error_type: error_type
          })

          Process.sleep(delay)
          do_execute(request, opts, config, attempt + 1, max_attempts)
        else
          {:error, error}
        end
    end
  end

  defp calculate_delay(config, attempt) do
    base_delay = Keyword.get(config, :base_delay)
    max_delay = Keyword.get(config, :max_delay)

    delay =
      case Keyword.get(config, :backoff) do
        :linear ->
          base_delay * attempt

        :exponential ->
          base_delay * :math.pow(2, attempt - 1) |> round()

        _ ->
          base_delay
      end

    # Add jitter (10% randomness)
    jitter = :rand.uniform(div(delay, 10))
    min(delay + jitter, max_delay)
  end
end

defmodule DotDo.ConnectionPool do
  @moduledoc """
  GenServer-based connection pool for DotDo clients.

  ## Usage

      # Add to your supervision tree
      children = [
        {DotDo.ConnectionPool, name: MyApp.DotDo, pool_size: 20}
      ]

      # Get a client from the pool
      client = DotDo.from_pool(MyApp.DotDo)

  """

  use GenServer

  defstruct [:name, :client, :opts, :health_check_ref]

  @type t :: %__MODULE__{
          name: atom(),
          client: DotDo.Client.t() | nil,
          opts: keyword(),
          health_check_ref: reference() | nil
        }

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Starts the connection pool.
  """
  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc """
  Gets a client from the pool.
  """
  @spec get_client(atom()) :: DotDo.Client.t()
  def get_client(pool_name) do
    GenServer.call(pool_name, :get_client)
  end

  @doc """
  Returns pool statistics.
  """
  @spec stats(atom()) :: map()
  def stats(pool_name) do
    GenServer.call(pool_name, :stats)
  end

  @doc """
  Triggers a health check.
  """
  @spec health_check(atom()) :: :ok | {:error, term()}
  def health_check(pool_name) do
    GenServer.call(pool_name, :health_check)
  end

  # =============================================================================
  # GenServer Callbacks
  # =============================================================================

  @impl true
  def init(opts) do
    name = Keyword.fetch!(opts, :name)
    pool_size = Keyword.get(opts, :pool_size, 10)

    api_key = opts[:api_key] || Application.get_env(:dotdo, :api_key)
    base_url = opts[:base_url] || Application.get_env(:dotdo, :base_url, "https://api.dotdo.io")

    state = %__MODULE__{
      name: name,
      client: nil,
      opts: opts,
      health_check_ref: nil
    }

    # Initialize client asynchronously
    send(self(), {:init_client, base_url, api_key, pool_size})

    # Schedule periodic health checks
    health_check_interval = Keyword.get(opts, :health_check_interval, 60_000)
    ref = Process.send_after(self(), :health_check, health_check_interval)

    {:ok, %{state | health_check_ref: ref}}
  end

  @impl true
  def handle_info({:init_client, base_url, api_key, pool_size}, state) do
    case DotDo.Client.new(base_url, api_key, pool_size: pool_size) do
      {:ok, client} ->
        :telemetry.execute([:dotdo, :pool, :connected], %{}, %{name: state.name})
        {:noreply, %{state | client: client}}

      {:error, reason} ->
        :telemetry.execute([:dotdo, :pool, :connection_failed], %{}, %{
          name: state.name,
          reason: reason
        })
        # Retry after delay
        Process.send_after(self(), {:init_client, base_url, api_key, pool_size}, 5_000)
        {:noreply, state}
    end
  end

  @impl true
  def handle_info(:health_check, state) do
    # Perform health check
    if state.client do
      spawn(fn -> do_health_check(state.name, state.client) end)
    end

    # Schedule next health check
    health_check_interval = Keyword.get(state.opts, :health_check_interval, 60_000)
    ref = Process.send_after(self(), :health_check, health_check_interval)

    {:noreply, %{state | health_check_ref: ref}}
  end

  @impl true
  def handle_call(:get_client, _from, %{client: nil} = state) do
    {:reply, {:error, :not_connected}, state}
  end

  @impl true
  def handle_call(:get_client, _from, state) do
    {:reply, state.client, state}
  end

  @impl true
  def handle_call(:stats, _from, state) do
    stats = %{
      name: state.name,
      connected: state.client != nil,
      pool_size: Keyword.get(state.opts, :pool_size, 10)
    }
    {:reply, stats, state}
  end

  @impl true
  def handle_call(:health_check, _from, state) do
    result =
      if state.client do
        do_health_check(state.name, state.client)
      else
        {:error, :not_connected}
      end

    {:reply, result, state}
  end

  defp do_health_check(name, client) do
    request = Finch.build(:get, "#{client.base_url}/health", DotDo.Client.auth_headers(client))

    case Finch.request(request, client.finch_name, receive_timeout: 5_000) do
      {:ok, %Finch.Response{status: status}} when status in 200..299 ->
        :telemetry.execute([:dotdo, :pool, :health_check, :success], %{}, %{name: name})
        :ok

      {:ok, %Finch.Response{status: status}} ->
        :telemetry.execute([:dotdo, :pool, :health_check, :failure], %{}, %{
          name: name,
          status: status
        })
        {:error, {:unhealthy, status}}

      {:error, reason} ->
        :telemetry.execute([:dotdo, :pool, :health_check, :failure], %{}, %{
          name: name,
          reason: reason
        })
        {:error, reason}
    end
  end
end

defmodule DotDo.Error do
  @moduledoc """
  Error types for DotDo operations.
  """

  defexception [:type, :message, :code, :details, :status]

  @type error_type ::
          :connection_error
          | :timeout
          | :auth_error
          | :config_error
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
      message: "Connection failed: #{inspect(reason)}"
    }
  end

  @doc "Creates a timeout error."
  def timeout_error(timeout) do
    %__MODULE__{
      type: :timeout,
      message: "Request timed out after #{timeout}ms"
    }
  end

  @doc "Creates an authentication error."
  def auth_error(message) do
    %__MODULE__{
      type: :auth_error,
      message: message
    }
  end

  @doc "Creates a configuration error."
  def config_error(message) do
    %__MODULE__{
      type: :config_error,
      message: message
    }
  end

  @doc "Creates an HTTP error."
  def http_error(status, body) do
    message =
      case Jason.decode(body) do
        {:ok, %{"error" => error}} -> error
        {:ok, %{"message" => msg}} -> msg
        _ -> body
      end

    %__MODULE__{
      type: :http_error,
      message: "HTTP #{status}: #{message}",
      status: status
    }
  end

  @doc "Creates an error from an exception."
  def from_exception(exception) do
    %__MODULE__{
      type: :internal_error,
      message: Exception.message(exception)
    }
  end
end

defmodule DotDo.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Start a default Finch pool for auth requests
      {Finch, name: DotDo.Finch}
    ]

    opts = [strategy: :one_for_one, name: DotDo.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
