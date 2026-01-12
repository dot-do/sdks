defmodule {{Name}}Do.Error do
  @moduledoc """
  Errors that can occur when using {{Name}}Do.
  """

  defexception [:message, :code, :reason]

  @type t :: %__MODULE__{
          message: String.t(),
          code: String.t() | nil,
          reason: term() | nil
        }

  @impl true
  def exception(opts) do
    message = Keyword.get(opts, :message, "Unknown error")
    code = Keyword.get(opts, :code)
    reason = Keyword.get(opts, :reason)

    %__MODULE__{
      message: message,
      code: code,
      reason: reason
    }
  end

  @impl true
  def message(%__MODULE__{message: message, code: nil}) do
    "{{Name}}Do.Error: #{message}"
  end

  def message(%__MODULE__{message: message, code: code}) do
    "{{Name}}Do.Error [#{code}]: #{message}"
  end
end

defmodule {{Name}}Do.AuthError do
  @moduledoc """
  Exception raised when authentication fails.
  """

  defexception [:message, :code, :reason]

  @type t :: %__MODULE__{
          message: String.t(),
          code: String.t() | nil,
          reason: term() | nil
        }

  @impl true
  def exception(opts) do
    message = Keyword.get(opts, :message, "Authentication failed")
    code = Keyword.get(opts, :code)
    reason = Keyword.get(opts, :reason)

    %__MODULE__{
      message: message,
      code: code,
      reason: reason
    }
  end
end

defmodule {{Name}}Do.ConnectionError do
  @moduledoc """
  Exception raised when connection fails.
  """

  defexception [:message, :reason]

  @type t :: %__MODULE__{
          message: String.t(),
          reason: term() | nil
        }

  @impl true
  def exception(opts) do
    message = Keyword.get(opts, :message, "Connection failed")
    reason = Keyword.get(opts, :reason)

    %__MODULE__{
      message: message,
      reason: reason
    }
  end
end
