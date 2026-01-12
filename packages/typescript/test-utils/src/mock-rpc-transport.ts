/**
 * MockRpcTransport - A reusable mock RPC transport for testing
 *
 * This class provides a flexible mock implementation of the RpcTransport interface
 * that can be used across different SDK tests. It supports:
 * - Call logging for verification
 * - Custom method handlers
 * - Response delays for async testing
 * - Error simulation
 */

import type {
  RpcTransport,
  CallLogEntry,
  MockResponse,
  MockTransportOptions,
} from './types.js';

/**
 * Base mock RPC transport for testing
 *
 * @example
 * ```typescript
 * const transport = new MockRpcTransport();
 *
 * // Register a custom handler
 * transport.on('myMethod', (arg1, arg2) => ({ result: arg1 + arg2 }));
 *
 * // Make a call
 * const result = await transport.call('myMethod', 1, 2);
 *
 * // Verify calls
 * expect(transport.callLog).toHaveLength(1);
 * expect(transport.callLog[0].method).toBe('myMethod');
 * ```
 */
export class MockRpcTransport implements RpcTransport {
  private _closed = false;
  private _callLog: CallLogEntry[] = [];
  private _handlers: Map<string, (...args: unknown[]) => unknown | Promise<unknown>> = new Map();
  private _mockResponses: Map<string, MockResponse[]> = new Map();
  private _options: Required<MockTransportOptions>;

  constructor(options: MockTransportOptions = {}) {
    this._options = {
      defaultDelay: options.defaultDelay ?? 0,
      enableCallLog: options.enableCallLog ?? true,
      handlers: options.handlers ?? {},
    };

    // Register initial handlers
    for (const [method, handler] of Object.entries(this._options.handlers)) {
      this._handlers.set(method, handler);
    }

    // Register default handlers
    this._registerDefaultHandlers();
  }

  /**
   * Register default handlers for common methods
   */
  private _registerDefaultHandlers(): void {
    // Connection methods
    this.on('connect', () => ({ ok: 1 }));
    this.on('ping', () => ({ ok: 1 }));
    this.on('close', () => ({ ok: 1 }));
  }

  /**
   * Get the call log
   */
  get callLog(): readonly CallLogEntry[] {
    return this._callLog;
  }

  /**
   * Check if the transport is closed
   */
  get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Clear the call log
   */
  clearCallLog(): void {
    this._callLog = [];
  }

  /**
   * Register a method handler
   */
  on(method: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): this {
    this._handlers.set(method, handler);
    return this;
  }

  /**
   * Remove a method handler
   */
  off(method: string): this {
    this._handlers.delete(method);
    return this;
  }

  /**
   * Queue a mock response for a method
   * Responses are consumed in FIFO order
   */
  mockResponse(method: string, response: MockResponse): this {
    const queue = this._mockResponses.get(method) ?? [];
    queue.push(response);
    this._mockResponses.set(method, queue);
    return this;
  }

  /**
   * Queue an error response for a method
   */
  mockError(method: string, error: Error, delay?: number): this {
    return this.mockResponse(method, { error, delay });
  }

  /**
   * Make an RPC call
   */
  async call(method: string, ...args: unknown[]): Promise<unknown> {
    if (this._closed) {
      throw new Error('Transport is closed');
    }

    // Log the call
    if (this._options.enableCallLog) {
      this._callLog.push({
        method,
        args,
        timestamp: Date.now(),
      });
    }

    // Check for queued mock responses
    const responseQueue = this._mockResponses.get(method);
    if (responseQueue && responseQueue.length > 0) {
      const response = responseQueue.shift()!;
      if (response.delay) {
        await this._delay(response.delay);
      }
      if (response.error) {
        throw response.error;
      }
      return response.result;
    }

    // Check for a handler
    const handler = this._handlers.get(method);
    if (handler) {
      if (this._options.defaultDelay > 0) {
        await this._delay(this._options.defaultDelay);
      }
      return handler(...args);
    }

    throw new Error(`Unknown method: ${method}`);
  }

  /**
   * Close the transport
   */
  async close(): Promise<void> {
    this._closed = true;
  }

  /**
   * Reset the transport to initial state
   */
  reset(): void {
    this._closed = false;
    this._callLog = [];
    this._mockResponses.clear();
  }

  /**
   * Helper to create a delay
   */
  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get calls for a specific method
   */
  getCallsForMethod(method: string): CallLogEntry[] {
    return this._callLog.filter(entry => entry.method === method);
  }

  /**
   * Check if a method was called
   */
  wasMethodCalled(method: string): boolean {
    return this._callLog.some(entry => entry.method === method);
  }

  /**
   * Get the last call for a method
   */
  getLastCall(method: string): CallLogEntry | undefined {
    const calls = this.getCallsForMethod(method);
    return calls[calls.length - 1];
  }
}
