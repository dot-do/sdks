# oauth-do

**OAuth authentication CLI and SDK for .do Platform - secure token management with keyring integration.**

```bash
# Quick login
pipx run oauth-do login

# Or install globally
pip install oauth-do
oauth-do login
```

## CLI Commands

```bash
oauth-do login      # Login using device authorization flow
oauth-do logout     # Logout and remove stored credentials
oauth-do whoami     # Show current authenticated user
oauth-do token      # Display current authentication token
oauth-do status     # Show authentication and storage status
```

## What is oauth-do?

`oauth-do` is the authentication CLI and SDK for the `.do` ecosystem. It provides OAuth 2.0 Device Authorization Grant (RFC 8628) for secure CLI authentication with automatic token storage.

### Features

- **Device Authorization Flow** - Works in terminals, SSH sessions, and CI/CD
- **Secure Token Storage** - Uses keyring (macOS Keychain, Windows Credential Manager, Linux libsecret) with file fallback
- **Automatic Token Refresh** - Expired tokens are refreshed transparently
- **Zero Configuration** - Works out of the box with sensible defaults

## Installation

```bash
# Using pip
pip install oauth-do

# Using pipx (recommended for CLI tools)
pipx install oauth-do

# Using uv
uv pip install oauth-do
```

Requires Python 3.11+.

## CLI Usage

### Login

```bash
$ oauth-do login
Starting OAuth login...

[i] Requesting device authorization...

To complete login:

  1. Visit: https://auth.apis.do/device
  2. Enter code: ABCD-1234

  Or open this URL directly:
  https://auth.apis.do/device?user_code=ABCD-1234

[ok] Opened browser for authentication

Waiting for authorization...

[ok] Login successful!

Logged in as:
  John Doe
  john@example.com

Token stored in: ~/.oauth.do/token
```

### Check Current User

```bash
$ oauth-do whoami
Authenticated as:
  Name: John Doe
  Email: john@example.com
  ID: user_01ABC123
```

### Get Access Token

```bash
$ oauth-do token
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Check Status

```bash
$ oauth-do status
OAuth.do Status

Storage: Secure File
  Using ~/.oauth.do/token with 0600 permissions

Auth: Authenticated
  john@example.com
```

### Logout

```bash
$ oauth-do logout
[ok] Logged out successfully
```

## SDK Usage

```python
import asyncio
from oauth_do import get_token, get_user, authorize_device, poll_for_tokens

async def main():
    # Get stored token
    token = await get_token()
    if token:
        print(f"Token: {token[:20]}...")

    # Get user info
    result = await get_user(token)
    if result.user:
        print(f"Logged in as {result.user.email}")

    # Or run device flow programmatically
    auth = await authorize_device()
    print(f"Enter code: {auth.user_code}")
    print(f"Visit: {auth.verification_uri}")

    token_response = await poll_for_tokens(
        auth.device_code,
        auth.interval,
        auth.expires_in,
    )
    print(f"Access token: {token_response.access_token}")

asyncio.run(main())
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_API_URL` | API base URL | `https://apis.do` |
| `OAUTH_CLIENT_ID` | OAuth client ID | `client_01JQYTRXK9ZPD8JPJTKDCRB656` |
| `OAUTH_AUTHKIT_DOMAIN` | AuthKit domain | `login.oauth.do` |
| `OAUTH_STORAGE_PATH` | Custom token storage path | `~/.oauth.do/token` |
| `DO_TOKEN` | Direct token override | - |
| `DO_ADMIN_TOKEN` | Admin token override | - |
| `DEBUG` | Enable debug output | - |

### Programmatic Configuration

```python
from oauth_do import configure

configure(
    api_url="https://apis.do",
    client_id="my-client-id",
    authkit_domain="login.oauth.do",
    storage_path="~/.my-app/token",
)
```

## Token Storage

### Storage Locations

| Platform | Primary | Fallback |
|----------|---------|----------|
| All | `~/.oauth.do/token` (0600) | - |
| macOS | Keychain (optional) | File |
| Linux | libsecret (optional) | File |
| Windows | Credential Manager (optional) | File |

By default, tokens are stored in `~/.oauth.do/token` with secure file permissions (0600). The file storage is preferred because keyring on macOS requires GUI authorization popups which breaks automation and agent workflows.

### Custom Storage

```python
from oauth_do import FileStorage, KeyringStorage, create_secure_storage

# Use default file storage
storage = create_secure_storage()

# Use custom path
storage = FileStorage("~/.my-app/credentials.json")

# Use keyring (if available)
storage = KeyringStorage()
if await storage.is_available():
    token = await storage.get_token()
```

## API Reference

### Device Flow

```python
from oauth_do import authorize_device, poll_for_tokens

# Start device authorization
auth = await authorize_device()
# Returns: DeviceAuthorizationResponse(
#   device_code, user_code, verification_uri,
#   verification_uri_complete, expires_in, interval
# )

# Poll for tokens
token = await poll_for_tokens(
    device_code=auth.device_code,
    interval=auth.interval,
    expires_in=auth.expires_in,
)
# Returns: TokenResponse(access_token, token_type, refresh_token, expires_in)
```

### Auth Functions

```python
from oauth_do import get_token, get_user, is_authenticated, logout

# Get token from env or storage (with auto-refresh)
token = await get_token()

# Get user info
result = await get_user(token)
if result.user:
    print(result.user.email)

# Check if authenticated
if await is_authenticated():
    print("Logged in")

# Logout
await logout(token)
```

### Storage

```python
from oauth_do import (
    create_secure_storage,
    FileStorage,
    KeyringStorage,
    StoredTokenData,
)

storage = create_secure_storage()

# Get token
token = await storage.get_token()

# Get full token data (with refresh token and expiration)
data = await storage.get_token_data()
print(f"Expires at: {data.expires_at}")

# Store token data
await storage.set_token_data(StoredTokenData(
    access_token="...",
    refresh_token="...",
    expires_at=1234567890000,
))

# Remove token
await storage.remove_token()
```

## Types

```python
from oauth_do import (
    # Configuration
    OAuthConfig,

    # Auth types
    User,
    AuthResult,
    TokenResponse,
    StoredTokenData,

    # Device flow
    DeviceAuthorizationResponse,
    DeviceAuthOptions,

    # Errors
    AuthError,
    AuthErrorCode,
    TokenError,
)
```

## Security

- Tokens are stored with secure file permissions (0600)
- Refresh tokens are stored securely for automatic token refresh
- The device authorization flow is designed for CLI/terminal environments
- No secrets are stored in environment variables by default

## Related Packages

| Package | Description |
|---------|-------------|
| [rpc-do](https://pypi.org/project/rpc-do/) | RPC client for .do services |
| [apis-do](https://pypi.org/project/apis-do/) | API client for .do services |

## License

MIT
