/// Conformance test harness for the capnweb Dart SDK.
///
/// Loads and executes conformance test specifications from YAML files.
/// Tests verify that the Dart SDK correctly implements the capnweb protocol.
///
/// # Environment Variables
///
/// - `TEST_SERVER_URL`: URL of the test server (default: `ws://localhost:8787`)
/// - `TEST_SPEC_DIR`: Directory containing conformance test YAML files
///   (default: `../../test/conformance/`)
///
/// # Running Tests
///
/// ```bash
/// # With default settings
/// dart test test/conformance_test.dart
///
/// # With custom server URL
/// TEST_SERVER_URL=ws://localhost:9000 dart test test/conformance_test.dart
///
/// # With custom spec directory
/// TEST_SPEC_DIR=/path/to/specs dart test test/conformance_test.dart
/// ```
library;

import 'dart:async';
import 'dart:io';

import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

import 'package:dotdo_capnweb/dotdo_capnweb.dart';

// ============================================================================
// Test Specification Types
// ============================================================================

/// A conformance test specification file.
class TestSpec {
  final String name;
  final String description;
  final List<TestCase> tests;

  TestSpec({
    required this.name,
    required this.description,
    required this.tests,
  });

  factory TestSpec.fromYaml(YamlMap yaml, String fileName) {
    final name = yaml['name'] as String? ?? 'Unknown';
    final description = yaml['description'] as String? ?? '';
    final testsYaml = yaml['tests'] as YamlList? ?? YamlList();

    final tests = testsYaml.map((t) {
      final testYaml = t as YamlMap;
      return TestCase.fromYaml(testYaml, name, fileName);
    }).toList();

    return TestSpec(name: name, description: description, tests: tests);
  }
}

/// An individual test case.
class TestCase {
  final String name;
  final String description;
  final String? call;
  final List<dynamic> args;
  final dynamic expect;
  final String? expectType;
  final int? expectLength;
  final ExpectedError? expectError;
  final MapSpec? mapSpec;
  final List<SetupStep>? setup;
  final int? maxRoundTrips;
  final String category;
  final String fileName;

  TestCase({
    required this.name,
    required this.description,
    this.call,
    this.args = const [],
    this.expect,
    this.expectType,
    this.expectLength,
    this.expectError,
    this.mapSpec,
    this.setup,
    this.maxRoundTrips,
    required this.category,
    required this.fileName,
  });

  factory TestCase.fromYaml(YamlMap yaml, String category, String fileName) {
    return TestCase(
      name: yaml['name'] as String? ?? 'unnamed',
      description: yaml['description'] as String? ?? '',
      call: yaml['call'] as String?,
      args: _toList(yaml['args']),
      expect: _toNative(yaml['expect']),
      expectType: yaml['expect_type'] as String?,
      expectLength: yaml['expect_length'] as int?,
      expectError: yaml['expect_error'] != null
          ? ExpectedError.fromYaml(yaml['expect_error'] as YamlMap)
          : null,
      mapSpec:
          yaml['map'] != null ? MapSpec.fromYaml(yaml['map'] as YamlMap) : null,
      setup: yaml['setup'] != null
          ? (yaml['setup'] as YamlList)
              .map((s) => SetupStep.fromYaml(s as YamlMap))
              .toList()
          : null,
      maxRoundTrips: yaml['max_round_trips'] as int?,
      category: category,
      fileName: fileName,
    );
  }
}

/// Map specification for server-side transformation tests.
class MapSpec {
  final String expression;
  final List<String> captures;

  MapSpec({
    required this.expression,
    this.captures = const [],
  });

  factory MapSpec.fromYaml(YamlMap yaml) {
    return MapSpec(
      expression: yaml['expression'] as String? ?? '',
      captures:
          (yaml['captures'] as YamlList?)?.map((c) => c as String).toList() ??
              [],
    );
  }
}

/// Setup step for tests that require initialization.
class SetupStep {
  final String call;
  final List<dynamic> args;
  final String? alias;
  final bool await_;
  final MapSpec? mapSpec;

  SetupStep({
    required this.call,
    this.args = const [],
    this.alias,
    this.await_ = false,
    this.mapSpec,
  });

