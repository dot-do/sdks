/**
 * Tests for error class consistency across packages
 *
 * This test verifies that:
 * 1. Error classes are consistent across all packages
 * 2. Users can catch errors from any package without conflicts
 * 3. Error type checking works correctly (instanceof)
 *
 * The error hierarchy should be:
 * - capnweb defines base error classes (CapnwebError, ConnectionError, RpcError, CapabilityError, TimeoutError)
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
} from '@dotdo/capnweb';

import {
  CapnwebError as RpcDoCapnwebError,
  RpcError as RpcDoRpcError,
  ConnectionError as RpcDoConnectionError,
  CapabilityError as RpcDoCapabilityError,
  TimeoutError as RpcDoTimeoutError,
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
    it('CapnwebError should have code property', () => {
      const error = new CapnwebBaseError('test message', 'TEST_CODE');
      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('CapnwebError');
    });

    it('RpcError should have methodId property', () => {
      const error = new CapnwebRpcError('rpc failed', 42);
      expect(error.message).toBe('rpc failed');
      expect(error.code).toBe('RPC_ERROR');
      expect(error.methodId).toBe(42);
      expect(error.name).toBe('RpcError');
    });

    it('ConnectionError should have correct code', () => {
      const error = new CapnwebConnectionError('connection lost');
      expect(error.message).toBe('connection lost');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.name).toBe('ConnectionError');
    });

    it('CapabilityError should have capabilityId property', () => {
      const error = new CapnwebCapabilityError('capability not found', 123);
      expect(error.message).toBe('capability not found');
      expect(error.code).toBe('CAPABILITY_ERROR');
      expect(error.capabilityId).toBe(123);
      expect(error.name).toBe('CapabilityError');
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
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(CapnwebBaseError);
      }
    });
  });
});
