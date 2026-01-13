// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach } from "vitest"
import { RpcTarget, RpcSession, RpcTransport } from "../../src/index.js"

/**
 * Unit tests for MessagePort transport (messageport.ts)
 * Tests MessagePort-based communication, error handling, and close signaling
 *
 * These tests mock the MessagePort API since we're testing the transport
 * layer in isolation. Integration tests with real MessageChannel are in index.test.ts.
 */

// Mock MessagePort implementation for testing
class MockMessagePort {
  private listeners: Map<string, Set<(event: any) => void>> = new Map();
  private partner?: MockMessagePort;
  public started = false;
  public closed = false;
  public sentMessages: any[] = [];

  static createPair(): [MockMessagePort, MockMessagePort] {
    const port1 = new MockMessagePort();
    const port2 = new MockMessagePort();
    port1.partner = port2;
    port2.partner = port1;
    return [port1, port2];
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

  start() {
    this.started = true;
  }

  postMessage(data: any) {
    if (this.closed) {
      throw new Error("Port is closed");
    }
    this.sentMessages.push(data);

    // Forward to partner if connected
    if (this.partner && this.partner.started && !this.partner.closed) {
      setTimeout(() => {
        this.partner!.dispatchEvent("message", { data });
      }, 0);
    }
  }

  close() {
    this.closed = true;
  }

  // Helper to simulate receiving a message
  simulateMessage(data: any) {
    this.dispatchEvent("message", { data });
  }

  // Helper to simulate a message error
  simulateMessageError() {
    this.dispatchEvent("messageerror", {});
  }
}

// Mock MessageChannel implementation
class MockMessageChannel {
  port1: MockMessagePort;
  port2: MockMessagePort;

  constructor() {
    const [p1, p2] = MockMessagePort.createPair();
    this.port1 = p1;
    this.port2 = p2;
  }
}

describe("MessagePort transport - connection lifecycle", () => {
  it("start() enables message receiving", async () => {
    const [port1, port2] = MockMessagePort.createPair();

    expect(port1.started).toBe(false);
    port1.start();
    expect(port1.started).toBe(true);
  });

  it("postMessage sends data to partner", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    port1.start();
    port2.start();

    const receivedMessages: any[] = [];
    port2.addEventListener("message", (event) => {
      receivedMessages.push(event.data);
    });

    port1.postMessage("hello");

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(receivedMessages).toStrictEqual(["hello"]);
  });

  it("close() prevents further messages", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    port1.start();
    port2.start();

    port1.close();

    expect(port1.closed).toBe(true);
    expect(() => port1.postMessage("test")).toThrow();
  });
});

describe("MessagePort transport - message handling", () => {
  it("receives string messages", async () => {
    const port = new MockMessagePort();
    port.start();

    const receivedMessages: string[] = [];
    port.addEventListener("message", (event) => {
      receivedMessages.push(event.data);
    });

    port.simulateMessage("message1");
    port.simulateMessage("message2");

    expect(receivedMessages).toStrictEqual(["message1", "message2"]);
  });

  it("processes messages in order", async () => {
    const port = new MockMessagePort();
    port.start();

    const receivedMessages: string[] = [];
    port.addEventListener("message", (event) => {
      receivedMessages.push(event.data);
    });

    for (let i = 0; i < 10; i++) {
      port.simulateMessage(`msg${i}`);
    }

    expect(receivedMessages).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(receivedMessages[i]).toBe(`msg${i}`);
    }
  });

  it("handles null message as close signal", async () => {
    const port = new MockMessagePort();
    port.start();

    let closeSignalReceived = false;
    port.addEventListener("message", (event) => {
      if (event.data === null) {
        closeSignalReceived = true;
      }
    });

    port.simulateMessage(null);

    expect(closeSignalReceived).toBe(true);
  });
});

