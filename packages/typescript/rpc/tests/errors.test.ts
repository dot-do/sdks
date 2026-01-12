/**
 * Tests for error class consistency across packages
 *
 * This test verifies that:
 * 1. Error classes are consistent across all packages
 * 2. Users can catch errors from any package without conflicts
 * 3. Error type checking works correctly (instanceof)
 * 4. Error codes are numeric and consistent
 *
 * The error hierarchy should be:
 * - capnweb defines base error classes (CapnwebError, ConnectionError, RpcError, CapabilityError, TimeoutError, SerializationError)
 * - rpc.do re-exports from capnweb (no new definitions)
 * - dotdo re-exports from rpc.do (no new definitions)
 * - oauth.do can define OAuthError that extends CapnwebError
 */

import { describe, it, expect } from 'vitest';

// Import errors from all packages using package names (not relative paths)
// This ensures we get the same module instances when using workspace:* links
import {
  CapnwebError as CapnwebBaseError,
  ConnectionError as CapnwebConnectionError,
  RpcError as CapnwebRpcError,
  CapabilityError as CapnwebCapabilityError,
  TimeoutError as CapnwebTimeoutError,
  SerializationError as CapnwebSerializationError,
  ErrorCode,
  ErrorCodeName,
  isErrorCode,
  createError,
  wrapError,
} from '@dotdo/capnweb';

import {
  CapnwebError as RpcDoCapnwebError,
  RpcError as RpcDoRpcError,
  ConnectionError as RpcDoConnectionError,
  CapabilityError as RpcDoCapabilityError,
  TimeoutError as RpcDoTimeoutError,
  SerializationError as RpcDoSerializationError,
  ErrorCode as RpcDoErrorCode,
} from '../src/index.js';

