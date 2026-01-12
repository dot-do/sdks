// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * TestTarget method implementations for conformance tests.
 *
 * This implements the TestTarget interface expected by the conformance tests
 * in test/conformance/*.yaml
 */

import { RpcTarget, RpcStub } from '../../src/index.js';
import { Counter } from './counter.js';

// Distinct function so we can search for it in the stack trace
function throwErrorImpl(): never {
  throw new RangeError("test error");
}

/**
 * TestTarget - main RPC target for conformance tests
 *
 * Implements:
 * - square(n: number): number
 * - returnNumber(n: number): number
 * - returnNull(): null
 * - returnUndefined(): undefined
 * - makeCounter(initial: number): Counter
 * - generateFibonacci(n: number): number[]
 * - callFunction(stub: any, method: string, args: any[]): any
 * - callSquare(self: RpcStub, i: number): { result: Promise<number> }
 * - incrementCounter(c: RpcStub<Counter>, i: number): Promise<number>
 * - throwError(): never
 */
export class TestTarget extends RpcTarget {
  /**
   * Square a number
   */
  square(n: number): number {
    return n * n;
  }

  /**
   * Return the given number unchanged
   */
  returnNumber(n: number): number {
    return n;
  }

  /**
   * Return null
   */
  returnNull(): null {
    return null;
  }

  /**
   * Return undefined
   */
  returnUndefined(): undefined {
    return undefined;
  }

  /**
   * Create a new Counter with the given initial value
   */
  makeCounter(initial: number): Counter {
    return new Counter(initial);
  }

  /**
   * Generate the first n Fibonacci numbers
   */
  generateFibonacci(n: number): number[] {
    if (n <= 0) return [];
    if (n === 1) return [0];

    const result = [0, 1];
    while (result.length < n) {
      const next = result[result.length - 1] + result[result.length - 2];
      result.push(next);
    }
    return result.slice(0, n);
  }

  /**
   * Call a function stub with arguments (for callback tests)
   */
  async callFunction(
    func: RpcStub<(i: number) => Promise<number>>,
    i: number
  ): Promise<{ result: number }> {
    const result = await func(i);
    return { result };
  }

  /**
   * Call square on a TestTarget stub (for self-reference tests)
   */
  callSquare(
    self: RpcStub<TestTarget>,
    i: number
  ): { result: ReturnType<RpcStub<TestTarget>['square']> } {
    return { result: self.square(i) };
  }

  /**
   * Increment a Counter stub (for capability passing tests)
   */
  incrementCounter(
    counter: RpcStub<Counter>,
    by: number = 1
  ): ReturnType<RpcStub<Counter>['increment']> {
    return counter.increment(by);
  }

  /**
   * Throw an error (for error handling tests)
   */
  throwError(): never {
    throwErrorImpl();
  }
}
