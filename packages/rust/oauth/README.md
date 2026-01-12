# oauth-do

Simple, secure OAuth authentication CLI for humans and AI agents.

## Installation

```bash
cargo install oauth-do
```

Or build from source:

```bash
git clone https://github.com/drivly/oauth.do
cd oauth.do/packages/rust/oauth
cargo install --path .
```

## CLI Usage

```bash
# Login to your account
oauth-do login

# Check who is logged in
oauth-do whoami

# Get your authentication token
oauth-do token

# Show authentication status
oauth-do status

# Logout
oauth-do logout
```

### Commands

| Command | Description |
|---------|-------------|
| `login` | Login using device authorization flow |
| `logout` | Logout and remove stored credentials |
| `whoami` | Show current authenticated user |
| `token` | Display current authentication token |
| `status` | Show authentication and storage status |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_CLIENT_ID` | Client ID for OAuth | `client_01JQYTRXK9ZPD8JPJTKDCRB656` |
| `OAUTH_AUTHKIT_DOMAIN` | AuthKit domain | `login.oauth.do` |
| `OAUTH_API_URL` | API base URL | `https://apis.do` |
| `OAUTH_STORAGE_PATH` | Custom token storage path | `~/.oauth.do/token` |
| `OAUTH_USE_KEYRING` | Use OS keyring instead of file | `false` |
| `DEBUG` | Enable debug output | - |

## Library Usage

Add to your `Cargo.toml`:

```toml
[dependencies]
oauth-do = "0.1"
tokio = { version = "1", features = ["full"] }
```

### Device Authorization Flow

```rust
use oauth_do::device::{authorize_device, poll_for_tokens, DeviceAuthOptions};
use oauth_do::auth::get_user;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Start device authorization
    let auth_response = authorize_device(DeviceAuthOptions::default()).await?;

    println!("Visit: {}", auth_response.verification_uri);
    println!("Enter code: {}", auth_response.user_code);

    // Poll for tokens
    let tokens = poll_for_tokens(
        &auth_response.device_code,
        auth_response.interval,
        auth_response.expires_in,
    ).await?;

    // Get user info
    let result = get_user(Some(&tokens.access_token)).await?;
    if let Some(user) = result.user {
        println!("Logged in as: {}", user.email.unwrap_or_default());
    }

    Ok(())
}
```

### Get Stored Token

```rust
use oauth_do::auth::get_token;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Get token from environment or stored credentials
    if let Some(token) = get_token().await? {
        println!("Token: {}", token);
    } else {
        println!("Not authenticated");
    }
    Ok(())
}
```

### Custom Storage

```rust
use oauth_do::storage::{create_secure_storage, TokenStorage};

fn main() -> anyhow::Result<()> {
    // Create storage with custom path
    let storage = create_secure_storage(Some("~/.myapp/token"));

    // Store token
    storage.set_token("my_access_token")?;

    // Retrieve token
    if let Some(token) = storage.get_token()? {
        println!("Token: {}", token);
    }

    Ok(())
}
```

### Configuration

```rust
use oauth_do::{configure, OAuthConfig};

fn main() {
    configure(OAuthConfig {
        api_url: "https://api.example.com".to_string(),
        client_id: "my_client_id".to_string(),
        authkit_domain: "auth.example.com".to_string(),
        storage_path: Some("~/.myapp/token".to_string()),
    });
}
```

## Security

### Token Storage

By default, tokens are stored in `~/.oauth.do/token` with secure file permissions (0600 on Unix).

You can optionally use the OS keychain by setting `OAUTH_USE_KEYRING=true`:

- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: Secret Service (libsecret)

Note: Keyring storage is disabled by default because it may trigger GUI authorization popups on macOS, which can break automation and agent workflows.

### Token Refresh

The library automatically refreshes expired tokens when a refresh token is available. Tokens are refreshed 5 minutes before expiration to ensure uninterrupted access.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `https://auth.apis.do/user_management/authorize/device` | POST | Initiate device authorization |
| `https://auth.apis.do/user_management/authenticate` | POST | Poll for tokens / refresh tokens |
| `https://apis.do/me` | GET | Get current user info |

## License

MIT
