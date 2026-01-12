defmodule DotDo.Mongo.Error do
  @moduledoc """
  Error types for DotDo MongoDB operations.

  All MongoDB errors are wrapped in this exception type with
  specific error types for different failure modes.
  """

  defexception [:type, :message, :code, :details]

  @type error_type ::
          :connection_error
          | :timeout
          | :not_found
          | :duplicate_key
          | :write_error
          | :write_concern_error
          | :validation_error
          | :authentication_error
          | :authorization_error
          | :network_error
          | :internal_error
          | :http_error
          | :cursor_not_found
          | :unknown

  @type t :: %__MODULE__{
          type: error_type(),
          message: String.t(),
          code: integer() | String.t() | nil,
          details: map() | nil
        }

  @impl true
  def message(%__MODULE__{message: msg, type: type, code: code}) do
    if code do
      "[#{type}] (#{code}) #{msg}"
    else
      "[#{type}] #{msg}"
    end
  end

  @doc "Creates a connection error."
  @spec connection_error(any()) :: t()
  def connection_error(reason) do
    %__MODULE__{
      type: :connection_error,
      message: "Failed to connect: #{inspect(reason)}"
    }
  end

  @doc "Creates a timeout error."
  @spec timeout_error(non_neg_integer()) :: t()
  def timeout_error(timeout) do
    %__MODULE__{
      type: :timeout,
      message: "Operation timed out after #{timeout}ms"
    }
  end

  @doc "Creates an HTTP error."
  @spec http_error(integer(), String.t()) :: t()
  def http_error(status, body) do
    %__MODULE__{
      type: :http_error,
      message: "HTTP #{status}: #{body}",
      code: status
    }
  end

  @doc "Creates an internal error."
  @spec internal_error(String.t()) :: t()
  def internal_error(message) do
    %__MODULE__{
      type: :internal_error,
      message: message
    }
  end

  @doc "Creates a duplicate key error."
  @spec duplicate_key(map()) :: t()
  def duplicate_key(details \\ %{}) do
    %__MODULE__{
      type: :duplicate_key,
      message: "Duplicate key error",
      code: 11000,
      details: details
    }
  end

  @doc "Creates a write error."
  @spec write_error(String.t(), integer() | nil, map()) :: t()
  def write_error(message, code \\ nil, details \\ %{}) do
    %__MODULE__{
      type: :write_error,
      message: message,
      code: code,
      details: details
    }
  end

  @doc "Creates an authentication error."
  @spec authentication_error(String.t()) :: t()
  def authentication_error(message) do
    %__MODULE__{
      type: :authentication_error,
      message: message,
      code: 18
    }
  end

  @doc "Creates an authorization error."
  @spec authorization_error(String.t()) :: t()
  def authorization_error(message) do
    %__MODULE__{
      type: :authorization_error,
      message: message,
      code: 13
    }
  end

  @doc "Creates an error from an exception."
  @spec from_exception(Exception.t()) :: t()
  def from_exception(exception) do
    %__MODULE__{
      type: :internal_error,
      message: Exception.message(exception)
    }
  end

  @doc "Creates an error from a MongoDB server response."
  @spec from_response(map()) :: t()
  def from_response(error) when is_map(error) do
    code = error["code"] || error["errorCode"]
    message = error["message"] || error["errmsg"] || "Unknown error"
    error_type = code_to_type(code)

    %__MODULE__{
      type: error_type,
      message: message,
      code: code,
      details: error["details"] || error["errInfo"]
    }
  end

  def from_response(error) do
    %__MODULE__{
      type: :unknown,
      message: inspect(error)
    }
  end

  @doc """
  Checks if an error is retryable.

  Retryable errors include network issues, temporary failures,
  and certain server errors.
  """
  @spec retryable?(t()) :: boolean()
  def retryable?(%__MODULE__{type: type}) when type in [:connection_error, :timeout, :network_error] do
    true
  end

  def retryable?(%__MODULE__{code: code}) when code in [6, 7, 89, 91, 189, 9001, 10107, 11600, 11602, 13435, 13436] do
    true
  end

  def retryable?(_), do: false

  @doc """
  Checks if an error indicates a duplicate key violation.
  """
  @spec duplicate_key?(t()) :: boolean()
  def duplicate_key?(%__MODULE__{type: :duplicate_key}), do: true
  def duplicate_key?(%__MODULE__{code: 11000}), do: true
  def duplicate_key?(%__MODULE__{code: 11001}), do: true
  def duplicate_key?(_), do: false

  # Map MongoDB error codes to error types
  defp code_to_type(nil), do: :unknown
  defp code_to_type(6), do: :connection_error
  defp code_to_type(7), do: :connection_error
  defp code_to_type(13), do: :authorization_error
  defp code_to_type(18), do: :authentication_error
  defp code_to_type(43), do: :cursor_not_found
  defp code_to_type(50), do: :timeout
  defp code_to_type(121), do: :validation_error
  defp code_to_type(11000), do: :duplicate_key
  defp code_to_type(11001), do: :duplicate_key
  defp code_to_type(code) when is_integer(code) and code >= 10000 and code < 11000, do: :write_error
  defp code_to_type(_), do: :unknown
end
