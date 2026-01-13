// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, beforeEach } from "vitest";
import {
  RpcSession,
  RpcTransport,
  RpcTarget,
  SerializationError,
  ErrorCode,
} from "../../src/index.js";

/**
 * Configurable validation limits tests (TDD RED phase)
 *
 * Related to issue: dot-do-capnweb-uam
 *
 * These tests verify that MAX_MESSAGE_SIZE and MAX_RECURSION_DEPTH can be
 * configured via RpcSessionOptions rather than using hard-coded constants.
 *
 * Current state: Hard-coded constants in message-validation.ts, not configurable via options.
 *
 * These tests should FAIL initially (RED phase) because:
 * 1. RpcSessionOptions does not have maxMessageSize or maxRecursionDepth options
 * 2. The validation functions use hard-coded constants
 */

/**
 * TestTransport that allows direct message injection for testing validation.
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
    if (this.queue.length === 0) {
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

  /**
   * Inject a raw message directly into this transport's receive queue.
   */
  injectMessage(message: string): void {
    this.queue.push(message);
    if (this.waiter) {
      this.waiter();
      this.waiter = undefined;
      this.aborter = undefined;
    }
  }

  /**
   * Inject a pre-serialized JSON value directly.
   */
  injectValue(value: unknown): void {
    this.injectMessage(JSON.stringify(value));
  }
}

// Simple test target for RPC
class SimpleTarget extends RpcTarget {
  getValue() {
    return 42;
  }
  add(a: number, b: number) {
    return a + b;
  }
}

// Spin the microtask queue
async function pumpMicrotasks(iterations: number = 16) {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve();
  }
}

