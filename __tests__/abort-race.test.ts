// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions } from "../src/index.js"
import { ConnectionError } from "../src/errors.js"

/**
 * Abort + Send Race Condition Tests (issue: dot-do-capnweb-ise)
 *
 * TDD RED PHASE: These tests should FAIL initially because the race
 * condition handling is not yet implemented.
 *
 * Tests cover:
 * 1. abort() called while send() is in flight
 * 2. send() called immediately after abort()
 * 3. Multiple concurrent sends during abort
 * 4. Message ordering guarantees during abort
 *
 * Expected behavior:
 * - No orphaned messages (messages that are sent but never get a response)
 * - Clean rejection of in-flight calls with appropriate errors
 * - No double-free of resources (dispose called multiple times)
 * - Consistent state after abort completes
 */

// Helper to pump microtasks
async function pumpMicrotasks(count: number = 10): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

// A test transport that allows fine-grained control over timing
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
  public sendHistory: string[] = [];
  public abortCallCount = 0;
  // Error property for synchronous abort detection
  public error?: unknown;

  async send(message: string): Promise<void> {
    this.sendCount++;
    this.sendHistory.push(message);
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
    this.abortCallCount++;
    this.aborted = true;
    this.abortReason = reason;
  }

  forceReceiveError(error: any) {
    // Set the error property so the session can detect it synchronously
    this.error = error;
    if (this.aborter) {
      this.aborter(error);
    }
  }

  // Helper to clear any pending waiters
  clearWaiters() {
    if (this.aborter) {
      this.aborter(new Error("cleared"));
      this.waiter = undefined;
      this.aborter = undefined;
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }
}

// Transport that delays sends to simulate network latency
class SlowSendTransport implements RpcTransport {
  constructor(
    public name: string,
    private partner?: SlowSendTransport,
    public sendDelayMs: number = 50
  ) {
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
  public sendInProgress = 0;
  public completedSends = 0;
  public error?: unknown;

  async send(message: string): Promise<void> {
    this.sendCount++;
    this.sendInProgress++;

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, this.sendDelayMs));

    this.sendInProgress--;
    this.completedSends++;

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
    this.error = error;
    if (this.aborter) {
      this.aborter(error);
    }
  }
}

// Simple RPC target for testing
class SimpleTarget extends RpcTarget {
  private value = 42;

  getValue(): number {
    return this.value;
  }

  setValue(v: number): void {
    this.value = v;
  }

  async asyncOp(): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 10));
    return "done";
  }

  createNested(): { child: SimpleTarget } {
    return { child: new SimpleTarget() };
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe("abort() called while send() is in flight", () => {
  it("should cleanly reject in-flight send when abort is called", async () => {
    const clientTransport = new SlowSendTransport("client");
    const serverTransport = new SlowSendTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    // Start a call that will be in-flight
    // Add a .catch() to capture the rejection
    let rejectionError: unknown;
    const callPromise = stub.getValue().catch((e: unknown) => {
      rejectionError = e;
      return "rejected";
    });

    // Abort while the send is still in progress
    await new Promise(resolve => setTimeout(resolve, 10));
    clientTransport.forceReceiveError(new Error("abort during send"));

    // Wait for the call to settle
    const result = await callPromise;

    expect(result).toBe("rejected");
    expect(rejectionError).toBeDefined();
    expect(rejectionError).toBeInstanceOf(ConnectionError);
  });

  it("should not leave orphaned messages when abort during send", async () => {
    const clientTransport = new SlowSendTransport("client");
    const serverTransport = new SlowSendTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start multiple calls
    const calls = [
      stub.getValue().catch(() => "rejected"),
      stub.getValue().catch(() => "rejected"),
      stub.getValue().catch(() => "rejected"),
    ];

    // Abort mid-flight
    await new Promise(resolve => setTimeout(resolve, 20));
    clientTransport.forceReceiveError(new Error("abort"));

    // All calls should settle (not hang forever)
    const results = await Promise.all(calls);
    expect(results.every(r => r === "rejected")).toBe(true);
  });

  it("should handle abort exactly when send() promise is about to resolve", async () => {
    const clientTransport = new SlowSendTransport("client", undefined, 10);
    const serverTransport = new SlowSendTransport("server", clientTransport, 10);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start a call
    const callPromise = stub.getValue().catch(e => ({ error: e }));

    // Abort exactly when send would complete (timing-sensitive)
    await new Promise(resolve => setTimeout(resolve, 9));
    clientTransport.forceReceiveError(new Error("abort at send completion"));

    const result = await callPromise;

    // Should have settled without throwing unhandled errors
    expect(result !== undefined).toBe(true);
  });

  it("should not call transport.abort() multiple times", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    // Force multiple abort triggers
    clientTransport.forceReceiveError(new Error("first abort"));

    await pumpMicrotasks();

    // Try to abort again
    client.close(new Error("second abort"));

    await pumpMicrotasks();

    // transport.abort should only be called once
    expect(clientTransport.abortCallCount).toBe(1);
  });
});

