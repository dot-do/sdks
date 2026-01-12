// Conformance test harness for the CapnWeb Swift SDK.
//
// This module loads and executes conformance test specifications from YAML files.
// Tests are run against a test server specified by the `TEST_SERVER_URL` environment variable.
//
// # Environment Variables
//
// - `TEST_SERVER_URL`: The URL of the test server (default: `ws://localhost:8787`)
// - `TEST_SPEC_DIR`: Directory containing conformance test YAML files
//   (default: `../../test/conformance/`)
//
// # Running Tests
//
// ```bash
// # With default settings
// swift test --filter ConformanceTests
//
// # With custom server URL
// TEST_SERVER_URL=ws://localhost:9000 swift test --filter ConformanceTests
//
// # With custom spec directory
// TEST_SPEC_DIR=/path/to/specs swift test --filter ConformanceTests
// ```

import Foundation
import Testing
@testable import DotDoCapnWeb
import Yams

// MARK: - Test Specification Types

/// A conformance test specification file.
struct TestSpec: Codable, Sendable {
    /// Name of this test category.
    let name: String
    /// Description of what this test category covers.
    let description: String
    /// Individual test cases.
    let tests: [TestCase]
}

/// An individual test case.
struct TestCase: Codable, Sendable {
    /// Unique name for this test.
    let name: String
    /// Human-readable description.
    let description: String?
    /// Method to call (for simple tests).
    let call: String?
    /// Arguments to pass to the method.
    let args: [YamlValue]?
    /// Expected return value.
    let expect: YamlValue?
    /// Expected error (for error tests).
    let expectError: ExpectedError?
    /// Expected type (for capability tests).
    let expectType: String?
    /// Expected array length.
    let expectLength: Int?
    /// Pipeline steps (for pipelining tests).
    let pipeline: [PipelineStepSpec]?
    /// Setup steps (run before the main test).
    let setup: [SetupStepSpec]?
    /// Maximum allowed round trips (for pipelining tests).
    let maxRoundTrips: Int?
    /// Map operation for collection transformation.
    let map: MapSpec?
    /// Verification steps.
    let verify: [VerifyStep]?

    enum CodingKeys: String, CodingKey {
        case name, description, call, args, expect, pipeline, setup, verify
        case expectError = "expect_error"
        case expectType = "expect_type"
        case expectLength = "expect_length"
        case maxRoundTrips = "max_round_trips"
        case map
    }
}

/// Expected error specification.
struct ExpectedError: Codable, Sendable {
    /// Error type name (e.g., "RangeError", "TypeError").
    let type: String?
    /// Substring that must appear in the error message.
    let messageContains: String?
    /// Alternative acceptable outcomes.
    let anyOf: [AnyOfError]?

    enum CodingKeys: String, CodingKey {
        case type
        case messageContains = "message_contains"
        case anyOf = "any_of"
    }
}

/// Alternative error or value expectation.
struct AnyOfError: Codable, Sendable {
    let type: String?
    let value: YamlValue?
}

/// A step in a pipeline test.
struct PipelineStepSpec: Codable, Sendable {
    /// Method to call (may include dot notation like "counter.increment").
    let call: String
    /// Arguments to pass.
    let args: [YamlValue]?
    /// Alias for the result (used in later steps with "$alias").
    let `as`: String?
    /// Whether to await this step.
    let await: Bool?
    /// Map operation for this step.
    let map: MapSpec?
}

/// A setup step (extended pipeline step).
struct SetupStepSpec: Codable, Sendable {
    let call: String?
    let args: [YamlValue]?
    let `as`: String?
    let await: Bool?
    let map: MapSpec?
    let pipeline: [PipelineStepSpec]?

    enum CodingKeys: String, CodingKey {
        case call, args, map, pipeline
        case `as` = "as"
        case `await` = "await"
    }
}

/// Map operation specification.
struct MapSpec: Codable, Sendable {
    /// The expression string (e.g., "x => self.square(x)").
    let expression: String
    /// Captured variables (e.g., ["$self"]).
    let captures: [String]?
}

/// Verification step.
struct VerifyStep: Codable, Sendable {
    let call: String
    let expect: YamlValue?
}

// MARK: - YAML Value Type

