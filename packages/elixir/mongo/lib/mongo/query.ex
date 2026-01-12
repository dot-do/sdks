defmodule DotDo.Mongo.Query do
  @moduledoc """
  Represents a pending MongoDB query.

  Queries are lazy and accumulate options until executed with `await/1`.
  Multiple queries can be batched together for efficient execution.
  """

  defstruct [:collection, :operation, :params, :options]

  @type operation ::
          :find
          | :find_one
          | :count
          | :distinct
          | :aggregate
          | :insert_one
          | :insert_many
          | :update_one
          | :update_many
          | :replace_one
          | :delete_one
          | :delete_many
          | :find_one_and_update
          | :find_one_and_replace
          | :find_one_and_delete
          | :bulk_write
          | :create_index
          | :create_indexes
          | :drop_index
          | :list_indexes

  @type t :: %__MODULE__{
          collection: DotDo.Mongo.Collection.t(),
          operation: operation(),
          params: any(),
          options: map()
        }

  @doc """
  Creates a new query.
  """
  @spec new(DotDo.Mongo.Collection.t(), operation(), any()) :: t()
  def new(collection, operation, params) do
    %__MODULE__{
      collection: collection,
      operation: operation,
      params: params,
      options: %{}
    }
  end

  @doc """
  Sets a query option.
  """
  @spec set_option(t(), atom(), any()) :: t()
  def set_option(%__MODULE__{options: opts} = query, key, value) do
    %{query | options: Map.put(opts, key, value)}
  end

  @doc """
  Gets a query option.
  """
  @spec get_option(t(), atom(), any()) :: any()
  def get_option(%__MODULE__{options: opts}, key, default \\ nil) do
    Map.get(opts, key, default)
  end

  @doc """
  Executes the query.
  """
  @spec execute(t(), keyword()) :: {:ok, any()} | {:error, DotDo.Mongo.Error.t()}
  def execute(%__MODULE__{} = query, opts \\ []) do
    timeout =
      Keyword.get(
        opts,
        :timeout,
        DotDo.Mongo.Client.default_timeout(query.collection.client)
      )

    # Build the RPC request
    request = build_request(query)

    # Execute via the client's connection pool
    execute_request(query.collection.client, request, timeout)
  end

  @doc """
  Executes multiple queries in a batch.
  """
  @spec batch([t()], keyword()) :: {:ok, [any()]} | {:error, DotDo.Mongo.Error.t()}
  def batch(queries, opts \\ []) when is_list(queries) do
    # Group queries by client for efficient batching
    by_client = Enum.group_by(queries, & &1.collection.client)

    results =
      Enum.flat_map(by_client, fn {client, client_queries} ->
        timeout =
          Keyword.get(opts, :timeout, DotDo.Mongo.Client.default_timeout(client))

        requests = Enum.map(client_queries, &build_request/1)
        execute_batch_request(client, requests, timeout)
      end)

    {:ok, results}
  rescue
    e -> {:error, DotDo.Mongo.Error.from_exception(e)}
  end

  @doc """
  Returns a stream of query results.
  """
  @spec stream(t(), keyword()) :: Enumerable.t()
  def stream(%__MODULE__{} = query, opts \\ []) do
    batch_size = Keyword.get(opts, :batch_size, 100)

    Stream.resource(
      fn -> {query, nil, batch_size} end,
      fn
        {_query, :done, _} ->
          {:halt, nil}

        {query, cursor_id, batch_size} ->
          case fetch_batch(query, cursor_id, batch_size) do
            {:ok, docs, nil} ->
              {docs, {query, :done, batch_size}}

            {:ok, docs, next_cursor} ->
              {docs, {query, next_cursor, batch_size}}

            {:error, _} ->
              {:halt, nil}
          end
      end,
      fn _ -> :ok end
    )
  end

  # =============================================================================
  # Private Functions
  # =============================================================================

  defp build_request(%__MODULE__{} = query) do
    %{
      "database" => query.collection.database,
      "collection" => query.collection.name,
      "operation" => Atom.to_string(query.operation),
      "params" => encode_params(query.params),
      "options" => encode_options(query.options)
    }
  end

  defp encode_params(params) when is_map(params) do
    encode_document(params)
  end

  defp encode_params(params) when is_list(params) do
    Enum.map(params, fn
      item when is_map(item) -> encode_document(item)
      item -> item
    end)
  end

  defp encode_params(params), do: params

  defp encode_document(doc) when is_map(doc) do
    doc
    |> Enum.map(fn {k, v} -> {to_string(k), encode_value(v)} end)
    |> Map.new()
  end

  defp encode_value(%DotDo.Mongo.ObjectId{} = oid) do
    %{"$oid" => DotDo.Mongo.ObjectId.to_hex(oid)}
  end

  defp encode_value(%DateTime{} = dt) do
    %{"$date" => DateTime.to_iso8601(dt)}
  end

  defp encode_value(%NaiveDateTime{} = dt) do
    %{"$date" => NaiveDateTime.to_iso8601(dt)}
  end

  defp encode_value(value) when is_map(value) do
    encode_document(value)
  end

  defp encode_value(value) when is_list(value) do
    Enum.map(value, &encode_value/1)
  end

  defp encode_value(value), do: value

  defp encode_options(opts) do
    opts
    |> Enum.map(fn {k, v} -> {Atom.to_string(k), v} end)
    |> Map.new()
  end

  defp execute_request(client, request, timeout) do
    url = "#{client.url}/rpc"
    headers = build_headers(client)
    body = Jason.encode!(request)

    http_request = Finch.build(:post, url, headers, body)

    case Finch.request(http_request, client.pool, receive_timeout: timeout) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"result" => result}} ->
            {:ok, decode_result(result)}

          {:ok, %{"error" => error}} ->
            {:error, DotDo.Mongo.Error.from_response(error)}

          {:error, _} ->
            {:error, DotDo.Mongo.Error.internal_error("Invalid JSON response")}
        end

      {:ok, %Finch.Response{status: status, body: body}} ->
        {:error, DotDo.Mongo.Error.http_error(status, body)}

      {:error, %Mint.TransportError{reason: :timeout}} ->
        {:error, DotDo.Mongo.Error.timeout_error(timeout)}

      {:error, reason} ->
        {:error, DotDo.Mongo.Error.connection_error(reason)}
    end
  end

  defp execute_batch_request(client, requests, timeout) do
    url = "#{client.url}/rpc/batch"
    headers = build_headers(client)
    body = Jason.encode!(%{"requests" => requests})

    http_request = Finch.build(:post, url, headers, body)

    case Finch.request(http_request, client.pool, receive_timeout: timeout) do
      {:ok, %Finch.Response{status: 200, body: response_body}} ->
        case Jason.decode(response_body) do
          {:ok, %{"results" => results}} ->
            Enum.map(results, &decode_result/1)

          {:error, _} ->
            []
        end

      {:error, _} ->
        []
    end
  end

  defp fetch_batch(query, cursor_id, batch_size) do
    query = set_option(query, :batch_size, batch_size)

    query =
      if cursor_id do
        set_option(query, :cursor_id, cursor_id)
      else
        query
      end

    case execute(query) do
      {:ok, %{docs: docs, cursor_id: next_cursor}} ->
        {:ok, docs, next_cursor}

      {:ok, docs} when is_list(docs) ->
        {:ok, docs, nil}

      {:ok, doc} ->
        {:ok, [doc], nil}

      {:error, _} = error ->
        error
    end
  end

  defp build_headers(client) do
    base = [
      {"content-type", "application/json"},
      {"accept", "application/json"}
    ]

    # Add session ID if present
    if client.session_id do
      [{"x-session-id", client.session_id} | base]
    else
      base
    end
  end

  defp decode_result(result) when is_map(result) do
    decode_document(result)
  end

  defp decode_result(result) when is_list(result) do
    Enum.map(result, &decode_result/1)
  end

  defp decode_result(result), do: result

  defp decode_document(doc) when is_map(doc) do
    doc
    |> Enum.map(fn {k, v} -> {String.to_atom(k), decode_value(v)} end)
    |> Map.new()
  end

  defp decode_value(%{"$oid" => hex}) do
    case DotDo.Mongo.ObjectId.parse(hex) do
      {:ok, oid} -> oid
      _ -> hex
    end
  end

  defp decode_value(%{"$date" => iso}) do
    case DateTime.from_iso8601(iso) do
      {:ok, dt, _} -> dt
      _ -> iso
    end
  end

  defp decode_value(value) when is_map(value) do
    decode_document(value)
  end

  defp decode_value(value) when is_list(value) do
    Enum.map(value, &decode_value/1)
  end

  defp decode_value(value), do: value
end
