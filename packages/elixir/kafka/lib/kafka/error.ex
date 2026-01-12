defmodule DotDo.Kafka.Error do
  @moduledoc """
  Error types for DotDo Kafka operations.
  """

  defexception [:type, :message, :code, :details]

  @type error_type ::
          :connection_error
          | :timeout
          | :config_error
          | :topic_not_found
          | :partition_not_found
          | :offset_out_of_range
          | :group_coordinator_not_available
          | :not_coordinator
          | :illegal_generation
          | :inconsistent_group_protocol
          | :invalid_session_timeout
          | :rebalance_in_progress
          | :unknown_member_id
          | :invalid_topic
          | :record_too_large
          | :authorization_failed
          | :not_leader
          | :broker_not_available
          | :replica_not_available
          | :leader_not_available
          | :internal_error
          | :http_error
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

  @doc "Creates a configuration error."
  @spec config_error(String.t()) :: t()
  def config_error(message) do
    %__MODULE__{
      type: :config_error,
      message: message
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

  @doc "Creates an error from a Kafka server response."
  @spec from_response(map()) :: t()
  def from_response(error) when is_map(error) do
    code = error["code"] || error["errorCode"]
    message = error["message"] || error["errorMessage"] || "Unknown error"
    error_type = code_to_type(code)

    %__MODULE__{
      type: error_type,
      message: message,
      code: code,
      details: error["details"]
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
  """
  @spec retryable?(t()) :: boolean()
  def retryable?(%__MODULE__{type: type}) when type in [
    :connection_error,
    :timeout,
    :group_coordinator_not_available,
    :not_coordinator,
    :rebalance_in_progress,
    :not_leader,
    :broker_not_available,
    :replica_not_available,
    :leader_not_available
  ] do
    true
  end

  def retryable?(_), do: false

  # Map Kafka error codes to error types
  defp code_to_type(nil), do: :unknown
  defp code_to_type(-1), do: :unknown
  defp code_to_type(0), do: :unknown  # No error
  defp code_to_type(1), do: :offset_out_of_range
  defp code_to_type(3), do: :unknown_topic
  defp code_to_type(5), do: :leader_not_available
  defp code_to_type(6), do: :not_leader
  defp code_to_type(8), do: :broker_not_available
  defp code_to_type(9), do: :replica_not_available
  defp code_to_type(10), do: :record_too_large
  defp code_to_type(14), do: :group_coordinator_not_available
  defp code_to_type(15), do: :not_coordinator
  defp code_to_type(16), do: :invalid_topic
  defp code_to_type(17), do: :record_too_large
  defp code_to_type(22), do: :illegal_generation
  defp code_to_type(23), do: :inconsistent_group_protocol
  defp code_to_type(26), do: :invalid_session_timeout
  defp code_to_type(27), do: :rebalance_in_progress
  defp code_to_type(25), do: :unknown_member_id
  defp code_to_type(29), do: :authorization_failed
  defp code_to_type(_), do: :unknown
end
