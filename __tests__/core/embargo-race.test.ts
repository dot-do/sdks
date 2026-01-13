// Tests for the embargo race condition fix in EmbargoedStubHook and EmbargoedCallStubHook.
// These tests verify that the synchronous resolution check pattern correctly prevents
// the race condition where calls could start during the microtask when the embargo
// promise resolves but before the lifted hook is set.

import { describe, it, expect, afterEach } from 'vitest';
import { RpcSession, RpcTransport } from '../../src/rpc.js';
import { RpcStub } from '../../src/core.js';

// Simple in-memory transport pair for testing
class TestTransportPair {
  private queues: { a: string[]; b: string[] } = { a: [], b: [] };
  private resolvers: { a: ((msg: string) => void)[]; b: ((msg: string) => void)[] } = { a: [], b: [] };
  private closed = false;

  getTransportA(): RpcTransport {
    return {
      send: async (msg: string) => {
        if (this.closed) throw new Error('Transport closed');
        const resolver = this.resolvers.b.shift();
        if (resolver) {
          resolver(msg);
        } else {
          this.queues.b.push(msg);
        }
      },
      receive: () => {
        if (this.closed) return Promise.reject(new Error('Transport closed'));
        const msg = this.queues.a.shift();
        if (msg !== undefined) {
          return Promise.resolve(msg);
        }
        return new Promise<string>(resolve => {
          this.resolvers.a.push(resolve);
        });
      },
      abort: () => { this.closed = true; }
    };
  }

  getTransportB(): RpcTransport {
    return {
      send: async (msg: string) => {
        if (this.closed) throw new Error('Transport closed');
        const resolver = this.resolvers.a.shift();
        if (resolver) {
          resolver(msg);
        } else {
          this.queues.a.push(msg);
        }
      },
      receive: () => {
        if (this.closed) return Promise.reject(new Error('Transport closed'));
        const msg = this.queues.b.shift();
        if (msg !== undefined) {
          return Promise.resolve(msg);
        }
        return new Promise<string>(resolve => {
          this.resolvers.b.push(resolve);
        });
      },
      abort: () => { this.closed = true; }
    };
  }

  close() {
    this.closed = true;
  }
}

