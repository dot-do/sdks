package oauth

import (
	"os"
	"sync"
)

// Default configuration values
const (
	DefaultAPIUrl        = "https://apis.do"
	DefaultClientID      = "client_01JQYTRXK9ZPD8JPJTKDCRB656"
	DefaultAuthKitDomain = "login.oauth.do"
	DefaultStoragePath   = "~/.oauth.do/token"
)

// Environment variable names
const (
	EnvOAuthAPIUrl        = "OAUTH_API_URL"
	EnvAPIUrl             = "API_URL"
	EnvOAuthClientID      = "OAUTH_CLIENT_ID"
	EnvOAuthAuthKitDomain = "OAUTH_AUTHKIT_DOMAIN"
	EnvOAuthStoragePath   = "OAUTH_STORAGE_PATH"
	EnvDOToken            = "DO_TOKEN"
	EnvDOAdminToken       = "DO_ADMIN_TOKEN"
	EnvDebug              = "DEBUG"
)

var (
	globalConfig *OAuthConfig
	configMu     sync.RWMutex
)

func init() {
	// Initialize with defaults and environment variables
	globalConfig = &OAuthConfig{
		APIUrl:        getEnvOrDefault(EnvOAuthAPIUrl, getEnvOrDefault(EnvAPIUrl, DefaultAPIUrl)),
		ClientID:      getEnvOrDefault(EnvOAuthClientID, DefaultClientID),
		AuthKitDomain: getEnvOrDefault(EnvOAuthAuthKitDomain, DefaultAuthKitDomain),
		StoragePath:   getEnvOrDefault(EnvOAuthStoragePath, DefaultStoragePath),
	}
}

// getEnvOrDefault returns the environment variable value or a default.
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// Configure sets the OAuth configuration.
// This merges the provided config with the existing configuration.
func Configure(config OAuthConfig) {
	configMu.Lock()
	defer configMu.Unlock()

	if config.APIUrl != "" {
		globalConfig.APIUrl = config.APIUrl
	}
	if config.ClientID != "" {
		globalConfig.ClientID = config.ClientID
	}
	if config.AuthKitDomain != "" {
		globalConfig.AuthKitDomain = config.AuthKitDomain
	}
	if config.StoragePath != "" {
		globalConfig.StoragePath = config.StoragePath
	}
}

// GetConfig returns the current OAuth configuration.
func GetConfig() OAuthConfig {
	configMu.RLock()
	defer configMu.RUnlock()

	return OAuthConfig{
		APIUrl:        globalConfig.APIUrl,
		ClientID:      globalConfig.ClientID,
		AuthKitDomain: globalConfig.AuthKitDomain,
		StoragePath:   globalConfig.StoragePath,
	}
}

// ResetConfig resets the configuration to defaults.
func ResetConfig() {
	configMu.Lock()
	defer configMu.Unlock()

	globalConfig = &OAuthConfig{
		APIUrl:        getEnvOrDefault(EnvOAuthAPIUrl, getEnvOrDefault(EnvAPIUrl, DefaultAPIUrl)),
		ClientID:      getEnvOrDefault(EnvOAuthClientID, DefaultClientID),
		AuthKitDomain: getEnvOrDefault(EnvOAuthAuthKitDomain, DefaultAuthKitDomain),
		StoragePath:   getEnvOrDefault(EnvOAuthStoragePath, DefaultStoragePath),
	}
}

// IsDebug returns true if debug mode is enabled.
func IsDebug() bool {
	return os.Getenv(EnvDebug) != ""
}

// GetDeviceAuthEndpoint returns the device authorization endpoint URL.
func GetDeviceAuthEndpoint() string {
	return "https://auth.apis.do/user_management/authorize/device"
}

// GetTokenEndpoint returns the token endpoint URL.
func GetTokenEndpoint() string {
	return "https://auth.apis.do/user_management/authenticate"
}

// GetUserInfoEndpoint returns the user info endpoint URL.
func GetUserInfoEndpoint() string {
	config := GetConfig()
	return config.APIUrl + "/me"
}

// GetLogoutEndpoint returns the logout endpoint URL.
func GetLogoutEndpoint() string {
	config := GetConfig()
	return config.APIUrl + "/logout"
}
