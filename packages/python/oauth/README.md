# oauth-do

**OAuth authentication layer for DotDo services - secure token management with keyring integration.**

```python
from oauth_do import ensure_logged_in, get_token, whoami

# Authenticate (opens browser or device code flow)
token = await ensure_logged_in()

# Get current user
user = await whoami()
print(f"Logged in as {user.email if user else 'unknown'}")
```

One import. Secure storage. Seamless authentication.

---

## What is oauth.do?

`oauth-do` is the authentication layer for the `.do` ecosystem. It provides OAuth 2.0 authentication with secure token storage, automatic token refresh, and seamless integration with `rpc-do` and domain-specific SDKs.

Think of it as the "authentication glue" that lets you:

1. **Authenticate once** - Log in via browser or device code flow
2. **Store securely** - Tokens are stored in the OS keyring (macOS Keychain, Windows Credential Manager, Linux libsecret)
3. **Refresh automatically** - Expired tokens are refreshed transparently
4. **Integrate seamlessly** - Works with `rpc-do` and all `.do` services

```
Your Application
       |
       v
  +---------+     +----------+     +-------------+
  | oauth_do| --> |  rpc_do  | --> | *.do Server |
  +---------+     +----------+     +-------------+
       |
       +--- Browser/Device Code Flow
       +--- Secure Token Storage (Keyring)
       +--- Automatic Token Refresh
       +--- API Key Authentication
```

---

## oauth-do vs Direct API Keys

| Feature | Direct API Keys | oauth-do |
|---------|-----------------|----------|
| Storage | Environment variables or config files | OS keyring with file fallback |
| Token refresh | Manual | Automatic |
| Multiple auth methods | No | Yes (browser, device code, API key) |
| User info | Manual API calls | Built-in `whoami()` |
| Logout/revocation | Manual | Built-in `logout()` |
| CI/CD support | Environment variables | Device code flow + env vars |

**Use direct API keys** when you have a simple server-to-server integration.

**Use oauth-do** when you're building CLIs, desktop apps, or need user-specific authentication.

---

## Installation

```bash
pip install oauth-do
```

Or with your preferred package manager:

```bash
# Poetry
poetry add oauth-do

# PDM
pdm add oauth-do

# uv
uv pip install oauth-do
```

Requires Python 3.11+.

### Optional Dependencies

```bash
# For development/testing
pip install oauth-do[dev]

# For all optional dependencies
pip install oauth-do[all]
```

---

## Quick Start

### Basic Authentication

```python
import asyncio
from oauth_do import ensure_logged_in, is_authenticated, logout

async def main():
    # Check if already authenticated
    if await is_authenticated():
        print("Already logged in")
    else:
        # This opens browser or shows device code
        await ensure_logged_in()
        print("Successfully logged in")

    # Later, to log out
    await logout()

asyncio.run(main())
```

### Get Current User

```python
import asyncio
from oauth_do import whoami, ensure_logged_in

async def show_profile():
    await ensure_logged_in()

    user = await whoami()
    if user:
        print(f"Name: {user.name}")
        print(f"Email: {user.email}")
        print(f"Verified: {user.email_verified}")
        if user.workspace:
            print(f"Workspace: {user.workspace.name} ({user.workspace.role})")

asyncio.run(show_profile())
```

### Using with rpc-do

```python
import asyncio
from oauth_do import ensure_logged_in, get_auth_header
from rpc_do import rpc, configure

async def main():
    # Ensure we're authenticated
    await ensure_logged_in()

    # Get the auth header for API calls
    auth_header = await get_auth_header()

    # Configure rpc-do with authentication
    configure(
        token=auth_header.split(" ")[1],  # Extract token from "Bearer <token>"
    )

    # Make authenticated calls
    users = await rpc.mongo.users.find({"active": True})
    print(f"Found {len(users)} active users")

asyncio.run(main())
```

---

## Authentication Flows

oauth-do supports multiple authentication flows to handle different environments.

### Browser Flow (Default)

The browser flow opens your default browser to authenticate. A local server receives the callback.

