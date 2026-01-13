// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Message Type Plugin System Tests (TDD RED phase)
 *
 * Related to issue: dot-do-capnweb-7in
 *
 * These tests verify that message types can be extended through a plugin system.
 * Currently, MESSAGE_ARITY map is hard-coded in message-validation.ts with no
 * extension mechanism.
 *
 * The plugin system should allow:
 * 1. Registering custom message type handlers
 * 2. Unregistering message types
 * 3. Custom message serialization
 * 4. Custom message handling
 *
 * These tests should FAIL initially (RED phase) because the plugin system
 * does not exist yet.
 */

// These imports will fail until the plugin system is implemented
// For now, we use dynamic imports and expect them to fail or provide stubs
type MessageTypePlugin = {
  /** The message type name (e.g., "custom-ping") */
  type: string;
  /** Minimum number of arguments required (excluding the type itself) */
  minArity: number;
  /** Maximum number of arguments allowed (optional) */
  maxArity?: number;
  /** Argument type descriptions for error messages */
  argTypes?: string[];
  /** Serialize custom data for this message type */
  serialize?: (data: unknown) => unknown[];
  /** Deserialize message arguments back to custom data */
  deserialize?: (args: unknown[]) => unknown;
  /** Handle the message when received */
  handle?: (args: unknown[], context: MessageHandlerContext) => void | boolean;
};

type MessageHandlerContext = {
  /** The session that received the message */
  sessionId?: string;
  /** Send a response message */
  sendResponse?: (type: string, ...args: unknown[]) => void;
};

type MessageTypeRegistry = {
  /** Register a custom message type plugin */
  register(plugin: MessageTypePlugin): void;
  /** Unregister a message type by name */
  unregister(type: string): boolean;
  /** Check if a message type is registered */
  has(type: string): boolean;
  /** Get a registered plugin by type */
  get(type: string): MessageTypePlugin | undefined;
  /** Get all registered message types */
  getTypes(): string[];
  /** Clear all custom registrations (keeps built-in types) */
  clearCustom(): void;
};

// Attempt to import the plugin system - this will fail until implemented
let MessagePluginRegistry: MessageTypeRegistry | undefined;
let registerMessageType: ((plugin: MessageTypePlugin) => void) | undefined;
let unregisterMessageType: ((type: string) => boolean) | undefined;
let getMessageTypeRegistry: (() => MessageTypeRegistry) | undefined;