describe('Error Class Consistency', () => {
  describe('error class identity across packages', () => {
    it('should use the same RpcError class from capnweb and rpc.do', () => {
      // Both packages should export the exact same class reference
      expect(RpcDoRpcError).toBe(CapnwebRpcError);
    });

    it('should use the same ConnectionError class from capnweb and rpc.do', () => {
      expect(RpcDoConnectionError).toBe(CapnwebConnectionError);
    });

    it('should use the same CapabilityError class from capnweb and rpc.do', () => {
      expect(RpcDoCapabilityError).toBe(CapnwebCapabilityError);
    });

    it('should use the same SerializationError class from capnweb and rpc.do', () => {
      expect(RpcDoSerializationError).toBe(CapnwebSerializationError);
    });

    it('should use the same ErrorCode constants from capnweb and rpc.do', () => {
      expect(RpcDoErrorCode).toBe(ErrorCode);
    });
  });

  describe('instanceof works correctly across packages', () => {
    it('RpcError from rpc.do should be instanceof CapnwebError', () => {
      const error = new RpcDoRpcError('test', 42);
      expect(error).toBeInstanceOf(CapnwebBaseError);
    });

    it('ConnectionError from rpc.do should be instanceof CapnwebError', () => {
      const error = new RpcDoConnectionError('connection failed');
      expect(error).toBeInstanceOf(CapnwebBaseError);
    });

    it('CapabilityError from rpc.do should be instanceof CapnwebError', () => {
      const error = new RpcDoCapabilityError('capability not found');
      expect(error).toBeInstanceOf(CapnwebBaseError);
    });

    it('TimeoutError from rpc.do should be instanceof CapnwebError', () => {
      const error = new RpcDoTimeoutError('request timed out');
      expect(error).toBeInstanceOf(CapnwebBaseError);
    });

    it('error caught from capnweb should match error from rpc.do', () => {
      // Create an error using rpc.do's export
      const rpcError = new RpcDoRpcError('test', 123);

      // Should be catchable as capnweb error
      expect(rpcError).toBeInstanceOf(CapnwebRpcError);

      // And should also be catchable as base capnweb error
      expect(rpcError).toBeInstanceOf(CapnwebBaseError);
    });
  });

  describe('error hierarchy is correct', () => {
    it('RpcError should extend CapnwebError', () => {
      const error = new CapnwebRpcError('test');
      expect(error).toBeInstanceOf(CapnwebBaseError);
      expect(error).toBeInstanceOf(Error);
    });

    it('ConnectionError should extend CapnwebError', () => {
      const error = new CapnwebConnectionError('test');
      expect(error).toBeInstanceOf(CapnwebBaseError);
      expect(error).toBeInstanceOf(Error);
    });

    it('CapabilityError should extend CapnwebError', () => {
      const error = new CapnwebCapabilityError('test');
      expect(error).toBeInstanceOf(CapnwebBaseError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('error properties are accessible', () => {
    it('CapnwebError should have code and codeName properties', () => {
      const error = new CapnwebBaseError('test message', ErrorCode.RPC_ERROR, 'RPC_ERROR');
      expect(error.message).toBe('test message');
      expect(error.code).toBe(ErrorCode.RPC_ERROR);
      expect(error.codeName).toBe('RPC_ERROR');
      expect(error.name).toBe('CapnwebError');
    });

    it('RpcError should have methodId property and numeric code', () => {
      const error = new CapnwebRpcError('rpc failed', 42);
      expect(error.message).toBe('rpc failed');
      expect(error.code).toBe(ErrorCode.RPC_ERROR);
      expect(error.codeName).toBe('RPC_ERROR');
      expect(error.methodId).toBe(42);
      expect(error.name).toBe('RpcError');
    });

    it('ConnectionError should have correct numeric code', () => {
      const error = new CapnwebConnectionError('connection lost');
      expect(error.message).toBe('connection lost');
      expect(error.code).toBe(ErrorCode.CONNECTION_ERROR);
      expect(error.codeName).toBe('CONNECTION_ERROR');
      expect(error.name).toBe('ConnectionError');
    });

    it('CapabilityError should have capabilityId property and numeric code', () => {
      const error = new CapnwebCapabilityError('capability not found', 123);
      expect(error.message).toBe('capability not found');
      expect(error.code).toBe(ErrorCode.CAPABILITY_ERROR);
      expect(error.codeName).toBe('CAPABILITY_ERROR');
      expect(error.capabilityId).toBe(123);
      expect(error.name).toBe('CapabilityError');
    });

    it('TimeoutError should have timeoutMs property and numeric code', () => {
      const error = new CapnwebTimeoutError('request timed out', 5000);
      expect(error.message).toBe('request timed out');
      expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
      expect(error.codeName).toBe('TIMEOUT_ERROR');
      expect(error.timeoutMs).toBe(5000);
      expect(error.name).toBe('TimeoutError');
    });

    it('SerializationError should have isDeserialize property and numeric code', () => {
      const error = new CapnwebSerializationError('invalid data', true);
      expect(error.message).toBe('invalid data');
      expect(error.code).toBe(ErrorCode.SERIALIZATION_ERROR);
      expect(error.codeName).toBe('SERIALIZATION_ERROR');
      expect(error.isDeserialize).toBe(true);
      expect(error.name).toBe('SerializationError');
    });

    it('CapnwebError should have toJSON method', () => {
      const error = new CapnwebRpcError('test error', 42);
      const json = error.toJSON();
      expect(json).toEqual({
        name: 'RpcError',
        message: 'test error',
        code: ErrorCode.RPC_ERROR,
        codeName: 'RPC_ERROR',
      });
    });
  });

  describe('catching errors works correctly', () => {
    it('should be able to catch RpcError from any package', () => {
      function throwRpcError() {
        throw new RpcDoRpcError('test error', 123);
      }

      expect(() => throwRpcError()).toThrow(CapnwebRpcError);
    });

    it('should be able to catch all errors as CapnwebError', () => {
      const errors = [
        new RpcDoRpcError('rpc error', 1),
        new RpcDoConnectionError('connection error'),
        new RpcDoCapabilityError('capability error'),
        new RpcDoTimeoutError('timeout error'),
        new RpcDoSerializationError('serialization error'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(CapnwebBaseError);
      }
    });
  });

  describe('error utilities', () => {
    it('isErrorCode should correctly identify error codes', () => {
      const rpcError = new CapnwebRpcError('test');
      const connectionError = new CapnwebConnectionError('test');

      expect(isErrorCode(rpcError, ErrorCode.RPC_ERROR)).toBe(true);
      expect(isErrorCode(rpcError, ErrorCode.CONNECTION_ERROR)).toBe(false);
      expect(isErrorCode(connectionError, ErrorCode.CONNECTION_ERROR)).toBe(true);
      expect(isErrorCode(new Error('generic'), ErrorCode.RPC_ERROR)).toBe(false);
    });

    it('createError should create correct error types', () => {
      const connectionError = createError(ErrorCode.CONNECTION_ERROR, 'connection failed');
      expect(connectionError).toBeInstanceOf(CapnwebConnectionError);
      expect(connectionError.message).toBe('connection failed');

      const rpcError = createError(ErrorCode.RPC_ERROR, 'rpc failed');
      expect(rpcError).toBeInstanceOf(CapnwebRpcError);

      const timeoutError = createError(ErrorCode.TIMEOUT_ERROR, 'timeout');
      expect(timeoutError).toBeInstanceOf(CapnwebTimeoutError);

      const capabilityError = createError(ErrorCode.CAPABILITY_ERROR, 'capability');
      expect(capabilityError).toBeInstanceOf(CapnwebCapabilityError);

      const serializationError = createError(ErrorCode.SERIALIZATION_ERROR, 'serialization');
      expect(serializationError).toBeInstanceOf(CapnwebSerializationError);
    });

    it('wrapError should wrap non-CapnwebError errors', () => {
      const genericError = new Error('generic error');
      const wrapped = wrapError(genericError);

      expect(wrapped).toBeInstanceOf(CapnwebBaseError);
      expect(wrapped.message).toBe('generic error');
      expect(wrapped.code).toBe(ErrorCode.RPC_ERROR); // default code
    });

    it('wrapError should return CapnwebError as-is', () => {
      const originalError = new CapnwebRpcError('rpc error');
      const wrapped = wrapError(originalError);

      expect(wrapped).toBe(originalError);
    });

    it('wrapError should use custom default code', () => {
      const genericError = new Error('timeout');
      const wrapped = wrapError(genericError, ErrorCode.TIMEOUT_ERROR);

      expect(wrapped).toBeInstanceOf(CapnwebTimeoutError);
      expect(wrapped.code).toBe(ErrorCode.TIMEOUT_ERROR);
    });

    it('ErrorCodeName should map codes to names', () => {
      expect(ErrorCodeName[ErrorCode.CONNECTION_ERROR]).toBe('CONNECTION_ERROR');
      expect(ErrorCodeName[ErrorCode.RPC_ERROR]).toBe('RPC_ERROR');
      expect(ErrorCodeName[ErrorCode.TIMEOUT_ERROR]).toBe('TIMEOUT_ERROR');
      expect(ErrorCodeName[ErrorCode.CAPABILITY_ERROR]).toBe('CAPABILITY_ERROR');
      expect(ErrorCodeName[ErrorCode.SERIALIZATION_ERROR]).toBe('SERIALIZATION_ERROR');
    });
  });
});
