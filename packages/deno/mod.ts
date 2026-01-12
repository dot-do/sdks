/**
 * Cap'n Web - Deno-native capability-based RPC
 *
 * @module
 * @example
 * ```typescript
 * import { rpc } from "./mod.ts";
 *
 * const api = await rpc<Api>("wss://api.example.com");
 * const result = await api.someMethod(arg);
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Options for RPC connection
 */
export interface RpcOptions {
  /** Custom headers for the connection */
  headers?: Record<string, string>;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Reconnection configuration */
  reconnect?: ReconnectOptions;
}

/**
 * Reconnection options
 */
export interface ReconnectOptions {
  enabled: boolean;
  maxAttempts?: number;
  backoff?: "linear" | "exponential";
}

/**
 * RPC Promise that supports pipelining.
 * Allows chaining method calls and property accesses without awaiting intermediate results.
 */
export type RpcPromise<T> = Promise<T> & {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => RpcPromise<Awaited<R>>
    : RpcPromise<Awaited<T[K]>>;
};

/**
 * RPC stub type that wraps an interface for remote calls.
 * Each method returns an RpcPromise enabling pipelining.
 */
export type RpcStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => RpcPromise<Awaited<R>>
    : RpcPromise<Awaited<T[K]>>;
} & AsyncDisposable &
  EventTarget;

/**
 * RPC error from remote server
 */
export class RpcError extends Error {
  readonly type: string;
  readonly details?: unknown;

  constructor(message: string, type: string, details?: unknown) {
    super(message);
    this.name = "RpcError";
    this.type = type;
    this.details = details;
  }
}

/**
 * Connection-level error
 */
export class ConnectionError extends Error {
  readonly code: "CLOSED" | "TIMEOUT" | "REFUSED";

  constructor(message: string, code: "CLOSED" | "TIMEOUT" | "REFUSED") {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends Error {
  constructor(message: string = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

// ─── RpcTarget ────────────────────────────────────────────────────────────────

/**
 * Base class for objects that can be exposed over RPC.
 * Extend this class to create callable remote objects.
 */
export abstract class RpcTarget {
  [Symbol.dispose]?(): void;
  [Symbol.asyncDispose]?(): Promise<void>;
}

/**
 * Create an RPC target from a plain object
 */
export function target<T extends Record<string, unknown>>(methods: T): T & RpcTarget {
  return Object.assign(Object.create(RpcTarget.prototype), methods);
}

// ─── RPC Client ───────────────────────────────────────────────────────────────

/**
 * Create a typed RPC client connection.
 *
 * @param url - WebSocket (wss://) or HTTP (https://) endpoint
 * @param options - Connection options
 * @returns A typed RPC stub
 *
 * @example
 * ```typescript
 * const api = await rpc<Api>("wss://api.example.com");
 * const user = await api.users.get(123);
 * ```
 */
export async function rpc<T>(
  url: string | URL,
  options?: RpcOptions,
): Promise<RpcStub<T>> {
  const urlObj = typeof url === "string" ? new URL(url) : url;

  // Check for cancellation
  options?.signal?.throwIfAborted();

  // Determine protocol
  const isWebSocket = urlObj.protocol === "ws:" || urlObj.protocol === "wss:";

  if (isWebSocket) {
    return createWebSocketStub<T>(urlObj, options);
  } else {
    return createHttpStub<T>(urlObj, options);
  }
}

// ─── Internal Implementation (Stubs) ──────────────────────────────────────────

/** Message ID counter */
let messageIdCounter = 0;

/** Pending call tracking */
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Create a WebSocket-based RPC stub (stub implementation)
 */
async function createWebSocketStub<T>(
  url: URL,
  options?: RpcOptions,
): Promise<RpcStub<T>> {
  const pendingCalls = new Map<number, PendingCall>();
  const eventTarget = new EventTarget();

  // Create WebSocket with custom headers via subprotocol (limitation of browser WebSocket)
  const ws = new WebSocket(url.toString());

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = (event: Event) => {
      cleanup();
      reject(new ConnectionError("WebSocket connection failed", "REFUSED"));
    };

    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);

    // Handle abort signal
    options?.signal?.addEventListener("abort", () => {
      cleanup();
      ws.close();
      reject(new ConnectionError("Connection aborted", "CLOSED"));
    });
  });

  // Handle incoming messages
  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data as string);
      handleMessage(data, pendingCalls, eventTarget);
    } catch {
      // Ignore parse errors
    }
  });

  ws.addEventListener("close", (event) => {
    eventTarget.dispatchEvent(
      new CustomEvent("close", { detail: { code: event.code, reason: event.reason } }),
    );
    // Reject all pending calls
    for (const [id, pending] of pendingCalls) {
      pending.reject(new ConnectionError("Connection closed", "CLOSED"));
      pendingCalls.delete(id);
    }
  });

  ws.addEventListener("error", () => {
    eventTarget.dispatchEvent(new CustomEvent("error", { detail: { error: "WebSocket error" } }));
  });

  // Create proxy for method calls
  return createProxy<T>([], (path, args) => {
    return sendCall(ws, pendingCalls, path, args);
  }, eventTarget, () => ws.close());
}

