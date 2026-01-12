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

import { DotDo, type DotDoOptions, type RpcProxy, type $ } from 'platform.do'
import { RpcClient, connect as rpcDoConnect, type ConnectOptions } from 'rpc.do'
import { getToken, getStoredTokenData } from './auth.js'
import type { StoredTokenData } from './types.js'

/**
 * Options for creating an authenticated RPC session
 */
export interface AuthenticatedRpcOptions extends Omit<DotDoOptions, 'auth'> {
  /**
   * Token to use for authentication. If not provided, will attempt to get
   * token from storage or environment variables.
   */
  token?: string

  /**
   * If true, throw an error if no token is available.
   * If false (default), create an unauthenticated session.
   */
  requireAuth?: boolean
}

/**
 * Result of creating an authenticated RPC client
 */
export interface AuthenticatedRpcClient {
  /** The DotDo platform client configured with authentication */
  client: DotDo

  /** The access token being used (if authenticated) */
  token: string | null

  /** Full token data including refresh token (if available) */
  tokenData: StoredTokenData | null

  /** Whether the client is authenticated */
  isAuthenticated: boolean
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
export async function createAuthenticatedClient(
  options: AuthenticatedRpcOptions = {}
): Promise<AuthenticatedRpcClient> {
  const { token: explicitToken, requireAuth = false, ...dotdoOptions } = options

  // Get token from explicit option, storage, or environment
  let token: string | null = explicitToken || null
  let tokenData: StoredTokenData | null = null

  if (!token) {
    // Try to get full token data first (includes refresh token, expiry)
    tokenData = await getStoredTokenData()
    if (tokenData) {
      token = tokenData.accessToken
    } else {
      // Fall back to simple token retrieval
      token = await getToken()
    }
  }

  if (requireAuth && !token) {
    throw new Error(
      'Authentication required but no token available. ' +
      'Please login using `oauth.do login` or provide a token explicitly.'
    )
  }

  // Create DotDo client with authentication
  const client = new DotDo({
    ...dotdoOptions,
    auth: token ? { accessToken: token } : undefined,
  })

  return {
    client,
    token,
    tokenData,
    isAuthenticated: !!token,
  }
}

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
export async function connectAuthenticated<T = $>(
  service: string,
  options: AuthenticatedRpcOptions = {}
): Promise<RpcProxy<T>> {
  const { client } = await createAuthenticatedClient(options)
  return client.connect<T>(service)
}

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
export function createAuthFactory(
  baseOptions: AuthenticatedRpcOptions = {}
): (options?: AuthenticatedRpcOptions) => Promise<AuthenticatedRpcClient> {
  return async (options: AuthenticatedRpcOptions = {}) => {
    return createAuthenticatedClient({
      ...baseOptions,
      ...options,
    })
  }
}

/**
 * Options for creating a direct RPC connection (without platform.do pooling)
 */
export interface DirectRpcOptions extends ConnectOptions {
  /**
   * Token to use for authentication. If not provided, will attempt to get
   * token from storage or environment variables.
   */
  token?: string

  /**
   * If true, throw an error if no token is available.
   * If false (default), create an unauthenticated connection.
   */
  requireAuth?: boolean
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
export async function createDirectRpcClient<T = unknown>(
  url: string,
  options: DirectRpcOptions = {}
): Promise<RpcClient<T>> {
  const { token: explicitToken, requireAuth = false, ...rpcOptions } = options

  // Get token from explicit option, storage, or environment
  let token: string | null = explicitToken || null

  if (!token) {
    token = await getToken()
  }

  if (requireAuth && !token) {
    throw new Error(
      'Authentication required but no token available. ' +
      'Please login using `oauth.do login` or provide a token explicitly.'
    )
  }

  // Create RPC client with authentication
  return rpcDoConnect<T>(url, {
    ...rpcOptions,
    token: token || undefined,
  })
}

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
export async function createAuthenticatedRpcSession(
  options: Omit<DirectRpcOptions, 'token'> & { token?: string } = {}
): Promise<{
  token: string | null
  tokenData: StoredTokenData | null
  isAuthenticated: boolean
  connect: <T = unknown>(url: string, connectOptions?: ConnectOptions) => RpcClient<T>
}> {
  const { token: explicitToken, requireAuth = false } = options

  // Get token from explicit option, storage, or environment
  let token: string | null = explicitToken || null
  let tokenData: StoredTokenData | null = null

  if (!token) {
    tokenData = await getStoredTokenData()
    if (tokenData) {
      token = tokenData.accessToken
    } else {
      token = await getToken()
    }
  }

  if (requireAuth && !token) {
    throw new Error(
      'Authentication required but no token available. ' +
      'Please login using `oauth.do login` or provide a token explicitly.'
    )
  }

  return {
    token,
    tokenData,
    isAuthenticated: !!token,
    connect: <T = unknown>(url: string, connectOptions?: ConnectOptions) => {
      return rpcDoConnect<T>(url, {
        ...connectOptions,
        token: token || undefined,
      })
    },
  }
}

// Re-export rpc.do types and functions for direct RPC access
export {
  RpcClient,
  connect as connectRpc,
  // Error types from rpc.do (re-exported from @dotdo/capnweb)
  CapnwebError,
  ConnectionError,
  RpcError,
  CapabilityError,
  TimeoutError,
} from 'rpc.do'
export type { ConnectOptions } from 'rpc.do'

// Re-export platform.do types for convenience
export type { DotDo, DotDoOptions, RpcProxy, $ } from 'platform.do'
export {
  connect,
  PoolTimeoutError,
} from 'platform.do'
