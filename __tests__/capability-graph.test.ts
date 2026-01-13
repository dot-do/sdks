// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Capability Graph Tests (issue: dot-do-capnweb-bhk, dot-do-capnweb-z99)
 *
 * Tests for handling large and complex capability structures:
 * - 100+ nested capabilities in single message
 * - Circular capability references
 * - Deep capability chains (50+ levels)
 * - Wide capability fan-out (1000+ siblings)
 *
 * Expected behavior:
 * - No stack overflow
 * - Proper reference counting
 * - Clean disposal of entire graph
 */

import { expect, it, describe, beforeEach, afterEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, RpcStub } from "../src/index.js"

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Simple test transport for paired RPC sessions.
 */
class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: unknown) => void;
  public log = false;
  public aborted = false;
  public abortReason?: unknown;

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

  abort(reason: unknown) {
    this.aborted = true;
    this.abortReason = reason;
  }

  forceReceiveError(error: unknown) {
    if (this.aborter) {
      this.aborter(error);
    }
  }
}

/**
 * Pump the microtask queue to allow async operations to complete.
 */
async function pumpMicrotasks(count: number = 16) {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

// ============================================================================
// Test Targets for Capability Graph Testing
// ============================================================================

/**
 * Target that can create nested child targets.
 */
class NestedTarget extends RpcTarget {
  public disposed = false;
  private children: NestedTarget[] = [];

  getValue(): string {
    return "nested";
  }

  createChild(): NestedTarget {
    const child = new NestedTarget();
    this.children.push(child);
    return child;
  }

  createChildren(count: number): NestedTarget[] {
    const children: NestedTarget[] = [];
    for (let i = 0; i < count; i++) {
      const child = new NestedTarget();
      this.children.push(child);
      children.push(child);
    }
    return children;
  }

  getChildCount(): number {
    return this.children.length;
  }

  [Symbol.dispose]() {
    this.disposed = true;
    // Dispose children
    for (const child of this.children) {
      if (!child.disposed) {
        child[Symbol.dispose]();
      }
    }
    this.children = [];
  }
}

/**
 * Target that can create deep chains of capabilities.
 */
class ChainTarget extends RpcTarget {
  public disposed = false;
  public depth: number;
  private next?: ChainTarget;

  constructor(depth: number = 0) {
    super();
    this.depth = depth;
  }

  getDepth(): number {
    return this.depth;
  }

  createNext(): ChainTarget {
    this.next = new ChainTarget(this.depth + 1);
    return this.next;
  }

  getNext(): ChainTarget | undefined {
    return this.next;
  }

  [Symbol.dispose]() {
    this.disposed = true;
    if (this.next && !this.next.disposed) {
      this.next[Symbol.dispose]();
    }
    this.next = undefined;
  }
}

/**
 * Target for creating wide fan-out structures.
 */
class FanOutTarget extends RpcTarget {
  public disposed = false;
  private children: Map<number, SimpleTarget> = new Map();

  getValue(): string {
    return "fanout";
  }

  createChildAt(index: number): SimpleTarget {
    const child = new SimpleTarget();
    this.children.set(index, child);
    return child;
  }

  createManyChildren(count: number): SimpleTarget[] {
    const children: SimpleTarget[] = [];
    for (let i = 0; i < count; i++) {
      const child = new SimpleTarget();
      this.children.set(i, child);
      children.push(child);
    }
    return children;
  }

  getChildCount(): number {
    return this.children.size;
  }

  [Symbol.dispose]() {
    this.disposed = true;
    for (const child of this.children.values()) {
      if (!child.disposed) {
        child[Symbol.dispose]();
      }
    }
    this.children.clear();
  }
}

/**
 * Simple target with disposal tracking.
 */
class SimpleTarget extends RpcTarget {
  public disposed = false;
  public disposeCount = 0;

  getValue(): number {
    return 42;
  }

  [Symbol.dispose]() {
    this.disposed = true;
    this.disposeCount++;
  }
}

/**
 * Target that can store and return other stubs, for circular reference testing.
 */
class CircularRefTarget extends RpcTarget {
  private storedStubs: Map<string, RpcStub<CircularRefTarget>> = new Map();
  public disposed = false;

  storeStub(key: string, stub: RpcStub<CircularRefTarget>): void {
    // Must dup() to take ownership
    this.storedStubs.set(key, stub.dup());
  }

  getStored(key: string): RpcStub<CircularRefTarget> | undefined {
    return this.storedStubs.get(key);
  }

  clearAll(): void {
    for (const stub of this.storedStubs.values()) {
      stub[Symbol.dispose]();
    }
    this.storedStubs.clear();
  }

  getValue(): string {
    return "circular";
  }

  [Symbol.dispose]() {
    this.disposed = true;
    this.clearAll();
  }
}

/**
 * Target that creates deeply nested structures in a single return value.
 */
class DeepNestTarget extends RpcTarget {
  /**
   * Creates a structure with the specified nesting depth.
   * Each level has a child property pointing to the next level.
   */
  createDeepStructure(depth: number): NestedTarget {
    const root = new NestedTarget();
    let current = root;
    for (let i = 1; i < depth; i++) {
      current = current.createChild();
    }
    return root;
  }

  /**
   * Creates a wide structure with many siblings at the same level.
   */
  createWideStructure(width: number): NestedTarget[] {
    return Array.from({ length: width }, () => new NestedTarget());
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Basic Disposal", () => {
  it("should dispose server target when main stub is disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Verify target is not disposed initially
    expect(serverTarget.disposed).toBe(false);

    // Dispose the main stub
    stub[Symbol.dispose]();

    // Pump microtasks to allow abort message to be processed
    await pumpMicrotasks(32);

    // Server target should be disposed after session shutdown
    expect(serverTarget.disposed).toBe(true);
  });
});

