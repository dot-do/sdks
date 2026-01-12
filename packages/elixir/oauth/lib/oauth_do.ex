defmodule OauthDo do
  @moduledoc """
  OAuth device flow SDK for .do APIs.
  """

  alias OauthDo.{Device, Storage}

  @doc """
  Initiates device authorization flow.
  Returns device code info including user_code and verification_uri.
  """
  def authorize_device(opts \\ []) do
    Device.authorize(opts)
  end

  @doc """
  Polls for tokens after user authorizes the device.
  """
  def poll_for_tokens(device_code, interval, expires_in, opts \\ []) do
    Device.poll_for_tokens(device_code, interval, expires_in, opts)
  end

  @doc """
  Gets the current user info using the stored access token.
  """
  def get_user(access_token \\ nil) do
    token = access_token || Storage.get_access_token()

    case token do
      nil ->
        {:error, :no_token}

      token ->
        case Req.get("https://apis.do/me",
               headers: [{"authorization", "Bearer #{token}"}]
             ) do
          {:ok, %{status: 200, body: body}} -> {:ok, body}
          {:ok, %{status: status}} -> {:error, {:http_error, status}}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  @doc """
  Interactive login flow. Prints instructions and waits for authorization.
  """
  def login(opts \\ []) do
    case authorize_device(opts) do
      {:ok, device_info} ->
        IO.puts("\nTo sign in, visit: #{device_info["verification_uri"]}")
        IO.puts("And enter code: #{device_info["user_code"]}\n")

        poll_for_tokens(
          device_info["device_code"],
          device_info["interval"] || 5,
          device_info["expires_in"] || 900,
          opts
        )

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Logs out by removing stored tokens.
  """
  def logout do
    Storage.delete_tokens()
  end
end
