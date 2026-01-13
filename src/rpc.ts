// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * This file re-exports the RPC system components from their individual modules.
 * The implementation has been split into:
 * - message-validation.ts: Message validation logic
 * - embargo.ts: EmbargoedStubHook, EmbargoedCallStubHook classes
 * - import-export.ts: Import/Export table management
 * - session.ts: RpcSession class and lifecycle management
 *
 * This file maintains backwards compatibility by re-exporting the public API.
 */

// Re-export message validation
export {
  MAX_MESSAGE_SIZE,
  MAX_RECURSION_DEPTH,
  validateMessage,
  checkMessageSize,
  checkRecursionDepth,
} from "./message-validation.js";

// Re-export session types and classes
export type {
  RpcTransport,
  RpcSessionOptions,
  RpcMessage,
} from "./session.js";

export { RpcSession } from "./session.js";