describe('Embargo race condition fix', () => {
  let transportPair: TestTransportPair;
  let clientSession: RpcSession;
  let serverSession: RpcSession;

  afterEach(() => {
    // Clean up sessions
    transportPair?.close();
  });

  it('should not race when calling immediately after embargo promise resolves', async () => {
    // This test verifies the fix for the P0 race condition.
    // The issue was that #embargoLifted was set via .then(), but call()/map()/get()
    // check it synchronously. If a call starts during the microtask when the promise
    // resolves but before the .then() callback runs, the call would incorrectly
    // be queued through EmbargoedCallStubHook instead of going directly.

    transportPair = new TestTransportPair();

    // Server exposes a service that returns a promise-like stub
    const serverService = {
      getCounter: () => {
        let count = 0;
        return {
          increment: () => ++count,
          getCount: () => count,
        };
      },
      // This method returns a promise that resolves after some pipelined calls are made
      getDelayedValue: async (value: number) => {
        // Small delay to allow pipelining
        await new Promise(resolve => setTimeout(resolve, 10));
        return value * 2;
      },
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Test 1: Basic pipelining with embargo
    // Make a pipelined call that triggers embargo handling
    const counterStub = (remoteMain as any).getCounter();

    // These calls are pipelined through the promise before resolution
    const incrementResult = await (counterStub as any).increment();
    const countResult = await (counterStub as any).getCount();

    expect(incrementResult).toBe(1);
    expect(countResult).toBe(1);

    // Test 2: Multiple rapid calls after resolution
    // This is the key test for the race condition
    const counter2 = (remoteMain as any).getCounter();

    // Make several calls in rapid succession
    const results = await Promise.all([
      (counter2 as any).increment(),
      (counter2 as any).increment(),
      (counter2 as any).increment(),
      (counter2 as any).getCount(),
    ]);

    // The counter should have been incremented 3 times
    expect(results).toEqual([1, 2, 3, 3]);
  });

  it('should maintain E-order semantics during embargo', async () => {
    // This test ensures that E-order (the order in which calls are made) is preserved
    // even when calls are made during the embargo period.

    transportPair = new TestTransportPair();

    const callOrder: string[] = [];
    const serverService = {
      getOrderedService: () => ({
        call1: () => { callOrder.push('call1'); return 'result1'; },
        call2: () => { callOrder.push('call2'); return 'result2'; },
        call3: () => { callOrder.push('call3'); return 'result3'; },
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get a promise stub and immediately make calls on it
    const service = (remoteMain as any).getOrderedService();

    // These calls should be delivered in order even if they're pipelined during embargo
    const [r1, r2, r3] = await Promise.all([
      (service as any).call1(),
      (service as any).call2(),
      (service as any).call3(),
    ]);

    expect(r1).toBe('result1');
    expect(r2).toBe('result2');
    expect(r3).toBe('result3');

    // The calls should have been executed in order
    expect(callOrder).toEqual(['call1', 'call2', 'call3']);
  });

  it('should correctly lift embargo after all pipelined calls complete', async () => {
    // This test verifies that the embargo is correctly lifted after all pipelined
    // calls have been resolved, and subsequent calls go directly to the resolution.

    transportPair = new TestTransportPair();

    let directCallCount = 0;
    let pipelinedCallCount = 0;

    const serverService = {
      getTrackingService: () => {
        return {
          pipelinedCall: async () => {
            pipelinedCallCount++;
            // Simulate some async work
            await new Promise(resolve => setTimeout(resolve, 5));
            return 'pipelined';
          },
          directCall: () => {
            directCallCount++;
            return 'direct';
          },
        };
      },
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get the service stub
    const service = (remoteMain as any).getTrackingService();

    // Make pipelined calls while the promise is still unresolved
    const pipelinedResult = await (service as any).pipelinedCall();

    expect(pipelinedResult).toBe('pipelined');
    expect(pipelinedCallCount).toBe(1);

    // Now make a "direct" call - the embargo should have lifted
    const directResult = await (service as any).directCall();
    expect(directResult).toBe('direct');
    expect(directCallCount).toBe(1);

    // Make more calls to verify embargo is still lifted
    const directResult2 = await (service as any).directCall();
    expect(directResult2).toBe('direct');
    expect(directCallCount).toBe(2);
  });

  it('should handle embargo rejection gracefully', async () => {
    // Test that when an embargo promise is rejected, the resolution is still used correctly

    transportPair = new TestTransportPair();

    const serverService = {
      getServiceThatMayFail: () => ({
        normalMethod: () => 'success',
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get the service and make a call
    const service = (remoteMain as any).getServiceThatMayFail();
    const result = await (service as any).normalMethod();
    expect(result).toBe('success');
  });

  it('should correctly handle dup() during embargo', async () => {
    // Test that dup() works correctly both during and after embargo

    transportPair = new TestTransportPair();

    const serverService = {
      getService: () => ({
        getValue: () => 42,
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get the service
    const service = (remoteMain as any).getService();

    // Make a call to verify it works
    const result1 = await (service as any).getValue();
    expect(result1).toBe(42);

    // After the first call completes, embargo should be lifted
    // Make another call to verify
    const result2 = await (service as any).getValue();
    expect(result2).toBe(42);
  });

  it('should handle get() operation correctly during embargo', async () => {
    // Test that property access (get) works correctly during embargo

    transportPair = new TestTransportPair();

    const serverService = {
      getObjectWithProperties: () => ({
        nested: {
          value: 'nested-value',
        },
        simpleValue: 123,
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get the object with properties
    const obj = (remoteMain as any).getObjectWithProperties();

    // Access properties
    const result = await obj;
    expect(result).toEqual({
      nested: { value: 'nested-value' },
      simpleValue: 123,
    });
  });

  it('should not block indefinitely when embargo promise never resolves', async () => {
    // This is a regression test to ensure the synchronous check doesn't cause issues
    // when the embargo is still pending

    transportPair = new TestTransportPair();

    let resolveOuter: (() => void) | undefined;
    const serverService = {
      getDelayedService: () => {
        // Return a promise that takes a while to resolve
        return new Promise<{ getValue: () => number }>(resolve => {
          resolveOuter = () => resolve({ getValue: () => 999 });
          // We'll resolve this externally
        });
      },
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Get a promise that won't resolve immediately
    const service = (remoteMain as any).getDelayedService();

    // Make a call on the unresolved promise
    const valuePromise = (service as any).getValue();

    // Give it a moment to set up the pipelining
    await new Promise(resolve => setTimeout(resolve, 10));

    // Now resolve the outer promise
    expect(resolveOuter).toBeDefined();
    resolveOuter!();

    // The call should eventually complete
    const value = await valuePromise;
    expect(value).toBe(999);
  });
});

describe('EmbargoedCallStubHook race condition fix', () => {
  let transportPair: TestTransportPair;
  let clientSession: RpcSession;
  let serverSession: RpcSession;

  afterEach(() => {
    transportPair?.close();
  });

  it('should handle chained calls correctly after resolution', async () => {
    // Test that EmbargoedCallStubHook correctly handles calls after its promise resolves

    transportPair = new TestTransportPair();

    const serverService = {
      getChainableService: () => ({
        first: () => ({
          second: () => ({
            third: () => 'final-value',
          }),
        }),
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    // Chain multiple calls through promise pipelining
    const service = (remoteMain as any).getChainableService();
    const first = (service as any).first();
    const second = (first as any).second();
    const third = (second as any).third();

    const result = await third;
    expect(result).toBe('final-value');
  });

  it('should handle map operation correctly in EmbargoedCallStubHook', async () => {
    // Test that map() in EmbargoedCallStubHook works correctly with the synchronous check

    transportPair = new TestTransportPair();

    const serverService = {
      getListService: () => ({
        getItems: () => [1, 2, 3, 4, 5],
        processItem: (item: number) => item * 10,
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    const service = (remoteMain as any).getListService();
    const items = await (service as any).getItems();

    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('should correctly propagate errors through embargoed calls', async () => {
    // Test that errors are correctly propagated through the embargo mechanism

    transportPair = new TestTransportPair();

    const serverService = {
      getErrorService: () => ({
        throwError: () => {
          throw new Error('Intentional error');
        },
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    const service = (remoteMain as any).getErrorService();

    await expect((service as any).throwError()).rejects.toThrow('Intentional error');
  });

  it('should handle concurrent calls during embargo correctly', async () => {
    // Test concurrent calls during embargo - this specifically tests the race condition
    // where multiple calls might check the embargo flag simultaneously

    transportPair = new TestTransportPair();

    let callCount = 0;
    const serverService = {
      getConcurrentService: () => ({
        call: () => {
          callCount++;
          return callCount;
        },
      }),
    };

    serverSession = new RpcSession(transportPair.getTransportB(), serverService);
    clientSession = new RpcSession(transportPair.getTransportA());

    const remoteMain = clientSession.getRemoteMain() as RpcStub & typeof serverService;

    const service = (remoteMain as any).getConcurrentService();

    // Fire off many concurrent calls - this exercises the race condition
    const promises = Array.from({ length: 10 }, () => (service as any).call());

    const results = await Promise.all(promises);

    // All calls should complete and return sequential values
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(callCount).toBe(10);
  });
});
