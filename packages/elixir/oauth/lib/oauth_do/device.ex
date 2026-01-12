defmodule OauthDo.Device do
  @moduledoc """
  Device flow authentication for OAuth.
  """

  alias OauthDo.Storage

  @default_client_id "client_01JQYTRXK9ZPD8JPJTKDCRB656"
  @auth_url "https://auth.apis.do/user_management/authorize_device"
  @token_url "https://auth.apis.do/user_management/authenticate"

  @doc """
  Initiates device authorization.
  """
  def authorize(opts \\ []) do
    client_id = Keyword.get(opts, :client_id, @default_client_id)
    scope = Keyword.get(opts, :scope, "openid profile email")

    body = %{
      client_id: client_id,
      scope: scope
    }

    case Req.post(@auth_url, json: body) do
      {:ok, %{status: 200, body: body}} -> {:ok, body}
      {:ok, %{status: status, body: body}} -> {:error, {:http_error, status, body}}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Polls for tokens until user authorizes or timeout.
  """
  def poll_for_tokens(device_code, interval, expires_in, opts \\ []) do
    client_id = Keyword.get(opts, :client_id, @default_client_id)
    deadline = System.monotonic_time(:second) + expires_in
    do_poll(device_code, client_id, interval, deadline)
  end

  defp do_poll(device_code, client_id, interval, deadline) do
    if System.monotonic_time(:second) >= deadline do
      {:error, :expired}
    else
      body = %{
        client_id: client_id,
        device_code: device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      }

      case Req.post(@token_url, json: body) do
        {:ok, %{status: 200, body: body}} ->
          Storage.save_tokens(body)
          {:ok, body}

        {:ok, %{status: 400, body: %{"error" => "authorization_pending"}}} ->
          Process.sleep(interval * 1000)
          do_poll(device_code, client_id, interval, deadline)

        {:ok, %{status: 400, body: %{"error" => "slow_down"}}} ->
          Process.sleep((interval + 5) * 1000)
          do_poll(device_code, client_id, interval + 5, deadline)

        {:ok, %{status: status, body: body}} ->
          {:error, {:http_error, status, body}}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end
end
