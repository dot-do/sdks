// Package oauth provides OAuth authentication for DotDo CLI and SDK.
//
// This package provides local CLI authentication with secure token storage.
//
// Storage Locations:
//   - macOS: Keychain via go-keyring
//   - Linux: libsecret via go-keyring
//   - Windows: Credential Manager via go-keyring
//   - Fallback: ~/.config/dotdo/credentials.json
//
// Environment Variables:
//   - DOTDO_TOKEN: Direct token override
//   - DOTDO_API_KEY: API key authentication
//   - DOTDO_CONFIG_DIR: Custom config directory
//   - DOTDO_NO_KEYCHAIN: Disable keychain storage
//   - DOTDO_AUTH_SERVER: Custom authorization server
//
// Example:
//
//	import "go.dotdo.dev/oauth"
//
//	// Check if logged in, prompt if not
//	token, err := oauth.EnsureLoggedIn(nil)
//
//	// Get token without prompting (returns error if not logged in)
//	token, err := oauth.GetToken()
//
//	// Check auth status
//	authenticated, err := oauth.IsAuthenticated()
//
//	// Get current user info
//	user, err := oauth.Whoami(nil)
//
//	// Logout and clear stored tokens
//	err := oauth.Logout(nil)
package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ============================================================================
// Constants
// ============================================================================

// OAuthDefaults contains default OAuth configuration values.
var OAuthDefaults = struct {
	AuthServer   string
	ClientID     string
	Scopes       []string
	CallbackPort int
	Timeout      time.Duration
	ServiceName  string
	AccountName  string
}{
	AuthServer:   "https://oauth.do",
	ClientID:     "dotdo-cli",
	Scopes:       []string{"openid", "profile", "email", "offline_access"},
	CallbackPort: 8787,
	Timeout:      5 * time.Minute,
	ServiceName:  "oauth.do",
	AccountName:  "default",
}

// EnvVars contains environment variable names.
var EnvVars = struct {
	Token      string
	APIKey     string
	ConfigDir  string
	NoKeychain string
	AuthServer string
}{
	Token:      "DOTDO_TOKEN",
	APIKey:     "DOTDO_API_KEY",
	ConfigDir:  "DOTDO_CONFIG_DIR",
	NoKeychain: "DOTDO_NO_KEYCHAIN",
	AuthServer: "DOTDO_AUTH_SERVER",
}

// ============================================================================
// Error Types
// ============================================================================

// AuthErrorCode represents authentication error codes.
type AuthErrorCode string

const (
	ErrNotAuthenticated AuthErrorCode = "NOT_AUTHENTICATED"
	ErrTokenExpired     AuthErrorCode = "TOKEN_EXPIRED"
	ErrTokenRevoked     AuthErrorCode = "TOKEN_REVOKED"
	ErrRefreshFailed    AuthErrorCode = "REFRESH_FAILED"
	ErrStorageError     AuthErrorCode = "STORAGE_ERROR"
	ErrNetworkError     AuthErrorCode = "NETWORK_ERROR"
	ErrInvalidGrant     AuthErrorCode = "INVALID_GRANT"
	ErrAccessDenied     AuthErrorCode = "ACCESS_DENIED"
	ErrTimeout          AuthErrorCode = "TIMEOUT"
	ErrCancelled        AuthErrorCode = "CANCELLED"
	ErrUnknown          AuthErrorCode = "UNKNOWN"
)

// AuthError represents an authentication error.
type AuthError struct {
	Message string
	Code    AuthErrorCode
	Status  int
	Cause   error
}

func (e *AuthError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *AuthError) Unwrap() error {
	return e.Cause
}

// NewAuthError creates a new authentication error.
func NewAuthError(message string, code AuthErrorCode) *AuthError {
	return &AuthError{Message: message, Code: code}
}

// ============================================================================
// Token Types
// ============================================================================

// Token represents an OAuth access token with metadata.
type Token struct {
	AccessToken  string   `json:"access_token"`
	TokenType    string   `json:"token_type"`
	ExpiresAt    int64    `json:"expires_at,omitempty"`
	RefreshToken string   `json:"refresh_token,omitempty"`
	Scopes       []string `json:"scopes,omitempty"`
	TokenID      string   `json:"token_id,omitempty"`
}

