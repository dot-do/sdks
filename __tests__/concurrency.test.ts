// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions } from "../src/index.js"

/**
 * Concurrency tests for RPC session handling (issue: dot-do-capnweb-tix)
 *
 * Tests for race conditions and state consistency:
 * 1. Rapid session creation/close cycles
 * 2. Concurrent abort() and send() calls
 * 3. Concurrent dispose() on same capability (double-dispose)
 * 4. Many parallel calls that all resolve
 * 5. Many parallel calls where session aborts mid-flight
 * 6. State guards preventing operations after close/abort
 *
 * TDD RED PHASE: Some tests may pass, some should fail to reveal gaps in
 * concurrent operation handling.
 */

// A simple test transport for testing RPC sessions
class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public log = false;
  public aborted = false;
  public abortReason?: any;
  public sendCount = 0;
  public receiveCount = 0;

  async send(message: string): Promise<void> {
    this.sendCount++;
    if (this.log) console.log(`${this.name}: ${message}`);
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length == 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }
    this.receiveCount++;
    return this.queue.shift()!;
  }

  abort(reason: any) {
    this.aborted = true;
    this.abortReason = reason;
  }

  forceReceiveError(error: any) {
    if (this.aborter) {
      this.aborter(error);
    }
  }
}

// Transport that can delay messages to simulate network latency
class DelayedTransport implements RpcTransport {
  constructor(public name: string, private partner?: DelayedTransport, private delayMs: number = 0) {
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
    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length == 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }
    return this.queue.shift()!;
  }

  abort(reason: any) {
    this.aborted = true;
    this.abortReason = reason;
  }

  forceReceiveError(error: any) {
    if (this.aborter) {
      this.aborter(error);
    }
  }
}

// Spin the microtask queue
async function pumpMicrotasks(count: number = 16) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

// Simple test target for RPC
class SimpleTarget extends RpcTarget {
  getValue() { return 42; }
  add(a: number, b: number) { return a + b; }
  echo(value: any) { return value; }
  throwError() { throw new Error("test error"); }
}

// Target that tracks method calls for concurrency testing
class TrackedTarget extends RpcTarget {
  public callCount = 0;
  public activeCalls = 0;
  public maxConcurrentCalls = 0;
  public disposeCount = 0;

  async slowMethod(delayMs: number): Promise<number> {
    this.callCount++;
    this.activeCalls++;
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.activeCalls);

    await new Promise(resolve => setTimeout(resolve, delayMs));

    this.activeCalls--;
    return this.callCount;
  }

  syncMethod(value: number): number {
    this.callCount++;
    return value * 2;
  }

  [Symbol.dispose]() {
    this.disposeCount++;
  }
}

// Target that hangs forever
class HangingTarget extends RpcTarget {
  hang(): Promise<never> {
    return new Promise(() => {}); // Never resolves
  }

  slowHang(delayMs: number): Promise<number> {
    return new Promise(resolve => setTimeout(() => resolve(42), delayMs));
  }
}

// Target that creates child objects
class ParentTarget extends RpcTarget {
  private children: TrackedTarget[] = [];

  createChild(): TrackedTarget {
    const child = new TrackedTarget();
    this.children.push(child);
    return child;
  }

  getChildCount(): number {
    return this.children.length;
  }
}

