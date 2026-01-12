# go.dotdo.dev/oauth

**OAuth authentication layer for DotDo services - secure token management with keychain integration.**

```go
import "go.dotdo.dev/oauth"

// Ensure user is logged in (opens browser or device code flow)
token, err := oauth.EnsureLoggedIn(nil)

// Get current user
user, err := oauth.Whoami(nil)
fmt.Printf("Logged in as %s\n", user.Email)
```

One import. Secure storage. Seamless authentication.

---

## What is oauth.do?

`go.dotdo.dev/oauth` is the authentication layer for the `.do` ecosystem in Go. It provides OAuth 2.0 authentication with secure token storage, automatic token refresh, and seamless integration with `go.rpc.do` and domain-specific SDKs.

Think of it as the "authentication glue" that lets you:

1. **Authenticate once** - Log in via browser or device code flow
2. **Store securely** - Tokens are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux libsecret)
3. **Refresh automatically** - Expired tokens are refreshed transparently
4. **Integrate seamlessly** - Works with `go.rpc.do` and all `.do` services

```
Your Application
       |
       v
  +---------+     +----------+     +-------------+
  |  oauth  | --> |  rpc.do  | --> | *.do Server |
  +---------+     +----------+     +-------------+
       |
       +--- Browser/Device Code Flow
       +--- Secure Token Storage (Keychain)
       +--- Automatic Token Refresh
       +--- API Key Authentication
```

---

## oauth vs Direct API Keys

| Feature | Direct API Keys | oauth |
|---------|-----------------|-------|
| Storage | Environment variables or config files | OS keychain with file fallback |
| Token refresh | Manual | Automatic |
| Multiple auth methods | No | Yes (browser, device code, API key) |
| User info | Manual API calls | Built-in `Whoami()` |
| Logout/revocation | Manual | Built-in `Logout()` |
| CI/CD support | Environment variables | Device code flow + env vars |

**Use direct API keys** when you have a simple server-to-server integration.

**Use oauth** when you're building CLIs, desktop apps, or need user-specific authentication.

---

## Installation

```bash
go get go.dotdo.dev/oauth
```

Requires Go 1.21+.

In your Go module:

```go
import "go.dotdo.dev/oauth"
```

---

## Quick Start

### Basic Authentication

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // Check if already authenticated
    authenticated, err := oauth.IsAuthenticated()
    if err != nil {
        log.Fatal(err)
    }

    if authenticated {
        fmt.Println("Already logged in")
    } else {
        // This opens browser or shows device code
        _, err := oauth.EnsureLoggedIn(nil)
        if err != nil {
            log.Fatal(err)
        }
        fmt.Println("Successfully logged in")
    }

    // Later, to log out
    if err := oauth.Logout(nil); err != nil {
        log.Fatal(err)
    }
}
```

### Get Current User

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    _, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        log.Fatal(err)
    }

    user, err := oauth.Whoami(nil)
    if err != nil {
        log.Fatal(err)
    }

    if user != nil {
        fmt.Printf("Name: %s\n", user.Name)
        fmt.Printf("Email: %s\n", user.Email)
        fmt.Printf("Verified: %v\n", user.EmailVerified)
        if user.Workspace != nil {
            fmt.Printf("Workspace: %s (%s)\n", user.Workspace.Name, user.Workspace.Role)
        }
    }
}
```

### Using with go.rpc.do

```go
package main

import (
    "fmt"
    "log"
    "net/http"

    "go.dotdo.dev/oauth"
    rpc "go.rpc.do"
)

func main() {
    // Ensure we're authenticated
    _, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        log.Fatal(err)
    }

    // Get the auth header for API calls
    authHeader, err := oauth.GetAuthHeader()
    if err != nil {
        log.Fatal(err)
    }

    // Connect with authentication
    headers := http.Header{}
    headers.Set("Authorization", authHeader)

    client, err := rpc.Connect("wss://api.example.do", rpc.WithHeaders(headers))
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Make authenticated calls
    result, err := client.Call("users.me").Await()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("User: %v\n", result)
}
```

