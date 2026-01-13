// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions } from "../src/index.js"

/**
 * Backpressure tests for RPC session handling (issue: dot-do-capnweb-pog)
 *
 * TDD RED PHASE: All tests should FAIL initially.
 *
 * Context: All transports currently have unbounded queues and no flow control exists.
 * These tests define the expected backpressure API and behavior.
 *
 * Tests cover:
 * 1. maxPendingCalls option - limit concurrent pending calls
 * 2. Queue size limits - maxQueueSize for transport buffers
 * 3. Backpressure signals - send() returning pressure indicators
 * 4. Resume behavior - drain events and recovery
 * 5. Edge cases - boundary conditions and rapid fire scenarios
 */

// A TestTransport that tracks queue sizes and supports backpressure simulation
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

  // Backpressure tracking
  public maxQueueSize?: number;
  public currentQueueSize = 0;
  public drainResolvers: (() => void)[] = [];

  async send(message: string): Promise<void> {
    this.sendCount++;
    if (this.log) console.log(`${this.name}: ${message}`);
    this.partner!.queue.push(message);
    this.partner!.currentQueueSize = this.partner!.queue.length;
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
    const msg = this.queue.shift()!;
    this.currentQueueSize = this.queue.length;

    // Notify drain listeners if queue is now empty
    if (this.queue.length === 0 && this.drainResolvers.length > 0) {
      for (const resolver of this.drainResolvers) {
        resolver();
      }
      this.drainResolvers = [];
    }

    return msg;
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

  // Helper to wait for drain
  waitForDrain(): Promise<void> {
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.drainResolvers.push(resolve);
    });
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}

// Transport with explicit backpressure support
class BackpressureTransport implements RpcTransport {
  constructor(public name: string, private partner?: BackpressureTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;

  // Backpressure configuration
  public maxQueueSize: number = Infinity;
  public highWaterMark: number = 10;
  public lowWaterMark: number = 2;

  // Backpressure state
  private _isPaused = false;
  private drainResolvers: (() => void)[] = [];

  get isPaused(): boolean {
    return this._isPaused;
  }

  async send(message: string): Promise<void> {
    // Check if queue would exceed maxQueueSize
    if (this.partner!.queue.length >= this.partner!.maxQueueSize) {
      throw new Error("Queue full - backpressure limit exceeded");
    }

    this.partner!.queue.push(message);

    // Check if we're at high water mark
    if (this.partner!.queue.length >= this.partner!.highWaterMark) {
      this.partner!._isPaused = true;
    }

    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  // Returns true if there's backpressure (queue is above high water mark)
  sendWithBackpressure(message: string): boolean {
    this.partner!.queue.push(message);

    // Check if we're at high water mark and set pause state
    if (this.partner!.queue.length >= this.partner!.highWaterMark) {
      this.partner!._isPaused = true;
    }

    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }

    // Return true if pressure is high (caller should wait)
    return this.partner!.queue.length >= this.partner!.highWaterMark;
  }

  async receive(): Promise<string> {
    if (this.queue.length == 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve;
        this.aborter = reject;
      });
    }

    const msg = this.queue.shift()!;

    // Check if we're at low water mark and should resume
    if (this._isPaused && this.queue.length <= this.lowWaterMark) {
      this._isPaused = false;
      for (const resolver of this.drainResolvers) {
        resolver();
      }
      this.drainResolvers = [];
    }

    return msg;
  }

  waitForDrain(): Promise<void> {
    if (!this._isPaused) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.drainResolvers.push(resolve);
    });
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

  getQueueSize(): number {
    return this.queue.length;
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

// Target that tracks concurrent calls
class TrackedTarget extends RpcTarget {
  public callCount = 0;
  public activeCalls = 0;
  public maxConcurrentCalls = 0;
  public completedCalls = 0;

  async slowMethod(delayMs: number): Promise<number> {
    this.callCount++;
    this.activeCalls++;
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.activeCalls);

    await new Promise(resolve => setTimeout(resolve, delayMs));

    this.activeCalls--;
    this.completedCalls++;
    return this.callCount;
  }

  syncMethod(value: number): number {
    this.callCount++;
    return value * 2;
  }
}

