# go.oauth.do

**OAuth 2.0 Device Authorization Flow for the .do Platform - secure token management with keyring integration.**

```go
import oauth "go.oauth.do"

// Device authorization flow
auth, _ := oauth.AuthorizeDevice()
fmt.Printf("Visit %s and enter code: %s\n", auth.VerificationURI, auth.UserCode)
token, _ := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)

// Get current user
user, _ := oauth.GetUser(token.AccessToken)
fmt.Printf("Logged in as %s\n", user.Email)
```

One import. Secure storage. Seamless authentication.

---

## What is oauth.do?

`go.oauth.do` is the OAuth authentication layer for the `.do` ecosystem in Go. It implements RFC 8628 (OAuth 2.0 Device Authorization Grant) with secure token storage, automatic token refresh, and seamless integration with all `.do` services.

Think of it as the "authentication glue" that lets you:

1. **Authenticate once** - Log in via device code flow (RFC 8628)
2. **Store securely** - Tokens are stored in the OS keyring (macOS Keychain, Windows Credential Manager, Linux libsecret)
3. **Refresh automatically** - Expired tokens are refreshed transparently
4. **Integrate seamlessly** - Works with all `.do` services

```
Your Application
       |
       v
  +---------+     +----------+     +-------------+
  |  oauth  | --> |  apis.do | --> | *.do Server |
  +---------+     +----------+     +-------------+
       |
       +--- Device Code Flow (RFC 8628)
       +--- Secure Token Storage (Keyring)
       +--- Automatic Token Refresh
       +--- API Key Authentication
```

---

## CLI Installation

Install the `oauth-do` CLI:

```bash
go install go.oauth.do/cmd/oauth-do@latest
```

### CLI Commands

```bash
# Login using device authorization flow
oauth-do login

# Show current authenticated user
oauth-do whoami

# Display current authentication token
oauth-do token

# Show authentication and storage status
oauth-do status

# Logout and remove stored credentials
oauth-do logout
```

---

## Library Installation

```bash
go get go.oauth.do
```

Requires Go 1.21+.

In your Go module:

```go
import oauth "go.oauth.do"
```

---

## Quick Start

