/**
 * Unit tests for RpcClient
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockServer } from './test-server.js';
import { connect, RpcClient } from '../src/index.js';

describe('RpcClient', () => {
  let server: MockServer;
  let client: RpcClient<unknown>;

  beforeEach(() => {
    server = new MockServer();
    client = connect(server);
  });

  describe('basic calls', () => {
    it('should call square method', async () => {
      const result = await client.call('square', 5);
      expect(result).toBe(25);
    });

    it('should call returnNumber method', async () => {
      const result = await client.call('returnNumber', 42);
      expect(result).toBe(42);
    });

    it('should call returnNull method', async () => {
      const result = await client.call('returnNull');
      expect(result).toBeNull();
    });

    it('should call generateFibonacci method', async () => {
      const result = await client.call('generateFibonacci', 5);
      expect(result).toEqual([0, 1, 1, 2, 3]);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from server', async () => {
      await expect(client.call('throwError')).rejects.toThrow('test error');
    });

    it('should handle non-existent methods', async () => {
      await expect(client.call('nonExistentMethod')).rejects.toThrow();
    });
  });

  describe('capabilities', () => {
    it('should create and use a counter', async () => {
      const counter = await client.call('makeCounter', 10);
      expect(counter).toHaveProperty('__capabilityId');

      const value = await client.callOnCapability(counter, 'value');
      expect(value).toBe(10);
    });

    it('should increment a counter', async () => {
      const counter = await client.call('makeCounter', 5);
      const newValue = await client.callOnCapability(counter, 'increment', 3);
      expect(newValue).toBe(8);
    });

    it('should pass capabilities as arguments', async () => {
      const counter = await client.call('makeCounter', 20);
      const result = await client.call('incrementCounter', { $ref: (counter as { __capabilityId: number }).__capabilityId }, 5);
      expect(result).toBe(25);
    });
  });

  describe('proxy access', () => {
    it('should access methods via $ proxy', async () => {
      const result = await client.$.square(7);
      expect(result).toBe(49);
    });

    it('should chain capability method calls', async () => {
      const counter = await client.$.makeCounter(100);
      const value = await counter.value();
      expect(value).toBe(100);
    });
  });
});
