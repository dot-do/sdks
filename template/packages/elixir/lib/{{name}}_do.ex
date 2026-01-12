defmodule {{Name}}Do do
  @moduledoc """
  {{Name}}.do SDK for Elixir.

  {{description}}

  ## Usage

      # Create a client
      {:ok, client} = {{Name}}Do.Client.start_link(api_key: System.get_env("DOTDO_KEY"))

      # Make RPC calls
      {:ok, result} = {{Name}}Do.Client.call(client, :method_name, [arg1, arg2])

  ## Configuration

  You can configure the client in your `config.exs`:

      config :{{name}}_do,
        api_key: System.get_env("DOTDO_KEY"),
        base_url: "https://{{name}}.do"
  """
end
