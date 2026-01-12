/**
 * RpcPromise - A Promise with pipelining support
 *
 * Enables chaining method calls without waiting for previous results,
 * allowing multiple operations to be batched into a single round trip.
 */

import type { RpcClient } from './client.js';

/**
 * Operation type for pipeline
 */
export interface PipelineOp {
  type: 'call' | 'get';
  method?: string;
  property?: string;
  args?: unknown[];
}

/**
 * A promise that supports pipelining operations
 */
export class RpcPromise<T> extends Promise<T> {
  private _client: RpcClient<unknown>;
  private _ops: PipelineOp[];
  private _capabilityId?: number;

  constructor(
    executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void,
    client: RpcClient<unknown>,
    ops: PipelineOp[] = [],
    capabilityId?: number
  ) {
    super(executor);
    this._client = client;
    this._ops = ops;
    this._capabilityId = capabilityId;
  }

  /**
   * Get a property from the result
   */
  get<K extends keyof T>(key: K): RpcPromise<T[K]> {
    const newOps = [...this._ops, { type: 'get' as const, property: String(key) }];

    return new RpcPromise<T[K]>(
      (resolve, reject) => {
        this.then(value => {
          if (value && typeof value === 'object') {
            resolve((value as Record<string, unknown>)[String(key)] as T[K]);
          } else {
            reject(new Error(`Cannot get property ${String(key)} of ${typeof value}`));
          }
        }).catch(reject);
      },
      this._client,
      newOps,
      this._capabilityId
    );
  }

  /**
   * Call a method on the result
   */
  call(method: string, ...args: unknown[]): RpcPromise<unknown> {
    const newOps = [...this._ops, { type: 'call' as const, method, args }];

    return new RpcPromise<unknown>(
      (resolve, reject) => {
        this.then(async value => {
          // If value is a capability reference, call through the client
          if (value && typeof value === 'object' && '__capabilityId' in (value as object)) {
            const result = await this._client.callOnCapability(value, method, ...args);
            resolve(result);
          } else if (value && typeof value === 'object') {
            const fn = (value as Record<string, unknown>)[method];
            if (typeof fn === 'function') {
              resolve(fn.apply(value, args));
            } else {
              reject(new Error(`${method} is not a function`));
            }
          } else {
            reject(new Error(`Cannot call method on ${typeof value}`));
          }
        }).catch(reject);
      },
      this._client,
      newOps,
      this._capabilityId
    );
  }

  /**
   * Server-side map operation
   * Maps a function over an array on the server, avoiding N round trips
   */
  map<U>(fn: (item: T extends (infer I)[] ? I : T) => U): RpcPromise<U[]> {
    // Extract the function body for server execution
    const fnStr = fn.toString();

    return new RpcPromise<U[]>(
      (resolve, reject) => {
        this.then(async value => {
          try {
            const result = await this._client.serverMap(value, fnStr, {});
            resolve(result as U[]);
          } catch (error) {
            reject(error);
          }
        }).catch(reject);
      },
      this._client,
      this._ops,
      this._capabilityId
    );
  }

  /**
   * Get the pipeline operations
   */
  getPipelineOps(): PipelineOp[] {
    return [...this._ops];
  }

  /**
   * Get the capability ID if this promise represents a capability
   */
  getCapabilityId(): number | undefined {
    return this._capabilityId;
  }

  /**
   * Create an RpcPromise from a regular promise
   */
  static from<T>(promise: Promise<T>, client: RpcClient<unknown>, ops: PipelineOp[] = [], capId?: number): RpcPromise<T> {
    return new RpcPromise<T>(
      (resolve, reject) => {
        promise.then(resolve).catch(reject);
      },
      client,
      ops,
      capId
    );
  }
}

/**
 * Pipeline builder for batching multiple operations
 */
export class PipelineBuilder {
  private _client: RpcClient<unknown>;
  private _steps: Array<{
    target?: string;
    method: string;
    args: unknown[];
    as?: string;
  }> = [];
  private _lastAs?: string;

  constructor(client: RpcClient<unknown>) {
    this._client = client;
  }

  /**
   * Add a method call to the pipeline
   */
  call(method: string, ...args: unknown[]): this {
    this._steps.push({ method, args });
    return this;
  }

  /**
   * Call a method on a previously named result
   */
  callOn(targetName: string, method: string, ...args: unknown[]): this {
    this._steps.push({ target: targetName, method, args });
    return this;
  }

  /**
   * Name the result of the previous step
   */
  as(name: string): this {
    if (this._steps.length > 0) {
      this._steps[this._steps.length - 1].as = name;
      this._lastAs = name;
    }
    return this;
  }

  /**
   * Execute the pipeline
   */
  async execute(): Promise<Record<string, unknown> & { __last: unknown }> {
    return this._client.executePipeline(this._steps);
  }
}