```python
import asyncio
from oauth_do import login_with_browser

async def main():
    # Opens browser to https://oauth.do/authorize
    # Redirects back to localhost:8787/callback
    token = await login_with_browser()
    print(f"Access token: {token.access_token[:20]}...")

asyncio.run(main())
```

This flow:
1. Generates PKCE code verifier and challenge
2. Opens browser to authorization URL
3. Starts local HTTP server on port 8787
4. Receives authorization code via callback
5. Exchanges code for tokens
6. Stores tokens securely

### Device Code Flow

For headless servers, SSH sessions, and CI/CD environments where a browser isn't available.

```python
import asyncio
from oauth_do import login_with_device_code

async def main():
    # Shows a code to enter at https://oauth.do/device
    token = await login_with_device_code()
    # Output:
    # Visit https://oauth.do/device and enter code: ABCD-1234
    # Waiting for authorization...

asyncio.run(main())
```

This flow:
1. Requests device authorization from the server
2. Displays user code and verification URL
3. Polls for token until user authorizes
4. Stores tokens securely

### Automatic Flow Selection

Let oauth-do choose the best flow for your environment:

```python
import asyncio
from oauth_do import ensure_logged_in

async def main():
    # Automatically chooses browser or device flow
    token = await ensure_logged_in()
    print(f"Authenticated with {token.token_type} token")

asyncio.run(main())
```

oauth-do detects:
- SSH sessions (`SSH_CONNECTION`, `SSH_TTY`)
- CI environments (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.)
- Container environments (`KUBERNETES_SERVICE_HOST`, `container`)
- Missing display (Linux without `DISPLAY` or `WAYLAND_DISPLAY`)

### API Key Authentication

For server-to-server communication or CI/CD:

```bash
# Set environment variable
export DOTDO_API_KEY="your-api-key"
```

```python
import asyncio
from oauth_do import get_token

async def main():
    # Returns token from DOTDO_API_KEY environment variable
    token = await get_token()
    print(f"Using API key: {token.access_token[:8]}...")

asyncio.run(main())
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DOTDO_TOKEN` | Direct token override (highest priority) |
| `DOTDO_API_KEY` | API key authentication |
| `DOTDO_CONFIG_DIR` | Custom config directory |
| `DOTDO_NO_KEYCHAIN` | Disable keyring, use file storage |
| `DOTDO_AUTH_SERVER` | Custom authorization server URL |

---

## Token Storage

oauth-do uses secure, platform-specific token storage with automatic fallback.

### Storage Locations

| Platform | Primary Storage | Fallback |
|----------|----------------|----------|
| macOS | Keychain (via keyring) | `~/.config/dotdo/credentials.json` |
| Linux | libsecret (via keyring) | `~/.config/dotdo/credentials.json` |
| Windows | Credential Manager (via keyring) | `%APPDATA%/dotdo/credentials.json` |

### Manual Storage Operations

```python
import asyncio
from oauth_do import (
    TokenStorage,
    get_storage,
    store_token,
    delete_token,
    has_token,
    Token
)

async def main():
    # Get the default storage instance
    storage = get_storage()

    # Check if a token is stored
    if await has_token():
        print("Token found")

    # Store a custom token
    token = Token(
        access_token="your-token",
        token_type="Bearer",
        expires_at=int(time.time()) + 3600,
        refresh_token="refresh-token"
    )
    await store_token(token, "browser")

    # Delete stored tokens
    await delete_token()

asyncio.run(main())
```

### Custom Storage Options

```python
from oauth_do import TokenStorage, StorageOptions

storage = TokenStorage(StorageOptions(
    service_name="my-app",              # Keyring service name
    account_name="user@example.com",    # Keyring account name
    config_dir="/custom/path",          # Custom config directory
    disable_keychain=False              # Force file storage only
))

async def main():
    token = await storage.get()
    if token:
        print(f"Found token: {token.access_token[:8]}...")

asyncio.run(main())
```

### Storage Information

```python
import asyncio
from oauth_do import get_storage_info

async def main():
    info = await get_storage_info()
    print(f"Authenticated: {info['is_authenticated']}")
    print(f"Source: {info['token_source']}")  # 'keychain', 'file', 'env', or 'none'
    if info['expires_at']:
        print(f"Expires: {info['expires_at']}")
    if info['scopes']:
        print(f"Scopes: {', '.join(info['scopes'])}")

asyncio.run(main())
```

