package oauth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// GetUser returns information about the currently authenticated user.
// If a token is provided, it uses that token. Otherwise, it checks
// environment variables (DO_TOKEN, DO_ADMIN_TOKEN) and stored tokens.
func GetUser(token string) (*AuthResult, error) {
	// If no token provided, try to get from env or storage
	if token == "" {
		token = getEnvToken()
	}
	if token == "" {
		storage := getDefaultStorage()
		storedToken, err := storage.GetToken()
		if err != nil {
			return &AuthResult{User: nil}, nil
		}
		token = storedToken
	}

	if token == "" {
		return &AuthResult{User: nil}, nil
	}

	// Make request to /me endpoint
	endpoint := GetUserInfoEndpoint()
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return &AuthResult{User: nil}, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("authentication failed: %s", resp.Status)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var user User
	if err := json.Unmarshal(body, &user); err != nil {
		return nil, fmt.Errorf("failed to parse user response: %w", err)
	}

	return &AuthResult{
		User:  &user,
		Token: token,
	}, nil
}

// Auth is an alias for GetUser for compatibility with the TypeScript API.
func Auth(token string) (*AuthResult, error) {
	return GetUser(token)
}

// Logout removes stored credentials and optionally calls the logout endpoint.
func Logout(token string) error {
	// Get token if not provided
	if token == "" {
		storage := getDefaultStorage()
		storedToken, _ := storage.GetToken()
		token = storedToken
	}

	// Call logout endpoint if we have a token
	if token != "" {
		callLogoutEndpoint(token)
	}

	// Remove stored token
	storage := getDefaultStorage()
	return storage.RemoveToken()
}

// callLogoutEndpoint calls the logout endpoint (best effort, errors ignored).
func callLogoutEndpoint(token string) {
	endpoint := GetLogoutEndpoint()
	req, err := http.NewRequest("POST", endpoint, nil)
	if err != nil {
		return
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

// GetToken returns the current access token without prompting for login.
// It checks environment variables first, then stored tokens.
func GetToken() (string, error) {
	// Check env vars first
	if token := getEnvToken(); token != "" {
		return token, nil
	}

	// Check stored token
	storage := getDefaultStorage()
	return storage.GetToken()
}

// GetTokenData returns the full stored token data.
func GetTokenData() (*StoredTokenData, error) {
	storage := getDefaultStorage()
	return storage.GetTokenData()
}

// SetToken stores a token.
func SetToken(token string) error {
	storage := getDefaultStorage()
	return storage.SetToken(token)
}

// SetTokenData stores the full token data.
func SetTokenData(data *StoredTokenData) error {
	storage := getDefaultStorage()
	return storage.SetTokenData(data)
}

// IsAuthenticated checks if the user is currently authenticated.
func IsAuthenticated() (bool, error) {
	result, err := GetUser("")
	if err != nil {
		return false, err
	}
	return result.User != nil, nil
}

// getEnvToken checks for a token in environment variables.
func getEnvToken() string {
	// Check DO_ADMIN_TOKEN first (higher priority)
	if token := os.Getenv(EnvDOAdminToken); token != "" {
		return token
	}
	// Check DO_TOKEN
	if token := os.Getenv(EnvDOToken); token != "" {
		return token
	}
	return ""
}

// RefreshToken refreshes an access token using a refresh token.
func RefreshToken(refreshToken string) (*TokenResponse, error) {
	config := GetConfig()

	if config.ClientID == "" {
		return nil, fmt.Errorf("client ID is required for token refresh")
	}

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)
	data.Set("client_id", config.ClientID)

	endpoint := GetTokenEndpoint()
	req, err := http.NewRequest("POST", endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh failed: %s - %s", resp.Status, string(body))
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &tokenResp, nil
}

// EnsureAuthenticated ensures the user is authenticated.
// If already authenticated, returns the existing token.
// If not authenticated, returns an error indicating login is required.
func EnsureAuthenticated() (string, error) {
	token, err := GetToken()
	if err != nil {
		return "", err
	}
	if token == "" {
		return "", fmt.Errorf("not authenticated. Please run 'oauth-do login' first")
	}

	// Verify token is valid
	result, err := GetUser(token)
	if err != nil {
		return "", err
	}
	if result.User == nil {
		return "", fmt.Errorf("token expired or invalid. Please run 'oauth-do login' again")
	}

	return token, nil
}

// GetStorageInfo returns information about the token storage.
func GetStorageInfo() (storageType string, secure bool, path string, authenticated bool) {
	storage := getDefaultStorage()

	// Try to get storage info if the storage supports it
	if ss, ok := storage.(*SecureStorage); ok {
		storageType, secure, path = ss.GetStorageInfo()
	} else if fs, ok := storage.(*FileStorage); ok {
		storageType, secure, path = fs.GetStorageInfo()
	} else {
		storageType = "memory"
		secure = false
		path = ""
	}

	// Check if authenticated
	token, _ := storage.GetToken()
	authenticated = token != ""

	return
}

// AuthProvider is a function type that returns an authentication token.
// This can be used with HTTP clients that support authentication providers.
type AuthProvider func() (string, error)

// NewAuthProvider creates an auth provider function for HTTP clients.
// The returned function will return the current token on each call.
//
// Example:
//
//	provider := oauth.NewAuthProvider()
//	token, err := provider()
func NewAuthProvider() AuthProvider {
	return func() (string, error) {
		return GetToken()
	}
}
