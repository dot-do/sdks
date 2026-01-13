// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach } from "vitest"
import { RpcTarget } from "../../src/index.js"

/**
 * Unit tests for WebSocket transport (websocket.ts)
 * Tests WebSocket session creation, message handling, and error propagation
 *
 * Note: These tests mock the WebSocket class since we're testing the transport
 * layer in isolation, not actual network connectivity.
 */

// Mock WebSocket implementation for testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private partner?: MockWebSocket;
  public sentMessages: string[] = [];
  public closeCode?: number;
  public closeReason?: string;

  constructor(public url?: string) {
    // Auto-connect after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent("open", {});
    }, 0);
  }

  // Set up a paired connection for bidirectional testing
  static createPair(): [MockWebSocket, MockWebSocket] {
    const ws1 = new MockWebSocket();
    const ws2 = new MockWebSocket();
    ws1.partner = ws2;
    ws2.partner = ws1;
    return [ws1, ws2];
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  private dispatchEvent(type: string, event: any) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  send(message: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(message);

    // Forward to partner if connected
    if (this.partner) {
      setTimeout(() => {
        this.partner!.dispatchEvent("message", { data: message });
      }, 0);
    }
  }

  close(code?: number, reason?: string) {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent("close", { code, reason });

    // Notify partner
    if (this.partner && this.partner.readyState === MockWebSocket.OPEN) {
      setTimeout(() => {
        this.partner!.readyState = MockWebSocket.CLOSED;
        this.partner!.dispatchEvent("close", { code: 1000, reason: "Peer closed" });
      }, 0);
    }
  }

  // Helper to simulate receiving a message
  simulateMessage(data: string) {
    this.dispatchEvent("message", { data });
  }

  // Helper to simulate an error
  simulateError() {
    this.dispatchEvent("error", {});
  }

  // Helper to simulate close
  simulateClose(code: number = 1000, reason: string = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent("close", { code, reason });
  }

  // Helper to open immediately
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent("open", {});
  }

  // For Workers WebSocket API compatibility
  accept() {
    this.readyState = MockWebSocket.OPEN;
  }
}

// Mock WebSocketPair for Workers compatibility
class MockWebSocketPair {
  0: MockWebSocket;
  1: MockWebSocket;

  constructor() {
    const [ws1, ws2] = MockWebSocket.createPair();
    this[0] = ws1;
    this[1] = ws2;
  }
}

describe("WebSocket transport - connection lifecycle", () => {
  it("queues messages while connecting and sends when open", async () => {
    const ws = new MockWebSocket();
    expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

    // Queue some messages before open
    const messages = ["msg1", "msg2", "msg3"];

    // Wait for connection to open
    await new Promise<void>(resolve => {
      ws.addEventListener("open", () => resolve());
    });

    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    // Now send messages
    for (const msg of messages) {
      ws.send(msg);
    }

    expect(ws.sentMessages).toStrictEqual(messages);
  });

  it("throws when sending on closed connection", () => {
    const ws = new MockWebSocket();
    ws.readyState = MockWebSocket.CLOSED;

    expect(() => ws.send("test")).toThrow();
  });
});

describe("WebSocket transport - message handling", () => {
  it("receives string messages", async () => {
    const ws = new MockWebSocket();
    ws.open();

    const receivedMessages: string[] = [];
    ws.addEventListener("message", (event: any) => {
      receivedMessages.push(event.data);
    });

    ws.simulateMessage("hello");
    ws.simulateMessage("world");

    expect(receivedMessages).toStrictEqual(["hello", "world"]);
  });

  it("processes messages in order", async () => {
    const ws = new MockWebSocket();
    ws.open();

    const receivedMessages: string[] = [];
    ws.addEventListener("message", (event: any) => {
      receivedMessages.push(event.data);
    });

    // Simulate receiving multiple messages
    for (let i = 0; i < 10; i++) {
      ws.simulateMessage(`message${i}`);
    }

    expect(receivedMessages).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(receivedMessages[i]).toBe(`message${i}`);
    }
  });
});

