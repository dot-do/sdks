# {{Name}}Do

[![Hex.pm](https://img.shields.io/hexpm/v/{{name}}_do.svg)](https://hex.pm/packages/{{name}}_do)
[![Docs](https://img.shields.io/badge/hex-docs-blue.svg)](https://hexdocs.pm/{{name}}_do)

{{Name}}.do SDK for Elixir - {{description}}

## Installation

Add `{{name}}_do` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:{{name}}_do, "~> 0.1.0"}
  ]
end
```

## Quick Start

```elixir
# Create a client
{:ok, client} = {{Name}}Do.Client.start_link(api_key: System.get_env("DOTDO_KEY"))

# Make RPC calls
{:ok, result} = {{Name}}Do.Client.call(client, :greet, ["World"])
IO.puts("Result: #{inspect(result)}")

# Disconnect when done
:ok = {{Name}}Do.Client.stop(client)
```

## Configuration

You can configure the client in your `config.exs`:

```elixir
config :{{name}}_do,
  api_key: System.get_env("DOTDO_KEY"),
  base_url: "https://{{name}}.do",
  timeout: 30_000
```

Or pass options directly:

```elixir
{:ok, client} = {{Name}}Do.Client.start_link(
  api_key: "your-api-key",
  base_url: "https://{{name}}.do",
  timeout: 30_000
)
```

## Error Handling

```elixir
case {{Name}}Do.Client.call(client, :get_user, [123]) do
  {:ok, user} ->
    IO.puts("Found user: #{user.name}")

  {:error, %{{Name}}Do.AuthError{} = e} ->
    IO.puts("Authentication failed: #{e.message}")

  {:error, %{{Name}}Do.ConnectionError{} = e} ->
    IO.puts("Connection failed: #{e.message}")

  {:error, reason} ->
    IO.puts("Error: #{inspect(reason)}")
end
```

## Supervision

Use in a supervision tree:

```elixir
children = [
  {{{Name}}Do.Client, api_key: System.get_env("DOTDO_KEY")}
]

Supervisor.start_link(children, strategy: :one_for_one)
```

## License

MIT
