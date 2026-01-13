// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { RpcTarget as RpcTargetImpl, RpcStub as RpcStubImpl, RpcPromise as RpcPromiseImpl, RpcPayload } from "./core.js";

// Re-export RpcPayload for internal/test use
export { RpcPayload };
import { serialize, deserialize } from "./serialize.js";
import { RpcTransport, RpcSession as RpcSessionImpl, RpcSessionOptions, SessionState, ReconnectionStrategy } from "./rpc.js";
import { RpcTargetBranded, RpcCompatible, Stub, Stubify, __RPC_TARGET_BRAND } from "./types.js";
import { newWebSocketRpcSession as newWebSocketRpcSessionImpl,
         newWorkersWebSocketRpcResponse } from "./websocket.js";
import { newHttpBatchRpcSession as newHttpBatchRpcSessionImpl,
         newHttpBatchRpcResponse, nodeHttpBatchRpcResponse } from "./batch.js";
import { newMessagePortRpcSession as newMessagePortRpcSessionImpl } from "./messageport.js";
import { BaseTransport } from "./transports/base.js";
import { forceInitMap } from "./map.js";

forceInitMap();

// Re-export standardized error types and codes
export {
  ErrorCode,
  ErrorCodeName,
  CapnwebError,
  ConnectionError,
  VersionMismatchError,
  RpcError,
  TimeoutError,
  CapabilityError,
  SerializationError,
  isErrorCode,
  createError,
  wrapError,
} from "./errors.js";
export type { ErrorCodeType, CapabilityId } from "./errors.js";

// Re-export protocol version constants and utilities
export {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_VERSION,
  MAX_SUPPORTED_VERSION,
  SUPPORTED_VERSIONS,
  parseVersion,
  compareVersions,
  areVersionsCompatible,
  isVersionSupported,
  negotiateVersion,
  negotiateVersionWithDetails,
  createHelloMessage,
  createHelloAckMessage,
  createHelloRejectMessage,
  isHandshakeMessage,
  formatVersion,
} from "./version.js";
export type {
  ProtocolVersion,
  VersionNegotiationResult,
  HandshakeMessage,
  HandshakeAckMessage,
  HandshakeRejectMessage,
  HandshakeMessageType,
} from "./version.js";

// Re-export public API types.
export { serialize, deserialize, newWorkersWebSocketRpcResponse, newHttpBatchRpcResponse,
         nodeHttpBatchRpcResponse, BaseTransport };
export type { RpcTransport, RpcSessionOptions, RpcCompatible, SessionState, ReconnectionStrategy };

// Hack the type system to make RpcStub's types work nicely!
/**
 * Represents a reference to a remote object, on which methods may be remotely invoked via RPC.
 *
 * `RpcStub` can represent any interface (when using TypeScript, you pass the specific interface
 * type as `T`, but this isn't known at runtime). The way this works is, `RpcStub` is actually a
 * `Proxy`. It makes itself appear as if every possible method / property name is defined. You can
 * invoke any method name, and the invocation will be sent to the server. If it turns out that no
 * such method exists on the remote object, an exception is thrown back. But the client does not
 * actually know, until that point, what methods exist.
 */
export type RpcStub<T extends RpcCompatible<T>> = Stub<T>;
export const RpcStub: {
  new <T extends RpcCompatible<T>>(value: T): RpcStub<T>;
} = RpcStubImpl as typeof RpcStub;

/**
 * Represents the result of an RPC call.
 *
 * Also used to represent properties. That is, `stub.foo` evaluates to an `RpcPromise` for the
 * value of `foo`.
 *
 * This isn't actually a JavaScript `Promise`. It does, however, have `then()`, `catch()`, and
 * `finally()` methods, like `Promise` does, and because it has a `then()` method, JavaScript will
 * allow you to treat it like a promise, e.g. you can `await` it.
 *
 * An `RpcPromise` is also a proxy, just like `RpcStub`, where calling methods or awaiting
 * properties will make a pipelined network request.
 *
 * Note that and `RpcPromise` is "lazy": the actual final result is not requested from the server
 * until you actually `await` the promise (or call `then()`, etc. on it). This is an optimization:
 * if you only intend to use the promise for pipelining and you never await it, then there's no
 * need to transmit the resolution!
 */
export type RpcPromise<T extends RpcCompatible<T>> = Stub<T> & Promise<Stubify<T>>;
export const RpcPromise: {
  // Note: Cannot construct directly!
} = RpcPromiseImpl as typeof RpcPromise;

