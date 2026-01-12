defmodule DotDo.KafkaTest do
  use ExUnit.Case
  doctest DotDo.Kafka

  alias DotDo.Kafka
  alias DotDo.Kafka.{Client, Message, Producer, Consumer, Error}

  describe "Message" do
    test "creates a new message" do
      msg = Message.new("events", %{type: "login"})
      assert msg.topic == "events"
      assert msg.value == %{type: "login"}
      assert msg.headers == []
    end

    test "creates a message with options" do
      msg = Message.new("events", %{type: "login"},
        key: "user-123",
        headers: [{"trace-id", "abc123"}],
        partition: 0,
        timestamp: 1234567890
      )

      assert msg.key == "user-123"
      assert msg.partition == 0
      assert msg.headers == [{"trace-id", "abc123"}]
      assert msg.timestamp == 1234567890
    end

    test "encodes to wire format" do
      msg = Message.new("events", %{type: "login"},
        key: "user-123",
        headers: [{"trace-id", "abc123"}]
      )

      wire = Message.to_wire(msg)
      assert wire["topic"] == "events"
      assert wire["key"] == "user-123"
      assert is_binary(wire["value"])
    end

    test "parses from response" do
      response = %{
        "topic" => "events",
        "partition" => 0,
        "offset" => 12345,
        "key" => "user-123",
        "value" => ~s({"type":"login"}),
        "headers" => [%{"key" => "trace-id", "value" => "abc123"}],
        "timestamp" => 1234567890,
        "timestampType" => "CreateTime"
      }

      msg = Message.from_response(response)
      assert msg.topic == "events"
      assert msg.partition == 0
      assert msg.offset == 12345
      assert msg.key == "user-123"
      assert msg.value == %{"type" => "login"}
      assert msg.headers == [{"trace-id", "abc123"}]
      assert msg.timestamp == 1234567890
      assert msg.timestamp_type == :create_time
    end
  end

  describe "Producer.Request" do
    test "creates a produce request" do
      {:ok, client} = Client.new("https://kafka.do")
      request = Producer.Request.new(client, "events", %{type: "login"})

      assert request.type == :produce
      assert request.topic == "events"
      assert length(request.messages) == 1
    end

    test "creates an admin request" do
      {:ok, client} = Client.new("https://kafka.do")
      request = Producer.Request.new_admin(client, :create_topic, %{
        topic: "events",
        num_partitions: 3
      })

      assert request.type == :admin
      assert request.options[:operation] == :create_topic
      assert request.options[:topic] == "events"
    end
  end

  describe "Producer.BatchRequest" do
    test "creates a batch request with values" do
      {:ok, client} = Client.new("https://kafka.do")
      request = Producer.BatchRequest.new(client, "events", [
        %{type: "login"},
        %{type: "logout"}
      ])

      assert request.topic == "events"
      assert length(request.messages) == 2
    end

    test "creates a batch request with keys" do
      {:ok, client} = Client.new("https://kafka.do")
      request = Producer.BatchRequest.new(client, "events", [
        %{key: "user-1", value: %{action: "login"}},
        %{key: "user-2", value: %{action: "logout"}}
      ])

      assert length(request.messages) == 2
      assert Enum.at(request.messages, 0).key == "user-1"
      assert Enum.at(request.messages, 1).key == "user-2"
    end
  end

  describe "Error handling" do
    test "creates connection error" do
      error = Error.connection_error(:econnrefused)
      assert error.type == :connection_error
      assert String.contains?(error.message, "econnrefused")
    end

    test "creates config error" do
      error = Error.config_error("group_id is required")
      assert error.type == :config_error
    end

    test "parses server response" do
      response = %{
        "code" => 14,
        "message" => "Group coordinator not available"
      }

      error = Error.from_response(response)
      assert error.type == :group_coordinator_not_available
      assert error.code == 14
    end

    test "identifies retryable errors" do
      assert Error.retryable?(Error.connection_error(:timeout))
      assert Error.retryable?(Error.timeout_error(5000))
      refute Error.retryable?(Error.config_error("invalid"))
    end
  end

  describe "Client" do
    test "creates a client" do
      {:ok, client} = Client.new("https://kafka.do")
      assert client.url == "https://kafka.do"
      assert client.pool != nil
    end

    test "creates a client with options" do
      {:ok, client} = Client.new("https://kafka.do",
        timeout: 60_000,
        pool_size: 20
      )

      assert Client.default_timeout(client) == 60_000
    end
  end

  describe "Kafka module" do
    test "creates produce request via module" do
      {:ok, client} = Client.new("https://kafka.do")
      request = client
      |> Kafka.produce("events", %{type: "login"}, key: "user-123")

      assert %Producer.Request{} = request
      assert request.topic == "events"
    end

    test "creates batch produce request" do
      {:ok, client} = Client.new("https://kafka.do")
      request = client
      |> Kafka.produce_batch("events", [
        %{key: "user-1", value: %{action: "login"}},
        %{key: "user-2", value: %{action: "logout"}}
      ])

      assert %Producer.BatchRequest{} = request
      assert length(request.messages) == 2
    end

    test "creates topic management requests" do
      {:ok, client} = Client.new("https://kafka.do")

      create_req = Kafka.create_topic(client, "events",
        num_partitions: 6,
        replication_factor: 3
      )
      assert create_req.options[:operation] == :create_topic

      delete_req = Kafka.delete_topic(client, "old-events")
      assert delete_req.options[:operation] == :delete_topic

      list_req = Kafka.list_topics(client)
      assert list_req.options[:operation] == :list_topics

      describe_req = Kafka.describe_topic(client, "events")
      assert describe_req.options[:operation] == :describe_topic
    end

    test "creates message helper" do
      msg = Kafka.message("events", %{type: "login"},
        key: "user-123",
        headers: [{"trace-id", "abc"}]
      )

      assert %Message{} = msg
      assert msg.topic == "events"
      assert msg.key == "user-123"
    end
  end
end
