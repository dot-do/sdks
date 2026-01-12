//! Token storage implementations for OAuth.do
//!
//! This module provides secure token storage using the OS keychain
//! with fallback to file-based storage.

use crate::types::StoredTokenData;
use anyhow::{anyhow, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

/// Keychain service and account identifiers
const KEYCHAIN_SERVICE: &str = "oauth.do";
const KEYCHAIN_ACCOUNT: &str = "access_token";

/// Token storage trait
pub trait TokenStorage: Send + Sync {
    /// Get the stored access token
    fn get_token(&self) -> Result<Option<String>>;

    /// Store an access token
    fn set_token(&self, token: &str) -> Result<()>;

    /// Remove the stored token
    fn remove_token(&self) -> Result<()>;

    /// Get full token data (with refresh token and expiration)
    fn get_token_data(&self) -> Result<Option<StoredTokenData>>;

    /// Store full token data
    fn set_token_data(&self, data: &StoredTokenData) -> Result<()>;
}

/// Keyring-based token storage using OS credential manager
///
/// - macOS: Keychain
/// - Windows: Credential Manager
/// - Linux: Secret Service (libsecret)
///
/// This is the most secure option for CLI token storage.
pub struct KeyringStorage {
    service: String,
    account: String,
}

impl KeyringStorage {
    /// Create a new keyring storage instance
    pub fn new() -> Self {
        Self {
            service: KEYCHAIN_SERVICE.to_string(),
            account: KEYCHAIN_ACCOUNT.to_string(),
        }
    }

    /// Check if keyring storage is available
    pub fn is_available(&self) -> bool {
        let entry = keyring::Entry::new(&self.service, "__test__");
        match entry {
            Ok(e) => {
                // Try to access the keyring to verify it's working
                match e.get_password() {
                    Ok(_) => true,
                    Err(keyring::Error::NoEntry) => true,
                    Err(_) => false,
                }
            }
            Err(_) => false,
        }
    }

    fn get_entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| anyhow!("Failed to create keyring entry: {}", e))
    }
}

impl Default for KeyringStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStorage for KeyringStorage {
    fn get_token(&self) -> Result<Option<String>> {
        let data = self.get_token_data()?;
        Ok(data.map(|d| d.access_token))
    }

    fn set_token(&self, token: &str) -> Result<()> {
        self.set_token_data(&StoredTokenData {
            access_token: token.to_string(),
            refresh_token: None,
            expires_at: None,
        })
    }

    fn remove_token(&self) -> Result<()> {
        let entry = self.get_entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
            Err(e) => Err(anyhow!("Failed to remove token from keyring: {}", e)),
        }
    }

    fn get_token_data(&self) -> Result<Option<StoredTokenData>> {
        let entry = self.get_entry()?;
        match entry.get_password() {
            Ok(json_str) => {
                // Try to parse as JSON (new format)
                if json_str.trim().starts_with('{') {
                    let data: StoredTokenData = serde_json::from_str(&json_str)
                        .map_err(|e| anyhow!("Failed to parse token data: {}", e))?;
                    Ok(Some(data))
                } else {
                    // Legacy plain token format
                    Ok(Some(StoredTokenData {
                        access_token: json_str.trim().to_string(),
                        refresh_token: None,
                        expires_at: None,
                    }))
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow!("Failed to get token from keyring: {}", e)),
        }
    }

    fn set_token_data(&self, data: &StoredTokenData) -> Result<()> {
        let entry = self.get_entry()?;
        let json_str =
            serde_json::to_string(data).map_err(|e| anyhow!("Failed to serialize token data: {}", e))?;
        entry
            .set_password(&json_str)
            .map_err(|e| anyhow!("Failed to save token to keyring: {}", e))
    }
}

/// Secure file-based token storage
///
/// Stores token in ~/.oauth.do/token with restricted permissions (0600).
/// This is the fallback when keyring is not available.
pub struct FileStorage {
    token_path: PathBuf,
    config_dir: PathBuf,
}

impl FileStorage {
    /// Create a new file storage instance with the default path
    pub fn new() -> Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not determine home directory"))?;
        let config_dir = home.join(".oauth.do");
        let token_path = config_dir.join("token");