describe("Rapid session creation/close cycles", () => {
  it("should handle 100 rapid connect/disconnect cycles without leaks or crashes", async () => {
    const errors: Error[] = [];

    for (let i = 0; i < 100; i++) {
      try {
        const clientTransport = new TestTransport("client");
        const serverTransport = new TestTransport("server", clientTransport);

        const serverTarget = new SimpleTarget();
        const client = new RpcSession<SimpleTarget>(clientTransport);
        const server = new RpcSession(serverTransport, serverTarget);

        const stub = client.getRemoteMain();

        // Quick call
        expect(await stub.getValue()).toBe(42);

        // Immediately dispose
        stub[Symbol.dispose]();
        await pumpMicrotasks(4);
      } catch (err: any) {
        errors.push(err);
      }
    }

    // Should have no errors
    expect(errors).toHaveLength(0);
  });

  it("should handle rapid create/dispose without any calls", async () => {
    const errors: Error[] = [];

    for (let i = 0; i < 100; i++) {
      try {
        const clientTransport = new TestTransport("client");
        const serverTransport = new TestTransport("server", clientTransport);

        const serverTarget = new SimpleTarget();
        const client = new RpcSession<SimpleTarget>(clientTransport);
        const server = new RpcSession(serverTransport, serverTarget);

        const stub = client.getRemoteMain();

        // Dispose immediately without any calls
        stub[Symbol.dispose]();
        await pumpMicrotasks(2);
      } catch (err: any) {
        errors.push(err);
      }
    }

    expect(errors).toHaveLength(0);
  });

  it("should handle interleaved session creation while others are closing", async () => {
    const sessions: { client: RpcSession<SimpleTarget>, stub: any }[] = [];

    // Create 10 sessions
    for (let i = 0; i < 10; i++) {
      const clientTransport = new TestTransport(`client-${i}`);
      const serverTransport = new TestTransport(`server-${i}`, clientTransport);

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport);
      const server = new RpcSession(serverTransport, serverTarget);

      sessions.push({ client, stub: client.getRemoteMain() });
    }

    // Interleave: create new sessions while disposing old ones
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      // Dispose old session
      sessions[i].stub[Symbol.dispose]();

      // Create new session
      const clientTransport = new TestTransport(`new-client-${i}`);
      const serverTransport = new TestTransport(`new-server-${i}`, clientTransport);

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport);
      const server = new RpcSession(serverTransport, serverTarget);

      const stub = client.getRemoteMain();

      // Make call on new session
      try {
        const result = await stub.getValue();
        results.push(result === 42);
        stub[Symbol.dispose]();
      } catch (err) {
        results.push(false);
      }

      await pumpMicrotasks(4);
    }

    // All new sessions should have worked
    expect(results.every(r => r)).toBe(true);
  });

  it("should handle dispose during pending receive", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a call but dispose before waiting for result
    const callPromise = stub.getValue();

    // Dispose immediately
    stub[Symbol.dispose]();

    // The call should either complete or reject, but not hang
    const timeout = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 1000));

    try {
      await Promise.race([callPromise, timeout]);
    } catch (err: any) {
      // Expected - either connection error or timeout should NOT occur
      if (err.message === "timeout") {
        throw new Error("Call hung instead of completing or rejecting");
      }
      // Connection error is acceptable
    }
  });
});

describe("Concurrent abort() and send() calls", () => {
  it("should handle concurrent abort and send without crashing", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fire off multiple calls concurrently
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      calls.push(stub.syncMethod(i).catch(() => null));
    }

    // Abort mid-flight
    clientTransport.forceReceiveError(new Error("forced abort"));

    // Wait for all calls to settle
    const results = await Promise.allSettled(calls);

    // Some might succeed, some might fail - but none should hang
    // and no crashes should occur
    expect(results.length).toBe(10);
  });

  it("should handle abort during send queue flush", async () => {
    const clientTransport = new DelayedTransport("client", undefined, 10);
    const serverTransport = new DelayedTransport("server", clientTransport, 10);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Queue up many calls
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 20; i++) {
      calls.push(stub.syncMethod(i).catch(() => null));
    }

    // Abort almost immediately
    setTimeout(() => {
      clientTransport.forceReceiveError(new Error("abort during flush"));
    }, 5);

    // All calls should settle (not hang)
    const results = await Promise.allSettled(calls);
    expect(results.length).toBe(20);
  });

  it("should prevent sends after abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a successful call first
    expect(await stub.getValue()).toBe(42);

    // Force abort
    clientTransport.forceReceiveError(new Error("forced abort"));
    await pumpMicrotasks();

    // Record send count before attempting new call
    const sendCountBefore = clientTransport.sendCount;

    // Attempt new call after abort - should not actually send
    try {
      await stub.getValue();
    } catch (err) {
      // Expected
    }

    // Send count should not have increased (no new messages sent after abort)
    // Note: This test may reveal that sends are not properly guarded after abort
    expect(clientTransport.sendCount).toBe(sendCountBefore);
  });

  it("should handle transport.abort being called multiple times", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make call
    expect(await stub.getValue()).toBe(42);

    // Force abort multiple times
    clientTransport.forceReceiveError(new Error("abort 1"));
    clientTransport.forceReceiveError(new Error("abort 2"));
    clientTransport.forceReceiveError(new Error("abort 3"));

    await pumpMicrotasks();

    // Should not crash, transport.abort should only be called once
    // (or handle multiple calls gracefully)
    expect(clientTransport.aborted).toBe(true);
  });
});

