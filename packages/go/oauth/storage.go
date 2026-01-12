package oauth

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	// KeyringService is the service name used for keyring storage.
	KeyringService = "oauth.do"

	// KeyringAccount is the account name used for keyring storage.
	KeyringAccount = "access_token"
)

// KeyringStorage stores tokens securely in the system keyring.
// - macOS: Keychain
// - Windows: Credential Manager
// - Linux: Secret Service (libsecret)
type KeyringStorage struct {
	service string
	account string
}

// NewKeyringStorage creates a new keyring-based token storage.
func NewKeyringStorage() *KeyringStorage {
	return &KeyringStorage{
		service: KeyringService,
		account: KeyringAccount,
	}
}

// GetToken retrieves the stored access token from the keyring.
func (k *KeyringStorage) GetToken() (string, error) {
	data, err := k.GetTokenData()
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	return data.AccessToken, nil
}

// SetToken stores an access token in the keyring.
func (k *KeyringStorage) SetToken(token string) error {
	return k.SetTokenData(&StoredTokenData{AccessToken: token})
}

// RemoveToken deletes the stored token from the keyring.
func (k *KeyringStorage) RemoveToken() error {
	err := keyring.Delete(k.service, k.account)
	if err != nil && err != keyring.ErrNotFound {
		return fmt.Errorf("failed to delete token from keyring: %w", err)
	}
	return nil
}

// GetTokenData retrieves the full stored token data from the keyring.
func (k *KeyringStorage) GetTokenData() (*StoredTokenData, error) {
	secret, err := keyring.Get(k.service, k.account)
	if err != nil {
		if err == keyring.ErrNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get token from keyring: %w", err)
	}

	// Try to parse as JSON (new format)
	var data StoredTokenData
	if err := json.Unmarshal([]byte(secret), &data); err != nil {
		// Legacy plain token format
		return &StoredTokenData{AccessToken: secret}, nil
	}

	return &data, nil
}

// SetTokenData stores the full token data in the keyring.
func (k *KeyringStorage) SetTokenData(data *StoredTokenData) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal token data: %w", err)
	}

	if err := keyring.Set(k.service, k.account, string(jsonData)); err != nil {
		return fmt.Errorf("failed to save token to keyring: %w", err)
	}

	return nil
}

// IsAvailable checks if keyring storage is available on this system.
func (k *KeyringStorage) IsAvailable() bool {
	// Try a read operation to verify keyring access
	_, err := keyring.Get(k.service, "__test__")
	// ErrNotFound is fine - means keyring is working
	// Any other error means keyring is not available
	return err == nil || err == keyring.ErrNotFound
}

// FileStorage stores tokens in a file with restricted permissions.
// This is the fallback when keyring is not available.
type FileStorage struct {
	path      string
	mu        sync.RWMutex
	tokenPath string
	configDir string
}

// NewFileStorage creates a new file-based token storage.
// The path can contain ~ which will be expanded to the home directory.
func NewFileStorage(customPath string) *FileStorage {
	path := customPath
	if path == "" {
		path = DefaultStoragePath
	}

	// Expand ~ to home directory
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err == nil {
			path = filepath.Join(home, path[2:])
		}
	}

	return &FileStorage{
		path:      path,
		tokenPath: path,
		configDir: filepath.Dir(path),
	}
}

// GetToken retrieves the stored access token from the file.
func (f *FileStorage) GetToken() (string, error) {
	data, err := f.GetTokenData()
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	return data.AccessToken, nil
}

// SetToken stores an access token in the file.
func (f *FileStorage) SetToken(token string) error {
	return f.SetTokenData(&StoredTokenData{AccessToken: strings.TrimSpace(token)})
}

// RemoveToken deletes the stored token file.
func (f *FileStorage) RemoveToken() error {
	f.mu.Lock()
	defer f.mu.Unlock()

	err := os.Remove(f.tokenPath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove token file: %w", err)
	}
	return nil
}

// GetTokenData retrieves the full stored token data from the file.
func (f *FileStorage) GetTokenData() (*StoredTokenData, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()

	content, err := os.ReadFile(f.tokenPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read token file: %w", err)
	}

	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		return nil, nil
	}

	// Try to parse as JSON (new format)
	if strings.HasPrefix(trimmed, "{") {
		var data StoredTokenData
		if err := json.Unmarshal([]byte(trimmed), &data); err != nil {
			return nil, fmt.Errorf("failed to parse token data: %w", err)
		}
		return &data, nil
	}

	// Legacy plain token format
	return &StoredTokenData{AccessToken: trimmed}, nil
}

