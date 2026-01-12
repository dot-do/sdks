defmodule DotDo.Kafka.Client do
  @moduledoc """
  Kafka client connection management.

  Manages RPC connections to the DotDo Kafka service,
  with support for connection pooling and OTP supervision.
  """

  use GenServer
  require Logger

  defstruct [:url, :opts, :pool, :name]

  @type t :: %__MODULE__{
          url: String.t(),
          opts: keyword(),
          pool: atom() | nil,
          name: atom() | nil
        }

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Creates a new Kafka client.
  """
  @spec new(String.t(), keyword()) :: {:ok, t()} | {:error, DotDo.Kafka.Error.t()}
  def new(url, opts \\ []) do
    pool_size = Keyword.get(opts, :pool_size, 10)
    timeout = Keyword.get(opts, :timeout, 30_000)

    # Generate a unique finch pool name
    finch_name = :"DotDo.Kafka.Finch.#{:erlang.unique_integer([:positive])}"

    # Start the HTTP client pool
    finch_opts = [
      name: finch_name,
      pools: %{
        :default => [size: pool_size]
      }
    ]

    case Finch.start_link(finch_opts) do
      {:ok, _pid} ->
        client = %__MODULE__{
          url: url,
          opts: Keyword.put(opts, :timeout, timeout),
          pool: finch_name,
          name: nil
        }

        {:ok, client}

      {:error, {:already_started, _pid}} ->
        client = %__MODULE__{
          url: url,
          opts: Keyword.put(opts, :timeout, timeout),
          pool: finch_name,
          name: nil
        }

        {:ok, client}

      {:error, reason} ->
        {:error, DotDo.Kafka.Error.connection_error(reason)}
    end
  end

  @doc """
  Starts a supervised client as part of a supervision tree.
  """
  def start_link(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @doc """
  Gets a client struct from a named process.
  """
  @spec from_name(atom() | pid()) :: t()
  def from_name(name_or_pid) do
    GenServer.call(name_or_pid, :get_client)
  end

  @doc """
  Returns the default timeout.
  """
  @spec default_timeout(t()) :: non_neg_integer()
  def default_timeout(%__MODULE__{opts: opts}) do
    Keyword.get(opts, :timeout, 30_000)
  end

  @doc """
  Closes the client connection.
  """
  @spec close(t()) :: :ok
  def close(%__MODULE__{name: nil}) do
    :ok
  end

  def close(%__MODULE__{name: name}) when not is_nil(name) do
    GenServer.stop(name, :normal)
  end

  @doc """
  Executes an RPC request.
  """
  @spec execute(t(), map(), non_neg_integer()) ::
          {:ok, any()} | {:error, DotDo.Kafka.Error.t()}
  def execute(%__MODULE__{} = client, request, timeout) do
    url = "#{client.url}/rpc"
    headers = [{"content-type", "application/json"}]
    body = Jason.encode!(request)

    http_request = Finch.build(:post, url, headers, body)

    case Finch.request(http_request, client.pool, receive_timeout: timeout) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"result" => result}} ->
            {:ok, result}

          {:ok, %{"error" => error}} ->
            {:error, DotDo.Kafka.Error.from_response(error)}

          {:error, _} ->
            {:error, DotDo.Kafka.Error.internal_error("Invalid JSON response")}
        end

      {:ok, %Finch.Response{status: status, body: body}} ->
        {:error, DotDo.Kafka.Error.http_error(status, body)}

      {:error, %Mint.TransportError{reason: :timeout}} ->
        {:error, DotDo.Kafka.Error.timeout_error(timeout)}

      {:error, reason} ->
        {:error, DotDo.Kafka.Error.connection_error(reason)}
    end
  end

  # =============================================================================
  # GenServer Callbacks
  # =============================================================================

  @impl true
  def init(opts) do
    url = Keyword.fetch!(opts, :url)
    name = Keyword.fetch!(opts, :name)

    case new(url, opts) do
      {:ok, client} ->
        client = %{client | name: name}
        {:ok, client}

      {:error, reason} ->
        {:stop, reason}
    end
  end

  @impl true
  def handle_call(:get_client, _from, client) do
    {:reply, client, client}
  end

  @impl true
  def terminate(_reason, _client) do
    :ok
  end
end
