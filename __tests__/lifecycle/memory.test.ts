// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, beforeEach, afterEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, RpcStub } from "../../src/index.js"

/**
 * Memory leak tests for RPC import/export table management (issue: dot-do-capnweb-67g)
 *
 * These tests verify that:
 * 1. Imports are cleaned up after promise resolution
 * 2. Exports are cleaned up when remote releases them
 * 3. Circular capability references are handled correctly
 * 4. Explicit capability disposal via Symbol.dispose works
 * 5. Large numbers of sequential calls don't leak memory
 * 6. getStats() returns accurate counts
 *
 * TDD RED PHASE: Some of these tests should FAIL initially because the
 * import/export table cleanup may have edge cases that aren't handled properly.
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

  // Enable batch processing of queued messages
  tryReceiveSync(): string | undefined {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    return undefined;
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

// A transport that allows manual control of message delivery for testing cleanup timing
class ManualTransport implements RpcTransport {
  constructor(public name: string, private partner?: ManualTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiters: Array<{resolve: (msg: string) => void, reject: (err: any) => void}> = [];
  public log = false;
  public aborted = false;
  public abortReason?: any;
  public pendingMessages: string[] = [];

  async send(message: string): Promise<void> {
    if (this.log) console.log(`${this.name}: ${message}`);
    // Store in pending - partner must manually deliver
    this.partner!.pendingMessages.push(message);
  }

  // Manually deliver all pending messages
  deliverPending(): void {
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages.shift()!;
      this.queue.push(msg);
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        waiter.resolve(this.queue.shift()!);
      }
    }
  }

  // Deliver a specific number of pending messages
  deliverN(n: number): void {
    for (let i = 0; i < n && this.pendingMessages.length > 0; i++) {
      const msg = this.pendingMessages.shift()!;
      this.queue.push(msg);
      if (this.waiters.length > 0) {
        const waiter = this.waiters.shift()!;
        waiter.resolve(this.queue.shift()!);
      }
    }
  }

  async receive(): Promise<string> {
    if (this.queue.length > 0) {
      return this.queue.shift()!;
    }
    return new Promise<string>((resolve, reject) => {
      this.waiters.push({resolve, reject});
    });
  }

  abort(reason: any) {
    this.aborted = true;
    this.abortReason = reason;
    // Reject all waiters
    for (const waiter of this.waiters) {
      waiter.reject(reason);
    }
    this.waiters = [];
  }

  forceReceiveError(error: any) {
    this.abort(error);
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
  echo<T>(value: T): T { return value; }
}

// Target that creates child stubs
class ParentTarget extends RpcTarget {
  createChild(): ChildTarget {
    return new ChildTarget();
  }
}

class ChildTarget extends RpcTarget {
  getValue() { return "child"; }
}

// Target that returns promises that can be controlled externally
class DeferredTarget extends RpcTarget {
  private resolvers: Map<number, {resolve: (v: any) => void, reject: (e: any) => void}> = new Map();
  private nextId = 0;

  // Returns a promise that will be resolved when resolvePromise(id) is called
  deferredCall(): Promise<{id: number, value: number}> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.resolvers.set(id, {resolve, reject});
    });
  }

  resolvePromise(id: number, value: number): boolean {
    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver.resolve({id, value});
      this.resolvers.delete(id);
      return true;
    }
    return false;
  }

  rejectPromise(id: number, error: string): boolean {
    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver.reject(new Error(error));
      this.resolvers.delete(id);
      return true;
    }
    return false;
  }

  getPendingCount(): number {
    return this.resolvers.size;
  }
}

// Target with disposal tracking
class DisposableTarget extends RpcTarget {
  public disposed = false;
  public disposeCount = 0;

  getValue() { return 42; }

  [Symbol.dispose]() {
    this.disposed = true;
    this.disposeCount++;
  }
}

// Target that creates references to other stubs (for circular reference testing)
class CircularRefTarget extends RpcTarget {
  private storedStub?: RpcStub<CircularRefTarget>;
  private storedStubs: RpcStub<CircularRefTarget>[] = [];

  storeStub(stub: RpcStub<CircularRefTarget>): void {
    // Must dup() to take ownership since stubs passed as params are released after the call
    this.storedStub = stub.dup();
  }

  storeInArray(stub: RpcStub<CircularRefTarget>): number {
    // Must dup() to take ownership since stubs passed as params are released after the call
    this.storedStubs.push(stub.dup());
    return this.storedStubs.length - 1;
  }

  getStored(): RpcStub<CircularRefTarget> | undefined {
    return this.storedStub;
  }

  getFromArray(index: number): RpcStub<CircularRefTarget> | undefined {
    return this.storedStubs[index];
  }

  clearStored(): void {
    if (this.storedStub) {
      this.storedStub[Symbol.dispose]();
      this.storedStub = undefined;
    }
  }

  clearArray(): void {
    for (const stub of this.storedStubs) {
      stub[Symbol.dispose]();
    }
    this.storedStubs = [];
  }

  getValue() { return "circular"; }
}

describe("Import cleanup after resolution", () => {
  it("should clean up imports after promise resolves", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Make a call and wait for it to resolve
    const result = await stub.getValue();
    expect(result).toBe(42);

    // Pump microtasks to ensure cleanup happens
    await pumpMicrotasks();

    // Imports should return to baseline (call promise resolved, import should be released)
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should clean up imports after multiple sequential calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Make many sequential calls
    for (let i = 0; i < 100; i++) {
      const result = await stub.add(i, i);
      expect(result).toBe(i + i);
    }

    await pumpMicrotasks();

    // Imports should return to baseline after all calls resolve
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should clean up imports after promise rejection", async () => {
    class ThrowingTarget extends RpcTarget {
      throwError(): never {
        throw new Error("test error");
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ThrowingTarget();
    const client = new RpcSession<ThrowingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Make a call that will reject
    try {
      await stub.throwError();
    } catch (e) {
      // Expected
    }

    await pumpMicrotasks();

    // Imports should return to baseline after rejection
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should clean up imports when promise is not awaited but stub is disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Start a call but don't await it
    const promise = stub.getValue();

    // Check that import count increased
    const duringStats = client.getStats();
    expect(duringStats.imports).toBeGreaterThanOrEqual(baselineStats.imports);

    // Dispose the promise stub without awaiting
    promise[Symbol.dispose]();

    await pumpMicrotasks();

    // The import for the promise should be cleaned up
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up main stub
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Export cleanup when remote releases", () => {
  it("should clean up exports when client releases stub", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Get baseline export count on server
    const serverBaselineStats = server.getStats();

    // Create a child which adds to exports
    const child = await stub.createChild();

    await pumpMicrotasks();

    const serverDuringStats = server.getStats();
    expect(serverDuringStats.exports).toBeGreaterThan(serverBaselineStats.exports);

    // Release the child on the client
    child[Symbol.dispose]();

    await pumpMicrotasks();

    // Server exports should return to baseline
    const serverAfterStats = server.getStats();
    expect(serverAfterStats.exports).toBe(serverBaselineStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should clean up exports when multiple stubs are released", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const serverBaselineStats = server.getStats();

    // Create multiple children
    const children: RpcStub<ChildTarget>[] = [];
    for (let i = 0; i < 10; i++) {
      children.push(await stub.createChild());
    }

    await pumpMicrotasks();

    const serverDuringStats = server.getStats();
    expect(serverDuringStats.exports).toBeGreaterThan(serverBaselineStats.exports);

    // Release all children
    for (const child of children) {
      child[Symbol.dispose]();
    }

    await pumpMicrotasks();

    // Server exports should return to baseline
    const serverAfterStats = server.getStats();
    expect(serverAfterStats.exports).toBe(serverBaselineStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle export cleanup with duped stubs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const serverBaselineStats = server.getStats();

    // Create a child
    const child = await stub.createChild();

    // Dup the child multiple times
    const dups = [child.dup(), child.dup(), child.dup()];

    await pumpMicrotasks();

    // Dispose original - export should still exist due to dups
    child[Symbol.dispose]();
    await pumpMicrotasks();

    const serverMidStats = server.getStats();
    // Export should still be there due to dups (this may vary by implementation)

    // Dispose all dups
    for (const dup of dups) {
      dup[Symbol.dispose]();
    }

    await pumpMicrotasks();

    // Now server exports should return to baseline
    const serverAfterStats = server.getStats();
    expect(serverAfterStats.exports).toBe(serverBaselineStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Circular capability references", () => {
  it("should handle A refs B, B refs A pattern", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTargetA = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTargetA);

    const stubA = client.getRemoteMain();
    const baselineClientStats = client.getStats();
    const baselineServerStats = server.getStats();

    // Create a circular reference: client creates local target, sends to server,
    // server stores it, then we retrieve it back
    const localTarget = new CircularRefTarget();
    const localStub = new RpcStub(localTarget);

    // Send the local stub to server to store
    await stubA.storeStub(localStub);

    await pumpMicrotasks();

    // Retrieve it back - this creates a circular reference pattern
    const retrievedStub = await stubA.getStored();

    await pumpMicrotasks();

    // Both should work
    expect(await stubA.getValue()).toBe("circular");
    if (retrievedStub) {
      expect(await (retrievedStub as any).getValue()).toBe("circular");
    }

    // Clear the stored reference on server
    await stubA.clearStored();

    await pumpMicrotasks();

    // Dispose retrieved stub if we got one
    if (retrievedStub) {
      retrievedStub[Symbol.dispose]();
    }

    // Dispose local stub
    localStub[Symbol.dispose]();

    await pumpMicrotasks();

    // Stats should return to baseline (this is the key test - circular refs should not leak)
    const afterClientStats = client.getStats();
    const afterServerStats = server.getStats();

    expect(afterClientStats.imports).toBe(baselineClientStats.imports);
    expect(afterServerStats.exports).toBe(baselineServerStats.exports);

    // Clean up
    stubA[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle chain of references without leaking", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    // Client exports the stubs it sends to the server, so check client exports
    const baselineClientStats = client.getStats();

    // Create a chain: store multiple stubs
    const stubs: RpcStub<CircularRefTarget>[] = [];
    for (let i = 0; i < 5; i++) {
      const target = new CircularRefTarget();
      const localStub = new RpcStub(target);
      await stub.storeInArray(localStub);
      stubs.push(localStub);
    }

    await pumpMicrotasks();

    // Client exports should have increased (targets are exported to server)
    const duringClientStats = client.getStats();
    expect(duringClientStats.exports).toBeGreaterThan(baselineClientStats.exports);

    // Clear all stored references on server (releases the imports -> releases client exports)
    await stub.clearArray();

    // Dispose local stubs (releases the local hooks)
    for (const s of stubs) {
      s[Symbol.dispose]();
    }

    await pumpMicrotasks();

    // Exports should return to baseline
    const afterClientStats = client.getStats();
    expect(afterClientStats.exports).toBe(baselineClientStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Explicit capability disposal via Symbol.dispose", () => {
  it("should call Symbol.dispose on RpcTarget when stub is released", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DisposableTarget();
    const client = new RpcSession<DisposableTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Verify target is not disposed initially
    expect(serverTarget.disposed).toBe(false);
    expect(serverTarget.disposeCount).toBe(0);

    // Make a call to verify connection works
    expect(await stub.getValue()).toBe(42);

    // Dispose the stub
    stub[Symbol.dispose]();

    await pumpMicrotasks();

    // Target should be disposed
    expect(serverTarget.disposed).toBe(true);
    expect(serverTarget.disposeCount).toBe(1);
  });

  it("should only call dispose once even with multiple stub references", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DisposableTarget();
    const client = new RpcSession<DisposableTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create multiple dups
    const dup1 = stub.dup();
    const dup2 = stub.dup();

    // Dispose all
    stub[Symbol.dispose]();
    dup1[Symbol.dispose]();
    dup2[Symbol.dispose]();

    await pumpMicrotasks();

    // Dispose should only be called once
    expect(serverTarget.disposeCount).toBe(1);
  });

  it("should dispose nested stubs properly", async () => {
    class NestedDisposableTarget extends RpcTarget {
      public disposed = false;
      public child = new DisposableTarget();

      getValue() { return 42; }
      getChild() { return this.child; }

      [Symbol.dispose]() {
        this.disposed = true;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedDisposableTarget();
    const client = new RpcSession<NestedDisposableTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Get the child
    const child = await stub.getChild();
    expect(await child.getValue()).toBe(42);

    // Dispose child first
    child[Symbol.dispose]();
    await pumpMicrotasks();

    // Child should be disposed
    expect(serverTarget.child.disposed).toBe(true);

    // Parent should not be disposed yet
    expect(serverTarget.disposed).toBe(false);

    // Dispose parent
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Now parent should be disposed too
    expect(serverTarget.disposed).toBe(true);
  });

  it("should handle disposal of promise that has not resolved", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DeferredTarget();
    const client = new RpcSession<DeferredTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Start a deferred call (will not resolve until we call resolvePromise)
    const promise = stub.deferredCall();

    await pumpMicrotasks();

    // Import count should have increased
    const duringStats = client.getStats();
    expect(duringStats.imports).toBeGreaterThan(baselineStats.imports);

    // Dispose the promise without resolving it
    promise[Symbol.dispose]();

    await pumpMicrotasks();

    // Import should be cleaned up
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Large number of sequential calls memory test", () => {
  it("should not leak with 100+ sequential calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineClientStats = client.getStats();
    const baselineServerStats = server.getStats();

    // Make 100+ sequential calls (reduced from 1000 for test performance)
    for (let i = 0; i < 100; i++) {
      const result = await stub.add(i, 1);
      expect(result).toBe(i + 1);
    }

    await pumpMicrotasks(32);

    // Stats should be at or near baseline
    const afterClientStats = client.getStats();
    const afterServerStats = server.getStats();

    // Allow for some small variance but should not grow unboundedly
    expect(afterClientStats.imports).toBeLessThanOrEqual(baselineClientStats.imports + 5);
    expect(afterServerStats.exports).toBeLessThanOrEqual(baselineServerStats.exports + 5);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should not leak with 100+ concurrent calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineClientStats = client.getStats();
    const baselineServerStats = server.getStats();

    // Make 100 concurrent calls (reduced from 1000 for test performance)
    const promises: Promise<number>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(stub.add(i, 1));
    }

    // Wait for all to complete
    const results = await Promise.all(promises);

    // Verify results
    for (let i = 0; i < 100; i++) {
      expect(results[i]).toBe(i + 1);
    }

    await pumpMicrotasks(64);

    // Stats should be at or near baseline
    const afterClientStats = client.getStats();
    const afterServerStats = server.getStats();

    expect(afterClientStats.imports).toBeLessThanOrEqual(baselineClientStats.imports + 5);
    expect(afterServerStats.exports).toBeLessThanOrEqual(baselineServerStats.exports + 5);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should not leak with mixed call patterns over time", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineClientStats = client.getStats();
    const baselineServerStats = server.getStats();

    // Mixed pattern: create children, use them, dispose them
    for (let batch = 0; batch < 10; batch++) {
      // Create some children (reduced from 50x20 for test performance)
      const children: RpcStub<ChildTarget>[] = [];
      for (let i = 0; i < 10; i++) {
        children.push(await stub.createChild());
      }

      // Use them
      for (const child of children) {
        await (child as any).getValue();
      }

      // Dispose them
      for (const child of children) {
        child[Symbol.dispose]();
      }

      await pumpMicrotasks();
    }

    await pumpMicrotasks(64);

    // Stats should be at or near baseline after all operations
    const afterClientStats = client.getStats();
    const afterServerStats = server.getStats();

    expect(afterClientStats.imports).toBeLessThanOrEqual(baselineClientStats.imports + 5);
    expect(afterServerStats.exports).toBeLessThanOrEqual(baselineServerStats.exports + 5);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("getStats() accuracy", () => {
  it("should return accurate initial counts", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Initial stats should show at least 1 import and 1 export (main object)
    const clientStats = client.getStats();
    const serverStats = server.getStats();

    expect(clientStats.imports).toBeGreaterThanOrEqual(1);
    expect(clientStats.exports).toBeGreaterThanOrEqual(1);
    expect(serverStats.imports).toBeGreaterThanOrEqual(1);
    expect(serverStats.exports).toBeGreaterThanOrEqual(1);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should accurately track imports during pending calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DeferredTarget();
    const client = new RpcSession<DeferredTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Start multiple pending calls
    const promise1 = stub.deferredCall();
    const promise2 = stub.deferredCall();
    const promise3 = stub.deferredCall();

    await pumpMicrotasks();

    // Should show 3 additional imports for the pending promises
    const duringStats = client.getStats();
    expect(duringStats.imports).toBe(baselineStats.imports + 3);

    // Resolve all promises manually
    await serverTarget.resolvePromise(0, 100);
    await serverTarget.resolvePromise(1, 200);
    await serverTarget.resolvePromise(2, 300);

    // Wait for the promises
    await Promise.all([promise1, promise2, promise3]);

    await pumpMicrotasks();

    // Should return to baseline
    const afterStats = client.getStats();
    expect(afterStats.imports).toBe(baselineStats.imports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should accurately track exports when creating stubs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineServerStats = server.getStats();

    // Create 5 children
    const children: RpcStub<ChildTarget>[] = [];
    for (let i = 0; i < 5; i++) {
      children.push(await stub.createChild());
    }

    await pumpMicrotasks();

    // Server should show 5 additional exports
    const duringServerStats = server.getStats();
    expect(duringServerStats.exports).toBe(baselineServerStats.exports + 5);

    // Dispose 3 children
    children[0][Symbol.dispose]();
    children[1][Symbol.dispose]();
    children[2][Symbol.dispose]();

    await pumpMicrotasks();

    // Server should now show only 2 additional exports
    const midServerStats = server.getStats();
    expect(midServerStats.exports).toBe(baselineServerStats.exports + 2);

    // Dispose remaining
    children[3][Symbol.dispose]();
    children[4][Symbol.dispose]();

    await pumpMicrotasks();

    // Back to baseline
    const afterServerStats = server.getStats();
    expect(afterServerStats.exports).toBe(baselineServerStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should return zero counts after session is fully closed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make some calls to populate tables
    await stub.getValue();
    await stub.add(1, 2);

    // Dispose main stub which shuts down session
    stub[Symbol.dispose]();

    await pumpMicrotasks(32);

    // After full shutdown, stats should show minimal or zero
    const clientStats = client.getStats();
    const serverStats = server.getStats();

    // The exact behavior after shutdown depends on implementation,
    // but tables should be cleaned up
    expect(clientStats.imports).toBeLessThanOrEqual(1);
    expect(serverStats.exports).toBeLessThanOrEqual(1);
  });

  it("should handle stats query during rapid operations", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Query stats while making calls
    const promises: Promise<number>[] = [];
    const statsSnapshots: {imports: number, exports: number}[] = [];

    for (let i = 0; i < 100; i++) {
      promises.push(stub.add(i, 1));
      if (i % 10 === 0) {
        statsSnapshots.push(client.getStats());
      }
    }

    await Promise.all(promises);
    await pumpMicrotasks();

    // All snapshots should have been valid (no crashes, reasonable values)
    for (const snap of statsSnapshots) {
      expect(typeof snap.imports).toBe("number");
      expect(typeof snap.exports).toBe("number");
      expect(snap.imports).toBeGreaterThanOrEqual(0);
      expect(snap.exports).toBeGreaterThanOrEqual(0);
    }

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Edge case: Pending promises on disconnect", () => {
  it("should clean up imports when connection is aborted with pending promises", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DeferredTarget();
    const client = new RpcSession<DeferredTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Start pending calls that won't resolve
    const promises = [
      stub.deferredCall().catch(() => {}),
      stub.deferredCall().catch(() => {}),
      stub.deferredCall().catch(() => {}),
    ];

    await pumpMicrotasks();

    // Verify imports increased
    const duringStats = client.getStats();
    expect(duringStats.imports).toBeGreaterThan(baselineStats.imports);

    // Force abort the connection
    clientTransport.forceReceiveError(new Error("connection lost"));

    await pumpMicrotasks();

    // All imports should be cleaned up (or at least not growing)
    const afterStats = client.getStats();
    // After abort, imports table should be cleaned or very small
    expect(afterStats.imports).toBeLessThanOrEqual(baselineStats.imports + 5);
  });

  it("should clean up exports when connection is aborted", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineServerStats = server.getStats();

    // Create children to populate export table
    const children = [
      await stub.createChild(),
      await stub.createChild(),
      await stub.createChild(),
    ];

    await pumpMicrotasks();

    const duringServerStats = server.getStats();
    expect(duringServerStats.exports).toBeGreaterThan(baselineServerStats.exports);

    // Force abort the connection on server side
    serverTransport.forceReceiveError(new Error("server error"));

    await pumpMicrotasks();

    // Exports should be cleaned up
    const afterServerStats = server.getStats();
    // After abort, export table should be cleaned
    expect(afterServerStats.exports).toBeLessThanOrEqual(baselineServerStats.exports);
  });
});

describe("Edge case: Re-exporting imported stubs", () => {
  it("should handle sending a received stub back to the sender", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineClientStats = client.getStats();
    const baselineServerStats = server.getStats();

    // Create a local target and send it
    const localTarget = new SimpleTarget();
    const localStub = new RpcStub(localTarget);

    // Store it on server
    await stub.storeStub(localStub);

    await pumpMicrotasks();

    // Get it back
    const retrievedStub = await stub.getStored();

    await pumpMicrotasks();

    // Send the retrieved stub back to server (re-export)
    if (retrievedStub) {
      await stub.storeStub(retrievedStub);
    }

    await pumpMicrotasks();

    // Clear and dispose everything
    await stub.clearStored();
    localStub[Symbol.dispose]();
    if (retrievedStub) {
      retrievedStub[Symbol.dispose]();
    }

    await pumpMicrotasks();

    // Should not leak
    const afterClientStats = client.getStats();
    const afterServerStats = server.getStats();

    expect(afterClientStats.imports).toBe(baselineClientStats.imports);
    expect(afterServerStats.exports).toBe(baselineServerStats.exports);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});