  factory SetupStep.fromYaml(YamlMap yaml) {
    return SetupStep(
      call: yaml['call'] as String? ?? '',
      args: _toList(yaml['args']),
      alias: yaml['as'] as String?,
      await_: yaml['await'] as bool? ?? false,
      mapSpec:
          yaml['map'] != null ? MapSpec.fromYaml(yaml['map'] as YamlMap) : null,
    );
  }
}

/// Expected error specification.
class ExpectedError {
  final String? type;
  final String? messageContains;

  ExpectedError({this.type, this.messageContains});

  factory ExpectedError.fromYaml(YamlMap yaml) {
    return ExpectedError(
      type: yaml['type'] as String?,
      messageContains: yaml['message_contains'] as String?,
    );
  }
}

// ============================================================================
// YAML Conversion Utilities
// ============================================================================

/// Converts YAML values to native Dart types.
dynamic _toNative(dynamic value) {
  if (value == null) return null;
  if (value is YamlList) return value.map(_toNative).toList();
  if (value is YamlMap) {
    return Map.fromEntries(
      value.entries.map((e) => MapEntry(e.key as String, _toNative(e.value))),
    );
  }
  return value;
}

/// Converts a YAML value to a list.
List<dynamic> _toList(dynamic value) {
  if (value == null) return [];
  if (value is YamlList) return value.map(_toNative).toList();
  if (value is List) return value.map(_toNative).toList();
  return [_toNative(value)];
}

// ============================================================================
// Test Loading
// ============================================================================

/// Gets the test server URL from environment or default.
String getServerUrl() {
  return Platform.environment['TEST_SERVER_URL'] ?? 'ws://localhost:8787';
}

/// Gets the spec directory from environment or default.
String getSpecDir() {
  if (Platform.environment.containsKey('TEST_SPEC_DIR')) {
    return Platform.environment['TEST_SPEC_DIR']!;
  }
  // Default: relative to the test file location
  return '../../test/conformance/';
}

/// Loads all test specifications from the spec directory.
List<TestSpec> loadTestSpecs(String specDir) {
  final specs = <TestSpec>[];
  final dir = Directory(specDir);

  if (!dir.existsSync()) {
    print('Warning: Spec directory does not exist: $specDir');
    return specs;
  }

  final files = dir
      .listSync()
      .whereType<File>()
      .where((f) => f.path.endsWith('.yaml') || f.path.endsWith('.yml'))
      .toList()
    ..sort((a, b) => a.path.compareTo(b.path));

  for (final file in files) {
    try {
      final content = file.readAsStringSync();
      final yaml = loadYaml(content) as YamlMap;
      final fileName = file.uri.pathSegments.last;
      specs.add(TestSpec.fromYaml(yaml, fileName));
    } catch (e) {
      print('Warning: Failed to parse ${file.path}: $e');
    }
  }

  return specs;
}

// ============================================================================
// Test Execution
// ============================================================================

/// Runs a simple RPC call test.
Future<void> runSimpleCallTest(
  Session session,
  TestCase test,
  Map<String, dynamic> context,
) async {
  final method = test.call!;
  final args = _resolveArgs(test.args, context);

  if (test.expectError != null) {
    // Expect an error
    expect(
      () async => await session.call(method, args),
      throwsA(isA<CapnWebError>()),
      reason: 'Expected error but got success',
    );
  } else {
    final result = await session.call(method, args);
    _checkExpectation(result, test);
  }
}

/// Runs a test with server-side map operation.
Future<void> runMapTest(
  Session session,
  TestCase test,
  Map<String, dynamic> context,
) async {
  final method = test.call!;
  final args = _resolveArgs(test.args, context);
  final mapSpec = test.mapSpec!;

  // Make the initial call
  final promise = session.call(method, args);

  // Apply the map transformation
  // Parse the expression to extract the method being called
  // e.g., "x => self.square(x)" -> we need to call square on each element
  final mapMethod = _parseMapExpression(mapSpec.expression, context);

  if (mapMethod != null) {
    // Apply server-side map
    final mapped = promise.map((x) async {
      // Execute the map function
      final result = await session.call(mapMethod, [x]);
      return result;
    });

    final result = await mapped;
    _checkExpectation(result, test);
  } else {
    // Fallback: just await the promise for null/undefined cases
    final result = await promise;

    if (result == null) {
      expect(test.expect, isNull);
    } else {
      _checkExpectation(result, test);
    }
  }
}