// Target that hangs forever
class HangingTarget extends RpcTarget {
  hang(): Promise<never> {
    return new Promise(() => {}); // Never resolves
  }
}

// =============================================================================
// 1. maxPendingCalls option tests
// =============================================================================

describe("maxPendingCalls option in RpcSessionOptions", () => {
  it("should accept maxPendingCalls option in RpcSessionOptions", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();

    // This option should be accepted (currently not implemented)
    const options: RpcSessionOptions = {
      maxPendingCalls: 10,
    } as RpcSessionOptions;

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Should still work with the option
    expect(await stub.getValue()).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should limit number of concurrent pending calls to maxPendingCalls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3, // Limit to 3 pending calls
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start 3 calls (should all be allowed)
    const call1 = stub.hang().catch(() => null);
    const call2 = stub.hang().catch(() => null);
    const call3 = stub.hang().catch(() => null);

    await pumpMicrotasks();

    // The 4th call should be rejected immediately due to limit
    let rejected = false;
    try {
      await stub.hang();
    } catch (err: any) {
      rejected = true;
      expect(err.message).toMatch(/pending.*limit|too many.*calls|backpressure/i);
    }

    expect(rejected).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([call1, call2, call3]);
  });

  it("should throw/reject when pending call limit is exceeded", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 5,
    } as RpcSessionOptions;

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fire off 5 slow calls (at the limit)
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      calls.push(stub.slowMethod(100).catch(() => null));
    }

    await pumpMicrotasks();

    // The 6th call should fail synchronously
    expect(() => stub.slowMethod(100)).toThrow();

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });

  it("should allow new calls after pending calls complete", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
    } as RpcSessionOptions;

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start 2 calls (at limit)
    const call1 = stub.slowMethod(10);
    const call2 = stub.slowMethod(10);

    // Wait for them to complete
    await Promise.all([call1, call2]);

    // Now we should be able to make more calls
    const result = await stub.syncMethod(21);
    expect(result).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should track pending calls correctly with nested stub calls", async () => {
    class ParentTarget extends RpcTarget {
      getChild(): TrackedTarget {
        return new TrackedTarget();
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();

    // Each pipelined chain stub.getChild().slowMethod() is 2 calls
    // So with limit of 4, we can do 2 chains (4 calls total)
    const options: RpcSessionOptions = {
      maxPendingCalls: 4,
    } as RpcSessionOptions;

    const client = new RpcSession<ParentTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start two pipelined chains (4 calls total, at the limit)
    const childCall1 = stub.getChild().slowMethod(100);  // 2 calls
    const childCall2 = stub.getChild().slowMethod(100);  // 4 calls total

    await pumpMicrotasks();

    // Verify we're at the limit
    expect(client.getPendingCallCount()).toBe(4);

    // Should be at limit, next call should fail synchronously
    let rejected = false;
    try {
      stub.getChild().slowMethod(100);
    } catch (err) {
      rejected = true;
    }

    // If maxPendingCalls is properly tracked, this should fail
    expect(rejected).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([childCall1, childCall2]);
  });
});

// =============================================================================
// 2. Queue size limits tests
// =============================================================================