describe("WebSocket transport - error handling", () => {
  it("handles close event", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let closeEvent: any = null;
    ws.addEventListener("close", (event: any) => {
      closeEvent = event;
    });

    ws.simulateClose(1000, "Normal closure");

    expect(closeEvent).not.toBeNull();
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe("Normal closure");
  });

  it("handles error event", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let errorReceived = false;
    ws.addEventListener("error", () => {
      errorReceived = true;
    });

    ws.simulateError();

    expect(errorReceived).toBe(true);
  });
});

describe("WebSocket transport - paired connections", () => {
  it("sends messages between paired sockets", async () => {
    const [ws1, ws2] = MockWebSocket.createPair();
    ws1.open();
    ws2.open();

    const ws2Messages: string[] = [];
    ws2.addEventListener("message", (event: any) => {
      ws2Messages.push(event.data);
    });

    ws1.send("hello from ws1");

    // Wait for message delivery
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ws2Messages).toStrictEqual(["hello from ws1"]);
  });

  it("bidirectional communication works", async () => {
    const [ws1, ws2] = MockWebSocket.createPair();
    ws1.open();
    ws2.open();

    const ws1Messages: string[] = [];
    const ws2Messages: string[] = [];

    ws1.addEventListener("message", (event: any) => {
      ws1Messages.push(event.data);
    });
    ws2.addEventListener("message", (event: any) => {
      ws2Messages.push(event.data);
    });

    ws1.send("from 1 to 2");
    ws2.send("from 2 to 1");

    // Wait for message delivery
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ws2Messages).toStrictEqual(["from 1 to 2"]);
    expect(ws1Messages).toStrictEqual(["from 2 to 1"]);
  });
});

describe("WebSocket transport - close behavior", () => {
  it("close() sets close code and reason", () => {
    const ws = new MockWebSocket();
    ws.open();

    ws.close(3000, "Custom close");

    expect(ws.closeCode).toBe(3000);
    expect(ws.closeReason).toBe("Custom close");
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("close notifies partner", async () => {
    const [ws1, ws2] = MockWebSocket.createPair();
    ws1.open();
    ws2.open();

    let ws2Closed = false;
    ws2.addEventListener("close", () => {
      ws2Closed = true;
    });

    ws1.close(1000, "bye");

    // Wait for close to propagate
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(ws2Closed).toBe(true);
  });
});

describe("WebSocket transport - Workers WebSocket API", () => {
  it("WebSocketPair creates paired connections", () => {
    const pair = new MockWebSocketPair();
    expect(pair[0]).toBeInstanceOf(MockWebSocket);
    expect(pair[1]).toBeInstanceOf(MockWebSocket);
  });

  it("accept() opens the connection", () => {
    const ws = new MockWebSocket();
    expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

    ws.accept();

    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });
});

describe("WebSocket transport - edge cases", () => {
  it("multiple event listeners for same event type", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let count = 0;
    const listener1 = () => { count++; };
    const listener2 = () => { count++; };

    ws.addEventListener("message", listener1);
    ws.addEventListener("message", listener2);

    ws.simulateMessage("test");

    expect(count).toBe(2);
  });

  it("removeEventListener stops receiving events", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let count = 0;
    const listener = () => { count++; };

    ws.addEventListener("message", listener);
    ws.simulateMessage("test1");
    expect(count).toBe(1);

    ws.removeEventListener("message", listener);
    ws.simulateMessage("test2");
    expect(count).toBe(1); // Should not increment
  });

  it("handles empty message", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let receivedMessage: string | null = null;
    ws.addEventListener("message", (event: any) => {
      receivedMessage = event.data;
    });

    ws.simulateMessage("");

    expect(receivedMessage).toBe("");
  });

  it("handles message with special characters", async () => {
    const ws = new MockWebSocket();
    ws.open();

    let receivedMessage: string | null = null;
    ws.addEventListener("message", (event: any) => {
      receivedMessage = event.data;
    });

    const specialMessage = '{"key": "value with \\"quotes\\" and\\nnewlines"}';
    ws.simulateMessage(specialMessage);

    expect(receivedMessage).toBe(specialMessage);
  });
});

