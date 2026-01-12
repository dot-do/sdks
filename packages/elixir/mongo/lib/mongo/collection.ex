defmodule DotDo.Mongo.Collection do
  @moduledoc """
  Represents a MongoDB collection.

  Collections are lightweight references that store the client and
  collection path. No network activity occurs until a query is awaited.
  """

  defstruct [:client, :database, :name]

  @type t :: %__MODULE__{
          client: DotDo.Mongo.Client.t(),
          database: String.t(),
          name: String.t()
        }

  @doc """
  Creates a new collection reference.
  """
  @spec new(DotDo.Mongo.Client.t(), String.t()) :: t()
  def new(%DotDo.Mongo.Client{database: database} = client, name) when is_binary(name) do
    unless database do
      raise ArgumentError, "Database must be selected before accessing a collection"
    end

    %__MODULE__{
      client: client,
      database: database,
      name: name
    }
  end

  @doc """
  Returns the full namespace (database.collection).
  """
  @spec namespace(t()) :: String.t()
  def namespace(%__MODULE__{database: db, name: name}) do
    "#{db}.#{name}"
  end
end