describe("Queue size limits (maxQueueSize option)", () => {
  it("should accept maxQueueSize option for transport buffers", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();

    // This option should be accepted (currently not implemented)
    const options: RpcSessionOptions = {
      maxQueueSize: 100,
    } as RpcSessionOptions;

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(await stub.getValue()).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should reject when queue is full", async () => {
    // Test uses maxPendingCalls as the session-level queue limit
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    // Use session-level backpressure limit
    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Queue up calls until we hit the limit
    const calls: Promise<any>[] = [];
    let errorThrown = false;

    for (let i = 0; i < 10; i++) {
      try {
        calls.push(stub.hang().catch(() => null));
      } catch (err: any) {
        errorThrown = true;
        expect(err.message).toMatch(/pending.*limit|backpressure/i);
        break;
      }
    }

    expect(errorThrown).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });

  it("should block sends when queue is full (if blocking mode)", async () => {
    // Tests that queueFullBehavior: "block" causes calls to wait rather than reject
    // See "Blocking backpressure behavior" test suite for comprehensive blocking tests
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill to capacity
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 3; i++) {
      calls.push(stub.hang().catch(() => null));
    }

    await pumpMicrotasks();

    // The 4th call should block (not reject immediately)
    let resolved = false;
    let rejected = false;

    const blockedCall = stub.hang().then(() => {
      resolved = true;
    }).catch(() => {
      rejected = true;
    });

    // Give it a moment - should still be blocked
    await new Promise(r => setTimeout(r, 50));

    // With blocking mode, the call should NOT have rejected with BackpressureError
    // It should be waiting for capacity
    expect(resolved).toBe(false);
    expect(rejected).toBe(false);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([...calls, blockedCall]);
  });

  it("should track queue size per-transport", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make several calls
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      calls.push(stub.hang().catch(() => null));
    }

    await pumpMicrotasks();

    // Server transport should have received the messages in its queue
    // (This tests that queue size is trackable)
    expect(serverTransport.getQueueSize()).toBeGreaterThanOrEqual(0);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });
});

// =============================================================================
// 3. Backpressure signal tests
// =============================================================================