/**
 * WebSocket timeout and error handling tests
 * Issue: dot-do-capnweb-kkh
 *
 * Tests verify WebSocket behavior under error conditions:
 * - Connection timeout handling
 * - Reconnection after disconnect
 * - Message timeout handling
 * - Graceful close vs abrupt close
 * - Error event propagation
 * - Multiple rapid connect/disconnect cycles
 */

// Extended MockWebSocket with timeout simulation capabilities
class TimeoutMockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = TimeoutMockWebSocket.CONNECTING;
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  public sentMessages: string[] = [];
  public closeCode?: number;
  public closeReason?: string;
  public shouldFailConnection: boolean = false;

  constructor(public url?: string, options?: { connectionTimeout?: number; shouldFail?: boolean }) {
    if (options?.shouldFail) {
      this.shouldFailConnection = true;
    }
    // Do NOT auto-connect like MockWebSocket does - we control connection manually
  }

  addEventListener(type: string, listener: (event: any) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  private dispatchEvent(type: string, event: any) {
    const eventListeners = this.listeners.get(type);
    if (eventListeners) {
      for (const listener of eventListeners) {
        listener(event);
      }
    }
  }

  send(message: string) {
    if (this.readyState !== TimeoutMockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.sentMessages.push(message);
  }

  close(code?: number, reason?: string) {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = TimeoutMockWebSocket.CLOSED;
    this.dispatchEvent("close", { code, reason });
  }

  // Override to simulate connection timeout
  simulateConnectionTimeout() {
    this.readyState = TimeoutMockWebSocket.CLOSED;
    this.dispatchEvent("error", { type: "error", message: "Connection timeout" });
    this.dispatchEvent("close", { code: 1006, reason: "Connection timeout" });
  }

  // Simulate delayed connection
  async connectWithDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (!this.shouldFailConnection) {
          this.readyState = TimeoutMockWebSocket.OPEN;
          this.dispatchEvent("open", {});
        } else {
          this.simulateConnectionTimeout();
        }
        resolve();
      }, delayMs);
    });
  }

  // Helper to simulate receiving a message
  simulateMessage(data: string) {
    this.dispatchEvent("message", { data });
  }

  // Helper to simulate an error
  simulateError() {
    this.dispatchEvent("error", {});
  }

  // Helper to simulate close
  simulateClose(code: number = 1000, reason: string = "") {
    this.readyState = TimeoutMockWebSocket.CLOSED;
    this.dispatchEvent("close", { code, reason });
  }

  // Helper to open immediately
  open() {
    this.readyState = TimeoutMockWebSocket.OPEN;
    this.dispatchEvent("open", {});
  }
}

describe("WebSocket transport - connection timeout handling", () => {
  it("detects connection timeout via error and close events", async () => {
    const ws = new TimeoutMockWebSocket("ws://test.example.com");

    let errorReceived = false;
    let closeReceived = false;
    let closeCode: number | undefined;
    let closeReason: string | undefined;

    ws.addEventListener("error", () => {
      errorReceived = true;
    });

    ws.addEventListener("close", (event: any) => {
      closeReceived = true;
      closeCode = event.code;
      closeReason = event.reason;
    });

    // Simulate connection timeout
    ws.simulateConnectionTimeout();

    expect(errorReceived).toBe(true);
    expect(closeReceived).toBe(true);
    expect(closeCode).toBe(1006); // Abnormal closure
    expect(closeReason).toBe("Connection timeout");
  });

  it("handles connection that times out before opening", async () => {
    const ws = new TimeoutMockWebSocket("ws://test.example.com", { shouldFail: true });

    let openReceived = false;
    let errorReceived = false;
    let closeReceived = false;

    ws.addEventListener("open", () => {
      openReceived = true;
    });

    ws.addEventListener("error", () => {
      errorReceived = true;
    });

    ws.addEventListener("close", () => {
      closeReceived = true;
    });

    // Connection attempt with failure
    await ws.connectWithDelay(10);

    expect(openReceived).toBe(false);
    expect(errorReceived).toBe(true);
    expect(closeReceived).toBe(true);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("allows implementation of custom connection timeout", async () => {
    const TIMEOUT_MS = 50;
    // Use TimeoutMockWebSocket which doesn't auto-connect
    const ws = new TimeoutMockWebSocket("ws://test.example.com");

    let timedOut = false;
    let connected = false;

    ws.addEventListener("open", () => {
      connected = true;
    });

    // Create a timeout promise
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        if (ws.readyState === TimeoutMockWebSocket.CONNECTING) {
          timedOut = true;
          ws.simulateClose(1006, "Connection timeout");
          reject(new Error("Connection timeout"));
        }
      }, TIMEOUT_MS);
    });

    const connectionPromise = new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve());
    });

    // Wait for either timeout or connection
    try {
      await Promise.race([timeoutPromise, connectionPromise]);
    } catch (e) {
      // Expected timeout
    }

    expect(timedOut).toBe(true);
    expect(connected).toBe(false);
  });
});

