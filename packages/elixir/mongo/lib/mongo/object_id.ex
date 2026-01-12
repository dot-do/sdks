defmodule DotDo.Mongo.ObjectId do
  @moduledoc """
  MongoDB ObjectId implementation.

  ObjectIds are 12-byte identifiers consisting of:
  - 4 bytes: Unix timestamp (seconds since epoch)
  - 5 bytes: Random value
  - 3 bytes: Incrementing counter

  ## Usage

      # Generate a new ObjectId
      id = DotDo.Mongo.ObjectId.generate()

      # Parse from hex string
      {:ok, id} = DotDo.Mongo.ObjectId.parse("507f1f77bcf86cd799439011")

      # Convert to hex string
      hex = DotDo.Mongo.ObjectId.to_hex(id)

  """

  defstruct [:bytes]

  @type t :: %__MODULE__{bytes: <<_::96>>}

  # Machine ID (5 random bytes, generated once)
  @machine_id :crypto.strong_rand_bytes(5)

  # Counter (starts at random value)
  @counter_start :rand.uniform(0xFFFFFF)

  @doc """
  Generates a new ObjectId.

  ## Example

      id = DotDo.Mongo.ObjectId.generate()

  """
  @spec generate() :: t()
  def generate do
    timestamp = System.system_time(:second)
    counter = get_counter()

    bytes =
      <<timestamp::big-unsigned-32>> <>
        @machine_id <>
        <<counter::big-unsigned-24>>

    %__MODULE__{bytes: bytes}
  end

  @doc """
  Parses an ObjectId from a hex string.

  ## Example

      {:ok, id} = DotDo.Mongo.ObjectId.parse("507f1f77bcf86cd799439011")

  """
  @spec parse(String.t()) :: {:ok, t()} | {:error, :invalid_object_id}
  def parse(hex_string) when is_binary(hex_string) and byte_size(hex_string) == 24 do
    case Base.decode16(hex_string, case: :mixed) do
      {:ok, bytes} when byte_size(bytes) == 12 ->
        {:ok, %__MODULE__{bytes: bytes}}

      _ ->
        {:error, :invalid_object_id}
    end
  end

  def parse(_), do: {:error, :invalid_object_id}

  @doc """
  Parses an ObjectId, raising on error.

  ## Example

      id = DotDo.Mongo.ObjectId.parse!("507f1f77bcf86cd799439011")

  """
  @spec parse!(String.t()) :: t()
  def parse!(hex_string) do
    case parse(hex_string) do
      {:ok, id} -> id
      {:error, _} -> raise ArgumentError, "Invalid ObjectId: #{hex_string}"
    end
  end

  @doc """
  Converts an ObjectId to a hex string.

  ## Example

      hex = DotDo.Mongo.ObjectId.to_hex(id)
      # => "507f1f77bcf86cd799439011"

  """
  @spec to_hex(t()) :: String.t()
  def to_hex(%__MODULE__{bytes: bytes}) do
    Base.encode16(bytes, case: :lower)
  end

  @doc """
  Extracts the timestamp from an ObjectId.

  ## Example

      timestamp = DotDo.Mongo.ObjectId.timestamp(id)

  """
  @spec timestamp(t()) :: DateTime.t()
  def timestamp(%__MODULE__{bytes: <<ts::big-unsigned-32, _::binary>>}) do
    DateTime.from_unix!(ts)
  end

  @doc """
  Checks if a value is a valid ObjectId.

  ## Examples

      DotDo.Mongo.ObjectId.valid?(%DotDo.Mongo.ObjectId{...})
      # => true

      DotDo.Mongo.ObjectId.valid?("507f1f77bcf86cd799439011")
      # => true

      DotDo.Mongo.ObjectId.valid?("invalid")
      # => false

  """
  @spec valid?(any()) :: boolean()
  def valid?(%__MODULE__{bytes: bytes}) when byte_size(bytes) == 12, do: true

  def valid?(hex_string) when is_binary(hex_string) do
    case parse(hex_string) do
      {:ok, _} -> true
      _ -> false
    end
  end

  def valid?(_), do: false

  # Implement String.Chars for easy string conversion
  defimpl String.Chars do
    def to_string(oid) do
      DotDo.Mongo.ObjectId.to_hex(oid)
    end
  end

  # Implement Inspect for nice formatting
  defimpl Inspect do
    def inspect(oid, _opts) do
      "#ObjectId<#{DotDo.Mongo.ObjectId.to_hex(oid)}>"
    end
  end

  # Implement Jason.Encoder for JSON serialization
  if Code.ensure_loaded?(Jason.Encoder) do
    defimpl Jason.Encoder do
      def encode(oid, opts) do
        oid
        |> DotDo.Mongo.ObjectId.to_hex()
        |> Jason.Encoder.encode(opts)
      end
    end
  end

  # Counter management
  defp get_counter do
    # Use persistent_term for fast, lock-free counter
    key = {__MODULE__, :counter}

    case :persistent_term.get(key, nil) do
      nil ->
        # Initialize counter
        :persistent_term.put(key, @counter_start + 1)
        @counter_start

      value when value >= 0xFFFFFF ->
        # Wrap around
        :persistent_term.put(key, 1)
        0

      value ->
        :persistent_term.put(key, value + 1)
        value
    end
  end
end