---

## Token Refresh

oauth-do automatically refreshes expired tokens when you call authentication functions.

### Automatic Refresh

```python
import asyncio
from oauth_do import ensure_logged_in, get_token, AuthError, AuthErrorCode

async def main():
    # ensure_logged_in automatically refreshes if needed
    token = await ensure_logged_in()

    # get_token does NOT auto-refresh - raises if expired
    try:
        token = await get_token()
    except AuthError as e:
        if e.code == AuthErrorCode.NOT_AUTHENTICATED:
            # Token expired or not logged in
            await ensure_logged_in()

asyncio.run(main())
```

### Manual Refresh

```python
import asyncio
from oauth_do import refresh_token, get_token

async def main():
    current_token = await get_token()

    # Manually refresh the token
    new_token = await refresh_token(current_token)
    print(f"Refreshed token expires at: {new_token.expires_at}")

asyncio.run(main())
```

### Token Expiration

Tokens are considered expired 5 minutes before their actual expiration time to prevent edge cases.

```python
import time
from oauth_do import Token

def is_expired(token: Token) -> bool:
    """Check if token is expired (with 5-minute buffer)."""
    if not token.expires_at:
        return False
    buffer = 300  # 5 minutes
    return token.expires_at < int(time.time()) + buffer
```

---

## Integration with rpc-do

oauth-do integrates seamlessly with rpc-do for authenticated API calls.

### Basic Integration

```python
import asyncio
from oauth_do import ensure_logged_in, get_auth_header
from rpc_do import rpc, configure

async def main():
    # Ensure we're authenticated
    await ensure_logged_in()

    # Get the auth header for API calls
    auth_header = await get_auth_header()

    # Configure rpc-do with the token
    if auth_header:
        token = auth_header.split(" ")[1]
        configure(token=token)

    # Make authenticated calls
    user = await rpc.users.me()
    print(f"Logged in as: {user['name']}")

asyncio.run(main())
```

### Automatic Re-authentication

```python
import asyncio
from oauth_do import ensure_logged_in, get_auth_header, AuthError
from rpc_do import rpc, RpcError, configure

class AuthenticatedClient:
    """Client with automatic re-authentication."""

    def __init__(self):
        self._configured = False

    async def _configure(self, force: bool = False):
        if force:
            await ensure_logged_in(AuthOptions(force=True))

        auth_header = await get_auth_header()
        if auth_header:
            token = auth_header.split(" ")[1]
            configure(token=token)
            self._configured = True

    async def call(self, coro):
        """Execute a call with automatic re-auth on 401."""
        if not self._configured:
            await self._configure()

        try:
            return await coro
        except RpcError as e:
            if e.status == 401:
                # Token expired, re-authenticate
                await self._configure(force=True)
                return await coro
            raise

# Usage
async def main():
    client = AuthenticatedClient()
    user = await client.call(rpc.users.me())
    print(f"User: {user['name']}")

asyncio.run(main())
```

### Multi-Service Authentication

```python
import asyncio
from oauth_do import ensure_logged_in, get_auth_header
from rpc_do import rpc, configure

async def main():
    await ensure_logged_in()
    auth_header = await get_auth_header()

    if auth_header:
        token = auth_header.split(" ")[1]
        configure(token=token)

    # Same token works across all .do services
    users = await rpc.mongo.users.find({})
    topics = await rpc.kafka.topics.list()
    files = await rpc.storage.files.list()

    print(f"Users: {len(users)}")
    print(f"Topics: {len(topics)}")
    print(f"Files: {len(files)}")

asyncio.run(main())
```

---

## Error Handling

oauth-do provides typed errors for authentication failures.

### AuthError

