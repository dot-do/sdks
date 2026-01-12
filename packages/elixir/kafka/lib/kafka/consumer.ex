defmodule DotDo.Kafka.Consumer do
  @moduledoc """
  Kafka consumer with GenStage producer support.

  Consumers can be used as GenStage producers for integration with
  Flow, Broadway, or custom consumers.

  ## Basic Usage

      {:ok, consumer} = DotDo.Kafka.subscribe(kafka, "events",
        group_id: "my-group"
      )

      DotDo.Kafka.Consumer.on_message(consumer, fn msg ->
        IO.inspect(msg)
        :ok
      end)

  ## GenStage Usage

      # Consumer is a GenStage producer
      {:ok, consumer} = DotDo.Kafka.subscribe(kafka, "events",
        group_id: "my-group"
      )

      # Subscribe a custom consumer stage
      GenStage.sync_subscribe(my_consumer_stage, to: consumer)

  ## Flow Usage

      consumer
      |> Flow.from_stage()
      |> Flow.partition(key: {:key, :key})
      |> Flow.map(&process_message/1)
      |> Flow.run()

  """

  use GenStage
  require Logger

  alias DotDo.Kafka.{Client, Message, Error}

  defstruct [
    :client,
    :topics,
    :group_id,
    :mode,
    :options,
    :subscribed,
    :pending_acks,
    :message_handler,
    :pid
  ]

  @type t :: %__MODULE__{
          client: Client.t(),
          topics: [String.t()] | [{String.t(), non_neg_integer()}],
          group_id: String.t() | nil,
          mode: :subscribe | :assign,
          options: map(),
          subscribed: boolean(),
          pending_acks: map(),
          message_handler: (Message.t() -> any()) | nil,
          pid: pid()
        }

  # =============================================================================
  # Public API
  # =============================================================================

  @doc """
  Starts a consumer.
  """
  @spec start_link(Client.t(), [String.t()] | [{String.t(), non_neg_integer()}], keyword()) ::
          {:ok, t()} | {:error, Error.t()}
  def start_link(client, topics, opts \\ []) do
    mode = Keyword.get(opts, :mode, :subscribe)
    group_id = Keyword.get(opts, :group_id)

    if mode == :subscribe and is_nil(group_id) do
      {:error, Error.config_error("group_id is required for subscribe mode")}
    else
      consumer_opts = build_consumer_options(opts)

      init_state = %{
        client: client,
        topics: topics,
        group_id: group_id,
        mode: mode,
        options: consumer_opts
      }

      case GenStage.start_link(__MODULE__, init_state) do
        {:ok, pid} ->
          consumer = %__MODULE__{
            client: client,
            topics: topics,
            group_id: group_id,
            mode: mode,
            options: consumer_opts,
            subscribed: false,
            pending_acks: %{},
            message_handler: nil,
            pid: pid
          }

          {:ok, consumer}

        {:error, reason} ->
          {:error, Error.internal_error("Failed to start consumer: #{inspect(reason)}")}
      end
    end
  end

  @doc """
  Registers a message handler callback.

  The handler will be called for each message. The handler can return:
  - `:ok` - Message processed successfully
  - `{:error, reason}` - Message processing failed

  ## Example

      DotDo.Kafka.Consumer.on_message(consumer, fn msg ->
        case process(msg) do
          :ok -> :ok
          {:error, reason} -> {:error, reason}
        end
      end)

  """
  @spec on_message(t(), (Message.t() -> :ok | {:error, any()})) :: :ok
  def on_message(%__MODULE__{pid: pid}, handler) when is_function(handler, 1) do
    GenStage.call(pid, {:set_handler, handler})
  end

  @doc """
  Commits offsets for the consumer.
  """
  @spec commit(t(), map() | nil) :: :ok | {:error, Error.t()}
  def commit(%__MODULE__{pid: pid}, offsets \\ nil) do
    GenStage.call(pid, {:commit, offsets})
  end

  @doc """
  Seeks to a specific offset.
  """
  @spec seek(t(), String.t(), non_neg_integer(), any()) :: :ok | {:error, Error.t()}
  def seek(%__MODULE__{pid: pid}, topic, partition, offset) do
    GenStage.call(pid, {:seek, topic, partition, offset})
  end

  @doc """
  Acknowledges a message.
  """
  @spec ack(t(), Message.t()) :: :ok
  def ack(%__MODULE__{pid: pid}, %Message{} = message) do
    GenStage.cast(pid, {:ack, message})
  end

  @doc """
  Negatively acknowledges a message.
  """
  @spec nack(t(), Message.t()) :: :ok
  def nack(%__MODULE__{pid: pid}, %Message{} = message) do
    GenStage.cast(pid, {:nack, message})
  end

  @doc """
  Stops the consumer.
  """
  @spec stop(t()) :: :ok
  def stop(%__MODULE__{pid: pid}) do
    GenStage.stop(pid)
  end

  # =============================================================================
  # GenStage Callbacks
  # =============================================================================

  @impl true
  def init(state) do
    consumer = %__MODULE__{
      client: state.client,
      topics: state.topics,
      group_id: state.group_id,
      mode: state.mode,
      options: state.options,
      subscribed: false,
      pending_acks: %{},
      message_handler: nil,
      pid: self()
    }

    # Subscribe/assign asynchronously
    send(self(), :subscribe)

    {:producer, %{consumer: consumer, demand: 0, buffer: []}}
  end

  @impl true
  def handle_demand(demand, state) do
    new_demand = state.demand + demand
    {messages, new_state} = fetch_messages(%{state | demand: new_demand})
    {:noreply, messages, new_state}
  end

  @impl true
  def handle_call({:set_handler, handler}, _from, state) do
    new_consumer = %{state.consumer | message_handler: handler}
    {:reply, :ok, [], %{state | consumer: new_consumer}}
  end

  @impl true
  def handle_call({:commit, offsets}, _from, state) do
    result = do_commit(state.consumer, offsets)
    {:reply, result, [], state}
  end

  @impl true
  def handle_call({:seek, topic, partition, offset}, _from, state) do
    result = do_seek(state.consumer, topic, partition, offset)
    {:reply, result, [], state}
  end

  @impl true
  def handle_cast({:ack, message}, state) do
    new_pending = Map.delete(state.consumer.pending_acks, {message.topic, message.partition, message.offset})
    new_consumer = %{state.consumer | pending_acks: new_pending}
    {:noreply, [], %{state | consumer: new_consumer}}
  end

  @impl true
  def handle_cast({:nack, message}, state) do
    # Re-queue the message
    new_buffer = [message | state.buffer]
    {:noreply, [], %{state | buffer: new_buffer}}
  end

  @impl true
  def handle_info(:subscribe, state) do
    case do_subscribe(state.consumer) do
      :ok ->
        new_consumer = %{state.consumer | subscribed: true}
        # Schedule polling
        schedule_poll()
        {:noreply, [], %{state | consumer: new_consumer}}

      {:error, reason} ->
        Logger.error("Failed to subscribe: #{inspect(reason)}")
        # Retry after delay
        Process.send_after(self(), :subscribe, 5_000)
        {:noreply, [], state}
    end
  end

  @impl true
  def handle_info(:poll, state) do
    if state.demand > 0 do
      {messages, new_state} = fetch_messages(state)
      schedule_poll()
      {:noreply, messages, new_state}
    else
      schedule_poll()
      {:noreply, [], state}
    end
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp build_consumer_options(opts) do
    %{
      auto_offset_reset: Keyword.get(opts, :auto_offset_reset, :latest),
      enable_auto_commit: Keyword.get(opts, :enable_auto_commit, true),
      auto_commit_interval: Keyword.get(opts, :auto_commit_interval, 5000),
      max_poll_records: Keyword.get(opts, :max_poll_records, 500),
      session_timeout: Keyword.get(opts, :session_timeout, 30000)
    }
  end

  defp schedule_poll do
    Process.send_after(self(), :poll, 100)
  end

  defp fetch_messages(state) do
    if state.consumer.subscribed and state.demand > 0 do
      max_records = min(state.demand, state.consumer.options.max_poll_records)

      # First, dispatch from buffer
      {from_buffer, remaining_buffer} = Enum.split(state.buffer, max_records)
      dispatched = length(from_buffer)
      remaining_demand = state.demand - dispatched

      if remaining_demand > 0 do
        # Fetch more from server
        case poll_messages(state.consumer, remaining_demand) do
          {:ok, messages} ->
            # Apply handler if set
            if state.consumer.message_handler do
              Enum.each(messages, state.consumer.message_handler)
            end

            all_messages = from_buffer ++ messages
            {all_messages, %{state | buffer: remaining_buffer, demand: state.demand - length(all_messages)}}

          {:error, _} ->
            {from_buffer, %{state | buffer: remaining_buffer, demand: remaining_demand}}
        end
      else
        {from_buffer, %{state | buffer: remaining_buffer, demand: 0}}
      end
    else
      {[], state}
    end
  end

  defp do_subscribe(consumer) do
    request =
      case consumer.mode do
        :subscribe ->
          %{
            "type" => "subscribe",
            "topics" => consumer.topics,
            "groupId" => consumer.group_id,
            "options" => encode_options(consumer.options)
          }

        :assign ->
          assignments =
            Enum.map(consumer.topics, fn {topic, partition} ->
              %{"topic" => topic, "partition" => partition}
            end)

          %{
            "type" => "assign",
            "assignments" => assignments
          }
      end

    case Client.execute(consumer.client, request, 30_000) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  defp poll_messages(consumer, max_records) do
    request = %{
      "type" => "poll",
      "maxRecords" => max_records
    }

    case Client.execute(consumer.client, request, 5_000) do
      {:ok, %{"messages" => messages}} when is_list(messages) ->
        {:ok, Enum.map(messages, &Message.from_response/1)}

      {:ok, _} ->
        {:ok, []}

      {:error, _} = error ->
        error
    end
  end

  defp do_commit(consumer, nil) do
    request = %{
      "type" => "commit"
    }

    case Client.execute(consumer.client, request, 5_000) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  defp do_commit(consumer, offsets) do
    formatted_offsets =
      Enum.map(offsets, fn {{topic, partition}, offset} ->
        %{"topic" => topic, "partition" => partition, "offset" => offset}
      end)

    request = %{
      "type" => "commit",
      "offsets" => formatted_offsets
    }

    case Client.execute(consumer.client, request, 5_000) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  defp do_seek(consumer, topic, partition, offset) do
    seek_position =
      case offset do
        :beginning -> %{"position" => "beginning"}
        :end -> %{"position" => "end"}
        {:timestamp, ts} -> %{"timestamp" => ts}
        n when is_integer(n) -> %{"offset" => n}
      end

    request =
      Map.merge(seek_position, %{
        "type" => "seek",
        "topic" => topic,
        "partition" => partition
      })

    case Client.execute(consumer.client, request, 5_000) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  defp encode_options(options) do
    options
    |> Enum.map(fn
      {:auto_offset_reset, v} -> {"autoOffsetReset", Atom.to_string(v)}
      {:enable_auto_commit, v} -> {"enableAutoCommit", v}
      {:auto_commit_interval, v} -> {"autoCommitIntervalMs", v}
      {:max_poll_records, v} -> {"maxPollRecords", v}
      {:session_timeout, v} -> {"sessionTimeoutMs", v}
    end)
    |> Map.new()
  end
end
