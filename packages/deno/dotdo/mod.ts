/**
 * dotdo - DotDo Platform SDK for Deno
 *
 * A comprehensive SDK for interacting with the DotDo platform, providing
 * authentication, connection pooling, retry logic, and service discovery.
 *
 * @module
 * @example
 * ```typescript
 * import { DotDo } from "dotdo";
 *
 * const dotdo = new DotDo({
 *   apiKey: Deno.env.get("DOTDO_API_KEY")!,
 * });
 *
 * // Connect to services
 * const users = await dotdo.service<UserService>("users.do");
 * const data = await users.list();
 *
 * // With connection pooling
 * const cached = await dotdo.service<DataService>("data.do");
 * ```
 */

import { connect, type RpcProxy, type ConnectOptions, RpcError } from "@dotdo/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * DotDo client configuration
 */
export interface DotDoConfig {
  /** API key for authentication */
  apiKey?: string;
  /** OAuth access token */
  accessToken?: string;
  /** Base URL for the DotDo platform */
  baseUrl?: string;
  /** Default request timeout in milliseconds */
  timeout?: number;
  /** Enable connection pooling */
  pooling?: boolean;
  /** Maximum connections in the pool */
  maxConnections?: number;
  /** Retry configuration */
  retry?: RetryConfig;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Enable automatic retries */
  enabled: boolean;
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** HTTP status codes to retry on */
  retryableStatuses?: number[];
  /** Error codes to retry on */
  retryableCodes?: string[];
}

/**
 * Authentication credentials
 */
export interface AuthCredentials {
  apiKey?: string;
  accessToken?: string;
}

/**
 * Connection pool entry
 */
interface PoolEntry<T> {
  proxy: RpcProxy<T>;
  lastUsed: number;
  useCount: number;
}

/**
 * Authentication error
 */
export class AuthError extends Error {
  readonly code: "INVALID_KEY" | "EXPIRED_TOKEN" | "INSUFFICIENT_SCOPE";

