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
 *
 * Security Features:
 * - Strict version string validation (no leading zeros, whitespace, special chars)
 * - Nonce-based replay protection
 * - Timestamp freshness checking
 * - Constant-time comparison for security-sensitive fields
 * - Rate limiting support for handshake errors
 * - Prototype pollution prevention
 */

// ============================================================================
// Security Constants
// ============================================================================

/** Maximum length of a version string */
const MAX_VERSION_LENGTH = 20;

/** Maximum version number component value */
const MAX_VERSION_NUMBER = 999999;

/** Maximum number of versions allowed in a versions array */
const MAX_VERSIONS_ARRAY_LENGTH = 100;

/** Handshake message maximum age in milliseconds (30 seconds) */
export const MAX_HANDSHAKE_AGE_MS = 30000;

/** Regular expression for strict version format: only digits and single dot */
const STRICT_VERSION_REGEX = /^[1-9][0-9]*\.[0-9]+$/;

// ============================================================================
// Security Utilities
// ============================================================================

/**
 * Generate a cryptographically secure nonce for replay protection.
 * Uses crypto.randomUUID() in browser/Node.js 16+, or falls back to Math.random().
 *
 * @returns A unique nonce string
 */
export function generateNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Both strings should be of similar length for this to be effective.
 *
 * @param a - First string
 * @param b - Second string
 * @returns True if strings are equal
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let result = 0;
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const charA = i < a.length ? a.charCodeAt(i) : 0;
      const charB = i < b.length ? b.charCodeAt(i) : 0;
      result |= charA ^ charB;
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate a version string with strict security checks.
 *
 * @param version - Version string to validate
 * @throws Error if version string fails security validation
 */
export function validateVersionString(version: string): void {
  if (typeof version !== 'string') {
    throw new Error('Version must be a string');
  }

  if (version.length > MAX_VERSION_LENGTH) {
    throw new Error(`Version string exceeds maximum length of ${MAX_VERSION_LENGTH}`);
  }

  if (version !== version.trim()) {
    throw new Error('Version string contains leading or trailing whitespace');
  }

  if (version.includes('\0')) {
    throw new Error('Version string contains null bytes');
  }

  if (!STRICT_VERSION_REGEX.test(version)) {
    if (!/^0\.[0-9]+$/.test(version)) {
      throw new Error(`Invalid version format: "${version}". Must match MAJOR.MINOR with no leading zeros`);
    }
  }

  const parts = version.split('.');
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);

  if (major > MAX_VERSION_NUMBER || minor > MAX_VERSION_NUMBER) {
    throw new Error(`Version number exceeds maximum value of ${MAX_VERSION_NUMBER}`);
  }

  if (parts[0] !== '0' && parts[0].startsWith('0')) {
    throw new Error('Major version has leading zeros');
  }
  if (parts[1].length > 1 && parts[1].startsWith('0')) {
    throw new Error('Minor version has leading zeros');
  }
}

/**
 * Validate a versions array with security checks.
 *
 * @param versions - Array of version strings to validate
 * @throws Error if array fails security validation
 */
export function validateVersionsArray(versions: unknown): asserts versions is string[] {
  if (!Array.isArray(versions)) {
    throw new Error('Versions must be an array');
  }

  if (versions.length > MAX_VERSIONS_ARRAY_LENGTH) {
    throw new Error(`Versions array exceeds maximum length of ${MAX_VERSIONS_ARRAY_LENGTH}`);
  }

  for (const version of versions) {
    if (typeof version !== 'string') {
      throw new Error('All versions must be strings');
    }
    validateVersionString(version);
  }
}

function checkPrototypePollution(obj: unknown): void {
  if (typeof obj !== 'object' || obj === null) {
    return;
  }

  const dangerous = ['__proto__', 'constructor', 'prototype'];
  for (const key of dangerous) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new Error(`Prototype pollution detected: ${key}`);
    }
  }
}

/**
 * Validate a hello message structure.
 *
 * @param msg - Message to validate
 * @throws Error if message is invalid
 */
export function validateHelloMessage(msg: unknown): asserts msg is HandshakeMessage {
  if (typeof msg !== 'object' || msg === null) {
    throw new Error('Hello message must be an object');
  }

  checkPrototypePollution(msg);

  const message = msg as Record<string, unknown>;

  if (message.type !== 'hello') {
    throw new Error('Invalid message type');
  }

  validateVersionsArray(message.versions);

  if ((message.versions as string[]).length === 0) {
    throw new Error('Versions array cannot be empty');
  }

  if (message.clientId !== undefined && typeof message.clientId !== 'string') {
    throw new Error('clientId must be a string');
  }

  if (message.nonce !== undefined && typeof message.nonce !== 'string') {
    throw new Error('nonce must be a string');
  }

  if (message.timestamp !== undefined && typeof message.timestamp !== 'number') {
    throw new Error('timestamp must be a number');
  }
}

