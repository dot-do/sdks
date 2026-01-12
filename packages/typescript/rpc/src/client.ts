/**
 * RpcClient - The main RPC client with WebSocket transport
 *
 * Supports both real WebSocket connections and mock servers for testing.
 */

import type {
  MockServerInterface,
  RpcRequest,
  RpcResponse,
  PipelinedRequest,
} from './types.js';
import { RpcPromise, PipelineBuilder } from './promise.js';
import { createProxy, CapabilityProxy } from './proxy.js';

/**
 * Connection options
 */
export interface ConnectOptions {
  /** Authentication token */
  token?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Connection timeout in ms */
  timeout?: number;
  /** Enable auto-reconnect */
  autoReconnect?: boolean;
}

/**
 * Capability reference
 */
export interface CapabilityRef {
  __capabilityId: number;
}

/**
 * Check if a value is a capability reference
 */
export function isCapabilityRef(value: unknown): value is CapabilityRef {
  return (
    value !== null &&
    typeof value === 'object' &&
    '__capabilityId' in value &&
    typeof (value as CapabilityRef).__capabilityId === 'number'
  );
}

/**
 * Pipeline step for batched execution
 */
export interface PipelineStep {
  target?: string;
  method: string;
  args: unknown[];
  as?: string;
}

/**
 * RpcClient class
 */
export class RpcClient<T> {
  private _nextRequestId = 1;
  private _server: MockServerInterface | null = null;
  private _ws: WebSocket | null = null;
  private _url: string | null = null;
  private _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _capabilities = new Map<number, CapabilityProxy>();
  private _exportedCallbacks = new Map<string, (x: number) => number>();
  private _proxy: T;

  constructor(serverOrUrl: MockServerInterface | string, _options?: ConnectOptions) {
    if (typeof serverOrUrl === 'string') {
      this._url = serverOrUrl;
      // Real WebSocket connection would be established here
      // For now, we just store the URL
    } else {
      this._server = serverOrUrl;
    }

    // Create the proxy for method access
    this._proxy = createProxy(this, []) as T;
  }

  /**
   * Proxy for direct method access
   * Usage: client.$.methodName(args)
   */
  get $(): T {
    return this._proxy;
  }

  /**
   * Get self reference (capability ID 0)
   */
  getSelf(): CapabilityRef {
    return { __capabilityId: 0 };
  }

  /**
   * Export a callback function for server to call
   */
  exportCallback(name: string, fn: (x: number) => number): void {
    this._exportedCallbacks.set(name, fn);
  }

  /**
   * Get an exported callback
   */
  getExportedCallback(name: string): ((x: number) => number) | undefined {
    return this._exportedCallbacks.get(name);
  }

  /**
   * Make an RPC call
   */
  async call(method: string, ...args: unknown[]): Promise<unknown> {
    const request: RpcRequest = {
      id: this._nextRequestId++,
      method,
      target: 0,  // Root capability
      args: this.serializeArgs(args),
    };

    return this.sendRequest(request);
  }

  /**
   * Call a method on a capability
   */
  async callOnCapability(capability: unknown, method: string, ...args: unknown[]): Promise<unknown> {
    let targetId: number;

    if (isCapabilityRef(capability)) {
      targetId = capability.__capabilityId;
    } else if (typeof capability === 'object' && capability !== null && '$ref' in capability) {
      targetId = (capability as { $ref: number }).$ref;
    } else {
      throw new Error('Invalid capability reference');
    }

    const request: RpcRequest = {
      id: this._nextRequestId++,
      method,
      target: targetId,
      args: this.serializeArgs(args),
    };

    return this.sendRequest(request);
  }

  /**
   * Start building a pipeline
   */
  pipeline(): PipelineBuilder {
    return new PipelineBuilder(this as unknown as RpcClient<unknown>);
  }

  /**
   * Execute a pipeline using the server's native pipeline support
   */
  async executePipeline(steps: PipelineStep[]): Promise<Record<string, unknown> & { __last: unknown }> {
    if (!this._server) {
      throw new Error('Pipeline execution not yet supported over WebSocket');
    }

    // Convert to PipelinedRequest format
    const pipelineSteps = steps.map(step => {
      // Parse method to determine target
      let method = step.method;
      let target: number | string | undefined;

      if (step.target) {
        target = step.target;
      }

      // Resolve arguments - convert $name to step references
      const resolvedArgs = step.args.map(arg => {
        if (typeof arg === 'string' && arg.startsWith('$')) {
          const name = arg.substring(1);
          if (name === 'self') {
            return { $ref: 0 };
          }
          return { $step: name };
        }
        if (isCapabilityRef(arg)) {
          return { $ref: arg.__capabilityId };
        }
        return arg;
      });

      return {
        method,
        target,
        args: resolvedArgs,
        as: step.as,
      };
    });

    const request: PipelinedRequest = {
      id: this._nextRequestId++,
      steps: pipelineSteps,
    };

    const responses = this._server.processPipeline(request);

    // Build results
    const results: Record<string, unknown> = {};
    let lastResult: unknown;

    for (const step of steps) {
      if (step.as && responses[step.as]) {
        const response = responses[step.as];
        if (response.error) {
          throw new Error(response.error.message);
        }
        results[step.as] = response.result;
        lastResult = response.result;
      }
    }

    return { ...results, __last: lastResult };
  }

