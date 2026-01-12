/**
 * Mock test server that implements the conformance test interface
 * This runs in the same process for testing purposes
 */

export interface Counter {
  value(): number;
  increment(by: number): number;
}

export interface TestTarget {
  // Basic methods
  square(x: number): number;
  returnNumber(x: number): number;
  returnNull(): null;
  returnUndefined(): undefined;
  generateFibonacci(n: number): number[];
  throwError(): never;

  // Counter factory
  makeCounter(initial: number): Counter;
  incrementCounter(counter: Counter, by: number): number;

  // Callback support
  callSquare(target: TestTarget, x: number): { result: number };
  callFunction(fn: (x: number) => number, x: number): { result: number };
}

/**
 * Create a Counter capability
 */
function createCounter(initial: number): Counter {
  let value = initial;
  return {
    value: () => value,
    increment: (by: number) => {
      value += by;
      return value;
    },
  };
}

/**
 * Test implementation of the TestTarget interface
 */
export function createTestTarget(): TestTarget {
  return {
    square(x: number): number {
      return x * x;
    },

    returnNumber(x: number): number {
      return x;
    },

    returnNull(): null {
      return null;
    },

    returnUndefined(): undefined {
      return undefined;
    },

    generateFibonacci(n: number): number[] {
      if (n <= 0) return [];
      if (n === 1) return [0];

      const result = [0, 1];
      for (let i = 2; i < n; i++) {
        result.push(result[i - 1] + result[i - 2]);
      }
      return result;
    },

    throwError(): never {
      throw new RangeError('test error');
    },

    makeCounter(initial: number): Counter {
      return createCounter(initial);
    },

    incrementCounter(counter: Counter, by: number): number {
      return counter.increment(by);
    },

    callSquare(target: TestTarget, x: number): { result: number } {
      return { result: target.square(x) };
    },

    callFunction(fn: (x: number) => number, x: number): { result: number } {
      return { result: fn(x) };
    },
  };
}

/**
 * Message types for RPC protocol
 */
export interface RpcRequest {
  id: number;
  method: string;
  target?: number;  // Capability ID, 0 = bootstrap
  args: unknown[];
  pipeline?: PipelineOp[];
}

export interface PipelineOp {
  type: 'call' | 'get';
  method?: string;
  args?: unknown[];
  property?: string;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { type: string; message: string };
  capabilityId?: number;  // If result is a capability
}

export interface RpcMapRequest {
  id: number;
  target: number;  // Capability ID that returns array/value
  expression: string;
  captures: Record<string, number>;  // Variable name -> capability ID
}

/**
 * Extended request for pipelined calls
 */
export interface PipelinedRequest {
  id: number;
  steps: Array<{
    method: string;
    target?: number | string;  // Capability ID or reference to previous step result
    args: unknown[];
    as?: string;
  }>;
}

/**
 * Mock server that processes RPC messages
 * Used for testing without network
 */
export class MockServer {
  private nextCapId = 1;
  private capabilities = new Map<number, unknown>();
  private roundTrips = 0;

  constructor() {
    // Capability 0 is always the bootstrap/root
    const target = createTestTarget();
    this.capabilities.set(0, target);
  }

  get roundTripCount(): number {
    return this.roundTrips;
  }

  resetRoundTrips(): void {
    this.roundTrips = 0;
  }

  /**
   * Process a batch of requests (single round trip)
   */
  processBatch(requests: RpcRequest[]): RpcResponse[] {
    this.roundTrips++;
    return requests.map(req => this.processRequest(req));
  }

