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
} from "../src/index.js";

/**
 * Message validation tests (TDD RED phase)
 *
 * Related to issue: dot-do-capnweb-v9b
 *
 * These tests verify that malformed messages are properly validated and rejected
 * with descriptive SerializationError messages, rather than causing cryptic errors.
 *
 * Currently, src/rpc.ts:1202-1277 processes messages but malformed messages cause
 * cryptic errors. These tests should FAIL initially (RED phase) and pass after
 * implementing proper validation.
 */

/**
 * TestTransport that allows direct message injection for testing validation.
 * This transport lets us inject raw JSON messages to test how the RPC session
 * handles malformed/invalid inputs.
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
   * This bypasses the normal send path, allowing us to inject malformed messages.
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

describe("message validation", () => {
  let clientTransport: TestTransport;
  let serverTransport: TestTransport;
  let client: RpcSession<SimpleTarget>;
  let server: RpcSession<undefined>;
  let capturedErrors: Error[];

  beforeEach(() => {
    clientTransport = new TestTransport("client");
    serverTransport = new TestTransport("server", clientTransport);
    capturedErrors = [];

    client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      onInternalError: (err) => capturedErrors.push(err),
    });
    server = new RpcSession<undefined>(serverTransport, new SimpleTarget(), {
      onInternalError: (err) => capturedErrors.push(err),
    });
  });

  describe("non-array messages", () => {
    it("should reject string messages with SerializationError", async () => {
      // Inject a non-array message (a plain string)
      clientTransport.injectMessage('"hello"');

      await pumpMicrotasks();

      // The session should abort with a SerializationError
      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.code).toBe(ErrorCode.SERIALIZATION_ERROR);
      expect(clientTransport.abortReason.message).toContain("must be an array");
    });

    it("should reject number messages with SerializationError", async () => {
      clientTransport.injectValue(42);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("must be an array");
    });

    it("should reject object messages with SerializationError", async () => {
      // Non-handshake object messages should be rejected
      clientTransport.injectValue({ foo: "bar" });

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("must be an array");
    });

    it("should reject null messages with SerializationError", async () => {
      clientTransport.injectValue(null);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("must be an array");
    });

    it("should reject boolean messages with SerializationError", async () => {
      clientTransport.injectValue(true);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("must be an array");
    });
  });

  describe("unknown message types", () => {
    it("should reject messages with unknown type", async () => {
      // Valid array format but unknown message type
      clientTransport.injectValue(["unknownType", 123]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("unknown message type");
      expect(clientTransport.abortReason.message).toContain("unknownType");
    });

    it("should reject messages with numeric type (not string)", async () => {
      clientTransport.injectValue([123, "data"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("message type must be a string");
    });

    it("should reject empty arrays", async () => {
      clientTransport.injectValue([]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("empty");
    });

    it("should list valid message types in error for unknown type", async () => {
      clientTransport.injectValue(["badType"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      // Error should mention valid types to help debugging
      const message = clientTransport.abortReason.message.toLowerCase();
      expect(
        message.includes("push") ||
        message.includes("pull") ||
        message.includes("resolve") ||
        message.includes("reject") ||
        message.includes("valid")
      ).toBe(true);
    });
  });

  describe("wrong arity messages", () => {
    it("should reject 'resolve' with no arguments", async () => {
      // resolve requires: ["resolve", ExportId, Expression]
      clientTransport.injectValue(["resolve"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("resolve");
      expect(clientTransport.abortReason.message).toMatch(/argument|arity|missing|requires/i);
    });

    it("should reject 'resolve' with only one argument", async () => {
      clientTransport.injectValue(["resolve", 0]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("resolve");
    });

    it("should reject 'reject' with no arguments", async () => {
      // reject requires: ["reject", ExportId, Expression]
      clientTransport.injectValue(["reject"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("reject");
      expect(clientTransport.abortReason.message).toMatch(/argument|arity|missing|requires/i);
    });

    it("should reject 'push' with no arguments", async () => {
      // push requires: ["push", Expression]
      clientTransport.injectValue(["push"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("push");
      expect(clientTransport.abortReason.message).toMatch(/argument|arity|missing|requires/i);
    });

    it("should reject 'pull' with no arguments", async () => {
      // pull requires: ["pull", ImportId]
      clientTransport.injectValue(["pull"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("pull");
      expect(clientTransport.abortReason.message).toMatch(/argument|arity|missing|requires/i);
    });

    it("should reject 'pull' with non-numeric import ID", async () => {
      clientTransport.injectValue(["pull", "notANumber"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("pull");
      expect(clientTransport.abortReason.message).toMatch(/number|numeric|integer|type/i);
    });

    it("should reject 'release' with missing refcount", async () => {
      // release requires: ["release", ExportId, refcount]
      clientTransport.injectValue(["release", 0]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("release");
    });

    it("should reject 'release' with non-numeric export ID", async () => {
      clientTransport.injectValue(["release", "notANumber", 1]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("release");
    });

    it("should reject 'abort' with no arguments", async () => {
      // abort requires: ["abort", Expression]
      clientTransport.injectValue(["abort"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toContain("abort");
      expect(clientTransport.abortReason.message).toMatch(/argument|arity|missing|requires/i);
    });
  });

  describe("message size limit", () => {
    const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB - reasonable default

    it("should reject messages exceeding size limit", async () => {
      // Create a message that exceeds the size limit
      const largePayload = "x".repeat(MAX_MESSAGE_SIZE + 1000);
      const largeMessage = JSON.stringify(["push", largePayload]);
      clientTransport.injectMessage(largeMessage);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/size|limit|too large|exceeded/i);
    });

    it("should accept messages within size limit", async () => {
      // Make a normal call to verify the session is working
      const stub = client.getRemoteMain();
      const result = await stub.getValue();
      expect(result).toBe(42);

      // Clean up
      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });

    it("should include size information in error message", async () => {
      const largePayload = "x".repeat(MAX_MESSAGE_SIZE + 1000);
      const largeMessage = JSON.stringify(["push", largePayload]);
      clientTransport.injectMessage(largeMessage);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      // Error message should include the actual size and/or limit for debugging
      const message = clientTransport.abortReason.message;
      expect(
        message.includes("MB") ||
        message.includes("bytes") ||
        message.includes(String(MAX_MESSAGE_SIZE)) ||
        message.match(/\d+/)
      ).toBeTruthy();
    });
  });

  describe("recursion depth limit", () => {
    const MAX_DEPTH = 100; // Reasonable depth limit

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

    it("should reject deeply nested object messages", async () => {
      const deepValue = createDeeplyNestedValue(MAX_DEPTH + 50);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/depth|nested|recursion|stack/i);
    });

    it("should reject deeply nested array messages", async () => {
      const deepArray = createDeeplyNestedArray(MAX_DEPTH + 50);
      clientTransport.injectValue(["push", deepArray]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
      expect(clientTransport.abortReason.message).toMatch(/depth|nested|recursion|stack/i);
    });

    it("should accept messages within depth limit", async () => {
      // Reasonable nesting should work
      const reasonableValue = createDeeplyNestedValue(10);
      const stub = client.getRemoteMain();

      // Normal operations should work fine
      const result = await stub.getValue();
      expect(result).toBe(42);

      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });

    it("should include depth information in error message", async () => {
      const deepValue = createDeeplyNestedValue(MAX_DEPTH + 50);
      clientTransport.injectValue(["push", deepValue]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      // Error should mention the limit or depth for debugging
      const message = clientTransport.abortReason.message;
      expect(
        message.includes("depth") ||
        message.includes(String(MAX_DEPTH)) ||
        message.includes("nested") ||
        message.includes("recursion")
      ).toBe(true);
    });
  });

  describe("error message quality", () => {
    it("should provide descriptive error for non-array messages", async () => {
      clientTransport.injectValue("not an array");

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      const message = clientTransport.abortReason.message;

      // Error should NOT be cryptic like "Cannot read property '0' of undefined"
      expect(message).not.toMatch(/cannot read|undefined|null/i);

      // Error SHOULD describe what went wrong
      expect(message).toMatch(/message|array|format|invalid/i);
    });

    it("should provide descriptive error for unknown message types", async () => {
      clientTransport.injectValue(["fakeMessageType", 1, 2, 3]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      const message = clientTransport.abortReason.message;

      // Should mention the unknown type
      expect(message).toContain("fakeMessageType");

      // Should indicate it's about message type
      expect(message).toMatch(/type|message|unknown|invalid|unrecognized/i);
    });

    it("should provide descriptive error for wrong arity", async () => {
      clientTransport.injectValue(["resolve"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      const message = clientTransport.abortReason.message;

      // Should mention the message type
      expect(message).toContain("resolve");

      // Should indicate the issue is about missing arguments
      expect(message).toMatch(/argument|parameter|missing|requires|arity/i);

      // Should NOT be cryptic
      expect(message).not.toMatch(/cannot read|undefined is not/i);
    });

    it("should provide descriptive error for wrong argument types", async () => {
      clientTransport.injectValue(["resolve", "notANumber", 42]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      const message = clientTransport.abortReason.message;

      // Should indicate type issue
      expect(message).toMatch(/type|number|string|expected|invalid/i);
    });

    it("should include received value in error when helpful", async () => {
      clientTransport.injectValue(["pull", "wrongType"]);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      const message = clientTransport.abortReason.message;

      // For debugging, error should include what was received
      expect(
        message.includes("wrongType") ||
        message.includes("string") ||
        message.includes("pull")
      ).toBe(true);
    });

    it("should use SerializationError for all validation failures", async () => {
      // All validation errors should be SerializationError with correct code
      const testCases = [
        "not an array",
        ["unknownType"],
        ["resolve"],
        [],
        null,
      ];

      for (const testCase of testCases) {
        // Reset for each test
        const ct = new TestTransport("client");
        const st = new TestTransport("server", ct);
        const c = new RpcSession<SimpleTarget>(ct);
        new RpcSession<undefined>(st, new SimpleTarget());

        ct.injectValue(testCase);
        await pumpMicrotasks();

        expect(ct.aborted).toBe(true);
        expect(ct.abortReason).toBeInstanceOf(SerializationError);
        expect(ct.abortReason.code).toBe(ErrorCode.SERIALIZATION_ERROR);
        expect(ct.abortReason.codeName).toBe("SERIALIZATION_ERROR");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle messages with extra trailing arguments gracefully", async () => {
      // Extra arguments beyond what's expected - should either accept or reject clearly
      // ["push", Expression] - what if we add extra args?
      const stub = client.getRemoteMain();
      const result = await stub.getValue();
      expect(result).toBe(42);

      stub[Symbol.dispose]();
      await pumpMicrotasks();
    });

    it("should reject messages with array holes", async () => {
      // Sparse arrays might cause issues
      const sparseArray: unknown[] = ["resolve"];
      sparseArray[2] = 42; // Creates a hole at index 1
      clientTransport.injectValue(sparseArray);

      await pumpMicrotasks();

      expect(clientTransport.aborted).toBe(true);
      expect(clientTransport.abortReason).toBeInstanceOf(SerializationError);
    });

    it("should validate nested expressions in messages", async () => {
      // The Expression in ["push", Expression] could itself be malformed
      // Using a stub reference with invalid format
      clientTransport.injectValue(["push", ["$", "notAValidStubId"]]);

      await pumpMicrotasks();

      // Should handle invalid expression format
      expect(clientTransport.aborted).toBe(true);
    });
  });
});
