/**
 * Server-side .map() with record/replay support
 *
 * The key feature that eliminates N+1 round trips by executing
 * map operations on the server.
 */

import type { RpcClient, CapabilityRef } from './client.js';
import { RpcPromise } from './promise.js';

/**
 * Recorded RPC call for replay
 */
export interface RecordedCall {
  readonly timestamp: number;
  readonly target: number;  // Capability ID
  readonly method: string;
  readonly args: unknown[];
  readonly result?: unknown;
  readonly error?: string;
  readonly duration: number;
}

/**
 * Recording session containing multiple calls
 */
export interface Recording {
  readonly id: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly calls: readonly RecordedCall[];
}

/**
 * Map operation specification sent to server
 */
export interface MapSpec {
  /** JavaScript expression to execute for each item */
  expression: string;
  /** Captured variables (capability IDs) */
  captures: Record<string, number>;
}

/**
 * Result of server map operation
 */
export interface MapResult<T> {
  /** The transformed array */
  results: T[];
  /** Number of round trips used */
  roundTrips: number;
  /** Any errors that occurred */
  errors?: Array<{ index: number; error: string }>;
}

/**
 * Options for the map operation
 */
export interface MapOptions {
  /** Enable recording of the map operation */
  record?: boolean;
  /** Execute from recorded data instead of making real calls */
  replay?: Recording;
  /** Transform function applied to results */
  transform?: <T>(result: T, index: number) => T;
  /** Error handling mode */
  onError?: 'throw' | 'skip' | 'null';
}

/**
 * Recorder class for capturing RPC calls
 */
export class RpcRecorder {
  private _recording: boolean = false;
  private _calls: RecordedCall[] = [];
  private _startTime: number = 0;

  /**
   * Start recording
   */
  start(): void {
    this._recording = true;
    this._calls = [];
    this._startTime = Date.now();
  }

  /**
   * Stop recording and return the recording
   */
  stop(): Recording {
    this._recording = false;
    return {
      id: crypto.randomUUID(),
      startTime: this._startTime,
      endTime: Date.now(),
      calls: Object.freeze([...this._calls]),
    };
  }

  /**
   * Check if currently recording
   */
  get isRecording(): boolean {
    return this._recording;
  }

  /**
   * Record a call
   */
  recordCall(call: Omit<RecordedCall, 'timestamp'>): void {
    if (this._recording) {
      this._calls.push({
        ...call,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Replayer class for executing from recorded data
 */
export class RpcReplayer {
  private _recording: Recording;
  private _index: number = 0;

  constructor(recording: Recording) {
    this._recording = recording;
  }

  /**
   * Get the next recorded call result
   */
  next(): RecordedCall | undefined {
    if (this._index < this._recording.calls.length) {
      return this._recording.calls[this._index++];
    }
    return undefined;
  }

  /**
   * Reset to the beginning
   */
  reset(): void {
    this._index = 0;
  }

  /**
   * Check if there are more calls
   */
  hasMore(): boolean {
    return this._index < this._recording.calls.length;
  }
}

/**
 * Execute a server-side map operation
 *
 * This is the core function that eliminates N+1 round trips by
 * sending the map expression to the server for execution.
 *
 * @param client - The RPC client
 * @param array - The array to map over (or promise of array)
 * @param fn - The mapping function
 * @param options - Map options
 */
export async function serverMap<T, U>(
  client: RpcClient<unknown>,
  array: T[] | Promise<T[]>,
  fn: (item: T) => U,
  options?: MapOptions
): Promise<U[]> {
  // Resolve the array if it's a promise
  const resolvedArray = await array;

  // Handle null/undefined
  if (resolvedArray === null || resolvedArray === undefined) {
    return [] as unknown as U[];
  }

  // Handle empty array
  if (resolvedArray.length === 0) {
    return [];
  }

  // Extract the function body for server execution
  const fnStr = fn.toString();

  // Execute via client's serverMap
  const result = await client.serverMap(resolvedArray, fnStr, {});

  // Apply transform if specified
  if (options?.transform && Array.isArray(result)) {
    return result.map((item, index) => options.transform!(item as U, index));
  }

  return result as U[];
}

/**
 * Create a server map operation from a capability
 */
export function createServerMap<T extends unknown[], U>(
  client: RpcClient<unknown>,
  capabilityId: number
): {
  map<V>(fn: (item: T[number]) => V): Promise<V[]>;
} {
  return {
    async map<V>(fn: (item: T[number]) => V): Promise<V[]> {
      const fnStr = fn.toString();
      const result = await client.serverMap(
        { __capabilityId: capabilityId } as unknown,
        fnStr,
        {}
      );
      return result as V[];
    },
  };
}

/**
 * Serialize a function for transmission to server
 *
 * This extracts the function body and any captured variables.
 */
export function serializeFunction(fn: Function): { expression: string; captures: string[] } {
  const fnStr = fn.toString();

  // Extract captured variable names (simple heuristic)
  const captures: string[] = [];

  // Look for $name patterns indicating captured capabilities
  const captureRegex = /\$(\w+)/g;
  let match;
  while ((match = captureRegex.exec(fnStr)) !== null) {
    if (!captures.includes(match[1])) {
      captures.push(match[1]);
    }
  }

  return {
    expression: fnStr,
    captures,
  };
}

/**
 * Deserialize a function from server
 */
export function deserializeFunction(spec: { expression: string; captures: Record<string, unknown> }): Function {
  const args = Object.keys(spec.captures);
  const body = `return (${spec.expression})(item)`;
  return new Function(...args, 'item', body);
}
