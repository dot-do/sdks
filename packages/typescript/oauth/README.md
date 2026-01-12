# oauth.do

**OAuth authentication layer for DotDo services - secure token management with keychain integration.**

```typescript
import { ensureLoggedIn, getToken, whoami } from 'oauth.do'

// Authenticate (opens browser or device code flow)
const token = await ensureLoggedIn()

// Get current user
const user = await whoami()
console.log(`Logged in as ${user?.email}`)
```

One import. Secure storage. Seamless authentication.

---

## What is oauth.do?

`oauth.do` is the authentication layer for the `.do` ecosystem. It provides OAuth 2.0 authentication with secure token storage, automatic token refresh, and seamless integration with `rpc.do` and domain-specific SDKs.

Think of it as the "authentication glue" that lets you:

1. **Authenticate once** - Log in via browser or device code flow
2. **Store securely** - Tokens are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)
3. **Refresh automatically** - Expired tokens are refreshed transparently
4. **Integrate seamlessly** - Works with `rpc.do` and all `.do` services

```
Your Application
       |
       v
  +---------+     +----------+     +-------------+
  | oauth.do| --> |  rpc.do  | --> | *.do Server |
  +---------+     +----------+     +-------------+
       |
       +--- Browser/Device Code Flow
       +--- Secure Token Storage (Keychain)
       +--- Automatic Token Refresh
       +--- API Key Authentication
```

---

## oauth.do vs Direct API Keys

| Feature | Direct API Keys | oauth.do |
|---------|-----------------|----------|
| Storage | Environment variables or config files | OS keychain with file fallback |
| Token refresh | Manual | Automatic |
| Multiple auth methods | No | Yes (browser, device code, API key) |
| User info | Manual API calls | Built-in `whoami()` |
| Logout/revocation | Manual | Built-in `logout()` |
| CI/CD support | Environment variables | Device code flow + env vars |

**Use direct API keys** when you have a simple server-to-server integration.

**Use oauth.do** when you're building CLIs, desktop apps, or need user-specific authentication.

---

## Installation

```bash
npm install oauth.do
```

Or with your preferred package manager:

```bash
# Yarn
yarn add oauth.do

# pnpm
pnpm add oauth.do

# Bun
bun add oauth.do
```

Requires Node.js 18+ or any modern JavaScript runtime (Deno, Bun).

---

## Quick Start

### Basic Authentication

```typescript
import { ensureLoggedIn, isAuthenticated, logout } from 'oauth.do'

async function main() {
  // Check if already authenticated
  if (await isAuthenticated()) {
    console.log('Already logged in')
  } else {
    // This opens browser or shows device code
    await ensureLoggedIn()
    console.log('Successfully logged in')
  }

  // Later, to log out
  await logout()
}
```

### Get Current User

```typescript
import { whoami, ensureLoggedIn } from 'oauth.do'

async function showProfile() {
  await ensureLoggedIn()

  const user = await whoami()
  if (user) {
    console.log(`Name: ${user.name}`)
    console.log(`Email: ${user.email}`)
    console.log(`Verified: ${user.emailVerified}`)
    if (user.workspace) {
      console.log(`Workspace: ${user.workspace.name} (${user.workspace.role})`)
    }
  }
}
```

### Using with rpc.do

```typescript
import { ensureLoggedIn, getAuthHeader } from 'oauth.do'
import { connect } from 'rpc.do'

async function main() {
  // Ensure we're authenticated
  await ensureLoggedIn()

  // Get the auth header for API calls
  const authHeader = await getAuthHeader()

  // Connect with authentication
  const client = connect('wss://api.example.do', {
    headers: { 'Authorization': authHeader }
  })

  // Make authenticated calls
  const result = await client.$.users.me()
}
```

---

## Authentication Flows

oauth.do supports multiple authentication flows to handle different environments.

### Browser Flow (Default)

The browser flow opens your default browser to authenticate. A local server receives the callback.

```typescript
import { loginWithBrowser } from 'oauth.do'

// Opens browser to https://oauth.do/authorize
// Redirects back to localhost:8787/callback
const token = await loginWithBrowser()
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

```typescript
import { loginWithDeviceCode } from 'oauth.do'