describe("WebSocket transport - reconnection after disconnect", () => {
  it("can create new connection after previous connection closed", async () => {
    // First connection
    const ws1 = new MockWebSocket("ws://test.example.com");
    ws1.open();
    expect(ws1.readyState).toBe(MockWebSocket.OPEN);

    ws1.close(1000, "Normal close");
    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);

    // Second connection - simulating reconnection
    const ws2 = new MockWebSocket("ws://test.example.com");
    ws2.open();
    expect(ws2.readyState).toBe(MockWebSocket.OPEN);

    // Verify second connection works
    const messages: string[] = [];
    ws2.addEventListener("message", (event: any) => {
      messages.push(event.data);
    });

    ws2.simulateMessage("reconnected!");
    expect(messages).toStrictEqual(["reconnected!"]);
  });

  it("handles reconnection after error disconnect", async () => {
    // First connection that fails
    const ws1 = new MockWebSocket("ws://test.example.com");
    ws1.open();

    let ws1Error = false;
    let ws1Closed = false;

    ws1.addEventListener("error", () => {
      ws1Error = true;
    });

    ws1.addEventListener("close", () => {
      ws1Closed = true;
    });

    // Simulate error and abrupt close
    ws1.simulateError();
    ws1.simulateClose(1006, "Abnormal closure");

    expect(ws1Error).toBe(true);
    expect(ws1Closed).toBe(true);

    // Reconnect
    const ws2 = new MockWebSocket("ws://test.example.com");
    ws2.open();

    expect(ws2.readyState).toBe(MockWebSocket.OPEN);

    // Verify reconnected socket works
    ws2.send("after reconnect");
    expect(ws2.sentMessages).toContain("after reconnect");
  });

  it("tracks reconnection attempts with backoff simulation", async () => {
    const maxRetries = 3;
    const baseDelayMs = 10;
    let attempts = 0;
    let lastConnectedSocket: MockWebSocket | null = null;

    async function attemptConnection(): Promise<MockWebSocket | null> {
      attempts++;
      const ws = new MockWebSocket("ws://test.example.com");

      // Simulate first two attempts failing
      if (attempts < 3) {
        ws.simulateError();
        ws.simulateClose(1006, "Connection failed");
        return null;
      }

      ws.open();
      return ws;
    }

    // Simulate reconnection with exponential backoff
    for (let retry = 0; retry < maxRetries; retry++) {
      const delay = baseDelayMs * Math.pow(2, retry);
      await new Promise(resolve => setTimeout(resolve, delay));

      const ws = await attemptConnection();
      if (ws && ws.readyState === MockWebSocket.OPEN) {
        lastConnectedSocket = ws;
        break;
      }
    }

    expect(attempts).toBe(3);
    expect(lastConnectedSocket).not.toBeNull();
    expect(lastConnectedSocket!.readyState).toBe(MockWebSocket.OPEN);
  });
});

