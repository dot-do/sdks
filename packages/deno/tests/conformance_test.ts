/**
 * Cap'n Web Conformance Test Harness for Deno
 *
 * Runs SDK conformance tests against a test server.
 *
 * Environment variables:
 *   TEST_SERVER_URL - URL of the test server (required)
 *   TEST_SPEC_DIR   - Directory containing YAML test specs (optional)
 *
 * @example
 * ```bash
 * TEST_SERVER_URL=ws://localhost:8080 deno test --allow-net --allow-env --allow-read tests/conformance_test.ts
 * ```
 */

import { parse as parseYaml } from "@std/yaml";
import { join, fromFileUrl, dirname } from "@std/path";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { rpc, RpcStub, RpcError } from "../mod.ts";

// ─── Test Spec Types ──────────────────────────────────────────────────────────

interface TestSpec {
  name: string;
  description: string;
  tests: TestCase[];
}

interface TestCase {
  name: string;
  description?: string;

  // Simple call
  call?: string;
  args?: unknown[];
  expect?: unknown;

  // Error expectation
  expect_error?: {
    type?: string;
    message_contains?: string;
    any_of?: Array<{ type?: string; value?: unknown }>;
  };

  // Pipeline tests
  pipeline?: PipelineStep[];
  max_round_trips?: number;

  // Setup and sequence
  setup?: SetupStep[];
  sequence?: SequenceStep[];
}

interface PipelineStep {
  call: string;
  args?: unknown[];
  as?: string;
}

interface SetupStep {
  call: string;
  args?: unknown[];
  as: string;
  await?: boolean;
}

interface SequenceStep {
  call: string;
  args?: unknown[];
  expect?: unknown;
}

// ─── Test API Interface ───────────────────────────────────────────────────────

/**
 * Interface matching the test server's API
 */
interface TestApi {
  square(n: number): number;
  returnNumber(n: number): number;
  returnNull(): null;
  returnUndefined(): undefined;
  generateFibonacci(count: number): number[];
  throwError(): never;
  nonExistentMethod(): never;
  makeCounter(initial: number): Counter;
  incrementCounter(counter: Counter, amount: number): number;
  callSquare(target: TestApi, n: number): { result: number };
}

interface Counter {
  value(): number;
  increment(amount: number): number;
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

/**
 * Load and parse a YAML test spec file
 */
async function loadSpec(path: string): Promise<TestSpec> {
  const content = await Deno.readTextFile(path);
  return parseYaml(content) as TestSpec;
}

/**
 * Get all YAML spec files from the test directory
 */
async function getSpecFiles(): Promise<string[]> {
  const specDir =
    Deno.env.get("TEST_SPEC_DIR") ||
    join(dirname(fromFileUrl(import.meta.url)), "../../../test/conformance");

  const files: string[] = [];
  for await (const entry of Deno.readDir(specDir)) {
    if (entry.isFile && entry.name.endsWith(".yaml")) {
      files.push(join(specDir, entry.name));
    }
  }
  return files.sort();
}

/**
 * Resolve variable references in arguments
 * Handles $self, $counter, etc.
 */
function resolveArgs(
  args: unknown[],
  context: Map<string, unknown>,
  api: RpcStub<TestApi>,
): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "string" && arg.startsWith("$")) {
      const varName = arg.slice(1);
      if (varName === "self") {
        return api;
      }
      return context.get(varName);
    }
    return arg;
  });
}

/**
 * Parse a method call path like "counter.increment" and invoke it
 */
async function invokeMethod(
  path: string,
  args: unknown[],
  context: Map<string, unknown>,
  api: RpcStub<TestApi>,
): Promise<unknown> {
  const parts = path.split(".");
  const resolvedArgs = resolveArgs(args, context, api);

  if (parts.length === 1) {
    // Direct API call
    const method = (api as Record<string, unknown>)[parts[0]];
    if (typeof method === "function") {
      return await method(...resolvedArgs);
    }
    throw new Error(`Method ${parts[0]} not found on API`);
  }

  // Nested call like counter.value or counter.increment
  const targetName = parts[0];
  const methodName = parts.slice(1).join(".");

  // Check if it's a context variable
  if (targetName.startsWith("$")) {
    const target = context.get(targetName.slice(1));
    if (!target) {
      throw new Error(`Variable ${targetName} not found in context`);
    }
    const method = (target as Record<string, unknown>)[methodName];
    if (typeof method === "function") {
      return await method(...resolvedArgs);
    }
    throw new Error(`Method ${methodName} not found on ${targetName}`);
  }

  // Context variable without $
  const target = context.get(targetName);
  if (target) {
    const method = (target as Record<string, unknown>)[methodName];
    if (typeof method === "function") {
      return await method(...resolvedArgs);
    }
    throw new Error(`Method ${methodName} not found on ${targetName}`);
  }

  throw new Error(`Unknown target: ${targetName}`);
}

/**
 * Run a single test case
 */
