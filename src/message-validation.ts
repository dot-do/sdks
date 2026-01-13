// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { SerializationError } from "./errors.js";

// ============================================================================
// Message Validation
// ============================================================================

/**
 * Maximum message size in bytes (10MB default).
 * Messages larger than this will be rejected before parsing.
 */
export const MAX_MESSAGE_SIZE = 10 * 1024 * 1024;

/**
 * Maximum recursion depth for nested objects/arrays (100 levels default).
 * Messages with deeper nesting will be rejected during deserialization.
 */
export const MAX_RECURSION_DEPTH = 100;

/**
 * Valid RPC message types and their minimum required arity (excluding the type itself).
 * For example, "push" requires at least 1 argument: ["push", Expression]
 */
const MESSAGE_ARITY: Record<string, { min: number; max?: number; argTypes?: string[] }> = {
  "push": { min: 1, argTypes: ["Expression"] },
  "pull": { min: 1, argTypes: ["number (ImportId)"] },
  "resolve": { min: 2, argTypes: ["number (ExportId)", "Expression"] },
  "reject": { min: 2, argTypes: ["number (ExportId)", "Expression"] },
  "release": { min: 2, argTypes: ["number (ExportId)", "number (refcount)"] },
  "pipeline": { min: 2, argTypes: ["ImportId", "path", "args?"] },
  "hello": { min: 0 }, // Handshake message - handled separately
  "hello-ack": { min: 0 }, // Handshake message - handled separately
  "hello-reject": { min: 0 }, // Handshake message - handled separately
  "abort": { min: 1, argTypes: ["Expression"] },
};

const VALID_MESSAGE_TYPES = Object.keys(MESSAGE_ARITY);

/**
 * Validates that a parsed message has the correct structure.
 * Throws SerializationError with descriptive messages for invalid messages.
 *
 * @param msg - The parsed message to validate
 * @throws SerializationError if the message is invalid
 */
export function validateMessage(msg: unknown): void {
  // Check that message is an array
  if (!Array.isArray(msg)) {
    throw new SerializationError(
      `Invalid message format: message must be an array, got ${typeof msg}`,
      true
    );
  }

  // Check that array is not empty
  if (msg.length === 0) {
    throw new SerializationError(
      `Invalid message format: message array is empty. ` +
      `Expected a message type followed by arguments.`,
      true
    );
  }

  // Check that first element (message type) is a string
  const msgType = msg[0];
  if (typeof msgType !== "string") {
    throw new SerializationError(
      `Invalid message format: message type must be a string, got ${typeof msgType}`,
      true
    );
  }

  // Check for array holes (sparse arrays)
  for (let i = 0; i < msg.length; i++) {
    if (!(i in msg)) {
      throw new SerializationError(
        `Invalid message format: message array has a hole at index ${i}. ` +
        `Sparse arrays are not allowed.`,
        true
      );
    }
  }

  // Check that message type is valid
  const aritySpec = MESSAGE_ARITY[msgType];
  if (!aritySpec) {
    throw new SerializationError(
      `Invalid message format: unknown message type '${msgType}'. ` +
      `Valid types are: ${VALID_MESSAGE_TYPES.join(", ")}`,
      true
    );
  }

  // Check arity (number of arguments)
  const argCount = msg.length - 1; // Subtract 1 for the message type
  if (argCount < aritySpec.min) {
    const argDesc = aritySpec.argTypes
      ? aritySpec.argTypes.join(", ")
      : `${aritySpec.min} argument(s)`;
    throw new SerializationError(
      `Invalid '${msgType}' message: requires at least ${aritySpec.min} argument(s) ` +
      `(${argDesc}), but got ${argCount}`,
      true
    );
  }

  // Validate specific argument types for each message type
  switch (msgType) {
    case "pull": {
      const importId = msg[1];
      if (typeof importId !== "number") {
        throw new SerializationError(
          `Invalid 'pull' message: ImportId (argument 1) must be a number, ` +
          `got ${typeof importId} ('${String(importId)}')`,
          true
        );
      }
      break;
    }

    case "resolve":
    case "reject": {
      const exportId = msg[1];
      if (typeof exportId !== "number") {
        throw new SerializationError(
          `Invalid '${msgType}' message: ExportId (argument 1) must be a number, ` +
          `got ${typeof exportId} ('${String(exportId)}')`,
          true
        );
      }
      break;
    }

    case "release": {
      const exportId = msg[1];
      const refcount = msg[2];
      if (typeof exportId !== "number") {
        throw new SerializationError(
          `Invalid 'release' message: ExportId (argument 1) must be a number, ` +
          `got ${typeof exportId}`,
          true
        );
      }
      if (typeof refcount !== "number") {
        throw new SerializationError(
          `Invalid 'release' message: refcount (argument 2) must be a number, ` +
          `got ${typeof refcount}`,
          true
        );
      }
      break;
    }
  }
}

/**
 * Checks the size of a message string and throws if it exceeds the limit.
 *
 * @param messageStr - The raw message string to check
 * @param maxSize - Maximum allowed size in bytes (default: MAX_MESSAGE_SIZE)
 * @throws SerializationError if the message exceeds the size limit
 */
export function checkMessageSize(messageStr: string, maxSize: number = MAX_MESSAGE_SIZE): void {
  if (messageStr.length > maxSize) {
    const sizeMB = (messageStr.length / (1024 * 1024)).toFixed(2);
    const limitMB = (maxSize / (1024 * 1024)).toFixed(0);
    throw new SerializationError(
      `Message size limit exceeded: message is ${sizeMB}MB (${messageStr.length} bytes), ` +
      `but maximum allowed is ${limitMB}MB (${maxSize} bytes)`,
      true
    );
  }
}

/**
 * Checks the recursion depth of a value and throws if it exceeds the limit.
 *
 * @param value - The value to check
 * @param maxDepth - Maximum allowed depth (default: MAX_RECURSION_DEPTH)
 * @throws SerializationError if the value exceeds the depth limit
 */
export function checkRecursionDepth(value: unknown, maxDepth: number = MAX_RECURSION_DEPTH): void {
  function measureDepth(val: unknown, currentDepth: number): number {
    if (currentDepth > maxDepth) {
      throw new SerializationError(
        `Maximum recursion depth exceeded: message nesting depth exceeds ${maxDepth} levels. ` +
        `This may indicate a malformed or malicious message.`,
        true
      );
    }

    if (Array.isArray(val)) {
      let maxChildDepth = currentDepth;
      for (const item of val) {
        maxChildDepth = Math.max(maxChildDepth, measureDepth(item, currentDepth + 1));
      }
      return maxChildDepth;
    }

    if (val !== null && typeof val === "object") {
      let maxChildDepth = currentDepth;
      for (const key in val) {
        if (Object.prototype.hasOwnProperty.call(val, key)) {
          maxChildDepth = Math.max(maxChildDepth, measureDepth((val as Record<string, unknown>)[key], currentDepth + 1));
        }
      }
      return maxChildDepth;
    }

    return currentDepth;
  }

  measureDepth(value, 0);
}
