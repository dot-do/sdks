/**
 * Type definitions for conformance test specifications
 * These types match the YAML test format used in test/conformance/
 */

/**
 * A complete test specification file
 */
export interface TestSpec {
  /** Name of the test suite */
  name: string;
  /** Description of what this suite tests */
  description: string;
  /** Individual test cases */
  tests: TestCase[];
}

/**
 * A single test case
 */
export interface TestCase {
  /** Unique test name (used as identifier) */
  name: string;
  /** Human-readable description */
  description?: string;

  // Simple call tests
  /** Method to call on the server */
  call?: string;
  /** Arguments to pass to the method */
  args?: unknown[];
  /** Expected return value */
  expect?: unknown;

  // Error expectations
  /** Expected error conditions */
  expect_error?: ErrorExpectation;

  // Type expectations
  /** Expected result type (e.g., 'capability', 'array_of_capabilities') */
  expect_type?: string;
  /** Expected array length */
  expect_length?: number;

  // Verification steps
  /** Additional verification calls after the main test */
  verify?: VerifyStep[];

  // Performance constraints
  /** Maximum number of round trips allowed */
  max_round_trips?: number;

  // Pipeline tests
  /** Pipeline of method calls to execute in one round trip */
  pipeline?: PipelineStep[];

  // Setup and sequence tests
  /** Setup steps to run before the main test */
  setup?: SetupStep[];
  /** Sequence of calls with expectations */
  sequence?: SequenceStep[];

  // Map tests
  /** Server-side map expression to apply */
  map?: MapSpec;

  // Callback tests
  /** Export a callback function to the server */
  export?: ExportSpec;
}

/**
 * Error expectation configuration
 */
export interface ErrorExpectation {
  /** Expected error type/name */
  type?: string;
  /** Substring that must be in the error message */
  message_contains?: string;
  /** Accept any of these conditions (error or value) */
  any_of?: Array<{ type?: string; value?: unknown }>;
}

/**
 * A step in a pipeline
 */
export interface PipelineStep {
  /** Method to call (can be dotted for capability methods, e.g., "counter.value") */
  call: string;
  /** Arguments to pass */
  args?: unknown[];
  /** Name to assign to this step's result (for later reference) */
  as?: string;
  /** Map expression to apply to the result */
  map?: MapSpec;
}

/**
 * A setup step before the main test
 */
export interface SetupStep {
  /** Method to call */
  call: string;
  /** Arguments to pass */
  args?: unknown[];
  /** Name to store the result as */
  as?: string;
  /** Whether to await this step before continuing */
  await?: boolean;
  /** Map expression to apply */
  map?: MapSpec;
  /** Pipeline to execute in this setup step */
  pipeline?: PipelineStep[];
}

/**
 * A step in a sequence test
 */
export interface SequenceStep {
  /** Method to call */
  call: string;
  /** Arguments to pass */
  args?: unknown[];
  /** Expected result of this step */
  expect?: unknown;
}

/**
 * Server-side map specification
 */
export interface MapSpec {
  /** The map expression (e.g., "item => item.value") */
  expression: string;
  /** Variables to capture and send with the map */
  captures?: string[];
}

/**
 * Callback export specification
 */
export interface ExportSpec {
  /** Name to export the callback as */
  name: string;
  /** Type of callback (e.g., 'function') */
  type: string;
  /** Behavior expression (e.g., "x => x * 2") */
  behavior: string;
}

/**
 * A verification step to run after the main test
 */
export interface VerifyStep {
  /** Method to call */
  call: string;
  /** Expected result */
  expect: unknown;
}

/**
 * Result of running a single test
 */
export interface TestResult {
  /** Test name */
  name: string;
  /** Suite name */
  suite: string;
  /** Test outcome */
  status: 'passed' | 'failed' | 'skipped';
  /** Duration in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
  /** Stack trace if failed */
  stackTrace?: string;
  /** Reason for skipping */
  skipReason?: string;
}

/**
 * Result of running a complete test suite
 */
export interface SuiteResult {
  /** Suite name */
  name: string;
  /** Individual test results */
  tests: TestResult[];
  /** Number of passed tests */
  passed: number;
  /** Number of failed tests */
  failed: number;
  /** Number of skipped tests */
  skipped: number;
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Complete run result across all suites
 */
export interface RunResult {
  /** Results for each suite */
  suites: SuiteResult[];
  /** Total passed across all suites */
  totalPassed: number;
  /** Total failed across all suites */
  totalFailed: number;
  /** Total skipped across all suites */
  totalSkipped: number;
  /** Total duration in milliseconds */
  totalDuration: number;
  /** Timestamp of the run */
  timestamp: string;
  /** Server URL tested against */
  serverUrl: string;
}

/**
 * CLI options for the conformance runner
 */
export interface RunnerOptions {
  /** WebSocket URL of the server to test */
  serverUrl: string;
  /** Path to conformance test directory */
  testPath: string;
  /** Output format for results */
  outputFormat: 'text' | 'json' | 'junit';
  /** File to write output to (if not stdout) */
  outputFile?: string;
  /** Filter tests by name pattern */
  filter?: string;
  /** Run only specific suites */
  suites?: string[];
  /** Timeout for each test in milliseconds */
  timeout: number;
  /** Enable verbose output */
  verbose: boolean;
  /** Bail on first failure */
  bail: boolean;
}
