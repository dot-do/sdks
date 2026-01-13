/**
 * Test runner for conformance tests
 * Executes tests against any server implementation
 */

import type {
  TestSpec,
  TestCase,
  TestResult,
  SuiteResult,
  RunResult,
  RunnerOptions,
  SetupStep,
  SequenceStep,
} from './types.js';
import { ConformanceClient, type CapabilityRef } from './client.js';

/**
 * Run all conformance tests against a server
 */
export async function runConformanceTests(
  specs: TestSpec[],
  options: RunnerOptions
): Promise<RunResult> {
  const startTime = Date.now();
  const suites: SuiteResult[] = [];

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const spec of specs) {
    const suiteResult = await runSuite(spec, options);
    suites.push(suiteResult);

    totalPassed += suiteResult.passed;
    totalFailed += suiteResult.failed;
    totalSkipped += suiteResult.skipped;

    if (options.bail && suiteResult.failed > 0) {
      break;
    }
  }

  return {
    suites,
    totalPassed,
    totalFailed,
    totalSkipped,
    totalDuration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
    serverUrl: options.serverUrl,
  };
}

/**
 * Run a single test suite
 */
async function runSuite(spec: TestSpec, options: RunnerOptions): Promise<SuiteResult> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const test of spec.tests) {
    const result = await runTest(spec.name, test, options);
    results.push(result);

    switch (result.status) {
      case 'passed':
        passed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }

    if (options.bail && result.status === 'failed') {
      // Mark remaining tests as skipped
      for (const remaining of spec.tests.slice(spec.tests.indexOf(test) + 1)) {
        results.push({
          name: remaining.name,
          suite: spec.name,
          status: 'skipped',
          duration: 0,
          skipReason: 'Skipped due to bail on failure',
        });
        skipped++;
      }
      break;
    }
  }

  return {
    name: spec.name,
    tests: results,
    passed,
    failed,
    skipped,
    duration: Date.now() - startTime,
  };
}

/**
 * Run a single test case
 */
async function runTest(
  suiteName: string,
  test: TestCase,
  options: RunnerOptions
): Promise<TestResult> {
  const startTime = Date.now();

  // Create a new client for each test
  const client = new ConformanceClient();
  const context = new Map<string, unknown>();

  try {
    // Connect to the server
    await client.connect(options.serverUrl, options.timeout);

    // Execute the test
    await executeTest(client, test, context);

    // Test passed
    client.disconnect();
    return {
      name: test.name,
      suite: suiteName,
      status: 'passed',
      duration: Date.now() - startTime,
    };
  } catch (error) {
    client.disconnect();

    const err = error as Error;
    return {
      name: test.name,
      suite: suiteName,
      status: 'failed',
      duration: Date.now() - startTime,
      error: err.message,
      stackTrace: err.stack,
    };
  }
}

/**
 * Execute a single test case
 */
async function executeTest(
  client: ConformanceClient,
  test: TestCase,
  context: Map<string, unknown>
): Promise<void> {
  client.resetRoundTrips();

  // Handle setup steps
  if (test.setup) {
    await executeSetup(client, test.setup, context);
    client.resetRoundTrips(); // Reset after setup
  }

  // Handle exports (callbacks) - skip for now as this requires server support
  if (test.export) {
    // Callbacks require bidirectional communication which may not be supported
    // For now, we note this as a limitation
  }

  // Handle pipeline tests
  if (test.pipeline) {
    await executePipeline(client, test, context);
    return;
  }

  // Handle sequence tests
  if (test.sequence) {
    await executeSequence(client, test.sequence, context);
    return;
  }

  // Handle map tests
  if (test.map && test.call) {
    // Map operations require special server support
    // This is a simplified implementation
    throw new Error('Map tests require server-side map support (not yet implemented in runner)');
  }

  // Simple call test
  if (test.call) {
    await executeSimpleCall(client, test, context);
  }
}

/**
 * Execute setup steps
 */
async function executeSetup(
  client: ConformanceClient,
  setup: SetupStep[],
  context: Map<string, unknown>
): Promise<void> {
  for (const step of setup) {
    if (step.pipeline) {
      // Execute pipeline in setup
      const pipelineSteps = step.pipeline.map((ps) => ({
        method: ps.call,
        args: resolveArgs(ps.args || [], context, client),
        as: ps.as,
      }));

      const results = await client.pipeline(pipelineSteps);

      if (step.as) {
        const lastStep = step.pipeline[step.pipeline.length - 1];
        const key = lastStep.as || '__last';
        context.set(step.as, results[key]);
      }
    } else {
      const result = await executeCall(client, step.call, step.args || [], context);
      if (step.as) {
        context.set(step.as, result);
      }
    }
  }
}

