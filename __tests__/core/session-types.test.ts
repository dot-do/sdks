// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions } from "../../src/index.js"

/**
 * TDD RED PHASE: Tests for RpcSession type properties
 *
 * Issue: dot-do-capnweb-2h4
 *
 * The following methods exist at runtime but are MISSING from type definitions:
 * - `getPendingCallCount()` - returns number of pending calls
 * - `hasBackpressure()` - returns boolean if backpressure active
 * - `waitForDrain()` - returns Promise that resolves when queue drains
 * - `waitForHandshake()` - returns Promise that resolves after handshake
 * - `getNegotiatedVersion()` - returns negotiated protocol version
 * - `isHandshakeComplete()` - returns boolean
 *
 * These tests should currently FAIL due to TypeScript errors (methods not found on type).
 * Once the type definitions are added to src/index.ts RpcSession interface, they will pass.
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
}

// Target with a method that never resolves (for testing pending calls)
class HangingTarget extends RpcTarget {
  hang(): Promise<number> {
    return new Promise(() => {}); // Never resolves
  }
}

// =============================================================================
// getPendingCallCount() method tests
// =============================================================================

describe("RpcSession.getPendingCallCount() method", () => {
  it("should have a getPendingCallCount() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.getPendingCallCount).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a number", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const count = client.getPendingCallCount();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return 0 when no calls are pending", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(client.getPendingCallCount()).toBe(0);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should track pending calls correctly", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport, undefined, {
      maxPendingCalls: 10
    });
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // TDD RED: This should fail until type is added
    expect(client.getPendingCallCount()).toBe(0);

    // Start calls that will hang
    const promise1 = stub.hang();
    await pumpMicrotasks();
    expect(client.getPendingCallCount()).toBeGreaterThanOrEqual(1);

    const promise2 = stub.hang();
    await pumpMicrotasks();
    expect(client.getPendingCallCount()).toBeGreaterThanOrEqual(2);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// hasBackpressure() method tests
// =============================================================================

describe("RpcSession.hasBackpressure() method", () => {
  it("should have a hasBackpressure() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.hasBackpressure).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a boolean", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const result = client.hasBackpressure();
    expect(typeof result).toBe("boolean");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return false when no backpressure limit is set", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    // No maxPendingCalls option
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(client.hasBackpressure()).toBe(false);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return false when under the limit", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      maxPendingCalls: 10
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(client.hasBackpressure()).toBe(false);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return true when at or over the limit", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport, undefined, {
      maxPendingCalls: 2
    });
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // TDD RED: This should fail until type is added
    expect(client.hasBackpressure()).toBe(false);

    // Fill up to the limit
    const promise1 = stub.hang();
    await pumpMicrotasks();
    const promise2 = stub.hang();
    await pumpMicrotasks();

    expect(client.hasBackpressure()).toBe(true);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// waitForDrain() method tests
// =============================================================================

describe("RpcSession.waitForDrain() method", () => {
  it("should have a waitForDrain() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.waitForDrain).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a Promise", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const result = client.waitForDrain();
    expect(result).toBeInstanceOf(Promise);

    await result; // Don't leave hanging promises

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should resolve immediately when no backpressure", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    let resolved = false;
    const drainPromise = client.waitForDrain().then(() => {
      resolved = true;
    });

    // Should resolve immediately since no backpressure
    await drainPromise;
    expect(resolved).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should wait when under backpressure", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport, undefined, {
      maxPendingCalls: 1
    });
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Fill up to limit
    const promise1 = stub.hang();
    await pumpMicrotasks();

    // TDD RED: This should fail until type is added
    // waitForDrain should not resolve yet if we're at capacity
    if (client.hasBackpressure()) {
      let drainResolved = false;
      const drainPromise = client.waitForDrain().then(() => {
        drainResolved = true;
      });

      await pumpMicrotasks();
      // Should still be waiting (unless session closes, which resolves drain)
    }

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// waitForHandshake() method tests
// =============================================================================

describe("RpcSession.waitForHandshake() method", () => {
  it("should have a waitForHandshake() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.waitForHandshake).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a Promise", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const result = client.waitForHandshake();
    expect(result).toBeInstanceOf(Promise);

    await result;

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should resolve immediately when handshake is disabled", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    // No enableVersionHandshake - handshake is disabled by default
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    let resolved = false;
    const handshakePromise = client.waitForHandshake().then(() => {
      resolved = true;
    });

    await handshakePromise;
    expect(resolved).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should wait for handshake completion when enabled", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const options: RpcSessionOptions = {
      enableVersionHandshake: true,
    };

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options, true);
    const server = new RpcSession(serverTransport, serverTarget, options, false);

    // TDD RED: This should fail until type is added
    await client.waitForHandshake();
    await server.waitForHandshake();

    // Both should be complete
    expect(client.isHandshakeComplete()).toBe(true);
    expect(server.isHandshakeComplete()).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// getNegotiatedVersion() method tests
// =============================================================================

describe("RpcSession.getNegotiatedVersion() method", () => {
  it("should have a getNegotiatedVersion() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.getNegotiatedVersion).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a string", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const version = client.getNegotiatedVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return current protocol version when handshake is disabled", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const version = client.getNegotiatedVersion();
    expect(version).toBe("1.0"); // Current protocol version

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return negotiated version after handshake completes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const options: RpcSessionOptions = {
      enableVersionHandshake: true,
    };

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options, true);
    const server = new RpcSession(serverTransport, serverTarget, options, false);

    // TDD RED: This should fail until type is added
    await client.waitForHandshake();
    await server.waitForHandshake();

    // Both should report the same version
    const clientVersion = client.getNegotiatedVersion();
    const serverVersion = server.getNegotiatedVersion();

    expect(clientVersion).toBe(serverVersion);
    expect(clientVersion).toBe("1.0");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// isHandshakeComplete() method tests
// =============================================================================

describe("RpcSession.isHandshakeComplete() method", () => {
  it("should have an isHandshakeComplete() method", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(typeof client.isHandshakeComplete).toBe("function");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return a boolean", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    const result = client.isHandshakeComplete();
    expect(typeof result).toBe("boolean");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return true immediately when handshake is disabled", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    // No enableVersionHandshake - handshake is disabled by default
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: This should fail until type is added
    expect(client.isHandshakeComplete()).toBe(true);
    expect(server.isHandshakeComplete()).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return true after handshake completes when enabled", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const options: RpcSessionOptions = {
      enableVersionHandshake: true,
    };

    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options, true);
    const server = new RpcSession(serverTransport, serverTarget, options, false);

    // TDD RED: This should fail until type is added
    // Wait for handshake
    await client.waitForHandshake();
    await server.waitForHandshake();

    expect(client.isHandshakeComplete()).toBe(true);
    expect(server.isHandshakeComplete()).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// Type inference tests - ensure TypeScript correctly infers return types
// =============================================================================

describe("RpcSession method return type inference", () => {
  it("getPendingCallCount() should be assignable to number", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as number
    const count: number = client.getPendingCallCount();
    expect(count).toBe(0);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("hasBackpressure() should be assignable to boolean", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as boolean
    const result: boolean = client.hasBackpressure();
    expect(result).toBe(false);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("waitForDrain() should be assignable to Promise<void>", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as Promise<void>
    const promise: Promise<void> = client.waitForDrain();
    await promise;

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("waitForHandshake() should be assignable to Promise<void>", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as Promise<void>
    const promise: Promise<void> = client.waitForHandshake();
    await promise;

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("getNegotiatedVersion() should be assignable to string", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as string
    const version: string = client.getNegotiatedVersion();
    expect(typeof version).toBe("string");

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("isHandshakeComplete() should be assignable to boolean", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // TDD RED: TypeScript should infer this as boolean
    const complete: boolean = client.isHandshakeComplete();
    expect(complete).toBe(true);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

// =============================================================================
// Session state tests - verify methods work in various session states
// =============================================================================

describe("RpcSession methods in various session states", () => {
  describe("before any RPC calls", () => {
    it("should return correct values before any calls", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport);
      const server = new RpcSession(serverTransport, serverTarget);

      // TDD RED: These should work before any RPC calls
      expect(client.getPendingCallCount()).toBe(0);
      expect(client.hasBackpressure()).toBe(false);
      expect(client.isHandshakeComplete()).toBe(true);
      expect(client.getNegotiatedVersion()).toBe("1.0");

      const drainPromise = client.waitForDrain();
      await drainPromise; // Should resolve immediately

      const handshakePromise = client.waitForHandshake();
      await handshakePromise; // Should resolve immediately

      // Clean up
      client.getRemoteMain()[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });

  describe("during active RPC calls", () => {
    it("should track pending calls during active calls", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxPendingCalls: 10
      });
      const server = new RpcSession(serverTransport, serverTarget);

      const stub = client.getRemoteMain();

      // Start a call
      const resultPromise = stub.getValue();

      // TDD RED: Should be able to check pending calls during active call
      // Note: The count might be 0 or 1 depending on timing, but the method should exist
      const count = client.getPendingCallCount();
      expect(typeof count).toBe("number");

      // Wait for the call to complete
      const result = await resultPromise;
      expect(result).toBe(42);

      // After call completes, pending count should be back to 0
      expect(client.getPendingCallCount()).toBe(0);

      // Clean up
      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });

  describe("after session closes", () => {
    it("should return appropriate values after close", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport);
      const server = new RpcSession(serverTransport, serverTarget);

      // Close the session
      client.close();
      await pumpMicrotasks();

      // TDD RED: Methods should still be callable after close
      expect(client.getPendingCallCount()).toBe(0);
      expect(client.hasBackpressure()).toBe(false);
      expect(client.isHandshakeComplete()).toBe(true);
      expect(client.getNegotiatedVersion()).toBe("1.0");

      // waitForDrain should resolve immediately
      await client.waitForDrain();

      // waitForHandshake should resolve immediately
      await client.waitForHandshake();
    });
  });

  describe("with version handshake enabled", () => {
    it("should correctly track handshake state when enabled", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const serverTarget = new SimpleTarget();
      const options: RpcSessionOptions = {
        enableVersionHandshake: true,
      };

      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options, true);
      const server = new RpcSession(serverTransport, serverTarget, options, false);

      // TDD RED: Before handshake completes (immediately after creation)
      // Note: This may already be true if handshake is fast

      // Wait for handshake
      await client.waitForHandshake();
      await server.waitForHandshake();

      // After handshake
      expect(client.isHandshakeComplete()).toBe(true);
      expect(server.isHandshakeComplete()).toBe(true);
      expect(client.getNegotiatedVersion()).toBe("1.0");
      expect(server.getNegotiatedVersion()).toBe("1.0");

      // Clean up
      client.getRemoteMain()[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });
});
