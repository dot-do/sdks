# oauth-do

A Ruby CLI gem for OAuth 2.0 device authorization flow (RFC 8628). Provides secure authentication for CLI applications using the [OAuth.do](https://oauth.do) platform.

## Installation

```bash
gem install oauth-do
```

Or add to your Gemfile:

```ruby
gem 'oauth-do'
```

## CLI Usage

### Login

Start the device authorization flow:

```bash
oauth-do login
```

This will display a URL and code. Visit the URL in your browser and enter the code to authenticate.

Options:
- `--client-id ID` - Use a custom OAuth client ID
- `--scopes SCOPES` - Comma-separated list of OAuth scopes
- `--json` - Output in JSON format

### Logout

Remove stored authentication tokens:

```bash
oauth-do logout
```

### Who Am I

Display current user information:

```bash
oauth-do whoami
```

### Token

Get the current access token (useful for scripts):

```bash
oauth-do token
```

Example usage in scripts:

```bash
curl -H "Authorization: Bearer $(oauth-do token)" https://api.example.com/data
```

### Status

Check authentication status:

```bash
oauth-do status
```

### Help

```bash
oauth-do help
```

## Library Usage

You can also use oauth-do as a library in your Ruby applications:

```ruby
require 'oauth_do'

# Configure (optional - uses defaults)
OAuthDo.configure do |config|
  config.client_id = "your_client_id"
  config.scopes = ["openid", "profile", "email"]
end

# Authenticate
auth_data = OAuthDo.login(
  on_user_code: ->(device_auth) {
    puts "Visit: #{device_auth.verification_uri_complete}"
    puts "Code: #{device_auth.user_code}"
  }
)

# Get current user
user = OAuthDo.whoami
puts "Logged in as: #{user.email}"

# Get access token
token = OAuthDo.token

# Check status
status = OAuthDo.status
puts "Authenticated: #{status[:authenticated]}"

# Logout
OAuthDo.logout
```

## Token Storage

Tokens are stored securely in `~/.oauth.do/token` with file permissions set to `0600` (readable only by the owner).

### Custom Storage

You can use a custom storage path:

```ruby
storage = OAuthDo.create_secure_storage(path: "/custom/path/token")
OAuthDo.login(storage: storage)
```

## Configuration

Default configuration:

| Setting | Default Value |
|---------|---------------|
| `client_id` | `client_01JQYTRXK9ZPD8JPJTKDCRB656` |
| `authkit_domain` | `login.oauth.do` |
| `auth_endpoint` | `https://auth.apis.do/user_management/authorize_device` |
| `token_endpoint` | `https://auth.apis.do/user_management/authenticate` |
| `user_info_endpoint` | `https://apis.do/me` |
| `scopes` | `["openid", "profile", "email"]` |

## API Reference

### OAuthDo Module

- `OAuthDo.configure { |config| ... }` - Configure the client
- `OAuthDo.get_config` - Get current configuration
- `OAuthDo.login(**options)` - Start authentication flow
- `OAuthDo.logout(**options)` - Remove stored tokens
- `OAuthDo.whoami(**options)` - Get current user info
- `OAuthDo.token(**options)` - Get access token
- `OAuthDo.status(**options)` - Get authentication status

### OAuthDo::Device Module

- `OAuthDo::Device.authorize_device(client_id:, scopes:)` - Start device authorization
- `OAuthDo::Device.poll_for_tokens(device_code:, ...)` - Poll for tokens

### OAuthDo::Auth Module

- `OAuthDo::Auth.auth(storage:, client_id:, scopes:, ...)` - Full auth flow
- `OAuthDo::Auth.logout(storage:)` - Remove tokens
- `OAuthDo::Auth.get_user(storage:)` - Get user info
- `OAuthDo::Auth.get_token(storage:)` - Get access token
- `OAuthDo::Auth.get_status(storage:)` - Get auth status

### OAuthDo::FileStorage

```ruby
storage = OAuthDo::FileStorage.new(path: "~/.oauth.do/token")
storage.store(auth_data)   # Store auth data
storage.load               # Load auth data
storage.delete             # Delete stored data
storage.exists?            # Check if data exists
```

## Types

### AuthData

```ruby
AuthData = Struct.new(
  :access_token,
  :refresh_token,
  :expires_at,
  :token_type,
  :scope
)
```

### UserInfo

```ruby
UserInfo = Struct.new(
  :id,
  :email,
  :name,
  :email_verified,
  :profile_picture_url,
  :first_name,
  :last_name,
  :created_at,
  :updated_at
)
```

### DeviceAuthorization

```ruby
DeviceAuthorization = Struct.new(
  :device_code,
  :user_code,
  :verification_uri,
  :verification_uri_complete,
  :expires_in,
  :interval
)
```

## Requirements

- Ruby 2.7 or later
- No external dependencies (uses Ruby stdlib)

## Development

```bash
# Clone the repository
git clone https://github.com/dotdo/oauth-do-ruby.git
cd oauth-do-ruby

# Install dependencies
bundle install

# Run tests
bundle exec rspec

# Run linter
bundle exec rubocop
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [OAuth.do](https://oauth.do) - OAuth platform
- [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628) - OAuth 2.0 Device Authorization Grant
- [Documentation](https://docs.oauth.do)
