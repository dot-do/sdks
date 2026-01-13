#!/usr/bin/env node
/**
 * CLI entry point for the conformance test runner
 *
 * Usage:
 *   npx @dotdo/conformance-runner --server-url ws://localhost:8787
 *   npx @dotdo/conformance-runner --server-url ws://localhost:8787 --output junit --output-file results.xml
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import pc from 'picocolors';

import { loadTestSpecs, filterBySuites, filterByPattern, getSpecsSummary } from './loader.js';
import { runConformanceTests } from './runner.js';
import { formatTextReport, formatJsonReport, formatJUnitReport } from './reporters/index.js';
import type { RunnerOptions, RunResult } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read package.json for version
const packageJsonPath = path.resolve(__dirname, '../package.json');
let version = '0.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  version = pkg.version;
} catch {
  // Fallback version
}

const program = new Command();

program
  .name('conformance-runner')
  .description('Cross-language conformance test runner for DotDo RPC implementations')
  .version(version);

program
  .option(
    '-s, --server-url <url>',
    'WebSocket URL of the server to test (e.g., ws://localhost:8787)'
  )
  .option(
    '-t, --test-path <path>',
    'Path to conformance test directory or file',
    findDefaultTestPath()
  )
  .option(
    '-o, --output <format>',
    'Output format: text, json, or junit',
    'text'
  )
  .option(
    '-f, --output-file <file>',
    'Write output to file instead of stdout'
  )
  .option(
    '--filter <pattern>',
    'Filter tests by name pattern (regex)'
  )
  .option(
    '--suite <names...>',
    'Run only specific suites (by name)'
  )
  .option(
    '--timeout <ms>',
    'Timeout for each test in milliseconds',
    '10000'
  )
  .option(
    '-v, --verbose',
    'Enable verbose output'
  )
  .option(
    '--bail',
    'Stop on first failure'
  )
  .option(
    '--list',
    'List available tests without running them'
  );

program.parse();

const opts = program.opts();

/**
 * Find the default test path
 */
function findDefaultTestPath(): string {
  // Try to find the conformance tests relative to this package
  const possiblePaths = [
    path.resolve(__dirname, '../../../../test/conformance'),
    path.resolve(__dirname, '../../../test/conformance'),
    path.resolve(process.cwd(), 'test/conformance'),
    path.resolve(process.cwd(), 'conformance'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Default to current directory
  return process.cwd();
}

/**
 * Format the results based on output format
 */
function formatResults(result: RunResult, format: string, verbose: boolean): string {
  switch (format) {
    case 'json':
      return formatJsonReport(result);
    case 'junit':
      return formatJUnitReport(result);
    case 'text':
    default:
      return formatTextReport(result, verbose);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Validate output format
    const validFormats = ['text', 'json', 'junit'];
    if (!validFormats.includes(opts.output)) {
      console.error(pc.red(`Invalid output format: ${opts.output}`));
      console.error(`Valid formats: ${validFormats.join(', ')}`);
      process.exit(1);
    }

    // Load test specs
    console.error(pc.dim(`Loading tests from: ${opts.testPath}`));
    let specs = loadTestSpecs(opts.testPath);

    // Filter by suites
    if (opts.suite && opts.suite.length > 0) {
      specs = filterBySuites(specs, opts.suite);
      if (specs.length === 0) {
        console.error(pc.red('No matching suites found'));
        process.exit(1);
      }
    }

    // Filter by pattern
    if (opts.filter) {
      specs = filterByPattern(specs, opts.filter);
      if (specs.length === 0) {
        console.error(pc.red('No tests match the filter pattern'));
        process.exit(1);
      }
    }

    // List mode
    if (opts.list) {
      const summary = getSpecsSummary(specs);
      console.log(pc.bold('\nAvailable Conformance Tests\n'));
      console.log(pc.dim('─'.repeat(50)));

      for (const spec of specs) {
        console.log(`\n${pc.bold(spec.name)}`);
        for (const test of spec.tests) {
          console.log(`  - ${test.name}`);
          if (test.description && opts.verbose) {
            console.log(pc.dim(`    ${test.description}`));
          }
        }
      }

      console.log('\n' + pc.dim('─'.repeat(50)));
      console.log(
        `\nTotal: ${summary.totalSuites} suites, ${summary.totalTests} tests`
      );
      process.exit(0);
    }

    // Validate server-url is provided when running tests
    if (!opts.serverUrl) {
      console.error(pc.red('Error: --server-url is required when running tests'));
      console.error(pc.dim('Use --list to list tests without connecting to a server'));
      process.exit(1);
    }

    // Build runner options
    const options: RunnerOptions = {
      serverUrl: opts.serverUrl,
      testPath: opts.testPath,
      outputFormat: opts.output as 'text' | 'json' | 'junit',
      outputFile: opts.outputFile,
      filter: opts.filter,
      suites: opts.suite,
      timeout: parseInt(opts.timeout, 10),
      verbose: opts.verbose || false,
      bail: opts.bail || false,
    };

    // Print test summary
    const summary = getSpecsSummary(specs);
    console.error(
      pc.dim(`Running ${summary.totalTests} tests from ${summary.totalSuites} suites...`)
    );
    console.error(pc.dim(`Connecting to: ${options.serverUrl}\n`));

    // Run the tests
    const result = await runConformanceTests(specs, options);

    // Format output
    const output = formatResults(result, opts.output, opts.verbose);

    // Write output
    if (opts.outputFile) {
      fs.writeFileSync(opts.outputFile, output, 'utf-8');
      console.error(pc.dim(`Results written to: ${opts.outputFile}`));
    } else {
      console.log(output);
    }

    // Exit with appropriate code
    if (result.totalFailed > 0) {
      process.exit(1);
    }
  } catch (error) {
    const err = error as Error;
    console.error(pc.red(`Error: ${err.message}`));
    if (opts.verbose && err.stack) {
      console.error(pc.dim(err.stack));
    }
    process.exit(1);
  }
}

main();