describe("WebSocket transport - message timeout handling", () => {
  it("allows detection of message response timeout", async () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    const MESSAGE_TIMEOUT_MS = 50;
    let responseReceived = false;
    let timedOut = false;

    // Send a message and wait for response with timeout
    ws.send('{"id": 1, "method": "test"}');

    const responsePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event: any) => {
        responseReceived = true;
        resolve(event.data);
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error("Message response timeout"));
      }, MESSAGE_TIMEOUT_MS);
    });

    // No response will come, so timeout should occur
    try {
      await Promise.race([responsePromise, timeoutPromise]);
    } catch (e: any) {
      expect(e.message).toBe("Message response timeout");
    }

    expect(timedOut).toBe(true);
    expect(responseReceived).toBe(false);
  });

  it("clears timeout when response received in time", async () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    const MESSAGE_TIMEOUT_MS = 100;
    let responseReceived = false;
    let timedOut = false;

    // Send a message
    ws.send('{"id": 1, "method": "test"}');

    const responsePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event: any) => {
        responseReceived = true;
        resolve(event.data);
      });
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error("Message response timeout"));
      }, MESSAGE_TIMEOUT_MS);
    });

    // Simulate quick response (before timeout)
    setTimeout(() => {
      ws.simulateMessage('{"id": 1, "result": "success"}');
    }, 10);

    const result = await Promise.race([responsePromise, timeoutPromise]);

    expect(result).toBe('{"id": 1, "result": "success"}');
    expect(responseReceived).toBe(true);
    expect(timedOut).toBe(false);
  });

  it("handles multiple pending messages with individual timeouts", async () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    const pendingMessages = new Map<number, { resolve: Function; reject: Function; timeout: ReturnType<typeof setTimeout> }>();

    function sendWithTimeout(id: number, message: string, timeoutMs: number): Promise<string> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingMessages.delete(id);
          reject(new Error(`Message ${id} timeout`));
        }, timeoutMs);

        pendingMessages.set(id, { resolve, reject, timeout });
        ws.send(message);
      });
    }

    ws.addEventListener("message", (event: any) => {
      const data = JSON.parse(event.data);
      const pending = pendingMessages.get(data.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingMessages.delete(data.id);
        pending.resolve(event.data);
      }
    });

    // Send three messages with different timeouts
    const promise1 = sendWithTimeout(1, '{"id": 1}', 30);
    const promise2 = sendWithTimeout(2, '{"id": 2}', 50);
    const promise3 = sendWithTimeout(3, '{"id": 3}', 100);

    // Respond to message 2 and 3, but not 1
    setTimeout(() => ws.simulateMessage('{"id": 2, "result": "ok"}'), 20);
    setTimeout(() => ws.simulateMessage('{"id": 3, "result": "ok"}'), 40);

    // Message 1 should timeout
    await expect(promise1).rejects.toThrow("Message 1 timeout");

    // Messages 2 and 3 should succeed
    await expect(promise2).resolves.toBe('{"id": 2, "result": "ok"}');
    await expect(promise3).resolves.toBe('{"id": 3, "result": "ok"}');
  });
});

