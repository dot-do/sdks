import { ConnectOptions, RpcClient } from 'rpc.do';
export { CapabilityError, CapnwebError, ConnectOptions, ConnectionError, RpcClient, RpcError, TimeoutError, connect as connectRpc } from 'rpc.do';
import { DotDoOptions, DotDo, $, RpcProxy } from 'platform.do';
export { $, DotDo, DotDoOptions, PoolTimeoutError, RpcProxy, connect } from 'platform.do';

/**
 * OAuth configuration options
 */
interface OAuthConfig {
    /**
     * Base URL for API endpoints
     * @default 'https://apis.do'
     */
    apiUrl?: string;
    /**
     * Client ID for OAuth flow
     */
    clientId?: string;
    /**
     * AuthKit domain for device authorization
     * @default 'login.oauth.do'
     */
    authKitDomain?: string;
    /**
     * Custom fetch implementation
     */
    fetch?: typeof fetch;
    /**
     * Custom path for token storage
     * Supports ~ for home directory (e.g., '~/.studio/tokens.json')
     * @default '~/.oauth.do/token'
     */
    storagePath?: string;
}
/**
 * User information returned from auth endpoints
 */
interface User {
    id: string;
    email?: string;
    name?: string;
    [key: string]: any;
}
/**
 * Authentication result
 */
interface AuthResult {
    user: User | null;
    token?: string;
}
/**
 * Device authorization response
 */
interface DeviceAuthorizationResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
}
/**
 * Token response
 */
interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in?: number;
    user?: User;
}
/**
 * Token polling error types
 */
type TokenError = 'authorization_pending' | 'slow_down' | 'access_denied' | 'expired_token' | 'unknown';
/**
 * Stored token data including refresh token and expiration
 */
interface StoredTokenData {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
}
/**
 * Token storage interface
 */
interface TokenStorage {
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
    getTokenData?(): Promise<StoredTokenData | null>;
    setTokenData?(data: StoredTokenData): Promise<void>;
}

/**
 * Get current authenticated user
 * Calls GET /me endpoint
 *
 * @param token - Optional authentication token (will use DO_TOKEN env var if not provided)
 * @returns Authentication result with user info or null if not authenticated
 */
declare function getUser(token?: string): Promise<AuthResult>;
/**
 * Initiate login flow
 * Calls POST /login endpoint
 *
 * @param credentials - Login credentials (email, password, etc.)
 * @returns Authentication result with user info and token
 */
declare function login(credentials: {
    email?: string;
    password?: string;
    [key: string]: any;
}): Promise<AuthResult>;
/**
 * Logout current user
 * Calls POST /logout endpoint
 *
 * @param token - Optional authentication token (will use DO_TOKEN env var if not provided)
 */
declare function logout(token?: string): Promise<void>;
/**
 * Get token from environment or stored credentials
 *
 * Checks in order:
 * 1. globalThis.DO_ADMIN_TOKEN / DO_TOKEN (Workers legacy)
 * 2. process.env.DO_ADMIN_TOKEN / DO_TOKEN (Node.js)
 * 3. cloudflare:workers env import (Workers 2025+) - supports secrets store bindings
 * 4. Stored token (keychain/secure file) - with automatic refresh if expired
 *
 * @see https://developers.cloudflare.com/changelog/2025-03-17-importable-env/
 */
declare function getToken(): Promise<string | null>;
/**
 * Check if user is authenticated (has valid token)
 */
declare function isAuthenticated(token?: string): Promise<boolean>;
/**
 * Auth provider function type for HTTP clients
 */
type AuthProvider = () => string | null | undefined | Promise<string | null | undefined>;
/**
 * Create an auth provider function for HTTP clients (apis.do, rpc.do)
 * Returns a function that resolves to a token string
 *
 * @example
 * import { auth } from 'oauth.do'
 * const getAuth = auth()
 * const token = await getAuth()
 */
declare function auth(): AuthProvider;
/**
 * Build OAuth authorization URL
 *
 * @example
 * const url = buildAuthUrl({
 *   redirectUri: 'https://myapp.com/callback',
 *   scope: 'openid profile email',
 * })
 */
declare function buildAuthUrl(options: {
    redirectUri: string;
    scope?: string;
    state?: string;
    responseType?: string;
    clientId?: string;
    authDomain?: string;
}): string;

/**
 * Configure OAuth settings
 */
