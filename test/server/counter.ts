// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Counter capability implementation for conformance tests.
 *
 * This implements the Counter interface expected by the conformance tests:
 * - value: number (property getter)
 * - increment(by: number): number
 * - decrement(by: number): number
 */

import { RpcTarget } from '../../src/index.js';

export class Counter extends RpcTarget {
  private _value: number;

  constructor(initial: number = 0) {
    super();
    this._value = initial;
  }

  /**
   * Get the current counter value
   */
  get value(): number {
    return this._value;
  }

  /**
   * Increment the counter by the specified amount
   * @param by Amount to increment (default 1)
   * @returns The new counter value
   */
  increment(by: number = 1): number {
    this._value += by;
    return this._value;
  }

  /**
   * Decrement the counter by the specified amount
   * @param by Amount to decrement (default 1)
   * @returns The new counter value
   */
  decrement(by: number = 1): number {
    this._value -= by;
    return this._value;
  }
}
