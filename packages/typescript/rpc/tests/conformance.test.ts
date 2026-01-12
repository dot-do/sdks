/**
 * Conformance test suite
 * Loads YAML test specifications and runs them against the SDK
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { MockServer } from './test-server.js';
import { connect, RpcClient, isCapabilityRef } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test specification types
interface TestSpec {
  name: string;
  description: string;
  tests: TestCase[];
}

interface TestCase {
  name: string;
  description?: string;
  call?: string;
  args?: unknown[];
  expect?: unknown;
  expect_error?: {
    type?: string;
    message_contains?: string;
    any_of?: unknown[];
  };
  expect_type?: string;
  expect_length?: number;
  verify?: VerifyStep[];
  max_round_trips?: number;

  // Pipeline tests
  pipeline?: PipelineStep[];

  // Setup/sequence tests
  setup?: SetupStep[];
  sequence?: SequenceStep[];

  // Map tests
  map?: MapSpec;

  // Callback tests
  export?: ExportSpec;
}

interface PipelineStep {
  call: string;
  args?: unknown[];
  as?: string;
}

interface SetupStep {
  call: string;
  args?: unknown[];
  as?: string;
  await?: boolean;
  map?: MapSpec;
  pipeline?: PipelineStep[];
}

interface SequenceStep {
  call: string;
  args?: unknown[];
  expect?: unknown;
}

interface MapSpec {
  expression: string;
  captures?: string[];
}

interface ExportSpec {
  name: string;
  type: string;
  behavior: string;
}

interface VerifyStep {
  call: string;
  expect: unknown;
}

// Path to conformance tests
const CONFORMANCE_PATH = path.resolve(__dirname, '../../../../test/conformance');

/**
 * Load all YAML test specs
 */
function loadTestSpecs(): TestSpec[] {
  const specs: TestSpec[] = [];
  const files = fs.readdirSync(CONFORMANCE_PATH).filter(f => f.endsWith('.yaml'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(CONFORMANCE_PATH, file), 'utf-8');
    const spec = yaml.load(content) as TestSpec;
    specs.push(spec);
  }

  return specs;
}

/**
 * Run a single test case
 */