---

## Authentication Flows

oauth supports multiple authentication flows to handle different environments.

### Browser Flow (Default)

The browser flow opens your default browser to authenticate. A local server receives the callback.

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // Opens browser to https://oauth.do/authorize
    // Redirects back to localhost:8787/callback
    token, err := oauth.LoginWithBrowser(nil)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Access token: %s...\n", token.AccessToken[:20])
}
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

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // Shows a code to enter at https://oauth.do/device
    token, err := oauth.LoginWithDeviceCode(nil)
    if err != nil {
        log.Fatal(err)
    }

    // Output:
    // Visit https://oauth.do/device and enter code: ABCD-1234
    // Waiting for authorization...

    fmt.Printf("Authenticated: %s\n", token.TokenType)
}
```

This flow:
1. Requests device authorization from the server
2. Displays user code and verification URL
3. Polls for token until user authorizes
4. Stores tokens securely

### Automatic Flow Selection

Let oauth choose the best flow for your environment:

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // Automatically chooses browser or device flow
    token, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Authenticated with %s token\n", token.TokenType)
}
```

oauth detects:
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

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // Returns token from DOTDO_API_KEY environment variable
    token, err := oauth.GetToken()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Using API key: %s...\n", token.AccessToken[:8])
}
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

oauth uses secure, platform-specific token storage with automatic fallback.

### Storage Locations

| Platform | Primary Storage | Fallback |
|----------|----------------|----------|
| macOS | Keychain (via go-keyring) | `~/.config/dotdo/credentials.json` |
| Linux | libsecret (via go-keyring) | `~/.config/dotdo/credentials.json` |
| Windows | Credential Manager (via go-keyring) | `%APPDATA%/dotdo/credentials.json` |

### Manual Storage Operations

```go
package main

import (
    "fmt"
    "log"
    "time"

    "go.dotdo.dev/oauth"
)

func main() {
    // Get the default storage instance
    storage := oauth.GetStorage(nil)

    // Check if a token is stored
    if storage.Has() {
        fmt.Println("Token found")
    }

    // Store a custom token
    token := &oauth.Token{
        AccessToken:  "your-token",
        TokenType:    "Bearer",
        ExpiresAt:    time.Now().Unix() + 3600,
        RefreshToken: "refresh-token",
    }

    if err := storage.Store(token, oauth.TokenSourceBrowser); err != nil {
        log.Fatal(err)
    }

    // Delete stored tokens
    if err := storage.Delete(); err != nil {
        log.Fatal(err)
    }
}
```

### Custom Storage Options

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    storage := oauth.NewTokenStorage(&oauth.StorageOptions{
        ServiceName:     "my-app",              // Keychain service name
        AccountName:     "user@example.com",    // Keychain account name
        ConfigDir:       "/custom/path",        // Custom config directory
        DisableKeychain: false,                 // Force file storage only
    })

    token, err := storage.Get()
    if err != nil {
        log.Fatal(err)
    }

    if token != nil {
        fmt.Printf("Found token: %s...\n", token.AccessToken[:8])
    }
}
```

### Storage Information

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    info, err := oauth.GetStorageInfo()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Authenticated: %v\n", info.IsAuthenticated)
    fmt.Printf("Source: %s\n", info.TokenSource) // "keychain", "file", "env", or "none"
    fmt.Printf("Keychain available: %v\n", info.KeychainAvailable)

    if info.ExpiresAt != nil {
        fmt.Printf("Expires: %s\n", info.ExpiresAt.Format(time.RFC3339))
    }

    if info.Scopes != nil {
        fmt.Printf("Scopes: %v\n", info.Scopes)
    }
}
```

---

## Token Refresh

oauth automatically refreshes expired tokens when you call authentication functions.

