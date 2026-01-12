/**
 * oauth.do - Token storage with keychain and file fallback
 *
 * Storage priority:
 * 1. Environment variables (DOTDO_TOKEN, DOTDO_API_KEY)
 * 2. System keychain (macOS Keychain, Linux libsecret, Windows Credential Manager)
 * 3. File fallback (~/.config/dotdo/credentials.json)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

import type { Token, StoredCredential, StorageOptions } from './types.js';
import { AuthError, OAUTH_DEFAULTS, ENV_VARS } from './types.js';

// ============================================================================
// Keytar Types (optional dependency)
// ============================================================================

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

let keytarModule: Keytar | null = null;
let keytarLoadAttempted = false;

/**
 * Attempt to load keytar module
 */
async function loadKeytar(): Promise<Keytar | null> {
  if (keytarLoadAttempted) {
    return keytarModule;
  }
  keytarLoadAttempted = true;

  try {
    // Dynamic import to make keytar optional
    keytarModule = await import('keytar');
    return keytarModule;
  } catch {
    // keytar not available - will use file fallback
    return null;
  }
}

// ============================================================================
// Storage Configuration
// ============================================================================

/**
 * Get the configuration directory path
 */
export function getConfigDir(options?: StorageOptions): string {
  // Check environment variable first
  const envDir = process.env[ENV_VARS.CONFIG_DIR];
  if (envDir) {
    return envDir;
  }

  // Use provided option
  if (options?.configDir) {
    return options.configDir;
  }

  // Default: ~/.config/dotdo on Unix, %APPDATA%/dotdo on Windows
  const platform = process.platform;
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'dotdo');
  }

  // XDG Base Directory specification
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'dotdo');
}

/**
 * Get the credentials file path
 */
