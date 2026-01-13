/**
 * Type definitions for conformance test specifications
 * These types match the YAML test format used in test/conformance/
 */
/**
 * A complete test specification file
 */
interface TestSpec {
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
interface TestCase {
    /** Unique test name (used as identifier) */
    name: string;
    /** Human-readable description */
    description?: string;
    /** Method to call on the server */
    call?: string;
    /** Arguments to pass to the method */
    args?: unknown[];
    /** Expected return value */
    expect?: unknown;
    /** Expected error conditions */
    expect_error?: ErrorExpectation;
    /** Expected result type (e.g., 'capability', 'array_of_capabilities') */
    expect_type?: string;
    /** Expected array length */
    expect_length?: number;
    /** Additional verification calls after the main test */
    verify?: VerifyStep[];
    /** Maximum number of round trips allowed */
    max_round_trips?: number;
    /** Pipeline of method calls to execute in one round trip */
    pipeline?: PipelineStep[];
    /** Setup steps to run before the main test */
    setup?: SetupStep[];
    /** Sequence of calls with expectations */
    sequence?: SequenceStep[];
    /** Server-side map expression to apply */
    map?: MapSpec;
    /** Export a callback function to the server */
    export?: ExportSpec;
}
/**
 * Error expectation configuration
 */
interface ErrorExpectation {
    /** Expected error type/name */
    type?: string;
    /** Substring that must be in the error message */
    message_contains?: string;
    /** Accept any of these conditions (error or value) */
    any_of?: Array<{
        type?: string;
        value?: unknown;
    }>;
}
/**
 * A step in a pipeline
 */
interface PipelineStep {
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
interface SetupStep {
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
interface SequenceStep {
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
interface MapSpec {
    /** The map expression (e.g., "item => item.value") */
    expression: string;
    /** Variables to capture and send with the map */
    captures?: string[];
}
/**
 * Callback export specification
 */
interface ExportSpec {
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
interface VerifyStep {
    /** Method to call */
    call: string;
    /** Expected result */
    expect: unknown;
}
/**
 * Result of running a single test
 */
interface TestResult {
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
interface SuiteResult {
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
interface RunResult {
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
interface RunnerOptions {
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

/**
 * YAML test specification loader
 * Loads and validates conformance test files
 */

/**
 * Load all YAML test specifications from a directory
 */
declare function loadTestSpecs(testPath: string): TestSpec[];
/**
 * Load a single YAML test specification file
 */
declare function loadTestSpec(filePath: string): TestSpec;
/**
 * Filter test specs by suite names
 */
declare function filterBySuites(specs: TestSpec[], suiteNames: string[]): TestSpec[];
/**
 * Filter tests within specs by name pattern
 */
declare function filterByPattern(specs: TestSpec[], pattern: string): TestSpec[];
/**
 * Get a summary of loaded test specs
 */
declare function getSpecsSummary(specs: TestSpec[]): {
    totalSuites: number;
    totalTests: number;
    suites: Array<{
        name: string;
        testCount: number;
    }>;
};

/**
 * Test runner for conformance tests
 * Executes tests against any server implementation
 */

/**
 * Run all conformance tests against a server
 */
declare function runConformanceTests(specs: TestSpec[], options: RunnerOptions): Promise<RunResult>;

/**
 * WebSocket RPC client for conformance testing
 * Connects to any language's server implementation
 */
/**
 * Capability reference (stub)
 */
interface CapabilityRef {
    __capabilityId: number;
}
/**
 * RPC client for conformance testing
 */
declare class ConformanceClient {
    private ws;
    private requestId;
    private pendingRequests;
    private connected;
    private capabilities;
    private roundTripCount;
    /**
     * Connect to a WebSocket server
     */
    connect(url: string, timeout?: number): Promise<void>;
    /**
     * Disconnect from the server
     */
    disconnect(): void;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Get round trip count (for testing pipelining efficiency)
     */
    getRoundTripCount(): number;
    /**
     * Reset round trip counter
     */
    resetRoundTrips(): void;
    /**
     * Call a method on the root object
     */
    call(method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Call a method on a capability
     */
    callOnCapability(capability: CapabilityRef | unknown, method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Execute a pipeline of calls in a single round trip
     */
    pipeline(steps: Array<{
        method: string;
        target?: string | number | CapabilityRef;
        args?: unknown[];
        as?: string;
    }>): Promise<Record<string, unknown>>;
    /**
     * Get self reference (capability ID 0)
     */
    getSelf(): CapabilityRef;
    /**
     * Check if a value is a capability reference
     */
    isCapabilityRef(value: unknown): value is CapabilityRef;
    private sendRequest;
    private sendRaw;
    private handleMessage;
    private processResult;
    private getCapabilityId;
    private resolveTarget;
    private resolveArgs;
}

/**
 * Text reporter for console output
 */

/**
 * Format test results as colored console output
 */
declare function formatTextReport(result: RunResult, verbose: boolean): string;

/**
 * JSON reporter for machine-readable output
 */

/**
 * Format test results as JSON
 */
declare function formatJsonReport(result: RunResult): string;

/**
 * JUnit XML reporter for CI integration
 * Outputs test results in JUnit XML format
 */

/**
 * Format test results as JUnit XML
 */
declare function formatJUnitReport(result: RunResult): string;

export { type CapabilityRef, ConformanceClient, type ErrorExpectation, type ExportSpec, type MapSpec, type PipelineStep, type RunResult, type RunnerOptions, type SequenceStep, type SetupStep, type SuiteResult, type TestCase, type TestResult, type TestSpec, type VerifyStep, filterByPattern, filterBySuites, formatJUnitReport, formatJsonReport, formatTextReport, getSpecsSummary, loadTestSpec, loadTestSpecs, runConformanceTests };