async function runTestCase(
  t: Deno.TestContext,
  testCase: TestCase,
  api: RpcStub<TestApi>,
): Promise<void> {
  const context = new Map<string, unknown>();

  // Execute setup steps
  if (testCase.setup) {
    for (const step of testCase.setup) {
      const result = await invokeMethod(step.call, step.args ?? [], context, api);
      if (step.as) {
        context.set(step.as, step.await ? await result : result);
      }
    }
  }

  // Handle pipeline tests
  if (testCase.pipeline) {
    const results: Record<string, unknown> = {};

    for (const step of testCase.pipeline) {
      const result = await invokeMethod(step.call, step.args ?? [], context, api);
      if (step.as) {
        context.set(step.as, result);
        results[step.as] = result;
      }
    }

    // Check expectations
    if (testCase.expect !== undefined) {
      if (typeof testCase.expect === "object" && testCase.expect !== null) {
        // Expect is an object mapping variable names to values
        for (const [key, expectedValue] of Object.entries(testCase.expect)) {
          assertEquals(results[key], expectedValue, `Expected ${key} to match`);
        }
      } else {
        // Single value expectation - use last result
        const lastStep = testCase.pipeline[testCase.pipeline.length - 1];
        const lastResult = lastStep.as ? results[lastStep.as] : context.get("_last");
        assertEquals(lastResult, testCase.expect);
      }
    }
    return;
  }

  // Handle sequence tests
  if (testCase.sequence) {
    for (const step of testCase.sequence) {
      const result = await invokeMethod(step.call, step.args ?? [], context, api);
      if (step.expect !== undefined) {
        assertEquals(result, step.expect, `Sequence step ${step.call} failed`);
      }
    }
    return;
  }

  // Handle simple call tests
  if (testCase.call) {
    // Handle error expectation
    if (testCase.expect_error) {
      await assertRejects(
        async () => {
          await invokeMethod(testCase.call!, testCase.args ?? [], context, api);
        },
        RpcError,
        undefined,
        `Expected ${testCase.call} to throw an error`,
      );

      // If we need more specific error checking
      try {
        await invokeMethod(testCase.call, testCase.args ?? [], context, api);
      } catch (error) {
        if (testCase.expect_error.type && error instanceof RpcError) {
          assertEquals(error.type, testCase.expect_error.type);
        }
        if (testCase.expect_error.message_contains && error instanceof Error) {
          assertStringIncludes(error.message, testCase.expect_error.message_contains);
        }
      }
      return;
    }

    // Normal call with expected result
    const result = await invokeMethod(testCase.call, testCase.args ?? [], context, api);
    assertEquals(result, testCase.expect, `Expected ${testCase.call} result to match`);
  }
}

// ─── Main Test Registration ───────────────────────────────────────────────────

const serverUrl = Deno.env.get("TEST_SERVER_URL");

if (!serverUrl) {
  console.warn(
    "TEST_SERVER_URL not set. Skipping conformance tests.\n" +
      "To run tests: TEST_SERVER_URL=ws://localhost:8080 deno test --allow-net --allow-env --allow-read tests/conformance_test.ts",
  );
} else {
  // Register tests for each spec file
  const specFiles = await getSpecFiles();

  for (const specFile of specFiles) {
    const spec = await loadSpec(specFile);

    Deno.test({
      name: spec.name,
      async fn(t) {
        // Connect to test server
        const api = await rpc<TestApi>(serverUrl);

        try {
          for (const testCase of spec.tests) {
            await t.step({
              name: testCase.name,
              fn: async () => {
                await runTestCase(t, testCase, api);
              },
            });
          }
        } finally {
          // Cleanup connection
          await api[Symbol.asyncDispose]();
        }
      },
    });
  }
}

// ─── Standalone Tests ─────────────────────────────────────────────────────────

Deno.test({
  name: "conformance: spec loading",
  async fn(t) {
    await t.step("loads YAML spec files", async () => {
      const specFiles = await getSpecFiles();
      // Should find at least the basic.yaml file
      const hasBasic = specFiles.some((f) => f.endsWith("basic.yaml"));
      assertEquals(hasBasic, true, "Should find basic.yaml spec");
    });

    await t.step("parses basic.yaml correctly", async () => {
      const specFiles = await getSpecFiles();
      const basicSpec = specFiles.find((f) => f.endsWith("basic.yaml"));
      if (basicSpec) {
        const spec = await loadSpec(basicSpec);
        assertEquals(spec.name, "Basic RPC Calls");
        assertEquals(typeof spec.tests, "object");
        assertEquals(Array.isArray(spec.tests), true);
      }
    });
  },
});

Deno.test({
  name: "conformance: argument resolution",
  fn() {
    const context = new Map<string, unknown>();
    context.set("counter", { value: 42 });

    // Create a mock API for testing
    const mockApi = {} as RpcStub<TestApi>;

    // Test $variable resolution
    const resolved = resolveArgs(["$counter", 10], context, mockApi);
    assertEquals(resolved[0], { value: 42 });
    assertEquals(resolved[1], 10);

    // Test literal passthrough
    const literals = resolveArgs([1, "hello", null], context, mockApi);
    assertEquals(literals, [1, "hello", null]);
  },
});
