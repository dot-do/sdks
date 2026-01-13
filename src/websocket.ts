// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/// <reference types="@cloudflare/workers-types" />

import { RpcStub } from "./core.js";
import { RpcSession, RpcSessionOptions } from "./rpc.js";
import { BaseTransport } from "./transports/base.js";

export function newWebSocketRpcSession(
    webSocket: WebSocket | string, localMain?: unknown, options?: RpcSessionOptions): RpcStub {
  if (typeof webSocket === "string") {
    webSocket = new WebSocket(webSocket);
  }

  let transport = new WebSocketTransport(webSocket);
  // Client-initiated WebSocket connections are initiators
  let rpc = new RpcSession(transport, localMain, options, /*isInitiator=*/true);
  return rpc.getRemoteMain();
}

/**
 * For use in Cloudflare Workers: Construct an HTTP response that starts a WebSocket RPC session
 * with the given `localMain`.
 */
export function newWorkersWebSocketRpcResponse(
    request: Request, localMain?: unknown, options?: RpcSessionOptions): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
  }

  let pair = new WebSocketPair();
  let server = pair[0];
  server.accept()
  // Server-side WebSocket connections are not initiators (they wait for client's hello)
  let transport = new WebSocketTransport(server);
  new RpcSession(transport, localMain, options, /*isInitiator=*/false);
  return new Response(null, {
    status: 101,
    webSocket: pair[1],
  });
}

class WebSocketTransport extends BaseTransport {
  #webSocket: WebSocket;
  #sendQueue?: string[];  // only if not opened yet

  constructor (webSocket: WebSocket) {
    super();
    this.#webSocket = webSocket;

    if (webSocket.readyState === WebSocket.CONNECTING) {
      // Start in connecting state, queue messages until open
      this.#sendQueue = [];
      webSocket.addEventListener("open", event => {
        // Transition to connected state
        this.transitionToConnected();
        try {
          for (let message of this.#sendQueue!) {
            webSocket.send(message);
          }
        } catch (err) {
          this.setError(err);
        }
        this.#sendQueue = undefined;
      });
    } else if (webSocket.readyState === WebSocket.OPEN) {
      // Already open (e.g., server-side after accept()), transition to connected immediately
      this.transitionToConnected();
    }
    // Note: If readyState is CLOSING or CLOSED, we stay in connecting state
    // until we receive the close/error event which will transition to error

    webSocket.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (this.error) {
        // Ignore further messages.
      } else if (typeof event.data === "string") {
        this.enqueue(event.data);
      } else {
        this.setError(new TypeError("Received non-string message from WebSocket."));
      }
    });

    webSocket.addEventListener("close", (event: CloseEvent) => {
      this.setError(new Error(`Peer closed WebSocket: ${event.code} ${event.reason}`));
    });

    webSocket.addEventListener("error", (event: Event) => {
      this.setError(new Error(`WebSocket connection failed.`));
    });
  }

  /**
   * Override send() to not throw on error.
   * WebSocket transport ignores errors during send and relies on receive() to surface them.
   */
  async send(message: string): Promise<void> {
    return this.doSend(message);
  }

  protected async doSend(message: string): Promise<void> {
    if (this.#sendQueue === undefined) {
      this.#webSocket.send(message);
    } else {
      // Not open yet, queue for later.
      this.#sendQueue.push(message);
    }
  }

  protected doAbort(reason: unknown): void {
    let message: string;
    if (reason instanceof Error) {
      message = reason.message;
    } else {
      message = `${reason}`;
    }
    this.#webSocket.close(3000, message);
  }
}
