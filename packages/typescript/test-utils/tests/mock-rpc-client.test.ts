/**
 * Tests for MockRpcClient
 */

import { describe, it, expect } from 'vitest';
import { createMockRpcClient, createMockRpcClientFactory } from '../src/mock-rpc-client.js';

describe('createMockRpcClient', () => {
  it('should create a mock client with $ proxy', async () => {
    const client = createMockRpcClient();
    const result = await client.$.testMethod('arg1', 'arg2');
    expect(result).toEqual({});
  });

  it('should track calls in callLog', async () => {
    const client = createMockRpcClient();
    await client.$.methodA(1, 2);
    await client.$.methodB('test');

    expect(client.callLog).toHaveLength(2);
    expect(client.callLog[0].method).toBe('methodA');
    expect(client.callLog[0].args).toEqual([1, 2]);
    expect(client.callLog[1].method).toBe('methodB');
    expect(client.callLog[1].args).toEqual(['test']);
  });

  it('should clear call log', async () => {
    const client = createMockRpcClient();
    await client.$.testMethod();
    client.clearCallLog();
    expect(client.callLog).toHaveLength(0);
  });

  it('should use default response', async () => {
    const client = createMockRpcClient({ defaultResponse: { status: 'ok' } });
    const result = await client.$.anyMethod();
    expect(result).toEqual({ status: 'ok' });
  });

  it('should use custom handlers', async () => {
    const client = createMockRpcClient({
      handlers: {
        add: (a: unknown, b: unknown) => (a as number) + (b as number),
      },
    });
    const result = await client.$.add(3, 4);
    expect(result).toBe(7);
  });

  it('should support registering handlers with on()', async () => {
    const client = createMockRpcClient();
    client.on('multiply', (a: unknown, b: unknown) => (a as number) * (b as number));
    const result = await client.$.multiply(5, 6);
    expect(result).toBe(30);
  });

  it('should support async handlers', async () => {
    const client = createMockRpcClient({
      handlers: {
        asyncOp: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async done';
        },
      },
    });
    const result = await client.$.asyncOp();
    expect(result).toBe('async done');
  });

  it('should have close method', async () => {
    const client = createMockRpcClient();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('should include timestamp in call log', async () => {
    const client = createMockRpcClient();
    const before = Date.now();
    await client.$.testMethod();
    const after = Date.now();

    expect(client.callLog[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(client.callLog[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('should respect enableCallLog option', async () => {
    const client = createMockRpcClient({ enableCallLog: false });
    await client.$.testMethod();
    expect(client.callLog).toHaveLength(0);
  });
});

describe('createMockRpcClientFactory', () => {
  it('should create clients for different URLs', () => {
    const factory = createMockRpcClientFactory();
    const client1 = factory('wss://broker1.kafka.do');
    const client2 = factory('wss://broker2.kafka.do');

    expect(client1).toBeDefined();
    expect(client2).toBeDefined();
    expect(factory.clients.size).toBe(2);
  });

  it('should get client by URL', () => {
    const factory = createMockRpcClientFactory();
    const client = factory('wss://test.kafka.do');
    expect(factory.getClient('wss://test.kafka.do')).toBe(client);
  });

  it('should return undefined for unknown URL', () => {
    const factory = createMockRpcClientFactory();
    expect(factory.getClient('wss://unknown.kafka.do')).toBeUndefined();
  });

  it('should pass options to created clients', async () => {
    const factory = createMockRpcClientFactory({
      handlers: {
        greet: (name: unknown) => `Hello, ${name}!`,
      },
    });
    const client = factory('wss://test.kafka.do');
    const result = await client.$.greet('World');
    expect(result).toBe('Hello, World!');
  });
});