// Shows a code to enter at https://oauth.do/device
const token = await loginWithDeviceCode()

// Output:
// Visit https://oauth.do/device and enter code: ABCD-1234
// Waiting for authorization...
```

This flow:
1. Requests device authorization from the server
2. Displays user code and verification URL
3. Polls for token until user authorizes
4. Stores tokens securely

### Automatic Flow Selection

Let oauth.do choose the best flow for your environment:

```typescript
import { ensureLoggedIn } from 'oauth.do'

// Automatically chooses browser or device flow
const token = await ensureLoggedIn()
```

oauth.do detects:
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

```typescript
import { getToken } from 'oauth.do'

// Returns token from DOTDO_API_KEY environment variable
const token = await getToken()
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DOTDO_TOKEN` | Direct token override (highest priority) |
| `DOTDO_API_KEY` | API key authentication |
| `DOTDO_CONFIG_DIR` | Custom config directory |
| `DOTDO_NO_KEYCHAIN` | Disable keychain, use file storage |
| `DOTDO_AUTH_SERVER` | Custom authorization server URL |

---

## Token Storage

oauth.do uses secure, platform-specific token storage with automatic fallback.

### Storage Locations

| Platform | Primary Storage | Fallback |
|----------|----------------|----------|
| macOS | Keychain (via keytar) | `~/.config/dotdo/credentials.json` |
| Linux | libsecret (via keytar) | `~/.config/dotdo/credentials.json` |
| Windows | Credential Manager (via keytar) | `%APPDATA%/dotdo/credentials.json` |

### Manual Storage Operations

```typescript
import {
  TokenStorage,
  getStorage,
  storeToken,
  deleteToken,
  hasToken
} from 'oauth.do'

// Get the default storage instance
const storage = getStorage()

// Check if a token is stored
if (await hasToken()) {
  console.log('Token found')
}

// Store a custom token
await storeToken({
  accessToken: 'your-token',
  tokenType: 'Bearer',
  expiresAt: Date.now() / 1000 + 3600,
  refreshToken: 'refresh-token'
}, 'browser')

// Delete stored tokens
await deleteToken()
```

### Custom Storage Options

```typescript
import { TokenStorage } from 'oauth.do'

const storage = new TokenStorage({
  serviceName: 'my-app',           // Keychain service name
  accountName: 'user@example.com', // Keychain account name
  configDir: '/custom/path',       // Custom config directory
  disableKeychain: false           // Force file storage only
})

const token = await storage.get()
```

### Storage Information

```typescript
import { getStorageInfo } from 'oauth.do'

const info = await getStorageInfo()
console.log('Authenticated:', info.isAuthenticated)
console.log('Source:', info.tokenSource) // 'keychain', 'file', 'env', or 'none'
console.log('Expires:', info.expiresAt)
console.log('Scopes:', info.scopes)
```

---

## Token Refresh

oauth.do automatically refreshes expired tokens when you call authentication functions.

### Automatic Refresh

```typescript
import { ensureLoggedIn, getToken } from 'oauth.do'

// ensureLoggedIn automatically refreshes if needed
const token = await ensureLoggedIn()

// getToken does NOT auto-refresh - throws if expired
try {
  const token = await getToken()
} catch (error) {
  if (error.code === 'NOT_AUTHENTICATED') {
    // Token expired or not logged in
    await ensureLoggedIn()
  }
}
```

### Manual Refresh

```typescript
import { refreshToken, getToken } from 'oauth.do'

const currentToken = await getToken()

// Manually refresh the token
const newToken = await refreshToken(currentToken)
```

### Token Expiration

Tokens are considered expired 5 minutes before their actual expiration time to prevent edge cases.

```typescript
import { Token } from 'oauth.do'

// Token utility
function isExpired(token: Token): boolean {
  if (!token.expiresAt) return false
  const buffer = 300 // 5 minutes
  return token.expiresAt < Date.now() / 1000 + buffer
}
```

---

## Integration with rpc.do

oauth.do integrates seamlessly with rpc.do for authenticated API calls.

### Basic Integration

```typescript
import { ensureLoggedIn, getAuthHeader } from 'oauth.do'
import { connect } from 'rpc.do'

