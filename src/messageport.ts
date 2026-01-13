// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { RpcStub } from "./core.js";
import { RpcSession, RpcSessionOptions } from "./rpc.js";
import { BaseTransport } from "./transports/base.js";

// Start a MessagePort session given a MessagePort or a pair of MessagePorts.
//
// `localMain` is the main RPC interface to expose to the peer. Returns a stub for the main
// interface exposed from the peer.
//
// For MessagePort, either side can be the initiator. By default, we assume this side
// is the initiator. Pass `isInitiator: false` in options if connecting to a parent frame
// that will initiate the handshake.
export function newMessagePortRpcSession(
    port: MessagePort, localMain?: unknown, options?: RpcSessionOptions & { isInitiator?: boolean }): RpcStub {
  let transport = new MessagePortTransport(port);
  // Default to being the initiator for MessagePort connections
  let isInitiator = options?.isInitiator ?? true;
  let rpc = new RpcSession(transport, localMain, options, isInitiator);
  return rpc.getRemoteMain();
}

class MessagePortTransport extends BaseTransport {
  #port: MessagePort;

  constructor (port: MessagePort) {
    super();
    this.#port = port;

    // Start listening for messages
    port.start();

    // MessagePort is immediately ready after start(), transition to connected
    this.transitionToConnected();

    port.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (this.error) {
        // Ignore further messages.
      } else if (event.data === null) {
        // Peer is signaling that they're closing the connection
        this.setError(new Error("Peer closed MessagePort connection."));
      } else if (typeof event.data === "string") {
        this.enqueue(event.data);
      } else {
        this.setError(new TypeError("Received non-string message from MessagePort."));
      }
    });

    port.addEventListener("messageerror", (event: MessageEvent) => {
      this.setError(new Error("MessagePort message error."));
    });
  }

  protected async doSend(message: string): Promise<void> {
    this.#port.postMessage(message);
  }

  protected doAbort(reason: unknown): void {
    // Send close signal to peer before closing
    try {
      this.#port.postMessage(null);
    } catch (err) {
      // Ignore errors when sending close signal - port might already be closed
    }

    this.#port.close();
  }
}