### Device Authorization Flow

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Step 1: Initiate device authorization
    auth, err := oauth.AuthorizeDevice()
    if err != nil {
        log.Fatal(err)
    }

    // Step 2: Show user the code
    fmt.Printf("Visit %s and enter code: %s\n", auth.VerificationURI, auth.UserCode)
    fmt.Printf("Or open: %s\n", auth.VerificationURIComplete)

    // Step 3: Poll for tokens
    token, err := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)
    if err != nil {
        log.Fatal(err)
    }

    // Step 4: Store the token
    err = oauth.SetTokenData(&oauth.StoredTokenData{
        AccessToken:  token.AccessToken,
        RefreshToken: token.RefreshToken,
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println("Successfully authenticated!")
}
```

### Get Current User

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Get stored token
    token, err := oauth.GetToken()
    if err != nil || token == "" {
        log.Fatal("Not authenticated. Please run 'oauth-do login' first.")
    }

    // Get user info
    result, err := oauth.GetUser(token)
    if err != nil {
        log.Fatal(err)
    }

    if result.User != nil {
        fmt.Printf("Name: %s\n", result.User.Name)
        fmt.Printf("Email: %s\n", result.User.Email)
        fmt.Printf("ID: %s\n", result.User.ID)
    } else {
        fmt.Println("Not authenticated")
    }
}
```

### Using with HTTP APIs

```go
package main

import (
    "fmt"
    "log"
    "net/http"

    oauth "go.oauth.do"
)

func main() {
    // Get stored token
    token, err := oauth.GetToken()
    if err != nil || token == "" {
        log.Fatal("Not authenticated")
    }

    // Create authenticated request
    req, _ := http.NewRequest("GET", "https://apis.do/me", nil)
    req.Header.Set("Authorization", "Bearer "+token)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        log.Fatal(err)
    }
    defer resp.Body.Close()

    fmt.Printf("Status: %s\n", resp.Status)
}
```

---

## API Endpoints

The package uses the following OAuth 2.0 endpoints:

| Endpoint | URL | Description |
|----------|-----|-------------|
| Device Auth | `POST https://auth.apis.do/user_management/authorize/device` | Initiate device authorization |
| Token | `POST https://auth.apis.do/user_management/authenticate` | Poll for tokens / refresh tokens |
| User Info | `GET https://apis.do/me` | Get authenticated user info |

---

## Configuration

### Configure OAuth Client

```go
package main

import oauth "go.oauth.do"

func main() {
    // Configure OAuth settings
    oauth.Configure(oauth.OAuthConfig{
        ClientID:      "your-client-id",
        AuthKitDomain: "login.oauth.do",
        APIUrl:        "https://apis.do",
        StoragePath:   "~/.myapp/token",
    })
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OAUTH_CLIENT_ID` | OAuth client ID | `client_01JQYTRXK9ZPD8JPJTKDCRB656` |
| `OAUTH_AUTHKIT_DOMAIN` | AuthKit domain | `login.oauth.do` |
| `OAUTH_API_URL` or `API_URL` | API base URL | `https://apis.do` |
| `OAUTH_STORAGE_PATH` | Custom token storage path | `~/.oauth.do/token` |
| `DO_TOKEN` | Direct token override | - |
| `DO_ADMIN_TOKEN` | Admin token override (higher priority) | - |
| `DEBUG` | Enable debug output | - |

---

## Device Authorization Flow

The package implements OAuth 2.0 Device Authorization Grant (RFC 8628):

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Step 1: Request device authorization
    auth, err := oauth.AuthorizeDevice()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Visit: %s\n", auth.VerificationURI)
    fmt.Printf("Enter code: %s\n", auth.UserCode)
    fmt.Printf("Or open: %s\n", auth.VerificationURIComplete)
    fmt.Printf("Code expires in: %d seconds\n", auth.ExpiresIn)

    // Step 2: Poll for tokens (blocks until user authorizes)
    token, err := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Access token: %s...\n", token.AccessToken[:20])
    fmt.Printf("Token type: %s\n", token.TokenType)
}
```

### Direct Provider Login

Skip the AuthKit login screen and go directly to a provider:

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Go directly to GitHub OAuth
    auth, err := oauth.AuthorizeDevice(oauth.DeviceAuthOptions{
        Provider: oauth.ProviderGitHub,
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Visit: %s\n", auth.VerificationURIComplete)
}
```

Available providers:
- `oauth.ProviderGitHub` - GitHub OAuth
- `oauth.ProviderGoogle` - Google OAuth
- `oauth.ProviderMicrosoft` - Microsoft OAuth
- `oauth.ProviderApple` - Apple OAuth

---

## Token Storage

The package uses secure, platform-specific token storage with automatic fallback.

### Storage Locations

| Platform | Primary Storage | Fallback |
|----------|----------------|----------|
| macOS | Keychain (via go-keyring) | `~/.oauth.do/token` |
| Linux | libsecret (via go-keyring) | `~/.oauth.do/token` |
| Windows | Credential Manager (via go-keyring) | `~/.oauth.do/token` |

### Storage Backends

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Create keyring storage (uses system keyring)
    keyring := oauth.NewKeyringStorage()

    // Create file storage (with custom path)
    file := oauth.NewFileStorage("~/.myapp/token")

    // Create secure storage (tries keyring, falls back to file)
    secure := oauth.CreateSecureStorage("")

    // Store a token
    err := secure.SetToken("your-access-token")
    if err != nil {
        log.Fatal(err)
    }

    // Get stored token
    token, err := secure.GetToken()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Token: %s...\n", token[:20])

    // Store full token data (with refresh token)
    err = secure.SetTokenData(&oauth.StoredTokenData{
        AccessToken:  "access-token",
        RefreshToken: "refresh-token",
        ExpiresAt:    1704067200000, // Unix timestamp in milliseconds
    })
    if err != nil {
        log.Fatal(err)
    }

    // Get full token data
    data, err := secure.GetTokenData()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Access: %s\n", data.AccessToken)
    fmt.Printf("Refresh: %s\n", data.RefreshToken)

    // Remove token
    err = secure.RemoveToken()
    if err != nil {
        log.Fatal(err)
    }
}
```

### Storage Information

```go
package main

