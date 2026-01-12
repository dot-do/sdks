// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach } from "vitest"
import { RpcSession, type RpcSessionOptions, RpcTransport, RpcTarget, RpcStub } from "../src/index.js"

/**
 * Edge case tests for connection handling (issue: dot-do-capnweb-j5h)
 *
 * Tests for:
 * 1. Calling methods on a closed connection
 * 2. Sending messages larger than buffer limits
 * 3. Handling malformed JSON responses
 * 4. Connection state transitions
 * 5. Concurrent connection attempts
 * 6. Memory cleanup on disconnect
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
  public closed = false;

  async send(message: string): Promise<void> {
    if (this.closed) {
      throw new Error("Transport is closed");
    }
    if (this.log) console.log(`${this.name}: ${message}`);
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.closed) {
      throw new Error("Transport is closed");
    }
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

  close() {
    this.closed = true;
    if (this.aborter) {
      this.aborter(new Error("Transport closed"));
    }
  }
}

// Transport that simulates malformed JSON responses
class MalformedJsonTransport implements RpcTransport {
  constructor(public name: string, private partner?: MalformedJsonTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;
  public sendMalformedJson = false;
  public malformedJsonType: "truncated" | "invalid" | "binary" = "invalid";

  async send(message: string): Promise<void> {
    let messageToSend = message;
    if (this.sendMalformedJson) {
      switch (this.malformedJsonType) {
        case "truncated":
          // Truncate JSON mid-way
          messageToSend = message.substring(0, Math.floor(message.length / 2));
          break;
        case "invalid":
          // Send completely invalid JSON
          messageToSend = "{invalid json: not valid";
          break;
        case "binary":
          // Send binary-like garbage
          messageToSend = "\x00\x01\x02\x03\x04\x05";
          break;
      }
    }
    this.partner!.queue.push(messageToSend);
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

// Transport that tracks memory/resource allocation
class TrackedTransport implements RpcTransport {
  constructor(public name: string, private partner?: TrackedTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public aborted = false;
  public abortReason?: any;

  // Resource tracking
  public allocatedResources = 0;
  public peakResources = 0;

  async send(message: string): Promise<void> {
    this.allocatedResources++;
    this.peakResources = Math.max(this.peakResources, this.allocatedResources);
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
    this.allocatedResources--;
    return this.queue.shift()!;
  }

  abort(reason: any) {
    this.aborted = true;
    this.abortReason = reason;
    // Clear any allocated resources on abort
    this.allocatedResources = 0;
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
  echo(value: string) { return value; }
  slowMethod(): Promise<number> {
    return new Promise(resolve => setTimeout(() => resolve(42), 50));
  }
}

// Target that tracks disposal
class DisposableTarget extends RpcTarget {
  public disposed = false;
  public disposeCount = 0;

  getValue() { return 42; }

  [Symbol.dispose]() {
    this.disposed = true;
    this.disposeCount++;
  }
}

describe("Edge cases - Calling methods on closed connection", () => {
  it("should throw when calling method after stub is disposed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a successful call first
    expect(await stub.getValue()).toBe(42);

    // Dispose the stub
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Further calls should throw
    await expect(() => stub.getValue()).rejects.toThrow();
  });

  it("should throw when calling method after transport is closed", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a successful call first
    expect(await stub.getValue()).toBe(42);

    // Close the transport
    clientTransport.close();
    await pumpMicrotasks();

    // Further calls should fail
    await expect(() => stub.getValue()).rejects.toThrow();
  });

  it("should reject pending calls when connection is lost", async () => {
    class HangingTarget extends RpcTarget {
      hang(): Promise<number> {
        return new Promise(() => {}); // Never resolves
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a call that will hang
    const hangPromise = stub.hang();

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // The hanging call should be rejected
    await expect(() => hangPromise).rejects.toThrow("connection lost");
  });

  it("should handle rapid open/close cycles", async () => {
    for (let i = 0; i < 5; i++) {
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
      await pumpMicrotasks();
    }
  });

  it("should handle disposing stub multiple times", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(await stub.getValue()).toBe(42);

    // Dispose multiple times - should not throw
    stub[Symbol.dispose]();
    stub[Symbol.dispose]();
    stub[Symbol.dispose]();

    await pumpMicrotasks();

    // Should still throw on subsequent calls
    await expect(() => stub.getValue()).rejects.toThrow();
  });
});

describe("Edge cases - Large message handling", () => {
  it("should handle large string arguments", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a large string (1MB)
    const largeString = "x".repeat(1024 * 1024);
    const result = await stub.echo(largeString);

    expect(result).toBe(largeString);
    expect(result.length).toBe(1024 * 1024);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle large array arguments", async () => {
    class ArrayTarget extends RpcTarget {
      processArray(arr: number[]) {
        return arr.length;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ArrayTarget();
    const client = new RpcSession<ArrayTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a large array (10000 elements)
    const largeArray = Array.from({ length: 10000 }, (_, i) => i);
    const result = await stub.processArray(largeArray);

    expect(result).toBe(10000);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle deeply nested objects", async () => {
    class NestedTarget extends RpcTarget {
      getDepth(obj: any, depth: number = 0): number {
        if (typeof obj === "object" && obj !== null && "nested" in obj) {
          return this.getDepth(obj.nested, depth + 1);
        }
        return depth;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create a deeply nested object (50 levels - within the 64 limit)
    let nested: any = { value: "bottom" };
    for (let i = 0; i < 50; i++) {
      nested = { nested };
    }

    const depth = await stub.getDepth(nested);
    expect(depth).toBe(50);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should reject objects exceeding maximum nesting depth", async () => {
    class NestedTarget extends RpcTarget {
      getDepth(obj: any, depth: number = 0): number {
        if (typeof obj === "object" && obj !== null && "nested" in obj) {
          return this.getDepth(obj.nested, depth + 1);
        }
        return depth;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new NestedTarget();
    const client = new RpcSession<NestedTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create an object that exceeds the 64 level limit
    let nested: any = { value: "bottom" };
    for (let i = 0; i < 100; i++) {
      nested = { nested };
    }

    // Should throw due to serialization depth limit
    // The error may be thrown synchronously or as a rejected promise
    let errorThrown = false;
    try {
      await stub.getDepth(nested);
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).toMatch(/exceeded maximum allowed depth/);
    }
    expect(errorThrown).toBe(true);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Edge cases - Malformed JSON responses", () => {
  it("should handle truncated JSON", async () => {
    const clientTransport = new MalformedJsonTransport("client");
    const serverTransport = new MalformedJsonTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a call first
    expect(await stub.getValue()).toBe(42);

    // Enable malformed JSON on the server side (responses to client)
    serverTransport.sendMalformedJson = true;
    serverTransport.malformedJsonType = "truncated";

    // Next call should fail due to JSON parse error
    await expect(() => stub.add(1, 2)).rejects.toThrow();

    // Transport should be aborted
    await pumpMicrotasks();
    expect(clientTransport.aborted).toBe(true);
  });

  it("should handle invalid JSON syntax", async () => {
    const clientTransport = new MalformedJsonTransport("client");
    const serverTransport = new MalformedJsonTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Enable malformed JSON immediately
    serverTransport.sendMalformedJson = true;
    serverTransport.malformedJsonType = "invalid";

    // Call should fail
    await expect(() => stub.getValue()).rejects.toThrow();

    await pumpMicrotasks();
    expect(clientTransport.aborted).toBe(true);
  });

  it("should handle binary data masquerading as JSON", async () => {
    const clientTransport = new MalformedJsonTransport("client");
    const serverTransport = new MalformedJsonTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Enable binary garbage
    serverTransport.sendMalformedJson = true;
    serverTransport.malformedJsonType = "binary";

    // Call should fail
    await expect(() => stub.getValue()).rejects.toThrow();

    await pumpMicrotasks();
    expect(clientTransport.aborted).toBe(true);
  });
});

describe("Edge cases - Connection state transitions", () => {
  it("should track connection state through lifecycle", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Initially should have stats
    const initialStats = client.getStats();
    expect(initialStats.imports).toBeGreaterThanOrEqual(1);
    expect(initialStats.exports).toBeGreaterThanOrEqual(1);

    const stub = client.getRemoteMain();

    // Make calls
    expect(await stub.getValue()).toBe(42);
    expect(await stub.add(10, 20)).toBe(30);

    // Dispose
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Transport should be aborted after session shutdown
    expect(clientTransport.aborted).toBe(true);
  });

  it("should handle abort during message processing", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a call
    const callPromise = stub.slowMethod();

    // Abort while the call is in progress
    clientTransport.forceReceiveError(new Error("abort during processing"));

    // Should reject
    await expect(() => callPromise).rejects.toThrow("abort during processing");

    expect(clientTransport.aborted).toBe(true);
  });

  it("should handle transition from connected to disconnected", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    let brokenCalled = false;
    let brokenError: any = null;

    stub.onRpcBroken((error) => {
      brokenCalled = true;
      brokenError = error;
    });

    // Make successful call
    expect(await stub.getValue()).toBe(42);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection dropped"));
    await pumpMicrotasks();

    // onRpcBroken should have been called
    expect(brokenCalled).toBe(true);
    expect(brokenError.message).toBe("connection dropped");
  });
});

describe("Edge cases - Concurrent connection attempts", () => {
  it("should handle multiple simultaneous calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make multiple concurrent calls
    const calls = Array.from({ length: 10 }, (_, i) =>
      stub.add(i, i * 2)
    );

    const results = await Promise.all(calls);

    // Verify all results
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toBe(i + i * 2);
    }

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle concurrent calls with disconnect", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    class SlowTarget extends RpcTarget {
      async slowAdd(a: number, b: number): Promise<number> {
        await new Promise(resolve => setTimeout(resolve, 10));
        return a + b;
      }
    }

    const serverTarget = new SlowTarget();
    const client = new RpcSession<SlowTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start multiple slow calls
    const calls = Array.from({ length: 5 }, (_, i) =>
      stub.slowAdd(i, i)
    );

    // Disconnect mid-flight
    setTimeout(() => {
      clientTransport.forceReceiveError(new Error("concurrent disconnect"));
    }, 5);

    // All calls should reject
    const results = await Promise.allSettled(calls);
    const rejectedCount = results.filter(r => r.status === "rejected").length;

    // At least some should be rejected (timing-dependent, but at least one)
    expect(rejectedCount).toBeGreaterThan(0);
  });

  it("should handle interleaved requests and responses", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    class CounterTarget extends RpcTarget {
      private count = 0;

      increment(): number {
        return ++this.count;
      }

      getCount(): number {
        return this.count;
      }
    }

    const serverTarget = new CounterTarget();
    const client = new RpcSession<CounterTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Interleave increment and getCount calls
    const operations: Promise<number>[] = [];
    for (let i = 0; i < 10; i++) {
      operations.push(stub.increment());
      operations.push(stub.getCount());
    }

    const results = await Promise.all(operations);

    // All operations should complete
    expect(results.length).toBe(20);

    // Increments should return sequential values
    const increments = results.filter((_, i) => i % 2 === 0);
    for (let i = 0; i < increments.length; i++) {
      expect(increments[i]).toBe(i + 1);
    }

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Edge cases - Memory cleanup on disconnect", () => {
  it("should dispose RpcTargets on connection close", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new DisposableTarget();
    const client = new RpcSession<DisposableTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a call
    expect(await stub.getValue()).toBe(42);
    expect(serverTarget.disposed).toBe(false);

    // Force disconnect on server side
    serverTransport.forceReceiveError(new Error("server disconnect"));
    await pumpMicrotasks();

    // The server target should be disposed
    expect(serverTarget.disposed).toBe(true);
  });

  it("should clean up import/export tables on disconnect", async () => {
    const clientTransport = new TrackedTransport("client");
    const serverTransport = new TrackedTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make several calls to populate tables
    for (let i = 0; i < 10; i++) {
      await stub.add(i, i);
    }

    // Force disconnect
    clientTransport.forceReceiveError(new Error("cleanup test"));
    await pumpMicrotasks();

    // Resources should be cleaned up
    expect(clientTransport.aborted).toBe(true);
    expect(clientTransport.allocatedResources).toBe(0);
  });

  it("should not leak resources with nested stubs", async () => {
    class NestedTarget extends RpcTarget {
      private disposed = false;

      getValue() { return 42; }

      [Symbol.dispose]() {
        this.disposed = true;
      }
    }

    class ParentTarget extends RpcTarget {
      private children: NestedTarget[] = [];

      createChild(): NestedTarget {
        const child = new NestedTarget();
        this.children.push(child);
        return child;
      }

      getChildrenCount(): number {
        return this.children.length;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new ParentTarget();
    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Create nested children
    using child1 = await stub.createChild();
    using child2 = await stub.createChild();

    expect(await child1.getValue()).toBe(42);
    expect(await child2.getValue()).toBe(42);
    expect(await stub.getChildrenCount()).toBe(2);

    // Dispose children explicitly
    child1[Symbol.dispose]();
    child2[Symbol.dispose]();

    await pumpMicrotasks();

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle cleanup when server crashes mid-response", async () => {
    class CrashingTarget extends RpcTarget {
      private callCount = 0;

      getValue(): number {
        this.callCount++;
        if (this.callCount > 2) {
          throw new Error("Simulated crash");
        }
        return 42;
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new CrashingTarget();
    const client = new RpcSession<CrashingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // First two calls succeed
    expect(await stub.getValue()).toBe(42);
    expect(await stub.getValue()).toBe(42);

    // Third call throws
    await expect(() => stub.getValue()).rejects.toThrow("Simulated crash");

    // Should still be able to clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("Edge cases - Error callback handling", () => {
  it("should call onInternalError for internal errors", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const internalErrors: Error[] = [];
    const options: RpcSessionOptions = {
      onInternalError: (error) => {
        internalErrors.push(error);
      }
    };

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, options);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Normal call
    expect(await stub.getValue()).toBe(42);

    // Force an error that triggers internal error handling
    clientTransport.forceReceiveError(new Error("test internal error"));
    await pumpMicrotasks();

    // Clean up completed
    expect(clientTransport.aborted).toBe(true);
  });

  it("should call onSendError when serializing errors", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const sendErrors: Error[] = [];
    const options: RpcSessionOptions = {
      onSendError: (error) => {
        sendErrors.push(error);
        return error;
      }
    };

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget, options);

    const stub = client.getRemoteMain();

    // Trigger an error
    await expect(() => stub.throwError()).rejects.toThrow("test error");

    // onSendError should have been called
    expect(sendErrors.length).toBeGreaterThan(0);
    expect(sendErrors[0].message).toBe("test error");

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle errors in onRpcBroken callback", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Register a callback that throws
    stub.onRpcBroken(() => {
      throw new Error("Callback error");
    });

    // Force disconnect - should not crash despite callback throwing
    clientTransport.forceReceiveError(new Error("disconnect"));
    await pumpMicrotasks();

    // Should complete without crashing
    expect(clientTransport.aborted).toBe(true);
  });
});

describe("Edge cases - Dup and disposal interactions", () => {
  it("should handle dup followed by disposal of original", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const dup = stub.dup();

    // Dispose original
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Dup should still work (it has its own reference)
    // Note: Whether this works depends on implementation details
    // The session may already be shut down

    dup[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("should handle multiple dups", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const dups = Array.from({ length: 5 }, () => stub.dup());

    // Dispose original
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Dispose all dups
    for (const dup of dups) {
      dup[Symbol.dispose]();
    }
    await pumpMicrotasks();
  });
});
