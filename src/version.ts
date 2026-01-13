// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Protocol Version Module
 *
 * This module handles protocol version negotiation for Cap'n Web RPC sessions.
 * Version negotiation ensures clients and servers can communicate compatibility
 * and gracefully handle protocol differences.
 *
 * Version Format: "MAJOR.MINOR"
 * - MAJOR: Incremented for breaking changes
 * - MINOR: Incremented for backwards-compatible additions
 *
 * Compatibility Rules:
 * - Same MAJOR version = compatible (use highest common MINOR)
 * - Different MAJOR version = incompatible (connection rejected)
 */

/**
 * Current protocol version.
 *
 * Version history:
 * - 1.0: Initial release with basic RPC, promise pipelining, and capability passing
 */
export const PROTOCOL_VERSION = "1.0" as const;

/**
 * Minimum supported protocol version.
 * Connections from peers using versions older than this will be rejected.
 */
export const MIN_SUPPORTED_VERSION = "1.0" as const;

/**
 * Maximum supported protocol version.
 * Used when a peer supports multiple versions - we'll pick the highest we both support.
 */
export const MAX_SUPPORTED_VERSION = "1.0" as const;

/**
 * List of all supported protocol versions.
 * During negotiation, client sends this list; server picks the highest mutually supported version.
 */
export const SUPPORTED_VERSIONS: readonly string[] = ["1.0"] as const;

/**
 * Protocol version information.
 */
export interface ProtocolVersion {
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
}

/**
 * Result of version negotiation.
 */
export interface VersionNegotiationResult {
  /** The negotiated version to use */
  version: string;
  /** Whether the peer supports the latest features */
  isLatest: boolean;
  /** Warning message if versions differ but are compatible */
  warning?: string;
}

/**
 * Handshake message sent at the start of a session.
 */
export interface HandshakeMessage {
  /** Message type identifier */
  type: "hello";
  /** Protocol version(s) supported by the sender */
  versions: string[];
  /** Optional client/server identifier for debugging */
  clientId?: string;
  /** Index signature for RpcMessage compatibility */
  [key: string]: unknown;
}

/**
 * Handshake acknowledgment message.
 */
export interface HandshakeAckMessage {
  /** Message type identifier */
  type: "hello-ack";
  /** The selected protocol version */
  selectedVersion: string;
  /** Optional server identifier for debugging */
  serverId?: string;
  /** Index signature for RpcMessage compatibility */
  [key: string]: unknown;
}

/**
 * Handshake rejection message.
 */
export interface HandshakeRejectMessage {
  /** Message type identifier */
  type: "hello-reject";
  /** Reason for rejection */
  reason: string;
  /** Versions supported by the rejecting party */
  supportedVersions: string[];
  /** Index signature for RpcMessage compatibility */
  [key: string]: unknown;
}

/**
 * Union type for all handshake messages.
 */
export type HandshakeMessageType = HandshakeMessage | HandshakeAckMessage | HandshakeRejectMessage;

/**
 * Parse a version string into major and minor components.
 *
 * @param version - Version string in "MAJOR.MINOR" format
 * @returns Parsed version object
 * @throws Error if version format is invalid
 */
export function parseVersion(version: string): ProtocolVersion {
  const parts = version.split(".");
  if (parts.length !== 2) {
    throw new Error(`Invalid protocol version format: "${version}". Expected "MAJOR.MINOR".`);
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);

  if (isNaN(major) || isNaN(minor) || major < 0 || minor < 0) {
    throw new Error(`Invalid protocol version numbers: "${version}".`);
  }

  return { major, minor };
}

/**
 * Compare two version strings.
 *
 * @param a - First version
 * @param b - Second version
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (vA.major !== vB.major) {
    return vA.major < vB.major ? -1 : 1;
  }
  if (vA.minor !== vB.minor) {
    return vA.minor < vB.minor ? -1 : 1;
  }
  return 0;
}

/**
 * Check if two versions are compatible.
 * Versions are compatible if they have the same major version.
 *
 * @param a - First version
 * @param b - Second version
 * @returns True if versions are compatible
 */
