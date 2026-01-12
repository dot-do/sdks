// Package oauth provides OAuth 2.0 device authorization flow for the .do platform.
//
// This package implements RFC 8628 (OAuth 2.0 Device Authorization Grant) for CLI
// authentication with secure token storage using the system keyring or file fallback.
//
// Usage:
//
//	import "go.oauth.do"
//
//	// Configure client
//	oauth.Configure(oauth.Config{
//	    ClientID: "your-client-id",
//	})
//
//	// Device authorization flow
//	auth, _ := oauth.AuthorizeDevice()
//	fmt.Printf("Visit %s and enter code: %s\n", auth.VerificationURI, auth.UserCode)
//	token, _ := oauth.PollForTokens(auth.DeviceCode, auth.Interval, auth.ExpiresIn)
//
//	// Get current user
//	user, _ := oauth.GetUser(token.AccessToken)
package oauth

// OAuthConfig contains OAuth configuration options.
type OAuthConfig struct {
	// APIUrl is the base URL for API endpoints.
	// Default: "https://apis.do"
	APIUrl string

	// ClientID is the OAuth client ID.
	// Default: "client_01JQYTRXK9ZPD8JPJTKDCRB656"
	ClientID string

	// AuthKitDomain is the AuthKit domain for device authorization.
	// Default: "login.oauth.do"
	AuthKitDomain string

	// StoragePath is the custom path for token storage.
	// Supports ~ for home directory (e.g., "~/.studio/tokens.json")
	// Default: "~/.oauth.do/token"
	StoragePath string
}

// User represents user information returned from auth endpoints.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
	// Additional fields can be present
	Extra map[string]interface{} `json:"-"`
}

// AuthResult represents an authentication result.
type AuthResult struct {
	User  *User  `json:"user,omitempty"`
	Token string `json:"token,omitempty"`
}

// DeviceAuthorizationResponse represents the device authorization response.
// See RFC 8628 Section 3.2.
type DeviceAuthorizationResponse struct {
	// DeviceCode is the device verification code.
	DeviceCode string `json:"device_code"`

	// UserCode is the end-user verification code.
	UserCode string `json:"user_code"`

	// VerificationURI is the end-user verification URI.
	VerificationURI string `json:"verification_uri"`

	// VerificationURIComplete is the verification URI with user code embedded.
	VerificationURIComplete string `json:"verification_uri_complete"`

	// ExpiresIn is the lifetime in seconds of the device code.
	ExpiresIn int `json:"expires_in"`

	// Interval is the minimum polling interval in seconds.
	Interval int `json:"interval"`
}

// TokenResponse represents the token response.
type TokenResponse struct {
	// AccessToken is the access token issued by the authorization server.
	AccessToken string `json:"access_token"`

	// RefreshToken is the refresh token (optional).
	RefreshToken string `json:"refresh_token,omitempty"`

	// TokenType is the type of the token (usually "Bearer").
	TokenType string `json:"token_type"`

	// ExpiresIn is the lifetime in seconds of the access token.
	ExpiresIn int `json:"expires_in,omitempty"`

	// User contains user information if returned with the token.
	User *User `json:"user,omitempty"`
}

// TokenError represents token polling error types.
type TokenError string

const (
	// TokenErrorAuthorizationPending means the user hasn't completed authorization yet.
	TokenErrorAuthorizationPending TokenError = "authorization_pending"

	// TokenErrorSlowDown means the client is polling too fast.
	TokenErrorSlowDown TokenError = "slow_down"

	// TokenErrorAccessDenied means the user denied the authorization request.
	TokenErrorAccessDenied TokenError = "access_denied"

	// TokenErrorExpiredToken means the device code has expired.
	TokenErrorExpiredToken TokenError = "expired_token"

	// TokenErrorUnknown represents an unknown error.
	TokenErrorUnknown TokenError = "unknown"
)

// ErrorResponse represents an OAuth error response.
type ErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
}

// StoredTokenData represents stored token data including refresh token and expiration.
type StoredTokenData struct {
	// AccessToken is the access token.
	AccessToken string `json:"accessToken"`

	// RefreshToken is the refresh token (optional).
	RefreshToken string `json:"refreshToken,omitempty"`

	// ExpiresAt is the Unix timestamp in milliseconds when the token expires.
	ExpiresAt int64 `json:"expiresAt,omitempty"`
}

// TokenStorage defines the interface for token storage backends.
type TokenStorage interface {
	// GetToken retrieves the stored access token.
	GetToken() (string, error)

	// SetToken stores an access token.
	SetToken(token string) error

	// RemoveToken deletes the stored token.
	RemoveToken() error

	// GetTokenData retrieves the full stored token data.
	GetTokenData() (*StoredTokenData, error)

	// SetTokenData stores the full token data.
	SetTokenData(data *StoredTokenData) error
}

// OAuthProvider represents OAuth provider options for direct provider login.
type OAuthProvider string

const (
	// ProviderGitHub bypasses AuthKit and goes directly to GitHub.
	ProviderGitHub OAuthProvider = "GitHubOAuth"

	// ProviderGoogle bypasses AuthKit and goes directly to Google.
	ProviderGoogle OAuthProvider = "GoogleOAuth"

	// ProviderMicrosoft bypasses AuthKit and goes directly to Microsoft.
	ProviderMicrosoft OAuthProvider = "MicrosoftOAuth"

	// ProviderApple bypasses AuthKit and goes directly to Apple.
	ProviderApple OAuthProvider = "AppleOAuth"
)

// DeviceAuthOptions contains options for device authorization.
type DeviceAuthOptions struct {
	// Provider is the OAuth provider to use directly (bypasses AuthKit login screen).
	Provider OAuthProvider
}