  /**
   * Process a pipelined request (single round trip for entire pipeline)
   */
  processPipeline(request: PipelinedRequest): Record<string, RpcResponse> {
    this.roundTrips++;

    const results: Record<string, RpcResponse> = {};
    const stepResults: Record<string, { capId: number; value: unknown }> = {};
    let lastResponse: RpcResponse | undefined;

    for (const step of request.steps) {
      try {
        // Resolve the target
        let targetId: number;
        let target: unknown;

        if (typeof step.target === 'string') {
          // Reference to a previous step result
          const prev = stepResults[step.target];
          if (!prev) {
            const response = {
              id: request.id,
              error: { type: 'Error', message: `Unknown step reference: ${step.target}` },
            };
            if (step.as) results[step.as] = response;
            lastResponse = response;
            continue;
          }
          targetId = prev.capId;
          target = prev.value;
        } else {
          targetId = step.target ?? 0;
          target = this.capabilities.get(targetId);
        }

        if (target === undefined) {
          const response = {
            id: request.id,
            error: { type: 'Error', message: `Unknown capability: ${targetId}` },
          };
          if (step.as) results[step.as] = response;
          lastResponse = response;
          continue;
        }

        // Resolve capability references in args
        const resolvedArgs = this.resolveCapabilityRefsWithSteps(step.args, stepResults);

        // Call the method
        const method = (target as Record<string, unknown>)[step.method];
        if (typeof method !== 'function') {
          const response = {
            id: request.id,
            error: { type: 'Error', message: `${step.method} is not a function` },
          };
          if (step.as) results[step.as] = response;
          lastResponse = response;
          continue;
        }

        let result = method.apply(target, resolvedArgs);
        let capId: number | undefined;

        // If result is a capability, store it
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
          const hasMethod = Object.values(result).some(v => typeof v === 'function');
          if (hasMethod) {
            capId = this.nextCapId++;
            this.capabilities.set(capId, result);

            // Store for future step references (always store if we have a name)
            if (step.as) {
              stepResults[step.as] = { capId, value: result };
            }

            const response = {
              id: request.id,
              result: { __capabilityId: capId },
              capabilityId: capId,
            };
            if (step.as) results[step.as] = response;
            lastResponse = response;
            continue;
          }
        }

        // Store result
        const response = {
          id: request.id,
          result: result === undefined ? null : result,
        };

        if (step.as) {
          stepResults[step.as] = { capId: -1, value: result };
          results[step.as] = response;
        }
        lastResponse = response;
      } catch (error) {
        const err = error as Error;
        const response = {
          id: request.id,
          error: { type: err.name || 'Error', message: err.message },
        };
        if (step.as) results[step.as] = response;
        lastResponse = response;
      }
    }

    // Always include __last for the last step's result
    if (lastResponse) {
      results['__last'] = lastResponse;
    }

