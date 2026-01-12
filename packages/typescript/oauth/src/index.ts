/**
 * oauth.do - OAuth authentication for DotDo CLI and SDK
 *
 * This package provides local CLI authentication with secure token storage.
 *
 * @example Basic Usage
 * ```ts
 * import { ensureLoggedIn, getToken, isAuthenticated, logout, whoami } from 'oauth.do';
 *
 * // Check if logged in, prompt if not
 * const token = await ensureLoggedIn();
 *
 * // Get token without prompting (throws if not logged in)
 * const token = await getToken();
 *
 * // Check auth status
 * if (await isAuthenticated()) {
 *   console.log('Already logged in');
 * }
 *
 * // Get current user info
 * const user = await whoami();
 * console.log(`Logged in as ${user?.email}`);
 *
 * // Logout and clear stored tokens
 * await logout();
 * ```
 *
 * @example Environment Variables
 * ```bash
 * # Direct token override
 * export DOTDO_TOKEN="your-token"
 *
 * # API key authentication
 * export DOTDO_API_KEY="your-api-key"
 *
 * # Custom config directory
 * export DOTDO_CONFIG_DIR="/path/to/config"
 * ```
 *
 * @example Storage Locations
 * - macOS: Keychain via keytar
 * - Linux: libsecret via keytar
 * - Windows: Credential Manager via keytar
 * - Fallback: ~/.config/dotdo/credentials.json
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Auth Functions
// ============================================================================

export {
  // Main auth functions
  ensureLoggedIn,
  getToken,
  isAuthenticated,
  logout,
  whoami,

  // Convenience functions
  login,
  loginWithBrowser,
  loginWithDeviceCode,
  getAuthHeader,
  getStorageInfo,

  // Event system
  onAuthEvent,
} from './auth.js';

// ============================================================================
// Storage
// ============================================================================

export {
  // Storage class
  TokenStorage,
  getStorage,

  // Convenience functions
  storeToken,
  getToken as getStoredToken,
  deleteToken,
  hasToken,

  // Configuration
  getConfigDir,
  getCredentialsPath,
  getEnvToken,
} from './storage.js';

// ============================================================================
// OAuth Flows
// ============================================================================

export {
  // Browser flow
  browserFlow,
  buildAuthorizationUrl,
  refreshToken,
  revokeToken,
} from './browser.js';

export {
  // Device code flow
  deviceFlow,
  isHeadless,
  canUseBrowserFlow,
  type DeviceFlowOptions,
} from './device.js';

// ============================================================================
// Types
// ============================================================================

export type {
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
  AuthEventListener,
} from './types.js';

export {
  // Error class
  AuthError,

  // Constants
  OAUTH_DEFAULTS,
  ENV_VARS,
} from './types.js';