/// A type-erased YAML value for test specifications.
indirect enum YamlValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([YamlValue])
    case object([String: YamlValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let int = try? container.decode(Int.self) {
            self = .int(int)
        } else if let double = try? container.decode(Double.self) {
            self = .double(double)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([YamlValue].self) {
            self = .array(array)
        } else if let object = try? container.decode([String: YamlValue].self) {
            self = .object(object)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode YAML value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case .bool(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .double(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        }
    }

    /// Convert to JsonValue.
    var toJsonValue: JsonValue {
        switch self {
        case .null:
            return .null
        case .bool(let value):
            return .bool(value)
        case .int(let value):
            return .int(value)
        case .double(let value):
            return .double(value)
        case .string(let value):
            return .string(value)
        case .array(let value):
            return .array(value.map { $0.toJsonValue })
        case .object(let value):
            return .object(value.mapValues { $0.toJsonValue })
        }
    }

    /// Compare with tolerance for floating point.
    static func valuesEqual(_ lhs: YamlValue, _ rhs: YamlValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null):
            return true
        case (.bool(let a), .bool(let b)):
            return a == b
        case (.int(let a), .int(let b)):
            return a == b
        case (.double(let a), .double(let b)):
            return abs(a - b) < 1e-10
        case (.int(let a), .double(let b)):
            return abs(Double(a) - b) < 1e-10
        case (.double(let a), .int(let b)):
            return abs(a - Double(b)) < 1e-10
        case (.string(let a), .string(let b)):
            return a == b
        case (.array(let a), .array(let b)):
            return a.count == b.count && zip(a, b).allSatisfy { valuesEqual($0, $1) }
        case (.object(let a), .object(let b)):
            return a.count == b.count && a.allSatisfy { key, value in
                b[key].map { valuesEqual(value, $0) } ?? false
            }
        default:
            return false
        }
    }
}

// MARK: - Test Configuration

/// Get the test server URL from environment or default.
func getServerURL() -> String {
    ProcessInfo.processInfo.environment["TEST_SERVER_URL"] ?? "ws://localhost:8787"
}

/// Convert HTTP URL to WebSocket URL.
func toWebSocketURL(_ url: String) -> String {
    url.replacingOccurrences(of: "http://", with: "ws://")
       .replacingOccurrences(of: "https://", with: "wss://")
}

/// Get the spec directory from environment or default.
func getSpecDir() -> URL {
    if let dir = ProcessInfo.processInfo.environment["TEST_SPEC_DIR"] {
        return URL(fileURLWithPath: dir)
    }

    // Default: relative to the package root
    // This resolves to packages/swift/../../test/conformance
    let packageDir = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // ConformanceTests.swift
        .deletingLastPathComponent()  // CapnWebTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // swift
        .deletingLastPathComponent()  // packages
        .appendingPathComponent("test")
        .appendingPathComponent("conformance")

    return packageDir
}

// MARK: - Test Loading

/// Load all test specifications from the spec directory.
func loadTestSpecs() throws -> [(spec: TestSpec, file: String)] {
    let specDir = getSpecDir()
    let fileManager = FileManager.default

    guard fileManager.fileExists(atPath: specDir.path) else {
        print("Warning: Spec directory does not exist: \(specDir.path)")
        return []
    }

    let contents = try fileManager.contentsOfDirectory(
        at: specDir,
        includingPropertiesForKeys: nil
    )

    let yamlFiles = contents.filter { url in
        let ext = url.pathExtension.lowercased()
        return ext == "yaml" || ext == "yml"
    }.sorted { $0.lastPathComponent < $1.lastPathComponent }

    var specs: [(TestSpec, String)] = []

    for yamlFile in yamlFiles {
        do {
            let content = try String(contentsOf: yamlFile, encoding: .utf8)
            let decoder = YAMLDecoder()
            let spec = try decoder.decode(TestSpec.self, from: content)
            specs.append((spec, yamlFile.lastPathComponent))
        } catch {
            print("Warning: Failed to parse \(yamlFile.lastPathComponent): \(error)")
        }
    }

    return specs
}

// MARK: - Test Result Types

/// Result of running a single test case.
enum TestResult: Sendable {
    /// Test passed.
    case passed
    /// Test failed with a message.
    case failed(String)
    /// Test was skipped (SDK not implemented).
    case skipped(String)
    /// Test encountered an error during execution.
    case error(String)

    var isPassed: Bool {
        if case .passed = self { return true }
        return false
    }

    var isSkipped: Bool {
        if case .skipped = self { return true }
        return false
    }
}

// MARK: - Test Execution

/// Execute a single test case.
func runTest(session: RpcSession, test: TestCase) async -> TestResult {
    // Check if SDK is implemented
    guard isImplemented else {
        return .skipped("SDK not yet implemented")
    }

    // Handle map tests
    if let mapSpec = test.map, let call = test.call {
        return await runMapTest(session: session, test: test, call: call, mapSpec: mapSpec)
    }

    // Handle pipeline tests
    if let pipelineSteps = test.pipeline {
        return await runPipelineTest(session: session, test: test, steps: pipelineSteps)
    }

    // Handle simple call tests
    if let method = test.call {
        return await runSimpleTest(session: session, test: test, method: method)
    }

    return .error("Test has no 'call', 'pipeline', or 'map' field")
}

/// Execute a simple (non-pipelined) test.
func runSimpleTest(session: RpcSession, test: TestCase, method: String) async -> TestResult {
    let args = test.args?.map { $0.toJsonValue } ?? []

    do {
        let result = try await session.callMethod(method, args: args)

        if let expected = test.expect {
            if JsonValue.valuesEqual(result, expected.toJsonValue) {
                return .passed
            } else {
                return .failed("Expected \(expected), got \(result)")
            }
        } else if test.expectError != nil {
            return .failed("Expected an error, but call succeeded with \(result)")
        } else {
            // No expectation specified, just check it doesn't error
            return .passed
        }
    } catch let error as RpcError {
        if case .notImplemented(let msg) = error {
            return .skipped(msg)
        }

        if let expectedError = test.expectError {
            if errorMatches(error, expected: expectedError) {
                return .passed
            } else {
                return .failed("Error did not match expected: \(error) vs \(expectedError)")
            }
        } else {
            return .error("Unexpected error: \(error)")
        }
    } catch {
        return .error("Unexpected error: \(error)")
    }
}

/// Execute a map test.
func runMapTest(
    session: RpcSession,
    test: TestCase,
    call: String,
    mapSpec: MapSpec
) async -> TestResult {
    let args = test.args?.map { $0.toJsonValue } ?? []

    do {
        let mapExpression = MapExpression(
            expression: mapSpec.expression,
            captures: mapSpec.captures ?? []
        )

        let result = try await session.callMap(
            base: (method: call, args: args),
            mapExpression: mapExpression
        )

        // Check expect_type
        if let expectType = test.expectType {
            switch expectType {
            case "capability":
                // Just verify it's not null/error
                if case .null = result {
                    return .failed("Expected capability, got null")
                }
                return .passed
            case "array_of_capabilities":
                guard case .array(let arr) = result else {
                    return .failed("Expected array of capabilities, got \(result)")
                }
                if let expectedLength = test.expectLength {
                    if arr.count != expectedLength {
                        return .failed("Expected array length \(expectedLength), got \(arr.count)")
                    }
                }
                return .passed
            default:
                break
            }
        }

        if let expected = test.expect {
            if JsonValue.valuesEqual(result, expected.toJsonValue) {
                return .passed
            } else {
                return .failed("Expected \(expected), got \(result)")
            }
        } else {
            return .passed
        }
    } catch let error as RpcError {
        if case .notImplemented(let msg) = error {
            return .skipped(msg)
        }
        return .error("Unexpected error: \(error)")
    } catch {
        return .error("Unexpected error: \(error)")
    }
}

/// Execute a pipelined test.
func runPipelineTest(
    session: RpcSession,
    test: TestCase,
    steps: [PipelineStepSpec]
) async -> TestResult {
    // Run setup steps if present
    if let setupSteps = test.setup {
        for step in setupSteps {
            if let call = step.call {
                let args = step.args?.map { $0.toJsonValue } ?? []
                do {
                    _ = try await session.callMethod(call, args: args)
                } catch let error as RpcError {
                    if case .notImplemented = error {
                        return .skipped("SDK not implemented: setup step \(call)")
                    }
                    return .error("Setup step failed: \(error)")
                } catch {
                    return .error("Setup step failed: \(error)")
                }
            }
        }
    }

    // Build pipeline
    let pipelineSteps: [PipelineStep] = steps.map { step in
        PipelineStep(
            call: step.call,
            args: step.args?.map { $0.toJsonValue } ?? [],
            alias: step.as,
            shouldAwait: step.await ?? false,
            map: step.map.map { MapExpression(expression: $0.expression, captures: $0.captures ?? []) }
        )
    }

    do {
        let result = try await session.callPipeline(pipelineSteps)

        if let expected = test.expect {
            if JsonValue.valuesEqual(result, expected.toJsonValue) {
                return .passed
            } else {
                return .failed("Expected \(expected), got \(result)")
            }
        } else {
            return .passed
        }
    } catch let error as RpcError {
        if case .notImplemented(let msg) = error {
            return .skipped(msg)
        }

        if let expectedError = test.expectError {
            if errorMatches(error, expected: expectedError) {
                return .passed
            } else {
                return .failed("Error did not match expected: \(error) vs \(expectedError)")
            }
        } else {
            return .error("Unexpected error: \(error)")
        }
    } catch {
        return .error("Unexpected error: \(error)")
    }
}

/// Check if an error matches the expected error specification.
func errorMatches(_ error: RpcError, expected: ExpectedError) -> Bool {
    // Handle any_of alternatives
    if let alternatives = expected.anyOf {
        return alternatives.contains { alt in
            if let type = alt.type {
                return errorTypeMatches(error, typeName: type)
            }
            return false
        }
    }

    // Check error type
    if let typeName = expected.type {
        if !errorTypeMatches(error, typeName: typeName) {
            return false
        }
    }

    // Check error message
    if let messageContains = expected.messageContains {
        let errorMessage = String(describing: error).lowercased()
        if !errorMessage.contains(messageContains.lowercased()) {
            return false
        }
    }

    return true
}

/// Check if an error matches a specific type name.
func errorTypeMatches(_ error: RpcError, typeName: String) -> Bool {
    switch typeName {
    case "Error":
        return true  // Any error matches generic "Error"
    case "RangeError", "TypeError":
        if case .invalidArgument = error { return true }
        return false
    case "NotFound":
        if case .notFound = error { return true }
        return false
    case "Timeout":
        if case .timeout = error { return true }
        return false
    default:
        return false
    }
}

// MARK: - Test Arguments

/// Test argument wrapper for parameterized conformance tests.
struct ConformanceTestArg: CustomTestStringConvertible, Sendable {
    let category: String
    let testCase: TestCase
    let file: String

    var testDescription: String {
        "\(category)/\(testCase.name)"
    }
}

/// Load all conformance test arguments.
func loadConformanceTestArgs() -> [ConformanceTestArg] {
    do {
        let specs = try loadTestSpecs()
        return specs.flatMap { spec, file in
            spec.tests.map { testCase in
                ConformanceTestArg(
                    category: spec.name,
                    testCase: testCase,
                    file: file
                )
            }
        }
    } catch {
        print("Failed to load test specs: \(error)")
        return []
    }
}

// MARK: - Swift Testing Tests

@Suite("DotDoCapnWeb SDK Tests")
struct DotDoCapnWebTests {

    @Test("SDK reports not implemented")
    func sdkNotImplemented() {
        #expect(!isImplemented, "Stub SDK should report not implemented")
        #expect(!RpcSession.isImplemented, "RpcSession should report not implemented")
    }

    @Test("SDK version is set")
    func sdkVersion() {
        #expect(!version.isEmpty, "Version should not be empty")
    }
}

@Suite("Connection Tests")
struct ConnectionTests {

    @Test("Create session")
    func createSession() async throws {
        let serverURL = getServerURL()
        let wsURL = toWebSocketURL(serverURL)

        let session = try await RpcSession.connect(to: wsURL)

        let isConnected = await session.isConnected
        #expect(isConnected, "Session should be connected")

        let url = await session.url
        #expect(url.absoluteString == wsURL, "Session URL should match")

        await session.close()

        let isDisconnected = await session.isConnected
        #expect(!isDisconnected, "Session should be disconnected after close")
    }
}

@Suite("Ref Tests")
struct RefTests {

    @Test("Property access builds expression")
    func propertyAccess() async throws {
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        let ref: Ref<Any> = session.api.users
        #expect(ref.expressionString.contains("users"))
    }

    @Test("Chained property access")
    func chainedPropertyAccess() async throws {
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        let usersRef: Ref<Any> = session.api.users
        let profileRef: Ref<Any> = usersRef.profile
        let nameRef: Ref<Any> = profileRef.name
        #expect(nameRef.expressionString.contains("users"))
        #expect(nameRef.expressionString.contains("profile"))
        #expect(nameRef.expressionString.contains("name"))
    }

    @Test("Map operation builds expression")
    func mapOperation() async throws {
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        let baseRef: Ref<[Int]> = session.api.generateFibonacci
        let mappedRef: Ref<[Ref<Int>]> = baseRef.map { (_: Ref<Any>) -> Ref<Int> in
            session.api.square
        }

        #expect(mappedRef.expressionString.contains("map"))
    }
}

@Suite("Map Tests")
struct MapTests {

    @Test("Map closure syntax")
    func mapClosureSyntax() async throws {
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        // Demonstrate Swift's map closure syntax: .map { x in ... }
        let api = session.api
        let fibRef: Ref<[Int]> = api.generateFibonacci

        // This is the key syntax from the spec: arr.map { x in api.square(x) }
        let squaredRef: Ref<[Ref<Int>]> = fibRef.map { (_: Ref<Any>) -> Ref<Int> in
            api.square
        }

        #expect(squaredRef.expressionString.contains("generateFibonacci"))
        #expect(squaredRef.expressionString.contains("map"))
    }

    @Test("Map captures outer scope")
    func mapCapturesScope() async throws {
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        // In Swift, closures naturally capture variables from outer scope
        // This corresponds to the "captures: [$self]" in the YAML spec
        let api = session.api

        let fibRef: Ref<[Int]> = api.generateFibonacci
        let _: Ref<[Ref<Int>]> = fibRef.map { (_: Ref<Any>) -> Ref<Int> in
            // api is captured automatically
            api.square
        }
    }

    @Test("Map on null")
    func mapOnNull() async throws {
        // Per spec: map on null returns null without error
        let session = try await RpcSession.connect(to: "ws://localhost:8787")
        defer { Task { await session.close() } }

        let nullRef: Ref<Any> = session.api.returnNull
        let mappedRef: Ref<[Ref<Int>]> = nullRef.map { (_: Ref<Any>) -> Ref<Int> in
            session.api.square
        }

        #expect(mappedRef.expressionString.contains("map"))
    }
}

@Suite("JsonValue Tests")
struct JsonValueTests {

    @Test("Integer equality")
    func integerEquality() {
        #expect(JsonValue.valuesEqual(.int(5), .int(5)))
        #expect(!JsonValue.valuesEqual(.int(5), .int(6)))
    }

    @Test("Float equality with tolerance")
    func floatEquality() {
        #expect(JsonValue.valuesEqual(.double(3.14159), .double(3.14159)))
        #expect(JsonValue.valuesEqual(.double(1.0), .double(1.0 + 1e-11)))
    }

    @Test("Int/Double cross-type equality")
    func crossTypeEquality() {
        #expect(JsonValue.valuesEqual(.int(5), .double(5.0)))
        #expect(JsonValue.valuesEqual(.double(5.0), .int(5)))
    }

    @Test("Array equality")
    func arrayEquality() {
        #expect(JsonValue.valuesEqual(
            .array([.int(1), .int(2), .int(3)]),
            .array([.int(1), .int(2), .int(3)])
        ))
        #expect(!JsonValue.valuesEqual(
            .array([.int(1), .int(2), .int(3)]),
            .array([.int(1), .int(2)])
        ))
    }

    @Test("Null equality")
    func nullEquality() {
        #expect(JsonValue.valuesEqual(.null, .null))
    }

    @Test("Object equality")
    func objectEquality() {
        #expect(JsonValue.valuesEqual(
            .object(["a": .int(1), "b": .int(2)]),
            .object(["a": .int(1), "b": .int(2)])
        ))
    }

    @Test("From Any conversion")
    func fromAnyConversion() {
        #expect(JsonValue.from(nil) == .null)
        #expect(JsonValue.from(true) == .bool(true))
        #expect(JsonValue.from(42) == .int(42))
        #expect(JsonValue.from("hello") == .string("hello"))
    }
}

