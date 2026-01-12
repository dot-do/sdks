/**
 * oauth.do - Core authentication logic
 *
 * This module provides the main authentication API:
 * - ensureLoggedIn() - Check if logged in, prompt if not
 * - getToken() - Get token without prompting
 * - isAuthenticated() - Check auth status
 * - logout() - Clear stored tokens
 * - whoami() - Get current user info
 */

import type {
  Token,
  User,
  AuthOptions,
  StorageOptions,
  AuthEvent,
  AuthEventListener,
} from './types.js';
import { AuthError, OAUTH_DEFAULTS, ENV_VARS } from './types.js';
import { TokenStorage, getStorage, getEnvToken } from './storage.js';
import { browserFlow, refreshToken, revokeToken } from './browser.js';
import { deviceFlow, canUseBrowserFlow, type DeviceFlowOptions } from './device.js';

// ============================================================================
// Event System
// ============================================================================

const eventListeners: Set<AuthEventListener> = new Set();

/**
 * Emit an authentication event
 */
function emitEvent(event: AuthEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  }
}

/**
 * Add an authentication event listener
 */
export function onAuthEvent(listener: AuthEventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Ensure we have a valid token, refreshing if needed
 */
async function ensureValidToken(
  token: Token,
  options: AuthOptions = {},
  storage: TokenStorage
): Promise<Token> {
  // Check if token is expired or about to expire
  if (token.expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 300; // 5 minute buffer

    if (token.expiresAt < now + bufferSeconds) {
      // Try to refresh
      if (token.refreshToken) {
        try {
          const newToken = await refreshToken(token, options);
          await storage.store(newToken, 'browser');
          emitEvent({ type: 'token_refreshed', timestamp: Date.now() });
          return newToken;
        } catch (err) {
          // Refresh failed - token is expired
          emitEvent({
            type: 'token_expired',
            timestamp: Date.now(),
            error: err instanceof AuthError ? err : new AuthError('Token refresh failed', 'REFRESH_FAILED'),
          });
          throw new AuthError(
            'Token expired and refresh failed. Please login again.',
            'TOKEN_EXPIRED',
            { cause: err as Error }
          );
        }
      } else {
        // No refresh token - expired
        throw new AuthError(
          'Token expired. Please login again.',
          'TOKEN_EXPIRED'
        );
      }
    }
  }

  return token;
}

// ============================================================================
// Core Auth Functions
// ============================================================================

/**
 * Ensure the user is logged in
 *
 * If already authenticated, returns the existing token (refreshing if needed).
 * If not authenticated, initiates the appropriate login flow.
 *
 * @param options - Authentication options
 * @returns Valid access token
 *
 * @example
 * ```ts
 * // Basic usage - will prompt for login if needed
 * const token = await ensureLoggedIn();
 *
 * // Force re-authentication
 * const token = await ensureLoggedIn({ force: true });
 *
 * // Prefer device flow for CI environments
 * const token = await ensureLoggedIn({ flow: 'device' });
 * ```
 */
export async function ensureLoggedIn(options: AuthOptions & DeviceFlowOptions = {}): Promise<Token> {
  const storage = getStorage();

  // Check for forced re-authentication
  if (!options.force) {
    // Try to get existing token
    const existingToken = await storage.get();
    if (existingToken) {
      try {
        return await ensureValidToken(existingToken, options, storage);
      } catch (err) {
        // Token is invalid/expired and couldn't refresh - continue to login
        if ((err as AuthError).code !== 'TOKEN_EXPIRED') {
          throw err;
        }
      }
    }
  }

  // Emit login started event
  emitEvent({ type: 'login_started', timestamp: Date.now() });

  // Determine which flow to use
  let token: Token;
  const flow = options.flow || 'auto';

  try {
    if (flow === 'browser' || (flow === 'auto' && canUseBrowserFlow())) {
      token = await browserFlow(options);
    } else {
      token = await deviceFlow(options);
    }

    // Store the token
    await storage.store(token, flow === 'device' ? 'device' : 'browser');

    // Emit success event
    emitEvent({ type: 'login_success', timestamp: Date.now() });

    return token;
  } catch (err) {
    // Emit failure event
    emitEvent({
      type: 'login_failed',
      timestamp: Date.now(),
      error: err instanceof AuthError ? err : new AuthError('Login failed', 'UNKNOWN', { cause: err as Error }),
    });
    throw err;
  }
}

/**
 * Get the current access token without prompting for login
 *
 * @returns Token if authenticated
 * @throws AuthError with code 'NOT_AUTHENTICATED' if not logged in
 *
 * @example
 * ```ts
 * try {
 *   const token = await getToken();
 *   // Use token for API calls
 * } catch (err) {
 *   if (err.code === 'NOT_AUTHENTICATED') {
 *     console.log('Please run: dotdo login');
 *   }
 * }
 * ```
 */
export async function getToken(): Promise<Token> {
  const storage = getStorage();
  const token = await storage.get();

  if (!token) {
    throw new AuthError(
      'Not authenticated. Please login first.',
      'NOT_AUTHENTICATED'
    );
  }

  // Try to ensure token is valid
  try {
    return await ensureValidToken(token, {}, storage);
  } catch (err) {
    // If refresh failed, return the potentially expired token
    // Let the caller handle the 401
    if ((err as AuthError).code === 'TOKEN_EXPIRED' && token.refreshToken) {
      return token;
    }
    throw err;
  }
}

/**
 * Check if the user is currently authenticated
 *
 * @returns true if authenticated with a valid (or refreshable) token
 *
 * @example
 * ```ts
 * if (await isAuthenticated()) {
 *   console.log('Already logged in');
 * } else {
 *   console.log('Please login');
 * }
 * ```
 */
export async function isAuthenticated(): Promise<boolean> {
  const storage = getStorage();
  const token = await storage.get();

  if (!token) {
    return false;
  }

  // Check if token is expired
  if (token.expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    if (token.expiresAt < now) {
      // Expired - but can refresh?
      return !!token.refreshToken;
    }
  }

  return true;
}

/**
 * Logout and clear all stored tokens
 *
 * @param options - Auth options for token revocation
 *
 * @example
 * ```ts
 * await logout();
 * console.log('Logged out successfully');
 * ```
 */
export async function logout(options: AuthOptions = {}): Promise<void> {
  const storage = getStorage();

  // Get current token for revocation
  const token = await storage.get();

  // Revoke token on server (best effort)
  if (token && !getEnvToken()) {
    // Don't revoke env tokens
    await revokeToken(token, options);
  }

  // Clear stored credentials
  await storage.delete();

  // Emit logout event
  emitEvent({ type: 'logout', timestamp: Date.now() });
}

/**
 * Get information about the currently authenticated user
 *
 * @returns User info if authenticated, null otherwise
 *
 * @example
 * ```ts
 * const user = await whoami();
 * if (user) {
 *   console.log(`Logged in as ${user.email}`);
 * } else {
 *   console.log('Not logged in');
 * }
 * ```
 */
export async function whoami(options: AuthOptions = {}): Promise<User | null> {
  const storage = getStorage();
  const token = await storage.get();

  if (!token) {
    return null;
  }

  // Fetch user info from userinfo endpoint
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const userinfoUrl = `${authServer}/userinfo`;

  try {
    const response = await fetch(userinfoUrl, {
      headers: {
        Authorization: `${token.tokenType} ${token.accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token is invalid
        return null;
      }
      throw new AuthError(
        `Failed to fetch user info: ${response.statusText}`,
        'NETWORK_ERROR',
        { status: response.status }
      );
    }

    const data = await response.json();

    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      avatarUrl: data.picture,
      emailVerified: data.email_verified ?? false,
      createdAt: data.created_at,
      workspace: data.workspace
        ? {
            id: data.workspace.id,
            name: data.workspace.name,
            slug: data.workspace.slug,
            role: data.workspace.role,
          }
        : undefined,
    };
  } catch (err) {
    if (err instanceof AuthError) {
      throw err;
    }
    throw new AuthError(
      'Failed to fetch user info',
      'NETWORK_ERROR',
      { cause: err as Error }
    );
  }
}

// ============================================================================
// Additional Utilities
// ============================================================================

/**
 * Get the authorization header for API requests
 *
 * @returns Authorization header value or null if not authenticated
 *
 * @example
 * ```ts
 * const auth = await getAuthHeader();
 * if (auth) {
 *   fetch(url, { headers: { Authorization: auth } });
 * }
 * ```
 */
export async function getAuthHeader(): Promise<string | null> {
  try {
    const token = await getToken();
    return `${token.tokenType} ${token.accessToken}`;
  } catch {
    return null;
  }
}

/**
 * Get storage information
 */
export async function getStorageInfo(): Promise<{
  isAuthenticated: boolean;
  tokenSource: 'env' | 'keychain' | 'file' | 'none';
  tokenPath?: string;
  keychainAvailable: boolean;
  expiresAt?: Date;
  scopes?: string[];
}> {
  const storage = getStorage();
  const storageInfo = await storage.getStorageInfo();
  const credential = await storage.getCredential();

  return {
    isAuthenticated: credential !== null,
    tokenSource: storageInfo.location,
    tokenPath: storageInfo.path,
    keychainAvailable: storageInfo.keychainAvailable,
    expiresAt: credential?.token.expiresAt
      ? new Date(credential.token.expiresAt * 1000)
      : undefined,
    scopes: credential?.token.scopes,
  };
}

/**
 * Login with specific flow (convenience wrapper)
 */
export async function login(options: AuthOptions & DeviceFlowOptions = {}): Promise<Token> {
  return ensureLoggedIn({ ...options, force: true });
}

/**
 * Login with browser flow
 */
export async function loginWithBrowser(options: AuthOptions = {}): Promise<Token> {
  return ensureLoggedIn({ ...options, flow: 'browser', force: true });
}

/**
 * Login with device code flow
 */
export async function loginWithDeviceCode(options: DeviceFlowOptions = {}): Promise<Token> {
  return ensureLoggedIn({ ...options, flow: 'device', force: true });
}