import (
    "fmt"

    oauth "go.oauth.do"
)

func main() {
    storageType, secure, path, authenticated := oauth.GetStorageInfo()

    fmt.Printf("Storage type: %s\n", storageType) // "file" or "keyring"
    fmt.Printf("Secure: %v\n", secure)
    fmt.Printf("Path: %s\n", path)
    fmt.Printf("Authenticated: %v\n", authenticated)
}
```

---

## Token Refresh

Refresh tokens using the refresh token grant:

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Get stored token data
    data, err := oauth.GetTokenData()
    if err != nil || data == nil {
        log.Fatal("No stored token")
    }

    if data.RefreshToken == "" {
        log.Fatal("No refresh token available")
    }

    // Refresh the token
    newToken, err := oauth.RefreshToken(data.RefreshToken)
    if err != nil {
        log.Fatal(err)
    }

    // Store the new tokens
    err = oauth.SetTokenData(&oauth.StoredTokenData{
        AccessToken:  newToken.AccessToken,
        RefreshToken: newToken.RefreshToken,
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println("Token refreshed successfully!")
}
```

---

## Authentication Provider

Create an auth provider function for HTTP clients:

```go
package main

import (
    "fmt"
    "log"
    "net/http"

    oauth "go.oauth.do"
)

func main() {
    // Create an auth provider
    provider := oauth.NewAuthProvider()

    // Use it to get tokens for requests
    token, err := provider()
    if err != nil {
        log.Fatal(err)
    }

    // Create authenticated request
    req, _ := http.NewRequest("GET", "https://apis.do/me", nil)
    req.Header.Set("Authorization", "Bearer "+token)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        log.Fatal(err)
    }
    defer resp.Body.Close()

    fmt.Printf("Status: %s\n", resp.Status)
}
```

---

## Error Handling

Common errors and their handling:

```go
package main

import (
    "fmt"
    "log"

    oauth "go.oauth.do"
)

func main() {
    // Device authorization errors
    auth, err := oauth.AuthorizeDevice()
    if err != nil {
        // Possible errors:
        // - "client ID is required for device authorization"
        // - "device authorization failed: ..."
        log.Fatal(err)
    }

    // Token polling errors
    token, err := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)
    if err != nil {
        // Possible errors:
        // - "device authorization expired. Please try again"
        // - "access denied by user"
        // - "device code expired"
        // - "token polling failed: ..."
        log.Fatal(err)
    }

    // User info errors
    result, err := oauth.GetUser(token.AccessToken)
    if err != nil {
        // Possible errors:
        // - "failed to create request: ..."
        // - "failed to fetch user info: ..."
        // - "authentication failed: ..."
        log.Fatal(err)
    }

    if result.User == nil {
        fmt.Println("Token is invalid or expired")
    }
}
```

### Token Errors

| Error | Description |
|-------|-------------|
| `authorization_pending` | User hasn't completed authorization yet |
| `slow_down` | Client is polling too fast |
| `access_denied` | User denied the authorization request |
| `expired_token` | Device code has expired |

---

## Types

### OAuthConfig

```go
// OAuthConfig contains OAuth configuration options.
type OAuthConfig struct {
    APIUrl        string // Base URL for API endpoints (default: "https://apis.do")
    ClientID      string // OAuth client ID (default: "client_01JQYTRXK9ZPD8JPJTKDCRB656")
    AuthKitDomain string // AuthKit domain (default: "login.oauth.do")
    StoragePath   string // Custom token storage path (default: "~/.oauth.do/token")
}
```

### User

```go
// User represents user information returned from auth endpoints.
type User struct {
    ID    string                 `json:"id"`
    Email string                 `json:"email,omitempty"`
    Name  string                 `json:"name,omitempty"`
    Extra map[string]interface{} `json:"-"` // Additional fields
}
```