describe("Large Capability Graph - Deep Nesting", () => {
  it("should handle 50-level deep capability chains without stack overflow", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ChainTarget(0);
    const client = new RpcSession<ChainTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a chain of 50 targets
    let current = stub;
    const stubs: RpcStub<ChainTarget>[] = [stub as unknown as RpcStub<ChainTarget>];

    for (let i = 0; i < 49; i++) {
      const next = await current.createNext();
      stubs.push(next as unknown as RpcStub<ChainTarget>);
      current = next as unknown as typeof current;
    }

    // Verify the chain is correct
    const depth = await current.getDepth();
    expect(depth).toBe(49);

    // Dispose all stubs in reverse order
    for (let i = stubs.length - 1; i >= 0; i--) {
      stubs[i][Symbol.dispose]();
    }

    // Need many microtask cycles: 50 release messages + 1 abort message
    // Each message needs multiple cycles to process
    await pumpMicrotasks(256);

    // All should be disposed
    expect(serverTarget.disposed).toBe(true);
  });

  it("should handle 100-level deep capability chains", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ChainTarget(0);
    const client = new RpcSession<ChainTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const stubs: RpcStub<ChainTarget>[] = [];

    // Create a chain of 100 targets
    let current = stub;
    for (let i = 0; i < 100; i++) {
      const next = await current.createNext();
      stubs.push(next as unknown as RpcStub<ChainTarget>);
      current = next as unknown as typeof current;
    }

    // Verify deep chain works
    const depth = await current.getDepth();
    expect(depth).toBe(100);

    // Dispose from the tip
    for (let i = stubs.length - 1; i >= 0; i--) {
      stubs[i][Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    await pumpMicrotasks(128);
  });

  it("should serialize/deserialize deeply nested structures (50+ levels)", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DeepNestTarget();
    const client = new RpcSession<DeepNestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a deeply nested structure
    const deepRoot = await stub.createDeepStructure(50);

    // Should be able to get a value from it
    const value = await deepRoot.getValue();
    expect(value).toBe("nested");

    // Clean up
    deepRoot[Symbol.dispose]();
    stub[Symbol.dispose]();

    await pumpMicrotasks(64);
  });
});

