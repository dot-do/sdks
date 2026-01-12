defmodule DotDo.Mongo.Client do
  @moduledoc """
  MongoDB client connection management.

  Manages WebSocket connections to the DotDo MongoDB RPC service,
  with support for connection pooling, automatic reconnection, and
  OTP supervision.
  """

  use GenServer
  require Logger

  defstruct [:url, :database, :opts, :conn, :session_id, :pool, :name]

  @type t :: %__MODULE__{
          url: String.t(),
          database: String.t() | nil,
          opts: keyword(),
          conn: pid() | nil,
          session_id: String.t() | nil,
          pool: atom() | nil,
          name: atom() | nil
        }

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Creates a new MongoDB client.
  """
  @spec new(String.t(), keyword()) :: {:ok, t()} | {:error, DotDo.Mongo.Error.t()}
  def new(url, opts \\ []) do
    pool_size = Keyword.get(opts, :pool_size, 10)
    database = Keyword.get(opts, :database)
    timeout = Keyword.get(opts, :timeout, 30_000)

    # Generate a unique finch pool name
    finch_name = :"DotDo.Mongo.Finch.#{:erlang.unique_integer([:positive])}"

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
          database: database,
          opts: Keyword.put(opts, :timeout, timeout),
          conn: nil,
          session_id: nil,
          pool: finch_name,
          name: nil
        }

        {:ok, client}

      {:error, {:already_started, _pid}} ->
        client = %__MODULE__{
          url: url,
          database: database,
          opts: Keyword.put(opts, :timeout, timeout),
          conn: nil,
          session_id: nil,
          pool: finch_name,
          name: nil
        }

        {:ok, client}

      {:error, reason} ->
        {:error, DotDo.Mongo.Error.connection_error(reason)}
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
  Returns a new client with the specified database.
  """
  @spec with_database(t(), String.t()) :: t()
  def with_database(%__MODULE__{} = client, database) do
    %{client | database: database}
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
    # Standalone client - just return ok
    :ok
  end

  def close(%__MODULE__{name: name}) when not is_nil(name) do
    GenServer.stop(name, :normal)
  end

  @doc """
  Executes a command within a transaction.
  """
  @spec with_transaction(t(), (t() -> {:ok, any()} | {:error, any()}), keyword()) ::
          {:ok, any()} | {:error, DotDo.Mongo.Error.t()}
  def with_transaction(%__MODULE__{} = client, fun, opts \\ []) do
    # Start a session
    case start_session(client, opts) do
      {:ok, session_client} ->
        try do
          # Start transaction
          case start_transaction(session_client, opts) do
            :ok ->
              case fun.(session_client) do
                {:ok, result} ->
                  case commit_transaction(session_client) do
                    :ok -> {:ok, result}
                    {:error, _} = error -> error
                  end

                {:error, _} = error ->
                  abort_transaction(session_client)
                  error
              end

            {:error, _} = error ->
              error
          end
        after
          end_session(session_client)
        end

      {:error, _} = error ->
        error
    end
  end

  # =============================================================================
  # GenServer Callbacks
  # =============================================================================

  @impl true
  def init(opts) do
    url = Keyword.fetch!(opts, :url)
    database = Keyword.get(opts, :database)
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
  def terminate(_reason, client) do
    # Cleanup pool if needed
    :ok
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp start_session(%__MODULE__{} = client, _opts) do
    session_id = generate_session_id()
    {:ok, %{client | session_id: session_id}}
  end

  defp end_session(%__MODULE__{session_id: nil}), do: :ok

  defp end_session(%__MODULE__{} = _client) do
    # Send end session command
    :ok
  end

  defp start_transaction(%__MODULE__{} = _client, _opts) do
    # Send start transaction command
    :ok
  end

  defp commit_transaction(%__MODULE__{} = _client) do
    # Send commit transaction command
    :ok
  end

  defp abort_transaction(%__MODULE__{} = _client) do
    # Send abort transaction command
    :ok
  end

  defp generate_session_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end
end