```python
import asyncio
from oauth_do import AuthError, AuthErrorCode, ensure_logged_in

async def main():
    try:
        await ensure_logged_in()
    except AuthError as e:
        match e.code:
            case AuthErrorCode.NOT_AUTHENTICATED:
                print("Please log in")
            case AuthErrorCode.TOKEN_EXPIRED:
                print("Session expired, please log in again")
            case AuthErrorCode.TOKEN_REVOKED:
                print("Access was revoked")
            case AuthErrorCode.REFRESH_FAILED:
                print("Could not refresh token")
            case AuthErrorCode.NETWORK_ERROR:
                print(f"Network error: {e}")
            case AuthErrorCode.ACCESS_DENIED:
                print("Access denied")
            case AuthErrorCode.TIMEOUT:
                print("Authentication timed out")
            case AuthErrorCode.CANCELLED:
                print("Authentication cancelled")
            case _:
                print(f"Unknown error: {e}")

asyncio.run(main())
```

### Error Codes

| Code | Description |
|------|-------------|
| `NOT_AUTHENTICATED` | No token stored, user needs to log in |
| `TOKEN_EXPIRED` | Token has expired |
| `TOKEN_REVOKED` | Token was revoked by the server |
| `REFRESH_FAILED` | Failed to refresh the token |
| `STORAGE_ERROR` | Error accessing token storage |
| `NETWORK_ERROR` | Network request failed |
| `INVALID_GRANT` | Invalid authorization grant |
| `ACCESS_DENIED` | User denied access |
| `TIMEOUT` | Operation timed out |
| `CANCELLED` | Operation was cancelled |

---

## Authentication Options

### AuthOptions

```python
import asyncio
from oauth_do import ensure_logged_in, AuthOptions

async def main():
    options = AuthOptions(
        # OAuth client ID (defaults to DotDo CLI client)
        client_id="my-app",

        # OAuth scopes to request
        scopes=["openid", "profile", "email", "offline_access"],

        # Custom authorization server URL
        auth_server="https://auth.example.com",

        # Force re-authentication even if already logged in
        force=True,

        # Preferred authentication flow
        flow="browser",  # "browser", "device", or "auto"

        # Port for local callback server (browser flow)
        callback_port=8787,

        # Timeout for authentication flow in seconds
        timeout=300,  # 5 minutes

        # Show progress/status messages
        interactive=True
    )

    token = await ensure_logged_in(options)

asyncio.run(main())
```

### Default Values

```python
from oauth_do import OAUTH_DEFAULTS

print(f"Auth server: {OAUTH_DEFAULTS.AUTH_SERVER}")    # 'https://oauth.do'
print(f"Client ID: {OAUTH_DEFAULTS.CLIENT_ID}")        # 'dotdo-cli'
print(f"Scopes: {OAUTH_DEFAULTS.SCOPES}")              # ['openid', 'profile', 'email', 'offline_access']
print(f"Callback port: {OAUTH_DEFAULTS.CALLBACK_PORT}")  # 8787
print(f"Timeout: {OAUTH_DEFAULTS.TIMEOUT}")            # 300
print(f"Service name: {OAUTH_DEFAULTS.SERVICE_NAME}")  # 'oauth.do'
print(f"Account name: {OAUTH_DEFAULTS.ACCOUNT_NAME}")  # 'default'
```

---

## Type Hints

oauth-do is fully typed and works great with mypy and pyright.

### Type Definitions

```python
from oauth_do import (
    # Token types
    Token,
    StoredCredential,

    # User types
    User,
    Workspace,

    # Options
    AuthOptions,
    StorageOptions,

    # OAuth flow types
    DeviceAuthorizationResponse,

    # Error types
    AuthError,
    AuthErrorCode,
)
```

### Token Type

```python
from dataclasses import dataclass

@dataclass
class Token:
    access_token: str
    token_type: str = "Bearer"
    expires_at: int | None = None       # Unix timestamp in seconds
    refresh_token: str | None = None
    scopes: list[str] = field(default_factory=list)
    token_id: str | None = None
```

### User Type

```python
from dataclasses import dataclass
from typing import Literal

@dataclass
class User:
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
    email_verified: bool = False
    created_at: str | None = None
    workspace: Workspace | None = None

@dataclass
class Workspace:
    id: str
    name: str
    slug: str
    role: Literal["owner", "admin", "member", "viewer"]
```

---

## Environment Detection

oauth-do automatically detects the environment to choose the best authentication flow.

### Check Environment