describe("Concurrent dispose() on same capability (double-dispose)", () => {
  it("should handle double dispose on main stub without crashing", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    expect(await stub.getValue()).toBe(42);

    // Double dispose
    stub[Symbol.dispose]();
    stub[Symbol.dispose]();

    await pumpMicrotasks();

    // Should not crash
  });

  it("should handle concurrent dispose calls from different code paths", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create multiple references via dup
    const stub2 = stub.dup();
    const stub3 = stub.dup();

    expect(await stub.getValue()).toBe(42);

    // Dispose all concurrently
    stub[Symbol.dispose]();
    stub2[Symbol.dispose]();
    stub3[Symbol.dispose]();

    await pumpMicrotasks();

    // Should not crash
  });

  it("should handle dispose on child capabilities after parent disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create child and get reference
    using child = await stub.createChild();

    // Dispose parent first
    stub[Symbol.dispose]();

    await pumpMicrotasks();

    // Now try to use child - should fail gracefully
    let errorThrown = false;
    try {
      await child.syncMethod(5);
    } catch (err) {
      errorThrown = true;
    }

    expect(errorThrown).toBe(true);

    // Dispose child (already effectively disposed) - should not crash
    child[Symbol.dispose]();
  });

  it("should track dispose count correctly on RpcTargets", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    expect(await stub.syncMethod(5)).toBe(10);

    // Dispose the session
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Server target's dispose should be called exactly once
    expect(serverTarget.disposeCount).toBe(1);

    // Disposing again should not call server dispose again
    // (This may fail if double-dispose protection is missing)
  });

  it("should handle rapid dispose/dup cycles", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Rapid dup/dispose cycles
    for (let i = 0; i < 50; i++) {
      const dup = stub.dup();
      dup[Symbol.dispose]();
    }

    // Original should still work
    expect(await stub.getValue()).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Many parallel calls (50+) that all resolve", () => {
  it("should handle 50 concurrent calls that all succeed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fire 50 concurrent calls
    const calls = Array.from({ length: 50 }, (_, i) =>
      stub.syncMethod(i)
    );

    const results = await Promise.all(calls);

    // All results should be correct
    for (let i = 0; i < 50; i++) {
      expect(results[i]).toBe(i * 2);
    }

    // Server should have received all 50 calls
    expect(serverTarget.callCount).toBe(50);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle 100 concurrent calls with mixed sync/async", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Mix of sync and slow calls
    const calls: Promise<number>[] = [];
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        calls.push(stub.slowMethod(5)); // 10ms delay
      } else {
        calls.push(stub.syncMethod(i));
      }
    }

    const results = await Promise.all(calls);

    // All should complete
    expect(results.length).toBe(100);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle parallel calls that return complex objects", async () => {
    class ComplexTarget extends RpcTarget {
      getComplex(id: number) {
        return {
          id,
          nested: { value: id * 2 },
          array: [1, 2, 3, id]
        };
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ComplexTarget();
    const client = new RpcSession<ComplexTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    const calls = Array.from({ length: 50 }, (_, i) =>
      stub.getComplex(i)
    );

    const results = await Promise.all(calls);

    for (let i = 0; i < 50; i++) {
      expect(results[i].id).toBe(i);
      expect(results[i].nested.value).toBe(i * 2);
      expect(results[i].array).toEqual([1, 2, 3, i]);
    }

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should maintain call order for dependent operations", async () => {
    class OrderedTarget extends RpcTarget {
      private value = 0;

      increment() {
        return ++this.value;
      }

      getValue() {
        return this.value;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new OrderedTarget();
    const client = new RpcSession<OrderedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Sequential increments should maintain order
    const increments = Array.from({ length: 50 }, () =>
      stub.increment()
    );

    const results = await Promise.all(increments);

    // Results should be sequential (1, 2, 3, ..., 50)
    // This tests that message ordering is preserved
    for (let i = 0; i < 50; i++) {
      expect(results[i]).toBe(i + 1);
    }

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Many parallel calls where session aborts mid-flight", () => {
  it("should reject all pending calls when session aborts", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start many hanging calls
    const calls = Array.from({ length: 50 }, () =>
      stub.hang().catch(err => ({ error: err }))
    );

    // Abort after a short delay
    setTimeout(() => {
      clientTransport.forceReceiveError(new Error("session aborted"));
    }, 10);

    const results = await Promise.all(calls);

    // All calls should have been rejected
    for (const result of results) {
      expect(result).toHaveProperty("error");
    }
  });

  it("should handle abort with mix of completed and pending calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Mix of fast sync calls and slow calls
    const calls: Promise<any>[] = [];

    // First add fast calls that might complete
    for (let i = 0; i < 25; i++) {
      calls.push(stub.syncMethod(i).catch(err => ({ error: err })));
    }

    // Then add slow calls that will be pending during abort
    for (let i = 0; i < 25; i++) {
      calls.push(stub.slowMethod(100).catch(err => ({ error: err })));
    }

    // Abort after some calls might have completed
    setTimeout(() => {
      clientTransport.forceReceiveError(new Error("mid-flight abort"));
    }, 20);

    const results = await Promise.all(calls);

    // All should settle (no hanging)
    expect(results.length).toBe(50);

    // At least some should have been rejected
    const rejected = results.filter(r => r && r.error);
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("should not hang when abort happens during response processing", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Queue up many calls
    const calls = Array.from({ length: 50 }, (_, i) =>
      stub.add(i, i).catch(() => null)
    );

    // Force abort very quickly
    setImmediate(() => {
      clientTransport.forceReceiveError(new Error("quick abort"));
    });

    // All should settle within a reasonable time
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 5000));

    const results = await Promise.race([
      Promise.all(calls),
      timeout
    ]);

    expect(results.length).toBe(50);
  });

  it("should clean up import/export tables after abort with pending calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Get initial stats
    const initialStats = client.getStats();

    // Start many hanging calls (will create import entries)
    const calls = Array.from({ length: 50 }, () =>
      stub.hang().catch(() => null)
    );

    await pumpMicrotasks();

    // Stats should show increased imports
    const pendingStats = client.getStats();
    expect(pendingStats.imports).toBeGreaterThan(initialStats.imports);

    // Abort
    clientTransport.forceReceiveError(new Error("abort for cleanup test"));

    await Promise.all(calls);
    await pumpMicrotasks();

    // After abort, tables should be cleaned up
    // Note: This may fail if cleanup is not properly implemented
    const finalStats = client.getStats();
    expect(finalStats.imports).toBeLessThanOrEqual(initialStats.imports);
  });
});

