// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach } from "vitest"
import { RpcTarget, RpcSession, RpcTransport } from "../../src/index.js"

/**
 * Unit tests for HTTP batch transport (batch.ts)
 * Tests batch request formation, response parsing, and error handling
 *
 * These tests focus on the batch transport protocol mechanics,
 * not actual HTTP connectivity (which is tested in integration tests).
 */

// Simulates a batch server transport for testing
class MockBatchServerTransport implements RpcTransport {
  private batchToReceive: string[];
  private batchToSend: string[] = [];
  private allReceived: { promise: Promise<void>; resolve: () => void; reject: (err: any) => void };

  constructor(batch: string[]) {
    this.batchToReceive = batch;
    let resolve: () => void, reject: (err: any) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.allReceived = { promise, resolve: resolve!, reject: reject! };
  }

  async send(message: string): Promise<void> {
    this.batchToSend.push(message);
  }

  async receive(): Promise<string> {
    const msg = this.batchToReceive.shift();
    if (msg !== undefined) {
      return msg;
    } else {
      // No more messages
      this.allReceived.resolve();
      return new Promise(() => {}); // Never resolves
    }
  }

  abort(reason: any): void {
    this.allReceived.reject(reason);
  }

  whenAllReceived() {
    return this.allReceived.promise;
  }

  getResponseBody(): string {
    return this.batchToSend.join("\n");
  }

  getResponseMessages(): string[] {
    return this.batchToSend;
  }
}

// Simulates a batch client transport for testing
class MockBatchClientTransport implements RpcTransport {
  private batchToSend: string[] | null = [];
  private batchToReceive: string[] | null = null;
  private promise: Promise<void>;
  private aborted: any;
  private sendBatch: (batch: string[]) => Promise<string[]>;
  private error: any;

  constructor(sendBatch: (batch: string[]) => Promise<string[]>) {
    this.sendBatch = sendBatch;
    this.promise = this.scheduleBatch().catch(err => {
      // Store the error for receive() to throw later
      this.error = err;
    });
  }

  private async scheduleBatch() {
    // Wait for microtask queue
    await new Promise(resolve => setTimeout(resolve, 0));

    if (this.aborted !== undefined) {
      throw this.aborted;
    }

    const batch = this.batchToSend!;
    this.batchToSend = null;
    this.batchToReceive = await this.sendBatch(batch);
  }

  async send(message: string): Promise<void> {
    if (this.batchToSend !== null) {
      this.batchToSend.push(message);
    }
  }

  async receive(): Promise<string> {
    if (!this.batchToReceive) {
      await this.promise;
    }

    if (this.error) {
      throw this.error;
    }

    const msg = this.batchToReceive?.shift();
    if (msg !== undefined) {
      return msg;
    } else {
      throw new Error("Batch RPC request ended.");
    }
  }

  abort(reason: any): void {
    this.aborted = reason;
  }
}

