defmodule DotDo.MongoTest do
  use ExUnit.Case
  doctest DotDo.Mongo

  alias DotDo.Mongo
  alias DotDo.Mongo.{ObjectId, Query, Collection, Client}

  describe "ObjectId" do
    test "generates valid ObjectIds" do
      id = ObjectId.generate()
      assert %ObjectId{bytes: bytes} = id
      assert byte_size(bytes) == 12
    end

    test "parses hex strings" do
      hex = "507f1f77bcf86cd799439011"
      {:ok, id} = ObjectId.parse(hex)
      assert ObjectId.to_hex(id) == hex
    end

    test "returns error for invalid hex" do
      assert {:error, :invalid_object_id} = ObjectId.parse("invalid")
      assert {:error, :invalid_object_id} = ObjectId.parse("short")
    end

    test "extracts timestamp" do
      id = ObjectId.generate()
      ts = ObjectId.timestamp(id)
      assert %DateTime{} = ts

      # Should be close to now
      diff = DateTime.diff(DateTime.utc_now(), ts, :second)
      assert diff >= 0 and diff < 5
    end

    test "converts to string" do
      id = ObjectId.generate()
      hex = to_string(id)
      assert String.length(hex) == 24
      assert String.match?(hex, ~r/^[0-9a-f]+$/)
    end

    test "validates ObjectIds" do
      assert ObjectId.valid?(ObjectId.generate())
      assert ObjectId.valid?("507f1f77bcf86cd799439011")
      refute ObjectId.valid?("invalid")
      refute ObjectId.valid?(123)
    end
  end

  describe "Query building" do
    setup do
      {:ok, client} = Client.new("https://mongo.do")
      client = Client.with_database(client, "test")
      coll = Collection.new(client, "users")
      {:ok, coll: coll}
    end

    test "find creates a query", %{coll: coll} do
      query = Mongo.find(coll, %{active: true})
      assert %Query{operation: :find, params: %{active: true}} = query
    end

    test "find_one creates a query", %{coll: coll} do
      query = Mongo.find_one(coll, %{email: "test@example.com"})
      assert %Query{operation: :find_one} = query
    end

    test "query modifiers chain correctly", %{coll: coll} do
      query =
        coll
        |> Mongo.find(%{status: "active"})
        |> Mongo.project(%{name: 1, email: 1})
        |> Mongo.sort(%{created_at: -1})
        |> Mongo.limit(10)
        |> Mongo.skip(5)

      assert Query.get_option(query, :projection) == %{name: 1, email: 1}
      assert Query.get_option(query, :sort) == %{created_at: -1}
      assert Query.get_option(query, :limit) == 10
      assert Query.get_option(query, :skip) == 5
    end

    test "one modifier sets limit and single flag", %{coll: coll} do
      query =
        coll
        |> Mongo.find(%{active: true})
        |> Mongo.one()

      assert Query.get_option(query, :limit) == 1
      assert Query.get_option(query, :single) == true
    end
  end

  describe "Write operations" do
    setup do
      {:ok, client} = Client.new("https://mongo.do")
      client = Client.with_database(client, "test")
      coll = Collection.new(client, "users")
      {:ok, coll: coll}
    end

    test "insert_one creates a query with _id", %{coll: coll} do
      query = Mongo.insert_one(coll, %{name: "Alice"})
      assert %Query{operation: :insert_one, params: params} = query
      assert Map.has_key?(params, :_id)
    end

    test "insert_one preserves existing _id", %{coll: coll} do
      id = ObjectId.generate()
      query = Mongo.insert_one(coll, %{_id: id, name: "Alice"})
      assert %Query{params: %{_id: ^id}} = query
    end

    test "insert_many creates a query", %{coll: coll} do
      query = Mongo.insert_many(coll, [%{name: "Alice"}, %{name: "Bob"}])
      assert %Query{operation: :insert_many, params: docs} = query
      assert length(docs) == 2
      assert Enum.all?(docs, &Map.has_key?(&1, :_id))
    end

    test "update_one creates a query", %{coll: coll} do
      query = Mongo.update_one(coll, %{name: "Alice"}, %{"$set" => %{age: 30}})
      assert %Query{operation: :update_one, params: %{filter: _, update: _}} = query
    end

    test "delete_one creates a query", %{coll: coll} do
      query = Mongo.delete_one(coll, %{name: "Alice"})
      assert %Query{operation: :delete_one} = query
    end
  end

  describe "Aggregation" do
    setup do
      {:ok, client} = Client.new("https://mongo.do")
      client = Client.with_database(client, "test")
      coll = Collection.new(client, "orders")
      {:ok, coll: coll}
    end

    test "aggregate creates a query with pipeline", %{coll: coll} do
      pipeline = [
        %{"$match" => %{status: "completed"}},
        %{"$group" => %{_id: "$userId", total: %{"$sum" => "$amount"}}}
      ]

      query = Mongo.aggregate(coll, pipeline)
      assert %Query{operation: :aggregate, params: ^pipeline} = query
    end
  end

  describe "Collection" do
    test "creates collection with database" do
      {:ok, client} = Client.new("https://mongo.do")
      client = Client.with_database(client, "mydb")
      coll = Collection.new(client, "users")

      assert coll.database == "mydb"
      assert coll.name == "users"
      assert Collection.namespace(coll) == "mydb.users"
    end

    test "raises without database" do
      {:ok, client} = Client.new("https://mongo.do")

      assert_raise ArgumentError, fn ->
        Collection.new(client, "users")
      end
    end
  end

  describe "Error handling" do
    alias DotDo.Mongo.Error

    test "creates connection error" do
      error = Error.connection_error(:econnrefused)
      assert error.type == :connection_error
      assert String.contains?(error.message, "econnrefused")
    end

    test "creates duplicate key error" do
      error = Error.duplicate_key(%{keyValue: %{email: "test@example.com"}})
      assert error.type == :duplicate_key
      assert error.code == 11000
    end

    test "parses server response" do
      response = %{
        "code" => 11000,
        "errmsg" => "E11000 duplicate key error",
        "keyValue" => %{"email" => "test@example.com"}
      }

      error = Error.from_response(response)
      assert error.type == :duplicate_key
      assert error.code == 11000
    end

    test "identifies retryable errors" do
      assert Error.retryable?(Error.connection_error(:timeout))
      assert Error.retryable?(Error.timeout_error(5000))
      refute Error.retryable?(Error.duplicate_key())
    end
  end
end
