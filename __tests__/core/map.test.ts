// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe } from "vitest"
import { RpcSession, RpcTransport, RpcTarget, RpcStub } from "../../src/index.js"

/**
 * Unit tests for map operations (map.ts)
 * Tests the map() functionality on RPC stubs and promises
 */

// Test transport for in-process communication
class TestTransport implements RpcTransport {
  constructor(public name: string, private partner?: TestTransport) {
    if (partner) {
      partner.partner = this;
    }
  }

  private queue: string[] = [];
  private waiter?: () => void;
  private aborter?: (err: any) => void;

  async send(message: string): Promise<void> {
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

  forceReceiveError(error: any) {
    if (this.aborter) {
      this.aborter(error);
    }
  }
}

async function pumpMicrotasks() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
}

// Test target that provides arrays and values for mapping
class MapTestTarget extends RpcTarget {
  getArray(length: number): number[] {
    return Array.from({ length }, (_, i) => i);
  }

  getSquares(length: number): number[] {
    return Array.from({ length }, (_, i) => i * i);
  }

  getFibonacci(length: number): number[] {
    if (length <= 0) return [];
    if (length === 1) return [0];
    const result = [0, 1];
    while (result.length < length) {
      result.push(result[result.length - 1] + result[result.length - 2]);
    }
    return result;
  }

  getNull() { return null; }
  getUndefined() { return undefined; }
  getSingleValue(value: number) { return value; }

  makeCounter(initial: number) { return new Counter(initial); }

  double(x: number) { return x * 2; }
  addOne(x: number) { return x + 1; }

  getNestedArrays(): number[][] {
    return [[1, 2], [3, 4], [5, 6]];
  }
}

class Counter extends RpcTarget {
  constructor(private value: number) {
    super();
  }

  increment(amount: number = 1): number {
    this.value += amount;
    return this.value;
  }

  getValue() { return this.value; }
}

describe("map - on local stubs", () => {
  it("maps over arrays using RPC calls", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getArray(5);
    // The mapper callback receives an RpcPromise, we use RPC calls to transform
    const result = await promise.map((x: any) => stub.double(x));
    expect(result).toStrictEqual([0, 2, 4, 6, 8]);
  });

  it("maps with identity function", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getArray(3);
    // Identity function works because x is passed through to result
    const result = await promise.map((x: any) => x);
    expect(result).toStrictEqual([0, 1, 2]);
  });

  it("maps over empty array", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getArray(0);
    const result = await promise.map((x: any) => stub.double(x));
    expect(result).toStrictEqual([]);
  });

  it("maps over null returns null", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getNull();
    const result = await promise.map((x: any) => x);
    expect(result).toBe(null);
  });

  it("maps over undefined returns undefined", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getUndefined();
    const result = await promise.map((x: any) => x);
    expect(result).toBe(undefined);
  });

  it("maps over single value using RPC call", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getSingleValue(42);
    const result = await promise.map((x: any) => stub.double(x));
    expect(result).toBe(84);
  });
});

describe("map - with RPC calls inside mapper", () => {
  it("can call RPC methods inside mapper", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(3);
    const result = await promise.map((x: any) => stub.double(x));

    expect(result).toStrictEqual([0, 2, 4]);
  });

  it("can create counters inside mapper", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using fib = stub.getFibonacci(5);
    using counters = await fib.map((i: any) => stub.makeCounter(i));

    // Each counter should have been created with the fibonacci value
    const values = await Promise.all(counters.map((c: any) => c.getValue()));
    expect(values).toStrictEqual([0, 1, 1, 2, 3]);
  });

  it("can chain RPC calls inside mapper", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(3);
    const result = await promise.map((x: any) => {
      const doubled = stub.double(x);
      return stub.addOne(doubled);
    });

    expect(result).toStrictEqual([1, 3, 5]); // (0*2)+1, (1*2)+1, (2*2)+1
  });

  it("can return objects with counters from mapper", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using fib = stub.getFibonacci(4);
    using results = await fib.map((i: any) => {
      const counter = stub.makeCounter(i);
      const val = counter.increment(10);
      return { counter, val };
    });

    expect(results.map((r: any) => r.val)).toStrictEqual([10, 11, 11, 12]);

    const counterValues = await Promise.all(
      results.map((r: any) => r.counter.getValue())
    );
    expect(counterValues).toStrictEqual([10, 11, 11, 12]);
  });
});

describe("map - nested maps", () => {
  it("supports nested map operations using RPC", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using fib = stub.getFibonacci(4);
    const result = await fib.map((i: any) => {
      // For each fibonacci number, create array and double using RPC
      return stub.getArray(i).map((j: any) => stub.double(j));
    });

    // For each fibonacci number n, we create an array [0..n-1] and double each element
    // fib = [0, 1, 1, 2]
    // 0 -> []
    // 1 -> [0]
    // 1 -> [0]
    // 2 -> [0, 2]
    expect(result).toStrictEqual([[], [0], [0], [0, 2]]);
  });

  it("supports deeply nested maps", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using arr = stub.getArray(3);
    const result = await arr.map((i: any) => {
      return stub.getArray(i).map((j: any) => {
        return stub.getArray(j);
      });
    });

    // i=0 -> []
    // i=1 -> j=0 -> []
    // i=2 -> j=0 -> [], j=1 -> [0]
    expect(result).toStrictEqual([
      [],
      [[]],
      [[], [0]]
    ]);
  });
});

