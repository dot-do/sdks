/**
 * YAML test specification loader
 * Loads and validates conformance test files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { TestSpec } from './types.js';

/**
 * Load all YAML test specifications from a directory
 */
export function loadTestSpecs(testPath: string): TestSpec[] {
  const specs: TestSpec[] = [];

  if (!fs.existsSync(testPath)) {
    throw new Error(`Test path does not exist: ${testPath}`);
  }

  const stat = fs.statSync(testPath);

  if (stat.isFile()) {
    // Single file
    if (testPath.endsWith('.yaml') || testPath.endsWith('.yml')) {
      specs.push(loadTestSpec(testPath));
    } else {
      throw new Error(`Test file must be a YAML file: ${testPath}`);
    }
  } else if (stat.isDirectory()) {
    // Directory - load all YAML files
    const files = fs.readdirSync(testPath)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    for (const file of files) {
      const filePath = path.join(testPath, file);
      specs.push(loadTestSpec(filePath));
    }
  } else {
    throw new Error(`Invalid test path: ${testPath}`);
  }

  return specs;
}

/**
 * Load a single YAML test specification file
 */
export function loadTestSpec(filePath: string): TestSpec {
  const content = fs.readFileSync(filePath, 'utf-8');
  const spec = yaml.load(content) as TestSpec;

  // Validate the spec
  validateTestSpec(spec, filePath);

  return spec;
}

/**
 * Validate a test specification
 */
function validateTestSpec(spec: TestSpec, filePath: string): void {
  if (!spec.name) {
    throw new Error(`Test spec missing 'name' field in ${filePath}`);
  }

  if (!spec.tests || !Array.isArray(spec.tests)) {
    throw new Error(`Test spec missing 'tests' array in ${filePath}`);
  }

  for (const test of spec.tests) {
    if (!test.name) {
      throw new Error(`Test case missing 'name' field in ${filePath}`);
    }

    // Validate that the test has at least one action
    const hasAction = test.call || test.pipeline || test.sequence;
    if (!hasAction && !test.export) {
      throw new Error(
        `Test case '${test.name}' must have at least one of: call, pipeline, sequence, export in ${filePath}`
      );
    }
  }
}

/**
 * Filter test specs by suite names
 */
export function filterBySuites(specs: TestSpec[], suiteNames: string[]): TestSpec[] {
  if (!suiteNames.length) {
    return specs;
  }

  const lowerNames = suiteNames.map(n => n.toLowerCase());
  return specs.filter(spec =>
    lowerNames.some(name =>
      spec.name.toLowerCase().includes(name) ||
      spec.name.toLowerCase().replace(/\s+/g, '-').includes(name) ||
      spec.name.toLowerCase().replace(/\s+/g, '_').includes(name)
    )
  );
}

/**
 * Filter tests within specs by name pattern
 */
export function filterByPattern(specs: TestSpec[], pattern: string): TestSpec[] {
  const regex = new RegExp(pattern, 'i');

  return specs
    .map(spec => ({
      ...spec,
      tests: spec.tests.filter(test =>
        regex.test(test.name) || (test.description && regex.test(test.description))
      ),
    }))
    .filter(spec => spec.tests.length > 0);
}

/**
 * Get a summary of loaded test specs
 */
export function getSpecsSummary(specs: TestSpec[]): {
  totalSuites: number;
  totalTests: number;
  suites: Array<{ name: string; testCount: number }>;
} {
  return {
    totalSuites: specs.length,
    totalTests: specs.reduce((sum, spec) => sum + spec.tests.length, 0),
    suites: specs.map(spec => ({
      name: spec.name,
      testCount: spec.tests.length,
    })),
  };
}