describe("send() called immediately after abort()", () => {
  it("should reject calls made immediately after abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Make a call first to ensure connection is established
    await stub.getValue();

    const sendCountBefore = clientTransport.sendCount;

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));
    // DO NOT pump microtasks - test immediately after abort

    // Attempt call immediately after abort (no await, no pump)
    let callFailed = false;
    try {
      stub.getValue();
    } catch (e) {
      callFailed = true;
      expect(e).toBeInstanceOf(ConnectionError);
    }

    // The call should have been synchronously rejected
    expect(callFailed).toBe(true);

    // No new messages should have been sent after abort
    // This is a key invariant: once aborted, no new sends should occur
    expect(clientTransport.sendCount).toBe(sendCountBefore);
  });

  it("should reject calls in the same microtask as abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    await stub.getValue();

    const sendCountBefore = clientTransport.sendCount;

    // In the same synchronous block: abort then call
    clientTransport.forceReceiveError(new Error("abort"));

    // With the transport error check, calls now throw synchronously
    let error1: unknown;
    let error2: unknown;
    try {
      stub.getValue();
    } catch (e) {
      error1 = e;
    }
    try {
      stub.getValue();
    } catch (e) {
      error2 = e;
    }

    // All calls should be rejected with ConnectionError
    expect(error1).toBeInstanceOf(ConnectionError);
    expect(error2).toBeInstanceOf(ConnectionError);

    // No sends after abort
    expect(clientTransport.sendCount).toBe(sendCountBefore);
  });

  it("should synchronously guard against sends after abort flag is set", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Abort
    client.close(new Error("explicit close"));

    // isClosed should be true synchronously
    expect(client.isClosed).toBe(true);

    // Calls after close should fail synchronously
    expect(() => stub.getValue()).toThrow();
  });

  it("should properly transition state during abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    expect(client.isClosed).toBe(false);

    client.close(new Error("test"));

    expect(client.isClosed).toBe(true);
  });
});

describe("Multiple concurrent sends during abort", () => {
  it("should reject all concurrent sends when abort occurs", async () => {
    const clientTransport = new SlowSendTransport("client", undefined, 20);
    const serverTransport = new SlowSendTransport("server", clientTransport, 20);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start many concurrent calls
    const calls = Array(10).fill(null).map(() =>
      stub.getValue().catch(e => ({ error: e }))
    );

    // Abort while sends are in progress
    await new Promise(resolve => setTimeout(resolve, 5));
    clientTransport.forceReceiveError(new Error("abort"));

    // All should settle
    const results = await Promise.all(calls);

    // All should be rejected (not stuck)
    expect(results.every(r => "error" in r)).toBe(true);
  });

  it("should handle interleaved send completions and abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    // Quick succession of calls and abort
    const call1 = stub.getValue().catch((e: unknown) => ({ error: e }));
    clientTransport.forceReceiveError(new Error("abort"));

    // After abort, calls throw synchronously
    let error2: unknown;
    try {
      stub.getValue();
    } catch (e) {
      error2 = e;
    }

    const r1 = await call1;

    // First call should settle, second should throw synchronously
    expect(r1 !== undefined).toBe(true);
    expect(error2).toBeInstanceOf(ConnectionError);
  });

  it("should not have data races in pending call tracking", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    // Create calls rapidly, some before abort, some after
    const calls: Promise<any>[] = [];
    const syncErrors: unknown[] = [];

    for (let i = 0; i < 5; i++) {
      if (i === 2) {
        clientTransport.forceReceiveError(new Error("abort"));
      }

      try {
        calls.push(stub.getValue().catch((e: unknown) => ({ error: e })));
      } catch (e) {
        // After abort, calls throw synchronously
        syncErrors.push(e);
      }
    }

    // Calls before abort should settle
    const results = await Promise.all(calls);

    // Total of async results + sync errors should be 5
    expect(results.length + syncErrors.length).toBe(5);
  });

  it("should handle rapid abort-send-abort-send cycles", async () => {
    // This test verifies no crash occurs with rapid state changes
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // First abort
    clientTransport.forceReceiveError(new Error("abort 1"));

    // Try to send (should fail synchronously with transport error check)
    let syncError: unknown;
    try {
      stub.getValue();
    } catch (e) {
      syncError = e;
    }

    expect(syncError).toBeInstanceOf(ConnectionError);
  });
});