  constructor(message: string, code: "INVALID_KEY" | "EXPIRED_TOKEN" | "INSUFFICIENT_SCOPE") {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * Service discovery error
 */
export class ServiceError extends Error {
  readonly service: string;

  constructor(message: string, service: string) {
    super(message);
    this.name = "ServiceError";
    this.service = service;
  }
}

// ─── DotDo Class ──────────────────────────────────────────────────────────────

/**
 * DotDo Platform Client
 *
 * Provides a high-level interface for interacting with DotDo services,
 * including authentication, connection pooling, and automatic retries.
 *
 * @example
 * ```typescript
 * const dotdo = new DotDo({ apiKey: "your-api-key" });
 *
 * // Get a service proxy
 * const users = await dotdo.service<UserService>("users.do");
 *
 * // Make calls with automatic retries
 * const user = await users.get("123");
 * ```
 */
export class DotDo implements AsyncDisposable {
  private readonly config: Required<DotDoConfig>;
  private readonly connectionPool = new Map<string, PoolEntry<unknown>>();
  private readonly cleanupInterval: number;
  private credentials: AuthCredentials;

  constructor(config: DotDoConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? Deno.env.get("DOTDO_API_KEY") ?? "",
      accessToken: config.accessToken ?? Deno.env.get("DOTDO_ACCESS_TOKEN") ?? "",
      baseUrl: config.baseUrl ?? Deno.env.get("DOTDO_BASE_URL") ?? "https://api.do",
      timeout: config.timeout ?? 30000,
      pooling: config.pooling ?? true,
      maxConnections: config.maxConnections ?? 10,
      retry: {
        enabled: config.retry?.enabled ?? true,
        maxAttempts: config.retry?.maxAttempts ?? 3,
        initialDelay: config.retry?.initialDelay ?? 100,
        maxDelay: config.retry?.maxDelay ?? 5000,
        backoffMultiplier: config.retry?.backoffMultiplier ?? 2,
        retryableStatuses: config.retry?.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
        retryableCodes: config.retry?.retryableCodes ?? ["TIMEOUT", "NETWORK_ERROR", "ECONNRESET"],
      },
    };

    this.credentials = {
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
    };

    // Start connection pool cleanup
    this.cleanupInterval = setInterval(() => this.cleanupPool(), 60000);
  }

  /**
   * Connect to a DotDo service with automatic retries and pooling.
   *
   * @param service - Service name (e.g., "users.do")
   * @param options - Additional connection options
   * @returns Typed RPC proxy for the service
   *
   * @example
   * ```typescript
   * const users = await dotdo.service<UserService>("users.do");
   * const user = await users.get("123");
   * ```
   */
  async service<T>(service: string, options: Partial<ConnectOptions> = {}): Promise<RpcProxy<T>> {
    // Check pool first
    if (this.config.pooling) {
      const pooled = this.getFromPool<T>(service);
      if (pooled) {
        return pooled;
      }
    }

    // Build connection options
    const connectOptions: ConnectOptions = {
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      ...options,
      token: this.credentials.accessToken || this.credentials.apiKey,
      headers: {
        ...(this.credentials.apiKey && { "X-API-Key": this.credentials.apiKey }),
        ...options.headers,
      },
    };

    // Connect with retries
    const proxy = await this.withRetry(
      () => connect<T>(service, connectOptions),
      `connect to ${service}`
    );

    // Add to pool
    if (this.config.pooling) {
      this.addToPool(service, proxy);
    }

    return proxy;
  }

  /**
   * Authenticate with the DotDo platform.
   *
   * @param credentials - Authentication credentials
   *
   * @example
   * ```typescript
   * await dotdo.authenticate({
   *   apiKey: "new-api-key"
   * });
   * ```
   */
  async authenticate(credentials: AuthCredentials): Promise<void> {
    // Validate credentials
    if (!credentials.apiKey && !credentials.accessToken) {
      throw new AuthError("Either apiKey or accessToken must be provided", "INVALID_KEY");
    }

    // Test authentication
    const testOptions: ConnectOptions = {
      baseUrl: this.config.baseUrl,
      token: credentials.accessToken || credentials.apiKey,
      timeout: 5000,
    };

    try {
      const auth = await connect<{ validate(): Promise<{ valid: boolean }> }>("auth.do", testOptions);
      const result = await auth.validate();

      if (!result.valid) {
        throw new AuthError("Invalid credentials", "INVALID_KEY");
      }

      // Update stored credentials
      this.credentials = credentials;

      // Clear connection pool (new auth)
      await this.clearPool();
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      if (error instanceof RpcError) {
        if (error.code === "HTTP_401" || error.code === "HTTP_403") {
          throw new AuthError("Invalid credentials", "INVALID_KEY");
        }
        if (error.code.includes("EXPIRED")) {
          throw new AuthError("Token has expired", "EXPIRED_TOKEN");
        }
      }
      throw error;
    }
  }

  /**
   * Refresh the access token using a refresh token.
   *
   * @param refreshToken - The refresh token
   * @returns New access token
   */
  async refreshToken(refreshToken: string): Promise<string> {
    const auth = await connect<{
      refresh(token: string): Promise<{ accessToken: string; expiresIn: number }>;
    }>("auth.do", {
      baseUrl: this.config.baseUrl,
      timeout: 5000,
    });

    const result = await auth.refresh(refreshToken);

    this.credentials.accessToken = result.accessToken;
    await this.clearPool();

    return result.accessToken;
  }

  /**
   * Execute a function with automatic retries.
   *
   * @param fn - Function to execute
   * @param operation - Description of the operation (for error messages)
   * @returns Result of the function
   */
  private async withRetry<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    const { retry } = this.config;

    if (!retry.enabled) {
      return fn();
    }

    let lastError: Error | undefined;
    let delay = retry.initialDelay;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === retry.maxAttempts) {
          break;
        }