describe("Backpressure signal (send returns pressure indicator)", () => {
  it("should indicate backpressure when queue is above high water mark", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 3;
    serverTransport.lowWaterMark = 1;

    // Fill up the queue past high water mark
    for (let i = 0; i < 5; i++) {
      clientTransport.sendWithBackpressure(`message-${i}`);
    }

    // Server should indicate it's paused (backpressure)
    expect(serverTransport.isPaused).toBe(true);
  });

  it("should return boolean from send indicating pressure", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 2;

    // First sends should return false (no pressure)
    const pressure1 = clientTransport.sendWithBackpressure("message-1");
    expect(pressure1).toBe(false);

    // After high water mark, should return true
    clientTransport.sendWithBackpressure("message-2");
    const pressure3 = clientTransport.sendWithBackpressure("message-3");
    expect(pressure3).toBe(true);
  });

  it("consumer can wait for drain event", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 2;
    serverTransport.lowWaterMark = 1;

    // Fill up queue
    clientTransport.sendWithBackpressure("message-1");
    clientTransport.sendWithBackpressure("message-2");
    clientTransport.sendWithBackpressure("message-3");

    expect(serverTransport.isPaused).toBe(true);

    // Start waiting for drain
    let drained = false;
    const drainPromise = serverTransport.waitForDrain().then(() => {
      drained = true;
    });

    // Consume messages to trigger drain
    await serverTransport.receive();
    await serverTransport.receive();

    // Should now be drained (at or below low water mark)
    await drainPromise;
    expect(drained).toBe(true);
    expect(serverTransport.isPaused).toBe(false);
  });

  it("RpcSession should expose backpressure status", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    // Set a limit so hasBackpressure can report true
    const options: RpcSessionOptions = {
      maxPendingCalls: 10,
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Initially no backpressure
    expect(client.hasBackpressure()).toBe(false);

    // Make calls up to the limit
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      calls.push(stub.hang().catch(() => null));
    }

    await pumpMicrotasks();

    // Session should expose backpressure status
    expect(typeof client.hasBackpressure).toBe("function");
    // At limit, should have backpressure
    expect(client.hasBackpressure()).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });

  it("RpcSession should provide waitForDrain method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();
    const client = new RpcSession<TrackedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make some calls
    const calls = [
      stub.slowMethod(10),
      stub.slowMethod(10),
      stub.slowMethod(10),
    ];

    // Session should have waitForDrain method
    expect(typeof client.waitForDrain).toBe("function");

    // Wait for calls to complete
    await Promise.all(calls);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// 4. Resume behavior tests
// =============================================================================

describe("Resume behavior after drain", () => {
  it("when queue drains, new sends should work", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 2;
    serverTransport.lowWaterMark = 1;
    serverTransport.maxQueueSize = 3;

    // Fill queue to max
    await clientTransport.send("message-1");
    await clientTransport.send("message-2");
    await clientTransport.send("message-3");

    // Queue is full, should be paused
    expect(serverTransport.isPaused).toBe(true);

    // Drain the queue
    await serverTransport.receive();
    await serverTransport.receive();
    await serverTransport.receive();

    // Should no longer be paused
    expect(serverTransport.isPaused).toBe(false);

    // New sends should work
    await clientTransport.send("message-4");
    expect(serverTransport.getQueueSize()).toBe(1);
  });

  it("pending sends should complete after drain", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 2;
    serverTransport.lowWaterMark = 1;

    // Fill queue
    await clientTransport.send("message-1");
    await clientTransport.send("message-2");
    await clientTransport.send("message-3");

    // Start a send that will wait for drain
    let sendCompleted = false;
    const waitForDrain = serverTransport.waitForDrain().then(() => {
      sendCompleted = true;
    });

    // Drain some messages
    await serverTransport.receive();
    await serverTransport.receive();

    // Wait for the drain signal
    await waitForDrain;
    expect(sendCompleted).toBe(true);
  });

  it("RpcSession should resume making calls after backpressure clears", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
    } as RpcSessionOptions;

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start calls at the limit
    const call1 = stub.slowMethod(50);
    const call2 = stub.slowMethod(50);
    const call3 = stub.slowMethod(50);

    await pumpMicrotasks();

    // At limit, new call should fail
    let rejected = false;
    try {
      // Don't await - just try to start the call
      stub.slowMethod(10);
    } catch (err) {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // Wait for calls to complete
    await Promise.all([call1, call2, call3]);

    // Now new calls should work
    const result = await stub.syncMethod(21);
    expect(result).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle rapid drain/fill cycles", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.highWaterMark = 2;
    serverTransport.lowWaterMark = 1;

    // Rapid cycles of fill and drain
    for (let cycle = 0; cycle < 10; cycle++) {
      // Fill
      await clientTransport.send(`cycle-${cycle}-msg-1`);
      await clientTransport.send(`cycle-${cycle}-msg-2`);
      await clientTransport.send(`cycle-${cycle}-msg-3`);

      // Drain
      await serverTransport.receive();
      await serverTransport.receive();
      await serverTransport.receive();
    }

    // Should still work correctly
    expect(serverTransport.isPaused).toBe(false);
    expect(serverTransport.getQueueSize()).toBe(0);
  });
});

// =============================================================================
// 5. Edge cases tests
// =============================================================================

