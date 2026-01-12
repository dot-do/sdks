/**
 * @dotdo/capnweb - Standardized Error Codes
 *
 * This module defines standardized error codes that are consistent across
 * all language implementations (TypeScript, Python, Rust, Go).
 *
 * Error Code Ranges:
 * - 1xxx: Connection errors
 * - 2xxx: RPC errors
 * - 3xxx: Timeout errors
 * - 4xxx: Capability errors
 * - 5xxx: Serialization errors
 */

// ============================================================================
// Standard Error Codes
// ============================================================================

/**
 * Standard error codes used across all DotDo SDK implementations.
 * These codes are consistent across TypeScript, Python, Rust, and Go.
 */
export const ErrorCode = {
  /** Connection-related errors (network, transport) */
  CONNECTION_ERROR: 1001,

  /** RPC method call failures */
  RPC_ERROR: 2001,

  /** Request timeout exceeded */
  TIMEOUT_ERROR: 3001,

  /** Capability resolution or access errors */
  CAPABILITY_ERROR: 4001,

  /** Serialization/deserialization errors */
  SERIALIZATION_ERROR: 5001,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Maps error codes to their string names
 */
export const ErrorCodeName: Record<ErrorCodeType, string> = {
  [ErrorCode.CONNECTION_ERROR]: 'CONNECTION_ERROR',
  [ErrorCode.RPC_ERROR]: 'RPC_ERROR',
  [ErrorCode.TIMEOUT_ERROR]: 'TIMEOUT_ERROR',
  [ErrorCode.CAPABILITY_ERROR]: 'CAPABILITY_ERROR',
  [ErrorCode.SERIALIZATION_ERROR]: 'SERIALIZATION_ERROR',
};

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Unique identifier for a capability
 */
export type CapabilityId = number;

/**
 * Base error class for all capnweb/RPC errors.
 *
 * All error types in the DotDo ecosystem extend this class, allowing you to
 * catch all RPC-related errors with a single catch block.
 *
 * Error Hierarchy:
 * - CapnwebError (base)
 *   - ConnectionError: Connection failures, disconnections
 *   - RpcError: Method call failures, server errors
 *   - CapabilityError: Capability resolution failures
 *   - TimeoutError: Request timeout exceeded
 *   - SerializationError: Encoding/decoding failures
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('someMethod');
 * } catch (error) {
 *   if (error instanceof CapnwebError) {
 *     console.log(`RPC error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 */
export class CapnwebError extends Error {
  /**
   * Creates a new CapnwebError.
   * @param message - Human-readable error message
   * @param code - Numeric error code (e.g., 1001, 2001)
   * @param codeName - String name of the error code (e.g., 'CONNECTION_ERROR')
   */
  constructor(
    message: string,
    public readonly code: ErrorCodeType,
    public readonly codeName: string
  ) {
    super(message);
    this.name = 'CapnwebError';
  }

  /**
   * Returns a JSON representation of the error.
   */
  toJSON(): { name: string; message: string; code: number; codeName: string } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      codeName: this.codeName,
    };
  }
}

// ============================================================================
// Specific Error Types
// ============================================================================

/**
 * Error thrown when a connection cannot be established or is unexpectedly lost.
 *
 * Error Code: 1001 (CONNECTION_ERROR)
 *
 * Common causes:
 * - Network unreachable or server down
 * - TLS/certificate errors
 * - Connection timeout during handshake
 * - Server closed connection unexpectedly
 *
 * @example
 * ```typescript
 * try {
 *   await connect('wss://api.example.do');
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     console.log('Failed to connect:', error.message);
 *     // Retry logic here
 *   }
 * }
 * ```
 */