describe("State guards prevent operations after close/abort", () => {
  it("should reject calls after session is disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Dispose
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // New call should fail immediately
    await expect(stub.getValue()).rejects.toThrow();
  });

  it("should reject calls after transport error", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Force transport error
    clientTransport.forceReceiveError(new Error("transport error"));
    await pumpMicrotasks();

    // New call should fail (now throws synchronously due to abort check)
    expect(() => stub.getValue()).toThrow();
  });

  it("should not allow operations on disposed child stubs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create and immediately dispose child
    const child = await stub.createChild();
    child[Symbol.dispose]();
    await pumpMicrotasks();

    // Operations on disposed child should fail
    await expect(child.syncMethod(5)).rejects.toThrow();

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should guard against operations during shutdown", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start dispose but don't await yet
    const disposePromise = (async () => {
      stub[Symbol.dispose]();
      await pumpMicrotasks();
    })();

    // Try to make calls during shutdown
    const calls = [
      stub.getValue().catch(err => ({ error: err })),
      stub.add(1, 2).catch(err => ({ error: err })),
      stub.echo("test").catch(err => ({ error: err }))
    ];

    await disposePromise;
    const results = await Promise.all(calls);

    // All calls during shutdown should fail or complete
    // but none should hang
    expect(results.length).toBe(3);
  });

  it("should handle race between dispose and pending call completion", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a slow call
    const slowCall = stub.slowMethod(50);

    // Dispose before it completes
    setTimeout(() => {
      stub[Symbol.dispose]();
    }, 10);

    // The slow call should either complete or be rejected
    // but should not hang or crash
    let completed = false;
    let errored = false;

    try {
      await slowCall;
      completed = true;
    } catch (err) {
      errored = true;
    }

    expect(completed || errored).toBe(true);
  });

  it("should prevent double-sends on retry after timeout", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    const initialSendCount = clientTransport.sendCount;

    // Start a call
    const callPromise = stub.syncMethod(5);

    // Wait a tiny bit then abort
    await new Promise(r => setTimeout(r, 5));
    clientTransport.forceReceiveError(new Error("simulated timeout"));

    try {
      await callPromise;
    } catch (err) {
      // Expected
    }

    // Record send count after abort
    const afterAbortSendCount = clientTransport.sendCount;

    // Try to make the same call again
    try {
      await stub.syncMethod(5);
    } catch (err) {
      // Expected - should fail without sending
    }

    // No new sends should have happened after abort
    expect(clientTransport.sendCount).toBe(afterAbortSendCount);
  });
});