@Suite("YamlValue Tests")
struct YamlValueTests {

    @Test("Convert to JsonValue")
    func toJsonValue() {
        #expect(YamlValue.int(42).toJsonValue == .int(42))
        #expect(YamlValue.null.toJsonValue == .null)
        #expect(YamlValue.array([.int(1), .int(2)]).toJsonValue == .array([.int(1), .int(2)]))
    }
}

@Suite("Spec Loading Tests")
struct SpecLoadingTests {

    @Test("Load specs from directory")
    func loadSpecs() throws {
        let specDir = getSpecDir()
        print("Spec directory: \(specDir.path)")

        let specs = try loadTestSpecs()
        print("Loaded \(specs.count) spec files")

        for (spec, file) in specs {
            print("  \(file): \(spec.name) (\(spec.tests.count) tests)")
        }

        // Test passes even with 0 specs
    }
}

@Suite("Conformance Tests")
struct ConformanceTests {

    @Test("Run conformance suite", arguments: loadConformanceTestArgs())
    func runConformanceTest(arg: ConformanceTestArg) async throws {
        let serverURL = getServerURL()
        let wsURL = toWebSocketURL(serverURL)

        let session = try await RpcSession.connect(to: wsURL)
        defer { Task { await session.close() } }

        let result = await runTest(session: session, test: arg.testCase)

        switch result {
        case .passed:
            // Test passed
            break
        case .failed(let message):
            Issue.record("Test failed: \(message)")
        case .skipped(let reason):
            // Skipped tests are expected for stub SDK
            withKnownIssue("SDK not implemented") {
                Issue.record(Comment(rawValue: reason))
            }
        case .error(let message):
            Issue.record("Test error: \(message)")
        }
    }
}