// IsExpired checks if the token is expired or about to expire.
func (t *Token) IsExpired() bool {
	if t.ExpiresAt == 0 {
		return false // No expiry = never expires
	}
	// Consider expired if within 5 minutes of expiry
	bufferSeconds := int64(300)
	return t.ExpiresAt < time.Now().Unix()+bufferSeconds
}

// TokenSource represents the source of a token.
type TokenSource string

const (
	TokenSourceBrowser TokenSource = "browser"
	TokenSourceDevice  TokenSource = "device"
	TokenSourceAPIKey  TokenSource = "api_key"
	TokenSourceEnv     TokenSource = "env"
)

// StoredCredential represents a stored credential.
type StoredCredential struct {
	Token       Token       `json:"token"`
	StoredAt    int64       `json:"stored_at"`
	Source      TokenSource `json:"source"`
	UserID      string      `json:"user_id,omitempty"`
	WorkspaceID string      `json:"workspace_id,omitempty"`
}

// ============================================================================
// User Types
// ============================================================================

// WorkspaceRole represents a user's role in a workspace.
type WorkspaceRole string

const (
	RoleOwner  WorkspaceRole = "owner"
	RoleAdmin  WorkspaceRole = "admin"
	RoleMember WorkspaceRole = "member"
	RoleViewer WorkspaceRole = "viewer"
)

// Workspace represents a workspace/organization.
type Workspace struct {
	ID   string        `json:"id"`
	Name string        `json:"name"`
	Slug string        `json:"slug"`
	Role WorkspaceRole `json:"role"`
}

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

// ============================================================================
// Options
// ============================================================================

// AuthOptions contains options for authentication operations.
type AuthOptions struct {
	ClientID     string
	Scopes       []string
	AuthServer   string
	Force        bool
	Flow         string // "browser", "device", or "auto"
	CallbackPort int
	Timeout      time.Duration
	Interactive  bool
	State        string
	Context      context.Context
}

// StorageOptions contains options for token storage.
type StorageOptions struct {
	ServiceName     string
	AccountName     string
	ConfigDir       string
	DisableKeychain bool
}

// DeviceAuthorizationResponse represents a device authorization response.
type DeviceAuthorizationResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete,omitempty"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

// ============================================================================
// Configuration
// ============================================================================

// GetConfigDir returns the configuration directory path.
func GetConfigDir(opts *StorageOptions) string {
	// Check environment variable first
	if envDir := os.Getenv(EnvVars.ConfigDir); envDir != "" {
		return envDir
	}

	// Use provided option
	if opts != nil && opts.ConfigDir != "" {
		return opts.ConfigDir
	}

	// Default: ~/.config/dotdo on Unix, %APPDATA%/dotdo on Windows
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			home, _ := os.UserHomeDir()
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, "dotdo")
	}

	// XDG Base Directory specification
	xdgConfig := os.Getenv("XDG_CONFIG_HOME")
	if xdgConfig == "" {
		home, _ := os.UserHomeDir()
		xdgConfig = filepath.Join(home, ".config")
	}
	return filepath.Join(xdgConfig, "dotdo")
}

// GetCredentialsPath returns the credentials file path.
func GetCredentialsPath(opts *StorageOptions) string {
	return filepath.Join(GetConfigDir(opts), "credentials.json")
}

// GetEnvToken checks for a token in environment variables.
func GetEnvToken() *Token {
	// Direct token override
	if envToken := os.Getenv(EnvVars.Token); envToken != "" {
		return &Token{
			AccessToken: envToken,
			TokenType:   "Bearer",
		}
	}

	// API key authentication
	if apiKey := os.Getenv(EnvVars.APIKey); apiKey != "" {
		return &Token{
			AccessToken: apiKey,
			TokenType:   "Bearer",
		}
	}

	return nil
}

func isKeychainDisabled(opts *StorageOptions) bool {
	if opts != nil && opts.DisableKeychain {
		return true
	}
	envDisable := os.Getenv(EnvVars.NoKeychain)
	return envDisable == "1" || envDisable == "true"
}

// ============================================================================
// Token Storage
// ============================================================================

