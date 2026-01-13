/**
 * WebSocket RPC client for conformance testing
 * Connects to any language's server implementation
 */

import WebSocket from 'ws';

/**
 * Message types for the RPC protocol
 */
interface RpcRequest {
  id: number;
  method: string;
  target?: number;
  args?: unknown[];
}

interface RpcPipelineRequest {
  id: number;
  steps: Array<{
    method: string;
    target?: string | number;
    args: unknown[];
    as?: string;
  }>;
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: {
    type: string;
    message: string;
  };
}

interface RpcPipelineResponse {
  id: number;
  results?: Record<string, { result?: unknown; error?: { type: string; message: string } }>;
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Capability reference (stub)
 */
export interface CapabilityRef {
  __capabilityId: number;
}

/**
 * RPC client for conformance testing
 */
export class ConformanceClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private connected = false;
  private capabilities = new Map<number, unknown>();
  private roundTripCount = 0;

  /**
   * Connect to a WebSocket server
   */
  async connect(url: string, timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);

      try {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          clearTimeout(timer);
          this.connected = true;
          resolve();
        });

        this.ws.on('message', (data: Buffer | string) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (error) => {
          clearTimeout(timer);
          this.connected = false;
          reject(error);
        });

        this.ws.on('close', () => {
          this.connected = false;
          // Reject all pending requests
          for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('Connection closed'));
            this.pendingRequests.delete(id);
          }
        });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.clear();
    this.capabilities.clear();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get round trip count (for testing pipelining efficiency)
   */
  getRoundTripCount(): number {
    return this.roundTripCount;
  }

  /**
   * Reset round trip counter
   */
  resetRoundTrips(): void {
    this.roundTripCount = 0;
  }

  /**
   * Call a method on the root object
   */
  async call(method: string, ...args: unknown[]): Promise<unknown> {
    return this.sendRequest({ method, args });
  }

  /**
   * Call a method on a capability
   */
  async callOnCapability(
    capability: CapabilityRef | unknown,
    method: string,
    ...args: unknown[]
  ): Promise<unknown> {
    const target = this.getCapabilityId(capability);
    return this.sendRequest({ method, target, args });
  }

  /**
   * Execute a pipeline of calls in a single round trip
   */
  async pipeline(
    steps: Array<{
      method: string;
      target?: string | number | CapabilityRef;
      args?: unknown[];
      as?: string;
    }>
  ): Promise<Record<string, unknown>> {
    const resolvedSteps = steps.map((step) => ({
      method: step.method,
      target: this.resolveTarget(step.target),
      args: this.resolveArgs(step.args || []),
      as: step.as,
    }));

    const id = ++this.requestId;
    const request: RpcPipelineRequest = { id, steps: resolvedSteps };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          const pipelineResp = response as RpcPipelineResponse;
          if (pipelineResp.error) {
            const err = new Error(pipelineResp.error.message);
            err.name = pipelineResp.error.type;
            reject(err);
          } else if (pipelineResp.results) {
            // Process results and extract capabilities
            const results: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(pipelineResp.results)) {
              if (value.error) {
                results[key] = { error: value.error };
              } else {
                results[key] = this.processResult(value.result);
              }
            }
            resolve(results);
          } else {
            resolve({});
          }
        },
        reject,
      });

      this.sendRaw(request);
    });
  }

  /**
   * Get self reference (capability ID 0)
   */
  getSelf(): CapabilityRef {
    return { __capabilityId: 0 };
  }

  /**
   * Check if a value is a capability reference
   */
  isCapabilityRef(value: unknown): value is CapabilityRef {
    return (
      typeof value === 'object' &&
      value !== null &&
      '__capabilityId' in value &&
      typeof (value as CapabilityRef).__capabilityId === 'number'
    );
  }

  private async sendRequest(request: Omit<RpcRequest, 'id'>): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error('Not connected');
    }

    const id = ++this.requestId;
    const fullRequest: RpcRequest = { id, ...request };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (response) => {
          const rpcResp = response as RpcResponse;
          if (rpcResp.error) {
            const err = new Error(rpcResp.error.message);
            err.name = rpcResp.error.type;
            reject(err);
          } else {
            resolve(this.processResult(rpcResp.result));
          }
        },
        reject,
      });

      this.sendRaw(fullRequest);
    });
  }

  private sendRaw(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not open');
    }

    this.roundTripCount++;
    this.ws.send(JSON.stringify(data));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle response
      if ('id' in message && this.pendingRequests.has(message.id)) {
        const { resolve } = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        resolve(message);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private processResult(result: unknown): unknown {
    if (result === null || result === undefined) {
      return result;
    }

    // Check for capability reference
    if (typeof result === 'object' && '$ref' in (result as object)) {
      const capId = (result as { $ref: number }).$ref;
      const capRef: CapabilityRef = { __capabilityId: capId };
      this.capabilities.set(capId, capRef);
      return capRef;
    }

    // Process arrays
    if (Array.isArray(result)) {
      return result.map((item) => this.processResult(item));
    }

    // Process objects
    if (typeof result === 'object') {
      const processed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(result)) {
        processed[key] = this.processResult(value);
      }
      return processed;
    }

    return result;
  }

  private getCapabilityId(capability: unknown): number {
    if (this.isCapabilityRef(capability)) {
      return capability.__capabilityId;
    }
    throw new Error('Invalid capability reference');
  }

  private resolveTarget(target: string | number | CapabilityRef | undefined): string | number | undefined {
    if (target === undefined) {
      return undefined;
    }
    if (typeof target === 'string' || typeof target === 'number') {
      return target;
    }
    if (this.isCapabilityRef(target)) {
      return target.__capabilityId;
    }
    return undefined;
  }

  private resolveArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (this.isCapabilityRef(arg)) {
        return { $ref: arg.__capabilityId };
      }
      if (Array.isArray(arg)) {
        return this.resolveArgs(arg);
      }
      if (typeof arg === 'object' && arg !== null) {
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(arg)) {
          resolved[key] = this.resolveArgs([value])[0];
        }
        return resolved;
      }
      return arg;
    });
  }
}
