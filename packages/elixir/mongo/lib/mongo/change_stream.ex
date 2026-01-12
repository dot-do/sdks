defmodule DotDo.Mongo.ChangeStream do
  @moduledoc """
  MongoDB Change Stream support with GenStage integration.

  Change streams allow you to receive real-time notifications of data changes.
  This module provides both a simple callback-based API and a GenStage producer
  for integration with Elixir's flow-based data processing.

  ## Simple Usage

      {:ok, stream} = coll
      |> DotDo.Mongo.watch(pipeline: [%{"$match" => %{"operationType" => "insert"}}])

      DotDo.Mongo.ChangeStream.subscribe(stream, fn change ->
        IO.inspect(change)
      end)

  ## GenStage Integration

      # Start a consumer
      {:ok, consumer} = MyChangeConsumer.start_link()

      # Subscribe to the stream
      GenStage.sync_subscribe(consumer, to: stream)

  ## Flow Integration

      stream
      |> Flow.from_stage()
      |> Flow.map(fn change -> process_change(change) end)
      |> Flow.run()

  """

  use GenStage
  require Logger

  defstruct [:client, :target, :pipeline, :options, :resume_token, :pid]

  @type t :: %__MODULE__{
          client: DotDo.Mongo.Client.t(),
          target: DotDo.Mongo.Collection.t() | DotDo.Mongo.Client.t(),
          pipeline: [map()],
          options: map(),
          resume_token: map() | nil,
          pid: pid() | nil
        }

  @type change_event :: %{
          optional(:_id) => map(),
          operation_type: String.t(),
          full_document: map() | nil,
          ns: %{db: String.t(), coll: String.t()},
          document_key: map() | nil,
          update_description: map() | nil,
          cluster_time: any() | nil
        }

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Opens a change stream on a collection or database.

  ## Options

    * `:pipeline` - Aggregation pipeline to filter changes
    * `:full_document` - `:default`, `:update_lookup`, `:when_available`, `:required`
    * `:resume_after` - Resume token to continue from
    * `:start_at_operation_time` - Timestamp to start from
    * `:batch_size` - Number of changes per batch
    * `:max_await_time` - Maximum time to wait for changes (ms)

  ## Examples

      # Watch a collection
      {:ok, stream} = DotDo.Mongo.ChangeStream.open(collection)

      # Watch with pipeline filter
      {:ok, stream} = DotDo.Mongo.ChangeStream.open(collection,
        pipeline: [%{"$match" => %{"operationType" => "insert"}}]
      )

      # Watch entire database
      {:ok, stream} = DotDo.Mongo.ChangeStream.open(client)

  """
  @spec open(DotDo.Mongo.Collection.t() | DotDo.Mongo.Client.t(), keyword()) ::
          {:ok, t()} | {:error, DotDo.Mongo.Error.t()}
  def open(target, opts \\ []) do
    client = extract_client(target)
    pipeline = Keyword.get(opts, :pipeline, [])
    options = build_options(opts)

    stream = %__MODULE__{
      client: client,
      target: target,
      pipeline: pipeline,
      options: options,
      resume_token: nil,
      pid: nil
    }

    # Start the GenStage producer
    case GenStage.start_link(__MODULE__, stream) do
      {:ok, pid} ->
        {:ok, %{stream | pid: pid}}

      {:error, reason} ->
        {:error, DotDo.Mongo.Error.internal_error("Failed to start stream: #{inspect(reason)}")}
    end
  end

  @doc """
  Subscribes to a change stream with a callback function.

  The callback will be invoked for each change event.

  ## Example

      DotDo.Mongo.ChangeStream.subscribe(stream, fn change ->
        IO.puts("Got change: \#{change.operation_type}")
      end)

  """
  @spec subscribe(t(), (change_event() -> any())) :: {:ok, pid()}
  def subscribe(%__MODULE__{pid: pid}, callback) when is_function(callback, 1) do
    {:ok, consumer} = DotDo.Mongo.ChangeStream.CallbackConsumer.start_link(callback)
    GenStage.sync_subscribe(consumer, to: pid)
    {:ok, consumer}
  end

  @doc """
  Closes the change stream.

  ## Example

      :ok = DotDo.Mongo.ChangeStream.close(stream)

  """
  @spec close(t()) :: :ok
  def close(%__MODULE__{pid: nil}), do: :ok

  def close(%__MODULE__{pid: pid}) do
    GenStage.stop(pid)
    :ok
  end

  @doc """
  Gets the current resume token.

  This can be used to resume the stream from the same position later.

  ## Example

      token = DotDo.Mongo.ChangeStream.resume_token(stream)

      # Later, resume from the same point
      {:ok, stream} = DotDo.Mongo.ChangeStream.open(collection,
        resume_after: token
      )

  """
  @spec resume_token(t()) :: map() | nil
  def resume_token(%__MODULE__{pid: pid}) when not is_nil(pid) do
    GenStage.call(pid, :get_resume_token)
  end

  def resume_token(%__MODULE__{resume_token: token}), do: token

  # =============================================================================
  # GenStage Callbacks
  # =============================================================================

  @impl true
  def init(%__MODULE__{} = stream) do
    # Schedule initial fetch
    send(self(), :fetch)
    {:producer, %{stream: stream, demand: 0, buffer: []}}
  end

  @impl true
  def handle_call(:get_resume_token, _from, state) do
    {:reply, state.stream.resume_token, [], state}
  end

  @impl true
  def handle_demand(demand, state) do
    new_demand = state.demand + demand
    {events, new_state} = fetch_events(%{state | demand: new_demand})
    {:noreply, events, new_state}
  end

  @impl true
  def handle_info(:fetch, state) do
    # Schedule next fetch
    Process.send_after(self(), :fetch, 100)

    if state.demand > 0 do
      {events, new_state} = fetch_events(state)
      {:noreply, events, new_state}
    else
      {:noreply, [], state}
    end
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp extract_client(%DotDo.Mongo.Collection{client: client}), do: client
  defp extract_client(%DotDo.Mongo.Client{} = client), do: client

  defp build_options(opts) do
    base = %{}

    base =
      case Keyword.get(opts, :full_document) do
        nil -> base
        fd -> Map.put(base, :full_document, fd)
      end

    base =
      case Keyword.get(opts, :resume_after) do
        nil -> base
        token -> Map.put(base, :resume_after, token)
      end

    base =
      case Keyword.get(opts, :start_at_operation_time) do
        nil -> base
        ts -> Map.put(base, :start_at_operation_time, ts)
      end

    base =
      case Keyword.get(opts, :batch_size) do
        nil -> base
        size -> Map.put(base, :batch_size, size)
      end

    case Keyword.get(opts, :max_await_time) do
      nil -> base
      time -> Map.put(base, :max_await_time_ms, time)
    end
  end

  defp fetch_events(state) do
    if state.demand > 0 and length(state.buffer) == 0 do
      # Fetch more events from the server
      case fetch_changes(state.stream) do
        {:ok, changes, resume_token} ->
          new_stream = %{state.stream | resume_token: resume_token}
          dispatch_events(changes, %{state | stream: new_stream})

        {:error, _reason} ->
          # On error, return empty and continue
          {[], state}
      end
    else
      dispatch_events([], state)
    end
  end

  defp dispatch_events(new_events, state) do
    all_events = state.buffer ++ new_events
    to_send = Enum.take(all_events, state.demand)
    remaining = Enum.drop(all_events, state.demand)
    new_demand = max(0, state.demand - length(to_send))

    {to_send, %{state | buffer: remaining, demand: new_demand}}
  end

  defp fetch_changes(%__MODULE__{client: client, target: target, pipeline: pipeline, options: options}) do
    # Build the change stream command
    request = build_change_stream_request(target, pipeline, options)

    url = "#{client.url}/rpc"
    headers = [{"content-type", "application/json"}]
    body = Jason.encode!(request)

    http_request = Finch.build(:post, url, headers, body)

    case Finch.request(http_request, client.pool, receive_timeout: 5000) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"result" => %{"changes" => changes, "resumeToken" => token}}} ->
            {:ok, Enum.map(changes, &parse_change_event/1), token}

          {:ok, %{"result" => %{"changes" => changes}}} ->
            {:ok, Enum.map(changes, &parse_change_event/1), nil}

          {:ok, %{"error" => error}} ->
            {:error, error}

          _ ->
            {:ok, [], nil}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_change_stream_request(target, pipeline, options) do
    base = %{
      "operation" => "watch",
      "pipeline" => pipeline,
      "options" => Map.new(options, fn {k, v} -> {Atom.to_string(k), v} end)
    }

    case target do
      %DotDo.Mongo.Collection{database: db, name: coll} ->
        Map.merge(base, %{"database" => db, "collection" => coll})

      %DotDo.Mongo.Client{database: db} when not is_nil(db) ->
        Map.put(base, "database", db)

      _ ->
        base
    end
  end

  defp parse_change_event(event) when is_map(event) do
    %{
      _id: event["_id"],
      operation_type: event["operationType"],
      full_document: event["fullDocument"],
      ns: parse_namespace(event["ns"]),
      document_key: event["documentKey"],
      update_description: event["updateDescription"],
      cluster_time: event["clusterTime"]
    }
  end

  defp parse_namespace(nil), do: nil

  defp parse_namespace(ns) when is_map(ns) do
    %{db: ns["db"], coll: ns["coll"]}
  end
end

defmodule DotDo.Mongo.ChangeStream.CallbackConsumer do
  @moduledoc false
  use GenStage

  def start_link(callback) do
    GenStage.start_link(__MODULE__, callback)
  end

  @impl true
  def init(callback) do
    {:consumer, %{callback: callback}}
  end

  @impl true
  def handle_events(events, _from, state) do
    Enum.each(events, state.callback)
    {:noreply, [], state}
  end
end