export class ConnectionError extends CapnwebError {
  /**
   * Creates a new ConnectionError.
   * @param message - Description of the connection failure
   */
  constructor(message: string) {
    super(message, ErrorCode.CONNECTION_ERROR, 'CONNECTION_ERROR');
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown when an RPC method call fails.
 *
 * Error Code: 2001 (RPC_ERROR)
 *
 * Common causes:
 * - Method not found on the remote server
 * - Invalid arguments passed to the method
 * - Server-side exception during method execution
 * - Permission denied for the requested operation
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('processData', data);
 * } catch (error) {
 *   if (error instanceof RpcError) {
 *     console.log(`RPC call failed: ${error.message}`);
 *     if (error.methodId !== undefined) {
 *       console.log(`Method ID: ${error.methodId}`);
 *     }
 *   }
 * }
 * ```
 */
export class RpcError extends CapnwebError {
  /**
   * Creates a new RpcError.
   * @param message - Description of the RPC failure
   * @param methodId - Optional method ID that failed (for debugging)
   */
  constructor(
    message: string,
    public readonly methodId?: number
  ) {
    super(message, ErrorCode.RPC_ERROR, 'RPC_ERROR');
    this.name = 'RpcError';
  }
}

/**
 * Error thrown when an operation exceeds its timeout.
 *
 * Error Code: 3001 (TIMEOUT_ERROR)
 *
 * Common causes:
 * - Server is slow or overloaded
 * - Network latency issues
 * - Method taking longer than expected to complete
 * - Deadlock or infinite loop on the server
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('longRunningOperation', { timeout: 5000 });
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.log('Operation timed out:', error.message);
 *     // Consider retrying with a longer timeout
 *   }
 * }
 * ```
 */
export class TimeoutError extends CapnwebError {
  /**
   * Creates a new TimeoutError.
   * @param message - Description of what timed out (default: 'Request timed out')
   * @param timeoutMs - The timeout duration in milliseconds
   */
  constructor(
    message: string = 'Request timed out',
    public readonly timeoutMs?: number
  ) {
    super(message, ErrorCode.TIMEOUT_ERROR, 'TIMEOUT_ERROR');
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when a capability cannot be resolved or is invalid.
 *
 * Error Code: 4001 (CAPABILITY_ERROR)
 *
 * Common causes:
 * - Capability reference expired or was garbage collected
 * - Capability was revoked by the server
 * - Invalid capability ID provided
 * - Capability not found in the import table
 *
 * @example
 * ```typescript
 * try {
 *   const counter = await client.call('getCounter');
 *   await counter.increment(1);
 * } catch (error) {
 *   if (error instanceof CapabilityError) {
 *     console.log(`Capability error: ${error.message}`);
 *     if (error.capabilityId !== undefined) {
 *       console.log(`Capability ID: ${error.capabilityId}`);
 *     }
 *   }
 * }
 * ```
 */
export class CapabilityError extends CapnwebError {
  /**
   * Creates a new CapabilityError.
   * @param message - Description of the capability error
   * @param capabilityId - Optional ID of the capability that caused the error
   */
  constructor(
    message: string,
    public readonly capabilityId?: CapabilityId
  ) {
    super(message, ErrorCode.CAPABILITY_ERROR, 'CAPABILITY_ERROR');
    this.name = 'CapabilityError';
  }
}

/**
 * Error thrown when serialization or deserialization fails.
 *
 * Error Code: 5001 (SERIALIZATION_ERROR)
 *
 * Common causes:
 * - Invalid data format
 * - Schema mismatch between client and server
 * - Corrupted message data
 * - Unsupported data types
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('processData', complexObject);
 * } catch (error) {
 *   if (error instanceof SerializationError) {
 *     console.log('Serialization failed:', error.message);
 *   }
 * }
 * ```
 */
export class SerializationError extends CapnwebError {
  /**
   * Creates a new SerializationError.
   * @param message - Description of the serialization failure
   * @param isDeserialize - Whether this was a deserialization (vs serialization) error
   */
  constructor(
    message: string,
    public readonly isDeserialize: boolean = false
  ) {
    super(message, ErrorCode.SERIALIZATION_ERROR, 'SERIALIZATION_ERROR');
    this.name = 'SerializationError';
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Checks if an error is a CapnwebError with a specific error code.
 *
 * @param error - The error to check
 * @param code - The error code to match
 * @returns true if the error matches the code
 *
 * @example
 * ```typescript
 * try {
 *   await client.call('method');
 * } catch (error) {
 *   if (isErrorCode(error, ErrorCode.TIMEOUT_ERROR)) {
 *     // Handle timeout specifically
 *   }
 * }
 * ```
 */
export function isErrorCode(error: unknown, code: ErrorCodeType): boolean {
  return error instanceof CapnwebError && error.code === code;
}

/**
 * Creates an appropriate CapnwebError subclass from an error code and message.
 *
 * @param code - The error code
 * @param message - The error message
 * @returns An instance of the appropriate error class
 */
export function createError(code: ErrorCodeType, message: string): CapnwebError {
  switch (code) {
    case ErrorCode.CONNECTION_ERROR:
      return new ConnectionError(message);
    case ErrorCode.RPC_ERROR:
      return new RpcError(message);
    case ErrorCode.TIMEOUT_ERROR:
      return new TimeoutError(message);
    case ErrorCode.CAPABILITY_ERROR:
      return new CapabilityError(message);
    case ErrorCode.SERIALIZATION_ERROR:
      return new SerializationError(message);
    default:
      return new CapnwebError(message, code, ErrorCodeName[code] || 'UNKNOWN_ERROR');
  }
}

/**
 * Wraps an unknown error into a CapnwebError.
 *
 * @param error - Any error or thrown value
 * @param defaultCode - The default error code if not a CapnwebError
 * @returns A CapnwebError instance
 */
export function wrapError(
  error: unknown,
  defaultCode: ErrorCodeType = ErrorCode.RPC_ERROR
): CapnwebError {
  if (error instanceof CapnwebError) {
    return error;
  }
  if (error instanceof Error) {
    return createError(defaultCode, error.message);
  }
  return createError(defaultCode, String(error));
}