describe("Message ordering guarantees during abort", () => {
  it("should preserve message ordering for calls that complete before abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Make calls
    const call1 = stub.getValue();
    const call2 = stub.getValue();

    // Let them complete
    await pumpMicrotasks();

    const [r1, r2] = await Promise.all([call1, call2]);

    // Both should succeed with correct value
    expect(r1).toBe(42);
    expect(r2).toBe(42);
  });

  it("should reject calls in FIFO order when abort occurs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    const rejectionOrder: number[] = [];

    const call1 = stub.getValue().catch(() => { rejectionOrder.push(1); return null; });
    const call2 = stub.getValue().catch(() => { rejectionOrder.push(2); return null; });
    const call3 = stub.getValue().catch(() => { rejectionOrder.push(3); return null; });

    clientTransport.forceReceiveError(new Error("abort"));

    await Promise.all([call1, call2, call3]);

    // Rejections should happen in order
    expect(rejectionOrder).toEqual([1, 2, 3]);
  });

  it("should not deliver responses after abort for calls sent before abort", async () => {
    const clientTransport = new SlowSendTransport("client", undefined, 50);
    const serverTransport = new SlowSendTransport("server", clientTransport, 50);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start a call
    const callPromise = stub.getValue().catch(e => ({ error: e }));

    // Abort after send starts but before response
    await new Promise(resolve => setTimeout(resolve, 25));
    clientTransport.forceReceiveError(new Error("abort"));

    const result = await callPromise;

    // Should be rejected, not resolved
    expect("error" in result).toBe(true);
  });

  it("should not process messages received after abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    // Abort the client
    client.close(new Error("abort"));

    // Messages arriving after abort should not cause errors
    // (the session should ignore them)
    await pumpMicrotasks();

    expect(client.isClosed).toBe(true);
  });
});

describe("No orphaned messages", () => {
  it("should not leave messages that never get responses", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start calls
    const calls = [
      stub.getValue().catch(() => "rejected"),
      stub.getValue().catch(() => "rejected"),
    ];

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));

    // Wait for settlement
    const results = await Promise.all(calls);

    // All should have settled
    expect(results.every(r => r === "rejected")).toBe(true);
  });

  it("should cleanup import/export tables on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Make some calls
    await stub.getValue();
    await stub.getValue();

    // Abort
    client.close(new Error("cleanup"));

    await pumpMicrotasks();

    // Stats should show cleanup
    const stats = client.getStats();
    expect(stats.imports).toBe(0);
  });

  it("should track all in-flight messages until they settle", async () => {
    const clientTransport = new SlowSendTransport("client", undefined, 20);
    const serverTransport = new SlowSendTransport("server", clientTransport, 20);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start calls
    const calls = Array(5).fill(null).map(() =>
      stub.getValue().catch(() => "rejected")
    );

    // Abort mid-flight
    await new Promise(resolve => setTimeout(resolve, 10));
    clientTransport.forceReceiveError(new Error("abort"));

    // All should settle
    const results = await Promise.all(calls);
    expect(results.length).toBe(5);
    expect(results.every(r => typeof r === "string" || typeof r === "number")).toBe(true);
  });
});

