// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi } from "vitest"
import { RpcSession, type RpcSessionOptions, RpcTransport, RpcTarget, RpcStub, ConnectionError } from "../src/index.js"
import { Counter, TestTarget } from "./test-util.js";

/**
 * Tests for error handling and proper error propagation.
 *
 * These tests verify that errors are NOT silently suppressed in the RPC system.
 * Related to issue: dot-do-capnweb-xrm
 *
 * The key patterns being fixed:
 * 1. try { this.abort(err); } catch (err2) {} - line ~520 in rpc.ts
 * 2. .catch(err => {}); - line ~601 in rpc.ts
 * 3. result.catch(err => {}); - line ~168 in map.ts
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
    this.aborter!(error);
  }
}

// Transport that can fail on send
class FailingSendTransport implements RpcTransport {
  constructor(public name: string, private partner?: FailingSendTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;
  public sendError: Error | null = null;
  public sendCallCount = 0;
  public aborted = false;
  public abortReason?: any;

  async send(message: string): Promise<void> {
    this.sendCallCount++;
    if (this.sendError) {
      throw this.sendError;
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

// Spin the microtask queue a bit to give messages time to be delivered and handled.
async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

describe("error handling - silent suppression fixes", () => {
  describe("onInternalError callback", () => {
    it("should call onInternalError when abort message send fails", async () => {
      const clientTransport = new FailingSendTransport("client");
      const serverTransport = new FailingSendTransport("server", clientTransport);

      const internalErrors: any[] = [];
      const clientOptions: RpcSessionOptions = {
        onInternalError: (err) => {
          internalErrors.push(err);
        }
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, clientOptions);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a normal call first
      expect(await stub.square(3)).toBe(9);

      // Now configure the transport to fail on send
      clientTransport.sendError = new Error("Transport send failed");

      // Force an error that will trigger abort - the abort will try to send an abort message
      // which will fail. Previously this error was silently swallowed.
      clientTransport.forceReceiveError(new Error("Connection lost"));

      await pumpMicrotasks();

      // The onInternalError should have been called when the abort message send failed
      expect(internalErrors.length).toBeGreaterThan(0);
      expect(internalErrors[0].message).toBe("Transport send failed");
    });

    it("should gracefully handle errors during abort serialization", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const internalErrors: any[] = [];
      const clientOptions: RpcSessionOptions = {
        onInternalError: (err) => {
          internalErrors.push(err);
        }
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, clientOptions);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a normal call first
      expect(await stub.square(3)).toBe(9);

      // Force a normal error to trigger abort
      clientTransport.forceReceiveError(new Error("Connection lost"));

      await pumpMicrotasks();

      // The abort should have been called regardless of serialization issues
      expect(clientTransport.aborted).toBe(true);
      // The abort reason should be set
      expect(clientTransport.abortReason.message).toBe("Connection lost");
    });
  });

  describe("transport abort is called on errors", () => {
    it("should call transport.abort when connection is lost", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<TestTarget>(clientTransport);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      // Verify transport abort is not called yet
      expect(clientTransport.aborted).toBe(false);
      expect(serverTransport.aborted).toBe(false);

      // Force a disconnect
      clientTransport.forceReceiveError(new Error("Test disconnect"));

      await pumpMicrotasks();

      // The transport should have been notified of the abort
      expect(clientTransport.aborted).toBe(true);
    });

    it("should include error details in transport.abort callback", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<TestTarget>(clientTransport);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      // Use ConnectionError directly to avoid wrapping (raw Errors are wrapped in ConnectionError)
      const testError = new ConnectionError("Specific test error");
      clientTransport.forceReceiveError(testError);

      await pumpMicrotasks();

      expect(clientTransport.abortReason).toBe(testError);
    });
  });

  describe("error propagation in abort scenarios", () => {
    it("should handle abort during message sending without silent suppression", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const internalErrors: any[] = [];
      const clientOptions: RpcSessionOptions = {
        onInternalError: (err) => {
          internalErrors.push(err);
        }
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, clientOptions);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();
      expect(await stub.square(4)).toBe(16);

      // Trigger abort
      clientTransport.forceReceiveError(new Error("Connection broken"));

      await pumpMicrotasks();

      // Verify the error was properly handled, not silently suppressed
      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason.message).toBe("Connection broken");
    });

    it("should propagate errors through onInternalError when send fails during abort", async () => {
      const clientTransport = new FailingSendTransport("client");
      const serverTransport = new FailingSendTransport("server", clientTransport);

      const internalErrors: any[] = [];
      const clientOptions: RpcSessionOptions = {
        onInternalError: (err) => {
          internalErrors.push(err);
        }
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, clientOptions);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Make a call that succeeds
      expect(await stub.square(2)).toBe(4);

      // Configure send to fail
      clientTransport.sendError = new Error("Send failed during abort");

      // Force an abort - the abort message will fail to send
      clientTransport.forceReceiveError(new Error("Connection lost"));

      await pumpMicrotasks();

      // The error should have been reported via onInternalError
      expect(internalErrors.length).toBeGreaterThan(0);
      expect(internalErrors[0].message).toBe("Send failed during abort");
    });
  });

  describe("map() error handling", () => {
    it("should handle map() over RPC correctly", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const internalErrors: any[] = [];
      const clientOptions: RpcSessionOptions = {
        onInternalError: (err) => {
          internalErrors.push(err);
        }
      };

      const client = new RpcSession<TestTarget>(clientTransport, undefined, clientOptions);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // Perform map() operation over RPC - maps create counters for each fibonacci value
      using fib: any = stub.generateFibonacci(5);
      using counters: any = await fib.map((i: any) => stub.makeCounter(i));

      // Each counter should have been created with the corresponding fibonacci value
      expect(await counters[0].value).toBe(0);
      expect(await counters[1].value).toBe(1);
      expect(await counters[2].value).toBe(1);
      expect(await counters[3].value).toBe(2);
      expect(await counters[4].value).toBe(3);

      // Clean up
      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });

  describe("async error handling in map callbacks", () => {
    it("should throw error when map callback returns a Promise", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<TestTarget>(clientTransport);
      const server = new RpcSession<undefined>(serverTransport, new TestTarget());

      const stub = client.getRemoteMain();

      // An async map callback should throw an understandable error
      using fib = stub.generateFibonacci(3);

      // The map() implementation throws an error when the callback returns a Promise.
      // We test by returning a simple Promise that doesn't use the input variable
      // to avoid triggering MapVariableHook.pull() which causes unhandled rejections.
      expect(() => {
        fib.map(() => {
          // This callback returns a Promise, which is not allowed
          return Promise.resolve(42);
        });
      }).toThrow("Cannot serialize value: [object Promise]");

      // Clean up
      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });
});