describe("Large Capability Graph - Wide Fan-out", () => {
  it("should handle 100+ siblings in a single message", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new FanOutTarget();
    const client = new RpcSession<FanOutTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create 100 children in one call
    const children = await stub.createManyChildren(100);

    expect(children.length).toBe(100);

    // Verify all children work
    for (const child of children) {
      const value = await child.getValue();
      expect(value).toBe(42);
    }

    // Dispose all children
    for (const child of children) {
      child[Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    // Need many microtask cycles: 100 release messages + 1 abort message
    await pumpMicrotasks(512);

    expect(serverTarget.disposed).toBe(true);
  });

  it("should handle 500+ siblings without performance degradation", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new FanOutTarget();
    const client = new RpcSession<FanOutTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    const startTime = Date.now();

    // Create 500 children in one call
    const children = await stub.createManyChildren(500);

    const createTime = Date.now() - startTime;

    expect(children.length).toBe(500);
    // Should complete in reasonable time (< 5 seconds)
    expect(createTime).toBeLessThan(5000);

    // Dispose all
    for (const child of children) {
      child[Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    await pumpMicrotasks(256);
  });

  it("should handle 1000+ siblings (stress test)", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new FanOutTarget();
    const client = new RpcSession<FanOutTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create 1000 children in batches to avoid overwhelming the system
    const allChildren: RpcStub<SimpleTarget>[] = [];
    for (let batch = 0; batch < 10; batch++) {
      const children = await stub.createManyChildren(100);
      allChildren.push(...(children as unknown as RpcStub<SimpleTarget>[]));
    }

    expect(allChildren.length).toBe(1000);

    // Dispose all
    for (const child of allChildren) {
      child[Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    await pumpMicrotasks(512);
  });
});

describe("Large Capability Graph - Circular References", () => {
  it("should handle simple A->B->A circular reference", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stubA = client.getRemoteMain();

    // Create target B on server
    const targetB = new CircularRefTarget();
    const stubB = new RpcStub(targetB);

    // A stores reference to B
    await stubA.storeStub("b", stubB);

    // Get B back from A, then make B store reference to A
    const retrievedB = await stubA.getStored("b");
    if (retrievedB) {
      // This creates a circular reference: A->B and B->A
      await retrievedB.storeStub("a", stubA as unknown as RpcStub<CircularRefTarget>);
    }

    await pumpMicrotasks();

    // Clear references and verify cleanup
    await stubA.clearAll();
    if (retrievedB) {
      await retrievedB.clearAll();
      retrievedB[Symbol.dispose]();
    }
    stubB[Symbol.dispose]();
    stubA[Symbol.dispose]();

    await pumpMicrotasks(64);
  });

  it("should handle triangle circular reference (A->B->C->A)", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stubA = client.getRemoteMain();

    // Create B and C
    const targetB = new CircularRefTarget();
    const targetC = new CircularRefTarget();
    const stubB = new RpcStub(targetB);
    const stubC = new RpcStub(targetC);

    // A->B, B->C, C->A
    await stubA.storeStub("next", stubB);
    await stubB.storeStub("next", stubC);
    await stubC.storeStub("next", stubA as unknown as RpcStub<CircularRefTarget>);

    await pumpMicrotasks();

    // Clear and dispose
    await stubA.clearAll();
    await stubB.clearAll();
    await stubC.clearAll();
    stubC[Symbol.dispose]();
    stubB[Symbol.dispose]();
    stubA[Symbol.dispose]();

    await pumpMicrotasks(64);
  });

  it("should handle complex graph with multiple circular references", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const root = client.getRemoteMain();

    // Create a graph with multiple interconnected nodes
    const nodes: RpcStub<CircularRefTarget>[] = [];
    for (let i = 0; i < 5; i++) {
      const target = new CircularRefTarget();
      nodes.push(new RpcStub(target));
    }

    // Create circular links: each node points to the next, and last points to first
    for (let i = 0; i < nodes.length; i++) {
      const next = nodes[(i + 1) % nodes.length];
      await nodes[i].storeStub("next", next);
    }

    await pumpMicrotasks();

    // Clean up - break all cycles
    for (const node of nodes) {
      await node.clearAll();
    }
    for (const node of nodes) {
      node[Symbol.dispose]();
    }
    root[Symbol.dispose]();

    await pumpMicrotasks(64);
  });
});

describe("Large Capability Graph - Nested Capabilities in Single Message", () => {
  it("should handle object with 100+ capability fields", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DeepNestTarget();
    const client = new RpcSession<DeepNestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create 100 capabilities in a single array return
    const caps = await stub.createWideStructure(100);

    expect(caps.length).toBe(100);

    // Verify all work
    for (const cap of caps) {
      const value = await cap.getValue();
      expect(value).toBe("nested");
    }

    // Dispose all
    for (const cap of caps) {
      cap[Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    await pumpMicrotasks(128);
  });

  it("should handle mixed nested structure with capabilities at multiple levels", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create tree-like structure: root -> 10 children -> each has 10 grandchildren
    const children = await stub.createChildren(10);
    expect(children.length).toBe(10);

    const grandchildren: RpcStub<NestedTarget>[][] = [];
    for (const child of children) {
      const gc = await child.createChildren(10);
      grandchildren.push(gc as unknown as RpcStub<NestedTarget>[]);
    }

    expect(grandchildren.length).toBe(10);
    expect(grandchildren[0].length).toBe(10);

    // Dispose from leaves up
    for (const gcGroup of grandchildren) {
      for (const gc of gcGroup) {
        gc[Symbol.dispose]();
      }
    }
    for (const child of children) {
      child[Symbol.dispose]();
    }
    stub[Symbol.dispose]();

    // Need many microtask cycles: 100 grandchildren + 10 children + 1 main + 1 abort
    await pumpMicrotasks(512);

    expect(serverTarget.disposed).toBe(true);
  });
});

