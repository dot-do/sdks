import { connect, CapnwebError, TimeoutError } from 'rpc.do';
export { CapabilityError, CapnwebError, ConnectionError, ErrorCode, ErrorCodeName, RpcClient, RpcError, SerializationError, TimeoutError, connect, createError, isErrorCode, wrapError } from 'rpc.do';

// src/index.ts
function createConnection(options) {
  const client = connect(options.url || "", options);
  return {
    connection: {
      close: async (_reason) => {
        await client.close();
      }
    },
    proxy: client
  };
}
var ConnectionPool = class {
  connections = /* @__PURE__ */ new Map();
  options;
  /** Pending acquire operations waiting for a connection */
  waitQueue = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.options = {
      minConnections: options.minConnections ?? 1,
      maxConnections: options.maxConnections ?? 10,
      idleTimeout: options.idleTimeout ?? 3e4,
      acquireTimeout: options.acquireTimeout ?? 3e4
      // Default 30s as per issue spec
    };
  }
  /**
   * Acquire a connection from the pool
   *
   * @param url - The URL to connect to
   * @param connectionOptions - Options for creating a new connection
   * @param acquireOptions - Options for the acquire operation (timeout, signal)
   */
  async acquire(url, connectionOptions, acquireOptions) {
    const timeout = acquireOptions?.timeout ?? this.options.acquireTimeout;
    const externalSignal = acquireOptions?.signal;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);
    try {
      return await this.acquireInternal(url, connectionOptions, controller.signal, timeout);
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
  /**
   * Internal acquire implementation that respects AbortSignal
   */
  async acquireInternal(url, connectionOptions, signal, timeout) {
    if (signal.aborted) {
      throw new PoolTimeoutError(
        `Connection pool acquire timeout for ${url} after ${timeout}ms`,
        url,
        timeout
      );
    }
    let pool = this.connections.get(url);
    if (!pool) {
      pool = [];
      this.connections.set(url, pool);
    }
    for (const pooled of pool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        return { connection: pooled.connection, proxy: pooled.proxy };
      }
    }
    if (pool.length < this.options.maxConnections) {
      if (signal.aborted) {
        throw new PoolTimeoutError(
          `Connection pool acquire timeout for ${url} after ${timeout}ms`,
          url,
          timeout
        );
      }
      const connectionOptionsWithSignal = {
        ...connectionOptions,
        signal
        // Propagate signal to WebSocket/transport
      };
      const { connection, proxy } = createConnection(connectionOptionsWithSignal);
      const pooled = {
        connection,
        proxy,
        lastUsed: Date.now(),
        inUse: true
      };
      pool.push(pooled);
      return { connection, proxy };
    }
    return this.waitForConnection(url, signal, timeout);
  }
  /**
   * Wait for a connection to become available (pool exhausted)
   */
  waitForConnection(url, signal, timeout) {
    return new Promise((resolve, reject) => {
      const pool = this.connections.get(url);
      const onAbort = () => {
        const queue2 = this.waitQueue.get(url);
        if (queue2) {
          const index = queue2.findIndex((w) => w.resolve === waiterResolve);
          if (index !== -1) {
            queue2.splice(index, 1);
          }
        }
        reject(
          new PoolTimeoutError(
            `Connection pool acquire timeout for ${url} after ${timeout}ms`,
            url,
            timeout
          )
        );
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      const waiterResolve = (pooled) => {
        signal.removeEventListener("abort", onAbort);
        pooled.inUse = true;
        pooled.lastUsed = Date.now();
        resolve({ connection: pooled.connection, proxy: pooled.proxy });
      };
      const waiterReject = (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      };
      let queue = this.waitQueue.get(url);
      if (!queue) {
        queue = [];
        this.waitQueue.set(url, queue);
      }
      queue.push({ resolve: waiterResolve, reject: waiterReject });
      signal.addEventListener("abort", onAbort);
      const pollInterval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(pollInterval);
          return;
        }
        for (const pooled of pool) {
          if (!pooled.inUse) {
            clearInterval(pollInterval);
            const q = this.waitQueue.get(url);
            if (q) {
              const idx = q.findIndex((w) => w.resolve === waiterResolve);
              if (idx !== -1) {
                q.splice(idx, 1);
              }
            }
            waiterResolve(pooled);
            return;
          }
        }
      }, 50);
    });
  }
  /**
   * Release a connection back to the pool
   */
  release(url, connection) {
    const pool = this.connections.get(url);
    if (!pool) return;
    for (const pooled of pool) {
      if (pooled.connection === connection) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        return;
      }
    }
  }
  /**
   * Clean up idle connections
   */
  cleanup() {
    const now = Date.now();
    for (const [url, pool] of this.connections) {
      const active = pool.filter((p) => {
        if (p.inUse) return true;
        if (now - p.lastUsed > this.options.idleTimeout) {
          p.connection.close("idle timeout");
          return false;
        }
        return true;
      });
      if (active.length === 0) {
        this.connections.delete(url);
      } else {
        this.connections.set(url, active);
      }
    }
  }
  /**
   * Close all connections
   */
  async closeAll() {
    for (const pool of this.connections.values()) {
      for (const pooled of pool) {
        await pooled.connection.close("pool shutdown");
      }
    }
    this.connections.clear();
  }
};
var DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 1e4,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "CONNECTION_ERROR"],
  timeout: void 0,
  signal: void 0
};
function calculateRetryDelay(attempt, options) {
  const exponentialDelay = options.baseDelay * Math.pow(options.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, options.maxDelay);
  const jitter = cappedDelay * Math.random() * 0.25;
  return cappedDelay + jitter;
}
function isRetryableError(error, options) {
  if (error instanceof Error) {
    const code = error.code;
    if (code && options.retryableErrors.includes(code)) {
      return true;
    }
  }
  return false;
}
async function withRetry(fn, options, onRetry) {
  let lastError;
  const startTime = Date.now();
  if (options.signal?.aborted) {
    const err = new Error("Operation aborted");
    err.name = "AbortError";
    throw err;
  }
  for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
    if (options.timeout && Date.now() - startTime >= options.timeout) {
      throw new TimeoutError(`Retry operation timed out after ${options.timeout}ms`);
    }
    if (options.signal?.aborted) {
      const err = new Error("Operation aborted");
      err.name = "AbortError";
      throw err;
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < options.maxAttempts - 1 && isRetryableError(error, options)) {
        const delay = calculateRetryDelay(attempt, options);
        onRetry?.(attempt + 1, error);
        if (options.timeout) {
          const elapsed = Date.now() - startTime;
          const remainingTime = options.timeout - elapsed;
          if (remainingTime <= 0) {
            throw new TimeoutError(`Retry operation timed out after ${options.timeout}ms`);
          }
          const cappedDelay = Math.min(delay, remainingTime);
          await new Promise((resolve) => setTimeout(resolve, cappedDelay));
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
var DotDo = class {
  options;
  pool;
  retryOptions;
  cleanupInterval;
  constructor(options = {}) {
    this.options = options;
    this.pool = new ConnectionPool(options.pool);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options.retry };
    this.cleanupInterval = setInterval(() => this.pool.cleanup(), 1e4);
  }
  /**
   * Connect to a .do service
   *
   * @param service - Service name (e.g., 'ai') or full URL
   * @returns Typed RPC proxy for the service
   *
   * @example
   * ```ts
   * // Connect by service name
   * const ai = await dotdo.connect<AIService>('ai');
   *
   * // Connect by full URL
   * const api = await dotdo.connect('https://api.example.do');
   * ```
   */
  async connect(service) {
    const url = this.resolveUrl(service);
    const connectionOptions = this.buildConnectionOptions(url);
    const { proxy } = await withRetry(
      () => this.pool.acquire(url, connectionOptions),
      this.retryOptions,
      this.options.debug ? (attempt, error) => {
        console.log(`[DotDo] Retry attempt ${attempt} for ${url}:`, error);
      } : void 0
    );
    return this.wrapWithRetry(proxy, url);
  }
  /**
   * Create a one-off connection without pooling
   *
   * @param service - Service name or full URL
   * @returns Connection and proxy
   */
  connectOnce(service) {
    const url = this.resolveUrl(service);
    const connectionOptions = this.buildConnectionOptions(url);
    return connect(url, connectionOptions);
  }
  /**
   * Get authentication headers for the current configuration
   */
  getAuthHeaders() {
    const headers = {};
    if (this.options.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.apiKey}`;
    }
    if (this.options.auth?.apiKey) {
      headers["Authorization"] = `Bearer ${this.options.auth.apiKey}`;
    }
    if (this.options.auth?.accessToken) {
      headers["Authorization"] = `Bearer ${this.options.auth.accessToken}`;
    }
    if (this.options.auth?.headers) {
      Object.assign(headers, this.options.auth.headers);
    }
    return headers;
  }
  /**
   * Close all connections and clean up resources
   */
  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = void 0;
    }
    await this.pool.closeAll();
  }
  /**
   * Resolve a service name to a full URL
   */
  resolveUrl(service) {
    if (service.includes("://")) {
      return service;
    }
    if (this.options.baseUrl) {
      return `${this.options.baseUrl}/${service}`;
    }
    return `https://${service}.do`;
  }
  /**
   * Build connection options with auth
   */
  buildConnectionOptions(url) {
    return {
      url,
      timeout: this.options.timeout,
      headers: this.getAuthHeaders(),
      apiKey: this.options.apiKey || this.options.auth?.apiKey
    };
  }
  /**
   * Wrap a proxy with retry logic
   */
  wrapWithRetry(proxy, _url) {
    return proxy;
  }
};
var defaultClient;
function getClient(options) {
  if (!defaultClient) {
    defaultClient = new DotDo(options);
  }
  return defaultClient;
}
function configure(options) {
  if (defaultClient) {
    defaultClient.close();
  }
  defaultClient = new DotDo(options);
  return defaultClient;
}
async function to(service, options) {
  const client = options ? new DotDo(options) : getClient();
  return client.connect(service);
}
var PoolErrorCode = {
  /** Pool acquisition timeout */
  POOL_TIMEOUT_ERROR: 6001
};
var PoolTimeoutError = class _PoolTimeoutError extends CapnwebError {
  constructor(message, url, timeout) {
    super(message, PoolErrorCode.POOL_TIMEOUT_ERROR, "POOL_TIMEOUT_ERROR");
    this.url = url;
    this.timeout = timeout;
    this.name = "PoolTimeoutError";
    Object.setPrototypeOf(this, _PoolTimeoutError.prototype);
  }
};
async function createTestServer(_config = {}) {
  throw new Error("createTestServer not yet implemented - test server infrastructure pending");
}
function createTestClient(options) {
  return new DotDo({
    ...options,
    baseUrl: options.serverUrl
  });
}

export { DotDo, PoolErrorCode, PoolTimeoutError, configure, createTestClient, createTestServer, getClient, to };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map