/**
 * Use to construct an `RpcSession` on top of a custom `RpcTransport`.
 *
 * Most people won't use this. You only need it if you've implemented your own `RpcTransport`.
 *
 * ## Session Lifecycle
 *
 * An RpcSession goes through two states:
 * 1. **ACTIVE** - Session is operational, RPC calls can be made
 * 2. **CLOSED** - Session has been shut down, RPC calls will throw ConnectionError
 *
 * A session can be closed by:
 * - Calling `close()` explicitly
 * - Disposing the main stub via `Symbol.dispose` (using the `using` declaration)
 * - Transport disconnection or error
 * - Peer sending an abort message
 *
 * @example
 * ```typescript
 * // Create and use a session
 * const session = new RpcSession(transport, localMain);
 * const stub = session.getRemoteMain();
 *
 * // Make RPC calls
 * const result = await stub.someMethod();
 *
 * // Close when done
 * session.close();
 *
 * // Or use with Symbol.dispose on the stub
 * const stub = session.getRemoteMain();
 * await stub.someMethod();
 * stub[Symbol.dispose]();  // Also closes the session
 * ```
 */
export interface RpcSession<T extends RpcCompatible<T> = undefined> {
  getRemoteMain(): RpcStub<T>;
  getStats(): {imports: number, exports: number};

  // Waits until the peer is not waiting on any more promise resolutions from us. This is useful
  // in particular to decide when a batch is complete.
  drain(): Promise<void>;

  /**
   * Close the session gracefully, releasing all resources.
   *
   * Performs a clean shutdown:
   * - Marks the session as closed (`isClosed` becomes true)
   * - Rejects all pending RPC calls with `ConnectionError`
   * - Clears import/export tables, disposing all stubs
   * - Resolves the `onClosed()` promise
   *
   * Safe to call multiple times (subsequent calls are no-ops).
   * Works correctly with `Symbol.dispose` on the main stub.
   *
   * @param reason Optional error to propagate as the close reason
   */
  close(reason?: Error): void;

  /**
   * Returns a promise that resolves when the session closes.
   *
   * Resolves with:
   * - `undefined` for a clean close (no error)
   * - `Error` for abnormal close (transport error, peer abort, etc.)
   *
   * If the session is already closed, resolves immediately.
   */
  onClosed(): Promise<Error | undefined>;

  /**
   * Returns true if the session has been closed.
   *
   * Once closed, a session cannot be reopened. Any attempts to make RPC
   * calls will result in `ConnectionError`.
   */
  readonly isClosed: boolean;

  // ==========================================================================
  // Backpressure methods
  // ==========================================================================

  /**
   * Returns the current number of pending (unresolved) RPC calls.
   *
   * This is useful for monitoring session activity and implementing
   * application-level flow control.
   */
  getPendingCallCount(): number;

  /**
   * Returns true if backpressure is currently active.
   *
   * Backpressure is active when the pending call count has reached
   * the `maxPendingCalls` limit configured in session options.
   * If no limit is configured, this always returns false.
   */
  hasBackpressure(): boolean;

  /**
   * Returns a promise that resolves when pending call count drops below limit.
   *
   * If there's no backpressure (or no limit is configured), resolves immediately.
   * This is useful for implementing flow control when making many calls.
   */
  waitForDrain(): Promise<void>;

  // ==========================================================================
  // Version handshake methods
  // ==========================================================================

  /**
   * Returns a promise that resolves when version handshake completes.
   *
   * If handshake is disabled (the default), resolves immediately.
   * If handshake is enabled, waits until the protocol version has been
   * negotiated with the peer.
   */
  waitForHandshake(): Promise<void>;

  /**
   * Returns the negotiated protocol version.
   *
   * If handshake is disabled or not yet complete, returns the current
   * implementation's protocol version (e.g., "1.0").
   */
  getNegotiatedVersion(): string;

  /**
   * Returns true if version handshake has completed.
   *
   * If handshake is disabled (the default), always returns true.
   * If handshake is enabled, returns true after negotiation completes.
   */
  isHandshakeComplete(): boolean;

  // ==========================================================================
  // Session reconnection methods
  // ==========================================================================

  /**
   * Returns the current session state.
   *
   * - "active": Session is operational, RPC calls can be made
   * - "reconnecting": Session is attempting to reconnect after a disconnect
   * - "closed": Session has been shut down, RPC calls will throw ConnectionError
   */
  getState(): SessionState;

  /**
   * Returns the session ID if one was configured.
   *
   * The session ID is used for session resumption after reconnection.
   */
  getSessionId(): string | undefined;
}
export const RpcSession: {
  new <T extends RpcCompatible<T> = undefined>(
      transport: RpcTransport, localMain?: unknown, options?: RpcSessionOptions,
      isInitiator?: boolean): RpcSession<T>;
} = RpcSessionImpl as typeof RpcSession;

