/**
 * oauth.do - Device Code OAuth flow
 *
 * Implements the Device Authorization Grant (RFC 8628) for:
 * - Headless servers
 * - SSH sessions
 * - CI/CD environments
 * - Remote terminals
 */

import type {
  Token,
  AuthOptions,
  DeviceAuthorizationResponse,
  TokenResponse,
} from './types.js';
import { AuthError, OAUTH_DEFAULTS } from './types.js';

// ============================================================================
// Device Authorization
// ============================================================================

/**
 * Request device authorization
 */
async function requestDeviceAuthorization(
  options: AuthOptions = {}
): Promise<DeviceAuthorizationResponse> {
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const clientId = options.clientId || OAUTH_DEFAULTS.clientId;
  const scopes = options.scopes || OAUTH_DEFAULTS.scopes;

  const deviceAuthUrl = `${authServer}/device/code`;

  const body = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(' '),
  });

  const response = await fetch(deviceAuthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AuthError(
      `Device authorization failed: ${error.error_description || error.error || response.statusText}`,
      'NETWORK_ERROR',
      { status: response.status }
    );
  }

  const data = await response.json();

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

// ============================================================================
// Token Polling
// ============================================================================

interface PollOptions {
  authServer: string;
  clientId: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
  timeout: number;
  onPoll?: (attempt: number) => void;
}

/**
 * Poll for token after user authorizes
 */
async function pollForToken(options: PollOptions): Promise<Token> {
  const tokenUrl = `${options.authServer}/token`;
  const startTime = Date.now();
  const expiryTime = startTime + options.expiresIn * 1000;
  const timeoutTime = startTime + options.timeout;
  let attempt = 0;
  let interval = options.interval * 1000;

  while (true) {
    // Check timeout
    const now = Date.now();
    if (now > timeoutTime) {
      throw new AuthError('Authentication timed out', 'TIMEOUT');
    }
    if (now > expiryTime) {
      throw new AuthError('Device code expired', 'TOKEN_EXPIRED');
    }

    // Wait for interval
    await sleep(interval);
    attempt++;
    options.onPoll?.(attempt);

    // Poll for token
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: options.deviceCode,
      client_id: options.clientId,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (response.ok) {
      const tokenResponse: TokenResponse = await response.json();
      return {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || 'Bearer',
        expiresAt: tokenResponse.expires_in
          ? Math.floor(Date.now() / 1000) + tokenResponse.expires_in
          : undefined,
        refreshToken: tokenResponse.refresh_token,
        scopes: tokenResponse.scope?.split(' '),
      };
    }

    // Handle error responses
    const error = await response.json().catch(() => ({ error: 'unknown_error' }));

    switch (error.error) {
      case 'authorization_pending':
        // User hasn't authorized yet, continue polling
        break;

      case 'slow_down':
        // Increase polling interval
        interval += 5000;
        break;

      case 'access_denied':
        throw new AuthError('User denied authorization', 'ACCESS_DENIED');

      case 'expired_token':
        throw new AuthError('Device code expired', 'TOKEN_EXPIRED');

      default:
        throw new AuthError(
          `Token request failed: ${error.error_description || error.error}`,
          'INVALID_GRANT',
          { status: response.status }
        );
    }
  }
}

// ============================================================================
// Device Flow
// ============================================================================

/**
 * Options specific to device flow
 */
export interface DeviceFlowOptions extends AuthOptions {
  /** Callback when polling for token */
  onPoll?: (attempt: number) => void;
  /** Callback when user code is ready */
  onUserCode?: (code: string, verificationUri: string, verificationUriComplete?: string) => void;
}

/**
 * Run the device code OAuth flow
 *
 * This flow is suitable for:
 * - Headless servers
 * - SSH sessions
 * - CI/CD environments
 * - Environments where opening a browser isn't possible
 *
 * @param options - Device flow options
 * @returns Token on successful authentication
 *
 * @example
 * ```ts
 * const token = await deviceFlow({
 *   interactive: true,
 *   onUserCode: (code, uri) => {
 *     console.log(`Enter code ${code} at ${uri}`);
 *   }
 * });
 * ```
 */
export async function deviceFlow(options: DeviceFlowOptions = {}): Promise<Token> {
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const clientId = options.clientId || OAUTH_DEFAULTS.clientId;
  const timeout = options.timeout || OAUTH_DEFAULTS.timeout;

  // Request device authorization
  const deviceAuth = await requestDeviceAuthorization(options);

  // Notify caller of user code
  if (options.onUserCode) {
    options.onUserCode(
      deviceAuth.userCode,
      deviceAuth.verificationUri,
      deviceAuth.verificationUriComplete
    );
  }

  // Display instructions if interactive
  if (options.interactive) {
    displayDeviceCodeInstructions(deviceAuth);
  }

  // Poll for token
  const token = await pollForToken({
    authServer,
    clientId,
    deviceCode: deviceAuth.deviceCode,
    interval: deviceAuth.interval,
    expiresIn: deviceAuth.expiresIn,
    timeout,
    onPoll: options.onPoll,
  });

  if (options.interactive) {
    console.log('\nAuthentication successful!\n');
  }

  return token;
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Display device code instructions to the user
 */
function displayDeviceCodeInstructions(deviceAuth: DeviceAuthorizationResponse): void {
  const boxWidth = 50;
  const line = '-'.repeat(boxWidth);

  console.log('\n' + line);
  console.log('  Device Authentication');
  console.log(line);
  console.log('');
  console.log('  To authenticate, visit:');
  console.log('');
  console.log(`    ${deviceAuth.verificationUri}`);
  console.log('');
  console.log('  And enter the code:');
  console.log('');
  console.log(`    ${formatUserCode(deviceAuth.userCode)}`);
  console.log('');

  if (deviceAuth.verificationUriComplete) {
    console.log('  Or visit this URL directly:');
    console.log('');
    console.log(`    ${deviceAuth.verificationUriComplete}`);
    console.log('');
  }

  const expiresMinutes = Math.floor(deviceAuth.expiresIn / 60);
  console.log(`  Code expires in ${expiresMinutes} minutes.`);
  console.log(line);
  console.log('');
  console.log('  Waiting for authorization...');
}

/**
 * Format user code with spacing for readability
 */
function formatUserCode(code: string): string {
  // Add spacing if code has a dash
  if (code.includes('-')) {
    return code;
  }

  // Add dash to split code in half for readability
  if (code.length >= 6) {
    const mid = Math.floor(code.length / 2);
    return code.slice(0, mid) + '-' + code.slice(mid);
  }

  return code;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if we're in a headless environment
 */
export function isHeadless(): boolean {
  // Check for common headless indicators
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) {
    return true;
  }

  // Check for CI environments
  if (
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL
  ) {
    return true;
  }

  // Check for Docker/container environments
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.container) {
    return true;
  }

  // Check if DISPLAY is missing (Linux)
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }

  return false;
}

/**
 * Check if browser flow is available
 */
export function canUseBrowserFlow(): boolean {
  // Can't use browser in headless environments
  if (isHeadless()) {
    return false;
  }

  // Platform-specific checks
  switch (process.platform) {
    case 'darwin':
    case 'win32':
      return true;

    case 'linux':
      // Need DISPLAY or WAYLAND for GUI
      return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

    default:
      return false;
  }
}