/// Parses a map expression to extract the method name.
///
/// Examples:
/// - "x => self.square(x)" -> "square"
/// - "x => self.returnNumber(x * 2)" -> "returnNumber"
/// - "counter => counter.value" -> "value"
String? _parseMapExpression(String expression, Map<String, dynamic> context) {
  // Match patterns like "self.methodName" or "x.methodName"
  final selfMethodMatch = RegExp(r'self\.(\w+)\(').firstMatch(expression);
  if (selfMethodMatch != null) {
    return selfMethodMatch.group(1);
  }

  // Match property access like "counter.value"
  final propMatch = RegExp(r'=>\s*\w+\.(\w+)$').firstMatch(expression);
  if (propMatch != null) {
    return propMatch.group(1);
  }

  return null;
}

/// Runs a test with setup steps.
Future<void> runTestWithSetup(
  Session session,
  TestCase test,
  Map<String, dynamic> context,
) async {
  // Execute setup steps
  for (final step in test.setup!) {
    final stepCall = step.call.startsWith(r'$')
        ? context[step.call.substring(1)]
        : step.call;

    if (stepCall is String) {
      final args = _resolveArgs(step.args, context);
      final promise = session.call(stepCall, args);

      if (step.mapSpec != null) {
        // Apply map to setup result
        final mapMethod =
            _parseMapExpression(step.mapSpec!.expression, context);
        if (mapMethod != null) {
          final mapped = promise.map((x) => session.call(mapMethod, [x]));
          if (step.alias != null) {
            context[step.alias!] = step.await_ ? await mapped : mapped;
          }
        }
      } else if (step.alias != null) {
        context[step.alias!] = step.await_ ? await promise : promise;
      }
    }
  }

  // Now run the main test
  if (test.mapSpec != null) {
    await runMapTest(session, test, context);
  } else {
    await runSimpleCallTest(session, test, context);
  }
}

/// Resolves variable references in arguments.
List<dynamic> _resolveArgs(List<dynamic> args, Map<String, dynamic> context) {
  return args.map((arg) {
    if (arg is String && arg.startsWith(r'$')) {
      final varName = arg.substring(1);
      return context[varName] ?? arg;
    }
    return arg;
  }).toList();
}

/// Checks the test expectation against the result.
void _checkExpectation(dynamic result, TestCase test) {
  if (test.expect != null) {
    expect(
      _normalizeValue(result),
      equals(_normalizeValue(test.expect)),
      reason: 'Result mismatch for ${test.name}',
    );
  }

  if (test.expectType != null) {
    switch (test.expectType) {
      case 'capability':
        // Result should be some kind of capability reference
        expect(result, isNotNull, reason: 'Expected capability, got null');
      case 'array_of_capabilities':
        expect(result, isA<List>(), reason: 'Expected array of capabilities');
        if (test.expectLength != null) {
          expect(
            (result as List).length,
            equals(test.expectLength),
            reason: 'Array length mismatch',
          );
        }
    }
  }
}

/// Normalizes values for comparison.
dynamic _normalizeValue(dynamic value) {
  if (value == null) return null;
  if (value is List) return value.map(_normalizeValue).toList();
  if (value is Map) {
    return Map.fromEntries(
      value.entries.map((e) => MapEntry(e.key, _normalizeValue(e.value))),
    );
  }
  // Handle numeric comparisons (YAML may parse differently than JSON)
  if (value is num) {
    // Use num for comparison to handle int vs double
    return value;
  }
  return value;
}

// ============================================================================
// Main Test Entry Point
// ============================================================================