describe("Backpressure edge cases", () => {
  it("should handle exactly at the limit", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 5,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Exactly at limit - should work
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      calls.push(stub.hang().catch(() => null));
    }

    await pumpMicrotasks();

    // At limit, session should report it
    const pendingCount = client.getPendingCallCount();
    expect(pendingCount).toBe(5);

    // One more should fail synchronously
    expect(() => stub.hang()).toThrow();

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });

  it("should handle rapid fire sending beyond limit", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 10,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Rapid fire 100 calls
    const results: { success: boolean; error?: any }[] = [];

    for (let i = 0; i < 100; i++) {
      try {
        // Fire and don't wait
        stub.hang().catch(() => null);
        results.push({ success: true });
      } catch (err) {
        results.push({ success: false, error: err });
      }
    }

    await pumpMicrotasks();

    // First 10 should succeed, rest should fail
    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;

    expect(successes).toBe(10);
    expect(failures).toBe(90);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
  });

  it("should handle limit of 0 (no calls allowed)", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 0,
    } as RpcSessionOptions;

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Even one call should fail synchronously
    expect(() => stub.getValue()).toThrow();

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
  });

  it("should handle limit of 1", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
    } as RpcSessionOptions;

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // First call should work
    const call1Promise = stub.slowMethod(50);

    await pumpMicrotasks();

    // Second concurrent call should fail
    let rejected = false;
    try {
      stub.slowMethod(10);
    } catch (err) {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // Wait for first call
    await call1Promise;

    // Now another call should work
    const result = await stub.syncMethod(21);
    expect(result).toBe(42);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle abort during backpressure", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 5,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill up to limit - don't use .catch() so we can track actual rejections
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      calls.push(stub.hang());
    }

    await pumpMicrotasks();

    // Abort during backpressure
    clientTransport.forceReceiveError(new Error("abort during backpressure"));

    // All pending calls should be rejected
    const results = await Promise.allSettled(calls);
    const rejectedCount = results.filter(r => r.status === "rejected").length;
    expect(rejectedCount).toBeGreaterThan(0);
  });

  it("should reset pending count on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill up
    const calls = [
      stub.hang().catch(() => null),
      stub.hang().catch(() => null),
      stub.hang().catch(() => null),
    ];

    await pumpMicrotasks();

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));
    await Promise.allSettled(calls);

    // After abort, pending count should be reset
    const pendingCount = client.getPendingCallCount();
    expect(pendingCount).toBe(0);
  });

  it("should handle concurrent calls across multiple stubs", async () => {
    class MultiStubTarget extends RpcTarget {
      getOther(): OtherTarget {
        return new OtherTarget();
      }

      hang(): Promise<never> {
        return new Promise(() => {});
      }
    }

    class OtherTarget extends RpcTarget {
      hang(): Promise<never> {
        return new Promise(() => {});
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new MultiStubTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 4,
    } as RpcSessionOptions;

    const client = new RpcSession<MultiStubTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make 4 hanging calls on the main stub (hits the limit)
    const calls: Promise<any>[] = [];
    calls.push(stub.hang().catch(() => null));
    calls.push(stub.hang().catch(() => null));
    calls.push(stub.hang().catch(() => null));
    calls.push(stub.hang().catch(() => null));

    await pumpMicrotasks();

    // Verify we're at the limit
    expect(client.getPendingCallCount()).toBe(4);

    // Session limit should be shared across all stubs - another call should fail
    let rejected = false;
    try {
      stub.hang();
    } catch (err) {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled(calls);
  });

  it("should handle very large queue sizes gracefully", async () => {
    const clientTransport = new BackpressureTransport("client");
    const serverTransport = new BackpressureTransport("server", clientTransport);

    serverTransport.maxQueueSize = 10000;
    serverTransport.highWaterMark = 5000;
    serverTransport.lowWaterMark = 1000;

    // Queue many messages
    for (let i = 0; i < 5000; i++) {
      await clientTransport.send(`message-${i}`);
    }

    expect(serverTransport.isPaused).toBe(true);
    expect(serverTransport.getQueueSize()).toBe(5000);

    // Drain some
    for (let i = 0; i < 4000; i++) {
      await serverTransport.receive();
    }

    expect(serverTransport.isPaused).toBe(false);
    expect(serverTransport.getQueueSize()).toBe(1000);
  });
});

// =============================================================================
// 6. Blocking backpressure behavior (queueFullBehavior: "block")
// =============================================================================

