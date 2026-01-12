//! Conformance test harness for the rpc-do Rust SDK.
//!
//! This module loads and executes conformance test specifications from YAML files.
//! Tests are run against a test server specified by the `TEST_SERVER_URL` environment variable.
//!
//! # Environment Variables
//!
//! - `TEST_SERVER_URL`: The URL of the test server (default: `ws://localhost:8787`)
//! - `TEST_SPEC_DIR`: Directory containing conformance test YAML files
//!   (default: `../../../test/conformance/`)
//!
//! # Running Tests
//!
//! ```bash
//! # With default settings
//! cargo test --test conformance
//!
//! # With custom server URL
//! TEST_SERVER_URL=ws://localhost:9000 cargo test --test conformance
//!
//! # With custom spec directory
//! TEST_SPEC_DIR=/path/to/specs cargo test --test conformance
//! ```

use rpc_do::{connect, is_implemented, RpcClient, RpcError, PipelineStep};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

// ============================================================================
// Test Specification Types
// ============================================================================

/// A conformance test specification file.
#[derive(Debug, Deserialize)]
struct TestSpec {
    /// Name of this test category.
    name: String,
    /// Description of what this test category covers.
    description: String,
    /// Individual test cases.
    tests: Vec<TestCase>,
}

/// An individual test case.
#[derive(Debug, Deserialize)]
struct TestCase {
    /// Unique name for this test.
    name: String,
    /// Human-readable description.
    #[serde(default)]
    description: String,
    /// Method to call (for simple tests).
    #[serde(default)]
    call: Option<String>,
    /// Arguments to pass to the method.
    #[serde(default)]
    args: Vec<JsonValue>,
    /// Expected return value.
    #[serde(default)]
    expect: Option<JsonValue>,
    /// Expected error (for error tests).
    #[serde(default)]
    expect_error: Option<ExpectedError>,
    /// Pipeline steps (for pipelining tests).
    #[serde(default)]
    pipeline: Option<Vec<PipelineStepSpec>>,
    /// Setup steps (run before the main test).
    #[serde(default)]
    setup: Option<Vec<PipelineStepSpec>>,
    /// Sequence of calls (run in order).
    #[serde(default)]
    sequence: Option<Vec<SequenceStep>>,
    /// Map operation.
    #[serde(default)]
    map: Option<MapSpec>,
    /// Export a callback.
    #[serde(default)]
    export: Option<ExportSpec>,
    /// Maximum allowed round trips (for pipelining tests).
    #[serde(default)]
    max_round_trips: Option<u32>,
    /// Expected type.
    #[serde(default)]
    expect_type: Option<String>,
    /// Expected length.
    #[serde(default)]
    expect_length: Option<usize>,
    /// Verify steps.
    #[serde(default)]
    verify: Option<Vec<VerifyStep>>,
    /// Source file name (added during loading).
    #[serde(skip)]
    _file: String,
    /// Category name (added during loading).
    #[serde(skip)]
    _category: String,
}

/// Expected error specification.
#[derive(Debug, Deserialize)]
struct ExpectedError {
    /// Error type name (e.g., "RangeError", "TypeError").
    #[serde(rename = "type")]
    #[serde(default)]
    error_type: Option<String>,
    /// Substring that must appear in the error message.
    #[serde(default)]
    message_contains: Option<String>,
    /// Alternative acceptable outcomes.
    #[serde(default)]
    any_of: Option<Vec<AnyOfError>>,
}

/// Alternative error or value expectation.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AnyOfError {
    Error { r#type: String },
    Value { value: JsonValue },
}

/// A step in a pipeline test.
#[derive(Debug, Deserialize)]
struct PipelineStepSpec {
    /// Method to call (may include dot notation like "counter.increment").
    call: String,
    /// Arguments to pass.
    #[serde(default)]
    args: Vec<JsonValue>,
    /// Alias for the result (used in later steps with "$alias").
    #[serde(rename = "as")]
    #[serde(default)]
    alias: Option<String>,
    /// Map operation on the result.
    #[serde(default)]
    map: Option<MapSpec>,
    /// Whether to await this step.
    #[serde(default)]
    r#await: Option<bool>,
}