async function createAuthenticatedClient() {
  await ensureLoggedIn()

  return connect('wss://api.example.do', {
    headers: {
      'Authorization': await getAuthHeader()
    }
  })
}

async function main() {
  const client = await createAuthenticatedClient()

  // All calls are authenticated
  const user = await client.$.users.me()
  const data = await client.$.data.list()
}
```

### Automatic Re-authentication

```typescript
import { ensureLoggedIn, getAuthHeader, AuthError } from 'oauth.do'
import { connect, RpcError } from 'rpc.do'

class AuthenticatedClient {
  private client: ReturnType<typeof connect> | null = null

  async getClient() {
    if (!this.client) {
      await ensureLoggedIn()
      this.client = connect('wss://api.example.do', {
        headers: { 'Authorization': await getAuthHeader() }
      })
    }
    return this.client
  }

  async call<T>(fn: (client: any) => Promise<T>): Promise<T> {
    try {
      const client = await this.getClient()
      return await fn(client)
    } catch (error) {
      if (error instanceof RpcError && error.status === 401) {
        // Token expired, re-authenticate
        this.client = null
        await ensureLoggedIn({ force: true })
        const client = await this.getClient()
        return await fn(client)
      }
      throw error
    }
  }
}

// Usage
const auth = new AuthenticatedClient()
const user = await auth.call(c => c.$.users.me())
```

### Multi-Service Authentication

```typescript
import { ensureLoggedIn, getAuthHeader } from 'oauth.do'
import { connect } from 'rpc.do'

async function main() {
  await ensureLoggedIn()
  const authHeader = await getAuthHeader()

  // Same token works across all .do services
  const mongo = connect('wss://mongo.do', { headers: { Authorization: authHeader } })
  const kafka = connect('wss://kafka.do', { headers: { Authorization: authHeader } })
  const storage = connect('wss://storage.do', { headers: { Authorization: authHeader } })

  // All authenticated
  await mongo.$.users.find({})
  await kafka.$.topics.list()
  await storage.$.files.list()
}
```

---

## Error Handling

oauth.do provides typed errors for authentication failures.

### AuthError

```typescript
import { AuthError, AuthErrorCode, ensureLoggedIn } from 'oauth.do'

try {
  await ensureLoggedIn()
} catch (error) {
  if (error instanceof AuthError) {
    switch (error.code) {
      case 'NOT_AUTHENTICATED':
        console.log('Please log in')
        break
      case 'TOKEN_EXPIRED':
        console.log('Session expired, please log in again')
        break
      case 'TOKEN_REVOKED':
        console.log('Access was revoked')
        break
      case 'REFRESH_FAILED':
        console.log('Could not refresh token')
        break
      case 'NETWORK_ERROR':
        console.log('Network error:', error.message)
        break
      case 'ACCESS_DENIED':
        console.log('Access denied')
        break
      case 'TIMEOUT':
        console.log('Authentication timed out')
        break
      case 'CANCELLED':
        console.log('Authentication cancelled')
        break
    }
  }
}
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

```typescript
import { ensureLoggedIn, AuthOptions } from 'oauth.do'

const options: AuthOptions = {
  // OAuth client ID (defaults to DotDo CLI client)
  clientId: 'my-app',

  // OAuth scopes to request
  scopes: ['openid', 'profile', 'email', 'offline_access'],

  // Custom authorization server URL
  authServer: 'https://auth.example.com',

  // Force re-authentication even if already logged in
  force: true,

  // Preferred authentication flow
  flow: 'browser', // 'browser', 'device', or 'auto'

  // Port for local callback server (browser flow)
  callbackPort: 8787,

  // Timeout for authentication flow in milliseconds
  timeout: 300000, // 5 minutes

  // Show progress/status messages
  interactive: true
}

const token = await ensureLoggedIn(options)
```

### Default Values

