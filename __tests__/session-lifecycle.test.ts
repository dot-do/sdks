// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions } from "../src/index.js"
import { ConnectionError } from "../src/errors.js"

/**
 * Tests for RpcSession lifecycle management (close/cleanup API).
 *
 * These tests specify the desired behavior for:
 * - RpcSession.close() method for graceful shutdown
 * - RpcSession.onClosed() promise for detecting session end
 * - Proper cleanup of pending calls and import/export tables
 *
 * Related to issue: dot-do-capnweb-ql2
 *
 * TDD RED PHASE: These tests should FAIL initially because the close() and
 * onClosed() methods do not yet exist on RpcSession.
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

  async send(message: string): Promise<void> {
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
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

// Simple test target for RPC
class SimpleTarget extends RpcTarget {
  getValue() { return 42; }
  add(a: number, b: number) { return a + b; }
  throwError() { throw new Error("test error"); }
}

// Target with a method that never resolves (for testing pending calls)
class HangingTarget extends RpcTarget {
  hang(): Promise<number> {
    return new Promise(() => {}); // Never resolves
  }

  slowOperation(delayMs: number): Promise<number> {
    return new Promise(resolve => setTimeout(() => resolve(42), delayMs));
  }
}

// Target that creates nested objects to test import/export cleanup
class NestedTarget extends RpcTarget {
  createChild() {
    return new SimpleTarget();
  }
}

describe("RpcSession.close() method", () => {
  it("should have a close() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // The close() method should exist
    expect(typeof client.close).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should gracefully close the session when close() is called", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a successful call first
    expect(await stub.getValue()).toBe(42);

    // Close the session
    await client.close();

    // Transport should be notified
    expect(clientTransport.aborted).toBe(true);

    await pumpMicrotasks();
  });

  it("should allow close() to be called multiple times without error", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Should not throw when called multiple times
    await client.close();
    await client.close();
    await client.close();

    await pumpMicrotasks();
  });
});

describe("RpcSession.onClosed() promise", () => {
  it("should have an onClosed() method that returns a promise", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // The onClosed() method should exist and return a promise
    expect(typeof client.onClosed).toBe("function");
    const closedPromise = client.onClosed();
    expect(closedPromise).toBeInstanceOf(Promise);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should resolve onClosed() when close() is called", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    let closedResolved = false;
    const closedPromise = client.onClosed().then(() => {
      closedResolved = true;
    });

    // Not yet closed
    expect(closedResolved).toBe(false);

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // Now it should be resolved
    expect(closedResolved).toBe(true);
  });

  it("should resolve onClosed() when transport disconnects", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    let closedResolved = false;
    let closedError: any = null;
    const closedPromise = client.onClosed().then((error) => {
      closedResolved = true;
      closedError = error;
    });

    // Not yet closed
    expect(closedResolved).toBe(false);

    // Force a transport disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    // Now it should be resolved with the error
    expect(closedResolved).toBe(true);
  });

  it("should resolve onClosed() when main stub is disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    let closedResolved = false;
    const closedPromise = client.onClosed().then(() => {
      closedResolved = true;
    });

    const stub = client.getRemoteMain();

    // Not yet closed
    expect(closedResolved).toBe(false);

    // Dispose the main stub (which triggers session shutdown)
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Now it should be resolved
    expect(closedResolved).toBe(true);
  });

  it("should resolve immediately if session is already closed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Close the session first
    await client.close();
    await pumpMicrotasks();

    // onClosed() should resolve immediately when called after close
    let resolved = false;
    await client.onClosed().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(true);
  });
});

describe("Pending calls rejected on close", () => {
  it("should reject pending calls with ConnectionError when session closes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a call that will hang
    const hangPromise = stub.hang();

    // Close the session while the call is pending
    client.close();
    await pumpMicrotasks();

    // The hanging call should be rejected with ConnectionError
    // First catch the rejection to avoid unhandled rejection
    let rejectionError: unknown;
    try {
      await hangPromise;
    } catch (e) {
      rejectionError = e;
    }
    expect(rejectionError).toBeDefined();
    expect(rejectionError).toBeInstanceOf(ConnectionError);
  });

  it("should reject multiple pending calls when session closes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start multiple calls that will hang
    const hangPromise1 = stub.hang();
    const hangPromise2 = stub.hang();
    const hangPromise3 = stub.hang();

    // Close the session while calls are pending
    client.close();
    await pumpMicrotasks();

    // All pending calls should be rejected
    const results = await Promise.allSettled([hangPromise1, hangPromise2, hangPromise3]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("rejected");
  });

  it("should include 'Session closed' in error message for pending calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a call that will hang
    const hangPromise = stub.hang();

    // Close the session while the call is pending
    client.close();
    await pumpMicrotasks();

    // The error message should mention session closure
    let rejectionError: unknown;
    try {
      await hangPromise;
    } catch (e) {
      rejectionError = e;
    }
    expect(rejectionError).toBeDefined();
    expect((rejectionError as Error).message).toMatch(/session.*closed|closed/i);
  });
});

describe("Import/export table cleanup on close", () => {
  it("should clean up import table when session closes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create nested objects to populate import table
    using child1 = await stub.createChild();
    using child2 = await stub.createChild();
    using child3 = await stub.createChild();

    // Verify imports exist
    const statsBefore = client.getStats();
    expect(statsBefore.imports).toBeGreaterThan(1);

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // Import table should be cleaned up (imports should be 0 or very minimal)
    const statsAfter = client.getStats();
    expect(statsAfter.imports).toBe(0);
  });

  it("should clean up export table when session closes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create nested objects to populate export table on server
    using child1 = await stub.createChild();
    using child2 = await stub.createChild();

    // Verify exports exist on server
    const serverStatsBefore = server.getStats();
    expect(serverStatsBefore.exports).toBeGreaterThan(1);

    // Close the server session
    await server.close();
    await pumpMicrotasks();

    // Export table should be cleaned up
    const serverStatsAfter = server.getStats();
    expect(serverStatsAfter.exports).toBe(0);
  });

  it("should report zero imports and exports after close via getStats()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a call to ensure session is fully established
    expect(await stub.getValue()).toBe(42);

    // Close both sessions
    await client.close();
    await server.close();
    await pumpMicrotasks();

    // Both should have empty tables
    const clientStats = client.getStats();
    const serverStats = server.getStats();

    expect(clientStats.imports).toBe(0);
    expect(clientStats.exports).toBe(0);
    expect(serverStats.imports).toBe(0);
    expect(serverStats.exports).toBe(0);
  });
});

describe("New calls after close() throw error", () => {
  it("should throw 'Session closed' error when making calls after close()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a successful call first
    expect(await stub.getValue()).toBe(42);

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // Attempting new calls should throw (now throws synchronously due to abort check)
    expect(() => stub.getValue()).toThrow(/session.*closed|closed/i);
  });

  it("should throw synchronously or reject immediately for calls after close()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // The call should fail immediately, not hang
    const startTime = Date.now();
    try {
      await stub.getValue();
    } catch (e) {
      // Expected
    }
    const elapsed = Date.now() - startTime;

    // Should fail within a reasonable time (not hang)
    expect(elapsed).toBeLessThan(100);
  });

  it("should throw ConnectionError for calls after close()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // Should throw ConnectionError specifically (now throws synchronously)
    expect(() => stub.getValue()).toThrow(ConnectionError);
  });

  it("should throw for property access on stub after close()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Close the session
    await client.close();
    await pumpMicrotasks();

    // Property access (method call) should also fail (now throws synchronously)
    expect(() => stub.add(1, 2)).toThrow(/session.*closed|closed/i);
  });
});

describe("Session close with active operations", () => {
  it("should handle close() during an in-flight call gracefully", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a slow operation
    const slowPromise = stub.slowOperation(1000);

    // Immediately close while operation is in flight
    client.close();
    await pumpMicrotasks();

    // The slow operation should be rejected
    let rejectionError: unknown;
    try {
      await slowPromise;
    } catch (e) {
      rejectionError = e;
    }
    expect(rejectionError).toBeDefined();
  });

  it("should call onClosed() callback if registered before close", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const onClosedCallback = vi.fn();
    client.onClosed().then(onClosedCallback);

    await client.close();
    await pumpMicrotasks();

    expect(onClosedCallback).toHaveBeenCalled();
  });
});

describe("isClosed property", () => {
  it("should have an isClosed property", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Should exist and initially be false
    expect(typeof client.isClosed).toBe("boolean");
    expect(client.isClosed).toBe(false);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should be true after close() is called", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.isClosed).toBe(false);

    await client.close();
    await pumpMicrotasks();

    expect(client.isClosed).toBe(true);
  });

  it("should be true after transport disconnect", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.isClosed).toBe(false);

    // Force transport disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    expect(client.isClosed).toBe(true);
  });
});

describe("Close reason/error propagation", () => {
  it("should propagate close reason to onClosed()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const customError = new Error("Custom close reason");

    let receivedError: any = null;
    client.onClosed().then((error) => {
      receivedError = error;
    });

    // Close with a custom reason
    await client.close(customError);
    await pumpMicrotasks();

    // The onClosed() callback should receive the reason
    expect(receivedError).toBe(customError);
  });

  it("should propagate transport error to onClosed()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Use ConnectionError directly to avoid wrapping
    const transportError = new ConnectionError("Transport failure");

    let receivedError: any = null;
    client.onClosed().then((error) => {
      receivedError = error;
    });

    // Force transport error
    clientTransport.forceReceiveError(transportError);
    await pumpMicrotasks();

    // The onClosed() callback should receive the transport error
    // (ConnectionError passed through unchanged)
    expect(receivedError).toBe(transportError);
  });
});

describe("Symbol.dispose and close() interaction", () => {
  it("close() should work after Symbol.dispose is called", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Dispose the stub first
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // close() should be a no-op after Symbol.dispose (not throw)
    client.close();

    expect(client.isClosed).toBe(true);
  });

  it("Symbol.dispose should work after close() is called", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Close the session first
    client.close();
    await pumpMicrotasks();

    // Symbol.dispose should be a no-op (not throw)
    stub[Symbol.dispose]();

    expect(client.isClosed).toBe(true);
  });

  it("session should be fully cleaned up after either close() or Symbol.dispose", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a call to populate tables
    expect(await stub.getValue()).toBe(42);

    // Close via close()
    client.close();
    await pumpMicrotasks();

    // Tables should be cleared
    const stats = client.getStats();
    expect(stats.imports).toBe(0);
    expect(stats.exports).toBe(0);
  });

  it("isClosed should be true after Symbol.dispose on main stub", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.isClosed).toBe(false);

    const stub = client.getRemoteMain();
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    expect(client.isClosed).toBe(true);
  });
});
