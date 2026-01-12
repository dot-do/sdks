/**
 * oauth.do - Browser-based OAuth flow
 *
 * Implements the Authorization Code flow with PKCE:
 * 1. Opens browser to authorization URL
 * 2. Starts local HTTP server to receive callback
 * 3. Exchanges authorization code for tokens
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import * as url from 'node:url';

import type {
  Token,
  AuthOptions,
  AuthorizationRequest,
  TokenResponse,
} from './types.js';
import { AuthError, OAUTH_DEFAULTS } from './types.js';

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a cryptographically random code verifier
 */
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier using S256
 */
function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate a random state parameter
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ============================================================================
// Authorization URL
// ============================================================================

/**
 * Build the authorization URL for browser redirect
 */
export function buildAuthorizationUrl(options: AuthOptions = {}): AuthorizationRequest {
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const clientId = options.clientId || OAUTH_DEFAULTS.clientId;
  const scopes = options.scopes || OAUTH_DEFAULTS.scopes;
  const callbackPort = options.callbackPort || OAUTH_DEFAULTS.callbackPort;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = options.state || generateState();
  const redirectUri = `http://localhost:${callbackPort}/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    authUrl: `${authServer}/authorize?${params.toString()}`,
    clientId,
    scopes,
    codeVerifier,
    codeChallenge,
    state,
    redirectUri,
  };
}

// ============================================================================
// Callback Server
// ============================================================================

interface CallbackResult {
  code: string;
  state: string;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
function startCallbackServer(
  port: number,
  expectedState: string,
  timeout: number
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);

      // Only handle /callback
      if (parsedUrl.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const { code, state, error, error_description } = parsedUrl.query;

      // Send response to browser
      res.writeHead(200, { 'Content-Type': 'text/html' });

      if (error) {
        res.end(getErrorHtml(String(error), String(error_description || '')));
        clearTimeout(timeoutId);
        server.close();
        reject(
          new AuthError(
            `Authorization failed: ${error_description || error}`,
            error === 'access_denied' ? 'ACCESS_DENIED' : 'INVALID_GRANT'
          )
        );
        return;
      }

      if (!code || typeof code !== 'string') {
        res.end(getErrorHtml('Missing authorization code', ''));
        clearTimeout(timeoutId);
        server.close();
        reject(new AuthError('Missing authorization code', 'INVALID_GRANT'));
        return;
      }

      if (state !== expectedState) {
        res.end(getErrorHtml('Invalid state parameter', 'CSRF protection triggered'));
        clearTimeout(timeoutId);
        server.close();
        reject(new AuthError('Invalid state parameter - possible CSRF attack', 'INVALID_GRANT'));
        return;
      }

      res.end(getSuccessHtml());
      clearTimeout(timeoutId);
      server.close();
      resolve({ code, state: String(state) });
    });

    server.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(
        new AuthError(`Failed to start callback server: ${err.message}`, 'NETWORK_ERROR', {
          cause: err,
        })
      );
    });

    server.listen(port, '127.0.0.1', () => {
      // Server started successfully
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      server.close();
      reject(new AuthError('Authentication timed out', 'TIMEOUT'));
    }, timeout);
  });
}

// ============================================================================
// Token Exchange
// ============================================================================

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForToken(
  code: string,
  request: AuthorizationRequest,
  authServer: string
): Promise<Token> {
  const tokenUrl = `${authServer}/token`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: request.redirectUri,
    client_id: request.clientId,
    code_verifier: request.codeVerifier,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AuthError(
      `Token exchange failed: ${error.error_description || error.error || response.statusText}`,
      'INVALID_GRANT',
      { status: response.status }
    );
  }

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

// ============================================================================
// Browser Flow
// ============================================================================

/**
 * Run the browser-based OAuth flow
 *
 * @param options - Authentication options
 * @returns Token on successful authentication
 */
export async function browserFlow(options: AuthOptions = {}): Promise<Token> {
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const callbackPort = options.callbackPort || OAUTH_DEFAULTS.callbackPort;
  const timeout = options.timeout || OAUTH_DEFAULTS.timeout;

  // Build authorization request
  const request = buildAuthorizationUrl(options);

  // Start callback server (before opening browser)
  const callbackPromise = startCallbackServer(callbackPort, request.state, timeout);

  // Open browser
  try {
    const open = await import('open');
    await open.default(request.authUrl);
  } catch (err) {
    throw new AuthError(
      'Failed to open browser. Please manually open the following URL:\n' + request.authUrl,
      'NETWORK_ERROR',
      { cause: err as Error }
    );
  }

  if (options.interactive) {
    console.log('\nOpening browser for authentication...');
    console.log(`If the browser doesn't open, visit:\n${request.authUrl}\n`);
  }

  // Wait for callback
  const { code } = await callbackPromise;

  // Exchange code for token
  const token = await exchangeCodeForToken(code, request, authServer);

  return token;
}

