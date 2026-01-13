// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Message Processor Module
 *
 * This module handles the parsing and routing of RPC messages.
 * It provides a clean separation between message parsing/validation
 * and the actual message handling logic.
 */

import { validateMessage, checkMessageSize, checkRecursionDepth } from "./message-validation.js";
import {
  isHandshakeMessage,
  type HandshakeMessage,
  type HandshakeAckMessage,
  type HandshakeRejectMessage,
} from "./version.js";
import { ExportId } from "./serialize.js";
import type { ImportId } from "./serialize.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of parsing an RPC message.
 * Note: Invalid messages throw errors rather than returning an "invalid" type,
 * as this matches the behavior of the underlying validateMessage function.
 */
export type ParsedMessage =
  | { type: "handshake"; subtype: "hello"; message: HandshakeMessage }
  | { type: "handshake"; subtype: "hello-ack"; message: HandshakeAckMessage }
  | { type: "handshake"; subtype: "hello-reject"; message: HandshakeRejectMessage }
  | { type: "push"; expression: unknown }
  | { type: "pull"; exportId: ExportId }
  | { type: "resolve"; importId: ImportId; expression: unknown }
  | { type: "reject"; importId: ImportId; expression: unknown }
  | { type: "release"; exportId: ExportId; refcount: number }
  | { type: "abort"; expression: unknown };

/**
 * Interface for message handlers.
 * Each method handles a specific message type and returns a boolean
 * indicating whether the message was handled successfully.
 */
export interface MessageHandler {
  /**
   * Handle a hello message during handshake.
   */
  handleHello(msg: HandshakeMessage): boolean;

  /**
   * Handle a hello-ack message during handshake.
   */
  handleHelloAck(msg: HandshakeAckMessage): boolean;

  /**
   * Handle a hello-reject message during handshake.
   */
  handleHelloReject(msg: HandshakeRejectMessage): boolean;

  /**
   * Handle a push message (incoming call or value).
   */
  handlePush(expression: unknown): boolean;

  /**
   * Handle a pull message (request for resolution).
   */
  handlePull(exportId: ExportId): boolean;

  /**
   * Handle a resolve message (promise resolution).
   */
  handleResolve(importId: ImportId, expression: unknown): boolean;

  /**
   * Handle a reject message (promise rejection).
   */
  handleReject(importId: ImportId, expression: unknown): boolean;

  /**
   * Handle a release message (decrement refcount).
   */
  handleRelease(exportId: ExportId, refcount: number): boolean;

  /**
   * Handle an abort message (session abort).
   */
  handleAbort(expression: unknown): boolean;

  /**
   * Called when handshake is enabled but a non-handshake message arrives early.
   * The handler should decide whether to allow this (backwards compatibility)
   * or reject it.
   */
  handleEarlyMessage(): void;

  /**
   * Check if the session has been aborted.
   */
  isAborted(): boolean;

  /**
   * Check if handshake is complete.
   */
  isHandshakeComplete(): boolean;

  /**
   * Check if version handshake is enabled.
   */
  isVersionHandshakeEnabled(): boolean;
}

// ============================================================================
// Message Parser
// ============================================================================

/**
 * Parses a raw message string into a structured ParsedMessage.
 * Performs validation including size checks and recursion depth.
 *
 * @param rawMessage - The raw JSON string message
 * @returns ParsedMessage - The parsed and validated message
 * @throws SerializationError if message is invalid, oversized, or has excessive recursion depth
 * @throws SyntaxError if JSON parsing fails
 */
export function parseMessage(rawMessage: string): ParsedMessage {
  // Check message size before parsing
  checkMessageSize(rawMessage);

  const msg = JSON.parse(rawMessage);

  // Check recursion depth after parsing
  checkRecursionDepth(msg);

  // Handle handshake messages first (before validateMessage, as they have different structure)
  if (isHandshakeMessage(msg)) {
    switch (msg.type) {
      case "hello":
        return { type: "handshake", subtype: "hello", message: msg as HandshakeMessage };
      case "hello-ack":
        return { type: "handshake", subtype: "hello-ack", message: msg as HandshakeAckMessage };
      case "hello-reject":
        return { type: "handshake", subtype: "hello-reject", message: msg as HandshakeRejectMessage };
    }
  }

  // Validate message structure - this will throw for invalid messages
  validateMessage(msg);

  // At this point, validation has passed, so we can safely extract the parsed message.
  // The validateMessage function ensures proper structure, so these conditions should
  // always succeed for validated messages.
  const msgType = msg[0];

  switch (msgType) {
    case "push":
      return { type: "push", expression: msg[1] };

    case "pull":
      return { type: "pull", exportId: msg[1] as ExportId };

    case "resolve":
      return { type: "resolve", importId: msg[1] as ImportId, expression: msg[2] };

    case "reject":
      return { type: "reject", importId: msg[1] as ImportId, expression: msg[2] };

    case "release":
      return { type: "release", exportId: msg[1] as ExportId, refcount: msg[2] };

    case "abort":
      return { type: "abort", expression: msg[1] };

    default:
      // This should not be reached if validateMessage is working correctly,
      // but we include it for type safety
      throw new Error(`Unexpected message type after validation: ${msgType}`);
  }
}

// ============================================================================
// Message Processor
// ============================================================================

/**
 * Processes RPC messages and dispatches them to the appropriate handlers.
 * This class provides a clean separation between parsing and handling.
 */
export class MessageProcessor {
  #handler: MessageHandler;

  /**
   * Creates a new MessageProcessor.
   *
   * @param handler - The handler that will process parsed messages
   */
  constructor(handler: MessageHandler) {
    this.#handler = handler;
  }

  /**
   * Process a raw message string.
   *
   * @param rawMessage - The raw JSON string message
   * @returns true if the message was valid and handled successfully
   * @throws SerializationError if the message is invalid
   */
  processMessage(rawMessage: string): boolean {
    // If already aborted, skip processing
    if (this.#handler.isAborted()) {
      return true;
    }

    // parseMessage will throw for invalid messages
    const parsed = parseMessage(rawMessage);

    // Handle handshake messages first
    if (parsed.type === "handshake") {
      switch (parsed.subtype) {
        case "hello":
          return this.#handler.handleHello(parsed.message);
        case "hello-ack":
          return this.#handler.handleHelloAck(parsed.message);
        case "hello-reject":
          return this.#handler.handleHelloReject(parsed.message);
      }
    }

    // Check for early non-handshake messages
    if (!this.#handler.isHandshakeComplete() && this.#handler.isVersionHandshakeEnabled()) {
      this.#handler.handleEarlyMessage();
    }

    // Handle RPC messages
    switch (parsed.type) {
      case "push":
        return this.#handler.handlePush(parsed.expression);

      case "pull":
        return this.#handler.handlePull(parsed.exportId);

      case "resolve":
        return this.#handler.handleResolve(parsed.importId, parsed.expression);

      case "reject":
        return this.#handler.handleReject(parsed.importId, parsed.expression);

      case "release":
        return this.#handler.handleRelease(parsed.exportId, parsed.refcount);

      case "abort":
        return this.#handler.handleAbort(parsed.expression);

      default:
        // TypeScript exhaustiveness check - this should never be reached
        const _exhaustive: never = parsed;
        return false;
    }
  }
}