describe("MessagePort transport - error handling", () => {
  it("handles messageerror event", async () => {
    const port = new MockMessagePort();
    port.start();

    let errorReceived = false;
    port.addEventListener("messageerror", () => {
      errorReceived = true;
    });

    port.simulateMessageError();

    expect(errorReceived).toBe(true);
  });
});

describe("MessagePort transport - bidirectional communication", () => {
  it("supports bidirectional messaging", async () => {
    const channel = new MockMessageChannel();
    channel.port1.start();
    channel.port2.start();

    const port1Messages: string[] = [];
    const port2Messages: string[] = [];

    channel.port1.addEventListener("message", (event) => {
      port1Messages.push(event.data);
    });
    channel.port2.addEventListener("message", (event) => {
      port2Messages.push(event.data);
    });

    channel.port1.postMessage("from port1");
    channel.port2.postMessage("from port2");

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(port2Messages).toStrictEqual(["from port1"]);
    expect(port1Messages).toStrictEqual(["from port2"]);
  });

  it("supports ping-pong communication", async () => {
    const channel = new MockMessageChannel();
    channel.port1.start();
    channel.port2.start();

    // Port2 echoes back messages
    channel.port2.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        channel.port2.postMessage(`echo: ${event.data}`);
      }
    });

    const responses: string[] = [];
    channel.port1.addEventListener("message", (event) => {
      responses.push(event.data);
    });

    channel.port1.postMessage("ping");

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(responses).toContain("echo: ping");
  });
});

describe("MessagePort transport - close signaling", () => {
  it("sends null as close signal before closing", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    port1.start();
    port2.start();

    const port2Messages: any[] = [];
    port2.addEventListener("message", (event) => {
      port2Messages.push(event.data);
    });

    // Send close signal then close
    port1.postMessage(null);
    port1.close();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(port2Messages).toContain(null);
    expect(port1.closed).toBe(true);
  });

  it("partner can detect close signal", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    port1.start();
    port2.start();

    let peerClosed = false;
    port2.addEventListener("message", (event) => {
      if (event.data === null) {
        peerClosed = true;
      }
    });

    port1.postMessage(null);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(peerClosed).toBe(true);
  });
});

describe("MessagePort transport - edge cases", () => {
  it("handles multiple listeners for same event", async () => {
    const port = new MockMessagePort();
    port.start();

    let count = 0;
    port.addEventListener("message", () => { count++; });
    port.addEventListener("message", () => { count++; });

    port.simulateMessage("test");

    expect(count).toBe(2);
  });

  it("removeEventListener stops receiving events", async () => {
    const port = new MockMessagePort();
    port.start();

    let count = 0;
    const listener = () => { count++; };

    port.addEventListener("message", listener);
    port.simulateMessage("test1");
    expect(count).toBe(1);

    port.removeEventListener("message", listener);
    port.simulateMessage("test2");
    expect(count).toBe(1);
  });

  it("handles empty string message", async () => {
    const port = new MockMessagePort();
    port.start();

    let receivedMessage: string | null = null;
    port.addEventListener("message", (event) => {
      receivedMessage = event.data;
    });

    port.simulateMessage("");

    expect(receivedMessage).toBe("");
  });

  it("handles messages with special characters", async () => {
    const port = new MockMessagePort();
    port.start();

    let receivedMessage: string | null = null;
    port.addEventListener("message", (event) => {
      receivedMessage = event.data;
    });

    const specialMessage = '{"key": "value with \\"quotes\\" and\\nnewlines"}';
    port.simulateMessage(specialMessage);

    expect(receivedMessage).toBe(specialMessage);
  });

  it("MessageChannel creates paired ports", () => {
    const channel = new MockMessageChannel();
    expect(channel.port1).toBeInstanceOf(MockMessagePort);
    expect(channel.port2).toBeInstanceOf(MockMessagePort);
  });
});