// SetTokenData stores the full token data in the file.
func (f *FileStorage) SetTokenData(data *StoredTokenData) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	// Create config directory with restricted permissions
	if err := os.MkdirAll(f.configDir, 0700); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal token data: %w", err)
	}

	// Write file with restricted permissions (0600)
	if err := os.WriteFile(f.tokenPath, jsonData, 0600); err != nil {
		return fmt.Errorf("failed to write token file: %w", err)
	}

	// Ensure permissions are correct (in case file already existed)
	if err := os.Chmod(f.tokenPath, 0600); err != nil {
		if IsDebug() {
			fmt.Fprintf(os.Stderr, "Warning: failed to set token file permissions: %v\n", err)
		}
	}

	return nil
}

// GetStorageInfo returns information about the storage backend.
func (f *FileStorage) GetStorageInfo() (storageType string, secure bool, path string) {
	return "file", true, f.tokenPath
}

// MemoryStorage stores tokens in memory (for testing).
type MemoryStorage struct {
	data *StoredTokenData
	mu   sync.RWMutex
}

// NewMemoryStorage creates a new in-memory token storage.
func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{}
}

// GetToken retrieves the stored access token from memory.
func (m *MemoryStorage) GetToken() (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.data == nil {
		return "", nil
	}
	return m.data.AccessToken, nil
}

// SetToken stores an access token in memory.
func (m *MemoryStorage) SetToken(token string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data = &StoredTokenData{AccessToken: token}
	return nil
}

// RemoveToken deletes the stored token from memory.
func (m *MemoryStorage) RemoveToken() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data = nil
	return nil
}

// GetTokenData retrieves the full stored token data from memory.
func (m *MemoryStorage) GetTokenData() (*StoredTokenData, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.data, nil
}

// SetTokenData stores the full token data in memory.
func (m *MemoryStorage) SetTokenData(data *StoredTokenData) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data = data
	return nil
}

// SecureStorage is a composite storage that tries keyring first,
// then falls back to file storage.
type SecureStorage struct {
	keyring     *KeyringStorage
	file        *FileStorage
	preferFile  bool
	initialized bool
	mu          sync.RWMutex
}

// CreateSecureStorage creates a secure token storage.
// It tries to use the system keyring first, then falls back to file storage.
// The storagePath parameter is optional and specifies a custom file path.
func CreateSecureStorage(storagePath string) TokenStorage {
	return &SecureStorage{
		keyring:    NewKeyringStorage(),
		file:       NewFileStorage(storagePath),
		preferFile: true, // Default to file to avoid macOS keychain popups
	}
}

// GetToken retrieves the stored access token.
func (s *SecureStorage) GetToken() (string, error) {
	data, err := s.GetTokenData()
	if err != nil {
		return "", err
	}
	if data == nil {
		return "", nil
	}
	return data.AccessToken, nil
}

// SetToken stores an access token.
func (s *SecureStorage) SetToken(token string) error {
	return s.SetTokenData(&StoredTokenData{AccessToken: token})
}

// RemoveToken deletes the stored token from all backends.
func (s *SecureStorage) RemoveToken() error {
	// Remove from both to ensure complete cleanup
	_ = s.keyring.RemoveToken()
	return s.file.RemoveToken()
}

// GetTokenData retrieves the full stored token data.
func (s *SecureStorage) GetTokenData() (*StoredTokenData, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Try file storage first (preferred to avoid keychain popups)
	if data, err := s.file.GetTokenData(); err == nil && data != nil {
		return data, nil
	}

	// Try keyring as fallback
	if data, err := s.keyring.GetTokenData(); err == nil && data != nil {
		return data, nil
	}

	return nil, nil
}

// SetTokenData stores the full token data.
func (s *SecureStorage) SetTokenData(data *StoredTokenData) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Use file storage by default (to avoid keychain popups on macOS)
	if s.preferFile {
		return s.file.SetTokenData(data)
	}

	// Try keyring first
	if s.keyring.IsAvailable() {
		if err := s.keyring.SetTokenData(data); err == nil {
			return nil
		}
	}

	// Fall back to file storage
	return s.file.SetTokenData(data)
}

// GetStorageInfo returns information about the current storage backend.
func (s *SecureStorage) GetStorageInfo() (storageType string, secure bool, path string) {
	if !s.preferFile && s.keyring.IsAvailable() {
		return "keyring", true, ""
	}
	return s.file.GetStorageInfo()
}

// defaultStorage is the package-level default storage instance.
var (
	defaultStorage     TokenStorage
	defaultStorageOnce sync.Once
)

// getDefaultStorage returns the default storage instance.
func getDefaultStorage() TokenStorage {
	defaultStorageOnce.Do(func() {
		config := GetConfig()
		defaultStorage = CreateSecureStorage(config.StoragePath)
	})
	return defaultStorage
}

// SetDefaultStorage sets the default storage instance (for testing).
func SetDefaultStorage(storage TokenStorage) {
	defaultStorage = storage
}