export function getCredentialsPath(options?: StorageOptions): string {
  return path.join(getConfigDir(options), 'credentials.json');
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(options?: StorageOptions): void {
  const dir = getConfigDir(options);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// ============================================================================
// Environment Variable Storage
// ============================================================================

/**
 * Check for token in environment variables
 */
export function getEnvToken(): Token | null {
  // Direct token override
  const envToken = process.env[ENV_VARS.TOKEN];
  if (envToken) {
    return {
      accessToken: envToken,
      tokenType: 'Bearer',
    };
  }

  // API key authentication
  const apiKey = process.env[ENV_VARS.API_KEY];
  if (apiKey) {
    return {
      accessToken: apiKey,
      tokenType: 'Bearer',
    };
  }

  return null;
}

/**
 * Check if keychain is disabled
 */
function isKeychainDisabled(options?: StorageOptions): boolean {
  if (options?.disableKeychain) {
    return true;
  }
  const envDisable = process.env[ENV_VARS.NO_KEYCHAIN];
  return envDisable === '1' || envDisable === 'true';
}

// ============================================================================
// Keychain Storage
// ============================================================================

/**
 * Get service and account names for keychain
 */
function getKeychainNames(options?: StorageOptions): { service: string; account: string } {
  return {
    service: options?.serviceName || OAUTH_DEFAULTS.serviceName,
    account: options?.accountName || OAUTH_DEFAULTS.accountName,
  };
}

/**
 * Store credential in system keychain
 */
async function storeInKeychain(credential: StoredCredential, options?: StorageOptions): Promise<boolean> {
  if (isKeychainDisabled(options)) {
    return false;
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }

  try {
    const { service, account } = getKeychainNames(options);
    const data = JSON.stringify(credential);
    await keytar.setPassword(service, account, data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get credential from system keychain
 */
async function getFromKeychain(options?: StorageOptions): Promise<StoredCredential | null> {
  if (isKeychainDisabled(options)) {
    return null;
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return null;
  }

  try {
    const { service, account } = getKeychainNames(options);
    const data = await keytar.getPassword(service, account);
    if (!data) {
      return null;
    }
    return JSON.parse(data) as StoredCredential;
  } catch {
    return null;
  }
}

/**
 * Delete credential from system keychain
 */
async function deleteFromKeychain(options?: StorageOptions): Promise<boolean> {
  if (isKeychainDisabled(options)) {
    return false;
  }

  const keytar = await loadKeytar();
  if (!keytar) {
    return false;
  }

  try {
    const { service, account } = getKeychainNames(options);
    return await keytar.deletePassword(service, account);
  } catch {
    return false;
  }
}

// ============================================================================
// File Storage (Fallback)
// ============================================================================

/**
 * Simple encryption for file storage (not as secure as keychain)
 */
function encryptData(data: string): string {
  // Use a machine-specific key derived from hostname and user
  const machineKey = crypto
    .createHash('sha256')
    .update(`${os.hostname()}-${os.userInfo().username}-dotdo`)
    .digest();

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', machineKey, iv);

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    data: encrypted,
  });
}

/**
 * Decrypt file storage data
 */
function decryptData(encrypted: string): string {
  const parsed = JSON.parse(encrypted);
  if (parsed.v !== 1) {
    throw new Error('Unknown encryption version');
  }

  const machineKey = crypto
    .createHash('sha256')
    .update(`${os.hostname()}-${os.userInfo().username}-dotdo`)
    .digest();

  const iv = Buffer.from(parsed.iv, 'base64');
  const authTag = Buffer.from(parsed.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', machineKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(parsed.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Store credential in file
 */
function storeInFile(credential: StoredCredential, options?: StorageOptions): void {
  ensureConfigDir(options);
  const filePath = getCredentialsPath(options);

  const encrypted = encryptData(JSON.stringify(credential));
  fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
}

/**
 * Get credential from file
 */
function getFromFile(options?: StorageOptions): StoredCredential | null {
  const filePath = getCredentialsPath(options);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const encrypted = fs.readFileSync(filePath, 'utf8');
    const decrypted = decryptData(encrypted);
    return JSON.parse(decrypted) as StoredCredential;
  } catch {
    // Corrupted or unreadable file
    return null;
  }
}

/**
 * Delete credential file
 */
function deleteFile(options?: StorageOptions): boolean {
  const filePath = getCredentialsPath(options);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Token Storage API
// ============================================================================

/**
 * Token storage manager
 */
export class TokenStorage {
  private options: StorageOptions;

  constructor(options?: StorageOptions) {
    this.options = options || {};
  }

  /**
   * Store a token
   */
  async store(token: Token, source: StoredCredential['source'] = 'browser'): Promise<void> {
    const credential: StoredCredential = {
      token,
      storedAt: Date.now(),
      source,
    };

    // Try keychain first
    const storedInKeychain = await storeInKeychain(credential, this.options);

    // Always store in file as backup (useful for debugging)
    if (!storedInKeychain) {
      storeInFile(credential, this.options);
    }
  }

  /**
   * Get stored token
   *
   * Priority:
   * 1. Environment variables
   * 2. Keychain
   * 3. File fallback
   */
  async get(): Promise<Token | null> {
    // Check environment first
    const envToken = getEnvToken();
    if (envToken) {
      return envToken;
    }

    // Try keychain
    const keychainCredential = await getFromKeychain(this.options);
    if (keychainCredential) {
      return this.validateAndReturn(keychainCredential);
    }

    // Try file fallback
    const fileCredential = getFromFile(this.options);
    if (fileCredential) {
      return this.validateAndReturn(fileCredential);
    }

    return null;
  }

  /**
   * Get full stored credential with metadata
   */
  async getCredential(): Promise<StoredCredential | null> {
    // Check environment first
    const envToken = getEnvToken();
    if (envToken) {
      return {
        token: envToken,
        storedAt: Date.now(),
        source: 'env',
      };
    }

    // Try keychain
    const keychainCredential = await getFromKeychain(this.options);
    if (keychainCredential) {
      return keychainCredential;
    }

    // Try file fallback
    return getFromFile(this.options);
  }

  /**
   * Delete stored token
   */
  async delete(): Promise<void> {
    // Delete from both keychain and file
    await deleteFromKeychain(this.options);
    deleteFile(this.options);
  }

  /**
   * Check if a token is stored
   */
  async has(): Promise<boolean> {
    const token = await this.get();
    return token !== null;
  }

  /**
   * Check if the stored token is expired
   */
  async isExpired(): Promise<boolean> {
    const credential = await this.getCredential();
    if (!credential) {
      return true;
    }

    const { token } = credential;
    if (!token.expiresAt) {
      return false; // No expiry = never expires
    }

    // Consider expired if within 5 minutes of expiry
    const bufferSeconds = 300;
    return token.expiresAt < Date.now() / 1000 + bufferSeconds;
  }

  /**
   * Get storage location info
   */
  async getStorageInfo(): Promise<{
    location: 'env' | 'keychain' | 'file' | 'none';
    path?: string;
    keychainAvailable: boolean;
  }> {
    const keytar = await loadKeytar();
    const keychainAvailable = keytar !== null && !isKeychainDisabled(this.options);

    // Check environment
    if (getEnvToken()) {
      return { location: 'env', keychainAvailable };
    }

    // Check keychain
    if (keychainAvailable) {
      const keychainCredential = await getFromKeychain(this.options);
      if (keychainCredential) {
        return { location: 'keychain', keychainAvailable };
      }
    }

    // Check file
    const filePath = getCredentialsPath(this.options);
    if (fs.existsSync(filePath)) {
      return { location: 'file', path: filePath, keychainAvailable };
    }

    return { location: 'none', keychainAvailable };
  }

  /**
   * Validate token and return if valid
   */
  private validateAndReturn(credential: StoredCredential): Token | null {
    const { token } = credential;

    // Check if expired
    if (token.expiresAt && token.expiresAt < Date.now() / 1000) {
      // Token is expired but we still return it - caller can try refresh
      // We mark this by checking expiresAt
    }

    return token;
  }
}

// ============================================================================
// Default Instance
// ============================================================================

let defaultStorage: TokenStorage | undefined;

/**
 * Get the default token storage instance
 */
export function getStorage(options?: StorageOptions): TokenStorage {
  if (!defaultStorage || options) {
    defaultStorage = new TokenStorage(options);
  }
  return defaultStorage;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Store a token using default storage
 */
export async function storeToken(token: Token, source?: StoredCredential['source']): Promise<void> {
  return getStorage().store(token, source);
}

/**
 * Get stored token using default storage
 */
export async function getToken(): Promise<Token | null> {
  return getStorage().get();
}

/**
 * Delete stored token using default storage
 */
export async function deleteToken(): Promise<void> {
  return getStorage().delete();
}

/**
 * Check if token is stored using default storage
 */
export async function hasToken(): Promise<boolean> {
  return getStorage().has();
}
