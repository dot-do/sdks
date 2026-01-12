# oauth_do

OAuth device flow SDK for .do APIs in Nim.

## Installation

Add to your `.nimble` file:

```nim
requires "oauth_do"
```

Or install directly:

```bash
nimble install oauth_do
```

## Usage

### Interactive Login

```nim
import oauth_do

let client = newOAuthClient()

# Start device flow login
let tokens = client.login()

# Get current user info
let user = client.getUser()
echo user["name"]

# Logout
client.logout()
```

### Manual Device Flow

```nim
import oauth_do

let client = newOAuthClient()

# Step 1: Initiate device authorization
let deviceInfo = client.authorizeDevice()

# Display to user
echo "Visit: ", deviceInfo.verificationUri
echo "Enter code: ", deviceInfo.userCode

# Step 2: Poll for tokens
let tokens = client.pollForTokens(
  deviceInfo.deviceCode,
  deviceInfo.interval,
  deviceInfo.expiresIn
)
```

### Custom Client ID

```nim
let client = newOAuthClient("your_client_id")
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `newOAuthClient(clientId?)` - Create client
- `client.authorizeDevice(scope?)` - Initiate device authorization
- `client.pollForTokens(deviceCode, interval, expiresIn)` - Poll for tokens
- `client.getUser(accessToken?)` - Get current user info
- `client.login(scope?)` - Interactive login flow
- `client.logout()` - Remove stored tokens
- `client.hasTokens()` - Check if tokens exist

## Types

```nim
type
  DeviceAuthResponse* = object
    deviceCode*: string
    userCode*: string
    verificationUri*: string
    expiresIn*: int
    interval*: int

  TokenResponse* = object
    accessToken*: string
    refreshToken*: string
    tokenType*: string
    expiresIn*: int
```

## License

MIT