// TokenStorage manages token storage with keychain and file fallback.
type TokenStorage struct {
	options     *StorageOptions
	serviceName string
	accountName string
}

// NewTokenStorage creates a new token storage instance.
func NewTokenStorage(opts *StorageOptions) *TokenStorage {
	if opts == nil {
		opts = &StorageOptions{}
	}

	serviceName := opts.ServiceName
	if serviceName == "" {
		serviceName = OAuthDefaults.ServiceName
	}

	accountName := opts.AccountName
	if accountName == "" {
		accountName = OAuthDefaults.AccountName
	}

	return &TokenStorage{
		options:     opts,
		serviceName: serviceName,
		accountName: accountName,
	}
}

// Store stores a token.
func (s *TokenStorage) Store(token *Token, source TokenSource) error {
	credential := &StoredCredential{
		Token:    *token,
		StoredAt: time.Now().UnixMilli(),
		Source:   source,
	}

	// Try keychain first
	if err := s.storeInKeychain(credential); err == nil {
		return nil
	}

	// Fall back to file storage
	return s.storeInFile(credential)
}

// Get retrieves the stored token.
func (s *TokenStorage) Get() (*Token, error) {
	// Check environment first
	if envToken := GetEnvToken(); envToken != nil {
		return envToken, nil
	}

	// Try keychain
	if cred, err := s.getFromKeychain(); err == nil && cred != nil {
		return &cred.Token, nil
	}

	// Try file fallback
	if cred, err := s.getFromFile(); err == nil && cred != nil {
		return &cred.Token, nil
	}

	return nil, nil
}

// GetCredential retrieves the full stored credential.
func (s *TokenStorage) GetCredential() (*StoredCredential, error) {
	// Check environment first
	if envToken := GetEnvToken(); envToken != nil {
		return &StoredCredential{
			Token:    *envToken,
			StoredAt: time.Now().UnixMilli(),
			Source:   TokenSourceEnv,
		}, nil
	}

	// Try keychain
	if cred, err := s.getFromKeychain(); err == nil && cred != nil {
		return cred, nil
	}

	// Try file fallback
	return s.getFromFile()
}

// Delete removes the stored token.
func (s *TokenStorage) Delete() error {
	// Delete from both keychain and file
	s.deleteFromKeychain()
	return s.deleteFile()
}

// Has checks if a token is stored.
func (s *TokenStorage) Has() bool {
	token, _ := s.Get()
	return token != nil
}

// IsExpired checks if the stored token is expired.
func (s *TokenStorage) IsExpired() bool {
	cred, err := s.GetCredential()
	if err != nil || cred == nil {
		return true
	}
	return cred.Token.IsExpired()
}

// Keychain operations (using go-keyring when available)
func (s *TokenStorage) storeInKeychain(credential *StoredCredential) error {
	if isKeychainDisabled(s.options) {
		return errors.New("keychain disabled")
	}

	// Try to use keyring
	data, err := json.Marshal(credential)
	if err != nil {
		return err
	}

	return keyringSet(s.serviceName, s.accountName, string(data))
}

func (s *TokenStorage) getFromKeychain() (*StoredCredential, error) {
	if isKeychainDisabled(s.options) {
		return nil, errors.New("keychain disabled")
	}

	data, err := keyringGet(s.serviceName, s.accountName)
	if err != nil {
		return nil, err
	}

	var cred StoredCredential
	if err := json.Unmarshal([]byte(data), &cred); err != nil {
		return nil, err
	}

	return &cred, nil
}

func (s *TokenStorage) deleteFromKeychain() error {
	if isKeychainDisabled(s.options) {
		return nil
	}
	return keyringDelete(s.serviceName, s.accountName)
}

// File operations
func (s *TokenStorage) storeInFile(credential *StoredCredential) error {
	configDir := GetConfigDir(s.options)
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return err
	}

	filePath := GetCredentialsPath(s.options)
	data, err := json.Marshal(credential)
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0600)
}

func (s *TokenStorage) getFromFile() (*StoredCredential, error) {
	filePath := GetCredentialsPath(s.options)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var cred StoredCredential
	if err := json.Unmarshal(data, &cred); err != nil {
		return nil, err
	}

	return &cred, nil
}