/**
 * Create an HTTP-based RPC stub (stub implementation)
 */
async function createHttpStub<T>(
  url: URL,
  options?: RpcOptions,
): Promise<RpcStub<T>> {
  const eventTarget = new EventTarget();

  return createProxy<T>([], async (path, args) => {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: JSON.stringify({
        method: path.join("."),
        args,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new RpcError(`HTTP ${response.status}`, "HttpError");
    }

    const result = await response.json();

    if (result.error) {
      throw new RpcError(result.error.message, result.error.type, result.error.details);
    }

    return result.result;
  }, eventTarget, () => Promise.resolve());
}

/**
 * Handle incoming RPC message
 */
function handleMessage(
  data: unknown,
  pendingCalls: Map<number, PendingCall>,
  eventTarget: EventTarget,
): void {
  if (!data || typeof data !== "object") return;

  const msg = data as Record<string, unknown>;

  // Handle resolve message
  if ("resolve" in msg && typeof msg.id === "number") {
    const pending = pendingCalls.get(msg.id);
    if (pending) {
      pending.resolve(msg.resolve);
      pendingCalls.delete(msg.id);
    }
    return;
  }

  // Handle reject message
  if ("reject" in msg && typeof msg.id === "number") {
    const pending = pendingCalls.get(msg.id);
    if (pending) {
      const error = msg.reject as Record<string, unknown>;
      pending.reject(
        new RpcError(
          String(error.message ?? "Remote error"),
          String(error.type ?? "Error"),
          error.details,
        ),
      );
      pendingCalls.delete(msg.id);
    }
    return;
  }
}

/**
 * Send an RPC call over WebSocket
 */
function sendCall(
  ws: WebSocket,
  pendingCalls: Map<number, PendingCall>,
  path: string[],
  args: unknown[],
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++messageIdCounter;
    pendingCalls.set(id, { resolve, reject });

    ws.send(
      JSON.stringify({
        id,
        method: path.join("."),
        args,
      }),
    );
  });
}

/**
 * Create a proxy that intercepts property access and method calls
 */
function createProxy<T>(
  path: string[],
  call: (path: string[], args: unknown[]) => Promise<unknown>,
  eventTarget: EventTarget,
  dispose: () => void | Promise<void>,
): RpcStub<T> {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === Symbol.asyncDispose) {
        return dispose;
      }
      if (prop === "addEventListener") {
        return eventTarget.addEventListener.bind(eventTarget);
      }
      if (prop === "removeEventListener") {
        return eventTarget.removeEventListener.bind(eventTarget);
      }
      if (prop === "dispatchEvent") {
        return eventTarget.dispatchEvent.bind(eventTarget);
      }
      if (prop === "then" || prop === "catch" || prop === "finally") {
        // If path is empty, don't treat as promise
        if (path.length === 0) return undefined;
        // Otherwise, trigger the call and return promise methods
        const promise = call(path, []);
        return (promise as Record<string | symbol, unknown>)[prop];
      }
      if (typeof prop === "string") {
        return createProxy([...path, prop], call, eventTarget, dispose);
      }
      return undefined;
    },
    apply(_target, _thisArg, args) {
      return call(path, args);
    },
  };

  return new Proxy(function () {} as unknown as RpcStub<T>, handler);
}

// ─── Server Functions (Stubs) ─────────────────────────────────────────────────

/**
 * Serve an RPC target over a WebSocket connection
 */
export function serve(_socket: WebSocket, _target: RpcTarget): void {
  // Stub implementation
  throw new Error("Not implemented");
}

/**
 * Handle HTTP batch RPC requests
 */
export async function handleBatch(
  _target: RpcTarget,
  _messages: unknown[],
): Promise<unknown[]> {
  // Stub implementation
  throw new Error("Not implemented");
}