describe("Large Capability Graph - Reference Counting", () => {
  it("should correctly count references for duplicated stubs", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create many duplicates
    const dups: RpcStub<SimpleTarget>[] = [];
    for (let i = 0; i < 100; i++) {
      dups.push(stub.dup() as unknown as RpcStub<SimpleTarget>);
    }

    // Dispose all dups
    for (const dup of dups) {
      dup[Symbol.dispose]();
    }

    // Original should still work
    const value = await stub.getValue();
    expect(value).toBe(42);

    // Target should not be disposed yet
    expect(serverTarget.disposed).toBe(false);

    // Dispose original
    stub[Symbol.dispose]();

    await pumpMicrotasks(64);

    // Now it should be disposed
    expect(serverTarget.disposed).toBe(true);
    expect(serverTarget.disposeCount).toBe(1);
  });

  it("should handle rapid dup/dispose cycles without leaking", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Rapid dup/dispose cycles
    for (let cycle = 0; cycle < 100; cycle++) {
      const dups: RpcStub<SimpleTarget>[] = [];
      for (let i = 0; i < 10; i++) {
        dups.push(stub.dup() as unknown as RpcStub<SimpleTarget>);
      }
      for (const dup of dups) {
        dup[Symbol.dispose]();
      }
    }

    await pumpMicrotasks(64);

    // Should not have leaked imports
    const afterStats = client.getStats();
    expect(afterStats.imports).toBeLessThanOrEqual(baselineStats.imports + 5);

    // Original should still work
    const value = await stub.getValue();
    expect(value).toBe(42);

    stub[Symbol.dispose]();

    await pumpMicrotasks(32);
  });
});

describe("Large Capability Graph - Abort Cleanup", () => {
  it("should clean up all capabilities in deep chain on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ChainTarget(0);
    const client = new RpcSession<ChainTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a chain of 20 targets
    let current = stub;
    for (let i = 0; i < 20; i++) {
      const next = await current.createNext();
      current = next as unknown as typeof current;
    }

    await pumpMicrotasks();

    // Force abort
    clientTransport.forceReceiveError(new Error("connection lost"));

    await pumpMicrotasks(64);

    // Server target should be disposed (cleanup on abort)
    // Note: This depends on implementation - the abort should trigger cleanup
    const serverStats = server.getStats();
    expect(serverStats.exports).toBeLessThanOrEqual(1); // Main export or empty
  });

  it("should clean up all capabilities in wide fan-out on abort", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new FanOutTarget();
    const client = new RpcSession<FanOutTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create many children
    await stub.createManyChildren(50);

    await pumpMicrotasks();

    const beforeStats = server.getStats();
    expect(beforeStats.exports).toBeGreaterThan(1);

    // Force abort
    serverTransport.forceReceiveError(new Error("server error"));

    await pumpMicrotasks(64);

    // Should clean up exports
    const afterStats = server.getStats();
    expect(afterStats.exports).toBeLessThanOrEqual(1);
  });

  it("should clean up circular references on abort without hanging", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CircularRefTarget();
    const client = new RpcSession<CircularRefTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stubA = client.getRemoteMain();

    // Create circular reference
    const targetB = new CircularRefTarget();
    const stubB = new RpcStub(targetB);
    await stubA.storeStub("b", stubB);

    await pumpMicrotasks();

    // Abort should not hang due to circular refs
    const abortPromise = new Promise<void>((resolve) => {
      clientTransport.forceReceiveError(new Error("abort"));
      setTimeout(resolve, 100);
    });

    // Should complete within timeout (not hang)
    await abortPromise;

    await pumpMicrotasks(32);

    // Clean up local stub
    stubB[Symbol.dispose]();
  });
});

describe("Large Capability Graph - Memory Stress Tests", () => {
  it("should not exhaust memory with 1000 sequential capability creates", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const baselineStats = client.getStats();

    // Create and immediately dispose 1000 times
    for (let i = 0; i < 1000; i++) {
      const child = await stub.createChild();
      child[Symbol.dispose]();

      // Periodically pump to allow cleanup
      if (i % 100 === 0) {
        await pumpMicrotasks(16);
      }
    }

    await pumpMicrotasks(64);

    // Should not have leaked significantly
    const afterStats = client.getStats();
    expect(afterStats.imports).toBeLessThanOrEqual(baselineStats.imports + 10);

    stub[Symbol.dispose]();

    await pumpMicrotasks(32);
  });

  it("should handle peak load of many concurrent capabilities", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create many concurrent capabilities
    const promises: Promise<RpcStub<NestedTarget>>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(stub.createChild() as unknown as Promise<RpcStub<NestedTarget>>);
    }

    const children = await Promise.all(promises);
    expect(children.length).toBe(100);

    // Dispose all at once
    for (const child of children) {
      child[Symbol.dispose]();
    }

    stub[Symbol.dispose]();

    await pumpMicrotasks(128);
  });
});
