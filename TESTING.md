# Cross-Language Test-Driven Development Strategy

This document outlines the TDD strategy for testing all 17 language SDK clients against the official capnweb test server.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Test Orchestrator (Node.js)                      │
│  • Starts test server                                                │
│  • Runs language test suites in parallel                             │
│  • Aggregates results                                                │
│  • Generates reports                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │ Test Server │ │ Test Spec   │ │ Results DB  │
            │ (TypeScript)│ │ (YAML)      │ │ (JSON)      │
            │ Port: 0     │ │ test/*.yaml │ │ .test-out/  │
            └─────────────┘ └─────────────┘ └─────────────┘
                    │              │
        ┌───────────┼───────────┬──┴──────────┬───────────┐
        ▼           ▼           ▼             ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ Python  │ │  Rust   │ │   Go    │ │  Java   │ │  ...    │
   │ pytest  │ │ cargo   │ │ go test │ │ JUnit   │ │ (x17)   │
   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

## Components

### 1. Test Server (Already Exists)

The official capnweb test server at `__tests__/test-server.ts` exposes:

**TestTarget Methods:**
| Method | Signature | Description |
|--------|-----------|-------------|
| `square` | `(i: number) => number` | Returns i² |
| `callSquare` | `(self, i) => {result}` | Self-referential RPC |
| `callFunction` | `(func, i) => {result}` | Callback invocation |
| `throwError` | `() => never` | Throws RangeError |
| `makeCounter` | `(i) => Counter` | Factory for Counter |
| `incrementCounter` | `(c, i) => number` | Calls remote Counter |
| `generateFibonacci` | `(length) => number[]` | Returns Fibonacci |
| `returnNull` | `() => null` | Returns null |
| `returnUndefined` | `() => undefined` | Returns undefined |
| `returnNumber` | `(i) => number` | Identity function |

**Counter Methods:**
| Method | Signature | Description |
|--------|-----------|-------------|
| `increment` | `(amount?) => number` | Increment and return |
| `value` | getter | Current value |

### 2. Protocol Conformance Test Suite

Test cases defined in YAML at `test/conformance/*.yaml`:

```yaml
# test/conformance/basic.yaml
name: Basic RPC Calls
tests:
  - name: square_positive
    call: square
    args: [5]
    expect: 25

  - name: square_negative
    call: square
    args: [-3]
    expect: 9

  - name: square_zero
    call: square
    args: [0]
    expect: 0
```

```yaml
# test/conformance/pipelining.yaml
name: Promise Pipelining
tests:
  - name: pipeline_counter
    description: Create counter and increment in one round trip
    pipeline:
      - call: makeCounter
        args: [10]
        as: counter
      - call: counter.increment
        args: [5]
    expect: 15
    max_round_trips: 1
```

```yaml
# test/conformance/errors.yaml
name: Error Handling
tests:
  - name: remote_error
    call: throwError
    expect_error:
      type: RangeError
      message: "test error"
```

```yaml
# test/conformance/callbacks.yaml
name: Bidirectional RPC
tests:
  - name: callback_invocation
    description: Server calls client-provided function
    setup:
      export_function:
        name: doubler
        impl: "(x) => x * 2"
    call: callFunction
    args: ["$doubler", 21]
    expect:
      result: 42
```

### 3. Language Test Harnesses

Each language implements a test runner that:
1. Connects to the test server (URL provided via env var)
2. Reads test specs from YAML
3. Executes tests
4. Outputs results in JSON format

**Standard Interface (per language):**

```
# Input
TEST_SERVER_URL=http://localhost:12345
TEST_SPEC_DIR=test/conformance

# Output (stdout)
{
  "language": "python",
  "total": 42,
  "passed": 40,
  "failed": 2,
  "skipped": 0,
  "duration_ms": 1234,
  "results": [
    {"name": "square_positive", "status": "pass", "duration_ms": 12},
    {"name": "pipeline_counter", "status": "fail", "error": "...", "duration_ms": 34}
  ]
}
```

### 4. Test Orchestrator

Node.js script at `scripts/test-all.ts`:

```typescript
import { spawn } from 'child_process';
import { setup, teardown } from '../__tests__/test-server';

interface LanguageConfig {
  name: string;
  dir: string;
  command: string[];
  env?: Record<string, string>;
}

const LANGUAGES: LanguageConfig[] = [
  { name: 'python', dir: 'packages/python', command: ['pytest', '--json-report'] },
  { name: 'rust', dir: 'packages/rust', command: ['cargo', 'test', '--', '--format=json'] },
  { name: 'go', dir: 'packages/go', command: ['go', 'test', '-json', './...'] },
  { name: 'dotnet', dir: 'packages/dotnet', command: ['dotnet', 'test', '--logger:json'] },
  { name: 'java', dir: 'packages/java', command: ['./gradlew', 'test', '--info'] },
  { name: 'ruby', dir: 'packages/ruby', command: ['bundle', 'exec', 'rspec', '--format', 'json'] },
  { name: 'php', dir: 'packages/php', command: ['./vendor/bin/phpunit', '--log-json'] },
  { name: 'swift', dir: 'packages/swift', command: ['swift', 'test'] },
  { name: 'kotlin', dir: 'packages/kotlin', command: ['./gradlew', 'test'] },
  { name: 'dart', dir: 'packages/dart', command: ['dart', 'test', '--reporter=json'] },
  { name: 'scala', dir: 'packages/scala', command: ['sbt', 'test'] },
  { name: 'deno', dir: 'packages/deno', command: ['deno', 'test', '--reporter=json'] },
  { name: 'elixir', dir: 'packages/elixir', command: ['mix', 'test', '--formatter', 'JSON'] },
  { name: 'fsharp', dir: 'packages/fsharp', command: ['dotnet', 'test'] },
  { name: 'clojure', dir: 'packages/clojure', command: ['clojure', '-M:test'] },
  { name: 'crystal', dir: 'packages/crystal', command: ['crystal', 'spec', '--format=json'] },
  { name: 'nim', dir: 'packages/nim', command: ['nimble', 'test'] },
];

async function main() {
  // Start test server
  const serverUrl = await setup();

  // Run all language tests in parallel
  const results = await Promise.all(
    LANGUAGES.map(lang => runLanguageTests(lang, serverUrl))
  );

  // Generate report
  generateReport(results);

  // Cleanup
  await teardown();
}
```

## Test Categories

### Level 1: Protocol Conformance (Required)
Every SDK must pass these tests to be considered functional.

| Category | Tests | Description |
|----------|-------|-------------|
| `basic` | 10 | Simple method calls, return types |
| `errors` | 5 | Error propagation, types, messages |
| `types` | 15 | Serialization: null, arrays, objects, dates, bytes |
| `pipelining` | 10 | Single round-trip chains |
| `capabilities` | 8 | Passing stubs as arguments |

### Level 2: Advanced Features (Recommended)
SDKs should pass these for production readiness.

| Category | Tests | Description |
|----------|-------|-------------|
| `callbacks` | 6 | Server calling client functions |
| `streaming` | 5 | AsyncIterator/Stream handling |
| `batching` | 5 | HTTP batch mode |
| `cancellation` | 4 | Request cancellation |
| `reconnection` | 3 | Connection recovery |

### Level 3: Stress Tests (Optional)
For performance validation.

| Category | Tests | Description |
|----------|-------|-------------|
| `concurrent` | 5 | Parallel requests |
| `large_payloads` | 3 | Big data handling |
| `long_chains` | 3 | Deep pipelining |

## Directory Structure

```
dot-do-capnweb/
├── __tests__/
│   ├── test-server.ts      # Official test server (unchanged)
│   └── test-util.ts        # TestTarget, Counter (unchanged)
├── test/
│   ├── conformance/        # Language-agnostic test specs
│   │   ├── basic.yaml
│   │   ├── errors.yaml
│   │   ├── types.yaml
│   │   ├── pipelining.yaml
│   │   └── capabilities.yaml
│   └── results/            # Generated test results
│       ├── python.json
│       ├── rust.json
│       └── ...
├── scripts/
│   ├── test-all.ts         # Orchestrator
│   ├── test-language.ts    # Single language runner
│   └── generate-report.ts  # HTML/Markdown report generator
└── packages/
    ├── python/
    │   └── tests/
    │       ├── conftest.py         # pytest fixtures
    │       ├── test_conformance.py # Reads YAML specs
    │       └── test_python.py      # Python-specific tests
    ├── rust/
    │   └── tests/
    │       ├── conformance.rs      # Reads YAML specs
    │       └── rust_specific.rs
    └── .../
```

## Running Tests

### All Languages
```bash
# Run all language tests in parallel
npm run test:all

# Run with verbose output
npm run test:all -- --verbose

# Run specific test category
npm run test:all -- --category=pipelining
```

### Single Language
```bash
# Test a specific language
npm run test:lang python
npm run test:lang rust
npm run test:lang go

# Or directly in the package
cd packages/python && pytest
cd packages/rust && cargo test
cd packages/go && go test ./...
```

### CI Integration
```yaml
# .github/workflows/test.yml
name: Test All Languages
on: [push, pull_request]

jobs:
  test-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build

  test-languages:
    needs: test-server
    strategy:
      matrix:
        language: [python, rust, go, dotnet, java, ruby, php, swift, kotlin, dart, scala, deno, elixir, fsharp, clojure, crystal, nim]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-${{ matrix.language }}
      - run: npm run test:lang ${{ matrix.language }}

  report:
    needs: test-languages
    runs-on: ubuntu-latest
    steps:
      - run: npm run test:report
      - uses: actions/upload-artifact@v4
        with:
          name: test-report
          path: test/results/
```

## Per-Language Test Setup

### Python
```python
# packages/python/tests/conftest.py
import pytest
import yaml
import os

@pytest.fixture(scope="session")
def server_url():
    return os.environ.get("TEST_SERVER_URL", "http://localhost:8787")

@pytest.fixture(scope="session")
def api(server_url):
    import capnweb
    return capnweb.connect(server_url)

def load_conformance_tests():
    tests = []
    for spec_file in Path("../../test/conformance").glob("*.yaml"):
        with open(spec_file) as f:
            spec = yaml.safe_load(f)
            for test in spec["tests"]:
                tests.append(pytest.param(test, id=test["name"]))
    return tests

@pytest.mark.parametrize("test_case", load_conformance_tests())
async def test_conformance(api, test_case):
    # Execute test based on spec
    ...
```

### Rust
```rust
// packages/rust/tests/conformance.rs
use capnweb::*;
use serde_yaml;

#[derive(Deserialize)]
struct TestCase {
    name: String,
    call: String,
    args: Vec<serde_json::Value>,
    expect: serde_json::Value,
}

#[tokio::test]
async fn run_conformance_tests() {
    let server_url = std::env::var("TEST_SERVER_URL").unwrap();
    let api = connect(&server_url).await.unwrap();

    for entry in std::fs::read_dir("../../test/conformance").unwrap() {
        let spec: TestSpec = serde_yaml::from_reader(
            std::fs::File::open(entry.path()).unwrap()
        ).unwrap();

        for test in spec.tests {
            run_test(&api, &test).await;
        }
    }
}
```

### Go
```go
// packages/go/conformance_test.go
package capnweb_test

import (
    "testing"
    "gopkg.in/yaml.v3"
)

func TestConformance(t *testing.T) {
    serverURL := os.Getenv("TEST_SERVER_URL")
    api, _ := capnweb.Connect(context.Background(), serverURL)

    specs, _ := filepath.Glob("../../test/conformance/*.yaml")
    for _, specFile := range specs {
        data, _ := os.ReadFile(specFile)
        var spec TestSpec
        yaml.Unmarshal(data, &spec)

        for _, tc := range spec.Tests {
            t.Run(tc.Name, func(t *testing.T) {
                runTestCase(t, api, tc)
            })
        }
    }
}
```

## Metrics & Reporting

### Test Badge
Each language gets a badge showing conformance level:

| Level | Badge | Requirement |
|-------|-------|-------------|
| ✅ Full | ![100%](https://img.shields.io/badge/conformance-100%25-brightgreen) | All Level 1+2 tests pass |
| 🟡 Basic | ![80%](https://img.shields.io/badge/conformance-80%25-yellow) | All Level 1 tests pass |
| 🔴 WIP | ![50%](https://img.shields.io/badge/conformance-50%25-red) | Some Level 1 tests fail |

### Dashboard
Generated at `test/results/dashboard.html`:
- Per-language pass rates
- Failing test details
- Performance metrics (latency, throughput)
- Historical trends

## Implementation Roadmap

1. **Phase 1: Test Infrastructure**
   - [ ] Create `test/conformance/` YAML specs
   - [ ] Create `scripts/test-all.ts` orchestrator
   - [ ] Set up CI workflow

2. **Phase 2: Reference Implementation**
   - [ ] Implement Python test harness (as reference)
   - [ ] Document test harness pattern
   - [ ] Validate against test server

3. **Phase 3: Language Rollout**
   - [ ] TypeScript/Deno (shares test server)
   - [ ] Rust, Go (systems languages)
   - [ ] Java, Kotlin, Scala (JVM)
   - [ ] C#, F# (.NET)
   - [ ] Ruby, PHP, Elixir (dynamic)
   - [ ] Swift, Dart (mobile)
   - [ ] Clojure, Crystal, Nim (niche)

4. **Phase 4: Advanced Tests**
   - [ ] Add Level 2 (callbacks, streaming)
   - [ ] Add Level 3 (stress tests)
   - [ ] Performance benchmarking

## FAQ

**Q: Why YAML for test specs instead of language-specific tests?**
A: YAML allows defining tests once and running them in all 17 languages. This ensures consistent behavior across implementations.

**Q: Can I add language-specific tests?**
A: Yes! Each package can have additional tests beyond conformance. Put them in `packages/<lang>/tests/` alongside the conformance tests.

**Q: How do I debug a failing test?**
A: Run the test in isolation with verbose logging:
```bash
TEST_SERVER_URL=http://localhost:8787 npm run test:lang python -- -v -k "test_name"
```

**Q: How do I add a new test case?**
A: Add it to the appropriate YAML file in `test/conformance/`. All languages will automatically pick it up.
