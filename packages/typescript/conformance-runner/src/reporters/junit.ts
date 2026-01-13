/**
 * JUnit XML reporter for CI integration
 * Outputs test results in JUnit XML format
 */

import type { RunResult, SuiteResult, TestResult } from '../types.js';

/**
 * Format test results as JUnit XML
 */
export function formatJUnitReport(result: RunResult): string {
  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // Calculate totals
  const totalTests = result.totalPassed + result.totalFailed + result.totalSkipped;
  const totalTime = result.totalDuration / 1000; // Convert to seconds

  // Root testsuites element
  lines.push(
    `<testsuites name="DotDo Conformance Tests" tests="${totalTests}" failures="${result.totalFailed}" errors="0" skipped="${result.totalSkipped}" time="${totalTime.toFixed(3)}" timestamp="${result.timestamp}">`
  );

  // Each suite
  for (const suite of result.suites) {
    lines.push(...formatSuite(suite));
  }

  lines.push('</testsuites>');

  return lines.join('\n');
}

/**
 * Format a single test suite
 */
function formatSuite(suite: SuiteResult): string[] {
  const lines: string[] = [];

  const totalTests = suite.passed + suite.failed + suite.skipped;
  const time = suite.duration / 1000;

  // Escape the suite name for XML
  const suiteName = escapeXml(suite.name);

  lines.push(
    `  <testsuite name="${suiteName}" tests="${totalTests}" failures="${suite.failed}" errors="0" skipped="${suite.skipped}" time="${time.toFixed(3)}">`
  );

  // Each test case
  for (const test of suite.tests) {
    lines.push(...formatTestCase(test, suite.name));
  }

  lines.push('  </testsuite>');

  return lines;
}

/**
 * Format a single test case
 */
function formatTestCase(test: TestResult, suiteName: string): string[] {
  const lines: string[] = [];

  const time = test.duration / 1000;
  const testName = escapeXml(test.name);
  const className = escapeXml(suiteName.replace(/\s+/g, '.'));

  lines.push(
    `    <testcase name="${testName}" classname="${className}" time="${time.toFixed(3)}">`
  );

  // Add failure or skip information
  if (test.status === 'failed') {
    const errorMessage = escapeXml(test.error || 'Test failed');
    const errorType = 'AssertionError';

    lines.push(`      <failure message="${errorMessage}" type="${errorType}">`);
    if (test.stackTrace) {
      lines.push(escapeXml(test.stackTrace));
    }
    lines.push('      </failure>');
  } else if (test.status === 'skipped') {
    const skipMessage = test.skipReason ? escapeXml(test.skipReason) : '';
    lines.push(`      <skipped message="${skipMessage}"/>`);
  }

  lines.push('    </testcase>');

  return lines;
}

/**
 * Escape special characters for XML
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
