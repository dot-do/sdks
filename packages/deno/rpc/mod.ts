/**
 * @dotdo/rpc - Simplified RPC client for DotDo services
 *
 * Provides a streamlined interface for connecting to DotDo RPC endpoints
 * with automatic type inference and functional mapping capabilities.
 *
 * @module
 * @example
 * ```typescript
 * import { connect } from "@dotdo/rpc";
 *
 * interface UserService {
 *   get(id: string): Promise<User>;
 *   list(): Promise<User[]>;
 * }
 *
 * const users = await connect<UserService>("users.do");
 * const user = await users.get("123");
 *
 * // With .map() for transformations
 * const names = await users.list().map(u => u.name);
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Connection options for RPC client
 */
export interface ConnectOptions {
  /** Base URL for the DotDo platform (defaults to https://api.do) */
  baseUrl?: string;
  /** Authentication token */
  token?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * RPC error from remote service
 */
export class RpcError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Enhanced Promise with functional mapping capabilities
 */
export type MappablePromise<T> = Promise<T> & {
  /**
   * Transform the result using a mapping function.
   * If the result is an array, maps over each element.
   * If the result is a single value, transforms it directly.
   *
   * @example
   * ```typescript
   * // Map over array results
   * const names = await users.list().map(u => u.name);
   *
   * // Transform single results
   * const upperName = await users.get("123").map(u => u.name.toUpperCase());
   * ```
   */
  map<U>(fn: T extends (infer E)[] ? (item: E, index: number) => U : (value: T) => U): MappablePromise<T extends unknown[] ? U[] : U>;
};

/**
 * RPC method that returns a mappable promise
 */
type RpcMethod<Args extends unknown[], R> = (...args: Args) => MappablePromise<Awaited<R>>;

/**
 * RPC Proxy type that wraps a service interface
 */
export type RpcProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? RpcMethod<A, R>
    : T[K] extends object
    ? RpcProxy<T[K]>
    : never;
} & AsyncDisposable;

// ─── Internal Implementation ──────────────────────────────────────────────────

/**
 * Create a mappable promise from a regular promise
 */
function createMappablePromise<T>(promise: Promise<T>): MappablePromise<T> {
  const mappable = promise as MappablePromise<T>;

  mappable.map = function <U>(
    fn: T extends (infer E)[] ? (item: E, index: number) => U : (value: T) => U
  ): MappablePromise<T extends unknown[] ? U[] : U> {
    const mapped = promise.then((result) => {
      if (Array.isArray(result)) {
        return result.map(fn as (item: unknown, index: number) => U);
      }
      return (fn as (value: T) => U)(result);
    }) as Promise<T extends unknown[] ? U[] : U>;

    return createMappablePromise(mapped);
  };

  return mappable;
}

/**
 * Create a proxy for RPC calls
 */
function createRpcProxy<T>(
  path: string[],
  call: (method: string, args: unknown[]) => Promise<unknown>,
  dispose: () => Promise<void>
): RpcProxy<T> {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === Symbol.asyncDispose) {
        return dispose;
      }
      if (typeof prop === "string") {
        return createRpcProxy([...path, prop], call, dispose);
      }
      return undefined;
    },
    apply(_target, _thisArg, args) {
      const method = path.join(".");
      return createMappablePromise(call(method, args));
    },
  };

  return new Proxy(function () {} as unknown as RpcProxy<T>, handler);
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Connect to a DotDo RPC service.
 *
 * @param service - Service name (e.g., "users.do") or full URL
 * @param options - Connection options
 * @returns A typed RPC proxy for the service
 *
 * @example
 * ```typescript
 * // Connect by service name
 * const users = await connect<UserService>("users.do");
 *
 * // Connect with options
 * const api = await connect<ApiService>("api.do", {
 *   token: "my-token",
 *   timeout: 5000
 * });
 *
 * // Make RPC calls
 * const user = await users.get("123");
 * const names = await users.list().map(u => u.name);
 * ```
 */
export async function connect<T>(
  service: string,
  options: ConnectOptions = {}
): Promise<RpcProxy<T>> {
  const {
    baseUrl = "https://api.do",
    token,
    headers = {},
    timeout = 30000,
    signal,
  } = options;

  // Build the service URL
  const url = service.includes("://")
    ? service
    : `${baseUrl}/${service.replace(/\.do$/, "")}`;

  // Build headers
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  }

  // RPC call function
  const call = async (method: string, args: unknown[]): Promise<unknown> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine signals
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: crypto.randomUUID(),
          method,
          params: args,
        }),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new RpcError(
          `HTTP ${response.status}: ${text}`,
          `HTTP_${response.status}`
        );
      }

      const result = await response.json();

      if (result.error) {
        throw new RpcError(
          result.error.message || "RPC Error",
          result.error.code || "RPC_ERROR",
          result.error.data
        );
      }

      return result.result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof RpcError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RpcError("Request timeout", "TIMEOUT");
      }

      throw new RpcError(
        error instanceof Error ? error.message : String(error),
        "NETWORK_ERROR"
      );
    }
  };

  // Dispose function (no-op for HTTP, could close WebSocket)
  const dispose = async (): Promise<void> => {
    // HTTP connections are stateless, nothing to clean up
  };

  return createRpcProxy<T>([], call, dispose);
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { RpcProxy, MappablePromise };