declare function configure(config: OAuthConfig): void;
/**
 * Get current configuration
 */
declare function getConfig(): Omit<Required<OAuthConfig>, 'storagePath'> & Pick<OAuthConfig, 'storagePath'>;

/**
 * OAuth provider options for direct provider login
 * Bypasses AuthKit login screen and goes directly to the provider
 */
type OAuthProvider = 'GitHubOAuth' | 'GoogleOAuth' | 'MicrosoftOAuth' | 'AppleOAuth';
interface DeviceAuthOptions {
    /** OAuth provider to use directly (bypasses AuthKit login screen) */
    provider?: OAuthProvider;
}
/**
 * Initiate device authorization flow
 * Following OAuth 2.0 Device Authorization Grant (RFC 8628)
 *
 * @param options - Optional settings including provider for direct OAuth
 * @returns Device authorization response with codes and URIs
 */
declare function authorizeDevice(options?: DeviceAuthOptions): Promise<DeviceAuthorizationResponse>;
/**
 * Poll for tokens after device authorization
 *
 * This function implements the polling loop for OAuth 2.0 Device Authorization Grant (RFC 8628).
 * It includes careful timing logic to avoid race conditions where the timeout could be exceeded
 * due to the sleep interval.
 *
 * @param deviceCode - Device code from authorization response
 * @param interval - Polling interval in seconds (default: 5)
 * @param expiresIn - Expiration time in seconds (default: 600)
 * @returns Token response with access token and user info
 */
declare function pollForTokens(deviceCode: string, interval?: number, expiresIn?: number): Promise<TokenResponse>;

/**
 * GitHub Device Flow implementation
 * Following OAuth 2.0 Device Authorization Grant (RFC 8628)
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */
interface GitHubDeviceFlowOptions {
    /** GitHub OAuth App client ID */
    clientId: string;
    /** OAuth scopes (default: 'user:email read:user') */
    scope?: string;
    /** Custom fetch implementation */
    fetch?: typeof fetch;
}
interface GitHubDeviceAuthResponse {
    /** Device verification code */
    deviceCode: string;
    /** User verification code to display */
    userCode: string;
    /** Verification URI for user to visit */
    verificationUri: string;
    /** Expiration time in seconds */
    expiresIn: number;
    /** Polling interval in seconds */
    interval: number;
}
interface GitHubTokenResponse {
    /** Access token for GitHub API */
    accessToken: string;
    /** Token type (typically 'bearer') */
    tokenType: string;
    /** Granted scopes */
    scope: string;
}
interface GitHubUser {
    /** Numeric GitHub user ID (critical for sqid generation) */
    id: number;
    /** GitHub username */
    login: string;
    /** User's email (may be null if not public) */
    email: string | null;
    /** User's display name */
    name: string | null;
    /** Avatar image URL */
    avatarUrl: string;
}
/**
 * Start GitHub Device Flow
 *
 * Initiates device authorization flow by requesting device and user codes.
 *
 * @param options - Client ID, scope, and optional custom fetch
 * @returns Device authorization response with codes and URIs
 *
 * @example
 * ```ts
 * const auth = await startGitHubDeviceFlow({
 *   clientId: 'Ov23liABCDEFGHIJKLMN',
 *   scope: 'user:email read:user'
 * })
 *
 * console.log(`Visit ${auth.verificationUri} and enter code: ${auth.userCode}`)
 * ```
 */
declare function startGitHubDeviceFlow(options: GitHubDeviceFlowOptions): Promise<GitHubDeviceAuthResponse>;
/**
 * Poll GitHub Device Flow for access token
 *
 * Polls GitHub's token endpoint until user completes authorization.
 * Handles all error states including authorization_pending, slow_down, etc.
 *
 * @param deviceCode - Device code from startGitHubDeviceFlow
 * @param options - Client ID and optional custom fetch
 * @returns Token response with access token
 *
 * @example
 * ```ts
 * const auth = await startGitHubDeviceFlow({ clientId: '...' })
 * // User completes authorization...
 * const token = await pollGitHubDeviceFlow(auth.deviceCode, {
 *   clientId: '...',
 *   interval: auth.interval,
 *   expiresIn: auth.expiresIn
 * })
 * console.log('Access token:', token.accessToken)
 * ```
 */
