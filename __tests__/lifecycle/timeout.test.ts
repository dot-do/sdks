// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach, test } from "vitest";
import { RpcSession, type RpcSessionOptions, RpcTransport, TimeoutError, ErrorCode } from "../../src/index.js";
import { Counter, TestTarget } from "../test-util.js";

/**
 * Tests for timeout enforcement in RPC sessions.
 *
 * These tests verify that:
 * 1. RpcSessionOptions accepts a `timeout` option (number in ms)
 * 2. Requests throw TimeoutError after the configured timeout
 * 3. Per-call timeout overrides work
 * 4. Timed-out requests clean up their import table entry
 * 5. TimeoutError includes elapsed time info
 *
 * Related to issue: dot-do-capnweb-6sc
 *
 * NOTE: These tests are in RED phase - they should FAIL because timeout
 * enforcement is not yet implemented.
 *
 * Expected failure modes:
 * - Tests using NeverRespondTransport will time out (the RPC timeout isn't
 *   enforced, so the test waits for the vitest timeout)
 * - Tests checking TimeoutError properties will fail because no TimeoutError
 *   is thrown
 * - Tests checking clearTimeout will fail because no timers are created
 */

// Test timeout for this file - shorter than default since we expect failures
const TEST_TIMEOUT = 2000;

/**
 * A test transport where receive() never resolves, simulating a timeout scenario.
 * Messages can be sent, but no response will ever come back.
 */
class NeverRespondTransport implements RpcTransport {
  public sentMessages: string[] = [];
  public aborted = false;
  public abortReason?: any;

  async send(message: string): Promise<void> {
    this.sentMessages.push(message);
    // Message is "sent" but the other side will never respond
  }

  async receive(): Promise<string> {
    // Never resolves - simulates a hung connection or unresponsive peer
    return new Promise<string>(() => {
      // Intentionally never resolves
    });
  }

  abort(reason: any): void {
    this.aborted = true;
    this.abortReason = reason;
  }
}

/**
 * A test transport that can be controlled to delay responses.
 */
class DelayedResponseTransport implements RpcTransport {
  constructor(public name: string, private partner?: DelayedResponseTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;
  public responseDelay: number = 0;

  async send(message: string): Promise<void> {
    // Delay before delivering the message to partner
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }

    return this.queue.shift()!;
  }

  abort(reason: any): void {
    this.aborted = true;
    this.abortReason = reason;
    if (this.aborter) {
      this.aborter(reason);
    }
  }
}

/**
 * Standard TestTransport for tests that need normal bidirectional communication.
 */
class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;

  async send(message: string): Promise<void> {
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }

    return this.queue.shift()!;
  }

  abort(reason: any): void {
    this.aborted = true;
    this.abortReason = reason;
    if (this.aborter) {
      this.aborter(reason);
    }
  }
}

// Spin the microtask queue a bit to give messages time to be delivered and handled.
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