```python
from oauth_do import is_headless, can_use_browser_flow

if is_headless():
    print("Running in headless environment")
    print("Will use device code flow")

if can_use_browser_flow():
    print("Browser flow available")
```

### Headless Detection

oauth-do considers an environment headless when:

- SSH session (`SSH_CONNECTION` or `SSH_TTY` is set)
- CI environment (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `JENKINS_URL`)
- Container environment (`KUBERNETES_SERVICE_HOST` or `container` is set)
- Linux without display (`DISPLAY` and `WAYLAND_DISPLAY` are unset)

---

## CLI Integration

oauth-do is designed for CLI applications.

### Example CLI with Click

```python
#!/usr/bin/env python3
"""Example CLI with oauth-do authentication."""

import asyncio
import click
from oauth_do import (
    ensure_logged_in,
    logout,
    whoami,
    is_authenticated,
    get_storage_info,
    AuthOptions
)

def run_async(coro):
    """Helper to run async functions in Click commands."""
    return asyncio.run(coro)

@click.group()
def cli():
    """Example CLI with oauth-do"""
    pass

@cli.command()
@click.option("-f", "--force", is_flag=True, help="Force re-authentication")
def login(force: bool):
    """Log in to the service."""
    async def _login():
        await ensure_logged_in(AuthOptions(force=force))
        user = await whoami()
        click.echo(f"Logged in as {user.email if user else 'unknown'}")

    run_async(_login())

@cli.command()
def logout_cmd():
    """Log out of the service."""
    async def _logout():
        await logout()
        click.echo("Logged out successfully")

    run_async(_logout())

@cli.command()
def whoami_cmd():
    """Show current user."""
    async def _whoami():
        user = await whoami()
        if user:
            click.echo(f"Name: {user.name}")
            click.echo(f"Email: {user.email}")
            click.echo(f"Verified: {user.email_verified}")
        else:
            click.echo("Not logged in")

    run_async(_whoami())

@cli.command()
def status():
    """Show authentication status."""
    async def _status():
        info = await get_storage_info()
        click.echo(f"Authenticated: {info['is_authenticated']}")
        click.echo(f"Storage: {info['token_source']}")
        if info['expires_at']:
            click.echo(f"Expires: {info['expires_at']}")
        if info['scopes']:
            click.echo(f"Scopes: {', '.join(info['scopes'])}")

    run_async(_status())

if __name__ == "__main__":
    cli()
```

### Example CLI with Typer

```python
#!/usr/bin/env python3
"""Example CLI with Typer and oauth-do."""

import asyncio
import typer
from typing import Annotated
from oauth_do import (
    ensure_logged_in,
    logout,
    whoami,
    get_storage_info,
    AuthOptions
)

app = typer.Typer()

@app.command()
def login(
    force: Annotated[bool, typer.Option("--force", "-f", help="Force re-auth")] = False
):
    """Log in to the service."""
    async def _login():
        await ensure_logged_in(AuthOptions(force=force))
        user = await whoami()
        typer.echo(f"Logged in as {user.email if user else 'unknown'}")

    asyncio.run(_login())

@app.command()
def logout_cmd():
    """Log out of the service."""
    asyncio.run(logout())
    typer.echo("Logged out successfully")

@app.command()
def whoami_cmd():
    """Show current user."""
    async def _whoami():
        user = await whoami()
        if user:
            typer.echo(f"Name: {user.name}")
            typer.echo(f"Email: {user.email}")
        else:
            typer.echo("Not logged in")

    asyncio.run(_whoami())

@app.command()
def status():
    """Show authentication status."""
    async def _status():
        info = await get_storage_info()
        typer.echo(f"Authenticated: {info['is_authenticated']}")
        typer.echo(f"Storage: {info['token_source']}")

    asyncio.run(_status())

if __name__ == "__main__":
    app()
```

---

## Testing

### Mocking Authentication

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from oauth_do import Token, User