### DeviceAuthorizationResponse

```go
// DeviceAuthorizationResponse represents the device authorization response (RFC 8628).
type DeviceAuthorizationResponse struct {
    DeviceCode              string `json:"device_code"`
    UserCode                string `json:"user_code"`
    VerificationURI         string `json:"verification_uri"`
    VerificationURIComplete string `json:"verification_uri_complete"`
    ExpiresIn               int    `json:"expires_in"`
    Interval                int    `json:"interval"`
}
```

### TokenResponse

```go
// TokenResponse represents the token response.
type TokenResponse struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token,omitempty"`
    TokenType    string `json:"token_type"`
    ExpiresIn    int    `json:"expires_in,omitempty"`
    User         *User  `json:"user,omitempty"`
}
```

### StoredTokenData

```go
// StoredTokenData represents stored token data.
type StoredTokenData struct {
    AccessToken  string `json:"accessToken"`
    RefreshToken string `json:"refreshToken,omitempty"`
    ExpiresAt    int64  `json:"expiresAt,omitempty"` // Unix timestamp in milliseconds
}
```

### TokenStorage

```go
// TokenStorage defines the interface for token storage backends.
type TokenStorage interface {
    GetToken() (string, error)
    SetToken(token string) error
    RemoveToken() error
    GetTokenData() (*StoredTokenData, error)
    SetTokenData(data *StoredTokenData) error
}
```

---

## CLI Integration

The `oauth-do` CLI is included in this package and can be used as a reference for building your own CLI:

```bash
# Install the CLI
go install go.oauth.do/cmd/oauth-do@latest

# Login
oauth-do login

# Check authentication
oauth-do whoami

# Get token for scripts
TOKEN=$(oauth-do token)
curl -H "Authorization: Bearer $TOKEN" https://apis.do/me

# Status
oauth-do status

# Logout
oauth-do logout
```

### Building Your Own CLI

```go
package main

import (
    "fmt"
    "log"
    "os"

    oauth "go.oauth.do"
)

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: mycli <command>")
        fmt.Println("Commands: login, logout, whoami, token")
        os.Exit(1)
    }

    switch os.Args[1] {
    case "login":
        auth, err := oauth.AuthorizeDevice()
        if err != nil {
            log.Fatal(err)
        }

        fmt.Printf("Visit: %s\n", auth.VerificationURI)
        fmt.Printf("Enter code: %s\n", auth.UserCode)

        token, err := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)
        if err != nil {
            log.Fatal(err)
        }

        oauth.SetTokenData(&oauth.StoredTokenData{
            AccessToken:  token.AccessToken,
            RefreshToken: token.RefreshToken,
        })

        fmt.Println("Login successful!")

    case "logout":
        oauth.Logout("")
        fmt.Println("Logged out")

    case "whoami":
        token, _ := oauth.GetToken()
        result, err := oauth.GetUser(token)
        if err != nil || result.User == nil {
            fmt.Println("Not authenticated")
            os.Exit(1)
        }
        fmt.Printf("Email: %s\n", result.User.Email)

    case "token":
        token, _ := oauth.GetToken()
        if token == "" {
            os.Exit(1)
        }
        fmt.Println(token)

    default:
        fmt.Printf("Unknown command: %s\n", os.Args[1])
        os.Exit(1)
    }
}
```

---

## Testing

### Mocking Authentication

```go
package myapp

import (
    "testing"

    "go.dotdo.dev/oauth"
)

// MockTokenStorage implements oauth.TokenStorage for testing
type MockTokenStorage struct {
    token *oauth.Token
}

func (m *MockTokenStorage) Store(token *oauth.Token, source oauth.TokenSource) error {
    m.token = token
    return nil
}

func (m *MockTokenStorage) Get() (*oauth.Token, error) {
    return m.token, nil
}

func (m *MockTokenStorage) Delete() error {
    m.token = nil
    return nil
}

func (m *MockTokenStorage) Has() bool {
    return m.token != nil
}