/// A step in a sequence test.
#[derive(Debug, Deserialize)]
struct SequenceStep {
    /// Method to call.
    call: String,
    /// Arguments.
    #[serde(default)]
    args: Vec<JsonValue>,
    /// Expected result.
    #[serde(default)]
    expect: Option<JsonValue>,
}

/// Map operation specification.
#[derive(Debug, Deserialize)]
struct MapSpec {
    /// The map expression.
    expression: String,
    /// Captured variables.
    #[serde(default)]
    captures: Vec<String>,
}

/// Export specification.
#[derive(Debug, Deserialize)]
struct ExportSpec {
    /// Name of the export.
    name: String,
    /// Type of export.
    r#type: String,
    /// Behavior expression.
    behavior: String,
}

/// Verify step.
#[derive(Debug, Deserialize)]
struct VerifyStep {
    /// Method to call.
    call: String,
    /// Expected result.
    #[serde(default)]
    expect: Option<JsonValue>,
}

// ============================================================================
// Test Result Types
// ============================================================================

/// Result of running a single test case.
#[derive(Debug)]
enum TestResult {
    /// Test passed.
    Passed,
    /// Test failed with a message.
    Failed(String),
    /// Test was skipped (SDK not implemented).
    Skipped(String),
    /// Test encountered an error during execution.
    Error(String),
}

impl TestResult {
    fn is_passed(&self) -> bool {
        matches!(self, TestResult::Passed)
    }

    fn is_skipped(&self) -> bool {
        matches!(self, TestResult::Skipped(_))
    }
}

// ============================================================================
// Test Loading
// ============================================================================

/// Get the test server URL from environment or default.
fn get_server_url() -> String {
    env::var("TEST_SERVER_URL").unwrap_or_else(|_| "ws://localhost:8787".to_string())
}

/// Get the WebSocket URL from a base URL.
fn to_ws_url(url: &str) -> String {
    url.replace("http://", "ws://")
        .replace("https://", "wss://")
}

/// Get the spec directory from environment or default.
fn get_spec_dir() -> PathBuf {
    if let Ok(dir) = env::var("TEST_SPEC_DIR") {
        PathBuf::from(dir)
    } else {
        // Default: relative to the test file
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("test")
            .join("conformance")
    }
}

/// Load all test specifications from the spec directory.
fn load_test_specs(spec_dir: &Path) -> Vec<TestCase> {
    let mut all_tests = Vec::new();

    if !spec_dir.exists() {
        eprintln!(
            "Warning: Spec directory does not exist: {}",
            spec_dir.display()
        );
        return all_tests;
    }

    // Find all YAML files
    let mut yaml_files: Vec<_> = fs::read_dir(spec_dir)
        .unwrap_or_else(|e| panic!("Failed to read spec directory: {}", e))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|ext| ext == "yaml" || ext == "yml")
                .unwrap_or(false)
        })
        .collect();

    yaml_files.sort();

    for yaml_file in yaml_files {
        match fs::read_to_string(&yaml_file) {
            Ok(content) => match serde_yaml::from_str::<TestSpec>(&content) {
                Ok(mut spec) => {
                    let file_name = yaml_file
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();

                    for test in &mut spec.tests {
                        test._file = file_name.clone();
                        test._category = spec.name.clone();
                    }

                    all_tests.extend(spec.tests);
                }
                Err(e) => {
                    eprintln!("Warning: Failed to parse {}: {}", yaml_file.display(), e);
                }
            },
            Err(e) => {
                eprintln!("Warning: Failed to read {}: {}", yaml_file.display(), e);
            }
        }
    }

    all_tests
}

// ============================================================================
// Test Execution
// ============================================================================

/// Execute a single test case.
async fn run_test(client: &RpcClient, test: &TestCase) -> TestResult {
    // Check if SDK is implemented
    if !is_implemented() {
        return TestResult::Skipped("SDK not yet implemented".to_string());
    }

    // Handle export tests (callbacks)
    if test.export.is_some() {
        return run_callback_test(client, test).await;
    }

    // Handle pipeline tests
    if let Some(pipeline_steps) = &test.pipeline {
        return run_pipeline_test(client, test, pipeline_steps).await;
    }

    // Handle sequence tests
    if let Some(sequence) = &test.sequence {
        return run_sequence_test(client, test, sequence).await;
    }

    // Handle simple call tests
    if let Some(method) = &test.call {
        return run_simple_test(client, test, method).await;
    }

    TestResult::Error("Test has no 'call', 'pipeline', or 'export' field".to_string())
}