```typescript
import { OAUTH_DEFAULTS } from 'oauth.do'

console.log(OAUTH_DEFAULTS)
// {
//   authServer: 'https://oauth.do',
//   clientId: 'dotdo-cli',
//   scopes: ['openid', 'profile', 'email', 'offline_access'],
//   callbackPort: 8787,
//   timeout: 300000,
//   serviceName: 'oauth.do',
//   accountName: 'default'
// }
```

---

## TypeScript Integration

oauth.do is written in TypeScript and provides comprehensive type definitions.

### Type Definitions

```typescript
import type {
  // Token types
  Token,
  StoredCredential,

  // User types
  User,
  Workspace,

  // Options
  AuthOptions,
  StorageOptions,

  // OAuth flow types
  AuthorizationRequest,
  DeviceAuthorizationResponse,
  TokenResponse,

  // Error types
  AuthErrorCode,

  // Event types
  AuthEventType,
  AuthEvent,
  AuthEventListener
} from 'oauth.do'
```

### Token Type

```typescript
interface Token {
  accessToken: string
  tokenType: 'Bearer' | string
  expiresAt?: number         // Unix timestamp in seconds
  refreshToken?: string
  scopes?: string[]
  tokenId?: string
}
```

### User Type

```typescript
interface User {
  id: string
  email: string
  name?: string
  avatarUrl?: string
  emailVerified: boolean
  createdAt: string
  workspace?: Workspace
}

interface Workspace {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}
```

---

## Auth Events

Subscribe to authentication events for logging or UI updates.

```typescript
import { onAuthEvent, AuthEvent } from 'oauth.do'

const unsubscribe = onAuthEvent((event: AuthEvent) => {
  switch (event.type) {
    case 'login_started':
      console.log('Login started...')
      break
    case 'login_success':
      console.log('Logged in as', event.user?.email)
      break
    case 'login_failed':
      console.log('Login failed:', event.error?.message)
      break
    case 'logout':
      console.log('Logged out')
      break
    case 'token_refreshed':
      console.log('Token refreshed')
      break
    case 'token_expired':
      console.log('Token expired')
      break
  }
})

// Later, unsubscribe
unsubscribe()
```

---

## Environment Detection

oauth.do automatically detects the environment to choose the best authentication flow.

### Check Environment

```typescript
import { isHeadless, canUseBrowserFlow } from 'oauth.do'

if (isHeadless()) {
  console.log('Running in headless environment')
  console.log('Will use device code flow')
}

if (canUseBrowserFlow()) {
  console.log('Browser flow available')
}
```

### Headless Detection

oauth.do considers an environment headless when:

- SSH session (`SSH_CONNECTION` or `SSH_TTY` is set)
- CI environment (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `JENKINS_URL`)
- Container environment (`KUBERNETES_SERVICE_HOST` or `container` is set)
- Linux without display (`DISPLAY` and `WAYLAND_DISPLAY` are unset)

---

## CLI Integration

oauth.do is designed for CLI applications.

### Example CLI

```typescript
#!/usr/bin/env npx tsx

import { program } from 'commander'
import {
  ensureLoggedIn,
  logout,
  whoami,
  isAuthenticated,
  getStorageInfo
} from 'oauth.do'

program
  .name('my-cli')
  .description('Example CLI with oauth.do')

program
  .command('login')
  .description('Log in to the service')
  .option('-f, --force', 'Force re-authentication')
  .action(async (options) => {
    await ensureLoggedIn({ force: options.force })
    const user = await whoami()
    console.log(`Logged in as ${user?.email}`)
  })

program
  .command('logout')
  .description('Log out of the service')
  .action(async () => {
    await logout()
    console.log('Logged out successfully')
  })

program
  .command('whoami')
  .description('Show current user')
  .action(async () => {
    const user = await whoami()
    if (user) {
      console.log(`Name: ${user.name}`)
      console.log(`Email: ${user.email}`)
      console.log(`Verified: ${user.emailVerified}`)
    } else {
      console.log('Not logged in')
    }
  })

program
  .command('status')
  .description('Show authentication status')
  .action(async () => {
    const info = await getStorageInfo()
    console.log('Authenticated:', info.isAuthenticated)
    console.log('Storage:', info.tokenSource)
    if (info.expiresAt) {
      console.log('Expires:', new Date(info.expiresAt).toISOString())
    }
    if (info.scopes) {
      console.log('Scopes:', info.scopes.join(', '))
    }
  })

program.parse()
```