func (s *TokenStorage) deleteFile() error {
	filePath := GetCredentialsPath(s.options)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// ============================================================================
// Keyring Abstraction (with fallback)
// ============================================================================

// Try to import keyring - fallback to file-only if not available
var keyringAvailable = true

func keyringSet(service, account, password string) error {
	if !keyringAvailable {
		return errors.New("keyring not available")
	}
	// TODO: Implement actual keyring integration
	// Using github.com/zalando/go-keyring
	return errors.New("keyring not implemented - using file fallback")
}

func keyringGet(service, account string) (string, error) {
	if !keyringAvailable {
		return "", errors.New("keyring not available")
	}
	// TODO: Implement actual keyring integration
	return "", errors.New("keyring not implemented - using file fallback")
}

func keyringDelete(service, account string) error {
	if !keyringAvailable {
		return nil
	}
	// TODO: Implement actual keyring integration
	return nil
}

// ============================================================================
// Default Storage
// ============================================================================

var defaultStorage *TokenStorage

// GetStorage returns the default token storage instance.
func GetStorage(opts *StorageOptions) *TokenStorage {
	if defaultStorage == nil || opts != nil {
		defaultStorage = NewTokenStorage(opts)
	}
	return defaultStorage
}

// ============================================================================
// Environment Detection
// ============================================================================

// IsHeadless checks if we're in a headless environment.
func IsHeadless() bool {
	// Check for common headless indicators
	if os.Getenv("SSH_CONNECTION") != "" || os.Getenv("SSH_TTY") != "" {
		return true
	}

	// Check for CI environments
	ciVars := []string{"CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "JENKINS_URL"}
	for _, v := range ciVars {
		if os.Getenv(v) != "" {
			return true
		}
	}

	// Check for container environments
	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" || os.Getenv("container") != "" {
		return true
	}

	// Check if DISPLAY is missing (Linux)
	if runtime.GOOS == "linux" {
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return true
		}
	}

	return false
}

// CanUseBrowserFlow checks if browser flow is available.
func CanUseBrowserFlow() bool {
	if IsHeadless() {
		return false
	}

	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	case "linux":
		return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
	default:
		return false
	}
}

// ============================================================================
// OAuth Flows (Stubs)
// ============================================================================

// BrowserFlow runs the browser-based OAuth flow.
// TODO: Implement full browser flow with PKCE
func BrowserFlow(opts *AuthOptions) (*Token, error) {
	return nil, errors.New("browser flow not yet implemented in Go SDK")
}

// DeviceFlow runs the device code OAuth flow.
// TODO: Implement device code flow (RFC 8628)
func DeviceFlow(opts *AuthOptions, onUserCode func(code, uri, uriComplete string), onPoll func(attempt int)) (*Token, error) {
	return nil, errors.New("device flow not yet implemented in Go SDK")
}

// RefreshToken refreshes an access token using a refresh token.
func RefreshToken(token *Token, opts *AuthOptions) (*Token, error) {
	if token.RefreshToken == "" {
		return nil, NewAuthError("No refresh token available", ErrRefreshFailed)
	}

	if opts == nil {
		opts = &AuthOptions{}
	}

	authServer := opts.AuthServer
	if authServer == "" {
		authServer = OAuthDefaults.AuthServer
	}

	clientID := opts.ClientID
	if clientID == "" {
		clientID = OAuthDefaults.ClientID
	}

	tokenURL := authServer + "/token"

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", token.RefreshToken)
	data.Set("client_id", clientID)

	ctx := opts.Context
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, &AuthError{Message: "Failed to create request", Code: ErrNetworkError, Cause: err}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, &AuthError{Message: "Token refresh request failed", Code: ErrNetworkError, Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, &AuthError{
			Message: fmt.Sprintf("Token refresh failed: %s", resp.Status),
			Code:    ErrRefreshFailed,
			Status:  resp.StatusCode,
		}
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, &AuthError{Message: "Failed to decode token response", Code: ErrNetworkError, Cause: err}
	}

	newToken := &Token{
		AccessToken: tokenResp.AccessToken,
		TokenType:   tokenResp.TokenType,
		ExpiresAt:   time.Now().Unix() + tokenResp.ExpiresIn,
	}

	if tokenResp.RefreshToken != "" {
		newToken.RefreshToken = tokenResp.RefreshToken
	} else {
		newToken.RefreshToken = token.RefreshToken
	}

	if tokenResp.Scope != "" {
		newToken.Scopes = strings.Split(tokenResp.Scope, " ")
	} else {
		newToken.Scopes = token.Scopes
	}

	return newToken, nil
}