// RpcTarget needs some hackage too to brand it properly and account for the implementation
// conditionally being imported from "cloudflare:workers".
/**
 * Classes which are intended to be passed by reference and called over RPC must extend
 * `RpcTarget`. A class which does not extend `RpcTarget` (and which doesn't have built-in support
 * from the RPC system) cannot be passed in an RPC message at all; an exception will be thrown.
 *
 * Note that on Cloudflare Workers, this `RpcTarget` is an alias for the one exported from the
 * "cloudflare:workers" module, so they can be used interchangably.
 */
export interface RpcTarget extends RpcTargetBranded {};
export const RpcTarget: {
  new(): RpcTarget;
} = RpcTargetImpl;

/**
 * Empty interface used as default type parameter for sessions where the other side doesn't
 * necessarily export a main interface.
 */
interface Empty {}

/**
 * Start a WebSocket session given either an already-open WebSocket or a URL.
 *
 * @param webSocket Either the `wss://` URL to connect to, or an already-open WebSocket object to
 * use.
 * @param localMain The main RPC interface to expose to the peer. Returns a stub for the main
 * interface exposed from the peer.
 */
export let newWebSocketRpcSession:<T extends RpcCompatible<T> = Empty>
    (webSocket: WebSocket | string, localMain?: unknown, options?: RpcSessionOptions) => RpcStub<T> =
    newWebSocketRpcSessionImpl as typeof newWebSocketRpcSession;

/**
 * Initiate an HTTP batch session from the client side.
 *
 * The parameters to this method have exactly the same signature as `fetch()`, but the return
 * value is an RpcStub. You can customize anything about the request except for the method
 * (it will always be set to POST) and the body (which the RPC system will fill in).
 */
export let newHttpBatchRpcSession:<T extends RpcCompatible<T>>
    (urlOrRequest: string | Request, options?: RpcSessionOptions) => RpcStub<T> =
    newHttpBatchRpcSessionImpl as typeof newHttpBatchRpcSession;

/**
 * Initiate an RPC session over a MessagePort, which is particularly useful for communicating
 * between an iframe and its parent frame in a browser context. Each side should call this function
 * on its own end of the MessageChannel.
 */
export let newMessagePortRpcSession:<T extends RpcCompatible<T> = Empty>
    (port: MessagePort, localMain?: unknown, options?: RpcSessionOptions) => RpcStub<T> =
    newMessagePortRpcSessionImpl as typeof newMessagePortRpcSession;

/**
 * Options for configuring CORS behavior in `newWorkersRpcResponse`.
 *
 * SECURITY CONSIDERATIONS:
 * - By default, no CORS headers are set, meaning cross-origin requests will be blocked by browsers.
 * - Setting `allowedOrigins: "*"` allows ANY website to make requests to your API. Only use this
 *   if your API uses in-band authorization (credentials passed as RPC parameters), as ambient
 *   credentials (cookies, HTTP auth) could be exploited via CSRF attacks.
 * - When using `allowCredentials: true`, you cannot use `allowedOrigins: "*"` per CORS spec.
 *   Instead, the specific requesting origin will be reflected back, which is equivalent to "*"
 *   for CSRF purposes - use with extreme caution and only with in-band authorization.
 * - For APIs that rely on cookies or session-based authentication, always use an explicit
 *   allowlist of trusted origins.
 */
export interface WorkersRpcResponseOptions {
  /**
   * Specifies which origins are allowed to make cross-origin requests.
   *
   * - `undefined` (default): No CORS headers are set. Cross-origin requests will be blocked.
   * - `"*"`: Allows requests from any origin. SECURITY WARNING: Only safe for APIs using
   *   in-band authorization. Requires explicit opt-in as this permits any website to call your API.
   * - `string[]`: An explicit allowlist of origins (e.g., `["https://trusted.com"]`).
   *   Only these specific origins will receive CORS headers allowing cross-origin access.
   */
  allowedOrigins?: string[] | "*";

  /**
   * When true, sets `Access-Control-Allow-Credentials: true` header, allowing the request
   * to include credentials (cookies, HTTP auth, client-side certificates).
   *
   * SECURITY WARNING: When this is true and `allowedOrigins` is `"*"`, the actual origin
   * will be reflected back (since CORS spec disallows `*` with credentials). This is
   * functionally equivalent to allowing any origin with credentials - use with extreme caution.
   *
   * @default false
   */
  allowCredentials?: boolean;
}

/**
 * Helper function to compute CORS headers based on the request and options.
 *
 * SECURITY: Never allows credentials with null origin. The "null" origin is shared by
 * sandboxed iframes, file:// URLs, data: URLs, etc. Allowing credentials with null origin
 * is a CSRF vulnerability because it doesn't identify a unique origin.
 */
