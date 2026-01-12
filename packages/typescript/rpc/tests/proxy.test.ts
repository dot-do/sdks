/**
 * Unit tests for Proxy-based stub access
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockServer } from './test-server.js';
import { connect, RpcClient } from '../src/index.js';

describe('RpcProxy', () => {
  let server: MockServer;
  let client: RpcClient<unknown>;

  beforeEach(() => {
    server = new MockServer();
    client = connect(server);
  });

  describe('method calls', () => {
    it('should call methods through proxy', async () => {
      const result = await client.$.square(4);
      expect(result).toBe(16);
    });

    it('should handle multiple arguments', async () => {
      // incrementCounter takes (counter, by)
      const counter = await client.$.makeCounter(0);
      const result = await client.$.incrementCounter(counter, 10);
      expect(result).toBe(10);
    });
  });

  describe('chained access', () => {
    it('should chain property access for nested calls', async () => {
      const counter = await client.$.makeCounter(50);
      const value = await counter.value();
      expect(value).toBe(50);
    });

    it('should maintain capability identity across calls', async () => {
      const counter = await client.$.makeCounter(0);

      await counter.increment(5);
      const v1 = await counter.value();
      expect(v1).toBe(5);

      await counter.increment(3);
      const v2 = await counter.value();
      expect(v2).toBe(8);
    });
  });

  describe('type safety', () => {
    it('should allow typed proxy access', async () => {
      interface Calculator {
        square(x: number): Promise<number>;
        returnNumber(x: number): Promise<number>;
      }

      const typedClient = client as RpcClient<Calculator>;
      const result = await typedClient.$.square(6);
      expect(result).toBe(36);
    });
  });
});
