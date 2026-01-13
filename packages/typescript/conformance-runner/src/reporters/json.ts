/**
 * JSON reporter for machine-readable output
 */

import type { RunResult } from '../types.js';

/**
 * Format test results as JSON
 */
export function formatJsonReport(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}