declare function pollGitHubDeviceFlow(deviceCode: string, options: GitHubDeviceFlowOptions & {
    interval?: number;
    expiresIn?: number;
}): Promise<GitHubTokenResponse>;
/**
 * Get GitHub user information
 *
 * Fetches authenticated user's profile from GitHub API.
 *
 * @param accessToken - GitHub access token
 * @param options - Optional custom fetch implementation
 * @returns GitHub user profile
 *
 * @example
 * ```ts
 * const user = await getGitHubUser(token.accessToken)
 * console.log(`Logged in as ${user.login} (ID: ${user.id})`)
 * ```
 */
declare function getGitHubUser(accessToken: string, options?: {
    fetch?: typeof fetch;
}): Promise<GitHubUser>;

/**
 * Keychain-based token storage using OS credential manager
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (libsecret)
 *
 * This is the most secure option for CLI token storage.
 */
declare class KeychainTokenStorage implements TokenStorage {
    private keytar;
    private initialized;
    /**
     * Lazily load keytar module
     * Returns null if keytar is not available (e.g., missing native dependencies)
     */
    private getKeytar;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
    /**
     * Check if keychain storage is available on this system
     */
    isAvailable(): Promise<boolean>;
}
/**
 * Secure file-based token storage for CLI
 * Stores token in ~/.oauth.do/token with restricted permissions (0600)
 *
 * This is the default storage for Node.js CLI because it doesn't require
 * GUI authorization popups like the keychain does on macOS.
 * Only works in Node.js environment.
 */
declare class SecureFileTokenStorage implements TokenStorage {
    private tokenPath;
    private configDir;
    private initialized;
    private customPath?;
    constructor(customPath?: string);
    private init;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    getTokenData(): Promise<StoredTokenData | null>;
    setTokenData(data: StoredTokenData): Promise<void>;
    removeToken(): Promise<void>;
    /**
     * Get information about the storage backend
     */
    getStorageInfo(): Promise<{
        type: 'file';
        secure: boolean;
        path: string | null;
    }>;
}
/**
 * File-based token storage for CLI (legacy, less secure)
 * Stores token in ~/.oauth.do/token
 * Only works in Node.js environment.
 *
 * @deprecated Use SecureFileTokenStorage or KeychainTokenStorage instead
 */
declare class FileTokenStorage implements TokenStorage {
    private tokenPath;
    private configDir;
    private initialized;
    private init;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
}
/**
 * In-memory token storage (for browser or testing)
 */
declare class MemoryTokenStorage implements TokenStorage {
    private token;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
}
/**
 * LocalStorage-based token storage (for browser)
 */
declare class LocalStorageTokenStorage implements TokenStorage {
    private key;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
}
/**
 * Composite token storage that tries multiple storage backends
 * Attempts keychain first, then falls back to secure file storage
 */
declare class CompositeTokenStorage implements TokenStorage {
    private keychainStorage;
    private fileStorage;
    private preferredStorage;
    constructor();
    /**
     * Determine the best available storage backend
     */
    private getPreferredStorage;
    getToken(): Promise<string | null>;
    setToken(token: string): Promise<void>;
    removeToken(): Promise<void>;
    /**
     * Get information about the current storage backend
     */
    getStorageInfo(): Promise<{
        type: 'keychain' | 'file';
        secure: boolean;
    }>;
}
/**
 * Create the default token storage
 * - Node.js: Uses secure file storage (~/.oauth.do/token with 0600 permissions)
 * - Browser: Uses localStorage
 * - Worker: Uses in-memory storage (tokens should be passed via env bindings)
 *
 * Note: We use file storage by default because keychain storage on macOS
 * requires GUI authorization popups, which breaks automation and agent workflows.
 *
 * @param storagePath - Optional custom path for token storage (e.g., '~/.studio/tokens.json')
 */
declare function createSecureStorage(storagePath?: string): TokenStorage;

/**
 * CLI-centric login utilities
 * Handles device flow with browser auto-launch for CLI apps
 */

