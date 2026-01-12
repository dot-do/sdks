defmodule DotDo.Kafka.Message do
  @moduledoc """
  Represents a Kafka message.

  Messages contain the topic, partition, offset, key, value, headers,
  and timestamp information.
  """

  defstruct [
    :topic,
    :partition,
    :offset,
    :key,
    :value,
    :headers,
    :timestamp,
    :timestamp_type
  ]

  @type t :: %__MODULE__{
          topic: String.t(),
          partition: non_neg_integer() | nil,
          offset: non_neg_integer() | nil,
          key: binary() | nil,
          value: any(),
          headers: [{String.t(), String.t()}],
          timestamp: non_neg_integer() | nil,
          timestamp_type: :create_time | :log_append_time | nil
        }

  @doc """
  Creates a new message for producing.

  ## Options

    * `:key` - Message key
    * `:partition` - Specific partition
    * `:headers` - Message headers
    * `:timestamp` - Message timestamp

  ## Example

      msg = DotDo.Kafka.Message.new("events", %{type: "login"},
        key: "user-123",
        headers: [{"trace-id", trace_id}]
      )

  """
  @spec new(String.t(), any(), keyword()) :: t()
  def new(topic, value, opts \\ []) do
    %__MODULE__{
      topic: topic,
      partition: Keyword.get(opts, :partition),
      offset: nil,
      key: Keyword.get(opts, :key),
      value: value,
      headers: Keyword.get(opts, :headers, []),
      timestamp: Keyword.get(opts, :timestamp),
      timestamp_type: nil
    }
  end

  @doc """
  Parses a message from a server response.
  """
  @spec from_response(map()) :: t()
  def from_response(data) when is_map(data) do
    %__MODULE__{
      topic: data["topic"],
      partition: data["partition"],
      offset: data["offset"],
      key: data["key"],
      value: decode_value(data["value"]),
      headers: parse_headers(data["headers"] || []),
      timestamp: data["timestamp"],
      timestamp_type: parse_timestamp_type(data["timestampType"])
    }
  end

  @doc """
  Encodes a message for the wire protocol.
  """
  @spec to_wire(t()) :: map()
  def to_wire(%__MODULE__{} = msg) do
    base = %{
      "topic" => msg.topic,
      "value" => encode_value(msg.value)
    }

    base =
      if msg.key do
        Map.put(base, "key", msg.key)
      else
        base
      end

    base =
      if msg.partition do
        Map.put(base, "partition", msg.partition)
      else
        base
      end

    base =
      if msg.headers != [] do
        Map.put(base, "headers", encode_headers(msg.headers))
      else
        base
      end

    if msg.timestamp do
      Map.put(base, "timestamp", msg.timestamp)
    else
      base
    end
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp decode_value(nil), do: nil

  defp decode_value(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} -> decoded
      {:error, _} -> value
    end
  end

  defp decode_value(value), do: value

  defp encode_value(nil), do: nil

  defp encode_value(value) when is_binary(value), do: value

  defp encode_value(value) do
    Jason.encode!(value)
  end

  defp parse_headers(headers) when is_list(headers) do
    Enum.map(headers, fn
      %{"key" => k, "value" => v} -> {k, v}
      {k, v} -> {k, v}
    end)
  end

  defp parse_headers(_), do: []

  defp encode_headers(headers) do
    Enum.map(headers, fn {k, v} -> %{"key" => k, "value" => v} end)
  end

  defp parse_timestamp_type("CreateTime"), do: :create_time
  defp parse_timestamp_type("LogAppendTime"), do: :log_append_time
  defp parse_timestamp_type(_), do: nil
end