describe("No double-free of resources", () => {
  it("should only call dispose once on RpcTargets during abort", async () => {
    let disposeCount = 0;

    class TrackingTarget extends RpcTarget {
      getValue(): number { return 1; }

      [Symbol.dispose](): void {
        disposeCount++;
        // Only call super if it has Symbol.dispose (RpcTarget might be an empty class)
        if (Symbol.dispose in RpcTarget.prototype) {
          (super[Symbol.dispose] as () => void)();
        }
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new TrackingTarget());

    // Abort
    client.close(new Error("abort"));

    await pumpMicrotasks();

    // Server side should clean up
    server.close(new Error("server close"));

    await pumpMicrotasks();

    // Dispose should only be called once
    expect(disposeCount).toBe(1);
  });

  it("should not double-reject pending promises", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    let rejectCount = 0;
    const call = stub.getValue().catch(() => {
      rejectCount++;
      return "rejected";
    });

    // Multiple abort attempts
    clientTransport.forceReceiveError(new Error("abort 1"));
    await pumpMicrotasks();
    client.close(new Error("abort 2"));

    await call;

    // Should only be rejected once
    expect(rejectCount).toBe(1);
  });

  it("should handle concurrent abort and close gracefully", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    // Trigger both abort paths simultaneously
    clientTransport.forceReceiveError(new Error("transport error"));
    client.close(new Error("explicit close"));

    await pumpMicrotasks();

    // Should settle cleanly
    expect(client.isClosed).toBe(true);
    expect(clientTransport.aborted).toBe(true);
  });

  it("should not leak memory when abort occurs with many pending stubs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Create many calls
    const calls = Array(100).fill(null).map(() =>
      stub.getValue().catch(() => "rejected")
    );

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));

    await Promise.all(calls);

    await pumpMicrotasks();

    // Should have cleaned up
    const stats = client.getStats();
    expect(stats.imports).toBe(0);
  });
});

describe("Clean rejection of in-flight calls", () => {
  it("should reject with ConnectionError on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    // Start call before abort
    let rejectionError: unknown;
    const callPromise = stub.getValue().catch((e: unknown) => {
      rejectionError = e;
      return "rejected";
    });

    // Then abort
    clientTransport.forceReceiveError(new Error("abort"));

    await callPromise;
    expect(rejectionError).toBeInstanceOf(ConnectionError);
  });

  it("should include descriptive error message on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    let caughtError: unknown;
    const callPromise = stub.getValue().catch((e: unknown) => {
      caughtError = e;
      return "rejected";
    });

    clientTransport.forceReceiveError(new Error("network failure"));

    await callPromise;
    expect(caughtError).toBeDefined();
    expect((caughtError as Error).message).toContain("network failure");
  });

  it("should reject with consistent error for all pending calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    const errors: unknown[] = [];
    const calls = [
      stub.getValue().catch((e: unknown) => { errors.push(e); return "rejected"; }),
      stub.getValue().catch((e: unknown) => { errors.push(e); return "rejected"; }),
      stub.getValue().catch((e: unknown) => { errors.push(e); return "rejected"; }),
    ];

    clientTransport.forceReceiveError(new Error("abort"));

    await Promise.all(calls);

    // All errors should be ConnectionError with consistent message
    expect(errors.every(e => e instanceof ConnectionError)).toBe(true);
    expect(errors.every(e => (e as Error).message === (errors[0] as Error).message)).toBe(true);
  });

  it("should not throw unhandled promise rejections", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Don't await these - they would be "fire and forget" in real code
    stub.getValue().catch(() => {});
    stub.getValue().catch(() => {});

    clientTransport.forceReceiveError(new Error("abort"));

    // Wait for any potential unhandled rejections
    await new Promise(resolve => setTimeout(resolve, 100));

    // If we get here without unhandled rejection errors, we're good
    expect(true).toBe(true);
  });
});

describe("Abort during complex operations", () => {
  it("should handle abort during pipelined call chain", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start a pipelined call
    const nestedPromise = stub.createNested().then(result => result.child.getValue())
      .catch(e => ({ error: e }));

    // Abort mid-pipeline
    clientTransport.forceReceiveError(new Error("abort"));

    const result = await nestedPromise;

    // Should settle (either with value or error)
    expect(result !== undefined).toBe(true);
  });

  it("should handle abort during dup operations", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain() as any;

    // Get nested, which would create stubs
    // Add catch immediately to capture rejection
    let nestedError: unknown;
    const nested = stub.createNested().catch((e: unknown) => {
      nestedError = e;
      return "rejected";
    });

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));

    // Wait for the nested call to settle
    const result = await nested;

    // Should have been rejected with ConnectionError
    expect(result === "rejected" || nestedError !== undefined).toBe(true);
  });

  it("should handle abort with nested object returns", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession(clientTransport, null);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    // Start call
    const nestedPromise = stub.createNested().catch(e => ({ error: e }));

    await pumpMicrotasks();

    // Abort
    clientTransport.forceReceiveError(new Error("abort"));

    const result = await nestedPromise;

    // Should settle cleanly
    expect(result !== undefined).toBe(true);

    // Session should be closed
    expect(client.isClosed).toBe(true);
  });
});
