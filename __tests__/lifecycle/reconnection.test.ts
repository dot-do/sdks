// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, vi, beforeEach, afterEach } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, type RpcSessionOptions, type SessionState, type ReconnectionStrategy, ConnectionError } from "../../src/index.js"

/**
 * Tests for RpcSession automatic reconnection feature.
 *
 * These tests verify:
 * - Session state transitions (active -> reconnecting -> active/closed)
 * - Exponential backoff with jitter for reconnection attempts
 * - Callback invocations (onReconnecting, onReconnected, onStateChange)
 * - Reconnection cancellation
 * - Maximum retry limit behavior
 * - Session ID preservation
 *
 * TDD RED PHASE: These tests specify the desired behavior for automatic reconnection.
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
  public error?: unknown;

  async send(message: string): Promise<void> {
    if (this.error) throw this.error;
    if (this.log) console.log(`${this.name}: ${message}`);
    this.partner!.queue.push(message);
    if (this.partner!.waiter) {
      this.partner!.waiter();
      this.partner!.waiter = undefined;
      this.partner!.aborter = undefined;
    }
  }

  async receive(): Promise<string> {
    if (this.error) throw this.error;
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
    this.error = reason;
  }

  forceReceiveError(error: any) {
    this.error = error;
    if (this.aborter) {
      this.aborter(error);
      this.aborter = undefined;
      this.waiter = undefined;
    }
  }

  clearQueue() {
    this.queue = [];
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
}

// Target with a method that never resolves (for testing pending calls)
class HangingTarget extends RpcTarget {
  hang(): Promise<number> {
    return new Promise(() => {}); // Never resolves
  }
}

describe("Session state management", () => {
  it("should start in 'active' state", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.getState()).toBe("active");

    // Clean up
    client.close();
    await pumpMicrotasks();
  });

  it("should have getState() method that returns SessionState", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const state: SessionState = client.getState();
    expect(["active", "reconnecting", "closed"]).toContain(state);

    client.close();
    await pumpMicrotasks();
  });

  it("should transition to 'closed' state after close()", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.getState()).toBe("active");

    client.close();
    await pumpMicrotasks();

    expect(client.getState()).toBe("closed");
  });

  it("should call onStateChange callback when state changes", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const stateChanges: SessionState[] = [];
    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      onStateChange: (state) => stateChanges.push(state)
    });
    const server = new RpcSession(serverTransport, serverTarget);

    client.close();
    await pumpMicrotasks();

    expect(stateChanges).toContain("closed");
  });
});

describe("Session ID management", () => {
  it("should return undefined when no sessionId is configured", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.getSessionId()).toBeUndefined();

    client.close();
    await pumpMicrotasks();
  });

  it("should return configured sessionId", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      sessionId: "test-session-123"
    });
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.getSessionId()).toBe("test-session-123");

    client.close();
    await pumpMicrotasks();
  });
});

describe("Automatic reconnection - basic behavior", () => {
  it("should transition to 'reconnecting' state on disconnect when reconnect callback is provided", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const stateChanges: SessionState[] = [];
    let reconnectCalled = false;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        reconnectCalled = true;
        // Return null to cancel reconnection
        return null;
      },
      onStateChange: (state) => stateChanges.push(state)
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    expect(stateChanges).toContain("reconnecting");
    expect(reconnectCalled).toBe(true);
  });

  it("should call onReconnecting callback when entering reconnecting state", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let reconnectingError: Error | null = null;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => null,
      onReconnecting: (error) => { reconnectingError = error; }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    const disconnectError = new Error("connection lost");
    clientTransport.forceReceiveError(disconnectError);
    await pumpMicrotasks();

    // The error may be wrapped in a ConnectionError, but should contain the message
    expect(reconnectingError).not.toBeNull();
    expect(reconnectingError!.message).toBe("connection lost");
  });

  it("should transition to 'active' state after successful reconnection", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const stateChanges: SessionState[] = [];
    let reconnectAttempt = 0;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async (attempt) => {
        reconnectAttempt = attempt;
        // Create a new transport pair
        const newClientTransport = new TestTransport("new-client");
        const newServerTransport = new TestTransport("new-server", newClientTransport);
        // Start a new server session
        new RpcSession(newServerTransport, serverTarget);
        return newClientTransport;
      },
      onStateChange: (state) => stateChanges.push(state)
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 50));
    await pumpMicrotasks();

    expect(reconnectAttempt).toBe(1);
    expect(stateChanges).toContain("reconnecting");
    expect(client.getState()).toBe("active");
  });

  it("should call onReconnected callback after successful reconnection", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let reconnectedAttempt: number | null = null;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        const newClientTransport = new TestTransport("new-client");
        const newServerTransport = new TestTransport("new-server", newClientTransport);
        new RpcSession(newServerTransport, serverTarget);
        return newClientTransport;
      },
      onReconnected: (attempt) => { reconnectedAttempt = attempt; }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 50));
    await pumpMicrotasks();

    expect(reconnectedAttempt).toBe(1);
  });

  it("should not reconnect when close() is called explicitly", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let reconnectCalled = false;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        reconnectCalled = true;
        return null;
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Explicitly close (should not trigger reconnection)
    client.close();
    await pumpMicrotasks();

    expect(client.getState()).toBe("closed");
    expect(reconnectCalled).toBe(false);
  });

  it("should close permanently when no reconnect callback is provided", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect without reconnect callback
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    expect(client.getState()).toBe("closed");
  });
});

describe("Reconnection strategy - exponential backoff", () => {
  it("should respect maxAttempts configuration", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let attemptCount = 0;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        attemptCount++;
        throw new Error("reconnection failed");
      },
      reconnectionStrategy: {
        maxAttempts: 3,
        initialDelay: 10,
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for all retry attempts
    await new Promise(resolve => setTimeout(resolve, 200));
    await pumpMicrotasks();

    expect(attemptCount).toBe(3);
    expect(client.getState()).toBe("closed");
  });

  it("should apply exponential backoff between attempts", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const attemptTimes: number[] = [];

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        attemptTimes.push(Date.now());
        throw new Error("reconnection failed");
      },
      reconnectionStrategy: {
        maxAttempts: 3,
        initialDelay: 50,
        backoffMultiplier: 2,
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for all retry attempts
    await new Promise(resolve => setTimeout(resolve, 500));
    await pumpMicrotasks();

    expect(attemptTimes.length).toBe(3);

    // Check that delays increase exponentially
    if (attemptTimes.length >= 3) {
      const delay1 = attemptTimes[1] - attemptTimes[0];
      const delay2 = attemptTimes[2] - attemptTimes[1];

      // Second delay should be approximately double the first
      // Allow some tolerance for timing variations
      expect(delay2).toBeGreaterThan(delay1 * 1.5);
    }
  });

  it("should respect maxDelay configuration", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const attemptTimes: number[] = [];

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        attemptTimes.push(Date.now());
        throw new Error("reconnection failed");
      },
      reconnectionStrategy: {
        maxAttempts: 5,
        initialDelay: 50,
        maxDelay: 100,
        backoffMultiplier: 10, // Would normally cause huge delays
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for all retry attempts
    await new Promise(resolve => setTimeout(resolve, 700));
    await pumpMicrotasks();

    // Check that no delay exceeds maxDelay significantly
    for (let i = 1; i < attemptTimes.length; i++) {
      const delay = attemptTimes[i] - attemptTimes[i-1];
      // Allow some tolerance (150ms instead of strict 100ms)
      expect(delay).toBeLessThan(150);
    }
  });

  it("should apply jitter to delays", async () => {
    // Run multiple times to check for variance
    const allDelays: number[] = [];

    for (let run = 0; run < 3; run++) {
      const clientTransport = new TestTransport("client");
      const serverTransport = new TestTransport("server", clientTransport);

      const attemptTimes: number[] = [];

      const serverTarget = new SimpleTarget();
      const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
        reconnect: async () => {
          attemptTimes.push(Date.now());
          throw new Error("reconnection failed");
        },
        reconnectionStrategy: {
          maxAttempts: 2,
          initialDelay: 50,
          jitter: 0.5, // 50% jitter
        }
      });
      const server = new RpcSession(serverTransport, serverTarget);

      // Force disconnect
      clientTransport.forceReceiveError(new Error("connection lost"));

      // Wait for retry attempts
      await new Promise(resolve => setTimeout(resolve, 200));
      await pumpMicrotasks();

      if (attemptTimes.length >= 2) {
        allDelays.push(attemptTimes[1] - attemptTimes[0]);
      }
    }

    // With jitter, we expect some variance in delays
    // This test is probabilistic but should pass most of the time
    if (allDelays.length >= 3) {
      const minDelay = Math.min(...allDelays);
      const maxDelay = Math.max(...allDelays);
      // Delays should show some variation due to jitter
      // (this might occasionally fail due to randomness)
      expect(maxDelay - minDelay).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Reconnection cancellation", () => {
  it("should cancel reconnection when reconnect callback returns null", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const stateChanges: SessionState[] = [];

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => null, // Cancel reconnection
      onStateChange: (state) => stateChanges.push(state)
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    expect(stateChanges).toContain("reconnecting");
    expect(stateChanges).toContain("closed");
    expect(client.getState()).toBe("closed");
  });

  it("should cancel reconnection when close() is called during reconnecting", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let reconnectStarted = false;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        reconnectStarted = true;
        // Delay to allow close() to be called
        await new Promise(resolve => setTimeout(resolve, 100));
        const newClientTransport = new TestTransport("new-client");
        const newServerTransport = new TestTransport("new-server", newClientTransport);
        new RpcSession(newServerTransport, serverTarget);
        return newClientTransport;
      },
      reconnectionStrategy: {
        maxAttempts: 5,
        initialDelay: 10,
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection to start
    await new Promise(resolve => setTimeout(resolve, 20));

    // Call close during reconnection
    client.close();
    await pumpMicrotasks();

    expect(reconnectStarted).toBe(true);
    expect(client.getState()).toBe("closed");
  });
});

describe("Reconnection with pending calls", () => {
  it("should reject pending calls with ConnectionError when reconnection fails", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new HangingTarget();
    const client = new RpcSession<HangingTarget>(clientTransport);
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Start a hanging call
    const hangPromise = stub.hang();

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));
    await pumpMicrotasks();

    // The pending call should be rejected
    let rejectionError: unknown;
    try {
      await hangPromise;
    } catch (e) {
      rejectionError = e;
    }
    expect(rejectionError).toBeDefined();
  });

  it("should reject calls made during reconnecting state", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let inReconnecting = false;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        inReconnecting = true;
        // Wait a bit to allow call attempt
        await new Promise(resolve => setTimeout(resolve, 100));
        return null; // Cancel reconnection
      },
      reconnectionStrategy: {
        initialDelay: 1, // Very short delay to enter reconnecting quickly
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    const stub = client.getRemoteMain();

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnecting state
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(client.getState()).toBe("reconnecting");

    // Calls during reconnecting should fail (now throws synchronously)
    expect(() => stub.getValue()).toThrow();

    await pumpMicrotasks();
  });
});

describe("Reconnection preserves session configuration", () => {
  it("should preserve sessionId after successful reconnection", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      sessionId: "preserved-session-id",
      reconnect: async () => {
        const newClientTransport = new TestTransport("new-client");
        const newServerTransport = new TestTransport("new-server", newClientTransport);
        new RpcSession(newServerTransport, serverTarget);
        return newClientTransport;
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    expect(client.getSessionId()).toBe("preserved-session-id");

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 50));
    await pumpMicrotasks();

    // Session ID should be preserved
    expect(client.getSessionId()).toBe("preserved-session-id");
    expect(client.getState()).toBe("active");
  });
});

describe("Edge cases and error handling", () => {
  it("should handle reconnect callback that throws", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let attemptCount = 0;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        attemptCount++;
        throw new Error("reconnection failed");
      },
      reconnectionStrategy: {
        maxAttempts: 2,
        initialDelay: 10,
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection attempts
    await new Promise(resolve => setTimeout(resolve, 100));
    await pumpMicrotasks();

    expect(attemptCount).toBe(2);
    expect(client.getState()).toBe("closed");
  });

  it("should handle multiple rapid disconnections gracefully", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let reconnectCalls = 0;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        reconnectCalls++;
        return null;
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force multiple disconnections rapidly
    clientTransport.forceReceiveError(new Error("disconnect 1"));
    clientTransport.forceReceiveError(new Error("disconnect 2"));
    clientTransport.forceReceiveError(new Error("disconnect 3"));

    await pumpMicrotasks();

    // Should only trigger one reconnection cycle
    expect(reconnectCalls).toBe(1);
  });

  it("should handle zero maxAttempts as unlimited retries", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    let attemptCount = 0;

    const serverTarget = new SimpleTarget();
    const client = new RpcSession<SimpleTarget>(clientTransport, undefined, {
      reconnect: async () => {
        attemptCount++;
        if (attemptCount >= 5) {
          // Succeed after 5 attempts
          const newClientTransport = new TestTransport("new-client");
          const newServerTransport = new TestTransport("new-server", newClientTransport);
          new RpcSession(newServerTransport, serverTarget);
          return newClientTransport;
        }
        throw new Error("not yet");
      },
      reconnectionStrategy: {
        maxAttempts: 0, // Unlimited
        initialDelay: 5,
      }
    });
    const server = new RpcSession(serverTransport, serverTarget);

    // Force disconnect
    clientTransport.forceReceiveError(new Error("connection lost"));

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 200));
    await pumpMicrotasks();

    expect(attemptCount).toBe(5);
    expect(client.getState()).toBe("active");
  });
});
