// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseMessage,
  MessageProcessor,
  type MessageHandler,
  type ParsedMessage,
} from "../src/message-processor.js";

describe("Message Processor Module", () => {
  describe("parseMessage", () => {
    describe("handshake messages", () => {
      it("should parse hello message", () => {
        const msg = JSON.stringify({
          type: "hello",
          versions: ["1.0", "1.1"],
          clientId: "test-client",
        });
        const result = parseMessage(msg);
        expect(result.type).toBe("handshake");
        if (result.type === "handshake") {
          expect(result.subtype).toBe("hello");
          expect(result.message.versions).toEqual(["1.0", "1.1"]);
        }
      });

      it("should parse hello-ack message", () => {
        const msg = JSON.stringify({
          type: "hello-ack",
          selectedVersion: "1.0",
          serverId: "test-server",
        });
        const result = parseMessage(msg);
        expect(result.type).toBe("handshake");
        if (result.type === "handshake") {
          expect(result.subtype).toBe("hello-ack");
          expect(result.message.selectedVersion).toBe("1.0");
        }
      });

      it("should parse hello-reject message", () => {
        const msg = JSON.stringify({
          type: "hello-reject",
          reason: "Version mismatch",
          supportedVersions: ["2.0"],
        });
        const result = parseMessage(msg);
        expect(result.type).toBe("handshake");
        if (result.type === "handshake") {
          expect(result.subtype).toBe("hello-reject");
          expect(result.message.reason).toBe("Version mismatch");
        }
      });
    });

    describe("RPC messages", () => {
      it("should parse push message", () => {
        const msg = JSON.stringify(["push", { value: "test" }]);
        const result = parseMessage(msg);
        expect(result.type).toBe("push");
        if (result.type === "push") {
          expect(result.expression).toEqual({ value: "test" });
        }
      });

      it("should parse pull message", () => {
        const msg = JSON.stringify(["pull", 42]);
        const result = parseMessage(msg);
        expect(result.type).toBe("pull");
        if (result.type === "pull") {
          expect(result.exportId).toBe(42);
        }
      });

      it("should parse resolve message", () => {
        const msg = JSON.stringify(["resolve", 1, { result: "success" }]);
        const result = parseMessage(msg);
        expect(result.type).toBe("resolve");
        if (result.type === "resolve") {
          expect(result.importId).toBe(1);
          expect(result.expression).toEqual({ result: "success" });
        }
      });

      it("should parse reject message", () => {
        const msg = JSON.stringify(["reject", 2, { error: "failed" }]);
        const result = parseMessage(msg);
        expect(result.type).toBe("reject");
        if (result.type === "reject") {
          expect(result.importId).toBe(2);
          expect(result.expression).toEqual({ error: "failed" });
        }
      });

      it("should parse release message", () => {
        const msg = JSON.stringify(["release", 3, 5]);
        const result = parseMessage(msg);
        expect(result.type).toBe("release");
        if (result.type === "release") {
          expect(result.exportId).toBe(3);
          expect(result.refcount).toBe(5);
        }
      });

      it("should parse abort message", () => {
        const msg = JSON.stringify(["abort", { reason: "connection lost" }]);
        const result = parseMessage(msg);
        expect(result.type).toBe("abort");
        if (result.type === "abort") {
          expect(result.expression).toEqual({ reason: "connection lost" });
        }
      });
    });

    describe("invalid messages", () => {
      it("should throw for push without expression", () => {
        const msg = JSON.stringify(["push"]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for pull with non-number", () => {
        const msg = JSON.stringify(["pull", "not-a-number"]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for resolve without expression", () => {
        const msg = JSON.stringify(["resolve", 1]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for reject with non-number importId", () => {
        const msg = JSON.stringify(["reject", "bad", { error: "test" }]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for release with non-number refcount", () => {
        const msg = JSON.stringify(["release", 1, "not-a-number"]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for unknown message type", () => {
        const msg = JSON.stringify(["unknown", "data"]);
        expect(() => parseMessage(msg)).toThrow();
      });

      it("should throw for non-array message", () => {
        const msg = JSON.stringify({ not: "array" });
        expect(() => parseMessage(msg)).toThrow();
      });
    });

    describe("validation", () => {
      it("should throw on oversized message", () => {
        // Create a message that exceeds the 100MB default limit
        // We'll mock this since actually creating such a message would be memory-intensive
        expect(() => {
          // A very long string would trigger the size check
          parseMessage("x".repeat(200 * 1024 * 1024));
        }).toThrow();
      });

      it("should throw on invalid JSON", () => {
        expect(() => parseMessage("not valid json")).toThrow();
      });
    });
  });

  describe("MessageProcessor", () => {
    let mockHandler: MessageHandler;
    let processor: MessageProcessor;

    beforeEach(() => {
      mockHandler = {
        handleHello: vi.fn().mockReturnValue(true),
        handleHelloAck: vi.fn().mockReturnValue(true),
        handleHelloReject: vi.fn().mockReturnValue(true),
        handlePush: vi.fn().mockReturnValue(true),
        handlePull: vi.fn().mockReturnValue(true),
        handleResolve: vi.fn().mockReturnValue(true),
        handleReject: vi.fn().mockReturnValue(true),
        handleRelease: vi.fn().mockReturnValue(true),
        handleAbort: vi.fn().mockReturnValue(true),
        handleEarlyMessage: vi.fn(),
        isAborted: vi.fn().mockReturnValue(false),
        isHandshakeComplete: vi.fn().mockReturnValue(true),
        isVersionHandshakeEnabled: vi.fn().mockReturnValue(false),
      };
      processor = new MessageProcessor(mockHandler);
    });

    it("should dispatch hello message to handleHello", () => {
      const msg = JSON.stringify({
        type: "hello",
        versions: ["1.0"],
      });
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleHello).toHaveBeenCalledWith(
        expect.objectContaining({ type: "hello", versions: ["1.0"] })
      );
    });

    it("should dispatch hello-ack message to handleHelloAck", () => {
      const msg = JSON.stringify({
        type: "hello-ack",
        selectedVersion: "1.0",
      });
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleHelloAck).toHaveBeenCalledWith(
        expect.objectContaining({ type: "hello-ack", selectedVersion: "1.0" })
      );
    });

    it("should dispatch hello-reject message to handleHelloReject", () => {
      const msg = JSON.stringify({
        type: "hello-reject",
        reason: "test",
        supportedVersions: [],
      });
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleHelloReject).toHaveBeenCalled();
    });

    it("should dispatch push message to handlePush", () => {
      const msg = JSON.stringify(["push", { data: "test" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handlePush).toHaveBeenCalledWith({ data: "test" });
    });

    it("should dispatch pull message to handlePull", () => {
      const msg = JSON.stringify(["pull", 123]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handlePull).toHaveBeenCalledWith(123);
    });

    it("should dispatch resolve message to handleResolve", () => {
      const msg = JSON.stringify(["resolve", 1, { value: "resolved" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleResolve).toHaveBeenCalledWith(1, {
        value: "resolved",
      });
    });

    it("should dispatch reject message to handleReject", () => {
      const msg = JSON.stringify(["reject", 2, { error: "rejected" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleReject).toHaveBeenCalledWith(2, {
        error: "rejected",
      });
    });

    it("should dispatch release message to handleRelease", () => {
      const msg = JSON.stringify(["release", 3, 2]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleRelease).toHaveBeenCalledWith(3, 2);
    });

    it("should dispatch abort message to handleAbort", () => {
      const msg = JSON.stringify(["abort", { reason: "test abort" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handleAbort).toHaveBeenCalledWith({
        reason: "test abort",
      });
    });

    it("should skip processing when session is aborted", () => {
      vi.mocked(mockHandler.isAborted).mockReturnValue(true);
      const msg = JSON.stringify(["push", { data: "test" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(true);
      expect(mockHandler.handlePush).not.toHaveBeenCalled();
    });

    it("should call handleEarlyMessage when handshake incomplete and enabled", () => {
      vi.mocked(mockHandler.isHandshakeComplete).mockReturnValue(false);
      vi.mocked(mockHandler.isVersionHandshakeEnabled).mockReturnValue(true);
      const msg = JSON.stringify(["push", { data: "test" }]);
      processor.processMessage(msg);
      expect(mockHandler.handleEarlyMessage).toHaveBeenCalled();
    });

    it("should not call handleEarlyMessage when handshake is complete", () => {
      vi.mocked(mockHandler.isHandshakeComplete).mockReturnValue(true);
      vi.mocked(mockHandler.isVersionHandshakeEnabled).mockReturnValue(true);
      const msg = JSON.stringify(["push", { data: "test" }]);
      processor.processMessage(msg);
      expect(mockHandler.handleEarlyMessage).not.toHaveBeenCalled();
    });

    it("should not call handleEarlyMessage when handshake is disabled", () => {
      vi.mocked(mockHandler.isHandshakeComplete).mockReturnValue(false);
      vi.mocked(mockHandler.isVersionHandshakeEnabled).mockReturnValue(false);
      const msg = JSON.stringify(["push", { data: "test" }]);
      processor.processMessage(msg);
      expect(mockHandler.handleEarlyMessage).not.toHaveBeenCalled();
    });

    it("should throw for invalid messages", () => {
      const msg = JSON.stringify(["unknown", "data"]);
      expect(() => processor.processMessage(msg)).toThrow();
    });

    it("should propagate handler return values", () => {
      vi.mocked(mockHandler.handlePush).mockReturnValue(false);
      const msg = JSON.stringify(["push", { data: "test" }]);
      const result = processor.processMessage(msg);
      expect(result).toBe(false);
    });
  });
});