describe("map - over RPC session", () => {
  it("supports map over remote arrays with RPC transformation", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    // Add a triple method to the target
    class ExtendedMapTestTarget extends MapTestTarget {
      triple(x: number) { return x * 3; }
    }

    const client = new RpcSession<ExtendedMapTestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new ExtendedMapTestTarget());

    const stub = client.getRemoteMain();

    using promise = stub.getArray(4);
    const result = await promise.map((x: any) => stub.triple(x));

    expect(result).toStrictEqual([0, 3, 6, 9]);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("supports map with remote RPC calls inside mapper", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<MapTestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new MapTestTarget());

    const stub = client.getRemoteMain();

    using fib = stub.getFibonacci(5);
    using counters = await fib.map((i: any) => stub.makeCounter(i));

    const values = [];
    for (let i = 0; i < counters.length; i++) {
      values.push(await counters[i].getValue());
    }

    expect(values).toStrictEqual([0, 1, 1, 2, 3]);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("supports nested maps over RPC", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<MapTestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new MapTestTarget());

    const stub = client.getRemoteMain();

    using fib = stub.getFibonacci(5);
    using result = await fib.map((i: any) => {
      return stub.getArray(i).map((j: any) => j);
    });

    expect(result).toStrictEqual([
      [],           // 0
      [0],          // 1
      [0],          // 1
      [0, 1],       // 2
      [0, 1, 2]     // 3
    ]);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("map - error handling", () => {
  it("throws error when mapper is async", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(3);

    // Async map callbacks are not allowed
    expect(() => {
      promise.map(() => {
        return Promise.resolve(42);
      });
    }).toThrow("Cannot serialize value: [object Promise]");
  });

  it("handles errors from remote mapper gracefully", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    class ErrorTarget extends RpcTarget {
      getArray() { return [1, 2, 3]; }
      throwError() { throw new Error("map error"); }
    }

    const client = new RpcSession<ErrorTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new ErrorTarget());

    const stub = client.getRemoteMain();

    using arr = stub.getArray();

    // When we map over the array and call throwError, we should get an error
    using result = arr.map((x: any) => stub.throwError());

    await expect(() => result).rejects.toThrow("map error");

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });
});

describe("map - complex transformations", () => {
  it("can transform array elements to objects with RPC", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(3);
    const result = await promise.map((x: any) => ({
      value: x,
      doubled: stub.double(x),
      // Note: squared uses RPC
      counter: stub.makeCounter(x)
    }));

    // Value should be the original, doubled comes from RPC
    const values = await Promise.all(result.map((r: any) => r.value));
    expect(values).toStrictEqual([0, 1, 2]);

    const doubled = await Promise.all(result.map((r: any) => r.doubled));
    expect(doubled).toStrictEqual([0, 2, 4]);
  });

  it("works with identity returning original values", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(5);
    // Identity function passes through the value
    const result = await promise.map((x: any) => x);

    expect(result).toStrictEqual([0, 1, 2, 3, 4]);
  });

  it("works with counter side effects", async () => {
    const counter = new RpcStub(new Counter(0));
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(5);
    const result = await promise.map((x: any) => {
      counter.increment();
      return stub.double(x);
    });

    expect(result).toStrictEqual([0, 2, 4, 6, 8]);
    expect(await counter.getValue()).toBe(5);
  });
});

describe("map - RpcStub.map() method", () => {
  it("map is available on RpcStub", () => {
    const stub = new RpcStub(new MapTestTarget());
    expect(typeof stub.map).toBe("function");
  });

  it("map is available on RpcPromise", async () => {
    const stub = new RpcStub(new MapTestTarget());
    const promise = stub.getArray(3);
    expect(typeof promise.map).toBe("function");
  });

  it("map returns an RpcPromise", async () => {
    const stub = new RpcStub(new MapTestTarget());
    using promise = stub.getArray(3);
    const mapped = promise.map((x: any) => x);

    // Should be thenable
    expect(typeof mapped.then).toBe("function");

    // Should have disposal
    expect(typeof mapped[Symbol.dispose]).toBe("function");
  });
});

describe("map - with pipelined results", () => {
  it("can use pipelined values in map with RPC", async () => {
    const clientTransport = new TestTransport("client");
    const serverTransport = new TestTransport("server", clientTransport);

    const client = new RpcSession<MapTestTarget>(clientTransport);
    const server = new RpcSession(serverTransport, new MapTestTarget());

    const stub = client.getRemoteMain();

    // Get an array without awaiting
    using arr = stub.getArray(3);

    // Map over it using RPC - this uses pipelining
    using doubled = arr.map((x: any) => stub.double(x));

    // Now await the result
    const result = await doubled;
    expect(result).toStrictEqual([0, 2, 4]);

    stub[Symbol.dispose]();
    await pumpMicrotasks();
  });

  it("can chain multiple maps with RPC", async () => {
    const stub = new RpcStub(new MapTestTarget());

    using promise = stub.getArray(3);
    using doubled = promise.map((x: any) => stub.double(x));
    const result = await doubled.map((y: any) => stub.addOne(y));

    expect(result).toStrictEqual([1, 3, 5]); // [0*2+1, 1*2+1, 2*2+1]
  });
});