        Ok(Self {
            token_path,
            config_dir,
        })
    }

    /// Create a new file storage instance with a custom path
    pub fn with_path(path: &str) -> Result<Self> {
        let expanded_path = if path.starts_with("~/") {
            let home = dirs::home_dir().ok_or_else(|| anyhow!("Could not determine home directory"))?;
            home.join(&path[2..])
        } else {
            PathBuf::from(path)
        };

        let config_dir = expanded_path
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        Ok(Self {
            token_path: expanded_path,
            config_dir,
        })
    }

    /// Get the token file path
    pub fn get_path(&self) -> &PathBuf {
        &self.token_path
    }

    /// Ensure the config directory exists with secure permissions
    fn ensure_dir(&self) -> Result<()> {
        if !self.config_dir.exists() {
            fs::create_dir_all(&self.config_dir)?;
            // Set directory permissions to 0700 (owner only)
            #[cfg(unix)]
            {
                let mut perms = fs::metadata(&self.config_dir)?.permissions();
                perms.set_mode(0o700);
                fs::set_permissions(&self.config_dir, perms)?;
            }
        }
        Ok(())
    }

    /// Set secure file permissions (0600)
    #[cfg(unix)]
    fn set_secure_permissions(&self) -> Result<()> {
        let mut perms = fs::metadata(&self.token_path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&self.token_path, perms)?;
        Ok(())
    }

    #[cfg(not(unix))]
    fn set_secure_permissions(&self) -> Result<()> {
        // On Windows, file permissions work differently
        Ok(())
    }
}

impl Default for FileStorage {
    fn default() -> Self {
        Self::new().expect("Failed to create file storage")
    }
}

impl TokenStorage for FileStorage {
    fn get_token(&self) -> Result<Option<String>> {
        let data = self.get_token_data()?;
        Ok(data.map(|d| d.access_token))
    }

    fn set_token(&self, token: &str) -> Result<()> {
        self.set_token_data(&StoredTokenData {
            access_token: token.to_string(),
            refresh_token: None,
            expires_at: None,
        })
    }

    fn remove_token(&self) -> Result<()> {
        if self.token_path.exists() {
            fs::remove_file(&self.token_path)?;
        }
        Ok(())
    }

    fn get_token_data(&self) -> Result<Option<StoredTokenData>> {
        if !self.token_path.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&self.token_path)?;
        let trimmed = content.trim();

        if trimmed.is_empty() {
            return Ok(None);
        }

        // Check if it's JSON format
        if trimmed.starts_with('{') {
            let data: StoredTokenData = serde_json::from_str(trimmed)?;
            Ok(Some(data))
        } else {
            // Legacy plain text format
            Ok(Some(StoredTokenData {
                access_token: trimmed.to_string(),
                refresh_token: None,
                expires_at: None,
            }))
        }
    }

    fn set_token_data(&self, data: &StoredTokenData) -> Result<()> {
        self.ensure_dir()?;
        let json_str = serde_json::to_string(data)?;
        fs::write(&self.token_path, json_str)?;
        self.set_secure_permissions()?;
        Ok(())
    }
}

/// In-memory token storage (for testing)
pub struct MemoryStorage {
    data: std::sync::RwLock<Option<StoredTokenData>>,
}

impl MemoryStorage {
    /// Create a new in-memory storage instance
    pub fn new() -> Self {
        Self {
            data: std::sync::RwLock::new(None),
        }
    }
}

impl Default for MemoryStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStorage for MemoryStorage {
    fn get_token(&self) -> Result<Option<String>> {
        let guard = self.data.read().unwrap();
        Ok(guard.as_ref().map(|d| d.access_token.clone()))
    }

    fn set_token(&self, token: &str) -> Result<()> {
        let mut guard = self.data.write().unwrap();
        *guard = Some(StoredTokenData {
            access_token: token.to_string(),
            refresh_token: None,
            expires_at: None,
        });
        Ok(())
    }

    fn remove_token(&self) -> Result<()> {
        let mut guard = self.data.write().unwrap();
        *guard = None;
        Ok(())
    }

    fn get_token_data(&self) -> Result<Option<StoredTokenData>> {
        let guard = self.data.read().unwrap();
        Ok(guard.clone())
    }