        // Wait with exponential backoff
        await this.delay(delay);
        delay = Math.min(delay * retry.backoffMultiplier, retry.maxDelay);
      }
    }

    throw new Error(
      `Failed to ${operation} after ${retry.maxAttempts} attempts: ${lastError?.message}`
    );
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof RpcError) {
      // Check status code
      const statusMatch = error.code.match(/^HTTP_(\d+)$/);
      if (statusMatch) {
        const status = parseInt(statusMatch[1], 10);
        return this.config.retry.retryableStatuses.includes(status);
      }

      // Check error code
      return this.config.retry.retryableCodes.includes(error.code);
    }

    if (error instanceof AuthError) {
      return false; // Don't retry auth errors
    }

    return true; // Retry unknown errors
  }

  /**
   * Delay for a specified number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get a connection from the pool.
   */
  private getFromPool<T>(service: string): RpcProxy<T> | undefined {
    const entry = this.connectionPool.get(service) as PoolEntry<T> | undefined;

    if (entry) {
      entry.lastUsed = Date.now();
      entry.useCount++;
      return entry.proxy;
    }

    return undefined;
  }

  /**
   * Add a connection to the pool.
   */
  private addToPool<T>(service: string, proxy: RpcProxy<T>): void {
    // Evict oldest if at capacity
    if (this.connectionPool.size >= this.config.maxConnections) {
      let oldest: string | undefined;
      let oldestTime = Infinity;

      for (const [key, entry] of this.connectionPool) {
        if (entry.lastUsed < oldestTime) {
          oldest = key;
          oldestTime = entry.lastUsed;
        }
      }

      if (oldest) {
        this.connectionPool.delete(oldest);
      }
    }

    this.connectionPool.set(service, {
      proxy: proxy as RpcProxy<unknown>,
      lastUsed: Date.now(),
      useCount: 1,
    });
  }

  /**
   * Clean up stale connections from the pool.
   */
  private cleanupPool(): void {
    const staleThreshold = Date.now() - 5 * 60 * 1000; // 5 minutes

    for (const [key, entry] of this.connectionPool) {
      if (entry.lastUsed < staleThreshold) {
        this.connectionPool.delete(key);
      }
    }
  }

  /**
   * Clear all connections from the pool.
   */
  private async clearPool(): Promise<void> {
    for (const [, entry] of this.connectionPool) {
      try {
        await entry.proxy[Symbol.asyncDispose]?.();
      } catch {
        // Ignore disposal errors
      }
    }
    this.connectionPool.clear();
  }

  /**
   * Get the current configuration.
   */
  get currentConfig(): Readonly<DotDoConfig> {
    return { ...this.config };
  }

  /**
   * Check if the client is authenticated.
   */
  get isAuthenticated(): boolean {
    return !!(this.credentials.apiKey || this.credentials.accessToken);
  }

  /**
   * Dispose of the DotDo client and clean up resources.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    clearInterval(this.cleanupInterval);
    await this.clearPool();
  }

  /**
   * Explicitly close the client.
   */
  async close(): Promise<void> {
    await this[Symbol.asyncDispose]();
  }
}

// ─── Factory Functions ────────────────────────────────────────────────────────

/**
 * Create a new DotDo client instance.
 *
 * @param config - Client configuration
 * @returns DotDo client instance
 *
 * @example
 * ```typescript
 * const dotdo = createDotDo({
 *   apiKey: Deno.env.get("DOTDO_API_KEY")!,
 *   retry: { maxAttempts: 5 }
 * });
 * ```
 */
export function createDotDo(config?: DotDoConfig): DotDo {
  return new DotDo(config);
}

/**
 * Create a DotDo client with default configuration from environment variables.
 *
 * @returns DotDo client instance
 *
 * @example
 * ```typescript
 * // Uses DOTDO_API_KEY, DOTDO_ACCESS_TOKEN, DOTDO_BASE_URL from env
 * const dotdo = createDefaultDotDo();
 * ```
 */
export function createDefaultDotDo(): DotDo {
  return new DotDo();
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { connect, RpcError, type RpcProxy, type ConnectOptions } from "@dotdo/rpc";