export function areVersionsCompatible(a: string, b: string): boolean {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  return vA.major === vB.major;
}

/**
 * Check if a version is supported by this implementation.
 *
 * @param version - Version to check
 * @returns True if the version is supported
 */
export function isVersionSupported(version: string): boolean {
  try {
    const v = parseVersion(version);
    const min = parseVersion(MIN_SUPPORTED_VERSION);
    const max = parseVersion(MAX_SUPPORTED_VERSION);

    // Must be same major version and within min/max range
    if (v.major !== min.major) {
      return false;
    }
    if (v.minor < min.minor || v.minor > max.minor) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the best compatible version from a list of offered versions.
 *
 * @param offeredVersions - Versions offered by the peer
 * @param supportedVersions - Versions supported by this implementation (default: SUPPORTED_VERSIONS)
 * @returns The best compatible version, or null if no compatible version exists
 */
export function negotiateVersion(
  offeredVersions: string[],
  supportedVersions: readonly string[] = SUPPORTED_VERSIONS
): string | null {
  // Find all versions that both sides support
  const compatible: string[] = [];

  for (const offered of offeredVersions) {
    for (const supported of supportedVersions) {
      if (areVersionsCompatible(offered, supported)) {
        // Use the lower of the two compatible versions
        const cmp = compareVersions(offered, supported);
        compatible.push(cmp <= 0 ? offered : supported);
      }
    }
  }

  if (compatible.length === 0) {
    return null;
  }

  // Return the highest compatible version
  return compatible.sort(compareVersions).pop()!;
}

/**
 * Perform version negotiation and return detailed result.
 *
 * @param offeredVersions - Versions offered by the peer
 * @returns Negotiation result with selected version and any warnings
 */
export function negotiateVersionWithDetails(
  offeredVersions: string[]
): VersionNegotiationResult | null {
  const selected = negotiateVersion(offeredVersions);
  if (!selected) {
    return null;
  }

  const isLatest = selected === PROTOCOL_VERSION;
  let warning: string | undefined;

  if (!isLatest) {
    warning = `Peer is using protocol version ${selected}, but this implementation ` +
              `supports up to ${PROTOCOL_VERSION}. Some features may not be available.`;
  }

  return {
    version: selected,
    isLatest,
    warning,
  };
}

/**
 * Create a handshake hello message.
 *
 * @param clientId - Optional client identifier for debugging
 * @returns Handshake message object
 */
export function createHelloMessage(clientId?: string): HandshakeMessage {
  return {
    type: "hello",
    versions: [...SUPPORTED_VERSIONS],
    clientId,
  };
}

/**
 * Create a handshake acknowledgment message.
 *
 * @param selectedVersion - The negotiated version
 * @param serverId - Optional server identifier for debugging
 * @returns Handshake acknowledgment message object
 */
export function createHelloAckMessage(selectedVersion: string, serverId?: string): HandshakeAckMessage {
  return {
    type: "hello-ack",
    selectedVersion,
    serverId,
  };
}

/**
 * Create a handshake rejection message.
 *
 * @param reason - Reason for rejection
 * @returns Handshake rejection message object
 */
export function createHelloRejectMessage(reason: string): HandshakeRejectMessage {
  return {
    type: "hello-reject",
    reason,
    supportedVersions: [...SUPPORTED_VERSIONS],
  };
}

/**
 * Check if a message is a handshake message.
 *
 * @param message - Parsed JSON message
 * @returns True if the message is a handshake message
 */
export function isHandshakeMessage(message: unknown): message is HandshakeMessageType {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const type = (message as { type?: unknown }).type;
  return type === "hello" || type === "hello-ack" || type === "hello-reject";
}

/**
 * Format a version string for display.
 *
 * @param version - Version string
 * @returns Human-readable version string
 */
export function formatVersion(version: string): string {
  return `v${version}`;
}
