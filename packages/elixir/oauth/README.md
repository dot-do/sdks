# OauthDo

OAuth device flow SDK for .do APIs in Elixir.

## Installation

Add `oauth_do` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:oauth_do, "~> 0.1.0"}
  ]
end
```

## Usage

### Interactive Login

```elixir
# Start device flow login
{:ok, tokens} = OauthDo.login()

# Get current user info
{:ok, user} = OauthDo.get_user()

# Logout
OauthDo.logout()
```

### Manual Device Flow

```elixir
# Step 1: Initiate device authorization
{:ok, device_info} = OauthDo.authorize_device()

# Display to user
IO.puts("Visit: #{device_info["verification_uri"]}")
IO.puts("Enter code: #{device_info["user_code"]}")

# Step 2: Poll for tokens
{:ok, tokens} = OauthDo.poll_for_tokens(
  device_info["device_code"],
  device_info["interval"],
  device_info["expires_in"]
)
```

### Custom Client ID

```elixir
OauthDo.login(client_id: "your_client_id")
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `OauthDo.authorize_device/1` - Initiate device authorization
- `OauthDo.poll_for_tokens/4` - Poll for tokens after authorization
- `OauthDo.get_user/1` - Get current user info
- `OauthDo.login/1` - Interactive login flow
- `OauthDo.logout/0` - Remove stored tokens

## License

MIT