  /**
   * Server-side map operation - executes in a single round trip
   */
  async serverMap(
    value: unknown,
    expression: string,
    captures: Record<string, unknown>
  ): Promise<unknown> {
    if (!this._server) {
      throw new Error('Server map not yet supported over WebSocket');
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return null;
    }

    // Get the capability ID for the value if it's a capability
    let targetCapId: number;
    if (isCapabilityRef(value)) {
      targetCapId = value.__capabilityId;
    } else {
      // Register the value as a temporary capability (doesn't count as round trip)
      targetCapId = this._server.registerCapability(value);
    }

    // Build captures with capability IDs
    const captureIds: Record<string, number> = {};
    for (const [name, cap] of Object.entries(captures)) {
      if (isCapabilityRef(cap)) {
        captureIds[name] = cap.__capabilityId;
      } else if (cap && typeof cap === 'object' && '$ref' in cap) {
        captureIds[name] = (cap as { $ref: number }).$ref;
      } else {
        // Register as temporary capability
        captureIds[name] = this._server.registerCapability(cap);
      }
    }

    const response = this._server.processMapRequest({
      id: this._nextRequestId++,
      target: targetCapId,
      expression,
      captures: captureIds,
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }

  /**
   * Execute a method call and map operation in a single round trip
   */
  async callAndMap(
    method: string,
    args: unknown[],
    mapExpression: string,
    captures: Record<string, unknown>
  ): Promise<unknown> {
    if (!this._server) {
      throw new Error('callAndMap not yet supported over WebSocket');
    }

    // Build captures with capability IDs
    const captureIds: Record<string, number> = {};
    for (const [name, cap] of Object.entries(captures)) {
      if (isCapabilityRef(cap)) {
        captureIds[name] = cap.__capabilityId;
      } else if (cap && typeof cap === 'object' && '$ref' in cap) {
        captureIds[name] = (cap as { $ref: number }).$ref;
      } else {
        captureIds[name] = this._server.registerCapability(cap);
      }
    }

    // Execute in a single batch: first call the method, then map
    const request: RpcRequest = {
      id: this._nextRequestId++,
      method,
      target: 0,
      args: this.serializeArgs(args),
    };

    // Use processBatchWithMap which combines call + map in one round trip
    const result = await this._server.processCallAndMap(request, mapExpression, captureIds);

    if (result.error) {
      throw new Error(result.error.message);
    }

    return result.result;
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._server = null;
    this._pending.clear();
    this._capabilities.clear();
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest(request: RpcRequest): Promise<unknown> {
    if (this._server) {
      // Mock server - direct call
      const responses = this._server.processBatch([request]);
      const response = responses[0];

      if (response.error) {
        const error = new Error(response.error.message);
        error.name = response.error.type;
        throw error;
      }

      // Handle capability results
      if (response.capabilityId !== undefined) {
        return { __capabilityId: response.capabilityId };
      }

      return response.result;
    }

    if (this._ws) {
      // Real WebSocket - send and await response
      return new Promise((resolve, reject) => {
        this._pending.set(request.id, { resolve, reject });
        this._ws!.send(JSON.stringify(request));
      });
    }

    throw new Error('Not connected');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    const response = JSON.parse(data) as RpcResponse;
    const pending = this._pending.get(response.id);

    if (pending) {
      this._pending.delete(response.id);

      if (response.error) {
        const error = new Error(response.error.message);
        error.name = response.error.type;
        pending.reject(error);
      } else {
        let result = response.result;
        if (response.capabilityId !== undefined) {
          result = { __capabilityId: response.capabilityId };
        }
        pending.resolve(result);
      }
    }
  }

  /**
   * Serialize arguments, converting capability refs
   */
  private serializeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      if (arg && typeof arg === 'object' && '$ref' in arg) {
        return arg;  // Already serialized
      }
      return arg;
    });
  }

  /**
   * Resolve step arguments, converting named refs to capability IDs
   */
  private resolveStepArgs(args: unknown[], tempCaps: Map<string, number>): unknown[] {
    return args.map(arg => {
      if (typeof arg === 'string' && arg.startsWith('$')) {
        const name = arg.substring(1);
        if (name === 'self') {
          return { $ref: 0 };
        }
        const capId = tempCaps.get(name);
        if (capId !== undefined) {
          return { $ref: capId };
        }
      }
      if (isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      return arg;
    });
  }
}

/**
 * Create an RpcPromise for a call
 */
export function createRpcPromise<T>(
  client: RpcClient<unknown>,
  method: string,
  args: unknown[]
): RpcPromise<T> {
  return RpcPromise.from(
    client.call(method, ...args) as Promise<T>,
    client
  );
}