// RevokeToken revokes a token (logout).
func RevokeToken(token *Token, opts *AuthOptions) error {
	if opts == nil {
		opts = &AuthOptions{}
	}

	authServer := opts.AuthServer
	if authServer == "" {
		authServer = OAuthDefaults.AuthServer
	}

	clientID := opts.ClientID
	if clientID == "" {
		clientID = OAuthDefaults.ClientID
	}

	revokeURL := authServer + "/revoke"

	data := url.Values{}
	data.Set("token", token.AccessToken)
	data.Set("client_id", clientID)

	ctx := opts.Context
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, "POST", revokeURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil // Non-fatal
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil // Non-fatal
	}
	resp.Body.Close()

	return nil
}

// ============================================================================
// Core Auth Functions
// ============================================================================

// EnsureLoggedIn ensures the user is logged in.
// If already authenticated, returns the existing token (refreshing if needed).
// If not authenticated, initiates the appropriate login flow.
func EnsureLoggedIn(opts *AuthOptions) (*Token, error) {
	if opts == nil {
		opts = &AuthOptions{}
	}

	storage := GetStorage(nil)

	// Check for forced re-authentication
	if !opts.Force {
		existingToken, err := storage.Get()
		if err == nil && existingToken != nil {
			// Check if token needs refresh
			if storage.IsExpired() {
				if existingToken.RefreshToken != "" {
					newToken, err := RefreshToken(existingToken, opts)
					if err == nil {
						storage.Store(newToken, TokenSourceBrowser)
						return newToken, nil
					}
					// Continue to login on refresh failure
				}
			} else {
				return existingToken, nil
			}
		}
	}

	// Determine which flow to use
	flow := opts.Flow
	if flow == "" {
		flow = "auto"
	}

	var token *Token
	var err error

	if flow == "browser" || (flow == "auto" && CanUseBrowserFlow()) {
		token, err = BrowserFlow(opts)
		if err == nil {
			storage.Store(token, TokenSourceBrowser)
		}
	} else {
		token, err = DeviceFlow(opts, nil, nil)
		if err == nil {
			storage.Store(token, TokenSourceDevice)
		}
	}

	return token, err
}

// GetToken returns the current access token without prompting for login.
func GetToken() (*Token, error) {
	storage := GetStorage(nil)
	token, err := storage.Get()
	if err != nil {
		return nil, &AuthError{Message: "Failed to get token", Code: ErrStorageError, Cause: err}
	}
	if token == nil {
		return nil, NewAuthError("Not authenticated. Please login first.", ErrNotAuthenticated)
	}
	return token, nil
}

// IsAuthenticated checks if the user is currently authenticated.
func IsAuthenticated() (bool, error) {
	storage := GetStorage(nil)
	token, err := storage.Get()
	if err != nil {
		return false, err
	}
	if token == nil {
		return false, nil
	}

	// Check if token is expired
	if token.ExpiresAt > 0 && token.ExpiresAt < time.Now().Unix() {
		// Expired - but can refresh?
		return token.RefreshToken != "", nil
	}

	return true, nil
}

// Logout clears all stored tokens.
func Logout(opts *AuthOptions) error {
	storage := GetStorage(nil)

	// Get current token for revocation
	token, _ := storage.Get()

	// Revoke token on server (best effort)
	if token != nil && GetEnvToken() == nil {
		RevokeToken(token, opts)
	}

	// Clear stored credentials
	return storage.Delete()
}

