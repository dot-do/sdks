# oauth-do

OAuth device flow SDK for .do APIs in Crystal.

## Installation

Add this to your `shard.yml`:

```yaml
dependencies:
  oauth-do:
    github: dotdo/oauth-crystal
```

## Usage

### Interactive Login

```crystal
require "oauth_do"

client = OAuthDo::Client.new

# Start device flow login
tokens = client.login

# Get current user info
user = client.get_user
puts user["name"]

# Logout
client.logout
```

### Manual Device Flow

```crystal
require "oauth_do"

client = OAuthDo::Client.new

# Step 1: Initiate device authorization
device_info = client.authorize_device

# Display to user
puts "Visit: #{device_info.verification_uri}"
puts "Enter code: #{device_info.user_code}"

# Step 2: Poll for tokens
tokens = client.poll_for_tokens(
  device_info.device_code,
  device_info.interval || 5,
  device_info.expires_in || 900
)
```

### Custom Client ID

```crystal
client = OAuthDo::Client.new("your_client_id")
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `Client.new(client_id?)` - Create client
- `client.authorize_device(scope?)` - Initiate device authorization
- `client.poll_for_tokens(device_code, interval, expires_in)` - Poll for tokens
- `client.get_user(access_token?)` - Get current user info
- `client.login(scope?)` - Interactive login flow
- `client.logout` - Remove stored tokens
- `client.has_tokens?` - Check if tokens exist

## License

MIT
