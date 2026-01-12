defmodule DotDo.Kafka do
  @moduledoc """
  DotDo Kafka SDK for Elixir.

  Provides idiomatic Kafka operations with RPC pipelining support,
  GenStage integration, and Broadway compatibility for high-throughput
  message processing.

  ## Quick Start

      # Connect to Kafka through DotDo RPC
      {:ok, kafka} = DotDo.Kafka.connect("wss://kafka.do")

      # Produce a message
      :ok = kafka
      |> DotDo.Kafka.produce("my-topic", %{user_id: 123, action: "login"})
      |> DotDo.Kafka.await!()

      # Consume messages with a callback
      {:ok, consumer} = kafka
      |> DotDo.Kafka.subscribe("my-topic", group_id: "my-group")

      DotDo.Kafka.Consumer.on_message(consumer, fn msg ->
        IO.inspect(msg)
        :ok
      end)

  ## GenStage Producer

      # Use as a GenStage producer
      {:ok, producer} = kafka
      |> DotDo.Kafka.subscribe("events", group_id: "my-group")

      # Flow-based processing
      producer
      |> Flow.from_stage()
      |> Flow.partition()
      |> Flow.map(&process_message/1)
      |> Flow.run()

  ## Broadway Integration

      defmodule MyBroadway do
        use Broadway

        def start_link(_opts) do
          Broadway.start_link(__MODULE__,
            name: __MODULE__,
            producer: [
              module: {DotDo.Kafka.Broadway,
                url: "wss://kafka.do",
                topic: "events",
                group_id: "my-group"
              }
            ],
            processors: [
              default: [concurrency: 10]
            ]
          )
        end

        def handle_message(_, message, _) do
          # Process message
          message
        end
      end

  ## Batch Producing

      # Produce multiple messages efficiently
      messages = [
        %{key: "user-1", value: %{action: "login"}},
        %{key: "user-2", value: %{action: "logout"}}
      ]

      {:ok, results} = kafka
      |> DotDo.Kafka.produce_batch("events", messages)
      |> DotDo.Kafka.await()

  """

  alias DotDo.Kafka.{Client, Producer, Consumer, Message, Error}

  @type url :: String.t()
  @type topic :: String.t()
  @type partition :: non_neg_integer()
  @type offset :: non_neg_integer()
  @type key :: String.t() | binary() | nil
  @type value :: any()
  @type headers :: [{String.t(), String.t()}]

  @type connect_opts :: [
          timeout: non_neg_integer(),
          headers: [{String.t(), String.t()}],
          pool_size: pos_integer()
        ]

  @type produce_opts :: [
          key: key(),
          partition: partition(),
          headers: headers(),
          timestamp: non_neg_integer()
        ]

  @type subscribe_opts :: [
          group_id: String.t(),
          auto_offset_reset: :earliest | :latest,
          enable_auto_commit: boolean(),
          auto_commit_interval: non_neg_integer(),
          max_poll_records: pos_integer(),
          session_timeout: non_neg_integer()
        ]

  # =============================================================================
  # Connection
  # =============================================================================

  @doc """
  Connects to a Kafka cluster through DotDo RPC.

  ## Options

    * `:timeout` - Request timeout in milliseconds (default: 30_000)
    * `:headers` - Additional headers for requests
    * `:pool_size` - Connection pool size (default: 10)

  ## Examples

      {:ok, kafka} = DotDo.Kafka.connect("wss://kafka.do")

      {:ok, kafka} = DotDo.Kafka.connect("wss://kafka.do",
        timeout: 60_000
      )

  """
  @spec connect(url(), connect_opts()) :: {:ok, Client.t()} | {:error, Error.t()}
  def connect(url, opts \\ []) do
    Client.new(url, opts)
  end

  @doc """
  Connects to Kafka, raising on error.
  """
  @spec connect!(url(), connect_opts()) :: Client.t()
  def connect!(url, opts \\ []) do
    case connect(url, opts) do
      {:ok, client} -> client
      {:error, error} -> raise error
    end
  end

  @doc """
  Gets a supervised client by name.

  ## Example

      # In your Application supervisor
      children = [
        {DotDo.Kafka.Client, name: MyApp.Kafka, url: "wss://kafka.do"}
      ]

      # Later, anywhere in your app
      kafka = DotDo.Kafka.client(MyApp.Kafka)

  """
  @spec client(atom() | pid()) :: Client.t()
  def client(name_or_pid) do
    Client.from_name(name_or_pid)
  end

  @doc """
  Disconnects from Kafka and closes the session.
  """
  @spec disconnect(Client.t()) :: :ok
  def disconnect(%Client{} = client) do
    Client.close(client)
  end

  # =============================================================================
  # Producer Operations
  # =============================================================================

  @doc """
  Produces a single message to a topic.

  ## Options

    * `:key` - Message key for partitioning
    * `:partition` - Specific partition to produce to
    * `:headers` - Message headers
    * `:timestamp` - Message timestamp (milliseconds since epoch)

  ## Examples

      # Simple produce
      :ok = kafka
      |> DotDo.Kafka.produce("events", %{type: "user_login", user_id: 123})
      |> DotDo.Kafka.await!()

      # With key for consistent partitioning
      :ok = kafka
      |> DotDo.Kafka.produce("events", %{action: "click"}, key: "user-123")
      |> DotDo.Kafka.await!()

      # With headers
      :ok = kafka
      |> DotDo.Kafka.produce("events", payload,
        key: "user-123",
        headers: [{"correlation-id", correlation_id}]
      )
      |> DotDo.Kafka.await!()

  """
  @spec produce(Client.t(), topic(), value(), produce_opts()) :: Producer.Request.t()
  def produce(%Client{} = client, topic, value, opts \\ []) do
    Producer.Request.new(client, topic, value, opts)
  end

  @doc """
  Produces multiple messages to a topic in a batch.

  Each message can be a map with `:key`, `:value`, `:headers`, and `:timestamp` fields,
  or just the value directly.

  ## Examples

      # Batch of values
      {:ok, results} = kafka
      |> DotDo.Kafka.produce_batch("events", [
        %{type: "login"},
        %{type: "logout"}
      ])
      |> DotDo.Kafka.await()

      # Batch with keys
      {:ok, results} = kafka
      |> DotDo.Kafka.produce_batch("events", [
        %{key: "user-1", value: %{action: "login"}},
        %{key: "user-2", value: %{action: "click"}}
      ])
      |> DotDo.Kafka.await()

  """
  @spec produce_batch(Client.t(), topic(), [map()], produce_opts()) :: Producer.BatchRequest.t()
  def produce_batch(%Client{} = client, topic, messages, opts \\ []) when is_list(messages) do
    Producer.BatchRequest.new(client, topic, messages, opts)
  end

  # =============================================================================
  # Consumer Operations
  # =============================================================================

  @doc """
  Subscribes to one or more topics.

  Returns a Consumer that can be used as a GenStage producer.

  ## Options

    * `:group_id` - Consumer group ID (required)
    * `:auto_offset_reset` - `:earliest` or `:latest` (default: `:latest`)
    * `:enable_auto_commit` - Auto-commit offsets (default: true)
    * `:auto_commit_interval` - Auto-commit interval in ms (default: 5000)
    * `:max_poll_records` - Max records per poll (default: 500)
    * `:session_timeout` - Session timeout in ms (default: 30000)

  ## Examples

      # Subscribe to single topic
      {:ok, consumer} = kafka
      |> DotDo.Kafka.subscribe("events",
        group_id: "my-consumer-group"
      )

      # Subscribe to multiple topics
      {:ok, consumer} = kafka
      |> DotDo.Kafka.subscribe(["events", "notifications"],
        group_id: "my-consumer-group",
        auto_offset_reset: :earliest
      )

  """
  @spec subscribe(Client.t(), topic() | [topic()], subscribe_opts()) ::
          {:ok, Consumer.t()} | {:error, Error.t()}
  def subscribe(%Client{} = client, topics, opts \\ []) do
    topics = List.wrap(topics)
    Consumer.start_link(client, topics, opts)
  end

  @doc """
  Assigns specific topic-partitions to consume from.

  Unlike `subscribe/3`, this does not use consumer groups.

  ## Example

      {:ok, consumer} = kafka
      |> DotDo.Kafka.assign([
        {"events", 0},
        {"events", 1},
        {"events", 2}
      ])

  """
  @spec assign(Client.t(), [{topic(), partition()}]) ::
          {:ok, Consumer.t()} | {:error, Error.t()}
  def assign(%Client{} = client, partitions) do
    Consumer.start_link(client, partitions, mode: :assign)
  end

  # =============================================================================
  # Offset Management
  # =============================================================================

  @doc """
  Commits offsets for consumed messages.

  ## Examples

      # Commit current offsets for consumer
      :ok = DotDo.Kafka.commit(consumer)

      # Commit specific offsets
      :ok = DotDo.Kafka.commit(consumer, %{
        {"my-topic", 0} => 1234,
        {"my-topic", 1} => 5678
      })

  """
  @spec commit(Consumer.t(), map()) :: :ok | {:error, Error.t()}
  def commit(consumer, offsets \\ nil)

  def commit(%Consumer{} = consumer, nil) do
    Consumer.commit(consumer)
  end

  def commit(%Consumer{} = consumer, offsets) when is_map(offsets) do
    Consumer.commit(consumer, offsets)
  end

  @doc """
  Seeks to a specific offset for a topic-partition.

  ## Examples

      # Seek to beginning
      :ok = DotDo.Kafka.seek(consumer, "events", 0, :beginning)

      # Seek to end
      :ok = DotDo.Kafka.seek(consumer, "events", 0, :end)

      # Seek to specific offset
      :ok = DotDo.Kafka.seek(consumer, "events", 0, 12345)

      # Seek to timestamp
      :ok = DotDo.Kafka.seek(consumer, "events", 0, {:timestamp, timestamp_ms})

  """
  @spec seek(Consumer.t(), topic(), partition(), offset() | :beginning | :end | {:timestamp, non_neg_integer()}) ::
          :ok | {:error, Error.t()}
  def seek(%Consumer{} = consumer, topic, partition, offset) do
    Consumer.seek(consumer, topic, partition, offset)
  end

  # =============================================================================
  # Topic Operations
  # =============================================================================

  @doc """
  Creates a new topic.

  ## Options

    * `:num_partitions` - Number of partitions (default: 1)
    * `:replication_factor` - Replication factor (default: 1)
    * `:configs` - Topic configuration

  ## Example

      :ok = kafka
      |> DotDo.Kafka.create_topic("events",
        num_partitions: 12,
        replication_factor: 3,
        configs: %{"retention.ms" => "604800000"}
      )
      |> DotDo.Kafka.await!()

  """
  @spec create_topic(Client.t(), topic(), keyword()) :: Producer.Request.t()
  def create_topic(%Client{} = client, topic, opts \\ []) do
    Producer.Request.new_admin(client, :create_topic, %{
      topic: topic,
      num_partitions: Keyword.get(opts, :num_partitions, 1),
      replication_factor: Keyword.get(opts, :replication_factor, 1),
      configs: Keyword.get(opts, :configs, %{})
    })
  end

  @doc """
  Deletes a topic.

  ## Example

      :ok = kafka
      |> DotDo.Kafka.delete_topic("old-events")
      |> DotDo.Kafka.await!()

  """
  @spec delete_topic(Client.t(), topic()) :: Producer.Request.t()
  def delete_topic(%Client{} = client, topic) do
    Producer.Request.new_admin(client, :delete_topic, %{topic: topic})
  end

  @doc """
  Lists all topics.

  ## Example

      topics = kafka
      |> DotDo.Kafka.list_topics()
      |> DotDo.Kafka.await!()

  """
  @spec list_topics(Client.t()) :: Producer.Request.t()
  def list_topics(%Client{} = client) do
    Producer.Request.new_admin(client, :list_topics, %{})
  end

  @doc """
  Describes a topic.

  ## Example

      info = kafka
      |> DotDo.Kafka.describe_topic("events")
      |> DotDo.Kafka.await!()

  """
  @spec describe_topic(Client.t(), topic()) :: Producer.Request.t()
  def describe_topic(%Client{} = client, topic) do
    Producer.Request.new_admin(client, :describe_topic, %{topic: topic})
  end

  # =============================================================================
  # Execution
  # =============================================================================

  @doc """
  Executes a producer request and returns the result.

  ## Options

    * `:timeout` - Override the default timeout

  """
  @spec await(Producer.Request.t() | Producer.BatchRequest.t(), keyword()) ::
          {:ok, any()} | {:error, Error.t()}
  def await(request, opts \\ [])

  def await(%Producer.Request{} = request, opts) do
    Producer.Request.execute(request, opts)
  end

  def await(%Producer.BatchRequest{} = request, opts) do
    Producer.BatchRequest.execute(request, opts)
  end

  @doc """
  Executes a request, raising on error.
  """
  @spec await!(Producer.Request.t() | Producer.BatchRequest.t(), keyword()) :: any()
  def await!(request, opts \\ []) do
    case await(request, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Message Helpers
  # =============================================================================

  @doc """
  Creates a message struct.

  ## Example

      msg = DotDo.Kafka.message("events", %{type: "login"},
        key: "user-123",
        headers: [{"trace-id", trace_id}]
      )

  """
  @spec message(topic(), value(), produce_opts()) :: Message.t()
  def message(topic, value, opts \\ []) do
    Message.new(topic, value, opts)
  end

  @doc """
  Acknowledges a consumed message.

  This is used when `enable_auto_commit` is false.

  ## Example

      DotDo.Kafka.Consumer.on_message(consumer, fn msg ->
        case process(msg) do
          :ok -> DotDo.Kafka.ack(consumer, msg)
          :error -> DotDo.Kafka.nack(consumer, msg)
        end
      end)

  """
  @spec ack(Consumer.t(), Message.t()) :: :ok
  def ack(%Consumer{} = consumer, %Message{} = message) do
    Consumer.ack(consumer, message)
  end

  @doc """
  Negatively acknowledges a message (for reprocessing).

  ## Example

      DotDo.Kafka.nack(consumer, message)

  """
  @spec nack(Consumer.t(), Message.t()) :: :ok
  def nack(%Consumer{} = consumer, %Message{} = message) do
    Consumer.nack(consumer, message)
  end
end