func TestAuthenticatedFunction(t *testing.T) {
    // Set up mock token via environment variable
    t.Setenv("DOTDO_TOKEN", "mock-token")

    token, err := oauth.GetToken()
    if err != nil {
        t.Fatalf("GetToken failed: %v", err)
    }

    if token.AccessToken != "mock-token" {
        t.Errorf("Expected mock-token, got %s", token.AccessToken)
    }
}
```

### Testing with Environment Variables

```go
package myapp

import (
    "os"
    "testing"

    "go.dotdo.dev/oauth"
)

func TestAPIKeyAuth(t *testing.T) {
    // Set up API key environment variable
    os.Setenv("DOTDO_API_KEY", "test-api-key")
    defer os.Unsetenv("DOTDO_API_KEY")

    token, err := oauth.GetToken()
    if err != nil {
        t.Fatalf("GetToken failed: %v", err)
    }

    if token.AccessToken != "test-api-key" {
        t.Errorf("Expected test-api-key, got %s", token.AccessToken)
    }
}
```

---

## API Reference

### Core Functions

```go
// Ensure user is logged in (prompts if needed)
func EnsureLoggedIn(opts *AuthOptions) (*Token, error)

// Get current token without prompting (returns error if not authenticated)
func GetToken() (*Token, error)

// Check if user is authenticated
func IsAuthenticated() (bool, error)

// Log out and clear stored tokens
func Logout(opts *AuthOptions) error

// Get current user information
func Whoami(opts *AuthOptions) (*User, error)
```

### Convenience Functions

```go
// Force new login
func Login(opts *AuthOptions) (*Token, error)

// Login with browser flow
func LoginWithBrowser(opts *AuthOptions) (*Token, error)

// Login with device code flow
func LoginWithDeviceCode(opts *AuthOptions) (*Token, error)

// Get authorization header for API requests
func GetAuthHeader() (string, error)

// Get storage information
func GetStorageInfo() (*StorageInfo, error)
```

### Storage Functions

```go
// Get the default storage instance
func GetStorage(opts *StorageOptions) *TokenStorage

// Create a new token storage instance
func NewTokenStorage(opts *StorageOptions) *TokenStorage

// TokenStorage methods
func (s *TokenStorage) Store(token *Token, source TokenSource) error
func (s *TokenStorage) Get() (*Token, error)
func (s *TokenStorage) GetCredential() (*StoredCredential, error)
func (s *TokenStorage) Delete() error
func (s *TokenStorage) Has() bool
func (s *TokenStorage) IsExpired() bool

// Get configuration directory path
func GetConfigDir(opts *StorageOptions) string

// Get credentials file path
func GetCredentialsPath(opts *StorageOptions) string

// Get token from environment variables
func GetEnvToken() *Token
```

### OAuth Flow Functions

```go
// Browser-based OAuth flow
func BrowserFlow(opts *AuthOptions) (*Token, error)

// Device code OAuth flow
func DeviceFlow(opts *AuthOptions, onUserCode func(code, uri, uriComplete string), onPoll func(attempt int)) (*Token, error)

// Refresh an access token
func RefreshToken(token *Token, opts *AuthOptions) (*Token, error)

// Revoke a token
func RevokeToken(token *Token, opts *AuthOptions) error

// Check if running in headless environment
func IsHeadless() bool

