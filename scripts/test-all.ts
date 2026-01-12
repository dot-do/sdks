#!/usr/bin/env npx tsx
// Cross-language test orchestrator
// Runs conformance tests against all 17 language SDK implementations

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { setup, teardown } from '../__tests__/test-server.js';

// ANSI colors
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

interface LanguageConfig {
  name: string;
  displayName: string;
  dir: string;
  testCommand: string[];
  setupCommand?: string[];
  env?: Record<string, string>;
  resultParser?: (stdout: string) => TestResult;
}

interface TestResult {
  language: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration_ms: number;
  error?: string;
  tests?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'skip';
    error?: string;
    duration_ms?: number;
  }>;
}

const LANGUAGES: LanguageConfig[] = [
  {
    name: 'typescript',
    displayName: 'TypeScript',
    dir: '.',
    testCommand: ['npm', 'run', 'test', '--', '--reporter=json'],
  },
  {
    name: 'python',
    displayName: 'Python',
    dir: 'packages/python',
    setupCommand: ['pip', 'install', '-e', '.[test]'],
    testCommand: ['pytest', '--tb=short', '-q'],
  },
  {
    name: 'rust',
    displayName: 'Rust',
    dir: 'packages/rust',
    testCommand: ['cargo', 'test', '--', '--test-threads=1'],
  },
  {
    name: 'go',
    displayName: 'Go',
    dir: 'packages/go',
    testCommand: ['go', 'test', '-v', './...'],
  },
  {
    name: 'dotnet',
    displayName: 'C#/.NET',
    dir: 'packages/dotnet',
    testCommand: ['dotnet', 'test', '--verbosity', 'normal'],
  },
  {
    name: 'java',
    displayName: 'Java',
    dir: 'packages/java',
    testCommand: ['./gradlew', 'test', '--info'],
  },
  {
    name: 'ruby',
    displayName: 'Ruby',
    dir: 'packages/ruby',
    setupCommand: ['bundle', 'install'],
    testCommand: ['bundle', 'exec', 'rspec', '--format', 'progress'],
  },
  {
    name: 'php',
    displayName: 'PHP',
    dir: 'packages/php',
    setupCommand: ['composer', 'install'],
    testCommand: ['./vendor/bin/phpunit'],
  },
  {
    name: 'swift',
    displayName: 'Swift',
    dir: 'packages/swift',
    testCommand: ['swift', 'test'],
  },
  {
    name: 'kotlin',
    displayName: 'Kotlin',
    dir: 'packages/kotlin',
    testCommand: ['./gradlew', 'test'],
  },
  {
    name: 'dart',
    displayName: 'Dart',
    dir: 'packages/dart',
    setupCommand: ['dart', 'pub', 'get'],
    testCommand: ['dart', 'test'],
  },
  {
    name: 'scala',
    displayName: 'Scala',
    dir: 'packages/scala',
    testCommand: ['sbt', 'test'],
  },
  {
    name: 'deno',
    displayName: 'Deno',
    dir: 'packages/deno',
    testCommand: ['deno', 'test', '--allow-net', '--allow-read'],
  },
  {
    name: 'elixir',
    displayName: 'Elixir',
    dir: 'packages/elixir',
    setupCommand: ['mix', 'deps.get'],
    testCommand: ['mix', 'test'],
  },
  {
    name: 'fsharp',
    displayName: 'F#',
    dir: 'packages/fsharp',
    testCommand: ['dotnet', 'test'],
  },
  {
    name: 'clojure',
    displayName: 'Clojure',
    dir: 'packages/clojure',
    testCommand: ['clojure', '-M:test'],
  },
  {
    name: 'crystal',
    displayName: 'Crystal',
    dir: 'packages/crystal',
    testCommand: ['crystal', 'spec'],
  },
  {
    name: 'nim',
    displayName: 'Nim',
    dir: 'packages/nim',
    testCommand: ['nimble', 'test'],
  },
];