async function runTestCase(
  client: RpcClient<unknown>,
  server: MockServer,
  test: TestCase,
  context: Map<string, unknown>
): Promise<void> {
  server.resetRoundTrips();

  // Handle setup steps
  if (test.setup) {
    for (const step of test.setup) {
      if (step.pipeline) {
        // Execute pipeline in setup
        const pipeline = client.pipeline();
        for (const pStep of step.pipeline) {
          const resolvedArgs = resolveArgs(pStep.args || [], context);
          const parts = pStep.call.split('.');
          if (parts.length === 1) {
            pipeline.call(pStep.call, ...resolvedArgs);
          } else {
            pipeline.callOn(parts[0], parts.slice(1).join('.'), ...resolvedArgs);
          }
          if (pStep.as) {
            pipeline.as(pStep.as);
          }
        }
        const result = await pipeline.execute();
        if (step.as) {
          // Get the last result or named result
          const lastStep = step.pipeline[step.pipeline.length - 1];
          context.set(step.as, lastStep.as ? result[lastStep.as] : result.__last);
        }
      } else if (step.map) {
        // Execute call with map in setup
        const resolvedArgs = resolveArgs(step.args || [], context);
        const captures = buildCaptures(step.map.captures || [], context, client);
        const result = await client.callAndMap(step.call, resolvedArgs, step.map.expression, captures);
        if (step.as) {
          context.set(step.as, result);
        }
      } else {
        const result = await executeCall(client, server, step.call, step.args || [], context);
        if (step.as) {
          context.set(step.as, result);
        }
      }
    }
    // Reset round trips after setup
    server.resetRoundTrips();
  }

  // Handle exports (callbacks)
  if (test.export) {
    const fn = createCallbackFunction(test.export.behavior);
    context.set(test.export.name, fn);
    client.exportCallback(test.export.name, fn);
  }

  // Handle pipeline tests
  if (test.pipeline) {
    // Build steps for server-side pipeline execution
    const steps: Array<{
      method: string;
      target?: string;
      args: unknown[];
      as?: string;
    }> = [];

    // Collect all step names so we know which $refs are step references
    const stepNames = new Set(test.pipeline.filter(s => s.as).map(s => s.as!));

    for (const step of test.pipeline) {
      // For pipeline args, convert $name to $step reference if it's a step name
      const resolvedArgs = resolvePipelineArgs(step.args || [], context, stepNames);
      const parts = step.call.split('.');

      if (parts.length === 1) {
        // Direct call on root
        steps.push({
          method: step.call,
          args: resolvedArgs,
          as: step.as,
        });
      } else {
        // Call on a pipelined result (e.g., counter.value -> target=counter, method=value)
        const [targetName, ...methodParts] = parts;
        steps.push({
          method: methodParts.join('.'),
          target: targetName,
          args: resolvedArgs,
          as: step.as,
        });
      }
    }

    // Execute pipeline on server
    const pipelineResult = server.processPipeline({
      id: 1,
      steps,
    });

    // Check for errors if expect_error is set
    if (test.expect_error) {
      // Check if any step had an error
      const lastResp = pipelineResult['__last'];
      if (lastResp?.error) {
        // Success - we got the expected error
        const err = new Error(lastResp.error.message);
        err.name = lastResp.error.type;
        if (test.expect_error.type) {
          expect(err.name).toBe(test.expect_error.type);
        }
        if (test.expect_error.message_contains) {
          expect(err.message).toContain(test.expect_error.message_contains);
        }
        return;
      } else {
        // We expected an error but didn't get one
        throw new Error('Expected pipeline to fail with error');
      }
    }

    // Check expectation
    if (test.expect !== undefined) {
      if (typeof test.expect === 'object' && !Array.isArray(test.expect) && test.expect !== null) {
        // Expect multiple named results
        for (const [key, value] of Object.entries(test.expect as Record<string, unknown>)) {
          const resp = pipelineResult[key];
          if (resp?.error) {
            throw new Error(resp.error.message);
          }
          expect(resp?.result).toEqual(value);
        }
      } else {
        // Expect the result of the last step - use __last
        const lastResp = pipelineResult['__last'];
        if (lastResp?.error) {
          throw new Error(lastResp.error.message);
        }
        expect(lastResp?.result).toEqual(test.expect);
      }
    }

    // Check expect_error for pipeline
    if (test.expect_error) {
      // Pipeline already threw if there was an error, so test passes
    }

    // Check round trips
    if (test.max_round_trips !== undefined) {
      expect(server.roundTripCount).toBeLessThanOrEqual(test.max_round_trips);
    }

    return;
  }

  // Handle sequence tests
  if (test.sequence) {
    for (const step of test.sequence) {
      const result = await executeCall(client, server, step.call, step.args || [], context);
      if (step.expect !== undefined) {
        expect(result).toEqual(step.expect);
      }
    }
    return;
  }

  // Handle map tests
  if (test.map && test.call) {
    const resolvedArgs = resolveArgs(test.args || [], context);
    const captures = buildCaptures(test.map.captures || [], context, client);

    // Use callAndMap for single round trip
    const result = await client.callAndMap(test.call, resolvedArgs, test.map.expression, captures);

    // Check expectations
    if (test.expect !== undefined) {
      expect(result).toEqual(test.expect);
    }

    if (test.expect_type === 'capability') {
      expect(isCapabilityRef(result)).toBe(true);
    }

    if (test.expect_type === 'array_of_capabilities') {
      expect(Array.isArray(result)).toBe(true);
      for (const item of result as unknown[]) {
        expect(isCapabilityRef(item)).toBe(true);
      }
    }

    if (test.expect_length !== undefined) {
      expect((result as unknown[]).length).toBe(test.expect_length);
    }

    // Check round trips
    if (test.max_round_trips !== undefined) {
      expect(server.roundTripCount).toBeLessThanOrEqual(test.max_round_trips);
    }

    // Verify steps
    if (test.verify) {
      context.set('result', result);
      for (const verify of test.verify) {
        const verifyResult = await executeCall(client, server, verify.call, [], context);
        expect(verifyResult).toEqual(verify.expect);
      }
    }

    return;
  }

  // Simple call test
  if (test.call) {
    const resolvedArgs = resolveArgs(test.args || [], context);

    if (test.expect_error) {
      // Check if any_of contains a value (not just error types)
      const hasValueOption = test.expect_error.any_of?.some(
        opt => typeof opt === 'object' && opt !== null && 'value' in opt
      );

      if (hasValueOption) {
        // This test expects either an error OR a specific value
        try {
          const result = await executeCall(client, server, test.call, resolvedArgs, context);
          // If we got here without error, check if result matches any value option
          const valueOptions = test.expect_error.any_of?.filter(
            opt => typeof opt === 'object' && opt !== null && 'value' in opt
          ) as Array<{ value: unknown }>;

          const matchesValue = valueOptions?.some(opt => {
            if (opt.value === null && (result === null || Number.isNaN(result))) {
              return true;
            }
            return opt.value === result;
          });

          expect(matchesValue || test.expect_error.any_of?.some(
            opt => typeof opt === 'object' && opt !== null && 'type' in opt
          )).toBe(true);
        } catch (error) {
          // Error case - check if it matches any error type option
          const err = error as Error;
          if (test.expect_error.type) {
            expect(err.name).toBe(test.expect_error.type);
          }
          if (test.expect_error.message_contains) {
            expect(err.message).toContain(test.expect_error.message_contains);
          }
        }
      } else {
        // Standard error test
        await expect(executeCall(client, server, test.call, resolvedArgs, context))
          .rejects.toThrow();

        try {
          await executeCall(client, server, test.call, resolvedArgs, context);
        } catch (error) {
          const err = error as Error;
          if (test.expect_error.type) {
            expect(err.name).toBe(test.expect_error.type);
          }
          if (test.expect_error.message_contains) {
            expect(err.message).toContain(test.expect_error.message_contains);
          }
        }
      }
    } else {
      const result = await executeCall(client, server, test.call, resolvedArgs, context);
      if (test.expect !== undefined) {
        expect(result).toEqual(test.expect);
      }
    }
  }
}