// ============================================================================
// HTML Templates
// ============================================================================

function getSuccessHtml(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      color: #1a202c;
      margin-bottom: 0.5rem;
    }
    p {
      color: #718096;
      margin-bottom: 1.5rem;
    }
    .close-hint {
      font-size: 0.875rem;
      color: #a0aec0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10003;</div>
    <h1>Authenticated!</h1>
    <p>You have successfully logged in to DotDo.</p>
    <p class="close-hint">You can close this window and return to your terminal.</p>
  </div>
  <script>
    // Try to close the window after a delay
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>
`;
}

function getErrorHtml(error: string, description: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 400px;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      color: #1a202c;
      margin-bottom: 0.5rem;
    }
    p {
      color: #718096;
      margin-bottom: 1.5rem;
    }
    .error-code {
      font-family: monospace;
      background: #fed7d7;
      color: #c53030;
      padding: 0.5rem 1rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10007;</div>
    <h1>Authentication Failed</h1>
    <p>${description || 'An error occurred during authentication.'}</p>
    <div class="error-code">${error}</div>
  </div>
</body>
</html>
`;
}

// ============================================================================
// Token Refresh
// ============================================================================

/**
 * Refresh an access token using a refresh token
 */
export async function refreshToken(
  token: Token,
  options: AuthOptions = {}
): Promise<Token> {
  if (!token.refreshToken) {
    throw new AuthError('No refresh token available', 'REFRESH_FAILED');
  }

  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const clientId = options.clientId || OAUTH_DEFAULTS.clientId;
  const tokenUrl = `${authServer}/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: clientId,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new AuthError(
      `Token refresh failed: ${error.error_description || error.error || response.statusText}`,
      'REFRESH_FAILED',
      { status: response.status }
    );
  }

  const tokenResponse: TokenResponse = await response.json();

  return {
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || 'Bearer',
    expiresAt: tokenResponse.expires_in
      ? Math.floor(Date.now() / 1000) + tokenResponse.expires_in
      : undefined,
    refreshToken: tokenResponse.refresh_token || token.refreshToken,
    scopes: tokenResponse.scope?.split(' ') || token.scopes,
  };
}

// ============================================================================
// Token Revocation
// ============================================================================

/**
 * Revoke a token (logout)
 */
export async function revokeToken(
  token: Token,
  options: AuthOptions = {}
): Promise<void> {
  const authServer = options.authServer || OAUTH_DEFAULTS.authServer;
  const clientId = options.clientId || OAUTH_DEFAULTS.clientId;
  const revokeUrl = `${authServer}/revoke`;

  const body = new URLSearchParams({
    token: token.accessToken,
    client_id: clientId,
  });

  try {
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    // Revocation can fail silently - token may already be revoked
    if (!response.ok && response.status !== 400) {
      console.warn('Token revocation request failed, but continuing with logout');
    }
  } catch {
    // Network errors during revocation are non-fatal
    console.warn('Could not reach revocation endpoint, but continuing with logout');
  }
}
