defmodule DotDo.Mongo do
  @moduledoc """
  DotDo MongoDB SDK for Elixir.

  Provides idiomatic MongoDB operations with RPC pipelining support,
  leveraging Elixir's pipe operator for elegant query composition.

  ## Quick Start

      # Connect to MongoDB through DotDo RPC
      {:ok, mongo} = DotDo.Mongo.connect("wss://mongo.do")

      # Fluent query building with pipes
      users = mongo
      |> DotDo.Mongo.db("myapp")
      |> DotDo.Mongo.collection("users")
      |> DotDo.Mongo.find(%{age: %{"$gte" => 21}})
      |> DotDo.Mongo.sort(%{name: 1})
      |> DotDo.Mongo.limit(10)
      |> DotDo.Mongo.await!()

  ## Change Streams with GenStage

      # Subscribe to real-time changes
      {:ok, stream} = mongo
      |> DotDo.Mongo.db("myapp")
      |> DotDo.Mongo.collection("orders")
      |> DotDo.Mongo.watch(pipeline: [%{"$match" => %{"status" => "pending"}}])

      # Use with GenStage consumer
      DotDo.Mongo.ChangeStream.subscribe(stream, MyConsumer)

  ## Aggregation Pipelines

      # Build complex aggregations
      stats = mongo
      |> DotDo.Mongo.db("analytics")
      |> DotDo.Mongo.collection("events")
      |> DotDo.Mongo.aggregate([
        %{"$match" => %{type: "purchase"}},
        %{"$group" => %{_id: "$userId", total: %{"$sum" => "$amount"}}},
        %{"$sort" => %{total: -1}},
        %{"$limit" => 10}
      ])
      |> DotDo.Mongo.await!()

  """

  alias DotDo.Mongo.{Client, Query, Collection, Error, ObjectId, ChangeStream}

  @type url :: String.t()
  @type document :: map()
  @type filter :: map()
  @type update :: map()
  @type pipeline :: [map()]

  @type connect_opts :: [
          timeout: non_neg_integer(),
          headers: [{String.t(), String.t()}],
          pool_size: pos_integer(),
          database: String.t()
        ]

  # =============================================================================
  # Connection
  # =============================================================================

  @doc """
  Connects to a MongoDB instance through DotDo RPC.

  ## Options

    * `:timeout` - Request timeout in milliseconds (default: 30_000)
    * `:headers` - Additional headers for requests
    * `:pool_size` - Connection pool size (default: 10)
    * `:database` - Default database name

  ## Examples

      {:ok, mongo} = DotDo.Mongo.connect("wss://mongo.do")

      {:ok, mongo} = DotDo.Mongo.connect("wss://mongo.do",
        timeout: 60_000,
        database: "myapp"
      )

  """
  @spec connect(url(), connect_opts()) :: {:ok, Client.t()} | {:error, Error.t()}
  def connect(url, opts \\ []) do
    Client.new(url, opts)
  end

  @doc """
  Connects to MongoDB, raising on error.
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
        {DotDo.Mongo.Client, name: MyApp.Mongo, url: "wss://mongo.do"}
      ]

      # Later, anywhere in your app
      mongo = DotDo.Mongo.client(MyApp.Mongo)

  """
  @spec client(atom() | pid()) :: Client.t()
  def client(name_or_pid) do
    Client.from_name(name_or_pid)
  end

  @doc """
  Disconnects from MongoDB and closes the session.
  """
  @spec disconnect(Client.t()) :: :ok
  def disconnect(%Client{} = client) do
    Client.close(client)
  end

  # =============================================================================
  # Database & Collection Selection
  # =============================================================================

  @doc """
  Selects a database.

  ## Example

      db = mongo |> DotDo.Mongo.db("myapp")

  """
  @spec db(Client.t(), String.t()) :: Client.t()
  def db(%Client{} = client, database) do
    Client.with_database(client, database)
  end

  @doc """
  Selects a collection.

  ## Example

      coll = mongo
      |> DotDo.Mongo.db("myapp")
      |> DotDo.Mongo.collection("users")

  """
  @spec collection(Client.t(), String.t()) :: Collection.t()
  def collection(%Client{} = client, name) do
    Collection.new(client, name)
  end

  # =============================================================================
  # Query Operations
  # =============================================================================

  @doc """
  Creates a find query.

  ## Examples

      # Find all documents
      users = coll |> DotDo.Mongo.find() |> DotDo.Mongo.await!()

      # Find with filter
      adults = coll
      |> DotDo.Mongo.find(%{age: %{"$gte" => 21}})
      |> DotDo.Mongo.await!()

      # Find one document
      user = coll
      |> DotDo.Mongo.find(%{_id: user_id})
      |> DotDo.Mongo.one()
      |> DotDo.Mongo.await!()

  """
  @spec find(Collection.t(), filter()) :: Query.t()
  def find(%Collection{} = coll, filter \\ %{}) do
    Query.new(coll, :find, filter)
  end

  @doc """
  Finds a single document by filter.

  ## Example

      user = coll
      |> DotDo.Mongo.find_one(%{email: "alice@example.com"})
      |> DotDo.Mongo.await!()

  """
  @spec find_one(Collection.t(), filter()) :: Query.t()
  def find_one(%Collection{} = coll, filter) do
    Query.new(coll, :find_one, filter)
  end

  @doc """
  Counts documents matching a filter.

  ## Example

      count = coll
      |> DotDo.Mongo.count(%{status: "active"})
      |> DotDo.Mongo.await!()

  """
  @spec count(Collection.t(), filter()) :: Query.t()
  def count(%Collection{} = coll, filter \\ %{}) do
    Query.new(coll, :count, filter)
  end

  @doc """
  Gets distinct values for a field.

  ## Example

      statuses = coll
      |> DotDo.Mongo.distinct("status")
      |> DotDo.Mongo.await!()

  """
  @spec distinct(Collection.t(), String.t(), filter()) :: Query.t()
  def distinct(%Collection{} = coll, field, filter \\ %{}) do
    Query.new(coll, :distinct, %{field: field, filter: filter})
  end

  # =============================================================================
  # Query Modifiers
  # =============================================================================

  @doc """
  Limits query to return only one document.

  ## Example

      user = coll
      |> DotDo.Mongo.find(%{active: true})
      |> DotDo.Mongo.one()
      |> DotDo.Mongo.await!()

  """
  @spec one(Query.t()) :: Query.t()
  def one(%Query{} = query) do
    Query.set_option(query, :limit, 1)
    |> Query.set_option(:single, true)
  end

  @doc """
  Specifies fields to include or exclude.

  ## Examples

      # Include only specific fields
      users = coll
      |> DotDo.Mongo.find()
      |> DotDo.Mongo.project(%{name: 1, email: 1})
      |> DotDo.Mongo.await!()

      # Exclude fields
      users = coll
      |> DotDo.Mongo.find()
      |> DotDo.Mongo.project(%{password: 0, tokens: 0})
      |> DotDo.Mongo.await!()

  """
  @spec project(Query.t(), map()) :: Query.t()
  def project(%Query{} = query, projection) do
    Query.set_option(query, :projection, projection)
  end

  @doc """
  Sorts results.

  ## Example

      users = coll
      |> DotDo.Mongo.find()
      |> DotDo.Mongo.sort(%{created_at: -1})
      |> DotDo.Mongo.await!()

  """
  @spec sort(Query.t(), map()) :: Query.t()
  def sort(%Query{} = query, sort_spec) do
    Query.set_option(query, :sort, sort_spec)
  end

  @doc """
  Limits the number of documents returned.

  ## Example

      top_10 = coll
      |> DotDo.Mongo.find()
      |> DotDo.Mongo.sort(%{score: -1})
      |> DotDo.Mongo.limit(10)
      |> DotDo.Mongo.await!()

  """
  @spec limit(Query.t(), non_neg_integer()) :: Query.t()
  def limit(%Query{} = query, n) do
    Query.set_option(query, :limit, n)
  end

  @doc """
  Skips a number of documents.

  ## Example

      # Pagination
      page_2 = coll
      |> DotDo.Mongo.find()
      |> DotDo.Mongo.skip(20)
      |> DotDo.Mongo.limit(20)
      |> DotDo.Mongo.await!()

  """
  @spec skip(Query.t(), non_neg_integer()) :: Query.t()
  def skip(%Query{} = query, n) do
    Query.set_option(query, :skip, n)
  end

  @doc """
  Adds a hint for index usage.

  ## Example

      users = coll
      |> DotDo.Mongo.find(%{email: email})
      |> DotDo.Mongo.hint(%{email: 1})
      |> DotDo.Mongo.await!()

  """
  @spec hint(Query.t(), map() | String.t()) :: Query.t()
  def hint(%Query{} = query, hint_spec) do
    Query.set_option(query, :hint, hint_spec)
  end

  # =============================================================================
  # Aggregation
  # =============================================================================

  @doc """
  Executes an aggregation pipeline.

  ## Example

      stats = coll
      |> DotDo.Mongo.aggregate([
        %{"$match" => %{status: "completed"}},
        %{"$group" => %{
          _id: "$category",
          count: %{"$sum" => 1},
          total: %{"$sum" => "$amount"}
        }},
        %{"$sort" => %{total: -1}}
      ])
      |> DotDo.Mongo.await!()

  """
  @spec aggregate(Collection.t(), pipeline()) :: Query.t()
  def aggregate(%Collection{} = coll, pipeline) do
    Query.new(coll, :aggregate, pipeline)
  end

  # =============================================================================
  # Write Operations
  # =============================================================================

  @doc """
  Inserts a single document.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.insert_one(%{name: "Alice", email: "alice@example.com"})
      |> DotDo.Mongo.await()

      inserted_id = result.inserted_id

  """
  @spec insert_one(Collection.t(), document()) :: Query.t()
  def insert_one(%Collection{} = coll, document) do
    doc = ensure_id(document)
    Query.new(coll, :insert_one, doc)
  end

  @doc """
  Inserts multiple documents.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.insert_many([
        %{name: "Alice"},
        %{name: "Bob"},
        %{name: "Carol"}
      ])
      |> DotDo.Mongo.await()

      inserted_count = result.inserted_count

  """
  @spec insert_many(Collection.t(), [document()]) :: Query.t()
  def insert_many(%Collection{} = coll, documents) do
    docs = Enum.map(documents, &ensure_id/1)
    Query.new(coll, :insert_many, docs)
  end

  @doc """
  Updates a single document.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.update_one(
        %{_id: user_id},
        %{"$set" => %{name: "Alice Smith"}}
      )
      |> DotDo.Mongo.await()

  """
  @spec update_one(Collection.t(), filter(), update()) :: Query.t()
  def update_one(%Collection{} = coll, filter, update) do
    Query.new(coll, :update_one, %{filter: filter, update: update})
  end

  @doc """
  Updates multiple documents.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.update_many(
        %{status: "pending"},
        %{"$set" => %{status: "processed"}}
      )
      |> DotDo.Mongo.await()

      modified_count = result.modified_count

  """
  @spec update_many(Collection.t(), filter(), update()) :: Query.t()
  def update_many(%Collection{} = coll, filter, update) do
    Query.new(coll, :update_many, %{filter: filter, update: update})
  end

  @doc """
  Replaces a single document.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.replace_one(
        %{_id: user_id},
        %{name: "Alice", email: "alice@new.com", updated: true}
      )
      |> DotDo.Mongo.await()

  """
  @spec replace_one(Collection.t(), filter(), document()) :: Query.t()
  def replace_one(%Collection{} = coll, filter, replacement) do
    Query.new(coll, :replace_one, %{filter: filter, replacement: replacement})
  end

  @doc """
  Deletes a single document.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.delete_one(%{_id: user_id})
      |> DotDo.Mongo.await()

  """
  @spec delete_one(Collection.t(), filter()) :: Query.t()
  def delete_one(%Collection{} = coll, filter) do
    Query.new(coll, :delete_one, filter)
  end

  @doc """
  Deletes multiple documents.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.delete_many(%{status: "expired"})
      |> DotDo.Mongo.await()

      deleted_count = result.deleted_count

  """
  @spec delete_many(Collection.t(), filter()) :: Query.t()
  def delete_many(%Collection{} = coll, filter) do
    Query.new(coll, :delete_many, filter)
  end

  # =============================================================================
  # Find and Modify
  # =============================================================================

  @doc """
  Finds a document and updates it atomically.

  ## Options

    * `:return_document` - `:before` or `:after` (default: `:after`)
    * `:upsert` - Insert if not found (default: false)
    * `:projection` - Fields to return
    * `:sort` - Sort order when multiple documents match

  ## Example

      {:ok, updated} = coll
      |> DotDo.Mongo.find_one_and_update(
        %{_id: user_id},
        %{"$inc" => %{login_count: 1}},
        return_document: :after
      )
      |> DotDo.Mongo.await()

  """
  @spec find_one_and_update(Collection.t(), filter(), update(), keyword()) :: Query.t()
  def find_one_and_update(%Collection{} = coll, filter, update, opts \\ []) do
    Query.new(coll, :find_one_and_update, %{
      filter: filter,
      update: update,
      options: Map.new(opts)
    })
  end

  @doc """
  Finds a document and replaces it atomically.

  ## Example

      {:ok, replaced} = coll
      |> DotDo.Mongo.find_one_and_replace(
        %{_id: user_id},
        new_user_doc,
        return_document: :after
      )
      |> DotDo.Mongo.await()

  """
  @spec find_one_and_replace(Collection.t(), filter(), document(), keyword()) :: Query.t()
  def find_one_and_replace(%Collection{} = coll, filter, replacement, opts \\ []) do
    Query.new(coll, :find_one_and_replace, %{
      filter: filter,
      replacement: replacement,
      options: Map.new(opts)
    })
  end

  @doc """
  Finds a document and deletes it atomically.

  ## Example

      {:ok, deleted} = coll
      |> DotDo.Mongo.find_one_and_delete(%{_id: user_id})
      |> DotDo.Mongo.await()

  """
  @spec find_one_and_delete(Collection.t(), filter(), keyword()) :: Query.t()
  def find_one_and_delete(%Collection{} = coll, filter, opts \\ []) do
    Query.new(coll, :find_one_and_delete, %{
      filter: filter,
      options: Map.new(opts)
    })
  end

  # =============================================================================
  # Bulk Operations
  # =============================================================================

  @doc """
  Executes multiple write operations in bulk.

  ## Example

      {:ok, result} = coll
      |> DotDo.Mongo.bulk_write([
        {:insert_one, %{name: "Alice"}},
        {:update_one, {%{name: "Bob"}, %{"$set" => %{active: true}}}},
        {:delete_one, %{status: "expired"}}
      ])
      |> DotDo.Mongo.await()

  """
  @spec bulk_write(Collection.t(), [tuple()], keyword()) :: Query.t()
  def bulk_write(%Collection{} = coll, operations, opts \\ []) do
    Query.new(coll, :bulk_write, %{
      operations: operations,
      options: Map.new(opts)
    })
  end

  # =============================================================================
  # Index Operations
  # =============================================================================

  @doc """
  Creates an index on a collection.

  ## Example

      {:ok, _} = coll
      |> DotDo.Mongo.create_index(%{email: 1}, unique: true)
      |> DotDo.Mongo.await()

  """
  @spec create_index(Collection.t(), map(), keyword()) :: Query.t()
  def create_index(%Collection{} = coll, keys, opts \\ []) do
    Query.new(coll, :create_index, %{
      keys: keys,
      options: Map.new(opts)
    })
  end

  @doc """
  Creates multiple indexes.

  ## Example

      {:ok, _} = coll
      |> DotDo.Mongo.create_indexes([
        {%{email: 1}, [unique: true]},
        {%{created_at: -1}, []}
      ])
      |> DotDo.Mongo.await()

  """
  @spec create_indexes(Collection.t(), [{map(), keyword()}]) :: Query.t()
  def create_indexes(%Collection{} = coll, indexes) do
    Query.new(coll, :create_indexes, indexes)
  end

  @doc """
  Drops an index.

  ## Example

      {:ok, _} = coll
      |> DotDo.Mongo.drop_index("email_1")
      |> DotDo.Mongo.await()

  """
  @spec drop_index(Collection.t(), String.t()) :: Query.t()
  def drop_index(%Collection{} = coll, index_name) do
    Query.new(coll, :drop_index, index_name)
  end

  @doc """
  Lists all indexes on a collection.

  ## Example

      indexes = coll
      |> DotDo.Mongo.list_indexes()
      |> DotDo.Mongo.await!()

  """
  @spec list_indexes(Collection.t()) :: Query.t()
  def list_indexes(%Collection{} = coll) do
    Query.new(coll, :list_indexes, nil)
  end

  # =============================================================================
  # Change Streams
  # =============================================================================

  @doc """
  Opens a change stream on a collection.

  Change streams allow you to receive real-time notifications of data changes.

  ## Options

    * `:pipeline` - Aggregation pipeline to filter changes
    * `:full_document` - `:default`, `:update_lookup`, `:when_available`, `:required`
    * `:resume_after` - Resume token to continue from
    * `:start_at_operation_time` - Timestamp to start from
    * `:batch_size` - Number of changes per batch

  ## Example

      {:ok, stream} = coll
      |> DotDo.Mongo.watch(
        pipeline: [%{"$match" => %{"operationType" => "insert"}}],
        full_document: :update_lookup
      )

      # Process changes with GenStage
      DotDo.Mongo.ChangeStream.subscribe(stream, fn change ->
        IO.inspect(change)
      end)

  """
  @spec watch(Collection.t() | Client.t(), keyword()) :: {:ok, ChangeStream.t()} | {:error, Error.t()}
  def watch(target, opts \\ [])

  def watch(%Collection{} = coll, opts) do
    ChangeStream.open(coll, opts)
  end

  def watch(%Client{} = client, opts) do
    ChangeStream.open(client, opts)
  end

  # =============================================================================
  # Transactions
  # =============================================================================

  @doc """
  Executes a function within a transaction.

  ## Example

      {:ok, result} = DotDo.Mongo.with_transaction(mongo, fn session ->
        coll = session
        |> DotDo.Mongo.db("bank")
        |> DotDo.Mongo.collection("accounts")

        # Debit from source
        coll
        |> DotDo.Mongo.update_one(
          %{_id: source_id},
          %{"$inc" => %{balance: -100}}
        )
        |> DotDo.Mongo.await!()

        # Credit to destination
        coll
        |> DotDo.Mongo.update_one(
          %{_id: dest_id},
          %{"$inc" => %{balance: 100}}
        )
        |> DotDo.Mongo.await!()

        {:ok, :transferred}
      end)

  """
  @spec with_transaction(Client.t(), (Client.t() -> {:ok, any()} | {:error, any()}), keyword()) ::
          {:ok, any()} | {:error, Error.t()}
  def with_transaction(%Client{} = client, fun, opts \\ []) do
    Client.with_transaction(client, fun, opts)
  end

  # =============================================================================
  # Execution
  # =============================================================================

  @doc """
  Executes the query and returns the result.

  ## Options

    * `:timeout` - Override the default timeout

  """
  @spec await(Query.t(), keyword()) :: {:ok, any()} | {:error, Error.t()}
  def await(%Query{} = query, opts \\ []) do
    Query.execute(query, opts)
  end

  @doc """
  Executes the query, raising on error.
  """
  @spec await!(Query.t(), keyword()) :: any()
  def await!(%Query{} = query, opts \\ []) do
    case await(query, opts) do
      {:ok, result} -> result
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # Streaming Results
  # =============================================================================

  @doc """
  Streams query results.

  Returns an `Enumerable` that fetches results in batches.

  ## Example

      coll
      |> DotDo.Mongo.find(%{active: true})
      |> DotDo.Mongo.stream()
      |> Stream.each(fn doc -> process(doc) end)
      |> Stream.run()

  """
  @spec stream(Query.t(), keyword()) :: Enumerable.t()
  def stream(%Query{} = query, opts \\ []) do
    Query.stream(query, opts)
  end

  # =============================================================================
  # Batch Operations
  # =============================================================================

  @doc """
  Executes multiple queries in a single batch.

  ## Example

      {:ok, [users, posts, stats]} = DotDo.Mongo.batch([
        coll |> DotDo.Mongo.find(%{type: "user"}),
        coll |> DotDo.Mongo.find(%{type: "post"}),
        coll |> DotDo.Mongo.count(%{status: "published"})
      ])

  """
  @spec batch([Query.t()], keyword()) :: {:ok, [any()]} | {:error, Error.t()}
  def batch(queries, opts \\ []) when is_list(queries) do
    Query.batch(queries, opts)
  end

  @doc """
  Executes multiple queries in a batch, raising on error.
  """
  @spec batch!([Query.t()], keyword()) :: [any()]
  def batch!(queries, opts \\ []) do
    case batch(queries, opts) do
      {:ok, results} -> results
      {:error, error} -> raise error
    end
  end

  # =============================================================================
  # ObjectId Helpers
  # =============================================================================

  @doc """
  Generates a new ObjectId.

  ## Example

      id = DotDo.Mongo.object_id()

  """
  @spec object_id() :: ObjectId.t()
  def object_id do
    ObjectId.generate()
  end

  @doc """
  Parses an ObjectId from a hex string.

  ## Example

      {:ok, id} = DotDo.Mongo.object_id("507f1f77bcf86cd799439011")

  """
  @spec object_id(String.t()) :: {:ok, ObjectId.t()} | {:error, :invalid_object_id}
  def object_id(hex_string) do
    ObjectId.parse(hex_string)
  end

  # =============================================================================
  # Private Helpers
  # =============================================================================

  defp ensure_id(%{_id: _} = doc), do: doc
  defp ensure_id(%{"_id" => _} = doc), do: doc
  defp ensure_id(doc), do: Map.put(doc, :_id, ObjectId.generate())
end