async function runCommand(
  command: string[],
  cwd: string,
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

async function testLanguage(
  lang: LanguageConfig,
  serverUrl: string
): Promise<TestResult> {
  const startTime = Date.now();
  const cwd = path.resolve(process.cwd(), lang.dir);
  const env = {
    TEST_SERVER_URL: serverUrl,
    TEST_SERVER_WS_URL: serverUrl.replace('http://', 'ws://'),
    TEST_SPEC_DIR: path.resolve(process.cwd(), 'test/conformance'),
    ...lang.env,
  };

  // Check if directory exists
  if (!fs.existsSync(cwd)) {
    return {
      language: lang.name,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration_ms: Date.now() - startTime,
      error: `Directory not found: ${cwd}`,
    };
  }

  // Check if test infrastructure exists
  const hasTests =
    fs.existsSync(path.join(cwd, 'tests')) ||
    fs.existsSync(path.join(cwd, 'test')) ||
    fs.existsSync(path.join(cwd, 'spec')) ||
    fs.existsSync(path.join(cwd, 'src', 'test'));

  if (!hasTests && lang.name !== 'typescript') {
    return {
      language: lang.name,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration_ms: Date.now() - startTime,
      error: 'No test directory found (tests not implemented yet)',
    };
  }

  // Run setup command if specified
  if (lang.setupCommand) {
    const setupResult = await runCommand(lang.setupCommand, cwd, env);
    if (setupResult.exitCode !== 0) {
      return {
        language: lang.name,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration_ms: Date.now() - startTime,
        error: `Setup failed: ${setupResult.stderr || setupResult.stdout}`,
      };
    }
  }

  // Run tests
  const result = await runCommand(lang.testCommand, cwd, env);
  const duration_ms = Date.now() - startTime;

  if (result.exitCode !== 0) {
    // Try to parse partial results
    return {
      language: lang.name,
      passed: 0,
      failed: 1,
      skipped: 0,
      total: 1,
      duration_ms,
      error: result.stderr || result.stdout || 'Tests failed',
    };
  }

  // Parse results (simplified - each language will need custom parsing)
  return {
    language: lang.name,
    passed: 1,
    failed: 0,
    skipped: 0,
    total: 1,
    duration_ms,
  };
}

function printProgress(results: Map<string, TestResult | 'running' | 'pending'>) {
  console.clear();
  console.log(`${BOLD}Cap'n Web Cross-Language Test Suite${RESET}\n`);

  for (const [name, result] of results) {
    const lang = LANGUAGES.find((l) => l.name === name);
    const displayName = lang?.displayName ?? name;

    if (result === 'pending') {
      console.log(`  ${DIM}○${RESET} ${displayName} ${DIM}(pending)${RESET}`);
    } else if (result === 'running') {
      console.log(`  ${BLUE}●${RESET} ${displayName} ${BLUE}(running...)${RESET}`);
    } else if (result.error) {
      console.log(`  ${RED}✗${RESET} ${displayName} ${RED}(error: ${result.error.slice(0, 50)}...)${RESET}`);
    } else if (result.failed > 0) {
      console.log(`  ${RED}✗${RESET} ${displayName} ${RED}(${result.passed}/${result.total} passed)${RESET}`);
    } else {
      console.log(`  ${GREEN}✓${RESET} ${displayName} ${GREEN}(${result.passed}/${result.total} passed)${RESET} ${DIM}${result.duration_ms}ms${RESET}`);
    }
  }
}

function printSummary(results: TestResult[]) {
  console.log(`\n${BOLD}═══ Summary ═══${RESET}\n`);

  const passed = results.filter((r) => !r.error && r.failed === 0);
  const failed = results.filter((r) => r.error || r.failed > 0);
  const notImplemented = results.filter((r) => r.error?.includes('not implemented'));

  console.log(`${GREEN}Passed:${RESET} ${passed.length}`);
  console.log(`${RED}Failed:${RESET} ${failed.length - notImplemented.length}`);
  console.log(`${YELLOW}Not Implemented:${RESET} ${notImplemented.length}`);
  console.log(`${DIM}Total Languages:${RESET} ${results.length}`);

  if (failed.length > 0) {
    console.log(`\n${BOLD}Failed Languages:${RESET}`);
    for (const result of failed) {
      if (!result.error?.includes('not implemented')) {
        console.log(`  ${RED}•${RESET} ${result.language}: ${result.error || `${result.failed} tests failed`}`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const specificLanguage = args.find((a) => !a.startsWith('--'));
  const verbose = args.includes('--verbose') || args.includes('-v');
  const parallel = !args.includes('--sequential');

  console.log(`${BOLD}Starting test server...${RESET}`);

  // Create a mock project for setup
  let serverUrl = '';
  const mockProject = {
    provide: (key: string, value: string) => {
      if (key === 'testServerHost') {
        serverUrl = `http://${value}`;
      }
    },
  };

  await setup(mockProject as any);
  console.log(`${GREEN}Test server running at ${serverUrl}${RESET}\n`);

  // Filter languages if specific one requested
  const languagesToTest = specificLanguage
    ? LANGUAGES.filter((l) => l.name === specificLanguage)
    : LANGUAGES;

  if (specificLanguage && languagesToTest.length === 0) {
    console.error(`${RED}Unknown language: ${specificLanguage}${RESET}`);
    console.log(`Available languages: ${LANGUAGES.map((l) => l.name).join(', ')}`);
    process.exit(1);
  }

  // Initialize progress tracking
  const progress = new Map<string, TestResult | 'running' | 'pending'>();
  for (const lang of languagesToTest) {
    progress.set(lang.name, 'pending');
  }

  // Run tests
  let results: TestResult[];

  if (parallel) {
    // Run all in parallel
    const promises = languagesToTest.map(async (lang) => {
      progress.set(lang.name, 'running');
      if (!verbose) printProgress(progress);

      const result = await testLanguage(lang, serverUrl);
      progress.set(lang.name, result);
      if (!verbose) printProgress(progress);

      return result;
    });

    results = await Promise.all(promises);
  } else {
    // Run sequentially
    results = [];
    for (const lang of languagesToTest) {
      progress.set(lang.name, 'running');
      if (!verbose) printProgress(progress);

      const result = await testLanguage(lang, serverUrl);
      results.push(result);
      progress.set(lang.name, result);
      if (!verbose) printProgress(progress);
    }
  }

  // Final output
  if (!verbose) printProgress(progress);
  printSummary(results);

  // Write results to file
  const resultsDir = path.resolve(process.cwd(), 'test/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  for (const result of results) {
    fs.writeFileSync(
      path.join(resultsDir, `${result.language}.json`),
      JSON.stringify(result, null, 2)
    );
  }

  fs.writeFileSync(
    path.join(resultsDir, 'summary.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      results,
      totals: {
        languages: results.length,
        passed: results.filter((r) => !r.error && r.failed === 0).length,
        failed: results.filter((r) => r.error || r.failed > 0).length,
      },
    }, null, 2)
  );

  console.log(`\n${DIM}Results written to test/results/${RESET}`);

  // Cleanup
  await teardown();

  // Exit with appropriate code
  const hasFailures = results.some(
    (r) => (r.error && !r.error.includes('not implemented')) || r.failed > 0
  );
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