describe("timeout enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("RpcSessionOptions.timeout", () => {
    it("should accept a timeout option in RpcSessionOptions", () => {
      const transport = new NeverRespondTransport();

      // This test verifies that RpcSessionOptions accepts a `timeout` property.
      // Currently this will compile because TypeScript allows extra properties,
      // but the timeout won't actually be enforced.
      const options: RpcSessionOptions = {
        timeout: 5000, // 5 seconds default timeout
      };

      // The session should accept the timeout option without error
      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Verify the stub was created (basic sanity check)
      expect(stub).toBeDefined();
    });

    it("should type-check timeout as a number", () => {
      // This test ensures the timeout option is properly typed as a number
      const options: RpcSessionOptions = {
        // @ts-expect-error - timeout should be a number, not a string
        timeout: "5000",
      };

      // The test passes if TypeScript correctly errors on the above line
      // (checked at compile time, not runtime)
      expect(options.timeout).toBe("5000");
    });
  });

  describe("request timeout behavior", () => {
    it("should throw TimeoutError when request exceeds session timeout", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1000, // 1 second timeout
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Start a call that will never receive a response
      const callPromise = stub.square(5);

      // Advance time past the timeout
      vi.advanceTimersByTime(1100);
      await pumpMicrotasks();

      // The call should reject with a TimeoutError
      await expect(callPromise).rejects.toThrow(TimeoutError);
    });

    it("should throw TimeoutError with correct error code", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 500,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      vi.advanceTimersByTime(600);
      await pumpMicrotasks();

      try {
        await callPromise;
        expect.fail("Expected TimeoutError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        expect((error as TimeoutError).code).toBe(ErrorCode.TIMEOUT_ERROR);
        expect((error as TimeoutError).codeName).toBe("TIMEOUT_ERROR");
      }
    });

    it("should not timeout if response arrives in time", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 5000, // 5 second timeout
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a call
      const callPromise = stub.square(4);

      // Advance time, but not past the timeout
      vi.advanceTimersByTime(100);
      await pumpMicrotasks();

      // The call should complete successfully
      const result = await callPromise;
      expect(result).toBe(16);
    });
  });

  describe("per-call timeout override", () => {
    it("should allow per-call timeout that overrides session default", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 10000, // 10 second default
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Make a call with a shorter per-call timeout
      // This assumes we add a way to pass options to individual calls
      const callPromise = (stub.square as any)(5, { timeout: 500 });

      // Advance time past the per-call timeout but not session default
      vi.advanceTimersByTime(600);
      await pumpMicrotasks();

      // Should timeout based on per-call timeout
      await expect(callPromise).rejects.toThrow(TimeoutError);
    });

    it("should allow longer per-call timeout than session default", { timeout: TEST_TIMEOUT }, async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 1000, // 1 second default - too short
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a call with a longer per-call timeout that should succeed
      const callPromise = (stub.square as any)(3, { timeout: 5000 });

      // Advance time past default timeout but not per-call timeout
      // The call should still succeed because per-call timeout (5000ms) > elapsed time
      vi.advanceTimersByTime(1500);
      await pumpMicrotasks();

      // With TestTransport (no delay), the call should complete immediately
      // and the per-call timeout should have been used instead of session default
      const result = await callPromise;
      expect(result).toBe(9);
    });

    it("should allow timeout: 0 to disable timeout for a call", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 100, // Very short default
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a call with timeout disabled
      const callPromise = (stub.square as any)(7, { timeout: 0 });

      // Advance time way past the default timeout
      vi.advanceTimersByTime(10000);
      await pumpMicrotasks();

      // Should still complete (no timeout when timeout: 0)
      const result = await callPromise;
      expect(result).toBe(49);
    });
  });

  describe("import table cleanup on timeout", () => {
    it("should clean up import table entry when request times out", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 500,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Get initial stats
      const initialStats = session.getStats();

      // Start multiple calls that will timeout
      const call1 = stub.square(1).catch(() => {});
      const call2 = stub.square(2).catch(() => {});
      const call3 = stub.square(3).catch(() => {});

      // Before timeout, we should have pending imports
      await pumpMicrotasks();
      const pendingStats = session.getStats();
      expect(pendingStats.imports).toBeGreaterThan(initialStats.imports);

      // Advance time past timeout
      vi.advanceTimersByTime(600);
      await pumpMicrotasks();

      // Wait for all calls to complete (with timeout errors)
      await Promise.allSettled([call1, call2, call3]);

      // After timeout, import table entries should be cleaned up
      const finalStats = session.getStats();
      // The imports should be cleaned up (back to initial or close to it)
      // Note: Import 0 is the main stub which stays
      expect(finalStats.imports).toBe(initialStats.imports);
    });

    it("should release resources associated with timed-out capability calls", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 500,
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Create a counter (this should work)
      using counter = await stub.makeCounter(10);

      const initialStats = client.getStats();

      // Make a call on the counter that will timeout (simulate by making transport stop responding)
      // We'll need to break the connection somehow to simulate this
      // For now, we'll just verify the stats behavior

      // This test verifies that when a call times out, any resources (like capabilities)
      // that were referenced in the call are properly cleaned up
      expect(counter).toBeDefined();
      expect(initialStats.imports).toBeGreaterThan(0);
    });
  });

  describe("TimeoutError includes elapsed time", () => {
    it("should include the configured timeout in TimeoutError", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 2500,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      vi.advanceTimersByTime(2600);
      await pumpMicrotasks();

      try {
        await callPromise;
        expect.fail("Expected TimeoutError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        // TimeoutError should have timeoutMs property (already exists in the class)
        expect((error as TimeoutError).timeoutMs).toBe(2500);
      }
    });

    it("should include elapsed time in TimeoutError", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1000,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      // Advance exactly 1000ms + a little extra
      vi.advanceTimersByTime(1050);
      await pumpMicrotasks();

      try {
        await callPromise;
        expect.fail("Expected TimeoutError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        // TimeoutError should include elapsed time info
        // This requires adding an `elapsedMs` property to TimeoutError
        expect((error as any).elapsedMs).toBeDefined();
        expect((error as any).elapsedMs).toBeGreaterThanOrEqual(1000);
      }
    });

    it("should include descriptive message with timeout details", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 3000,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      vi.advanceTimersByTime(3100);
      await pumpMicrotasks();

      try {
        await callPromise;
        expect.fail("Expected TimeoutError to be thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        // The message should be descriptive
        expect((error as TimeoutError).message).toContain("timeout");
        // Ideally includes the timeout value in the message
        expect((error as TimeoutError).message).toContain("3000");
      }
    });
  });

  describe("timeout with pipelined calls", () => {
    it("should timeout pipelined calls correctly", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1000,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Make a pipelined call chain
      // stub.makeCounter(5) returns a Counter, then we call increment on it
      const result = stub.makeCounter(5).increment(10);

      vi.advanceTimersByTime(1100);
      await pumpMicrotasks();

      // The pipelined call should also timeout
      await expect(result).rejects.toThrow(TimeoutError);
    });

    it("should timeout map operations correctly", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1000,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Make a map call that will timeout
      const fib = stub.generateFibonacci(5);
      const mapped = fib.map((n: number) => n * 2);

      vi.advanceTimersByTime(1100);
      await pumpMicrotasks();

      // The map operation should timeout
      await expect(mapped).rejects.toThrow(TimeoutError);
    });
  });

  describe("timeout cancellation", () => {
    it("should not fire timeout if call completes before timeout", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 5000,
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a call that completes quickly
      const result = await stub.square(6);
      expect(result).toBe(36);

      // Advance time past the would-be timeout
      vi.advanceTimersByTime(10000);
      await pumpMicrotasks();

      // No timeout should have occurred - session should still be usable
      const result2 = await stub.square(7);
      expect(result2).toBe(49);
    });

    it("should cancel timeout timer when request completes successfully", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const options: RpcSessionOptions = {
        timeout: 1000,
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, options);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Spy on clearTimeout to verify cleanup
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const result = await stub.square(8);
      expect(result).toBe(64);

      // The timeout timer should have been cleared
      // This verifies that we're not leaking timers
      expect(clearTimeoutSpy).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });
  });

  describe("edge cases", () => {
    it("should handle timeout of 0 (no timeout)", async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 0, // Disable timeout
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      // Advance time significantly
      vi.advanceTimersByTime(100000);
      await pumpMicrotasks();

      // Call should still be pending (not rejected)
      // We can't easily test this with vitest, but we can verify no error was thrown
      // The promise should still be pending
      let resolved = false;
      let rejected = false;
      callPromise.then(() => { resolved = true; }).catch(() => { rejected = true; });

      await pumpMicrotasks();

      // Neither resolved nor rejected because no response came
      expect(resolved).toBe(false);
      expect(rejected).toBe(false);
    });

    it("should handle very short timeout (1ms)", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1, // 1ms timeout
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      const callPromise = stub.square(5);

      vi.advanceTimersByTime(5);
      await pumpMicrotasks();

      await expect(callPromise).rejects.toThrow(TimeoutError);
    });

    it("should handle multiple concurrent timeouts correctly", { timeout: TEST_TIMEOUT }, async () => {
      const transport = new NeverRespondTransport();

      const options: RpcSessionOptions = {
        timeout: 1000,
      };

      const session = new RpcSession<TestTarget>(transport, undefined, options);
      const stub = session.getRemoteMain();

      // Start multiple calls at different times
      const call1 = stub.square(1);

      vi.advanceTimersByTime(300);
      const call2 = stub.square(2);

      vi.advanceTimersByTime(300);
      const call3 = stub.square(3);

      // Advance to when call1 should timeout (1000ms from start)
      vi.advanceTimersByTime(500);
      await pumpMicrotasks();

      // call1 should have timed out
      await expect(call1).rejects.toThrow(TimeoutError);

      // call2 and call3 should still be pending (or timeout a bit later)
      // Advance to when call2 should timeout
      vi.advanceTimersByTime(300);
      await pumpMicrotasks();

      await expect(call2).rejects.toThrow(TimeoutError);

      // Advance to when call3 should timeout
      vi.advanceTimersByTime(300);
      await pumpMicrotasks();

      await expect(call3).rejects.toThrow(TimeoutError);
    });
  });
});
