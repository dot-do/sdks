/**
 * oauth.do - Type definitions for OAuth authentication
 */

// ============================================================================
// Token Types
// ============================================================================

/**
 * OAuth access token with metadata
 */
export interface Token {
  /** The access token string */
  accessToken: string;
  /** Token type (usually "Bearer") */
  tokenType: 'Bearer' | string;
  /** When the token expires (Unix timestamp in seconds) */
  expiresAt?: number;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Scopes granted to this token */
  scopes?: string[];
  /** Token ID for revocation */
  tokenId?: string;
}

/**
 * Stored credential format
 */
export interface StoredCredential {
  /** The token data */
  token: Token;
  /** When the credential was stored */
  storedAt: number;
  /** Source of the credential */
  source: 'browser' | 'device' | 'api_key' | 'env';
  /** User ID associated with this credential */
  userId?: string;
  /** Workspace/organization ID */
  workspaceId?: string;
}

// ============================================================================
// User Types
// ============================================================================

/**
 * Authenticated user information
 */
export interface User {
  /** Unique user ID */
  id: string;
  /** User's email address */
  email: string;
  /** Display name */
  name?: string;
  /** Profile picture URL */
  avatarUrl?: string;
  /** Email verification status */
  emailVerified: boolean;
  /** Account creation timestamp */
  createdAt: string;
  /** Current workspace/organization */
  workspace?: Workspace;
}

/**
 * Workspace/organization information
 */
export interface Workspace {
  /** Unique workspace ID */
  id: string;
  /** Workspace name */
  name: string;
  /** Workspace slug for URLs */
  slug: string;
  /** User's role in this workspace */
  role: 'owner' | 'admin' | 'member' | 'viewer';
}

// ============================================================================
// Auth Options
// ============================================================================

/**
 * Options for authentication operations
 */
export interface AuthOptions {
  /** OAuth client ID (defaults to DotDo CLI client) */
  clientId?: string;
  /** OAuth scopes to request */
  scopes?: string[];
  /** Custom authorization server URL */
  authServer?: string;
  /** Force re-authentication even if already logged in */
  force?: boolean;
  /** Preferred authentication flow */
  flow?: 'browser' | 'device' | 'auto';
  /** Port for local callback server (browser flow) */
  callbackPort?: number;
  /** Timeout for authentication flow in milliseconds */
  timeout?: number;
  /** Show progress/status messages */
  interactive?: boolean;
  /** Custom state parameter for CSRF protection */
  state?: string;
}

/**
 * Options for token storage
 */
export interface StorageOptions {
  /** Service name for keychain storage */
  serviceName?: string;
  /** Account name for keychain storage */
  accountName?: string;
  /** Custom config directory path */
  configDir?: string;
  /** Disable keychain, use file storage only */
  disableKeychain?: boolean;
}

// ============================================================================
// OAuth Flow Types
// ============================================================================

/**
 * Authorization request parameters
 */
export interface AuthorizationRequest {
  /** Authorization server URL */
  authUrl: string;
  /** Client ID */
  clientId: string;
  /** Requested scopes */
  scopes: string[];
  /** PKCE code verifier */
  codeVerifier: string;
  /** PKCE code challenge */
  codeChallenge: string;
  /** State parameter for CSRF */
  state: string;
  /** Redirect URI */
  redirectUri: string;
}

/**
 * Device authorization response
 */
export interface DeviceAuthorizationResponse {
  /** Device code for polling */
  deviceCode: string;
  /** User code to enter */
  userCode: string;
  /** Verification URL for user */
  verificationUri: string;
  /** Verification URL with code pre-filled */
  verificationUriComplete?: string;
  /** Code expiration time in seconds */
  expiresIn: number;
  /** Polling interval in seconds */
  interval: number;
}

/**
 * Token response from authorization server
 */
export interface TokenResponse {
  /** Access token */
  access_token: string;
  /** Token type */
  token_type: string;
  /** Expiration time in seconds */
  expires_in?: number;
  /** Refresh token */
  refresh_token?: string;
  /** Granted scopes */
  scope?: string;
  /** ID token (OpenID Connect) */
  id_token?: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Authentication error codes
 */
export type AuthErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'REFRESH_FAILED'
  | 'STORAGE_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_GRANT'
  | 'ACCESS_DENIED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN';

/**
 * Authentication error
 */
export class AuthError extends Error {
  /** Error code for programmatic handling */
  readonly code: AuthErrorCode;
  /** HTTP status code if applicable */
  readonly status?: number;
  /** Original error if this wraps another error */
  readonly cause?: Error;

  constructor(message: string, code: AuthErrorCode, options?: { status?: number; cause?: Error }) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Authentication event types
 */
export type AuthEventType =
  | 'login_started'
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'token_refreshed'
  | 'token_expired';

/**
 * Authentication event
 */
export interface AuthEvent {
  type: AuthEventType;
  timestamp: number;
  user?: User;
  error?: AuthError;
}

/**
 * Authentication event listener
 */
export type AuthEventListener = (event: AuthEvent) => void;

// ============================================================================
// Constants
// ============================================================================

/**
 * Default OAuth configuration
 */
export const OAUTH_DEFAULTS = {
  /** Default authorization server */
  authServer: 'https://oauth.do',
  /** Default client ID for CLI */
  clientId: 'dotdo-cli',
  /** Default scopes */
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  /** Default callback port */
  callbackPort: 8787,
  /** Default timeout (5 minutes) */
  timeout: 300000,
  /** Service name for keychain */
  serviceName: 'oauth.do',
  /** Account name for keychain */
  accountName: 'default',
} as const;

/**
 * Environment variable names
 */
export const ENV_VARS = {
  /** Direct token override */
  TOKEN: 'DOTDO_TOKEN',
  /** API key authentication */
  API_KEY: 'DOTDO_API_KEY',
  /** Custom config directory */
  CONFIG_DIR: 'DOTDO_CONFIG_DIR',
  /** Disable keychain storage */
  NO_KEYCHAIN: 'DOTDO_NO_KEYCHAIN',
  /** Custom auth server */
  AUTH_SERVER: 'DOTDO_AUTH_SERVER',
} as const;