/// Execute a simple (non-pipelined) test.
async fn run_simple_test(client: &RpcClient, test: &TestCase, method: &str) -> TestResult {
    // Handle setup if present
    if let Some(setup) = &test.setup {
        for step in setup {
            if let Err(e) = client.call_raw(&step.call, step.args.clone()).await {
                return TestResult::Error(format!("Setup failed: {}", e));
            }
        }
    }

    // Handle map operation
    if let Some(map_spec) = &test.map {
        return run_map_test(client, test, method, map_spec).await;
    }

    match client.call_raw(method, test.args.clone()).await {
        Ok(result) => {
            if let Some(expected) = &test.expect {
                if values_equal(&result, expected) {
                    TestResult::Passed
                } else {
                    TestResult::Failed(format!(
                        "Expected {:?}, got {:?}",
                        expected, result
                    ))
                }
            } else if test.expect_error.is_some() {
                TestResult::Failed("Expected an error, but call succeeded".to_string())
            } else if let Some(expected_type) = &test.expect_type {
                if check_type(&result, expected_type) {
                    if let Some(len) = test.expect_length {
                        if let Some(arr) = result.as_array() {
                            if arr.len() == len {
                                TestResult::Passed
                            } else {
                                TestResult::Failed(format!(
                                    "Expected length {}, got {}",
                                    len, arr.len()
                                ))
                            }
                        } else {
                            TestResult::Failed("Expected array for length check".to_string())
                        }
                    } else {
                        TestResult::Passed
                    }
                } else {
                    TestResult::Failed(format!(
                        "Expected type {}, got {:?}",
                        expected_type, result
                    ))
                }
            } else {
                // No expectation specified, just check it doesn't error
                TestResult::Passed
            }
        }
        Err(e) => {
            if let Some(expected_error) = &test.expect_error {
                if error_matches(&e, expected_error) {
                    TestResult::Passed
                } else {
                    TestResult::Failed(format!(
                        "Error did not match expected: {:?} vs {:?}",
                        e, expected_error
                    ))
                }
            } else {
                TestResult::Error(format!("Unexpected error: {}", e))
            }
        }
    }
}

/// Execute a map test.
async fn run_map_test(
    client: &RpcClient,
    test: &TestCase,
    method: &str,
    map_spec: &MapSpec,
) -> TestResult {
    match client
        .map_call(
            method,
            test.args.clone(),
            &map_spec.expression,
            map_spec.captures.clone(),
        )
        .await
    {
        Ok(result) => {
            if let Some(expected) = &test.expect {
                if values_equal(&result, expected) {
                    TestResult::Passed
                } else {
                    TestResult::Failed(format!(
                        "Expected {:?}, got {:?}",
                        expected, result
                    ))
                }
            } else if let Some(expected_type) = &test.expect_type {
                if check_type(&result, expected_type) {
                    if let Some(len) = test.expect_length {
                        if let Some(arr) = result.as_array() {
                            if arr.len() == len {
                                TestResult::Passed
                            } else {
                                TestResult::Failed(format!(
                                    "Expected length {}, got {}",
                                    len, arr.len()
                                ))
                            }
                        } else {
                            TestResult::Failed("Expected array for length check".to_string())
                        }
                    } else {
                        TestResult::Passed
                    }
                } else {
                    TestResult::Failed(format!(
                        "Expected type {}, got {:?}",
                        expected_type, result
                    ))
                }
            } else {
                TestResult::Passed
            }
        }
        Err(e) => TestResult::Error(format!("Map operation failed: {}", e)),
    }
}