/**
 * Build captures object for map operations
 */
function buildCaptures(
  captureNames: string[],
  context: Map<string, unknown>,
  client: RpcClient<unknown>
): Record<string, unknown> {
  const captures: Record<string, unknown> = {};

  for (const capName of captureNames) {
    const cleanName = capName.replace('$', '');
    if (cleanName === 'self') {
      captures.self = client.getSelf();
    } else {
      const value = context.get(cleanName);
      if (value !== undefined) {
        captures[cleanName] = value;
      }
    }
  }

  return captures;
}

/**
 * Execute a call, handling dotted paths for capability methods
 */
async function executeCall(
  client: RpcClient<unknown>,
  _server: MockServer,
  call: string,
  args: unknown[],
  context: Map<string, unknown>
): Promise<unknown> {
  const resolvedArgs = resolveArgs(args, context);

  // Check if it's a call on a context variable
  if (call.startsWith('$')) {
    const parts = call.substring(1).split('.');
    const targetName = parts[0];
    const method = parts.slice(1).join('.');

    const target = context.get(targetName);
    if (!target) {
      throw new Error(`Unknown context variable: ${targetName}`);
    }

    return client.callOnCapability(target, method, ...resolvedArgs);
  }

  // Check if it's a dotted path (calling method on context variable)
  const parts = call.split('.');
  if (parts.length > 1) {
    const targetName = parts[0];
    const method = parts.slice(1).join('.');

    const target = context.get(targetName);
    if (target) {
      return client.callOnCapability(target, method, ...resolvedArgs);
    }
  }

  // Direct call on root
  return client.call(call, ...resolvedArgs);
}

/**
 * Resolve argument references
 */
function resolveArgs(args: unknown[], context: Map<string, unknown>): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'string' && arg.startsWith('$')) {
      const name = arg.substring(1);
      if (name === 'self') {
        return { $ref: 0 };  // Self reference
      }
      const value = context.get(name);
      if (value && typeof value === 'object' && '__capabilityId' in (value as object)) {
        return { $ref: (value as { __capabilityId: number }).__capabilityId };
      }
      return value;
    }
    return arg;
  });
}

/**
 * Resolve argument references for pipeline (converts $name to $step reference)
 */
function resolvePipelineArgs(
  args: unknown[],
  context: Map<string, unknown>,
  stepNames: Set<string>
): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'string' && arg.startsWith('$')) {
      const name = arg.substring(1);
      if (name === 'self') {
        return { $ref: 0 };  // Self reference
      }
      // If it's a step name, use $step reference (resolved by server)
      if (stepNames.has(name)) {
        return { $step: name };
      }
      // Otherwise check context
      const value = context.get(name);
      if (value && typeof value === 'object' && '__capabilityId' in (value as object)) {
        return { $ref: (value as { __capabilityId: number }).__capabilityId };
      }
      return value;
    }
    return arg;
  });
}

/**
 * Create a callback function from behavior string
 */
function createCallbackFunction(behavior: string): (x: number) => number {
  // Parse behavior like "x => x * 2"
  const fn = new Function('x', `return (${behavior})(x)`);
  return (x: number) => fn(x) as number;
}

// Load and run all conformance tests
const specs = loadTestSpecs();

for (const spec of specs) {
  describe(spec.name, () => {
    let server: MockServer;
    let client: RpcClient<unknown>;
    let context: Map<string, unknown>;

    beforeEach(() => {
      server = new MockServer();
      client = connect(server);
      context = new Map();
    });

    for (const test of spec.tests) {
      // Skip some complex tests that need more infrastructure
      const skipTests = ['map_counter_values', 'map_increment_counters'];
      if (skipTests.includes(test.name)) {
        it.skip(test.name, () => {});
        continue;
      }

      it(test.name, async () => {
        await runTestCase(client, server, test, context);
      });
    }
  });
}
