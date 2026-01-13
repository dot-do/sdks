/**
 * @dotdo/conformance-runner
 *
 * Cross-language conformance test runner for DotDo RPC implementations.
 * This package can test any server implementation that speaks the DotDo
 * RPC protocol over WebSocket.
 *
 * CLI Usage:
 *   npx @dotdo/conformance-runner --server-url ws://localhost:8787
 *
 * Programmatic Usage:
 *   import { runConformanceTests, loadTestSpecs } from '@dotdo/conformance-runner';
 *
 *   const specs = loadTestSpecs('/path/to/conformance/tests');
 *   const results = await runConformanceTests(specs, {
 *     serverUrl: 'ws://localhost:8787',
 *     ...
 *   });
 */

// Types
export type {
  TestSpec,
  TestCase,
  TestResult,
  SuiteResult,
  RunResult,
  RunnerOptions,
  PipelineStep,
  SetupStep,
  SequenceStep,
  MapSpec,
  ExportSpec,
  VerifyStep,
  ErrorExpectation,
} from './types.js';

// Loader
export {
  loadTestSpecs,
  loadTestSpec,
  filterBySuites,
  filterByPattern,
  getSpecsSummary,
} from './loader.js';

// Runner
export { runConformanceTests } from './runner.js';

// Client
export { ConformanceClient, type CapabilityRef } from './client.js';

// Reporters
export { formatTextReport } from './reporters/text.js';
export { formatJsonReport } from './reporters/json.js';
export { formatJUnitReport } from './reporters/junit.js';