@pytest.fixture
def mock_oauth():
    """Mock oauth-do functions."""
    mock_token = Token(
        access_token="mock-token",
        token_type="Bearer"
    )
    mock_user = User(
        id="user-123",
        email="test@example.com",
        name="Test User",
        email_verified=True
    )

    with patch("oauth_do.ensure_logged_in", new_callable=AsyncMock) as mock_login:
        with patch("oauth_do.get_token", new_callable=AsyncMock) as mock_get:
            with patch("oauth_do.get_auth_header", new_callable=AsyncMock) as mock_header:
                with patch("oauth_do.whoami", new_callable=AsyncMock) as mock_whoami:
                    with patch("oauth_do.is_authenticated", new_callable=AsyncMock) as mock_auth:
                        mock_login.return_value = mock_token
                        mock_get.return_value = mock_token
                        mock_header.return_value = "Bearer mock-token"
                        mock_whoami.return_value = mock_user
                        mock_auth.return_value = True

                        yield {
                            "ensure_logged_in": mock_login,
                            "get_token": mock_get,
                            "get_auth_header": mock_header,
                            "whoami": mock_whoami,
                            "is_authenticated": mock_auth,
                            "token": mock_token,
                            "user": mock_user,
                        }

@pytest.mark.asyncio
async def test_authenticated_function(mock_oauth):
    """Test a function that requires authentication."""
    from my_app import get_user_data

    result = await get_user_data()

    assert result["email"] == "test@example.com"
    mock_oauth["ensure_logged_in"].assert_called_once()
```

### Testing with Environment Variables

```python
import pytest
import os

@pytest.fixture
def api_key_env():
    """Set up API key environment variable."""
    original = os.environ.get("DOTDO_API_KEY")
    os.environ["DOTDO_API_KEY"] = "test-api-key"
    yield
    if original:
        os.environ["DOTDO_API_KEY"] = original
    else:
        del os.environ["DOTDO_API_KEY"]

@pytest.mark.asyncio
async def test_api_key_auth(api_key_env):
    """Test authentication with API key."""
    from oauth_do import get_token

    token = await get_token()
    assert token.access_token == "test-api-key"
```

---

## API Reference

### Core Functions

```python
# Ensure user is logged in (prompts if needed)
async def ensure_logged_in(options: AuthOptions | None = None) -> Token: ...

# Get current token without prompting (raises if not authenticated)
async def get_token() -> Token: ...

# Check if user is authenticated
async def is_authenticated() -> bool: ...

# Log out and clear stored tokens
async def logout(options: AuthOptions | None = None) -> None: ...

# Get current user information
async def whoami(options: AuthOptions | None = None) -> User | None: ...
```

### Convenience Functions

```python
# Force new login
async def login(options: AuthOptions | None = None) -> Token: ...

# Login with browser flow
async def login_with_browser(options: AuthOptions | None = None) -> Token: ...

# Login with device code flow
async def login_with_device_code(options: AuthOptions | None = None) -> Token: ...

# Get authorization header for API requests
async def get_auth_header() -> str | None: ...

# Get storage information
async def get_storage_info() -> dict: ...
```

### Storage Functions

```python
# Get the default storage instance
def get_storage(options: StorageOptions | None = None) -> TokenStorage: ...

# Store a token
async def store_token(token: Token, source: TokenSource = "browser") -> None: ...

# Delete stored tokens
async def delete_token() -> None: ...

# Check if a token is stored
async def has_token() -> bool: ...

# Get configuration directory path
def get_config_dir(options: StorageOptions | None = None) -> Path: ...

# Get credentials file path
def get_credentials_path(options: StorageOptions | None = None) -> Path: ...

# Get token from environment variables
def get_env_token() -> Token | None: ...
```

### OAuth Flow Functions

```python
# Browser-based OAuth flow
async def browser_flow(options: AuthOptions | None = None) -> Token: ...

# Device code OAuth flow
async def device_flow(
    options: AuthOptions | None = None,
    on_user_code: Callable[[str, str, str | None], None] | None = None,
    on_poll: Callable[[int], None] | None = None,
) -> Token: ...

# Refresh an access token
async def refresh_token(
    token: Token,
    options: AuthOptions | None = None
) -> Token: ...

# Revoke a token
async def revoke_token(
    token: Token,
    options: AuthOptions | None = None
) -> None: ...

# Check if running in headless environment
def is_headless() -> bool: ...