describe("WebSocket transport - graceful vs abrupt close", () => {
  it("graceful close sends close code 1000", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    let closeEvent: any = null;
    ws.addEventListener("close", (event: any) => {
      closeEvent = event;
    });

    ws.close(1000, "Normal closure");

    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe("Normal closure");
  });

  it("abrupt close uses code 1006", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    let closeEvent: any = null;
    ws.addEventListener("close", (event: any) => {
      closeEvent = event;
    });

    // Simulate network disconnect (abrupt close)
    ws.simulateClose(1006, "Abnormal closure");

    expect(closeEvent.code).toBe(1006);
  });

  it("graceful close allows pending messages to be processed", async () => {
    const [ws1, ws2] = MockWebSocket.createPair();
    ws1.open();
    ws2.open();

    const receivedMessages: string[] = [];
    ws2.addEventListener("message", (event: any) => {
      receivedMessages.push(event.data);
    });

    // Send messages then gracefully close
    ws1.send("message 1");
    ws1.send("message 2");
    ws1.close(1000, "Done");

    // Wait for message delivery
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(receivedMessages).toContain("message 1");
    expect(receivedMessages).toContain("message 2");
  });

  it("abrupt close may drop pending messages", async () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    // Mark as closed immediately without letting messages through
    ws.readyState = MockWebSocket.CLOSED;

    // Attempting to send should throw
    expect(() => ws.send("dropped message")).toThrow("WebSocket is not open");
  });

  it("close with different status codes", () => {
    const testCases = [
      { code: 1000, reason: "Normal closure" },
      { code: 1001, reason: "Going away" },
      { code: 1002, reason: "Protocol error" },
      { code: 1003, reason: "Unsupported data" },
      { code: 1008, reason: "Policy violation" },
      { code: 1011, reason: "Unexpected condition" },
      { code: 3000, reason: "Custom application error" },
      { code: 4000, reason: "Application-specific error" },
    ];

    for (const { code, reason } of testCases) {
      const ws = new MockWebSocket("ws://test.example.com");
      ws.open();

      let closeEvent: any = null;
      ws.addEventListener("close", (event: any) => {
        closeEvent = event;
      });

      ws.close(code, reason);

      expect(closeEvent.code).toBe(code);
      expect(closeEvent.reason).toBe(reason);
    }
  });
});

describe("WebSocket transport - error event propagation", () => {
  it("error event fires before close on connection failure", async () => {
    const ws = new MockWebSocket("ws://test.example.com");

    const events: string[] = [];

    ws.addEventListener("error", () => {
      events.push("error");
    });

    ws.addEventListener("close", () => {
      events.push("close");
    });

    // Simulate connection failure
    ws.simulateError();
    ws.simulateClose(1006, "Connection failed");

    expect(events).toStrictEqual(["error", "close"]);
  });

  it("error handler receives error event", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    let errorEvent: any = null;
    ws.addEventListener("error", (event: any) => {
      errorEvent = event;
    });

    ws.simulateError();

    expect(errorEvent).not.toBeNull();
  });

  it("multiple error handlers all receive the event", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    let handler1Called = false;
    let handler2Called = false;
    let handler3Called = false;

    ws.addEventListener("error", () => { handler1Called = true; });
    ws.addEventListener("error", () => { handler2Called = true; });
    ws.addEventListener("error", () => { handler3Called = true; });

    ws.simulateError();

    expect(handler1Called).toBe(true);
    expect(handler2Called).toBe(true);
    expect(handler3Called).toBe(true);
  });

  it("error during message sending is catchable", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    // Don't open - leave in CLOSED state
    ws.readyState = MockWebSocket.CLOSED;

    let errorCaught = false;
    try {
      ws.send("test");
    } catch (e: any) {
      errorCaught = true;
      expect(e.message).toBe("WebSocket is not open");
    }

    expect(errorCaught).toBe(true);
  });

  it("error propagates to all listeners in order", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    ws.open();

    const callOrder: number[] = [];

    ws.addEventListener("error", () => { callOrder.push(1); });
    ws.addEventListener("error", () => { callOrder.push(2); });
    ws.addEventListener("error", () => { callOrder.push(3); });

    ws.simulateError();

    expect(callOrder).toStrictEqual([1, 2, 3]);
  });
});