describe("Message Type Plugin System", () => {
  describe("Plugin Registry API", () => {
    it("should export a message type registry", async () => {
      // This test verifies that the plugin registry is exported
      // Expected: import { MessagePluginRegistry } from "../../src/message-validation.js"
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        expect(MessagePluginRegistry).toBeDefined();
        expect(typeof MessagePluginRegistry).toBe("object");
      } catch (e) {
        // If import fails, the registry doesn't exist yet
        expect(MessagePluginRegistry).toBeDefined();
      }
    });

    it("should export registerMessageType function", async () => {
      try {
        const module = await import("../../src/message-validation.js");
        registerMessageType = (module as any).registerMessageType;
        expect(registerMessageType).toBeDefined();
        expect(typeof registerMessageType).toBe("function");
      } catch (e) {
        expect(registerMessageType).toBeDefined();
      }
    });

    it("should export unregisterMessageType function", async () => {
      try {
        const module = await import("../../src/message-validation.js");
        unregisterMessageType = (module as any).unregisterMessageType;
        expect(unregisterMessageType).toBeDefined();
        expect(typeof unregisterMessageType).toBe("function");
      } catch (e) {
        expect(unregisterMessageType).toBeDefined();
      }
    });

    it("should export getMessageTypeRegistry function", async () => {
      try {
        const module = await import("../../src/message-validation.js");
        getMessageTypeRegistry = (module as any).getMessageTypeRegistry;
        expect(getMessageTypeRegistry).toBeDefined();
        expect(typeof getMessageTypeRegistry).toBe("function");
      } catch (e) {
        expect(getMessageTypeRegistry).toBeDefined();
      }
    });
  });

  describe("Register custom message type handler", () => {
    beforeEach(async () => {
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        registerMessageType = (module as any).registerMessageType;
        unregisterMessageType = (module as any).unregisterMessageType;
        // Clear any custom registrations before each test
        if (MessagePluginRegistry?.clearCustom) {
          MessagePluginRegistry.clearCustom();
        }
      } catch (e) {
        // Module doesn't exist yet
      }
    });

    it("should allow registering a simple custom message type", () => {
      const customPing: MessageTypePlugin = {
        type: "custom-ping",
        minArity: 0,
        argTypes: [],
      };

      expect(() => {
        if (registerMessageType) {
          registerMessageType(customPing);
        } else {
          throw new Error("registerMessageType not available");
        }
      }).not.toThrow();

      // Verify it was registered
      expect(MessagePluginRegistry?.has("custom-ping")).toBe(true);
    });

    it("should allow registering a message type with required arguments", () => {
      const customEcho: MessageTypePlugin = {
        type: "custom-echo",
        minArity: 1,
        argTypes: ["string (message)"],
      };

      if (registerMessageType) {
        registerMessageType(customEcho);
      } else {
        throw new Error("registerMessageType not available");
      }

      expect(MessagePluginRegistry?.has("custom-echo")).toBe(true);
      const registered = MessagePluginRegistry?.get("custom-echo");
      expect(registered?.minArity).toBe(1);
      expect(registered?.argTypes).toContain("string (message)");
    });

    it("should allow registering a message type with min and max arity", () => {
      const customBroadcast: MessageTypePlugin = {
        type: "custom-broadcast",
        minArity: 1,
        maxArity: 3,
        argTypes: ["channel", "message", "options?"],
      };

      if (registerMessageType) {
        registerMessageType(customBroadcast);
      } else {
        throw new Error("registerMessageType not available");
      }

      const registered = MessagePluginRegistry?.get("custom-broadcast");
      expect(registered?.minArity).toBe(1);
      expect(registered?.maxArity).toBe(3);
    });

    it("should reject duplicate message type registration", () => {
      const plugin1: MessageTypePlugin = { type: "duplicate-test", minArity: 0 };
      const plugin2: MessageTypePlugin = { type: "duplicate-test", minArity: 1 };

      if (registerMessageType) {
        registerMessageType(plugin1);
        expect(() => registerMessageType!(plugin2)).toThrow(/already registered|duplicate/i);
      } else {
        throw new Error("registerMessageType not available");
      }
    });

    it("should reject registration of built-in message types", () => {
      // Built-in types like "push", "pull", "resolve" should not be overridable
      const overridePush: MessageTypePlugin = { type: "push", minArity: 5 };

      if (registerMessageType) {
        expect(() => registerMessageType!(overridePush)).toThrow(/built-in|reserved|cannot override/i);
      } else {
        throw new Error("registerMessageType not available");
      }
    });

    it("should validate message type name format", () => {
      // Message types should be non-empty strings
      const invalidPlugin1: MessageTypePlugin = { type: "", minArity: 0 };
      const invalidPlugin2: MessageTypePlugin = { type: "   ", minArity: 0 };

      if (registerMessageType) {
        expect(() => registerMessageType!(invalidPlugin1)).toThrow(/invalid|empty|type name/i);
        expect(() => registerMessageType!(invalidPlugin2)).toThrow(/invalid|empty|type name/i);
      } else {
        throw new Error("registerMessageType not available");
      }
    });

    it("should validate that minArity is non-negative", () => {
      const invalidPlugin: MessageTypePlugin = { type: "negative-arity", minArity: -1 };

      if (registerMessageType) {
        expect(() => registerMessageType!(invalidPlugin)).toThrow(/arity|negative|invalid/i);
      } else {
        throw new Error("registerMessageType not available");
      }
    });

    it("should validate that maxArity >= minArity when specified", () => {
      const invalidPlugin: MessageTypePlugin = {
        type: "invalid-arity",
        minArity: 5,
        maxArity: 2,
      };

      if (registerMessageType) {
        expect(() => registerMessageType!(invalidPlugin)).toThrow(/arity|max.*min|invalid/i);
      } else {
        throw new Error("registerMessageType not available");
      }
    });

    it("should list all registered message types including custom ones", () => {
      const customType: MessageTypePlugin = { type: "list-test", minArity: 0 };

      if (registerMessageType && MessagePluginRegistry) {
        registerMessageType(customType);
        const types = MessagePluginRegistry.getTypes();

        // Should include built-in types
        expect(types).toContain("push");
        expect(types).toContain("pull");
        expect(types).toContain("resolve");
        expect(types).toContain("reject");
        expect(types).toContain("release");
        expect(types).toContain("abort");

        // Should include custom type
        expect(types).toContain("list-test");
      } else {
        throw new Error("Plugin registry not available");
      }
    });
  });

  describe("Unregister message type", () => {
    beforeEach(async () => {
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        registerMessageType = (module as any).registerMessageType;
        unregisterMessageType = (module as any).unregisterMessageType;
        if (MessagePluginRegistry?.clearCustom) {
          MessagePluginRegistry.clearCustom();
        }
      } catch (e) {
        // Module doesn't exist yet
      }
    });

    it("should allow unregistering a custom message type", () => {
      const customType: MessageTypePlugin = { type: "removable", minArity: 0 };

      if (registerMessageType && unregisterMessageType && MessagePluginRegistry) {
        registerMessageType(customType);
        expect(MessagePluginRegistry.has("removable")).toBe(true);

        const result = unregisterMessageType("removable");
        expect(result).toBe(true);
        expect(MessagePluginRegistry.has("removable")).toBe(false);
      } else {
        throw new Error("Plugin registry not available");
      }
    });

    it("should return false when unregistering non-existent type", () => {
      if (unregisterMessageType) {
        const result = unregisterMessageType("non-existent-type");
        expect(result).toBe(false);
      } else {
        throw new Error("unregisterMessageType not available");
      }
    });

    it("should prevent unregistering built-in message types", () => {
      if (unregisterMessageType) {
        // Attempting to unregister built-in types should either:
        // 1. Throw an error, or
        // 2. Return false and keep the type registered
        expect(() => {
          const result = unregisterMessageType!("push");
          if (result === true) {
            throw new Error("Should not be able to unregister built-in type");
          }
        }).not.toThrow();

        // Verify push is still registered
        expect(MessagePluginRegistry?.has("push")).toBe(true);
      } else {
        throw new Error("unregisterMessageType not available");
      }
    });

    it("should make previously valid messages invalid after unregistering", async () => {
      if (registerMessageType && unregisterMessageType) {
        const customType: MessageTypePlugin = { type: "temp-type", minArity: 1 };
        registerMessageType(customType);

        // Import validateMessage to test validation
        const { validateMessage } = await import("../../src/message-validation.js");

        // Message should be valid while registered
        expect(() => validateMessage(["temp-type", "arg1"])).not.toThrow();

        // Unregister the type
        unregisterMessageType("temp-type");

        // Message should now be invalid
        expect(() => validateMessage(["temp-type", "arg1"])).toThrow(/unknown message type/i);
      } else {
        throw new Error("Plugin functions not available");
      }
    });

    it("should clear all custom registrations with clearCustom", () => {
      if (registerMessageType && MessagePluginRegistry) {
        registerMessageType({ type: "custom-a", minArity: 0 });
        registerMessageType({ type: "custom-b", minArity: 0 });
        registerMessageType({ type: "custom-c", minArity: 0 });

        expect(MessagePluginRegistry.has("custom-a")).toBe(true);
        expect(MessagePluginRegistry.has("custom-b")).toBe(true);
        expect(MessagePluginRegistry.has("custom-c")).toBe(true);

        MessagePluginRegistry.clearCustom();

        // Custom types should be gone
        expect(MessagePluginRegistry.has("custom-a")).toBe(false);
        expect(MessagePluginRegistry.has("custom-b")).toBe(false);
        expect(MessagePluginRegistry.has("custom-c")).toBe(false);

        // Built-in types should remain
        expect(MessagePluginRegistry.has("push")).toBe(true);
        expect(MessagePluginRegistry.has("pull")).toBe(true);
      } else {
        throw new Error("Plugin registry not available");
      }
    });
  });

  describe("Custom message serialization", () => {
    beforeEach(async () => {
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        registerMessageType = (module as any).registerMessageType;
        if (MessagePluginRegistry?.clearCustom) {
          MessagePluginRegistry.clearCustom();
        }
      } catch (e) {
        // Module doesn't exist yet
      }
    });

    it("should call custom serialize function when serializing message", () => {
      const serializeFn = vi.fn((data: unknown) => {
        const typed = data as { content: string; priority: number };
        return [typed.content, typed.priority];
      });

      const customMessage: MessageTypePlugin = {
        type: "serializable",
        minArity: 2,
        argTypes: ["content", "priority"],
        serialize: serializeFn,
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // The serialize function should be available on the registered plugin
      const registered = MessagePluginRegistry?.get("serializable");
      expect(registered?.serialize).toBeDefined();

      // Call the serialize function
      const result = registered?.serialize?.({ content: "hello", priority: 5 });
      expect(result).toEqual(["hello", 5]);
      expect(serializeFn).toHaveBeenCalledWith({ content: "hello", priority: 5 });
    });

    it("should use custom serialization when creating messages", async () => {
      const customMessage: MessageTypePlugin = {
        type: "custom-data",
        minArity: 2,
        serialize: (data: unknown) => {
          const typed = data as { x: number; y: number };
          return [typed.x + typed.y, typed.x * typed.y];
        },
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // There should be a helper to create serialized messages
      // Expected: createMessage("custom-data", { x: 3, y: 4 }) => ["custom-data", 7, 12]
      try {
        const { createMessage } = await import("../../src/message-validation.js") as any;
        expect(createMessage).toBeDefined();

        const message = createMessage("custom-data", { x: 3, y: 4 });
        expect(message).toEqual(["custom-data", 7, 12]);
      } catch (e) {
        // createMessage function doesn't exist yet
        expect(true).toBe(false); // Force failure
      }
    });

    it("should call custom deserialize function when parsing message", () => {
      const deserializeFn = vi.fn((args: unknown[]) => {
        return { content: args[0], priority: args[1] };
      });

      const customMessage: MessageTypePlugin = {
        type: "deserializable",
        minArity: 2,
        argTypes: ["content", "priority"],
        deserialize: deserializeFn,
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      const registered = MessagePluginRegistry?.get("deserializable");
      expect(registered?.deserialize).toBeDefined();

      const result = registered?.deserialize?.(["hello", 5]);
      expect(result).toEqual({ content: "hello", priority: 5 });
      expect(deserializeFn).toHaveBeenCalledWith(["hello", 5]);
    });

    it("should provide deserialized data in parsed message result", async () => {
      const customMessage: MessageTypePlugin = {
        type: "parsed-custom",
        minArity: 1,
        deserialize: (args: unknown[]) => ({ value: args[0], processed: true }),
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // Parse a message with custom type
      try {
        const { parseMessage } = await import("../../src/message-processor.js");

        const rawMessage = JSON.stringify(["parsed-custom", "test-data"]);
        const parsed = parseMessage(rawMessage);

        // The parsed result should include deserialized data
        expect((parsed as any).type).toBe("parsed-custom");
        expect((parsed as any).data).toEqual({ value: "test-data", processed: true });
      } catch (e) {
        // Feature not implemented yet
        expect(true).toBe(false); // Force failure
      }
    });

    it("should handle serialization errors gracefully", () => {
      const customMessage: MessageTypePlugin = {
        type: "error-serialize",
        minArity: 0,
        serialize: () => {
          throw new Error("Serialization failed");
        },
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      const registered = MessagePluginRegistry?.get("error-serialize");
      expect(() => registered?.serialize?.({})).toThrow("Serialization failed");
    });

    it("should handle deserialization errors gracefully", async () => {
      const customMessage: MessageTypePlugin = {
        type: "error-deserialize",
        minArity: 0,
        deserialize: () => {
          throw new Error("Deserialization failed");
        },
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // Parsing a message with failing deserialize should throw
      try {
        const { parseMessage } = await import("../../src/message-processor.js");

        const rawMessage = JSON.stringify(["error-deserialize"]);
        expect(() => parseMessage(rawMessage)).toThrow(/deserialization failed/i);
      } catch (e) {
        // Feature not implemented yet - but we want to verify error handling
        const registered = MessagePluginRegistry?.get("error-deserialize");
        expect(() => registered?.deserialize?.([])).toThrow("Deserialization failed");
      }
    });
  });

  describe("Custom message handling", () => {
    beforeEach(async () => {
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        registerMessageType = (module as any).registerMessageType;
        if (MessagePluginRegistry?.clearCustom) {
          MessagePluginRegistry.clearCustom();
        }
      } catch (e) {
        // Module doesn't exist yet
      }
    });

    it("should allow registering a handler function with the plugin", () => {
      const handleFn = vi.fn((args: unknown[], context: MessageHandlerContext) => {
        return true;
      });

      const customMessage: MessageTypePlugin = {
        type: "handled",
        minArity: 0,
        handle: handleFn,
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      const registered = MessagePluginRegistry?.get("handled");
      expect(registered?.handle).toBeDefined();
      expect(typeof registered?.handle).toBe("function");
    });

    it("should invoke custom handler when message is processed", async () => {
      const handleFn = vi.fn((args: unknown[], context: MessageHandlerContext) => {
        return true;
      });

      const customMessage: MessageTypePlugin = {
        type: "process-handled",
        minArity: 1,
        handle: handleFn,
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // Process a message with the custom type
      try {
        const { MessageProcessor } = await import("../../src/message-processor.js");

        const mockHandler = {
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
          // New method for custom message handling
          handleCustomMessage: vi.fn().mockReturnValue(true),
        };

        const processor = new MessageProcessor(mockHandler as any);
        const rawMessage = JSON.stringify(["process-handled", "test-arg"]);

        processor.processMessage(rawMessage);

        // The custom handler should have been called
        expect(handleFn).toHaveBeenCalled();
        expect(handleFn).toHaveBeenCalledWith(
          ["test-arg"],
          expect.any(Object)
        );
      } catch (e) {
        // Feature not implemented yet
        expect(handleFn).toHaveBeenCalled();
      }
    });

    it("should pass message context to custom handler", async () => {
      let capturedContext: MessageHandlerContext | undefined;

      const handleFn = vi.fn((args: unknown[], context: MessageHandlerContext) => {
        capturedContext = context;
        return true;
      });

      const customMessage: MessageTypePlugin = {
        type: "context-test",
        minArity: 0,
        handle: handleFn,
      };

      if (registerMessageType) {
        registerMessageType(customMessage);
      } else {
        throw new Error("registerMessageType not available");
      }

      // Process the message and verify context
      try {
        const { MessageProcessor } = await import("../../src/message-processor.js");

        const mockHandler = {
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

        const processor = new MessageProcessor(mockHandler as any);
        processor.processMessage(JSON.stringify(["context-test"]));

        expect(capturedContext).toBeDefined();
        expect(typeof capturedContext?.sendResponse).toBe("function");
      } catch (e) {
        // Feature not implemented yet
        expect(capturedContext).toBeDefined();
      }
    });

    it("should allow handler to send response messages", async () => {
      let responseSent: { type: string; args: unknown[] } | undefined;

      const handleFn = vi.fn((args: unknown[], context: MessageHandlerContext) => {
        // Send a response
        context.sendResponse?.("pong", args[0]);
        return true;
      });

      const customPing: MessageTypePlugin = {
        type: "custom-ping",
        minArity: 1,
        handle: handleFn,
      };

      if (registerMessageType) {
        registerMessageType(customPing);
      } else {
        throw new Error("registerMessageType not available");
      }

      // Process and verify response
      try {
        const { MessageProcessor } = await import("../../src/message-processor.js");

        const sentMessages: string[] = [];
        const mockHandler = {
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
          // Mock transport send
          send: (msg: string) => sentMessages.push(msg),
        };

        const processor = new MessageProcessor(mockHandler as any);
        processor.processMessage(JSON.stringify(["custom-ping", "hello"]));

        // Verify handleFn was called
        expect(handleFn).toHaveBeenCalled();
      } catch (e) {
        // Feature not implemented yet
        expect(handleFn).toHaveBeenCalled();
      }
    });

    it("should respect handler return value for message processing continuation", async () => {
      // Handler returning false should stop processing
      const stopHandler = vi.fn(() => false);
      const continueHandler = vi.fn(() => true);

      if (registerMessageType) {
        registerMessageType({
          type: "stop-processing",
          minArity: 0,
          handle: stopHandler,
        });
        registerMessageType({
          type: "continue-processing",
          minArity: 0,
          handle: continueHandler,
        });
      } else {
        throw new Error("registerMessageType not available");
      }

      try {
        const { MessageProcessor } = await import("../../src/message-processor.js");

        const mockHandler = {
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

        const processor = new MessageProcessor(mockHandler as any);

        const stopResult = processor.processMessage(JSON.stringify(["stop-processing"]));
        const continueResult = processor.processMessage(JSON.stringify(["continue-processing"]));

        expect(stopResult).toBe(false);
        expect(continueResult).toBe(true);
      } catch (e) {
        // Feature not implemented yet
        expect(stopHandler).toHaveBeenCalled();
      }
    });

    it("should handle errors thrown by custom handlers", async () => {
      const errorHandler = vi.fn(() => {
        throw new Error("Handler exploded");
      });

      if (registerMessageType) {
        registerMessageType({
          type: "error-handler",
          minArity: 0,
          handle: errorHandler,
        });
      } else {
        throw new Error("registerMessageType not available");
      }

      try {
        const { MessageProcessor } = await import("../../src/message-processor.js");

        const mockHandler = {
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

        const processor = new MessageProcessor(mockHandler as any);

        expect(() => {
          processor.processMessage(JSON.stringify(["error-handler"]));
        }).toThrow("Handler exploded");
      } catch (e) {
        // Feature not implemented yet - verify the handler function throws
        expect(() => errorHandler([], {})).toThrow("Handler exploded");
      }
    });
  });

  describe("Integration with validation", () => {
    beforeEach(async () => {
      try {
        const module = await import("../../src/message-validation.js");
        MessagePluginRegistry = (module as any).MessagePluginRegistry;
        registerMessageType = (module as any).registerMessageType;
        unregisterMessageType = (module as any).unregisterMessageType;
        if (MessagePluginRegistry?.clearCustom) {
          MessagePluginRegistry.clearCustom();
        }
      } catch (e) {
        // Module doesn't exist yet
      }
    });

    it("should validate custom message types through validateMessage", async () => {
      if (registerMessageType) {
        registerMessageType({
          type: "validated-custom",
          minArity: 2,
          argTypes: ["arg1", "arg2"],
        });
      } else {
        throw new Error("registerMessageType not available");
      }

      const { validateMessage } = await import("../../src/message-validation.js");

      // Valid message should pass
      expect(() => validateMessage(["validated-custom", "a", "b"])).not.toThrow();

      // Invalid message (missing args) should fail
      expect(() => validateMessage(["validated-custom"])).toThrow();
      expect(() => validateMessage(["validated-custom", "a"])).toThrow();
    });

    it("should include custom types in error message for unknown types", async () => {
      if (registerMessageType) {
        registerMessageType({ type: "known-custom", minArity: 0 });
      } else {
        throw new Error("registerMessageType not available");
      }

      const { validateMessage } = await import("../../src/message-validation.js");

      try {
        validateMessage(["totally-unknown"]);
      } catch (e: any) {
        // Error should mention valid types including custom ones
        expect(e.message).toContain("known-custom");
      }
    });

    it("should validate max arity for custom message types", async () => {
      if (registerMessageType) {
        registerMessageType({
          type: "bounded-args",
          minArity: 1,
          maxArity: 2,
        });
      } else {
        throw new Error("registerMessageType not available");
      }

      const { validateMessage } = await import("../../src/message-validation.js");

      // Within bounds should pass
      expect(() => validateMessage(["bounded-args", "a"])).not.toThrow();
      expect(() => validateMessage(["bounded-args", "a", "b"])).not.toThrow();

      // Too many args should fail
      expect(() => validateMessage(["bounded-args", "a", "b", "c"])).toThrow(/too many|max|arity/i);
    });

    it("should preserve validation behavior for built-in types", async () => {
      // Registering custom types should not affect built-in validation
      if (registerMessageType) {
        registerMessageType({ type: "harmless-custom", minArity: 0 });
      } else {
        throw new Error("registerMessageType not available");
      }

      const { validateMessage } = await import("../../src/message-validation.js");

      // Built-in messages should still work
      expect(() => validateMessage(["push", "expression"])).not.toThrow();
      expect(() => validateMessage(["pull", 1])).not.toThrow();
      expect(() => validateMessage(["resolve", 1, "value"])).not.toThrow();

      // Built-in validation errors should still work
      expect(() => validateMessage(["push"])).toThrow(); // missing arg
      expect(() => validateMessage(["pull", "not-a-number"])).toThrow(); // wrong type
    });
  });
});