    fn set_token_data(&self, data: &StoredTokenData) -> Result<()> {
        let mut guard = self.data.write().unwrap();
        *guard = Some(data.clone());
        Ok(())
    }
}

/// Storage type enum for runtime selection
pub enum SecureStorage {
    Keyring(KeyringStorage),
    File(FileStorage),
    Memory(MemoryStorage),
}

impl TokenStorage for SecureStorage {
    fn get_token(&self) -> Result<Option<String>> {
        match self {
            SecureStorage::Keyring(s) => s.get_token(),
            SecureStorage::File(s) => s.get_token(),
            SecureStorage::Memory(s) => s.get_token(),
        }
    }

    fn set_token(&self, token: &str) -> Result<()> {
        match self {
            SecureStorage::Keyring(s) => s.set_token(token),
            SecureStorage::File(s) => s.set_token(token),
            SecureStorage::Memory(s) => s.set_token(token),
        }
    }

    fn remove_token(&self) -> Result<()> {
        match self {
            SecureStorage::Keyring(s) => s.remove_token(),
            SecureStorage::File(s) => s.remove_token(),
            SecureStorage::Memory(s) => s.remove_token(),
        }
    }

    fn get_token_data(&self) -> Result<Option<StoredTokenData>> {
        match self {
            SecureStorage::Keyring(s) => s.get_token_data(),
            SecureStorage::File(s) => s.get_token_data(),
            SecureStorage::Memory(s) => s.get_token_data(),
        }
    }

    fn set_token_data(&self, data: &StoredTokenData) -> Result<()> {
        match self {
            SecureStorage::Keyring(s) => s.set_token_data(data),
            SecureStorage::File(s) => s.set_token_data(data),
            SecureStorage::Memory(s) => s.set_token_data(data),
        }
    }
}

impl SecureStorage {
    /// Get the storage type name
    pub fn storage_type(&self) -> &'static str {
        match self {
            SecureStorage::Keyring(_) => "keyring",
            SecureStorage::File(_) => "file",
            SecureStorage::Memory(_) => "memory",
        }
    }

    /// Check if this is file storage and get the path
    pub fn file_path(&self) -> Option<&PathBuf> {
        match self {
            SecureStorage::File(s) => Some(s.get_path()),
            _ => None,
        }
    }
}

/// Create secure storage with automatic backend selection
///
/// Tries keyring first, then falls back to secure file storage.
/// Uses custom path if provided, otherwise defaults to ~/.oauth.do/token.
pub fn create_secure_storage(storage_path: Option<&str>) -> SecureStorage {
    // Try keyring first (disabled by default to avoid popup issues on macOS)
    // To use keyring, set OAUTH_USE_KEYRING=true
    if std::env::var("OAUTH_USE_KEYRING").map(|v| v == "true").unwrap_or(false) {
        let keyring = KeyringStorage::new();
        if keyring.is_available() {
            return SecureStorage::Keyring(keyring);
        }
    }

    // Fall back to file storage
    match storage_path {
        Some(path) => {
            FileStorage::with_path(path)
                .map(SecureStorage::File)
                .unwrap_or_else(|_| SecureStorage::Memory(MemoryStorage::new()))
        }
        None => FileStorage::new()
            .map(SecureStorage::File)
            .unwrap_or_else(|_| SecureStorage::Memory(MemoryStorage::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_storage() {
        let storage = MemoryStorage::new();

        // Initially empty
        assert!(storage.get_token().unwrap().is_none());

        // Set token
        storage.set_token("test_token").unwrap();
        assert_eq!(storage.get_token().unwrap().unwrap(), "test_token");

        // Remove token
        storage.remove_token().unwrap();
        assert!(storage.get_token().unwrap().is_none());
    }

    #[test]
    fn test_memory_storage_full_data() {
        let storage = MemoryStorage::new();

        let data = StoredTokenData {
            access_token: "access".to_string(),
            refresh_token: Some("refresh".to_string()),
            expires_at: Some(1234567890000),
        };

        storage.set_token_data(&data).unwrap();

        let retrieved = storage.get_token_data().unwrap().unwrap();
        assert_eq!(retrieved.access_token, "access");
        assert_eq!(retrieved.refresh_token.unwrap(), "refresh");
        assert_eq!(retrieved.expires_at.unwrap(), 1234567890000);
    }
}