function computeCorsHeaders(
  request: Request,
  options?: WorkersRpcResponseOptions
): Headers {
  const headers = new Headers();

  // If no allowedOrigins specified, return empty headers (no CORS)
  if (!options?.allowedOrigins) {
    return headers;
  }

  const requestOrigin = request.headers.get("Origin");
  const { allowedOrigins, allowCredentials } = options;

  // SECURITY: Never allow credentials with null origin
  // The "null" origin is shared by sandboxed iframes, file://, data: URLs, etc.
  // Allowing credentials with null origin is a CSRF vulnerability.
  if (allowCredentials && requestOrigin === "null") {
    return headers; // Do not set any CORS headers
  }

  if (allowedOrigins === "*") {
    // Wildcard mode
    if (allowCredentials && requestOrigin) {
      // CORS spec: cannot use "*" with credentials, must reflect specific origin
      headers.set("Access-Control-Allow-Origin", requestOrigin);
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      // Standard wildcard
      headers.set("Access-Control-Allow-Origin", "*");
    }
  } else if (Array.isArray(allowedOrigins) && requestOrigin) {
    // Check if the request origin is in the allowlist
    if (allowedOrigins.includes(requestOrigin)) {
      headers.set("Access-Control-Allow-Origin", requestOrigin);
      if (allowCredentials) {
        headers.set("Access-Control-Allow-Credentials", "true");
      }
    }
    // If origin not in list, don't set any CORS headers (request will be blocked)
  }

  return headers;
}

/**
 * Applies CORS headers to a response based on the computed headers.
 */
function applyCorsHeaders(response: Response, corsHeaders: Headers): Response {
  const origin = corsHeaders.get("Access-Control-Allow-Origin");
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  const credentials = corsHeaders.get("Access-Control-Allow-Credentials");
  if (credentials) {
    response.headers.set("Access-Control-Allow-Credentials", credentials);
  }

  return response;
}

/**
 * Implements unified handling of HTTP-batch and WebSocket responses for the Cloudflare Workers
 * Runtime.
 *
 * SECURITY NOTE: By default, this function does NOT set CORS headers, meaning cross-origin
 * requests will be blocked by browsers. To allow cross-origin access, you must explicitly
 * configure the `allowedOrigins` option.
 *
 * If your API uses in-band authorization (i.e., credentials are passed as RPC method parameters
 * rather than via cookies/headers), you can safely use `allowedOrigins: "*"`. Otherwise, use
 * an explicit allowlist of trusted origins.
 *
 * WebSocket connections always allow cross-origin by browser design, so ensure your RPC API
 * authenticates users appropriately regardless of CORS settings.
 *
 * @param request - The incoming HTTP request
 * @param localMain - The RPC target object to expose
 * @param options - Optional CORS configuration
 * @returns HTTP response with appropriate headers
 *
 * @example
 * // Restrictive (default): No CORS, blocks cross-origin requests
 * return newWorkersRpcResponse(request, api);
 *
 * @example
 * // Allow specific origins (recommended for cookie-based auth)
 * return newWorkersRpcResponse(request, api, {
 *   allowedOrigins: ["https://myapp.com", "https://staging.myapp.com"]
 * });
 *
 * @example
 * // Allow any origin (only for APIs with in-band authorization)
 * return newWorkersRpcResponse(request, api, {
 *   allowedOrigins: "*"
 * });
 *
 * @example
 * // Allow credentials with specific origins
 * return newWorkersRpcResponse(request, api, {
 *   allowedOrigins: ["https://myapp.com"],
 *   allowCredentials: true
 * });
 */
export async function newWorkersRpcResponse(
  request: Request,
  localMain: unknown,
  options?: WorkersRpcResponseOptions
) {
  // Compute CORS headers once based on request and options
  const corsHeaders = computeCorsHeaders(request, options);

  if (request.method === "OPTIONS") {
    // Handle CORS preflight request
    const origin = corsHeaders.get("Access-Control-Allow-Origin");
    if (origin) {
      // Origin is allowed, return preflight success
      const preflightHeaders = new Headers(corsHeaders);
      preflightHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      preflightHeaders.set("Access-Control-Allow-Headers", "Content-Type");
      preflightHeaders.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers: preflightHeaders });
    } else {
      // Origin not allowed or no CORS configured
      return new Response("This endpoint only accepts POST or WebSocket requests.", { status: 400 });
    }
  } else if (request.method === "POST") {
    let response = await newHttpBatchRpcResponse(request, localMain);
    return applyCorsHeaders(response, corsHeaders);
  } else if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return newWorkersWebSocketRpcResponse(request, localMain);
  } else {
    let response = new Response("This endpoint only accepts POST or WebSocket requests.", { status: 400 });
    return applyCorsHeaders(response, corsHeaders);
  }
}