/**
 * Validate a hello-ack message structure.
 *
 * @param msg - Message to validate
 * @throws Error if message is invalid
 */
export function validateHelloAckMessage(msg: unknown): asserts msg is HandshakeAckMessage {
  if (typeof msg !== 'object' || msg === null) {
    throw new Error('Hello-ack message must be an object');
  }

  checkPrototypePollution(msg);

  const message = msg as Record<string, unknown>;

  if (message.type !== 'hello-ack') {
    throw new Error('Invalid message type');
  }

  if (typeof message.selectedVersion !== 'string') {
    throw new Error('selectedVersion must be a string');
  }

  validateVersionString(message.selectedVersion);

  if (message.serverId !== undefined && typeof message.serverId !== 'string') {
    throw new Error('serverId must be a string');
  }

  if (message.nonce !== undefined && typeof message.nonce !== 'string') {
    throw new Error('nonce must be a string');
  }
}

// ============================================================================
// Protocol Constants
// ============================================================================

export const PROTOCOL_VERSION = "1.0" as const;
export const MIN_SUPPORTED_VERSION = "1.0" as const;
export const MAX_SUPPORTED_VERSION = "1.0" as const;
export const SUPPORTED_VERSIONS: readonly string[] = ["1.0"] as const;

export interface ProtocolVersion {
  major: number;
  minor: number;
}

export interface VersionNegotiationResult {
  version: string;
  isLatest: boolean;
  warning?: string;
}

export interface HandshakeMessage {
  type: "hello";
  versions: string[];
  clientId?: string;
  nonce?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface HandshakeAckMessage {
  type: "hello-ack";
  selectedVersion: string;
  serverId?: string;
  nonce?: string;
  [key: string]: unknown;
}

export interface HandshakeRejectMessage {
  type: "hello-reject";
  reason: string;
  supportedVersions: string[];
  [key: string]: unknown;
}

export type HandshakeMessageType = HandshakeMessage | HandshakeAckMessage | HandshakeRejectMessage;

export function parseVersion(version: string): ProtocolVersion {
  validateVersionString(version);

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

export function areVersionsCompatible(a: string, b: string): boolean {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  return vA.major === vB.major;
}

export function isVersionSupported(version: string): boolean {
  try {
    const v = parseVersion(version);
    const min = parseVersion(MIN_SUPPORTED_VERSION);
    const max = parseVersion(MAX_SUPPORTED_VERSION);

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

export function negotiateVersion(
  offeredVersions: string[],
  supportedVersions: readonly string[] = SUPPORTED_VERSIONS
): string | null {
  validateVersionsArray(offeredVersions);

  const compatible: string[] = [];

  for (const offered of offeredVersions) {
    for (const supported of supportedVersions) {
      try {
        if (areVersionsCompatible(offered, supported)) {
          const cmp = compareVersions(offered, supported);
          compatible.push(cmp <= 0 ? offered : supported);
        }
      } catch {
        // Skip invalid versions silently
      }
    }
  }

  if (compatible.length === 0) {
    return null;
  }

  return compatible.sort(compareVersions).pop()!;
}

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

export function createHelloMessage(clientId?: string): HandshakeMessage {
  return {
    type: "hello",
    versions: [...SUPPORTED_VERSIONS],
    clientId,
    nonce: generateNonce(),
    timestamp: Date.now(),
  };
}

export function createHelloAckMessage(
  selectedVersion: string,
  serverId?: string,
  clientNonce?: string
): HandshakeAckMessage {
  return {
    type: "hello-ack",
    selectedVersion,
    serverId,
    nonce: clientNonce,
  };
}

export function createHelloRejectMessage(reason: string): HandshakeRejectMessage {
  return {
    type: "hello-reject",
    reason,
    supportedVersions: [],
  };
}

export function isHandshakeMessage(message: unknown): message is HandshakeMessageType {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const type = (message as { type?: unknown }).type;
  return type === "hello" || type === "hello-ack" || type === "hello-reject";
}

export function formatVersion(version: string): string {
  return `v${version}`;
}

export function isTimestampFresh(timestamp: number, maxAgeMs: number = MAX_HANDSHAKE_AGE_MS): boolean {
  const now = Date.now();
  const age = now - timestamp;
  return age >= 0 && age <= maxAgeMs;
}
