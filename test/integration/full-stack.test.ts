/**
 * Full Stack Integration Tests
 *
 * Tests the complete SDK stack: SDK Client -> rpc.do -> platform.do (dotdo) -> capnweb
 *
 * These tests verify that all layers work together correctly:
 * 1. capnweb - Core RPC protocol implementation
 * 2. rpc.do - Promise pipelining RPC layer
 * 3. platform.do (dotdo) - Managed connections with auth/pooling/retry
 * 4. SDK Client - Language-specific SDK implementation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DotDo, createTestClient, type TestServerInstance } from 'platform.do';
import { setup } from '../server/dotdo-server.js';

describe('Full Stack Integration Tests', () => {
  let server: TestServerInstance;
  let client: DotDo;

  beforeAll(async () => {
    // Start the dotdo test server
    server = await setup({ port: 0, verbose: false });
    client = server.client;
  });

  afterAll(async () => {
    await server.shutdown();
  });

  describe('Connection Layer (platform.do)', () => {
    it('should create a client with default options', () => {
      const testClient = new DotDo();
      expect(testClient).toBeDefined();
    });

    it('should create a test client configured for local server', () => {
      const testClient = createTestClient({
        serverUrl: server.url,
        debug: false,
      });
      expect(testClient).toBeDefined();
    });

    it('should get auth headers when API key is set', () => {
      const testClient = new DotDo({ apiKey: 'test-key' });
      const headers = testClient.getAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer test-key');
    });
  });

  describe('RPC Layer (rpc.do)', () => {
    it('should perform basic RPC calls', async () => {
      // Connect to the test server
      const proxy = await client.connect(server.url);

      // Call the square method
      const result = await (proxy as any).square(5);
      expect(result).toBe(25);
    });

    it('should handle null return values', async () => {
      const proxy = await client.connect(server.url);
      const result = await (proxy as any).returnNull();
      expect(result).toBeNull();
    });

    it('should handle undefined return values', async () => {
      const proxy = await client.connect(server.url);
      const result = await (proxy as any).returnUndefined();
      // undefined serializes to null in JSON
      expect(result).toBeNull();
    });

    it('should handle array return values', async () => {
      const proxy = await client.connect(server.url);
      const result = await (proxy as any).generateFibonacci(10);
      expect(result).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
    });
  });

  describe('Capability Passing (capnweb)', () => {
    it('should create and use capabilities', async () => {
      const proxy = await client.connect(server.url);

      // Create a counter capability
      const counter = await (proxy as any).makeCounter(10);
      expect(counter).toBeDefined();

      // Use the counter capability
      const value = await counter.increment(5);
      expect(value).toBe(15);
    });

    it('should pass capabilities as arguments', async () => {
      const proxy = await client.connect(server.url);

      // Create a counter
      const counter = await (proxy as any).makeCounter(0);

      // Pass the counter to another method
      const result = await (proxy as any).incrementCounter(counter, 10);
      expect(result).toBe(10);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from the server', async () => {
      const proxy = await client.connect(server.url);

      await expect((proxy as any).throwError()).rejects.toThrow('test error');
    });

    it('should handle method not found errors', async () => {
      const proxy = await client.connect(server.url);

      await expect((proxy as any).nonExistentMethod()).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should handle multiple concurrent connections', async () => {
      const promises = Array.from({ length: 5 }, async () => {
        const proxy = await client.connect(server.url);
        return (proxy as any).square(Math.floor(Math.random() * 100));
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(typeof result).toBe('number');
      });
    });

    it('should clean up connections on close', async () => {
      const testClient = new DotDo({
        baseUrl: server.url,
        pool: { maxConnections: 2 },
      });

      // Make some connections
      await testClient.connect(server.url);
      await testClient.connect(server.url);

      // Close should not throw
      await expect(testClient.close()).resolves.toBeUndefined();
    });
  });

  describe('HTTP Batch Mode', () => {
    it('should work with HTTP batch requests', async () => {
      // Use fetch to make a direct HTTP batch request
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 1,
          method: 'square',
          args: [7],
        }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.result).toBe(49);
    });
  });
});

describe('Platform Info Endpoint', () => {
  let server: TestServerInstance;

  beforeAll(async () => {
    server = await setup({ port: 0 });
  });

  afterAll(async () => {
    await server.shutdown();
  });

  it('should return platform information', async () => {
    const response = await fetch(`${server.url}/platform`);
    expect(response.ok).toBe(true);

    const info = await response.json();
    expect(info.name).toBe('dotdo');
    expect(info.features).toContain('websocket-rpc');
    expect(info.features).toContain('http-batch-rpc');
    expect(info.features).toContain('promise-pipelining');
  });

  it('should return health status', async () => {
    const response = await fetch(`${server.url}/health`);
    expect(response.ok).toBe(true);

    const health = await response.json();
    expect(health.status).toBe('ok');
    expect(health.platform).toBe('dotdo');
  });
});

describe('Authentication', () => {
  it('should reject requests without API key when required', async () => {
    const serverWithAuth = await setup({ port: 0, apiKey: 'secret-key' });

    const response = await fetch(serverWithAuth.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, method: 'square', args: [5] }),
    });

    expect(response.status).toBe(401);
    await serverWithAuth.shutdown();
  });

  it('should accept requests with valid API key', async () => {
    const serverWithAuth = await setup({ port: 0, apiKey: 'secret-key' });

    const response = await fetch(serverWithAuth.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret-key',
      },
      body: JSON.stringify({ id: 1, method: 'square', args: [5] }),
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.result).toBe(25);
    await serverWithAuth.shutdown();
  });
});