// Check if browser flow is available
func CanUseBrowserFlow() bool
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```go
package main

import (
    "errors"
    "fmt"
    "log"
    "net/http"

    "go.dotdo.dev/oauth"
    rpc "go.rpc.do"
)

func main() {
    fmt.Println(strings.Repeat("=", 60))
    fmt.Println("oauth Complete Example")
    fmt.Println(strings.Repeat("=", 60))

    // Check environment
    fmt.Println("\n1. Environment Detection")
    fmt.Println(strings.Repeat("-", 40))
    fmt.Printf("  Headless: %v\n", oauth.IsHeadless())
    fmt.Printf("  Can use browser: %v\n", oauth.CanUseBrowserFlow())

    // Check current status
    fmt.Println("\n2. Authentication Status")
    fmt.Println(strings.Repeat("-", 40))

    authenticated, err := oauth.IsAuthenticated()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("  Authenticated: %v\n", authenticated)

    if !authenticated {
        fmt.Println("  Logging in...")
        _, err := oauth.EnsureLoggedIn(nil)
        if err != nil {
            var authErr *oauth.AuthError
            if errors.As(err, &authErr) {
                fmt.Printf("  Auth error: %s - %s\n", authErr.Code, authErr.Message)
                return
            }
            log.Fatal(err)
        }
        fmt.Println("  Login successful!")
    }

    // Get user info
    fmt.Println("\n3. User Information")
    fmt.Println(strings.Repeat("-", 40))

    user, err := oauth.Whoami(nil)
    if err != nil {
        log.Fatal(err)
    }

    if user != nil {
        fmt.Printf("  ID: %s\n", user.ID)
        fmt.Printf("  Name: %s\n", user.Name)
        fmt.Printf("  Email: %s\n", user.Email)
        fmt.Printf("  Verified: %v\n", user.EmailVerified)
        if user.Workspace != nil {
            fmt.Printf("  Workspace: %s\n", user.Workspace.Name)
            fmt.Printf("  Role: %s\n", user.Workspace.Role)
        }
    }

    // Storage info
    fmt.Println("\n4. Storage Information")
    fmt.Println(strings.Repeat("-", 40))

    info, err := oauth.GetStorageInfo()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("  Source: %s\n", info.TokenSource)
    fmt.Printf("  Keychain available: %v\n", info.KeychainAvailable)
    if info.ExpiresAt != nil {
        fmt.Printf("  Expires: %s\n", info.ExpiresAt.Format("2006-01-02 15:04:05"))
    }
    if info.Scopes != nil {
        fmt.Printf("  Scopes: %v\n", info.Scopes)
    }

    // Integration with rpc.do
    fmt.Println("\n5. go.rpc.do Integration")
    fmt.Println(strings.Repeat("-", 40))

    authHeader, err := oauth.GetAuthHeader()
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("  Auth header: %s...\n", authHeader[:20])

    // Example: Connect to a service
    headers := http.Header{}
    headers.Set("Authorization", authHeader)

    // client, err := rpc.Connect("wss://api.example.do", rpc.WithHeaders(headers))
    // if err != nil {
    //     log.Fatal(err)
    // }
    // defer client.Close()
    // result, _ := client.Call("users.me").Await()
    fmt.Println("  Ready to connect to .do services")

    // Logout (optional)
    fmt.Println("\n6. Logout")
    fmt.Println(strings.Repeat("-", 40))

    // Uncomment to actually log out:
    // if err := oauth.Logout(nil); err != nil {
    //     log.Fatal(err)
    // }
    // fmt.Println("  Logged out successfully")
    fmt.Println("  (Skipped for demo)")

    fmt.Println()
    fmt.Println(strings.Repeat("=", 60))
    fmt.Println("Demo Complete!")
    fmt.Println(strings.Repeat("=", 60))
}
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

```go
// Logout() automatically revokes the token on the server
if err := oauth.Logout(nil); err != nil {
    log.Printf("Logout error: %v", err)
}
```

### API Keys vs OAuth

- Use OAuth for user-facing applications (CLIs, desktop apps)
- Use API keys for server-to-server communication
- Never commit API keys or tokens to version control

---

## Related Packages

| Package | Description |
|---------|-------------|
| [go.rpc.do](https://pkg.go.dev/go.rpc.do) | RPC client for .do services |
| [go.dotdo.dev/capnweb](https://pkg.go.dev/go.dotdo.dev/capnweb) | Low-level capability-based RPC |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Secure by default** | OS keychain storage, PKCE, automatic token refresh |
| **Works everywhere** | Browser flow, device code flow, API keys |
| **Zero configuration** | Sensible defaults, environment variable support |
| **Seamless integration** | Works with go.rpc.do and all .do services |
| **Idiomatic Go** | Error handling, context support, interfaces |

---

## License

MIT

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