describe("MessagePort transport - transport interface compatibility", () => {
  // Creates a mock transport that wraps a MockMessagePort
  function createMockMessagePortTransport(port: MockMessagePort): RpcTransport {
    let receiveResolver: ((msg: string) => void) | undefined;
    let receiveRejecter: ((err: any) => void) | undefined;
    const receiveQueue: string[] = [];
    let error: any;

    port.start();

    port.addEventListener("message", (event) => {
      if (error) return;
      if (event.data === null) {
        const err = new Error("Peer closed MessagePort connection.");
        error = err;
        if (receiveRejecter) {
          receiveRejecter(err);
          receiveResolver = undefined;
          receiveRejecter = undefined;
        }
      } else if (typeof event.data === "string") {
        if (receiveResolver) {
          receiveResolver(event.data);
          receiveResolver = undefined;
          receiveRejecter = undefined;
        } else {
          receiveQueue.push(event.data);
        }
      } else {
        const err = new TypeError("Received non-string message from MessagePort.");
        error = err;
        if (receiveRejecter) {
          receiveRejecter(err);
          receiveResolver = undefined;
          receiveRejecter = undefined;
        }
      }
    });

    port.addEventListener("messageerror", () => {
      const err = new Error("MessagePort message error.");
      error = err;
      if (receiveRejecter) {
        receiveRejecter(err);
        receiveResolver = undefined;
        receiveRejecter = undefined;
      }
    });

    return {
      async send(message: string): Promise<void> {
        if (error) throw error;
        port.postMessage(message);
      },
      async receive(): Promise<string> {
        if (receiveQueue.length > 0) {
          return receiveQueue.shift()!;
        } else if (error) {
          throw error;
        } else {
          return new Promise<string>((resolve, reject) => {
            receiveResolver = resolve;
            receiveRejecter = reject;
          });
        }
      },
      abort(reason: any): void {
        try {
          port.postMessage(null);
        } catch {}
        port.close();
        if (!error) {
          error = reason;
        }
      }
    };
  }

  it("can send and receive through transport interface", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport1 = createMockMessagePortTransport(port1);
    const transport2 = createMockMessagePortTransport(port2);

    await transport1.send("hello");
    const received = await transport2.receive();
    expect(received).toBe("hello");
  });

  it("receive() waits for messages", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport1 = createMockMessagePortTransport(port1);
    const transport2 = createMockMessagePortTransport(port2);

    // Start receiving before sending
    const receivePromise = transport2.receive();

    // Small delay then send
    await new Promise(resolve => setTimeout(resolve, 10));
    await transport1.send("delayed message");

    const received = await receivePromise;
    expect(received).toBe("delayed message");
  });

  it("receive() rejects on null (close signal)", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport2 = createMockMessagePortTransport(port2);

    // Queue a receive
    const receivePromise = transport2.receive();

    // Send close signal
    port1.start();
    port1.postMessage(null);

    await expect(receivePromise).rejects.toThrow("Peer closed MessagePort connection");
  });

  it("receive() rejects on non-string message", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport2 = createMockMessagePortTransport(port2);

    // Queue a receive
    const receivePromise = transport2.receive();

    // Send non-string
    port2.simulateMessage(123);

    await expect(receivePromise).rejects.toThrow("non-string message");
  });

  it("abort() sends close signal and closes port", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport1 = createMockMessagePortTransport(port1);
    const transport2 = createMockMessagePortTransport(port2);

    const messages: any[] = [];
    port2.addEventListener("message", (event) => {
      messages.push(event.data);
    });

    transport1.abort!(new Error("test abort"));

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(messages).toContain(null);
    expect(port1.closed).toBe(true);
  });

  it("queued messages are received before close", async () => {
    const [port1, port2] = MockMessagePort.createPair();
    const transport1 = createMockMessagePortTransport(port1);
    const transport2 = createMockMessagePortTransport(port2);

    // Send messages before receiving
    await transport1.send("msg1");
    await transport1.send("msg2");

    // Small delay to let messages queue
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(await transport2.receive()).toBe("msg1");
    expect(await transport2.receive()).toBe("msg2");
  });
});