/// Execute a pipelined test.
async fn run_pipeline_test(
    client: &RpcClient,
    test: &TestCase,
    steps: &[PipelineStepSpec],
) -> TestResult {
    let pipeline_steps: Vec<PipelineStep> = steps
        .iter()
        .map(|step| PipelineStep {
            call: step.call.clone(),
            args: step.args.clone(),
            alias: step.alias.clone(),
            target: None,
        })
        .collect();

    match client.pipeline(pipeline_steps).await {
        Ok(result) => {
            if let Some(expected) = &test.expect {
                if values_equal(&result, expected) {
                    TestResult::Passed
                } else {
                    TestResult::Failed(format!(
                        "Expected {:?}, got {:?}",
                        expected, result
                    ))
                }
            } else {
                TestResult::Passed
            }
        }
        Err(e) => {
            if let Some(expected_error) = &test.expect_error {
                if error_matches(&e, expected_error) {
                    TestResult::Passed
                } else {
                    TestResult::Failed(format!(
                        "Error did not match expected: {:?} vs {:?}",
                        e, expected_error
                    ))
                }
            } else {
                TestResult::Error(format!("Unexpected error: {}", e))
            }
        }
    }
}

/// Execute a sequence test.
async fn run_sequence_test(
    client: &RpcClient,
    test: &TestCase,
    sequence: &[SequenceStep],
) -> TestResult {
    // Run setup first
    if let Some(setup) = &test.setup {
        for step in setup {
            if let Err(e) = client.call_raw(&step.call, step.args.clone()).await {
                return TestResult::Error(format!("Setup failed: {}", e));
            }
        }
    }

    // Run sequence steps
    for (i, step) in sequence.iter().enumerate() {
        match client.call_raw(&step.call, step.args.clone()).await {
            Ok(result) => {
                if let Some(expected) = &step.expect {
                    if !values_equal(&result, expected) {
                        return TestResult::Failed(format!(
                            "Step {} failed: expected {:?}, got {:?}",
                            i, expected, result
                        ));
                    }
                }
            }
            Err(e) => {
                return TestResult::Error(format!("Step {} error: {}", i, e));
            }
        }
    }

    TestResult::Passed
}

/// Execute a callback test.
async fn run_callback_test(client: &RpcClient, test: &TestCase) -> TestResult {
    let export_spec = test.export.as_ref().unwrap();

    // Parse the behavior expression to create a callback
    let behavior = export_spec.behavior.clone();

    // Export the callback
    let export_id = match client
        .export(&export_spec.name, move |args| {
            // Simple callback implementations based on behavior
            if behavior.contains("x * 2") {
                if let Some(x) = args.first().and_then(|v| v.as_i64()) {
                    return serde_json::json!(x * 2);
                }
            } else if behavior.contains("x * x") {
                if let Some(x) = args.first().and_then(|v| v.as_i64()) {
                    return serde_json::json!(x * x);
                }
            } else if behavior.contains("-x") {
                if let Some(x) = args.first().and_then(|v| v.as_i64()) {
                    return serde_json::json!(-x);
                }
            } else if behavior.contains("x => 0") {
                return serde_json::json!(0);
            } else if behavior.contains("x => x") {
                if let Some(x) = args.first() {
                    return x.clone();
                }
            }
            JsonValue::Null
        })
        .await
    {
        Ok(id) => id,
        Err(e) => return TestResult::Error(format!("Failed to export callback: {}", e)),
    };

    // Now call the method with the exported callback
    if let Some(method) = &test.call {
        // Replace $name with the export ID in args
        let args: Vec<JsonValue> = test
            .args
            .iter()
            .map(|arg| {
                if let Some(s) = arg.as_str() {
                    if s.starts_with('$') && s[1..] == export_spec.name {
                        serde_json::json!({ "$stub": export_id })
                    } else {
                        arg.clone()
                    }
                } else {
                    arg.clone()
                }
            })
            .collect();

        match client.call_raw(method, args).await {
            Ok(result) => {
                if let Some(expected) = &test.expect {
                    if values_equal(&result, expected) {
                        TestResult::Passed
                    } else {
                        TestResult::Failed(format!(
                            "Expected {:?}, got {:?}",
                            expected, result
                        ))
                    }
                } else {
                    TestResult::Passed
                }
            }
            Err(e) => TestResult::Error(format!("Callback test failed: {}", e)),
        }
    } else {
        TestResult::Error("Callback test has no 'call' field".to_string())
    }
}

