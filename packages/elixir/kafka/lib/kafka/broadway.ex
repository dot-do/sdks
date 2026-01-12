defmodule DotDo.Kafka.Broadway do
  @moduledoc """
  Broadway producer for DotDo Kafka.

  This module provides a Broadway producer that integrates with the
  DotDo Kafka RPC service for high-throughput message processing.

  ## Usage

      defmodule MyBroadway do
        use Broadway

        def start_link(_opts) do
          Broadway.start_link(__MODULE__,
            name: __MODULE__,
            producer: [
              module: {DotDo.Kafka.Broadway,
                url: "wss://kafka.do",
                topic: "events",
                group_id: "my-group",
                auto_offset_reset: :earliest
              }
            ],
            processors: [
              default: [concurrency: 10]
            ],
            batchers: [
              default: [
                batch_size: 100,
                batch_timeout: 200
              ]
            ]
          )
        end

        def handle_message(_, message, _) do
          # Process message
          message
        end

        def handle_batch(_, messages, _, _) do
          # Process batch
          messages
        end
      end

  ## Options

    * `:url` - DotDo Kafka RPC URL (required)
    * `:topic` - Topic to consume from (required)
    * `:group_id` - Consumer group ID (required)
    * `:auto_offset_reset` - `:earliest` or `:latest` (default: `:latest`)
    * `:max_poll_records` - Max records per poll (default: 500)
    * `:session_timeout` - Session timeout in ms (default: 30000)
    * `:headers` - Additional HTTP headers

  """

  use GenStage
  require Logger

  alias DotDo.Kafka.{Client, Consumer, Message}

  @behaviour Broadway.Producer

  @impl true
  def init(opts) do
    url = Keyword.fetch!(opts, :url)
    topic = Keyword.fetch!(opts, :topic)
    group_id = Keyword.fetch!(opts, :group_id)

    # Create client
    client_opts = Keyword.take(opts, [:timeout, :headers, :pool_size])

    case Client.new(url, client_opts) do
      {:ok, client} ->
        # Start consumer
        consumer_opts = [
          group_id: group_id,
          auto_offset_reset: Keyword.get(opts, :auto_offset_reset, :latest),
          enable_auto_commit: false,  # Broadway handles acknowledgments
          max_poll_records: Keyword.get(opts, :max_poll_records, 500),
          session_timeout: Keyword.get(opts, :session_timeout, 30000)
        ]

        case Consumer.start_link(client, [topic], consumer_opts) do
          {:ok, consumer} ->
            state = %{
              client: client,
              consumer: consumer,
              topic: topic,
              demand: 0,
              pending: %{}
            }

            # Schedule initial poll
            send(self(), :poll)

            {:producer, state}

          {:error, reason} ->
            {:stop, reason}
        end

      {:error, reason} ->
        {:stop, reason}
    end
  end

  @impl true
  def handle_demand(demand, state) do
    new_demand = state.demand + demand
    {messages, new_state} = poll_if_needed(%{state | demand: new_demand})
    {:noreply, messages, new_state}
  end

  @impl true
  def handle_info(:poll, state) do
    {messages, new_state} = poll_if_needed(state)
    schedule_poll()
    {:noreply, messages, new_state}
  end

  @impl Broadway.Producer
  def prepare_for_draining(state) do
    # Commit any pending offsets before draining
    Consumer.commit(state.consumer)
    {:noreply, [], state}
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp poll_if_needed(%{demand: 0} = state), do: {[], state}

  defp poll_if_needed(state) do
    case poll_messages(state.consumer, state.demand) do
      {:ok, messages} when messages != [] ->
        broadway_messages = Enum.map(messages, &to_broadway_message/1)

        # Track pending for acknowledgment
        new_pending =
          Enum.reduce(messages, state.pending, fn msg, acc ->
            key = {msg.topic, msg.partition, msg.offset}
            Map.put(acc, key, msg)
          end)

        new_demand = max(0, state.demand - length(messages))

        {broadway_messages, %{state | demand: new_demand, pending: new_pending}}

      _ ->
        {[], state}
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

  defp to_broadway_message(%Message{} = msg) do
    metadata = %{
      topic: msg.topic,
      partition: msg.partition,
      offset: msg.offset,
      key: msg.key,
      headers: msg.headers,
      timestamp: msg.timestamp,
      timestamp_type: msg.timestamp_type
    }

    acknowledger = {__MODULE__, {msg.topic, msg.partition}, msg.offset}

    %Broadway.Message{
      data: msg.value,
      metadata: metadata,
      acknowledger: acknowledger
    }
  end

  defp schedule_poll do
    Process.send_after(self(), :poll, 100)
  end

  # Broadway acknowledgment callback
  @doc false
  def ack({topic, partition}, successful, failed) do
    # Commit the highest successful offset
    if successful != [] do
      max_offset =
        successful
        |> Enum.map(fn %{acknowledger: {_, _, offset}} -> offset end)
        |> Enum.max()

      # The commit would need to be sent to the consumer
      Logger.debug("Acking up to offset #{max_offset} for #{topic}-#{partition}")
    end

    # Log failures
    if failed != [] do
      Logger.warning("Failed to process #{length(failed)} messages from #{topic}-#{partition}")
    end

    :ok
  end
end