---

## Testing

### Mocking Authentication

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock oauth.do
vi.mock('oauth.do', () => ({
  ensureLoggedIn: vi.fn().mockResolvedValue({
    accessToken: 'mock-token',
    tokenType: 'Bearer'
  }),
  getToken: vi.fn().mockResolvedValue({
    accessToken: 'mock-token',
    tokenType: 'Bearer'
  }),
  getAuthHeader: vi.fn().mockResolvedValue('Bearer mock-token'),
  whoami: vi.fn().mockResolvedValue({
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true
  }),
  isAuthenticated: vi.fn().mockResolvedValue(true),
  logout: vi.fn().mockResolvedValue(undefined)
}))

import { myFunction } from './my-code'

describe('myFunction', () => {
  it('should use authenticated user', async () => {
    const result = await myFunction()
    expect(result.user.email).toBe('test@example.com')
  })
})
```

### Testing with Environment Variables

```typescript
describe('API key authentication', () => {
  beforeEach(() => {
    process.env.DOTDO_API_KEY = 'test-api-key'
  })

  afterEach(() => {
    delete process.env.DOTDO_API_KEY
  })

  it('should use API key from environment', async () => {
    const { getToken } = await import('oauth.do')
    const token = await getToken()
    expect(token.accessToken).toBe('test-api-key')
  })
})
```

---

## API Reference

### Core Functions

```typescript
// Ensure user is logged in (prompts if needed)
function ensureLoggedIn(options?: AuthOptions): Promise<Token>

// Get current token without prompting (throws if not authenticated)
function getToken(): Promise<Token>

// Check if user is authenticated
function isAuthenticated(): Promise<boolean>

// Log out and clear stored tokens
function logout(options?: AuthOptions): Promise<void>

// Get current user information
function whoami(options?: AuthOptions): Promise<User | null>
```

### Convenience Functions

```typescript
// Force new login
function login(options?: AuthOptions): Promise<Token>

// Login with browser flow
function loginWithBrowser(options?: AuthOptions): Promise<Token>

// Login with device code flow
function loginWithDeviceCode(options?: AuthOptions): Promise<Token>

// Get authorization header for API requests
function getAuthHeader(): Promise<string>

// Get storage information
function getStorageInfo(): Promise<StorageInfo>
```

### Storage Functions

```typescript
// Get the default storage instance
function getStorage(options?: StorageOptions): TokenStorage

// Store a token
function storeToken(token: Token, source: TokenSource): Promise<void>

// Delete stored tokens
function deleteToken(): Promise<void>

// Check if a token is stored
function hasToken(): Promise<boolean>

// Get configuration directory path
function getConfigDir(options?: StorageOptions): string

// Get credentials file path
function getCredentialsPath(options?: StorageOptions): string

// Get token from environment variables
function getEnvToken(): Token | null
```

### OAuth Flow Functions

```typescript
// Browser-based OAuth flow
function browserFlow(options?: AuthOptions): Promise<Token>

// Device code OAuth flow
function deviceFlow(options?: DeviceFlowOptions): Promise<Token>

// Refresh an access token
function refreshToken(token: Token, options?: AuthOptions): Promise<Token>

// Revoke a token
function revokeToken(token: Token, options?: AuthOptions): Promise<void>

// Check if running in headless environment
function isHeadless(): boolean

