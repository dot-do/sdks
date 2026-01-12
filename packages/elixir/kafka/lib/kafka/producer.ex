defmodule DotDo.Kafka.Producer do
  @moduledoc """
  Kafka producer functionality.

  Provides synchronous and asynchronous message production with
  batching support.
  """

  alias DotDo.Kafka.{Client, Message, Error}

  defmodule Request do
    @moduledoc """
    Represents a pending produce request.
    """

    defstruct [:client, :type, :topic, :messages, :options]

    @type t :: %__MODULE__{
            client: Client.t(),
            type: :produce | :admin,
            topic: String.t() | nil,
            messages: [Message.t()],
            options: map()
          }

    @doc """
    Creates a new produce request.
    """
    @spec new(Client.t(), String.t(), any(), keyword()) :: t()
    def new(client, topic, value, opts \\ []) do
      message = Message.new(topic, value, opts)

      %__MODULE__{
        client: client,
        type: :produce,
        topic: topic,
        messages: [message],
        options: %{}
      }
    end

    @doc """
    Creates a new admin request.
    """
    @spec new_admin(Client.t(), atom(), map()) :: t()
    def new_admin(client, operation, params) do
      %__MODULE__{
        client: client,
        type: :admin,
        topic: nil,
        messages: [],
        options: Map.put(params, :operation, operation)
      }
    end

    @doc """
    Executes the produce request.
    """
    @spec execute(t(), keyword()) :: {:ok, any()} | {:error, Error.t()}
    def execute(%__MODULE__{type: :produce} = request, opts) do
      timeout = Keyword.get(opts, :timeout, Client.default_timeout(request.client))

      wire_messages = Enum.map(request.messages, &Message.to_wire/1)

      rpc_request = %{
        "type" => "produce",
        "messages" => wire_messages
      }

      Client.execute(request.client, rpc_request, timeout)
    end

    def execute(%__MODULE__{type: :admin} = request, opts) do
      timeout = Keyword.get(opts, :timeout, Client.default_timeout(request.client))

      operation = request.options[:operation]
      params = Map.delete(request.options, :operation)

      rpc_request = %{
        "type" => "admin",
        "operation" => Atom.to_string(operation),
        "params" => params
      }

      Client.execute(request.client, rpc_request, timeout)
    end
  end

  defmodule BatchRequest do
    @moduledoc """
    Represents a batch produce request.
    """

    defstruct [:client, :topic, :messages, :options]

    @type t :: %__MODULE__{
            client: Client.t(),
            topic: String.t(),
            messages: [Message.t()],
            options: map()
          }

    @doc """
    Creates a new batch produce request.
    """
    @spec new(Client.t(), String.t(), [map()], keyword()) :: t()
    def new(client, topic, messages, opts \\ []) do
      parsed_messages =
        Enum.map(messages, fn
          %{value: value} = msg ->
            Message.new(topic, value,
              key: Map.get(msg, :key),
              headers: Map.get(msg, :headers, []),
              timestamp: Map.get(msg, :timestamp)
            )

          value ->
            Message.new(topic, value, opts)
        end)

      %__MODULE__{
        client: client,
        topic: topic,
        messages: parsed_messages,
        options: %{}
      }
    end

    @doc """
    Executes the batch produce request.
    """
    @spec execute(t(), keyword()) :: {:ok, [any()]} | {:error, Error.t()}
    def execute(%__MODULE__{} = request, opts) do
      timeout = Keyword.get(opts, :timeout, Client.default_timeout(request.client))

      wire_messages = Enum.map(request.messages, &Message.to_wire/1)

      rpc_request = %{
        "type" => "produce_batch",
        "topic" => request.topic,
        "messages" => wire_messages
      }

      case Client.execute(request.client, rpc_request, timeout) do
        {:ok, results} when is_list(results) ->
          {:ok, Enum.map(results, &parse_produce_result/1)}

        {:ok, result} ->
          {:ok, result}

        {:error, _} = error ->
          error
      end
    end

    defp parse_produce_result(result) when is_map(result) do
      %{
        topic: result["topic"],
        partition: result["partition"],
        offset: result["offset"],
        timestamp: result["timestamp"]
      }
    end

    defp parse_produce_result(result), do: result
  end
end