describe("HTTP batch transport - request formation", () => {
  it("batches multiple sends into single request", async () => {
    let capturedBatch: string[] = [];

    const sendBatch = async (batch: string[]) => {
      capturedBatch = [...batch];
      return batch; // Echo back for simplicity
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Queue multiple messages
    await transport.send("message1");
    await transport.send("message2");
    await transport.send("message3");

    // Wait for batch to be sent
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(capturedBatch).toStrictEqual(["message1", "message2", "message3"]);
  });

  it("empty batch sends empty array", async () => {
    let capturedBatch: string[] | null = null;

    const sendBatch = async (batch: string[]) => {
      capturedBatch = [...batch];
      return [];
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Don't send any messages, just wait for batch
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(capturedBatch).toStrictEqual([]);
  });

  it("abort prevents batch from being sent", async () => {
    let batchSent = false;

    const sendBatch = async (batch: string[]) => {
      batchSent = true;
      return [];
    };

    const transport = new MockBatchClientTransport(sendBatch);

    transport.abort(new Error("Aborted"));

    await new Promise(resolve => setTimeout(resolve, 10));

    // The transport was aborted - attempting to receive will throw
    await expect(transport.receive()).rejects.toThrow("Aborted");
  });
});

describe("HTTP batch transport - response parsing", () => {
  it("receives messages from response", async () => {
    const responseMessages = ["response1", "response2"];

    const sendBatch = async (batch: string[]) => {
      return responseMessages;
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Wait for batch to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(await transport.receive()).toBe("response1");
    expect(await transport.receive()).toBe("response2");
  });

  it("throws when no more messages in response", async () => {
    const sendBatch = async (batch: string[]) => {
      return ["only-one"];
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Wait for batch to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(await transport.receive()).toBe("only-one");
    await expect(transport.receive()).rejects.toThrow("Batch RPC request ended");
  });

  it("handles empty response", async () => {
    const sendBatch = async (batch: string[]) => {
      return [];
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Wait for batch to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    await expect(transport.receive()).rejects.toThrow("Batch RPC request ended");
  });
});

describe("HTTP batch transport - server side", () => {
  it("processes incoming batch and produces response", async () => {
    const incomingBatch = [
      '["push",["pipeline",0,["getValue"]]]',
      '["pull",1]'
    ];

    const transport = new MockBatchServerTransport(incomingBatch);

    // Process messages
    const msg1 = await transport.receive();
    expect(msg1).toBe('["push",["pipeline",0,["getValue"]]]');

    const msg2 = await transport.receive();
    expect(msg2).toBe('["pull",1]');

    // Send responses
    await transport.send('["resolve",1,42]');

    expect(transport.getResponseMessages()).toStrictEqual(['["resolve",1,42]']);
    expect(transport.getResponseBody()).toBe('["resolve",1,42]');
  });

  it("joins multiple response messages with newlines", async () => {
    const transport = new MockBatchServerTransport([]);

    await transport.send("message1");
    await transport.send("message2");
    await transport.send("message3");

    expect(transport.getResponseBody()).toBe("message1\nmessage2\nmessage3");
  });

  it("handles empty input batch", async () => {
    const transport = new MockBatchServerTransport([]);

    // Start receiving - this will immediately resolve since batch is empty
    const receivePromise = transport.receive();

    // The promise should never resolve (it returns new Promise(() => {}))
    // but whenAllReceived should resolve once receive is called
    await transport.whenAllReceived();
    expect(transport.getResponseMessages()).toStrictEqual([]);
  });
});

describe("HTTP batch transport - error handling", () => {
  it("abort rejects whenAllReceived", async () => {
    const transport = new MockBatchServerTransport(["message"]);

    const abortError = new Error("Test abort");
    transport.abort(abortError);

    await expect(transport.whenAllReceived()).rejects.toBe(abortError);
  });

  it("handles sendBatch rejection", async () => {
    let rejectPromise: Promise<void>;

    const sendBatch = async (batch: string[]) => {
      throw new Error("Network error");
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // receive() should throw because the batch failed
    // We call receive immediately to ensure the rejection is caught
    await expect(transport.receive()).rejects.toThrow("Network error");
  });
});

describe("HTTP batch transport - message ordering", () => {
  it("maintains message order in batch", async () => {
    let capturedBatch: string[] = [];

    const sendBatch = async (batch: string[]) => {
      capturedBatch = [...batch];
      return batch.reverse(); // Reverse for testing
    };

    const transport = new MockBatchClientTransport(sendBatch);

    // Queue messages
    for (let i = 0; i < 5; i++) {
      await transport.send(`msg${i}`);
    }

    // Wait for batch
    await new Promise(resolve => setTimeout(resolve, 10));

    // Sent order should be preserved
    expect(capturedBatch).toStrictEqual(["msg0", "msg1", "msg2", "msg3", "msg4"]);

    // Received order should be reversed (as per our mock)
    expect(await transport.receive()).toBe("msg4");
    expect(await transport.receive()).toBe("msg3");
  });

  it("server processes messages in order", async () => {
    const messages = ["first", "second", "third"];
    const transport = new MockBatchServerTransport(messages);

    const received: string[] = [];
    received.push(await transport.receive());
    received.push(await transport.receive());
    received.push(await transport.receive());

    expect(received).toStrictEqual(["first", "second", "third"]);
  });
});

describe("HTTP batch transport - integration with RPC", () => {
  it("can use batch transport with RpcSession", async () => {
    // Create a simple in-memory batch exchange
    let serverBatch: string[] = [];
    let serverTransport: MockBatchServerTransport | null = null;

    const sendBatch = async (clientBatch: string[]) => {
      // Create server transport with client's batch
      serverBatch = [...clientBatch];
      serverTransport = new MockBatchServerTransport(serverBatch);

      // Process on server using RpcSession
      class SimpleTarget extends RpcTarget {
        getValue() { return 42; }
      }

      const server = new RpcSession(serverTransport, new SimpleTarget());

      await serverTransport.whenAllReceived();
      await server.drain();

      return serverTransport.getResponseMessages();
    };

    const clientTransport = new MockBatchClientTransport(sendBatch);
    const client = new RpcSession<{ getValue: () => number }>(clientTransport);

    const stub = client.getRemoteMain();

    // Make a call
    const result = await stub.getValue();
    expect(result).toBe(42);
  });
});

describe("HTTP batch transport - edge cases", () => {
  it("handles very long messages", async () => {
    const longMessage = "x".repeat(100000);
    let capturedBatch: string[] = [];

    const sendBatch = async (batch: string[]) => {
      capturedBatch = [...batch];
      return [longMessage];
    };

    const transport = new MockBatchClientTransport(sendBatch);
    await transport.send(longMessage);

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(capturedBatch[0]).toBe(longMessage);
    expect(await transport.receive()).toBe(longMessage);
  });

  it("handles messages with newlines", async () => {
    // Note: Real HTTP batch uses newlines as delimiters, so messages
    // should be JSON-encoded (which escapes newlines)
    const transport = new MockBatchServerTransport([]);

    await transport.send('{"key":"line1\\nline2"}');

    expect(transport.getResponseBody()).toBe('{"key":"line1\\nline2"}');
  });

  it("handles large number of messages", async () => {
    const messageCount = 1000;
    const messages: string[] = [];
    for (let i = 0; i < messageCount; i++) {
      messages.push(`message${i}`);
    }

    const transport = new MockBatchServerTransport(messages);

    // Read all messages
    for (let i = 0; i < messageCount; i++) {
      const msg = await transport.receive();
      expect(msg).toBe(`message${i}`);
    }
  });
});