# Check if browser flow is available
def can_use_browser_flow() -> bool: ...
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```python
#!/usr/bin/env python3
"""
Complete oauth-do example demonstrating authentication flows,
token management, and integration with rpc-do.
"""

import asyncio
from oauth_do import (
    ensure_logged_in,
    get_token,
    whoami,
    logout,
    is_authenticated,
    get_storage_info,
    get_auth_header,
    AuthError,
    AuthErrorCode,
    is_headless,
    can_use_browser_flow,
    AuthOptions
)

async def main():
    print("=" * 60)
    print("oauth-do Complete Example")
    print("=" * 60)

    try:
        # Check environment
        print("\n1. Environment Detection")
        print("-" * 40)
        print(f"  Headless: {is_headless()}")
        print(f"  Can use browser: {can_use_browser_flow()}")

        # Check current status
        print("\n2. Authentication Status")
        print("-" * 40)

        authenticated = await is_authenticated()
        print(f"  Authenticated: {authenticated}")

        if not authenticated:
            print("  Logging in...")
            await ensure_logged_in()
            print("  Login successful!")

        # Get user info
        print("\n3. User Information")
        print("-" * 40)

        user = await whoami()
        if user:
            print(f"  ID: {user.id}")
            print(f"  Name: {user.name}")
            print(f"  Email: {user.email}")
            print(f"  Verified: {user.email_verified}")
            if user.workspace:
                print(f"  Workspace: {user.workspace.name}")
                print(f"  Role: {user.workspace.role}")

        # Storage info
        print("\n4. Storage Information")
        print("-" * 40)

        info = await get_storage_info()
        print(f"  Source: {info['token_source']}")
        print(f"  Keyring available: {info['keychain_available']}")
        if info['expires_at']:
            print(f"  Expires: {info['expires_at']}")
        if info['scopes']:
            print(f"  Scopes: {', '.join(info['scopes'])}")

        # Integration with rpc-do
        print("\n5. rpc-do Integration")
        print("-" * 40)

        auth_header = await get_auth_header()
        if auth_header:
            print(f"  Auth header: {auth_header[:20]}...")
        else:
            print("  No auth header available")

        # Example: Connect to a service (commented out for demo)
        # from rpc_do import rpc, configure
        # if auth_header:
        #     token = auth_header.split(" ")[1]
        #     configure(token=token)
        # data = await rpc.users.me()
        print("  Ready to connect to .do services")

        # Logout (optional)
        print("\n6. Logout")
        print("-" * 40)

        # Uncomment to actually log out:
        # await logout()
        # print("  Logged out successfully")
        print("  (Skipped for demo)")

    except AuthError as e:
        print(f"\nAuth error: {e.code.value} - {e}")

    print("\n" + "=" * 60)
    print("Demo Complete!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Security Considerations

### Token Storage

- Tokens are stored in the OS keyring when available (most secure)
- File fallback uses restricted permissions (`0600`)
- Never log or expose tokens in error messages

### PKCE

The browser flow uses PKCE (Proof Key for Code Exchange) to prevent authorization code interception attacks.

### Token Revocation

Always revoke tokens on logout to prevent unauthorized access:

```python
from oauth_do import logout

# logout() automatically revokes the token on the server
await logout()
```

### API Keys vs OAuth

- Use OAuth for user-facing applications (CLIs, desktop apps)
- Use API keys for server-to-server communication
- Never commit API keys or tokens to version control

---

## Related Packages

| Package | Description |
|---------|-------------|
| [rpc-do](https://pypi.org/project/rpc-do/) | RPC client for .do services |
| [capnweb](https://pypi.org/project/capnweb/) | Low-level capability-based RPC |
| [mongo-do](https://pypi.org/project/mongo-do/) | MongoDB client for .do ecosystem |
| [database-do](https://pypi.org/project/database-do/) | Database client for .do ecosystem |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Secure by default** | OS keyring storage, PKCE, automatic token refresh |
| **Works everywhere** | Browser flow, device code flow, API keys |
| **Zero configuration** | Sensible defaults, environment variable support |
| **Seamless integration** | Works with rpc-do and all .do services |
| **Pythonic** | Async/await, dataclasses, type hints |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