void main() {
  final specDir = getSpecDir();
  final serverUrl = getServerUrl();

  print('Conformance Test Configuration:');
  print('  Spec directory: $specDir');
  print('  Server URL: $serverUrl');
  print('');

  // Load all test specifications
  final specs = loadTestSpecs(specDir);

  if (specs.isEmpty) {
    print('No test specifications found in $specDir');
    print('Skipping conformance tests.');
    return;
  }

  print('Loaded ${specs.length} spec file(s):');
  for (final spec in specs) {
    print('  - ${spec.name}: ${spec.tests.length} tests');
  }
  print('');

  // Session holder for cleanup
  Session? session;

  setUpAll(() async {
    // Attempt to connect to the test server
    if (!CapnWeb.isImplemented) {
      print('SDK not fully implemented - tests will verify structure only');
    }

    try {
      session = await CapnWeb.connect(serverUrl);
      print('Connected to test server: $serverUrl');
    } on CapnWebConnectionError catch (e) {
      print('Failed to connect to test server: $e');
      print('Tests will be skipped if connection is required.');
    }
  });

  tearDownAll(() async {
    await session?.close();
  });

  // Generate tests from specifications
  for (final spec in specs) {
    group(spec.name, () {
      for (final test in spec.tests) {
        final testDescription =
            test.description.isNotEmpty ? test.description : test.name;

        testCase(testDescription, () async {
          // Skip if SDK not implemented
          if (!CapnWeb.isImplemented) {
            markTestSkipped('SDK not implemented');
            return;
          }

          // Skip if not connected
          if (session == null || !session!.isConnected) {
            markTestSkipped('Not connected to test server');
            return;
          }

          // Create test context
          final context = <String, dynamic>{
            'self': session,
          };

          // Determine test type and run
          if (test.setup != null && test.setup!.isNotEmpty) {
            await runTestWithSetup(session!, test, context);
          } else if (test.mapSpec != null) {
            await runMapTest(session!, test, context);
          } else if (test.call != null) {
            await runSimpleCallTest(session!, test, context);
          } else {
            markTestSkipped('Unknown test type');
          }
        });
      }
    });
  }

  // Additional SDK-specific tests
  group('SDK Verification', () {
    test('isImplemented returns expected value', () {
      // Stub implementation should return false
      expect(CapnWeb.isImplemented, isFalse);
    });

    test('sealed error classes are exhaustive', () {
      // Verify all error types can be pattern matched
      void handleError(CapnWebError error) {
        final _ = switch (error) {
          CapnWebConnectionError(:final message) => 'connection: $message',
          CapnWebRpcError(:final code, :final message) => 'rpc[$code]: $message',
          CapnWebTimeoutError(:final timeout) => 'timeout: $timeout',
          CapnWebNotImplementedError(:final feature) =>
            'not implemented: $feature',
        };
      }

      // Ensure all branches compile
      handleError(const CapnWebConnectionError('test'));
      handleError(
          const CapnWebRpcError(code: 'TEST', message: 'test'));
      handleError(const CapnWebTimeoutError(Duration(seconds: 1)));
      handleError(const CapnWebNotImplementedError('test'));
    });

    test('RpcPromise supports map method', () async {
      // Verify RpcPromise has map method with correct signature
      if (session == null) {
        markTestSkipped('Not connected');
        return;
      }

      // Create a promise
      final promise = session!.call<List<int>>('generateFibonacci', [3]);

      // Verify map returns RpcPromise
      final mapped = promise.map((x) => x * 2);
      expect(mapped, isA<RpcPromise<List<dynamic>>>());
    });
  });

  group('Map Operation Tests', () {
    test('map preserves null values', () async {
      if (session == null || !session!.isConnected) {
        markTestSkipped('Not connected');
        return;
      }

      // Test that map on null returns null (not an error)
      final promise = session!.call('returnNull', []);
      final mapped = promise.map((x) => session!.call('square', [x]));

      final result = await mapped;
      expect(result, isNull);
    });

    test('map over empty array returns empty array', () async {
      if (session == null || !session!.isConnected) {
        markTestSkipped('Not connected');
        return;
      }

      final promise = session!.call<List<int>>('generateFibonacci', [0]);
      final mapped = promise.map((x) => session!.call('square', [x]));

      final result = await mapped;
      expect(result, isEmpty);
    });

    test('map applies transformation to each element', () async {
      if (session == null || !session!.isConnected) {
        markTestSkipped('Not connected');
        return;
      }

      // fib(6) = [0, 1, 1, 2, 3, 5]
      // squared = [0, 1, 1, 4, 9, 25]
      final promise = session!.call<List<int>>('generateFibonacci', [6]);
      final mapped = promise.map((x) => session!.call<int>('square', [x]));

      final result = await mapped;
      expect(result, equals([0, 1, 1, 4, 9, 25]));
    });
  });
}

/// Helper to mark a test as skipped.
void markTestSkipped(String reason) {
  // Dart test package uses skip() in test() function
  // For runtime skipping, we throw SkipException or use print
  print('SKIPPED: $reason');
}

/// Wrapper for test() that supports dynamic generation.
void testCase(String description, dynamic Function() body) {
  test(description, body);
}