/**
 * Execute a pipeline test
 */
async function executePipeline(
  client: ConformanceClient,
  test: TestCase,
  context: Map<string, unknown>
): Promise<void> {
  const pipeline = test.pipeline!;

  // Collect all step names for reference resolution
  const stepNames = new Set(pipeline.filter((s) => s.as).map((s) => s.as!));

  // Build pipeline steps
  const steps = pipeline.map((step) => {
    const parts = step.call.split('.');
    if (parts.length === 1) {
      return {
        method: step.call,
        args: resolvePipelineArgs(step.args || [], context, stepNames, client),
        as: step.as,
      };
    } else {
      // Call on a pipelined result (e.g., counter.value)
      const [targetName, ...methodParts] = parts;
      return {
        method: methodParts.join('.'),
        target: targetName,
        args: resolvePipelineArgs(step.args || [], context, stepNames, client),
        as: step.as,
      };
    }
  });

  const results = await client.pipeline(steps);

  // Check for errors if expect_error is set
  if (test.expect_error) {
    const lastKey = pipeline[pipeline.length - 1].as || '__last';
    const lastResult = results[lastKey] as { error?: { type: string; message: string } };

    if (lastResult?.error) {
      // We got the expected error
      if (test.expect_error.type && lastResult.error.type !== test.expect_error.type) {
        throw new Error(
          `Expected error type '${test.expect_error.type}' but got '${lastResult.error.type}'`
        );
      }
      if (
        test.expect_error.message_contains &&
        !lastResult.error.message.includes(test.expect_error.message_contains)
      ) {
        throw new Error(
          `Expected error message to contain '${test.expect_error.message_contains}' but got '${lastResult.error.message}'`
        );
      }
      return; // Error expectation met
    } else {
      throw new Error('Expected pipeline to fail with error');
    }
  }

  // Check expectations
  if (test.expect !== undefined) {
    if (typeof test.expect === 'object' && !Array.isArray(test.expect) && test.expect !== null) {
      // Expect multiple named results
      for (const [key, expectedValue] of Object.entries(test.expect as Record<string, unknown>)) {
        const actualResult = results[key] as { error?: unknown };
        if (actualResult?.error) {
          throw new Error(`Step '${key}' failed with error`);
        }
        assertDeepEqual(actualResult, expectedValue, `Step '${key}'`);
      }
    } else {
      // Expect the result of the last step
      const lastStep = pipeline[pipeline.length - 1];
      const lastKey = lastStep.as || '__last';
      const lastResult = results[lastKey];
      assertDeepEqual(lastResult, test.expect, 'Pipeline result');
    }
  }

  // Check round trips
  if (test.max_round_trips !== undefined) {
    const roundTrips = client.getRoundTripCount();
    if (roundTrips > test.max_round_trips) {
      throw new Error(
        `Expected at most ${test.max_round_trips} round trips but used ${roundTrips}`
      );
    }
  }
}

/**
 * Execute a sequence test
 */
async function executeSequence(
  client: ConformanceClient,
  sequence: SequenceStep[],
  context: Map<string, unknown>
): Promise<void> {
  for (const step of sequence) {
    const result = await executeCall(client, step.call, step.args || [], context);
    if (step.expect !== undefined) {
      assertDeepEqual(result, step.expect, `Sequence step '${step.call}'`);
    }
  }
}

/**
 * Execute a simple call test
 */