describe("Edge cases in concurrent operations", () => {
  it("should handle callback errors during abort without crashing", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Register a callback that throws
    stub.onRpcBroken(() => {
      throw new Error("callback error");
    });

    // Register another callback that should still be called
    let secondCallbackCalled = false;
    stub.onRpcBroken(() => {
      secondCallbackCalled = true;
    });

    // Abort
    clientTransport.forceReceiveError(new Error("abort with bad callback"));
    await pumpMicrotasks();

    // Second callback should still have been called despite first throwing
    expect(secondCallbackCalled).toBe(true);
  });

  it("should handle concurrent onRpcBroken registrations and abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    const callbacksCalled: number[] = [];

    // Register callbacks concurrently with abort
    for (let i = 0; i < 10; i++) {
      stub.onRpcBroken(() => {
        callbacksCalled.push(i);
      });

      if (i === 5) {
        // Abort in the middle of registrations
        clientTransport.forceReceiveError(new Error("concurrent abort"));
      }
    }

    await pumpMicrotasks();

    // At least some callbacks should have been called
    expect(callbacksCalled.length).toBeGreaterThan(0);
  });

  it("should handle getStats() during concurrent operations", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start concurrent calls
    const calls = Array.from({ length: 20 }, (_, i) =>
      stub.slowMethod(10).catch(() => null)
    );

    // Call getStats multiple times during operations
    const stats: any[] = [];
    for (let i = 0; i < 10; i++) {
      stats.push(client.getStats());
      await new Promise(r => setTimeout(r, 2));
    }

    // Abort
    clientTransport.forceReceiveError(new Error("abort during stats"));

    await Promise.all(calls);

    // getStats should never have crashed
    expect(stats.length).toBe(10);
    stats.forEach(s => {
      expect(typeof s.imports).toBe("number");
      expect(typeof s.exports).toBe("number");
    });
  });

  it("should handle many rapid dup() calls under load", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create many dups while making calls
    const dups: any[] = [];
    const calls: Promise<any>[] = [];

    for (let i = 0; i < 100; i++) {
      dups.push(stub.dup());
      calls.push(stub.getValue().catch(() => null));
    }

    // Dispose all dups
    dups.forEach(d => d[Symbol.dispose]());

    // Wait for all calls
    await Promise.all(calls);

    // Original should still work
    expect(await stub.getValue()).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});