// Whoami returns information about the currently authenticated user.
func Whoami(opts *AuthOptions) (*User, error) {
	storage := GetStorage(nil)
	token, err := storage.Get()
	if err != nil {
		return nil, err
	}
	if token == nil {
		return nil, nil
	}

	if opts == nil {
		opts = &AuthOptions{}
	}

	authServer := opts.AuthServer
	if authServer == "" {
		authServer = OAuthDefaults.AuthServer
	}

	userinfoURL := authServer + "/userinfo"

	ctx := opts.Context
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, "GET", userinfoURL, nil)
	if err != nil {
		return nil, &AuthError{Message: "Failed to create request", Code: ErrNetworkError, Cause: err}
	}
	req.Header.Set("Authorization", fmt.Sprintf("%s %s", token.TokenType, token.AccessToken))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, &AuthError{Message: "Failed to fetch user info", Code: ErrNetworkError, Cause: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, nil
	}

	if resp.StatusCode != http.StatusOK {
		return nil, &AuthError{
			Message: fmt.Sprintf("Failed to fetch user info: %s", resp.Status),
			Code:    ErrNetworkError,
			Status:  resp.StatusCode,
		}
	}

	var data struct {
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
		EmailVerified bool   `json:"email_verified"`
		CreatedAt     string `json:"created_at"`
		Workspace     *struct {
			ID   string        `json:"id"`
			Name string        `json:"name"`
			Slug string        `json:"slug"`
			Role WorkspaceRole `json:"role"`
		} `json:"workspace"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, &AuthError{Message: "Failed to decode user info", Code: ErrNetworkError, Cause: err}
	}

	user := &User{
		ID:            data.Sub,
		Email:         data.Email,
		Name:          data.Name,
		AvatarURL:     data.Picture,
		EmailVerified: data.EmailVerified,
		CreatedAt:     data.CreatedAt,
	}

	if data.Workspace != nil {
		user.Workspace = &Workspace{
			ID:   data.Workspace.ID,
			Name: data.Workspace.Name,
			Slug: data.Workspace.Slug,
			Role: data.Workspace.Role,
		}
	}

	return user, nil
}

// ============================================================================
// Convenience Functions
// ============================================================================

// Login forces a new login.
func Login(opts *AuthOptions) (*Token, error) {
	if opts == nil {
		opts = &AuthOptions{}
	}
	opts.Force = true
	return EnsureLoggedIn(opts)
}

// LoginWithBrowser forces login with browser flow.
func LoginWithBrowser(opts *AuthOptions) (*Token, error) {
	if opts == nil {
		opts = &AuthOptions{}
	}
	opts.Flow = "browser"
	opts.Force = true
	return EnsureLoggedIn(opts)
}

// LoginWithDeviceCode forces login with device code flow.
func LoginWithDeviceCode(opts *AuthOptions) (*Token, error) {
	if opts == nil {
		opts = &AuthOptions{}
	}
	opts.Flow = "device"
	opts.Force = true
	return EnsureLoggedIn(opts)
}

// GetAuthHeader returns the authorization header for API requests.
func GetAuthHeader() (string, error) {
	token, err := GetToken()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s %s", token.TokenType, token.AccessToken), nil
}

// StorageInfo contains information about token storage.
type StorageInfo struct {
	IsAuthenticated   bool
	TokenSource       string
	TokenPath         string
	KeychainAvailable bool
	ExpiresAt         *time.Time
	Scopes            []string
}

// GetStorageInfo returns information about token storage.
func GetStorageInfo() (*StorageInfo, error) {
	storage := GetStorage(nil)
	credential, _ := storage.GetCredential()

	var location string
	if GetEnvToken() != nil {
		location = "env"
	} else if keyringAvailable && !isKeychainDisabled(nil) {
		location = "keychain"
	} else if _, err := os.Stat(GetCredentialsPath(nil)); err == nil {
		location = "file"
	} else {
		location = "none"
	}

	info := &StorageInfo{
		IsAuthenticated:   credential != nil,
		TokenSource:       location,
		KeychainAvailable: keyringAvailable,
	}

	if location == "file" {
		info.TokenPath = GetCredentialsPath(nil)
	}

	if credential != nil {
		if credential.Token.ExpiresAt > 0 {
			t := time.Unix(credential.Token.ExpiresAt, 0)
			info.ExpiresAt = &t
		}
		info.Scopes = credential.Token.Scopes
	}

	return info, nil
}