async function executeSimpleCall(
  client: ConformanceClient,
  test: TestCase,
  context: Map<string, unknown>
): Promise<void> {
  const resolvedArgs = resolveArgs(test.args || [], context, client);

  if (test.expect_error) {
    // Check if any_of contains a value option
    const hasValueOption = test.expect_error.any_of?.some(
      (opt) => typeof opt === 'object' && opt !== null && 'value' in opt
    );

    if (hasValueOption) {
      // This test expects either an error OR a specific value
      try {
        const result = await executeCall(client, test.call!, resolvedArgs, context);
        const valueOptions = test.expect_error.any_of?.filter(
          (opt) => typeof opt === 'object' && opt !== null && 'value' in opt
        ) as Array<{ value: unknown }>;

        const matchesValue = valueOptions?.some((opt) => {
          if (opt.value === null && (result === null || Number.isNaN(result))) {
            return true;
          }
          return deepEqual(opt.value, result);
        });

        if (!matchesValue) {
          throw new Error(`Result did not match any expected value`);
        }
      } catch (error) {
        const err = error as Error;
        if (test.expect_error.type && err.name !== test.expect_error.type) {
          throw new Error(
            `Expected error type '${test.expect_error.type}' but got '${err.name}'`
          );
        }
        if (test.expect_error.message_contains && !err.message.includes(test.expect_error.message_contains)) {
          throw new Error(
            `Expected error message to contain '${test.expect_error.message_contains}' but got '${err.message}'`
          );
        }
        // Error matched expectations
      }
    } else {
      // Standard error test
      let errorThrown = false;
      let caughtError: Error | undefined;

      try {
        await executeCall(client, test.call!, resolvedArgs, context);
      } catch (error) {
        errorThrown = true;
        caughtError = error as Error;
      }

      if (!errorThrown) {
        throw new Error('Expected call to throw an error');
      }

      if (test.expect_error.type && caughtError!.name !== test.expect_error.type) {
        throw new Error(
          `Expected error type '${test.expect_error.type}' but got '${caughtError!.name}'`
        );
      }
      if (
        test.expect_error.message_contains &&
        !caughtError!.message.includes(test.expect_error.message_contains)
      ) {
        throw new Error(
          `Expected error message to contain '${test.expect_error.message_contains}' but got '${caughtError!.message}'`
        );
      }
    }
  } else {
    const result = await executeCall(client, test.call!, resolvedArgs, context);
    if (test.expect !== undefined) {
      assertDeepEqual(result, test.expect, 'Call result');
    }

    // Check type expectations
    if (test.expect_type === 'capability') {
      if (!client.isCapabilityRef(result)) {
        throw new Error('Expected result to be a capability reference');
      }
    }

    if (test.expect_type === 'array_of_capabilities') {
      if (!Array.isArray(result)) {
        throw new Error('Expected result to be an array');
      }
      for (const item of result) {
        if (!client.isCapabilityRef(item)) {
          throw new Error('Expected all array items to be capability references');
        }
      }
    }

    // Check length
    if (test.expect_length !== undefined) {
      if (!Array.isArray(result)) {
        throw new Error('Expected result to be an array for length check');
      }
      if (result.length !== test.expect_length) {
        throw new Error(`Expected array length ${test.expect_length} but got ${result.length}`);
      }
    }

    // Store result for verify steps
    context.set('result', result);

    // Verify steps
    if (test.verify) {
      for (const verify of test.verify) {
        const verifyResult = await executeCall(client, verify.call, [], context);
        assertDeepEqual(verifyResult, verify.expect, `Verify step '${verify.call}'`);
      }
    }
  }
}

/**
 * Execute a single method call
 */
async function executeCall(
  client: ConformanceClient,
  call: string,
  args: unknown[],
  context: Map<string, unknown>
): Promise<unknown> {
  const resolvedArgs = resolveArgs(args, context, client);

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
function resolveArgs(
  args: unknown[],
  context: Map<string, unknown>,
  client: ConformanceClient
): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string' && arg.startsWith('$')) {
      const name = arg.substring(1);
      if (name === 'self') {
        return client.getSelf();
      }
      const value = context.get(name);
      if (value !== undefined) {
        return value;
      }
    }
    return arg;
  });
}

/**
 * Resolve pipeline argument references
 */
function resolvePipelineArgs(
  args: unknown[],
  context: Map<string, unknown>,
  stepNames: Set<string>,
  client: ConformanceClient
): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string' && arg.startsWith('$')) {
      const name = arg.substring(1);
      if (name === 'self') {
        return { $ref: 0 };
      }
      // If it's a step name, use $step reference
      if (stepNames.has(name)) {
        return { $step: name };
      }
      // Otherwise check context
      const value = context.get(name);
      if (value && client.isCapabilityRef(value)) {
        return { $ref: (value as CapabilityRef).__capabilityId };
      }
      return value;
    }
    return arg;
  });
}

/**
 * Deep equality check
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }

  return false;
}

/**
 * Assert deep equality with nice error message
 */
function assertDeepEqual(actual: unknown, expected: unknown, context: string): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${context}: Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`
    );
  }
}