// Check if browser flow is available
function canUseBrowserFlow(): boolean
```

### Event Functions

```typescript
// Subscribe to authentication events
function onAuthEvent(listener: AuthEventListener): () => void
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```typescript
#!/usr/bin/env npx tsx
/**
 * Complete oauth.do example demonstrating authentication flows,
 * token management, and integration with rpc.do.
 */

import {
  ensureLoggedIn,
  getToken,
  whoami,
  logout,
  isAuthenticated,
  getStorageInfo,
  getAuthHeader,
  onAuthEvent,
  AuthError,
  isHeadless,
  canUseBrowserFlow
} from 'oauth.do'
import { connect } from 'rpc.do'

async function main() {
  console.log('='.repeat(60))
  console.log('oauth.do Complete Example')
  console.log('='.repeat(60))

  // Subscribe to auth events
  const unsubscribe = onAuthEvent((event) => {
    console.log(`[Auth Event] ${event.type}`)
  })

  try {
    // Check environment
    console.log('\n1. Environment Detection')
    console.log('-'.repeat(40))
    console.log(`  Headless: ${isHeadless()}`)
    console.log(`  Can use browser: ${canUseBrowserFlow()}`)

    // Check current status
    console.log('\n2. Authentication Status')
    console.log('-'.repeat(40))

    const authenticated = await isAuthenticated()
    console.log(`  Authenticated: ${authenticated}`)

    if (!authenticated) {
      console.log('  Logging in...')
      await ensureLoggedIn()
      console.log('  Login successful!')
    }

    // Get user info
    console.log('\n3. User Information')
    console.log('-'.repeat(40))

    const user = await whoami()
    if (user) {
      console.log(`  ID: ${user.id}`)
      console.log(`  Name: ${user.name}`)
      console.log(`  Email: ${user.email}`)
      console.log(`  Verified: ${user.emailVerified}`)
      if (user.workspace) {
        console.log(`  Workspace: ${user.workspace.name}`)
        console.log(`  Role: ${user.workspace.role}`)
      }
    }

    // Storage info
    console.log('\n4. Storage Information')
    console.log('-'.repeat(40))

    const info = await getStorageInfo()
    console.log(`  Source: ${info.tokenSource}`)
    console.log(`  Keychain available: ${info.keychainAvailable}`)
    if (info.expiresAt) {
      console.log(`  Expires: ${info.expiresAt.toISOString()}`)
    }
    if (info.scopes) {
      console.log(`  Scopes: ${info.scopes.join(', ')}`)
    }

    // Integration with rpc.do
    console.log('\n5. rpc.do Integration')
    console.log('-'.repeat(40))

    const authHeader = await getAuthHeader()
    console.log(`  Auth header: ${authHeader.substring(0, 20)}...`)

    // Example: Connect to a service (commented out for demo)
    // const client = connect('wss://api.example.do', {
    //   headers: { Authorization: authHeader }
    // })
    // const data = await client.$.users.me()
    console.log('  Ready to connect to .do services')

    // Logout (optional)
    console.log('\n6. Logout')
    console.log('-'.repeat(40))

    // Uncomment to actually log out:
    // await logout()
    // console.log('  Logged out successfully')
    console.log('  (Skipped for demo)')

  } catch (error) {
    if (error instanceof AuthError) {
      console.error(`Auth error: ${error.code} - ${error.message}`)
    } else {
      throw error
    }
  } finally {
    unsubscribe()
  }

  console.log('\n' + '='.repeat(60))
  console.log('Demo Complete!')
  console.log('='.repeat(60))
}

main().catch(console.error)
```

---

## Security Considerations

### Token Storage

- Tokens are stored in the OS keychain when available (most secure)
- File fallback uses restricted permissions (`0600`)
- Never log or expose tokens in error messages

### PKCE

The browser flow uses PKCE (Proof Key for Code Exchange) to prevent authorization code interception attacks.

### Token Revocation

Always revoke tokens on logout to prevent unauthorized access:

```typescript
import { logout } from 'oauth.do'

// logout() automatically revokes the token on the server
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
| [rpc.do](https://npmjs.com/package/rpc.do) | RPC client for .do services |
| [capnweb](https://npmjs.com/package/capnweb) | Low-level capability-based RPC |
| [mongo.do](https://npmjs.com/package/mongo.do) | MongoDB client for .do ecosystem |
| [database.do](https://npmjs.com/package/database.do) | Database client for .do ecosystem |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Secure by default** | OS keychain storage, PKCE, automatic token refresh |
| **Works everywhere** | Browser flow, device code flow, API keys |
| **Zero configuration** | Sensible defaults, environment variable support |
| **Seamless integration** | Works with rpc.do and all .do services |
| **TypeScript first** | Full type definitions, excellent IDE support |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