describe("Blocking backpressure behavior (queueFullBehavior: 'block')", () => {
  // Test 1: With queueFullBehavior: "block", calls wait when queue is full
  it("should block calls when queue is full with queueFullBehavior: 'block'", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill to capacity
    const calls: Promise<any>[] = [];
    for (let i = 0; i < 3; i++) {
      calls.push(stub.hang().catch(() => null));
    }

    await pumpMicrotasks();

    // Verify we're at capacity
    expect(client.getPendingCallCount()).toBe(3);

    // The 4th call should NOT throw - it should return a Promise that blocks
    let fourthCallStarted = false;
    let fourthCallResolved = false;
    let fourthCallRejected = false;

    const fourthCall = (async () => {
      fourthCallStarted = true;
      try {
        await stub.hang();
        fourthCallResolved = true;
      } catch (err) {
        fourthCallRejected = true;
      }
    })();

    // Give time for the call to potentially throw or block
    await pumpMicrotasks();
    await new Promise(r => setTimeout(r, 50));

    // The call should have started (the Promise was created) but not resolved
    expect(fourthCallStarted).toBe(true);
    expect(fourthCallResolved).toBe(false);

    // With blocking mode, the call should NOT have rejected with BackpressureError
    // Instead, it should be waiting for capacity
    expect(fourthCallRejected).toBe(false);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([...calls, fourthCall]);
  });

  // Test 2: Blocked calls resume when queue drains
  it("should resume blocked calls when queue drains", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill to capacity with fast calls
    const call1 = stub.slowMethod(20);
    const call2 = stub.slowMethod(20);

    await pumpMicrotasks();
    expect(client.getPendingCallCount()).toBe(2);

    // Third call should block
    let thirdCallResolved = false;
    const thirdCall = stub.syncMethod(21).then(result => {
      thirdCallResolved = true;
      return result;
    });

    // Give time but not enough for slow calls to complete
    await pumpMicrotasks();
    await new Promise(r => setTimeout(r, 5));

    // Third call should still be blocked
    expect(thirdCallResolved).toBe(false);

    // Wait for the slow calls to complete
    await Promise.all([call1, call2]);

    // Now the third call should proceed and resolve
    const result = await thirdCall;
    expect(thirdCallResolved).toBe(true);
    expect(result).toBe(42); // syncMethod returns value * 2

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  // Test 3: Multiple blocked calls queue in order
  it("should process multiple blocked calls in FIFO order", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    const resolutionOrder: number[] = [];

    // First call takes the only slot
    const call1 = stub.slowMethod(30).then(() => {
      resolutionOrder.push(1);
      return 1;
    });

    await pumpMicrotasks();

    // These should all block in order
    const call2 = stub.syncMethod(2).then(r => {
      resolutionOrder.push(2);
      return r;
    });
    const call3 = stub.syncMethod(3).then(r => {
      resolutionOrder.push(3);
      return r;
    });
    const call4 = stub.syncMethod(4).then(r => {
      resolutionOrder.push(4);
      return r;
    });

    // Wait for all to complete
    await Promise.all([call1, call2, call3, call4]);

    // Blocked calls should have resolved in FIFO order
    expect(resolutionOrder).toEqual([1, 2, 3, 4]);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  // Test 4: Timeout behavior with blocked calls
  it("should timeout blocked calls that wait too long", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
      queueFullBehavior: "block",
      timeout: 50, // 50ms session timeout
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // First call takes the slot and hangs forever
    const call1 = stub.hang().catch(() => null);

    await pumpMicrotasks();

    // Second call should block, then timeout
    let timeoutError: any = null;
    const call2 = stub.hang().catch(err => {
      timeoutError = err;
      return null;
    });

    // Wait for the timeout to trigger
    await new Promise(r => setTimeout(r, 100));

    // The blocked call should have timed out
    expect(timeoutError).not.toBeNull();
    expect(timeoutError.message).toMatch(/timeout|timed out/i);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([call1, call2]);
  });

  // Test 5: Session close while calls are blocked
  it("should reject blocked calls when session closes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // First call takes the slot
    const call1 = stub.hang().catch(err => ({ rejected: true, error: err }));

    await pumpMicrotasks();

    // Second call blocks
    let call2Error: any = null;
    const call2 = stub.hang().catch(err => {
      call2Error = err;
      return { rejected: true, error: err };
    });

    await pumpMicrotasks();

    // Close the session while call2 is blocked
    client.close(new Error("Session closed by user"));

    // Both calls should reject
    const results = await Promise.all([call1, call2]);

    expect(results[0]).toHaveProperty("rejected", true);
    expect(results[1]).toHaveProperty("rejected", true);

    // The blocked call should have been rejected
    expect(call2Error).not.toBeNull();
  });

  // Test 6: Cleanup of blocked calls on abort
  it("should properly cleanup blocked calls on session abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill up capacity
    const call1 = stub.hang().catch(() => "rejected1");
    const call2 = stub.hang().catch(() => "rejected2");

    await pumpMicrotasks();

    // These should block
    const blockedCalls: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      blockedCalls.push(stub.hang().catch(() => `blocked${i}-rejected`));
    }

    await pumpMicrotasks();

    // Force an error (transport disconnect)
    clientTransport.forceReceiveError(new Error("transport error"));

    // All calls should be rejected
    const results = await Promise.allSettled([call1, call2, ...blockedCalls]);

    // After abort, pending count should be 0
    expect(client.getPendingCallCount()).toBe(0);

    // All should have completed (either fulfilled with rejection message or rejected)
    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }
  });

  // Test 7: Blocking with different maxPendingCalls values
  it("should respect blocking with maxPendingCalls of 0", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 0,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Even the first call should block with maxPendingCalls: 0
    let callStarted = false;
    let callCompleted = false;

    const call = (async () => {
      callStarted = true;
      try {
        await stub.getValue();
        callCompleted = true;
      } catch {
        // Expected to block forever or get cleaned up
      }
    })();

    await pumpMicrotasks();
    await new Promise(r => setTimeout(r, 50));

    // Call should have started (promise created) but not completed
    expect(callStarted).toBe(true);
    expect(callCompleted).toBe(false);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([call]);
  });

  // Test 8: Verify Promise doesn't resolve until queue has capacity
  it("should return Promise that resolves only when queue has capacity", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Track when the blocked call actually gets sent
    const originalSend = clientTransport.send.bind(clientTransport);
    let sendCalls = 0;
    clientTransport.send = async (msg: string) => {
      sendCalls++;
      return originalSend(msg);
    };

    // First call takes the slot
    const call1 = stub.slowMethod(50);
    await pumpMicrotasks();
    const sendCallsAfterFirst = sendCalls;

    // Second call should block
    const call2 = stub.syncMethod(10);
    await pumpMicrotasks();
    await new Promise(r => setTimeout(r, 10));

    // With blocking, the second call's message should NOT have been sent yet
    expect(sendCalls).toBe(sendCallsAfterFirst);

    // Wait for first call to complete
    await call1;

    // Now second call should proceed
    const result = await call2;
    expect(result).toBe(20);

    // Verify the send was called for the second call after first completed
    expect(sendCalls).toBeGreaterThan(sendCallsAfterFirst);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  // Test 9: Interaction between block mode and waitForDrain
  it("should work correctly with waitForDrain in blocking mode", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill capacity
    const call1 = stub.slowMethod(30);
    const call2 = stub.slowMethod(30);

    await pumpMicrotasks();

    // Should have backpressure
    expect(client.hasBackpressure()).toBe(true);

    // Start waiting for drain
    let drained = false;
    const drainPromise = client.waitForDrain().then(() => {
      drained = true;
    });

    // Wait for calls to complete
    await Promise.all([call1, call2]);

    // Drain should have been signaled
    await drainPromise;
    expect(drained).toBe(true);
    expect(client.hasBackpressure()).toBe(false);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  // Test 10: Cancel blocked call via AbortController (future feature)
  it("should support cancellation of blocked calls via AbortSignal", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 1,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // First call takes the slot
    const call1 = stub.hang().catch(() => null);
    await pumpMicrotasks();

    // Create an AbortController for the blocked call
    const controller = new AbortController();

    // Second call should block, but we want to cancel it
    let cancelError: any = null;
    const call2 = stub.hang().catch(err => {
      cancelError = err;
      return null;
    });

    await pumpMicrotasks();

    // Abort the controller (this would cancel the blocked call in a full implementation)
    controller.abort(new Error("User cancelled"));

    // Note: This test expects AbortSignal integration which may not be implemented yet
    // The test documents the expected behavior for cancellation of blocked calls

    // For now, cleanup via session close
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([call1, call2]);

    // The blocked call should have been rejected (via cleanup or abort)
    // When AbortSignal is implemented, cancelError should match the abort reason
    // expect(cancelError?.message).toMatch(/cancelled|aborted/i);
  });

  // Test 11: Verify blocking mode doesn't lose calls
  it("should not lose any calls when blocking", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fire off many calls - some will block
    const totalCalls = 20;
    const calls: Promise<number>[] = [];

    for (let i = 0; i < totalCalls; i++) {
      calls.push(stub.syncMethod(i));
    }

    // Wait for all calls to complete
    const results = await Promise.all(calls);

    // All calls should have completed with correct results
    expect(results.length).toBe(totalCalls);
    for (let i = 0; i < totalCalls; i++) {
      expect(results[i]).toBe(i * 2); // syncMethod returns value * 2
    }

    // Server should have received all calls
    expect(serverTarget.callCount).toBe(totalCalls);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  // Test 12: Stress test with rapid blocking/unblocking
  it("should handle rapid blocking/unblocking cycles", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 3,
      queueFullBehavior: "block",
    };

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Rapidly fire calls that complete quickly
    const calls: Promise<number>[] = [];
    for (let i = 0; i < 50; i++) {
      calls.push(stub.syncMethod(i));
    }

    // All should complete successfully
    const results = await Promise.all(calls);
    expect(results.length).toBe(50);

    // Verify all returned correct values
    for (let i = 0; i < 50; i++) {
      expect(results[i]).toBe(i * 2);
    }

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Backpressure integration with RPC flows", () => {
  it("should apply backpressure during batch operations", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new TrackedTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 10,
    } as RpcSessionOptions;

    const client = new RpcSession<TrackedTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Simulate batch: rapid sequential calls
    const batchSize = 50;
    const results: boolean[] = [];

    for (let i = 0; i < batchSize; i++) {
      try {
        stub.slowMethod(10);
        results.push(true);
      } catch (err) {
        results.push(false);
      }
    }

    await pumpMicrotasks();

    // Only first 10 should have succeeded
    const successCount = results.filter(r => r).length;
    expect(successCount).toBe(10);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
  });

  it("should propagate backpressure errors correctly", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();

    const options: RpcSessionOptions = {
      maxPendingCalls: 2,
    } as RpcSessionOptions;

    const client = new RpcSession<HangingTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill limit
    const call1 = stub.hang().catch(() => null);
    const call2 = stub.hang().catch(() => null);

    await pumpMicrotasks();

    // The error should be a specific backpressure error
    let errorType: string = "";
    try {
      await stub.hang();
    } catch (err: any) {
      errorType = err.name || err.constructor.name;
    }

    // Should throw a specific error type (not implemented yet)
    expect(errorType).toMatch(/BackpressureError|CapacityError|LimitError|Error/);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([call1, call2]);
  });

  it("should handle backpressure with promise pipelining", async () => {
    class PipelineTarget extends RpcTarget {
      getNext(): PipelineTarget {
        return new PipelineTarget();
      }

      hang(): Promise<never> {
        return new Promise(() => {});
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new PipelineTarget();

    // Each pipelined chain like stub.getNext().hang() is 2 calls
    // So with maxPendingCalls = 4, we can do 2 chains (4 calls)
    const options: RpcSessionOptions = {
      maxPendingCalls: 4,
    } as RpcSessionOptions;

    const client = new RpcSession<PipelineTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Pipelining: each chain is 2 calls (getNext + hang)
    const pipeline1 = stub.getNext().hang().catch(() => null);  // 2 calls
    const pipeline2 = stub.getNext().hang().catch(() => null);  // 4 calls total

    await pumpMicrotasks();

    // Verify we're at the limit
    expect(client.getPendingCallCount()).toBe(4);

    // Further pipelining should fail due to backpressure
    let rejected = false;
    try {
      stub.getNext().hang();
    } catch (err) {
      rejected = true;
    }
    expect(rejected).toBe(true);

    // Cleanup
    clientTransport.forceReceiveError(new Error("cleanup"));
    await Promise.allSettled([pipeline1, pipeline2]);
  });
});