    return results;
  }

  /**
   * Process a single request
   */
  processRequest(request: RpcRequest): RpcResponse {
    try {
      const targetId = request.target ?? 0;
      let target = this.capabilities.get(targetId);

      if (target === undefined) {
        return {
          id: request.id,
          error: { type: 'Error', message: `Unknown capability: ${targetId}` },
        };
      }

      // Handle pipeline operations
      if (request.pipeline && request.pipeline.length > 0) {
        for (const op of request.pipeline) {
          if (op.type === 'get' && op.property) {
            target = (target as Record<string, unknown>)[op.property];
          } else if (op.type === 'call' && op.method) {
            const method = (target as Record<string, unknown>)[op.method];
            if (typeof method !== 'function') {
              return {
                id: request.id,
                error: { type: 'Error', message: `${op.method} is not a function` },
              };
            }
            target = method.apply(target, op.args ?? []);
          }
        }
      }

      // Resolve any capability references in args
      const resolvedArgs = this.resolveCapabilityRefs(request.args);

      // Call the method
      const method = (target as Record<string, unknown>)[request.method];
      if (typeof method !== 'function') {
        return {
          id: request.id,
          error: { type: 'Error', message: `${request.method} is not a function` },
        };
      }

      let result = method.apply(target, resolvedArgs);

      // If result is an object with methods (capability), store it
      if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
        // Check if it looks like a capability (has methods)
        const hasMethod = Object.values(result).some(v => typeof v === 'function');
        if (hasMethod) {
          const capId = this.nextCapId++;
          this.capabilities.set(capId, result);
          return {
            id: request.id,
            result: { __capabilityId: capId },
            capabilityId: capId,
          };
        }
      }

      return {
        id: request.id,
        result: result === undefined ? null : result,
      };
    } catch (error) {
      const err = error as Error;
      return {
        id: request.id,
        error: {
          type: err.name || 'Error',
          message: err.message,
        },
      };
    }
  }

  /**
   * Process a map request
   */
  processMapRequest(request: RpcMapRequest): RpcResponse {
    this.roundTrips++;

    try {
      const target = this.capabilities.get(request.target);
      if (target === undefined) {
        return {
          id: request.id,
          error: { type: 'Error', message: `Unknown capability: ${request.target}` },
        };
      }

      // Build capture context
      const captures: Record<string, unknown> = {};
      for (const [name, capId] of Object.entries(request.captures)) {
        captures[name] = this.capabilities.get(capId);
      }

      // Parse and execute the expression
      // For now, use a simple eval-based approach (in production, use a safe parser)
      const fn = new Function(...Object.keys(captures), 'item', `return (${request.expression})(item)`);

      const value = target;
      if (value === null || value === undefined) {
        return { id: request.id, result: null };
      }

      if (Array.isArray(value)) {
        const results = value.map(item => fn(...Object.values(captures), item));
        // Check if results contain capabilities
        const processedResults = results.map(r => {
          if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
            const hasMethod = Object.values(r).some(v => typeof v === 'function');
            if (hasMethod) {
              const capId = this.nextCapId++;
              this.capabilities.set(capId, r);
              return { __capabilityId: capId };
            }
          }
          return r;
        });
        return { id: request.id, result: processedResults };
      } else {
        // Single value
        const result = fn(...Object.values(captures), value);
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
          const hasMethod = Object.values(result).some(v => typeof v === 'function');
          if (hasMethod) {
            const capId = this.nextCapId++;
            this.capabilities.set(capId, result);
            return { id: request.id, result: { __capabilityId: capId }, capabilityId: capId };
          }
        }
        return { id: request.id, result };
      }
    } catch (error) {
      const err = error as Error;
      return {
        id: request.id,
        error: { type: err.name || 'Error', message: err.message },
      };
    }
  }

  /**
   * Resolve capability references in arguments
   */
  private resolveCapabilityRefs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (arg !== null && typeof arg === 'object') {
        const obj = arg as Record<string, unknown>;
        if ('__capabilityId' in obj) {
          return this.capabilities.get(obj.__capabilityId as number);
        }
        if ('$ref' in obj) {
          return this.capabilities.get(obj.$ref as number);
        }
      }
      return arg;
    });
  }

  /**
   * Resolve capability references with step references
   */
  private resolveCapabilityRefsWithSteps(
    args: unknown[],
    stepResults: Record<string, { capId: number; value: unknown }>
  ): unknown[] {
    return args.map(arg => {
      if (arg !== null && typeof arg === 'object') {
        const obj = arg as Record<string, unknown>;
        if ('__capabilityId' in obj) {
          return this.capabilities.get(obj.__capabilityId as number);
        }
        if ('$ref' in obj) {
          const refId = obj.$ref;
          if (typeof refId === 'string') {
            const step = stepResults[refId];
            return step ? step.value : undefined;
          }
          return this.capabilities.get(refId as number);
        }
        if ('$step' in obj) {
          const stepName = obj.$step as string;
          const step = stepResults[stepName];
          return step ? step.value : undefined;
        }
      }
      return arg;
    });
  }

  /**
   * Register a capability and return its ID
   */
  registerCapability(cap: unknown): number {
    const id = this.nextCapId++;
    this.capabilities.set(id, cap);
    return id;
  }

  /**
   * Get a capability by ID
   */
  getCapability(id: number): unknown {
    return this.capabilities.get(id);
  }

  /**
   * Process a call and map in a single round trip
   */
  processCallAndMap(
    request: RpcRequest,
    expression: string,
    captures: Record<string, number>
  ): RpcResponse {
    this.roundTrips++;

    // First execute the call
    const callResponse = this.processRequestInternal(request);

    if (callResponse.error) {
      return callResponse;
    }

    // Get the result
    let value = callResponse.result;

    // If it's a capability reference, get the actual value
    if (value && typeof value === 'object' && '__capabilityId' in (value as object)) {
      value = this.capabilities.get((value as { __capabilityId: number }).__capabilityId);
    }

    // Now execute the map
    return this.processMapInternal(request.id, value, expression, captures);
  }

  /**
   * Internal request processing (no round trip counting)
   */
  private processRequestInternal(request: RpcRequest): RpcResponse {
    try {
      const targetId = request.target ?? 0;
      let target = this.capabilities.get(targetId);

      if (target === undefined) {
        return {
          id: request.id,
          error: { type: 'Error', message: `Unknown capability: ${targetId}` },
        };
      }

      // Handle pipeline operations
      if (request.pipeline && request.pipeline.length > 0) {
        for (const op of request.pipeline) {
          if (op.type === 'get' && op.property) {
            target = (target as Record<string, unknown>)[op.property];
          } else if (op.type === 'call' && op.method) {
            const method = (target as Record<string, unknown>)[op.method];
            if (typeof method !== 'function') {
              return {
                id: request.id,
                error: { type: 'Error', message: `${op.method} is not a function` },
              };
            }
            target = method.apply(target, op.args ?? []);
          }
        }
      }

      // Resolve any capability references in args
      const resolvedArgs = this.resolveCapabilityRefs(request.args);

      // Call the method
      const method = (target as Record<string, unknown>)[request.method];
      if (typeof method !== 'function') {
        return {
          id: request.id,
          error: { type: 'Error', message: `${request.method} is not a function` },
        };
      }

      let result = method.apply(target, resolvedArgs);

      // If result is an object with methods (capability), store it
      if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
        const hasMethod = Object.values(result).some(v => typeof v === 'function');
        if (hasMethod) {
          const capId = this.nextCapId++;
          this.capabilities.set(capId, result);
          return {
            id: request.id,
            result: { __capabilityId: capId },
            capabilityId: capId,
          };
        }
      }

      return {
        id: request.id,
        result: result === undefined ? null : result,
      };
    } catch (error) {
      const err = error as Error;
      return {
        id: request.id,
        error: { type: err.name || 'Error', message: err.message },
      };
    }
  }

  /**
   * Internal map processing (no round trip counting)
   */
  private processMapInternal(
    id: number,
    value: unknown,
    expression: string,
    captures: Record<string, number>
  ): RpcResponse {
    try {
      // Build capture context
      const captureValues: Record<string, unknown> = {};
      for (const [name, capId] of Object.entries(captures)) {
        captureValues[name] = this.capabilities.get(capId);
      }

      // Parse and execute the expression
      const fn = new Function(...Object.keys(captureValues), 'item', `return (${expression})(item)`);

      if (value === null || value === undefined) {
        return { id, result: null };
      }

      if (Array.isArray(value)) {
        const results = value.map(item => fn(...Object.values(captureValues), item));
        const processedResults = results.map(r => {
          if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
            const hasMethod = Object.values(r).some(v => typeof v === 'function');
            if (hasMethod) {
              const capId = this.nextCapId++;
              this.capabilities.set(capId, r);
              return { __capabilityId: capId };
            }
          }
          return r;
        });
        return { id, result: processedResults };
      } else {
        const result = fn(...Object.values(captureValues), value);
        if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
          const hasMethod = Object.values(result).some(v => typeof v === 'function');
          if (hasMethod) {
            const capId = this.nextCapId++;
            this.capabilities.set(capId, result);
            return { id, result: { __capabilityId: capId }, capabilityId: capId };
          }
        }
        return { id, result };
      }
    } catch (error) {
      const err = error as Error;
      return { id, error: { type: err.name || 'Error', message: err.message } };
    }
  }
}