### Automatic Refresh

```go
package main

import (
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    // EnsureLoggedIn automatically refreshes if needed
    token, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        log.Fatal(err)
    }

    // GetToken does NOT auto-refresh - returns error if expired
    token, err = oauth.GetToken()
    if err != nil {
        var authErr *oauth.AuthError
        if errors.As(err, &authErr) && authErr.Code == oauth.ErrNotAuthenticated {
            // Token expired or not logged in
            token, err = oauth.EnsureLoggedIn(nil)
        } else {
            log.Fatal(err)
        }
    }
}
```

### Manual Refresh

```go
package main

import (
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    currentToken, err := oauth.GetToken()
    if err != nil {
        log.Fatal(err)
    }

    // Manually refresh the token
    newToken, err := oauth.RefreshToken(currentToken, nil)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Refreshed token expires at: %d\n", newToken.ExpiresAt)
}
```

### Token Expiration

Tokens are considered expired 5 minutes before their actual expiration time to prevent edge cases.

```go
// Token utility
func (t *Token) IsExpired() bool {
    if t.ExpiresAt == 0 {
        return false // No expiry = never expires
    }
    // Consider expired if within 5 minutes of expiry
    bufferSeconds := int64(300)
    return t.ExpiresAt < time.Now().Unix() + bufferSeconds
}
```

---

## Integration with go.rpc.do

oauth integrates seamlessly with go.rpc.do for authenticated API calls.

### Basic Integration

```go
package main

import (
    "fmt"
    "log"
    "net/http"

    "go.dotdo.dev/oauth"
    rpc "go.rpc.do"
)

func createAuthenticatedClient() (*rpc.Client, error) {
    _, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        return nil, err
    }

    authHeader, err := oauth.GetAuthHeader()
    if err != nil {
        return nil, err
    }

    headers := http.Header{}
    headers.Set("Authorization", authHeader)

    return rpc.Connect("wss://api.example.do", rpc.WithHeaders(headers))
}

func main() {
    client, err := createAuthenticatedClient()
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // All calls are authenticated
    result, err := client.Call("users.me").Await()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("User: %v\n", result)
}
```

### Automatic Re-authentication

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "sync"

    "go.dotdo.dev/oauth"
    rpc "go.rpc.do"
)

type AuthenticatedClient struct {
    client *rpc.Client
    mu     sync.Mutex
}

func (c *AuthenticatedClient) getClient() (*rpc.Client, error) {
    c.mu.Lock()
    defer c.mu.Unlock()

    if c.client == nil {
        _, err := oauth.EnsureLoggedIn(nil)
        if err != nil {
            return nil, err
        }

        authHeader, err := oauth.GetAuthHeader()
        if err != nil {
            return nil, err
        }

        headers := http.Header{}
        headers.Set("Authorization", authHeader)

        client, err := rpc.Connect("wss://api.example.do", rpc.WithHeaders(headers))
        if err != nil {
            return nil, err
        }

        c.client = client
    }

    return c.client, nil
}

func (c *AuthenticatedClient) Call(method string, args ...any) (any, error) {
    client, err := c.getClient()
    if err != nil {
        return nil, err
    }

    result, err := client.Call(method, args...).Await()
    if err != nil {
        // Check for 401 unauthorized
        var rpcErr *rpc.RPCError
        if errors.As(err, &rpcErr) && rpcErr.Code == "UNAUTHORIZED" {
            // Token expired, re-authenticate
            c.mu.Lock()
            c.client.Close()
            c.client = nil
            c.mu.Unlock()

            opts := &oauth.AuthOptions{Force: true}
            oauth.EnsureLoggedIn(opts)

            client, err = c.getClient()
            if err != nil {
                return nil, err
            }
            return client.Call(method, args...).Await()
        }
        return nil, err
    }

    return result, nil
}