interface LoginOptions {
    /** Open browser automatically (default: true) */
    openBrowser?: boolean;
    /** Custom print function for output */
    print?: (message: string) => void;
    /** OAuth provider to use directly (bypasses AuthKit login screen) */
    provider?: OAuthProvider;
    /** Storage to use (default: createSecureStorage()) */
    storage?: {
        getToken: () => Promise<string | null>;
        setToken: (token: string) => Promise<void>;
        removeToken: () => Promise<void>;
        getTokenData?: () => Promise<StoredTokenData | null>;
        setTokenData?: (data: StoredTokenData) => Promise<void>;
    };
}
interface LoginResult {
    token: string;
    isNewLogin: boolean;
}
/**
 * Get existing token or perform device flow login
 * Handles browser launch and token storage automatically
 * Automatically refreshes expired tokens if refresh_token is available
 *
 * Uses singleton pattern to prevent multiple concurrent login/refresh attempts
 */
declare function ensureLoggedIn(options?: LoginOptions): Promise<LoginResult>;
/**
 * Force a new login (ignores existing token)
 */
declare function forceLogin(options?: LoginOptions): Promise<LoginResult>;
/**
 * Logout and remove stored token
 */
declare function ensureLoggedOut(options?: LoginOptions): Promise<void>;

/**
 * Authenticated RPC session support for oauth.do
 *
 * This module provides integration between oauth.do and the platform.do SDK,
 * enabling creation of authenticated RPC sessions using stored OAuth tokens.
 *
 * Dependency chain: capnweb-do -> rpc-do -> platform-do -> oauth-do
 *
 * oauth.do depends on both:
 * - rpc.do: For direct RPC client access and low-level RPC operations
 * - platform.do: For managed connections with pooling, retry, and auth
 *
 * @packageDocumentation
 */

/**
 * Options for creating an authenticated RPC session
 */
interface AuthenticatedRpcOptions extends Omit<DotDoOptions, 'auth'> {
    /**
     * Token to use for authentication. If not provided, will attempt to get
     * token from storage or environment variables.
     */
    token?: string;
    /**
     * If true, throw an error if no token is available.
     * If false (default), create an unauthenticated session.
     */
    requireAuth?: boolean;
}
/**
 * Result of creating an authenticated RPC client
 */
interface AuthenticatedRpcClient {
    /** The DotDo platform client configured with authentication */
    client: DotDo;
    /** The access token being used (if authenticated) */
    token: string | null;
    /** Full token data including refresh token (if available) */
    tokenData: StoredTokenData | null;
    /** Whether the client is authenticated */
    isAuthenticated: boolean;
}
/**
 * Create an authenticated DotDo platform client using stored OAuth tokens.
 *
 * This function integrates oauth.do with platform.do to create RPC sessions
 * that are automatically authenticated using stored credentials.
 *
 * @param options - Configuration options for the RPC client
 * @returns An authenticated DotDo client with token information
 *
 * @example
 * ```typescript
 * import { createAuthenticatedClient } from 'oauth.do'
 *
 * // Create client with stored token
 * const { client, isAuthenticated } = await createAuthenticatedClient()
 *
 * if (isAuthenticated) {
 *   // Connect to a .do service
 *   const api = await client.connect('api')
 *   const result = await api.$.someMethod()
 * }
 *
 * // Don't forget to close when done
 * await client.close()
 * ```
 *
 * @example
 * ```typescript
 * // Require authentication (throws if no token)
 * const { client } = await createAuthenticatedClient({ requireAuth: true })
 * ```
 *
 * @example
 * ```typescript
 * // Use explicit token
 * const { client } = await createAuthenticatedClient({ token: 'my-token' })
 * ```
 */
declare function createAuthenticatedClient(options?: AuthenticatedRpcOptions): Promise<AuthenticatedRpcClient>;
/**
 * Connect to a .do service with automatic authentication.
 *
 * This is a convenience function that creates an authenticated client
 * and connects to a specific service in one call.
 *
 * @param service - Service name (e.g., 'api', 'ai') or full URL
 * @param options - Configuration options
 * @returns Typed RPC proxy for the service
 *
 * @example
 * ```typescript
 * import { connectAuthenticated } from 'oauth.do'
 *
 * // Connect to api.do with stored credentials
 * const api = await connectAuthenticated('api')
 * const result = await api.$.users.list()
 * ```
 *
 * @example
 * ```typescript
 * // Connect with type safety
 * interface MyService {
 *   getData(): Promise<{ items: string[] }>
 * }
 *
 * const service = await connectAuthenticated<MyService>('my-service')
 * const data = await service.$.getData()
 * ```
 */
