defmodule OauthDo.Storage do
  @moduledoc """
  File-based token storage.
  """

  @token_dir Path.expand("~/.oauth.do")
  @token_file Path.join(@token_dir, "token")

  @doc """
  Saves tokens to file storage.
  """
  def save_tokens(tokens) do
    File.mkdir_p!(@token_dir)
    File.write!(@token_file, Jason.encode!(tokens))
    :ok
  end

  @doc """
  Loads tokens from file storage.
  """
  def load_tokens do
    case File.read(@token_file) do
      {:ok, content} -> {:ok, Jason.decode!(content)}
      {:error, :enoent} -> {:error, :not_found}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Gets the access token from storage.
  """
  def get_access_token do
    case load_tokens() do
      {:ok, %{"access_token" => token}} -> token
      _ -> nil
    end
  end

  @doc """
  Gets the refresh token from storage.
  """
  def get_refresh_token do
    case load_tokens() do
      {:ok, %{"refresh_token" => token}} -> token
      _ -> nil
    end
  end

  @doc """
  Deletes stored tokens.
  """
  def delete_tokens do
    case File.rm(@token_file) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @doc """
  Checks if tokens exist.
  """
  def has_tokens? do
    File.exists?(@token_file)
  end
end