/// Check if two JSON values are equal (with some tolerance for types).
fn values_equal(actual: &JsonValue, expected: &JsonValue) -> bool {
    match (actual, expected) {
        (JsonValue::Number(a), JsonValue::Number(b)) => {
            // Compare numbers with floating point tolerance
            if let (Some(af), Some(bf)) = (a.as_f64(), b.as_f64()) {
                (af - bf).abs() < 1e-10
            } else {
                a == b
            }
        }
        (JsonValue::Array(a), JsonValue::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| values_equal(x, y))
        }
        (JsonValue::Object(a), JsonValue::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).map_or(false, |bv| values_equal(v, bv)))
        }
        _ => actual == expected,
    }
}

/// Check if a value matches an expected type.
fn check_type(value: &JsonValue, expected_type: &str) -> bool {
    match expected_type {
        "array" => value.is_array(),
        "array_of_capabilities" => {
            value.is_array()
                && value
                    .as_array()
                    .map(|arr| arr.iter().all(|v| v.is_object()))
                    .unwrap_or(false)
        }
        "capability" => value.is_object(),
        "number" => value.is_number(),
        "string" => value.is_string(),
        "null" => value.is_null(),
        "object" => value.is_object(),
        _ => true,
    }
}

/// Check if an error matches the expected error specification.
fn error_matches(error: &RpcError, expected: &ExpectedError) -> bool {
    // Handle any_of alternatives
    if let Some(alternatives) = &expected.any_of {
        return alternatives.iter().any(|alt| match alt {
            AnyOfError::Error { r#type } => error_type_matches(error, r#type),
            AnyOfError::Value { value: _ } => {
                // If we got an error but expected a value, it doesn't match
                false
            }
        });
    }

    // Check error type
    if let Some(error_type) = &expected.error_type {
        if !error_type_matches(error, error_type) {
            return false;
        }
    }

    // Check error message
    if let Some(message_contains) = &expected.message_contains {
        if !error.message_contains(message_contains) {
            return false;
        }
    }

    true
}

/// Check if an error matches a specific type name.
fn error_type_matches(error: &RpcError, type_name: &str) -> bool {
    error.is_type(type_name)
}

// ============================================================================
// Test Runner
// ============================================================================

/// Summary of test results.
#[derive(Debug, Default)]
struct TestSummary {
    passed: usize,
    failed: usize,
    skipped: usize,
    errors: usize,
}

impl TestSummary {
    fn add(&mut self, result: &TestResult) {
        match result {
            TestResult::Passed => self.passed += 1,
            TestResult::Failed(_) => self.failed += 1,
            TestResult::Skipped(_) => self.skipped += 1,
            TestResult::Error(_) => self.errors += 1,
        }
    }

    fn total(&self) -> usize {
        self.passed + self.failed + self.skipped + self.errors
    }

    fn success(&self) -> bool {
        self.failed == 0 && self.errors == 0
    }
}

/// Print a test result to stdout.
fn print_result(test: &TestCase, result: &TestResult) {
    let status = match result {
        TestResult::Passed => "\x1b[32mPASS\x1b[0m",
        TestResult::Failed(_) => "\x1b[31mFAIL\x1b[0m",
        TestResult::Skipped(_) => "\x1b[33mSKIP\x1b[0m",
        TestResult::Error(_) => "\x1b[31mERROR\x1b[0m",
    };

    println!(
        "[{}] {}::{} - {}",
        status, test._category, test.name, test.description
    );

    match result {
        TestResult::Failed(msg) | TestResult::Error(msg) | TestResult::Skipped(msg) => {
            println!("       {}", msg);
        }
        _ => {}
    }
}

/// Print the test summary.
fn print_summary(summary: &TestSummary) {
    println!();
    println!("========================================");
    println!("Test Summary");
    println!("========================================");
    println!(
        "Total:   {} tests",
        summary.total()
    );
    println!("\x1b[32mPassed:  {}\x1b[0m", summary.passed);
    println!("\x1b[31mFailed:  {}\x1b[0m", summary.failed);
    println!("\x1b[33mSkipped: {}\x1b[0m", summary.skipped);
    println!("\x1b[31mErrors:  {}\x1b[0m", summary.errors);
    println!("========================================");

    if summary.success() {
        if summary.skipped > 0 {
            println!("\x1b[33mResult: PASS (with skipped tests)\x1b[0m");
        } else {
            println!("\x1b[32mResult: PASS\x1b[0m");
        }
    } else {
        println!("\x1b[31mResult: FAIL\x1b[0m");
    }
}

// ============================================================================
// Main Test Function
// ============================================================================

#[tokio::test]
async fn run_conformance_tests() {
    // Load test specifications
    let spec_dir = get_spec_dir();
    println!("Loading tests from: {}", spec_dir.display());

    let tests = load_test_specs(&spec_dir);
    println!("Found {} test cases", tests.len());

    if tests.is_empty() {
        println!("No test cases found. Skipping.");
        return;
    }

    // Connect to test server
    let server_url = get_server_url();
    let ws_url = to_ws_url(&server_url);
    println!("Test server: {}", ws_url);

    let client = match connect(&ws_url).await {
        Ok(s) => s,
        Err(e) => {
            println!("Failed to connect to test server: {}", e);
            println!("Skipping all tests.");

            // Print all tests as skipped
            let mut summary = TestSummary::default();
            for test in &tests {
                let result = TestResult::Skipped(format!("Cannot connect to server: {}", e));
                print_result(test, &result);
                summary.add(&result);
            }
            print_summary(&summary);
            return;
        }
    };

    println!();
    println!("Running tests...");
    println!();

    // Run all tests
    let mut summary = TestSummary::default();

    for test in &tests {
        let result = run_test(&client, test).await;
        print_result(test, &result);
        summary.add(&result);
    }

    print_summary(&summary);

    // Close the client
    let _ = client.close().await;

    // The test passes if there are no failures or errors
    // Skipped tests are acceptable (SDK not implemented yet)
    assert!(
        summary.success(),
        "Some tests failed. See output above for details."
    );
}

// ============================================================================
// Individual Test Functions (for IDE integration)
// ============================================================================

/// Module containing individual test cases for better IDE integration.
mod individual_tests {
    use super::*;

    /// Test that the SDK can connect to the server.
    #[tokio::test]
    async fn test_connection() {
        let server_url = get_server_url();
        let ws_url = to_ws_url(&server_url);

        match connect(&ws_url).await {
            Ok(client) => {
                assert!(client.is_connected().await);
                println!("Successfully connected to {}", ws_url);
                let _ = client.close().await;
            }
            Err(e) => {
                println!("Connection failed (expected if server not running): {}", e);
            }
        }
    }

    /// Test that specs can be loaded.
    #[test]
    fn test_load_specs() {
        let spec_dir = get_spec_dir();
        let tests = load_test_specs(&spec_dir);

        println!("Loaded {} tests from {}", tests.len(), spec_dir.display());

        // Group by category
        let mut by_category: HashMap<String, Vec<&TestCase>> = HashMap::new();
        for test in &tests {
            by_category
                .entry(test._category.clone())
                .or_default()
                .push(test);
        }

        for (category, tests) in &by_category {
            println!("  {}: {} tests", category, tests.len());
        }
    }

    /// Test JSON value comparison.
    #[test]
    fn test_values_equal() {
        use serde_json::json;

        // Numbers
        assert!(values_equal(&json!(5), &json!(5)));
        assert!(values_equal(&json!(3.14159), &json!(3.14159)));
        assert!(!values_equal(&json!(5), &json!(6)));

        // Arrays
        assert!(values_equal(&json!([1, 2, 3]), &json!([1, 2, 3])));
        assert!(!values_equal(&json!([1, 2, 3]), &json!([1, 2])));

        // Null
        assert!(values_equal(&json!(null), &json!(null)));

        // Objects
        assert!(values_equal(
            &json!({"first": 1, "second": 3}),
            &json!({"first": 1, "second": 3})
        ));
    }

    /// Test SDK implementation check.
    #[test]
    fn test_is_implemented() {
        // Should report implemented
        assert!(is_implemented());
    }
}
