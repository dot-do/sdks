// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Handshake Handler Module
 *
 * This module handles protocol version negotiation for RPC sessions.
 * It manages the handshake state machine and version negotiation logic.
 */

import {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  negotiateVersion,
  createHelloMessage,
  createHelloAckMessage,
  createHelloRejectMessage,
  formatVersion,
  type HandshakeMessage,
  type HandshakeAckMessage,
  type HandshakeRejectMessage,
} from "./version.js";
import { VersionMismatchError } from "./errors.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for handshake behavior.
 */
export interface HandshakeOptions {
  /**
   * If true, perform protocol version negotiation handshake at session start.
   * Default: false (no handshake for backwards compatibility)
   */
  enableVersionHandshake?: boolean;

  /**
   * Identifier for this client/server, sent during handshake for debugging purposes.
   */
  peerId?: string;

  /**
   * Called when version negotiation completes successfully.
   * @param version - The negotiated protocol version
   * @param isLatest - Whether this is the latest supported version
   */
  onVersionNegotiated?: (version: string, isLatest: boolean) => void;

  /**
   * Called when there's a version mismatch warning (compatible but not optimal).
   * @param warning - Description of the version mismatch
   */
  onVersionWarning?: (warning: string) => void;
}

/**
 * Callback type for sending messages.
 */
export type SendCallback = (msg: unknown) => void;

/**
 * Callback type for aborting the session.
 */
export type AbortCallback = (error: unknown, trySendAbortMessage?: boolean) => void;

// ============================================================================
// HandshakeHandler Class
// ============================================================================

/**
 * Handles protocol version negotiation for RPC sessions.
 *
 * The handshake follows this protocol:
 * 1. Initiator sends "hello" with supported versions
 * 2. Responder sends "hello-ack" with selected version, or "hello-reject" if incompatible
 * 3. Both sides use the negotiated version for the session
 *
 * For backwards compatibility, if handshake is disabled or a peer doesn't support
 * version negotiation, the current protocol version is assumed.
 */
export class HandshakeHandler {
  #negotiatedVersion: string = PROTOCOL_VERSION;
  #handshakeComplete: boolean = false;
  #handshakeResolver?: PromiseWithResolvers<void>;
  #isInitiator: boolean;
  #options: HandshakeOptions;
  #send: SendCallback;
  #abort: AbortCallback;

  /**
   * Creates a new HandshakeHandler.
   *
   * @param options - Handshake configuration options
   * @param isInitiator - Whether this side initiates the handshake
   * @param send - Callback to send messages
   * @param abort - Callback to abort the session
   */
  constructor(
    options: HandshakeOptions,
    isInitiator: boolean,
    send: SendCallback,
    abort: AbortCallback
  ) {
    this.#options = options;
    this.#isInitiator = isInitiator;
    this.#send = send;
    this.#abort = abort;

    if (options.enableVersionHandshake) {
      // Set up handshake resolver
      this.#handshakeResolver = Promise.withResolvers<void>();
    } else {
      // Skip handshake, mark as complete immediately
      this.#handshakeComplete = true;
    }
  }

  /**
   * Start the handshake by sending a hello message (if initiator).
   */
  start(): void {
    if (this.#options.enableVersionHandshake && this.#isInitiator) {
      this.#sendHello();
    }
  }

  /**
   * Get the negotiated protocol version.
   */
  getNegotiatedVersion(): string {
    return this.#negotiatedVersion;
  }

  /**
   * Check if the handshake has completed.
   */
  isHandshakeComplete(): boolean {
    return this.#handshakeComplete;
  }

  /**
   * Wait for the handshake to complete.
   */
  async waitForHandshake(): Promise<void> {
    if (this.#handshakeComplete) {
      return;
    }
    if (this.#handshakeResolver) {
      await this.#handshakeResolver.promise;
    }
  }

  /**
   * Handle a received hello message.
   * @param msg - The hello message from the peer
   */
  handleHello(msg: HandshakeMessage): void {
    const negotiated = negotiateVersion(msg.versions);

    if (!negotiated) {
      // No compatible version found
      const reject = createHelloRejectMessage(
        `No compatible protocol version. Peer supports: ${msg.versions.join(", ")}. ` +
        `This implementation supports: ${SUPPORTED_VERSIONS.join(", ")}.`
      );
      this.#send(reject);
      this.#abort(new VersionMismatchError(
        `Protocol version mismatch: peer supports ${msg.versions.join(", ")}, ` +
        `but this implementation supports ${SUPPORTED_VERSIONS.join(", ")}`,
        [...SUPPORTED_VERSIONS],
        msg.versions
      ), false);
      return;
    }

    // Send acknowledgment
    const ack = createHelloAckMessage(negotiated, this.#options.peerId);
    this.#send(ack);

    // Complete handshake with negotiated version
    this.#completeHandshake(negotiated);
  }

  /**
   * Handle a received hello acknowledgment message.
   * @param msg - The hello-ack message from the peer
   */
  handleHelloAck(msg: HandshakeAckMessage): void {
    // Verify the selected version is one we support
    const selected = msg.selectedVersion;
    const negotiated = negotiateVersion([selected]);

    if (!negotiated) {
      this.#abort(new VersionMismatchError(
        `Server selected unsupported protocol version: ${selected}`,
        [...SUPPORTED_VERSIONS],
        [selected]
      ), false);
      return;
    }

    // Complete handshake with selected version
    this.#completeHandshake(selected);
  }

  /**
   * Handle a received hello rejection message.
   * @param msg - The hello-reject message from the peer
   */
  handleHelloReject(msg: HandshakeRejectMessage): void {
    this.#abort(new VersionMismatchError(
      `Server rejected connection: ${msg.reason}`,
      [...SUPPORTED_VERSIONS],
      msg.supportedVersions
    ), false);
  }

  /**
   * Handle receiving an RPC message before handshake completes.
   * For backwards compatibility, assume peer doesn't support version negotiation.
   */
  handleEarlyMessage(): void {
    if (!this.#handshakeComplete && this.#options.enableVersionHandshake) {
      // Allow messages from peers that don't support versioning (for backwards compatibility)
      console.warn(
        `Received RPC message before handshake complete. ` +
        `Assuming peer does not support version negotiation.`
      );
      this.#handshakeComplete = true;
      this.#negotiatedVersion = PROTOCOL_VERSION;
      if (this.#handshakeResolver) {
        this.#handshakeResolver.resolve();
        this.#handshakeResolver = undefined;
      }
    }
  }

  /**
   * Send a hello message to initiate version negotiation.
   */
  #sendHello(): void {
    const hello = createHelloMessage(this.#options.peerId);
    this.#send(hello);
  }

  /**
   * Complete the handshake with a negotiated version.
   * @param negotiatedVersion - The version both sides agreed upon
   */
  #completeHandshake(negotiatedVersion: string): void {
    this.#negotiatedVersion = negotiatedVersion;
    this.#handshakeComplete = true;

    // Notify callbacks
    const isLatest = negotiatedVersion === PROTOCOL_VERSION;
    this.#options.onVersionNegotiated?.(negotiatedVersion, isLatest);

    if (!isLatest) {
      this.#options.onVersionWarning?.(
        `Negotiated protocol version ${formatVersion(negotiatedVersion)} is not the latest ` +
        `(${formatVersion(PROTOCOL_VERSION)}). Some features may not be available.`
      );
    }

    // Resolve handshake promise
    this.#handshakeResolver?.resolve();
    this.#handshakeResolver = undefined;
  }
}