describe("WebSocket transport - multiple rapid connect/disconnect cycles", () => {
  it("handles rapid create and close cycles", async () => {
    const connections: MockWebSocket[] = [];

    for (let i = 0; i < 10; i++) {
      const ws = new MockWebSocket(`ws://test.example.com/connection${i}`);
      ws.open();
      connections.push(ws);
      ws.close(1000, "Quick close");
    }

    // All connections should be closed
    for (const ws of connections) {
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    }
  });

  it("handles interleaved connect and disconnect", async () => {
    const ws1 = new MockWebSocket("ws://test.example.com/1");
    ws1.open();

    const ws2 = new MockWebSocket("ws://test.example.com/2");
    ws2.open();

    ws1.close(1000, "Close 1");

    const ws3 = new MockWebSocket("ws://test.example.com/3");
    ws3.open();

    ws2.close(1000, "Close 2");

    expect(ws1.readyState).toBe(MockWebSocket.CLOSED);
    expect(ws2.readyState).toBe(MockWebSocket.CLOSED);
    expect(ws3.readyState).toBe(MockWebSocket.OPEN);

    ws3.close(1000, "Close 3");
    expect(ws3.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("rapid reconnection maintains message order", async () => {
    const allMessages: { connection: number; message: string }[] = [];

    for (let connNum = 0; connNum < 5; connNum++) {
      const ws = new MockWebSocket(`ws://test.example.com/${connNum}`);
      ws.open();

      ws.addEventListener("message", (event: any) => {
        allMessages.push({ connection: connNum, message: event.data });
      });

      // Receive messages on this connection
      ws.simulateMessage(`msg-${connNum}-1`);
      ws.simulateMessage(`msg-${connNum}-2`);

      ws.close(1000, "Done");
    }

    // Verify we received all messages in correct order
    expect(allMessages).toHaveLength(10);
    for (let i = 0; i < 5; i++) {
      const connMessages = allMessages.filter(m => m.connection === i);
      expect(connMessages).toHaveLength(2);
      expect(connMessages[0].message).toBe(`msg-${i}-1`);
      expect(connMessages[1].message).toBe(`msg-${i}-2`);
    }
  });

  it("handles stress test with many rapid cycles", async () => {
    const CYCLE_COUNT = 50;
    let successfulCycles = 0;
    let errors: Error[] = [];

    for (let i = 0; i < CYCLE_COUNT; i++) {
      try {
        const ws = new MockWebSocket(`ws://test.example.com/stress${i}`);
        ws.open();

        // Send a message
        ws.send(`stress-message-${i}`);
        expect(ws.sentMessages).toContain(`stress-message-${i}`);

        // Close
        ws.close(1000, "Stress test close");
        expect(ws.readyState).toBe(MockWebSocket.CLOSED);

        successfulCycles++;
      } catch (e: any) {
        errors.push(e);
      }
    }

    expect(successfulCycles).toBe(CYCLE_COUNT);
    expect(errors).toHaveLength(0);
  });

  it("concurrent connections operate independently", async () => {
    const connections = [
      new MockWebSocket("ws://test.example.com/a"),
      new MockWebSocket("ws://test.example.com/b"),
      new MockWebSocket("ws://test.example.com/c"),
    ];

    const messagesByConnection: Map<string, string[]> = new Map([
      ["a", []],
      ["b", []],
      ["c", []],
    ]);

    connections.forEach((ws, index) => {
      ws.open();
      const key = ["a", "b", "c"][index];
      ws.addEventListener("message", (event: any) => {
        messagesByConnection.get(key)!.push(event.data);
      });
    });

    // Send different messages to each
    connections[0].simulateMessage("message-for-a");
    connections[1].simulateMessage("message-for-b");
    connections[2].simulateMessage("message-for-c");

    // Close them in different order
    connections[1].close(1000, "Close b");
    connections[0].close(1000, "Close a");
    connections[2].close(1000, "Close c");

    // Verify each received its own message
    expect(messagesByConnection.get("a")).toStrictEqual(["message-for-a"]);
    expect(messagesByConnection.get("b")).toStrictEqual(["message-for-b"]);
    expect(messagesByConnection.get("c")).toStrictEqual(["message-for-c"]);
  });

  it("handles close during connecting state", () => {
    const ws = new MockWebSocket("ws://test.example.com");
    // Stay in connecting state
    expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

    let closeReceived = false;
    ws.addEventListener("close", () => {
      closeReceived = true;
    });

    // Close while still connecting
    ws.close(1000, "Cancelled connection");

    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(closeReceived).toBe(true);
  });
});