declare function connectAuthenticated<T = $>(service: string, options?: AuthenticatedRpcOptions): Promise<RpcProxy<T>>;
/**
 * Create a DotDo client factory that uses oauth.do for authentication.
 *
 * This is useful when you need to create multiple connections with the
 * same authentication configuration.
 *
 * @param baseOptions - Base configuration options to use for all clients
 * @returns A factory function for creating authenticated clients
 *
 * @example
 * ```typescript
 * import { createAuthFactory } from 'oauth.do'
 *
 * // Create factory with base options
 * const createClient = createAuthFactory({
 *   timeout: 30000,
 *   retry: { maxAttempts: 3 },
 * })
 *
 * // Create multiple authenticated clients
 * const client1 = await createClient()
 * const client2 = await createClient({ requireAuth: true })
 * ```
 */
declare function createAuthFactory(baseOptions?: AuthenticatedRpcOptions): (options?: AuthenticatedRpcOptions) => Promise<AuthenticatedRpcClient>;
/**
 * Options for creating a direct RPC connection (without platform.do pooling)
 */
interface DirectRpcOptions extends ConnectOptions {
    /**
     * Token to use for authentication. If not provided, will attempt to get
     * token from storage or environment variables.
     */
    token?: string;
    /**
     * If true, throw an error if no token is available.
     * If false (default), create an unauthenticated connection.
     */
    requireAuth?: boolean;
}
/**
 * Create a direct RPC client connection with automatic authentication.
 *
 * This uses rpc.do directly for low-level RPC access without platform.do's
 * pooling and retry logic. Use this when you need direct control over the
 * connection lifecycle or for simple single-connection scenarios.
 *
 * For managed connections with pooling and retry, use createAuthenticatedClient()
 * which uses platform.do.
 *
 * @param url - WebSocket URL of the RPC service
 * @param options - Connection options
 * @returns Direct RPC client instance
 *
 * @example
 * ```typescript
 * import { createDirectRpcClient } from 'oauth.do'
 *
 * // Create direct connection with stored credentials
 * const client = await createDirectRpcClient('wss://api.example.do')
 *
 * // Make RPC calls
 * const result = await client.$.someMethod()
 *
 * // Close when done
 * await client.close()
 * ```
 */
declare function createDirectRpcClient<T = unknown>(url: string, options?: DirectRpcOptions): Promise<RpcClient<T>>;
/**
 * Create an authenticated RPC session that can be used for multiple calls.
 *
 * This provides the raw rpc.do client with authentication applied, suitable
 * for scenarios where you need fine-grained control over the RPC transport.
 *
 * @param options - Authentication and connection options
 * @returns Authenticated RPC session info
 *
 * @example
 * ```typescript
 * import { createAuthenticatedRpcSession } from 'oauth.do'
 *
 * const session = await createAuthenticatedRpcSession()
 *
 * if (session.isAuthenticated) {
 *   // Connect to multiple services using the same auth
 *   const client1 = session.connect('wss://api.example.do')
 *   const client2 = session.connect('wss://other.example.do')
 * }
 * ```
 */
declare function createAuthenticatedRpcSession(options?: Omit<DirectRpcOptions, 'token'> & {
    token?: string;
}): Promise<{
    token: string | null;
    tokenData: StoredTokenData | null;
    isAuthenticated: boolean;
    connect: <T = unknown>(url: string, connectOptions?: ConnectOptions) => RpcClient<T>;
}>;

export { type AuthProvider, type AuthResult, type AuthenticatedRpcClient, type AuthenticatedRpcOptions, CompositeTokenStorage, type DeviceAuthorizationResponse, type DirectRpcOptions, FileTokenStorage, type GitHubDeviceAuthResponse, type GitHubDeviceFlowOptions, type GitHubTokenResponse, type GitHubUser, KeychainTokenStorage, LocalStorageTokenStorage, type LoginOptions, type LoginResult, MemoryTokenStorage, type OAuthConfig, type OAuthProvider, SecureFileTokenStorage, type TokenError, type TokenResponse, type TokenStorage, type User, ensureLoggedOut as a, auth, authorizeDevice, buildAuthUrl, configure, connectAuthenticated, createAuthFactory, createAuthenticatedClient, createAuthenticatedRpcSession, createDirectRpcClient, createSecureStorage, ensureLoggedIn as e, forceLogin as f, getConfig, getGitHubUser, getToken, getUser, isAuthenticated, login, logout, pollForTokens, pollGitHubDeviceFlow, startGitHubDeviceFlow };
