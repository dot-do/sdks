/**
 * Tests for MockRpcTransport
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockRpcTransport } from '../src/mock-rpc-transport.js';

describe('MockRpcTransport', () => {
  let transport: MockRpcTransport;

  beforeEach(() => {
    transport = new MockRpcTransport();
  });

  afterEach(async () => {
    await transport.close();
  });

  describe('basic functionality', () => {
    it('should track call log', async () => {
      await transport.call('connect', 'mongodb://localhost');
      await transport.call('ping');
      expect(transport.callLog).toHaveLength(2);
      expect(transport.callLog[0].method).toBe('connect');
      expect(transport.callLog[1].method).toBe('ping');
    });

    it('should clear call log', async () => {
      await transport.call('connect', 'mongodb://localhost');
      transport.clearCallLog();
      expect(transport.callLog).toHaveLength(0);
    });

    it('should throw when closed', async () => {
      await transport.close();
      await expect(transport.call('ping')).rejects.toThrow('Transport is closed');
    });

    it('should report closed state', async () => {
      expect(transport.isClosed).toBe(false);
      await transport.close();
      expect(transport.isClosed).toBe(true);
    });

    it('should throw for unknown method', async () => {
      await expect(transport.call('unknownMethod')).rejects.toThrow('Unknown method');
    });
  });

  describe('default handlers', () => {
    it('should handle connect', async () => {
      const result = await transport.call('connect', 'mongodb://localhost');
      expect(result).toEqual({ ok: 1 });
    });

    it('should handle ping', async () => {
      const result = await transport.call('ping');
      expect(result).toEqual({ ok: 1 });
    });
  });

  describe('custom handlers', () => {
    it('should register and use custom handler', async () => {
      transport.on('myMethod', (a: unknown, b: unknown) => ({ sum: (a as number) + (b as number) }));
      const result = await transport.call('myMethod', 5, 3);
      expect(result).toEqual({ sum: 8 });
    });

    it('should remove handler with off()', async () => {
      transport.on('myMethod', () => 'result');
      transport.off('myMethod');
      await expect(transport.call('myMethod')).rejects.toThrow('Unknown method');
    });

    it('should support async handlers', async () => {
      transport.on('asyncMethod', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'async result';
      });
      const result = await transport.call('asyncMethod');
      expect(result).toBe('async result');
    });

    it('should support handlers passed in constructor', async () => {
      const customTransport = new MockRpcTransport({
        handlers: {
          customMethod: () => 'custom result',
        },
      });
      const result = await customTransport.call('customMethod');
      expect(result).toBe('custom result');
    });
  });

  describe('mock responses', () => {
    it('should return queued mock response', async () => {
      transport.mockResponse('testMethod', { result: 'mocked' });
      const result = await transport.call('testMethod');
      expect(result).toBe('mocked');
    });

    it('should consume mock responses in FIFO order', async () => {
      transport.mockResponse('testMethod', { result: 'first' });
      transport.mockResponse('testMethod', { result: 'second' });
      expect(await transport.call('testMethod')).toBe('first');
      expect(await transport.call('testMethod')).toBe('second');
    });

    it('should throw queued error', async () => {
      transport.mockError('testMethod', new Error('mock error'));
      await expect(transport.call('testMethod')).rejects.toThrow('mock error');
    });

    it('should apply delay to mock response', async () => {
      transport.mockResponse('testMethod', { result: 'delayed', delay: 50 });
      const start = Date.now();
      await transport.call('testMethod');
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
    });
  });

  describe('call log utilities', () => {
    it('should get calls for specific method', async () => {
      await transport.call('ping');
      await transport.call('connect', 'url');
      await transport.call('ping');
      const pingCalls = transport.getCallsForMethod('ping');
      expect(pingCalls).toHaveLength(2);
    });

    it('should check if method was called', async () => {
      expect(transport.wasMethodCalled('ping')).toBe(false);
      await transport.call('ping');
      expect(transport.wasMethodCalled('ping')).toBe(true);
    });

    it('should get last call for method', async () => {
      await transport.call('connect', 'first');
      await transport.call('connect', 'second');
      const lastCall = transport.getLastCall('connect');
      expect(lastCall?.args).toEqual(['second']);
    });
  });

  describe('reset', () => {
    it('should reset transport to initial state', async () => {
      await transport.call('ping');
      await transport.close();
      transport.mockResponse('test', { result: 'value' });

      transport.reset();

      expect(transport.isClosed).toBe(false);
      expect(transport.callLog).toHaveLength(0);
      // Mock responses should be cleared
      await expect(transport.call('test')).rejects.toThrow('Unknown method');
    });
  });
});
