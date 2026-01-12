# @dotdo/oauth

OAuth device flow SDK for .do APIs in Deno.

## Usage

### Interactive Login

```typescript
import { login, getUser, logout } from "@dotdo/oauth";

// Start device flow login
const tokens = await login();

// Get current user info
const user = await getUser();

// Logout
await logout();
```

### Using OAuthClient

```typescript
import { OAuthClient } from "@dotdo/oauth";

const client = new OAuthClient();

// Start device flow login
const tokens = await client.login();

// Get current user info
const user = await client.getUser();

// Logout
await client.logout();
```

### Manual Device Flow

```typescript
import { authorizeDevice, pollForTokens } from "@dotdo/oauth";

// Step 1: Initiate device authorization
const deviceInfo = await authorizeDevice();

// Display to user
console.log(`Visit: ${deviceInfo.verification_uri}`);
console.log(`Enter code: ${deviceInfo.user_code}`);

// Step 2: Poll for tokens
const tokens = await pollForTokens(
  deviceInfo.device_code,
  deviceInfo.interval,
  deviceInfo.expires_in
);
```

### Custom Client ID

```typescript
import { OAuthClient } from "@dotdo/oauth";

const client = new OAuthClient({ clientId: "your_client_id" });
```

## Permissions

This module requires the following permissions:

- `--allow-net` - For HTTP requests
- `--allow-read` - For reading stored tokens
- `--allow-write` - For saving tokens
- `--allow-env` - For reading HOME directory

```bash
deno run --allow-net --allow-read --allow-write --allow-env your_script.ts
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `authorizeDevice(clientId?, scope?)` - Initiate device authorization
- `pollForTokens(deviceCode, interval, expiresIn, clientId?)` - Poll for tokens
- `getUserInfo(accessToken)` - Get user info with token
- `login(scope?)` - Interactive login flow (default client)
- `logout()` - Remove stored tokens (default client)
- `getUser(accessToken?)` - Get user info (default client)

### OAuthClient

- `new OAuthClient(options?)` - Create client
- `client.authorizeDevice(scope?)` - Initiate device authorization
- `client.pollForTokens(deviceCode, interval, expiresIn)` - Poll for tokens
- `client.getUser(accessToken?)` - Get current user info
- `client.login(scope?)` - Interactive login flow
- `client.logout()` - Remove stored tokens

### Storage

- `saveTokens(tokens)` - Save tokens to storage
- `loadTokens()` - Load tokens from storage
- `getAccessToken()` - Get access token
- `getRefreshToken()` - Get refresh token
- `deleteTokens()` - Delete stored tokens
- `hasTokens()` - Check if tokens exist

## License

MIT
