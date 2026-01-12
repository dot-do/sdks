defmodule {{Name}}Do.Client do
  @moduledoc """
  {{Name}}.do client for interacting with the {{name}} service.

  ## Example

      {:ok, client} = {{Name}}Do.Client.start_link(api_key: "your-api-key")

      # Make RPC calls
      {:ok, result} = {{Name}}Do.Client.call(client, :greet, ["World"])

      # Disconnect when done
      :ok = {{Name}}Do.Client.stop(client)
  """

  use GenServer

  alias RpcDo.Connection

  @default_base_url "https://{{name}}.do"

  @type options :: [
          api_key: String.t() | nil,
          base_url: String.t(),
          timeout: pos_integer()
        ]

  @doc """
  Starts the {{Name}}.do client.

  ## Options

    * `:api_key` - API key for authentication (optional)
    * `:base_url` - Base URL for the service (default: "https://{{name}}.do")
    * `:timeout` - Connection timeout in milliseconds (default: 30000)
  """
  @spec start_link(options()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts)
  end

  @doc """
  Stops the client and closes the connection.
  """
  @spec stop(GenServer.server()) :: :ok
  def stop(client) do
    GenServer.stop(client)
  end

  @doc """
  Makes an RPC call to the {{name}}.do service.

  ## Example

      {:ok, result} = {{Name}}Do.Client.call(client, :method_name, [arg1, arg2])
  """
  @spec call(GenServer.server(), atom(), list(), timeout()) ::
          {:ok, term()} | {:error, term()}
  def call(client, method, args \\ [], timeout \\ 30_000) do
    GenServer.call(client, {:call, method, args}, timeout)
  end

  @doc """
  Checks if the client is connected.
  """
  @spec connected?(GenServer.server()) :: boolean()
  def connected?(client) do
    GenServer.call(client, :connected?)
  end

  # GenServer callbacks

  @impl true
  def init(opts) do
    api_key = Keyword.get(opts, :api_key)
    base_url = Keyword.get(opts, :base_url, @default_base_url)
    timeout = Keyword.get(opts, :timeout, 30_000)

    state = %{
      api_key: api_key,
      base_url: base_url,
      timeout: timeout,
      connection: nil
    }

    {:ok, state}
  end

  @impl true
  def handle_call({:call, method, args}, _from, state) do
    case ensure_connected(state) do
      {:ok, state} ->
        result = Connection.call(state.connection, method, args)
        {:reply, result, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call(:connected?, _from, state) do
    {:reply, state.connection != nil, state}
  end

  @impl true
  def terminate(_reason, state) do
    if state.connection do
      Connection.close(state.connection)
    end

    :ok
  end

  # Private functions

  defp ensure_connected(%{connection: nil} = state) do
    headers =
      if state.api_key do
        [{"authorization", "Bearer #{state.api_key}"}]
      else
        []
      end

    case Connection.connect(state.base_url, headers: headers) do
      {:ok, connection} ->
        {:ok, %{state | connection: connection}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp ensure_connected(state), do: {:ok, state}
end