func (c *AuthenticatedClient) Close() error {
    c.mu.Lock()
    defer c.mu.Unlock()

    if c.client != nil {
        return c.client.Close()
    }
    return nil
}

func main() {
    client := &AuthenticatedClient{}
    defer client.Close()

    result, err := client.Call("users.me")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("User: %v\n", result)
}
```

### Multi-Service Authentication

```go
package main

import (
    "fmt"
    "log"
    "net/http"

    "go.dotdo.dev/oauth"
    rpc "go.rpc.do"
)

func main() {
    _, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        log.Fatal(err)
    }

    authHeader, err := oauth.GetAuthHeader()
    if err != nil {
        log.Fatal(err)
    }

    headers := http.Header{}
    headers.Set("Authorization", authHeader)

    // Same token works across all .do services
    mongo, _ := rpc.Connect("wss://mongo.do", rpc.WithHeaders(headers))
    defer mongo.Close()

    kafka, _ := rpc.Connect("wss://kafka.do", rpc.WithHeaders(headers))
    defer kafka.Close()

    storage, _ := rpc.Connect("wss://storage.do", rpc.WithHeaders(headers))
    defer storage.Close()

    // All authenticated
    users, _ := mongo.Call("users.find", map[string]any{}).Await()
    topics, _ := kafka.Call("topics.list").Await()
    files, _ := storage.Call("files.list").Await()

    fmt.Printf("Users: %v\n", users)
    fmt.Printf("Topics: %v\n", topics)
    fmt.Printf("Files: %v\n", files)
}
```

---

## Error Handling

oauth provides typed errors for authentication failures.

### AuthError

```go
package main

import (
    "errors"
    "fmt"
    "log"

    "go.dotdo.dev/oauth"
)

