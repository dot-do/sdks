/**
 * Text reporter for console output
 */

import pc from 'picocolors';
import type { RunResult, SuiteResult, TestResult } from '../types.js';

/**
 * Format test results as colored console output
 */
export function formatTextReport(result: RunResult, verbose: boolean): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(pc.bold('DotDo Conformance Test Results'));
  lines.push(pc.dim(`Server: ${result.serverUrl}`));
  lines.push(pc.dim(`Timestamp: ${result.timestamp}`));
  lines.push('');

  for (const suite of result.suites) {
    lines.push(...formatSuite(suite, verbose));
  }

  // Summary
  lines.push('');
  lines.push(pc.bold('Summary'));
  lines.push(pc.dim('─'.repeat(50)));

  const totalTests = result.totalPassed + result.totalFailed + result.totalSkipped;

  if (result.totalPassed > 0) {
    lines.push(pc.green(`  ${result.totalPassed} passed`));
  }
  if (result.totalFailed > 0) {
    lines.push(pc.red(`  ${result.totalFailed} failed`));
  }
  if (result.totalSkipped > 0) {
    lines.push(pc.yellow(`  ${result.totalSkipped} skipped`));
  }

  lines.push(pc.dim(`  ${totalTests} total`));
  lines.push(pc.dim(`  ${formatDuration(result.totalDuration)}`));
  lines.push('');

  // Final status
  if (result.totalFailed === 0) {
    lines.push(pc.green(pc.bold('All tests passed!')));
  } else {
    lines.push(pc.red(pc.bold(`${result.totalFailed} test(s) failed`)));
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a test suite
 */
function formatSuite(suite: SuiteResult, verbose: boolean): string[] {
  const lines: string[] = [];

  // Suite header
  const statusIcon = suite.failed > 0 ? pc.red('x') : pc.green('\u2713');
  lines.push(`${statusIcon} ${pc.bold(suite.name)} ${pc.dim(`(${formatDuration(suite.duration)})`)}`);

  // Individual tests
  for (const test of suite.tests) {
    lines.push(formatTest(test, verbose));
  }

  // Suite summary if multiple tests
  if (suite.tests.length > 1) {
    const parts: string[] = [];
    if (suite.passed > 0) parts.push(pc.green(`${suite.passed} passed`));
    if (suite.failed > 0) parts.push(pc.red(`${suite.failed} failed`));
    if (suite.skipped > 0) parts.push(pc.yellow(`${suite.skipped} skipped`));
    lines.push(pc.dim(`  ${parts.join(', ')}`));
  }

  lines.push('');

  return lines;
}

/**
 * Format a single test result
 */
function formatTest(test: TestResult, verbose: boolean): string {
  const parts: string[] = [];

  // Status icon
  switch (test.status) {
    case 'passed':
      parts.push(pc.green('    \u2713'));
      break;
    case 'failed':
      parts.push(pc.red('    x'));
      break;
    case 'skipped':
      parts.push(pc.yellow('    -'));
      break;
  }

  // Test name
  parts.push(test.name);

  // Duration
  parts.push(pc.dim(`(${formatDuration(test.duration)})`));

  let line = parts.join(' ');

  // Error details for failed tests
  if (test.status === 'failed' && test.error) {
    line += '\n' + pc.red(`      Error: ${test.error}`);
    if (verbose && test.stackTrace) {
      const stackLines = test.stackTrace.split('\n').slice(0, 5);
      line += '\n' + pc.dim(stackLines.map((l) => `      ${l}`).join('\n'));
    }
  }

  // Skip reason
  if (test.status === 'skipped' && test.skipReason) {
    line += pc.dim(` - ${test.skipReason}`);
  }

  return line;
}

/**
 * Format a duration in ms to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}
