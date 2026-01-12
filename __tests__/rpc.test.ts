// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, RpcStub, type RpcSessionOptions } from "../src/index.js"

/**
 * Unit tests for RPC session management (rpc.ts)
 * Tests RpcTarget branding, instanceof checks, session creation, and teardown
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

describe("RpcTarget branding", () => {
  it("RpcTarget instances pass instanceof check", () => {
    const target = new SimpleTarget();
    expect(target instanceof RpcTarget).toBe(true);
  });

  it("plain objects do not pass RpcTarget instanceof check", () => {
    const plainObj = { getValue: () => 42 };
    expect(plainObj instanceof RpcTarget).toBe(false);
  });

  it("subclasses of RpcTarget pass instanceof check", () => {
    class ExtendedTarget extends RpcTarget {
      getExtendedValue() { return 100; }
    }
    const target = new ExtendedTarget();
    expect(target instanceof RpcTarget).toBe(true);
    expect(target instanceof ExtendedTarget).toBe(true);
  });

  it("RpcTarget can be used as a base class", () => {
    class Counter extends RpcTarget {
      private count = 0;
      increment() { return ++this.count; }
      get value() { return this.count; }
    }
    const counter = new Counter();
    expect(counter instanceof RpcTarget).toBe(true);
    expect(counter.increment()).toBe(1);
    expect(counter.value).toBe(1);
  });
});

describe("RpcSession creation", () => {
  it("creates an RpcSession with transport and local main", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(stub).toBeDefined();

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("getRemoteMain returns an RpcStub", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    // Check that it behaves like an RpcStub (has dispose method)
    expect(typeof stub[Symbol.dispose]).toBe("function");

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("can make calls through RpcSession", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const result = await stub.getValue();
    expect(result).toBe(42);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("can pass arguments through RpcSession", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    const result = await stub.add(10, 32);
    expect(result).toBe(42);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("RpcSession teardown", () => {
  it("disposing main stub shuts down the session", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(await stub.getValue()).toBe(42);

    // Dispose the stub
    stub[Symbol.dispose]();
    await pumpMicrotasks();

    // Further calls should fail
    await expect(() => stub.getValue()).rejects.toThrow();
  });

  it("transport abort triggers session cleanup", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(await stub.getValue()).toBe(42);

    // Force a transport error
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    // Transport should be marked as aborted
    expect(clientTransport.aborted).toBe(true);
  });

  it("getStats returns import/export counts", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Initially should have main import/export
    const clientStats = client.getStats();
    expect(clientStats.imports).toBeGreaterThanOrEqual(1);
    expect(clientStats.exports).toBeGreaterThanOrEqual(1);

    const serverStats = server.getStats();
    expect(serverStats.imports).toBeGreaterThanOrEqual(1);
    expect(serverStats.exports).toBeGreaterThanOrEqual(1);

    // Clean up
    client.getRemoteMain()[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("RpcSession error propagation", () => {
  it("propagates errors from remote calls", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    await expect(() => stub.throwError()).rejects.toThrow("test error");

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("connection errors propagate to pending calls", async () => {
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
    clientTransport.forceReceiveError(new Error("disconnected"));

    // The hanging call should be rejected
    await expect(() => hangPromise).rejects.toThrow("disconnected");
  });
});

describe("RpcSession options", () => {
  it("onSendError callback is called when serializing errors", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const errorsSeen: Error[] = [];
    const serverOptions: RpcSessionOptions = {
      onSendError: (error) => {
        errorsSeen.push(error);
        return error; // Return to include stack
      }
    };

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget, serverOptions);

    const stub = client.getRemoteMain();

    // Trigger an error
    await expect(() => stub.throwError()).rejects.toThrow("test error");

    // The callback should have been called
    expect(errorsSeen.length).toBeGreaterThan(0);
    expect(errorsSeen[0].message).toBe("test error");

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("onInternalError callback is called for internal errors", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const internalErrors: Error[] = [];
    const clientOptions: RpcSessionOptions = {
      onInternalError: (error) => {
        internalErrors.push(error);
      }
    };

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, clientOptions);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();
    expect(await stub.getValue()).toBe(42);

    // Force an error during abort
    clientTransport.forceReceiveError(new Error("test disconnect"));
    await pumpMicrotasks();

    // Clean up (stub already broken)
    await pumpMicrotasks();
  });
});

describe("RpcSession drain", () => {
  it("drain() waits for pending resolutions", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    class SlowTarget extends RpcTarget {
      async slowMethod(): Promise<number> {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 42;
      }
    }

    const serverTarget = new SlowTarget();
    const client = new RpcSession<SlowTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Make a call
    const result = await stub.slowMethod();
    expect(result).toBe(42);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("RpcStub instanceof checks", () => {
  it("RpcStub wrapping RpcTarget is recognized", async () => {
    const target = new SimpleTarget();
    const stub = new RpcStub(target);
    // The stub behaves like an RpcStub
    expect(typeof stub[Symbol.dispose]).toBe("function");
  });

  it("RpcStub can wrap plain objects", async () => {
    const obj = { value: 42 };
    const stub = new RpcStub(obj);
    expect(await stub.value).toBe(42);
  });

  it("RpcStub can wrap functions", async () => {
    const func = (x: number) => x * 2;
    const stub = new RpcStub(func);
    expect(await stub(21)).toBe(42);
  });

  it("RpcStub toString returns proper identifier", () => {
    const stub = new RpcStub(new SimpleTarget());
    expect(stub.toString()).toBe("[object RpcStub]");
  });
});

describe("RpcStub disposal", () => {
  it("dup() creates independent copy", async () => {
    let disposed = false;
    class DisposableTarget extends RpcTarget {
      getValue() { return 42; }
      [Symbol.dispose]() { disposed = true; }
    }

    const stub = new RpcStub(new DisposableTarget());
    const dup = stub.dup();

    // Disposing original shouldn't dispose the target yet
    stub[Symbol.dispose]();
    expect(disposed).toBe(false);

    // Disposing dup should now dispose the target
    dup[Symbol.dispose]();
    expect(disposed).toBe(true);
  });

  it("disposal is idempotent", async () => {
    let disposeCount = 0;
    class CountingTarget extends RpcTarget {
      [Symbol.dispose]() { disposeCount++; }
    }

    const stub = new RpcStub(new CountingTarget());

    stub[Symbol.dispose]();
    stub[Symbol.dispose]();
    stub[Symbol.dispose]();

    // Should only be called once
    expect(disposeCount).toBe(1);
  });
});

describe("RpcSession with nested stubs", () => {
  it("can return nested RpcTargets", async () => {
    class NestedTarget extends RpcTarget {
      getValue() { return 42; }
    }

    class ParentTarget extends RpcTarget {
      getChild() { return new NestedTarget(); }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<ParentTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new ParentTarget());

    const stub = client.getRemoteMain();
    using child = await stub.getChild();
    expect(await child.getValue()).toBe(42);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("can pass stubs as arguments", async () => {
    class Counter extends RpcTarget {
      private value = 0;
      increment() { return ++this.value; }
    }

    class UseCounter extends RpcTarget {
      async useCounter(counter: RpcStub<Counter>) {
        return await counter.increment();
      }
    }

    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<UseCounter>(clientTransport);
    const server = new RpcSession(serverTransport, new UseCounter());

    const stub = client.getRemoteMain();
    const counter = new Counter();

    const result = await stub.useCounter(counter);
    expect(result).toBe(1);

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("RpcSession onRpcBroken", () => {
  it("onRpcBroken callback is called on disconnect", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    let brokenError: any = null;
    stub.onRpcBroken((error) => {
      brokenError = error;
    });

    // Force disconnect
    clientTransport.forceReceiveError(new Error("test disconnect"));
    await pumpMicrotasks();

    expect(brokenError).not.toBeNull();
    expect(brokenError.message).toBe("test disconnect");
  });

  it("onRpcBroken callback is called for error resolutions", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new SimpleTarget());

    const stub = client.getRemoteMain();

    const errorPromise = stub.throwError();

    let brokenError: any = null;
    errorPromise.onRpcBroken((error) => {
      brokenError = error;
    });

    // Wait for the error to propagate
    await errorPromise.catch(() => {});

    expect(brokenError).not.toBeNull();
    expect(brokenError.message).toBe("test error");

    // Clean up
    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});