func main() {
    _, err := oauth.EnsureLoggedIn(nil)
    if err != nil {
        var authErr *oauth.AuthError
        if errors.As(err, &authErr) {
            switch authErr.Code {
            case oauth.ErrNotAuthenticated:
                fmt.Println("Please log in")
            case oauth.ErrTokenExpired:
                fmt.Println("Session expired, please log in again")
            case oauth.ErrTokenRevoked:
                fmt.Println("Access was revoked")
            case oauth.ErrRefreshFailed:
                fmt.Println("Could not refresh token")
            case oauth.ErrNetworkError:
                fmt.Printf("Network error: %s\n", authErr.Message)
            case oauth.ErrAccessDenied:
                fmt.Println("Access denied")
            case oauth.ErrTimeout:
                fmt.Println("Authentication timed out")
            case oauth.ErrCancelled:
                fmt.Println("Authentication cancelled")
            default:
                fmt.Printf("Unknown error: %s\n", authErr.Message)
            }
        } else {
            log.Fatal(err)
        }
    }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `ErrNotAuthenticated` | No token stored, user needs to log in |
| `ErrTokenExpired` | Token has expired |
| `ErrTokenRevoked` | Token was revoked by the server |
| `ErrRefreshFailed` | Failed to refresh the token |
| `ErrStorageError` | Error accessing token storage |
| `ErrNetworkError` | Network request failed |
| `ErrInvalidGrant` | Invalid authorization grant |
| `ErrAccessDenied` | User denied access |
| `ErrTimeout` | Operation timed out |
| `ErrCancelled` | Operation was cancelled |

### Error Wrapping

```go
package main

import (
    "errors"
    "fmt"

    "go.dotdo.dev/oauth"
)

func GetUserProfile(userID string) (*Profile, error) {
    token, err := oauth.GetToken()
    if err != nil {
        return nil, fmt.Errorf("get user profile %s: %w", userID, err)
    }

    // Use token to fetch profile...
    return profile, nil
}

func main() {
    _, err := GetUserProfile("123")
    if err != nil {
        // errors.Is works with wrapped errors
        var authErr *oauth.AuthError
        if errors.As(err, &authErr) {
            fmt.Printf("Auth error: %s\n", authErr.Code)
        }
    }
}
```

---

## Authentication Options

### AuthOptions

```go
package main

import (
    "time"

    "go.dotdo.dev/oauth"
)

func main() {
    opts := &oauth.AuthOptions{
        // OAuth client ID (defaults to DotDo CLI client)
        ClientID: "my-app",

        // OAuth scopes to request
        Scopes: []string{"openid", "profile", "email", "offline_access"},

        // Custom authorization server URL
        AuthServer: "https://auth.example.com",

        // Force re-authentication even if already logged in
        Force: true,

        // Preferred authentication flow
        Flow: "browser", // "browser", "device", or "auto"

        // Port for local callback server (browser flow)
        CallbackPort: 8787,

        // Timeout for authentication flow
        Timeout: 5 * time.Minute,

        // Show progress/status messages
        Interactive: true,
    }

    token, err := oauth.EnsureLoggedIn(opts)
}
```

### Default Values

```go
package main

import (
    "fmt"

    "go.dotdo.dev/oauth"
)

func main() {
    fmt.Printf("Auth server: %s\n", oauth.OAuthDefaults.AuthServer)    // "https://oauth.do"
    fmt.Printf("Client ID: %s\n", oauth.OAuthDefaults.ClientID)        // "dotdo-cli"
    fmt.Printf("Scopes: %v\n", oauth.OAuthDefaults.Scopes)             // ["openid", "profile", "email", "offline_access"]
    fmt.Printf("Callback port: %d\n", oauth.OAuthDefaults.CallbackPort) // 8787
    fmt.Printf("Timeout: %v\n", oauth.OAuthDefaults.Timeout)            // 5 minutes
    fmt.Printf("Service name: %s\n", oauth.OAuthDefaults.ServiceName)   // "oauth.do"
    fmt.Printf("Account name: %s\n", oauth.OAuthDefaults.AccountName)   // "default"
}
```

---

## Types

### Token

```go
// Token represents an OAuth access token with metadata.
type Token struct {
    AccessToken  string   `json:"access_token"`
    TokenType    string   `json:"token_type"`
    ExpiresAt    int64    `json:"expires_at,omitempty"`    // Unix timestamp in seconds
    RefreshToken string   `json:"refresh_token,omitempty"`
    Scopes       []string `json:"scopes,omitempty"`
    TokenID      string   `json:"token_id,omitempty"`
}

// IsExpired checks if the token is expired or about to expire.
func (t *Token) IsExpired() bool
```

### User

```go
// User represents an authenticated user.
type User struct {
    ID            string     `json:"id"`
    Email         string     `json:"email"`
    Name          string     `json:"name,omitempty"`
    AvatarURL     string     `json:"avatar_url,omitempty"`
    EmailVerified bool       `json:"email_verified"`
    CreatedAt     string     `json:"created_at,omitempty"`
    Workspace     *Workspace `json:"workspace,omitempty"`
}

// Workspace represents a workspace/organization.
type Workspace struct {
    ID   string        `json:"id"`
    Name string        `json:"name"`
    Slug string        `json:"slug"`
    Role WorkspaceRole `json:"role"`
}

// WorkspaceRole represents a user's role in a workspace.
type WorkspaceRole string

const (
    RoleOwner  WorkspaceRole = "owner"
    RoleAdmin  WorkspaceRole = "admin"
    RoleMember WorkspaceRole = "member"
    RoleViewer WorkspaceRole = "viewer"
)
```

### StoredCredential

```go
// StoredCredential represents a stored credential.
type StoredCredential struct {
    Token       Token       `json:"token"`
    StoredAt    int64       `json:"stored_at"`
    Source      TokenSource `json:"source"`
    UserID      string      `json:"user_id,omitempty"`
    WorkspaceID string      `json:"workspace_id,omitempty"`
}

// TokenSource represents the source of a token.
type TokenSource string

const (
    TokenSourceBrowser TokenSource = "browser"
    TokenSourceDevice  TokenSource = "device"
    TokenSourceAPIKey  TokenSource = "api_key"
    TokenSourceEnv     TokenSource = "env"
)
```

---

## Environment Detection

oauth automatically detects the environment to choose the best authentication flow.

### Check Environment

```go
package main

import (
    "fmt"

    "go.dotdo.dev/oauth"
)

func main() {
    if oauth.IsHeadless() {
        fmt.Println("Running in headless environment")
        fmt.Println("Will use device code flow")
    }

    if oauth.CanUseBrowserFlow() {
        fmt.Println("Browser flow available")
    }
}
```

### Headless Detection

oauth considers an environment headless when:

- SSH session (`SSH_CONNECTION` or `SSH_TTY` is set)
- CI environment (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `JENKINS_URL`)
- Container environment (`KUBERNETES_SERVICE_HOST` or `container` is set)
- Linux without display (`DISPLAY` and `WAYLAND_DISPLAY` are unset)

---

## CLI Integration

oauth is designed for CLI applications.

### Example CLI with Cobra

```go
package main

import (
    "fmt"
    "log"
    "os"

    "github.com/spf13/cobra"
    "go.dotdo.dev/oauth"
)

var rootCmd = &cobra.Command{
    Use:   "my-cli",
    Short: "Example CLI with oauth",
}

var loginCmd = &cobra.Command{
    Use:   "login",
    Short: "Log in to the service",
    Run: func(cmd *cobra.Command, args []string) {
        force, _ := cmd.Flags().GetBool("force")
        opts := &oauth.AuthOptions{Force: force}

        _, err := oauth.EnsureLoggedIn(opts)
        if err != nil {
            log.Fatal(err)
        }

        user, err := oauth.Whoami(nil)
        if err != nil {
            log.Fatal(err)
        }

        if user != nil {
            fmt.Printf("Logged in as %s\n", user.Email)
        }
    },
}

var logoutCmd = &cobra.Command{
    Use:   "logout",
    Short: "Log out of the service",
    Run: func(cmd *cobra.Command, args []string) {
        if err := oauth.Logout(nil); err != nil {
            log.Fatal(err)
        }
        fmt.Println("Logged out successfully")
    },
}

var whoamiCmd = &cobra.Command{
    Use:   "whoami",
    Short: "Show current user",
    Run: func(cmd *cobra.Command, args []string) {
        user, err := oauth.Whoami(nil)
        if err != nil {
            log.Fatal(err)
        }

        if user != nil {
            fmt.Printf("Name: %s\n", user.Name)
            fmt.Printf("Email: %s\n", user.Email)
            fmt.Printf("Verified: %v\n", user.EmailVerified)
        } else {
            fmt.Println("Not logged in")
        }
    },
}

var statusCmd = &cobra.Command{
    Use:   "status",
    Short: "Show authentication status",
    Run: func(cmd *cobra.Command, args []string) {
        info, err := oauth.GetStorageInfo()
        if err != nil {
            log.Fatal(err)
        }

        fmt.Printf("Authenticated: %v\n", info.IsAuthenticated)
        fmt.Printf("Storage: %s\n", info.TokenSource)
        if info.ExpiresAt != nil {
            fmt.Printf("Expires: %s\n", info.ExpiresAt.Format("2006-01-02 15:04:05"))
        }
        if info.Scopes != nil {
            fmt.Printf("Scopes: %v\n", info.Scopes)
        }
    },
}

func init() {
    loginCmd.Flags().BoolP("force", "f", false, "Force re-authentication")

    rootCmd.AddCommand(loginCmd)
    rootCmd.AddCommand(logoutCmd)
    rootCmd.AddCommand(whoamiCmd)
    rootCmd.AddCommand(statusCmd)
}

func main() {
    if err := rootCmd.Execute(); err != nil {
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