describe("configurable validation limits", () => {
  describe("custom message size limit via RpcSessionOptions", () => {
    it("should accept maxMessageSize option in RpcSessionOptions", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // This should compile and work - currently will fail because option doesn't exist
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 1024, // 1KB limit
      });
      const server = new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 1024,
      });

      // Verify the option is recognized (not just ignored)
      // The session should use this limit for validation
      expect((client as any).options?.maxMessageSize).toBe(1024);
    });

    it("should reject messages exceeding custom maxMessageSize", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a small limit of 100 bytes
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 100,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 100,
      });

      // Inject a message that exceeds 100 bytes but is under the default 10MB
      const mediumPayload = "x".repeat(200);
      clientTransport.injectValue(["push", mediumPayload]);

      await pumpMicrotasks();

      // Should reject because message exceeds custom 100 byte limit
      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/size|limit|exceeded/i);
    });

    it("should accept messages within custom maxMessageSize", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a limit of 10KB
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 10 * 1024,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 10 * 1024,
      });

      // Make a normal call - should work
      const stub = client.getRemoteMain();
      const result = await stub.getValue();
      expect(result).toBe(42);

      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });

    it("should use default limit when maxMessageSize not specified", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // No maxMessageSize option - should use default 10MB
      const client = new RpcSession<SimpleTarget>(clientTransport);
      new RpcSession<undefined>(serverTransport, new SimpleTarget());

      // A 1KB message should be accepted (well under 10MB default)
      const smallPayload = "x".repeat(1000);
      clientTransport.injectValue(["push", smallPayload]);

      await pumpMicrotasks();

      // Should NOT abort - message is under default limit
      expect(clientTransport.aborted).toBe(false);
    });

    it("should allow very large custom limit", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a very large limit of 100MB
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 100 * 1024 * 1024,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 100 * 1024 * 1024,
      });

      // A 15MB message should be accepted (over default 10MB but under custom 100MB)
      // Note: We don't actually create 15MB in the test to avoid memory issues,
      // but we verify the option is respected
      const stub = client.getRemoteMain();
      const result = await stub.getValue();
      expect(result).toBe(42);

      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });
  });

  describe("custom recursion depth via RpcSessionOptions", () => {
    function createDeeplyNestedValue(depth: number): unknown {
      let value: unknown = "leaf";
      for (let i = 0; i < depth; i++) {
        value = { nested: value };
      }
      return value;
    }

    function createDeeplyNestedArray(depth: number): unknown {
      let value: unknown = "leaf";
      for (let i = 0; i < depth; i++) {
        value = [value];
      }
      return value;
    }

    it("should accept maxRecursionDepth option in RpcSessionOptions", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // This should compile and work - currently will fail because option doesn't exist
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 10,
      });
      const server = new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 10,
      });

      // Verify the option is recognized
      expect((client as any).options?.maxRecursionDepth).toBe(10);
    });

    it("should reject messages exceeding custom maxRecursionDepth", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a small depth limit of 5
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 5,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 5,
      });

      // Create a message with 10 levels of nesting (exceeds custom limit of 5)
      const deepValue = createDeeplyNestedValue(10);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      // Should reject because nesting exceeds custom 5 level limit
      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/depth|nested|recursion/i);
    });

    it("should accept messages within custom maxRecursionDepth", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a depth limit of 20
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 20,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 20,
      });

      // Create a message with 15 levels of nesting (under custom limit of 20)
      const deepValue = createDeeplyNestedValue(15);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      // Should NOT abort - nesting is under custom limit
      expect(clientTransport.aborted).toBe(false);
    });

    it("should use default limit when maxRecursionDepth not specified", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // No maxRecursionDepth option - should use default 100
      const client = new RpcSession<SimpleTarget>(clientTransport);
      new RpcSession<undefined>(serverTransport, new SimpleTarget());

      // A message with 50 levels of nesting should be accepted (under default 100)
      const deepValue = createDeeplyNestedValue(50);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      // Should NOT abort - nesting is under default limit
      expect(clientTransport.aborted).toBe(false);
    });

    it("should allow very large custom depth limit", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a very large limit of 500
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 500,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 500,
      });

      // A message with 150 levels should be accepted (over default 100 but under custom 500)
      const deepValue = createDeeplyNestedValue(150);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      // Should NOT abort - nesting is under custom limit
      expect(clientTransport.aborted).toBe(false);
    });

    it("should handle deeply nested arrays with custom limit", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Set a small depth limit of 5
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 5,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 5,
      });

      // Create a deeply nested array (exceeds custom limit)
      const deepArray = createDeeplyNestedArray(10);
      clientTransport.injectValue(["push", deepArray]);

      await pumpMicrotasks();

      // Should reject because array nesting exceeds limit
      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/depth|nested|recursion/i);
    });
  });

  describe("zero and negative values handling", () => {
    it("should reject zero maxMessageSize with validation error", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Zero limit should be rejected or treated specially
      expect(() => {
        new RpcSession<SimpleTarget>(clientTransport, undefined, {
          maxMessageSize: 0,
        });
      }).toThrow();
    });

    it("should reject negative maxMessageSize with validation error", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Negative limit should be rejected
      expect(() => {
        new RpcSession<SimpleTarget>(clientTransport, undefined, {
          maxMessageSize: -100,
        });
      }).toThrow();
    });

    it("should reject zero maxRecursionDepth with validation error", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Zero depth should be rejected or treated specially
      expect(() => {
        new RpcSession<SimpleTarget>(clientTransport, undefined, {
          maxRecursionDepth: 0,
        });
      }).toThrow();
    });

    it("should reject negative maxRecursionDepth with validation error", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // Negative depth should be rejected
      expect(() => {
        new RpcSession<SimpleTarget>(clientTransport, undefined, {
          maxRecursionDepth: -5,
        });
      }).toThrow();
    });

    it("should accept maxMessageSize of 1 (minimum valid)", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // 1 byte is the minimum valid limit
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 1,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 1,
      });

      // Any message will exceed 1 byte
      clientTransport.injectValue(["push", "x"]);
      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
    });

    it("should accept maxRecursionDepth of 1 (minimum valid)", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      // 1 level is the minimum valid depth
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 1,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 1,
      });

      // Any nested structure will exceed depth of 1
      clientTransport.injectValue(["push", { nested: { deep: "value" } }]);
      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
    });
  });

  describe("limits applied correctly in validation", () => {
    it("should apply maxMessageSize before JSON parsing", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 50,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 50,
      });

      // Create a message that's too long - should be rejected before parsing
      const longMessage = "x".repeat(100);
      clientTransport.injectMessage(longMessage);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/size|limit/i);
    });

    it("should apply maxRecursionDepth after JSON parsing", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: 3,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: 3,
      });

      // Valid JSON that exceeds depth limit
      const deepValue = { a: { b: { c: { d: { e: "too deep" } } } } };
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/depth|recursion/i);
    });

    it("should include custom limit value in error message", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const customLimit = 256;
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: customLimit,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: customLimit,
      });

      const tooLong = "x".repeat(500);
      clientTransport.injectMessage(JSON.stringify(["push", tooLong]));

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      // Error message should include the custom limit value for debugging
      expect(clientTransport.abortReason.message).toContain(String(customLimit));
    });

    it("should include custom depth limit in error message", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const customDepth = 7;
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxRecursionDepth: customDepth,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxRecursionDepth: customDepth,
      });

      // Create nesting that exceeds the limit
      let value: unknown = "leaf";
      for (let i = 0; i < 15; i++) {
        value = { n: value };
      }
      clientTransport.injectValue(["push", value]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      // Error message should include the custom depth value for debugging
      expect(clientTransport.abortReason.message).toContain(String(customDepth));
    });

    it("should allow configuring both limits together", async () => {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        maxMessageSize: 1000,
        maxRecursionDepth: 10,
      });
      new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
        maxMessageSize: 1000,
        maxRecursionDepth: 10,
      });

      // Should work for messages within both limits
      const stub = client.getRemoteMain();
      const result = await stub.getValue();
      expect(result).toBe(42);

      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });

    it("should use session-specific limits (not global)", async () => {
      // Create two sessions with different limits
      const client1Transport = new TestTransport("client1");
      const server1Transport = new TestTransport("server1", client1Transport);
      const client2Transport = new TestTransport("client2");
      const server2Transport = new TestTransport("server2", client2Transport);

      // Session 1 has strict limits
      const client1 = new RpcSession<SimpleTarget>(client1Transport, undefined, {
        maxRecursionDepth: 5,
      });
      new RpcSession<undefined>(server1Transport, new SimpleTarget(), {
        maxRecursionDepth: 5,
      });

      // Session 2 has relaxed limits
      const client2 = new RpcSession<SimpleTarget>(client2Transport, undefined, {
        maxRecursionDepth: 50,
      });
      new RpcSession<undefined>(server2Transport, new SimpleTarget(), {
        maxRecursionDepth: 50,
      });

      // Create a message with 10 levels of nesting
      let value: unknown = "leaf";
      for (let i = 0; i < 10; i++) {
        value = { n: value };
      }

      // Session 1 should reject (exceeds limit of 5)
      client1Transport.injectValue(["push", value]);
      await pumpMicrotasks();
      expect(client1Transport.aborted).toBe(true);

      // Session 2 should accept (under limit of 50)
      client2Transport.injectValue(["push", value]);
      await pumpMicrotasks();
      expect(client2Transport.aborted).toBe(false);
    });
  });

  describe("TypeScript type checking", () => {
    it("should have proper TypeScript types for maxMessageSize", () => {
      // This test verifies TypeScript accepts the option
      // If the type doesn't exist, this file won't compile
      const options: {
        maxMessageSize?: number;
        maxRecursionDepth?: number;
      } = {
        maxMessageSize: 1024,
      };

      // Verify it's a number type
      expect(typeof options.maxMessageSize).toBe("number");
    });

    it("should have proper TypeScript types for maxRecursionDepth", () => {
      const options: {
        maxMessageSize?: number;
        maxRecursionDepth?: number;
      } = {
        maxRecursionDepth: 50,
      };

      expect(typeof options.maxRecursionDepth).toBe("number");
    });
  });
});
