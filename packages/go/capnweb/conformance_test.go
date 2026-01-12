package capnweb

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

// ConformanceSpec represents a YAML conformance test specification file.
type ConformanceSpec struct {
	Name        string           `yaml:"name"`
	Description string           `yaml:"description"`
	Tests       []ConformanceTest `yaml:"tests"`
}

// ConformanceTest represents a single test case in the conformance suite.
type ConformanceTest struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`

	// Simple RPC call
	Call   string `yaml:"call,omitempty"`
	Args   []any  `yaml:"args,omitempty"`
	Expect any    `yaml:"expect,omitempty"`

	// Pipeline tests
	Pipeline []PipelineStep `yaml:"pipeline,omitempty"`
	Setup    []PipelineStep `yaml:"setup,omitempty"`

	// Performance constraints
	MaxRoundTrips int `yaml:"max_round_trips,omitempty"`

	// Error expectations
	ExpectError *ErrorExpectation `yaml:"expect_error,omitempty"`
}

// PipelineStep represents a step in a pipelined call sequence.
type PipelineStep struct {
	Call string `yaml:"call"`
	Args []any  `yaml:"args,omitempty"`
	As   string `yaml:"as,omitempty"`
}

// ErrorExpectation describes an expected error response.
type ErrorExpectation struct {
	Code    string `yaml:"code,omitempty"`
	Message string `yaml:"message,omitempty"`
}

// getSpecDir returns the directory containing conformance spec files.
func getSpecDir() string {
	if dir := os.Getenv("TEST_SPEC_DIR"); dir != "" {
		return dir
	}
	return "../../test/conformance/"
}

// getServerURL returns the test server URL.
func getServerURL() string {
	if url := os.Getenv("TEST_SERVER_URL"); url != "" {
		return url
	}
	return "ws://localhost:8080"
}

// loadSpecs loads all YAML conformance specs from the spec directory.
func loadSpecs(t *testing.T) []ConformanceSpec {
	t.Helper()

	specDir := getSpecDir()
	pattern := filepath.Join(specDir, "*.yaml")

	files, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("Failed to glob spec files: %v", err)
	}

	if len(files) == 0 {
		t.Skipf("No conformance specs found in %s", specDir)
	}

	var specs []ConformanceSpec
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("Failed to read spec file %s: %v", file, err)
		}

		var spec ConformanceSpec
		if err := yaml.Unmarshal(data, &spec); err != nil {
			t.Fatalf("Failed to parse spec file %s: %v", file, err)
		}

		specs = append(specs, spec)
	}

	return specs
}

// TestConformance runs all conformance tests from YAML specs.
func TestConformance(t *testing.T) {
	specs := loadSpecs(t)
	serverURL := getServerURL()

	t.Logf("Running conformance tests against %s", serverURL)
	t.Logf("Loaded %d spec files", len(specs))

	for _, spec := range specs {
		spec := spec // capture for parallel
		t.Run(spec.Name, func(t *testing.T) {
			t.Logf("Spec: %s", spec.Description)

			for _, test := range spec.Tests {
				test := test // capture for parallel
				t.Run(test.Name, func(t *testing.T) {
					runConformanceTest(t, serverURL, test)
				})
			}
		})
	}
}

// runConformanceTest executes a single conformance test.
func runConformanceTest(t *testing.T, serverURL string, test ConformanceTest) {
	t.Helper()

	if test.Description != "" {
		t.Logf("Test: %s", test.Description)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Attempt to connect - skip if SDK not implemented
	session, err := Connect(ctx, serverURL)
	if err == ErrNotImplemented {
		t.Skip("SDK not implemented: Connect")
	}
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer session.Close()

	// Determine test type and run appropriate handler
	if len(test.Pipeline) > 0 {
		runPipelineTest(t, ctx, session, test)
	} else if test.Call != "" {
		runSimpleCallTest(t, ctx, session, test)
	} else {
		t.Skip("Unknown test format")
	}
}

// runSimpleCallTest executes a simple RPC call test.
func runSimpleCallTest(t *testing.T, ctx context.Context, session *Session, test ConformanceTest) {
	t.Helper()

	result, err := session.Call(ctx, test.Call, test.Args...)
	if err == ErrNotImplemented {
		t.Skip("SDK not implemented: Call")
	}

	if test.ExpectError != nil {
		if err == nil {
			t.Errorf("Expected error with code %q, got success", test.ExpectError.Code)
			return
		}
		capnErr, ok := err.(*Error)
		if !ok {
			t.Errorf("Expected capnweb.Error, got %T: %v", err, err)
			return
		}
		if test.ExpectError.Code != "" && capnErr.Code != test.ExpectError.Code {
			t.Errorf("Expected error code %q, got %q", test.ExpectError.Code, capnErr.Code)
		}
		return
	}

	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	if !compareValues(result, test.Expect) {
		t.Errorf("Expected %v, got %v", test.Expect, result)
	}
}

// runPipelineTest executes a pipelined call test.
func runPipelineTest(t *testing.T, ctx context.Context, session *Session, test ConformanceTest) {
	t.Helper()

	// Run setup steps if present
	refs := make(map[string]*Ref[any])
	refs["self"] = session.Root()

	if len(test.Setup) > 0 {
		for _, step := range test.Setup {
			ref, err := executePipelineStep(ctx, session, refs, step)
			if err == ErrNotImplemented {
				t.Skip("SDK not implemented: Pipeline setup")
			}
			if err != nil {
				t.Fatalf("Setup step %q failed: %v", step.Call, err)
			}
			if step.As != "" {
				refs[step.As] = ref
			}
		}
	}

	// Build and execute pipeline
	pipeline := session.NewPipeline()
	for _, step := range test.Pipeline {
		ref := resolveCallTarget(refs, step.Call)
		method := extractMethod(step.Call)
		args := resolveArgs(refs, step.Args)

		resultRef := pipeline.Add(ref, method, args, step.As)
		if step.As != "" {
			refs[step.As] = resultRef
		}
	}

	results, err := pipeline.Execute(ctx)
	if err == ErrNotImplemented {
		t.Skip("SDK not implemented: Pipeline.Execute")
	}
	if err != nil {
		t.Fatalf("Pipeline execution failed: %v", err)
	}

	// Verify results
	if !compareValues(results, test.Expect) {
		t.Errorf("Expected %v, got %v", test.Expect, results)
	}

	// TODO: Verify max_round_trips constraint
	if test.MaxRoundTrips > 0 {
		t.Logf("Note: max_round_trips=%d constraint not yet verified", test.MaxRoundTrips)
	}
}

// executePipelineStep executes a single pipeline step during setup.
func executePipelineStep(ctx context.Context, session *Session, refs map[string]*Ref[any], step PipelineStep) (*Ref[any], error) {
	ref := resolveCallTarget(refs, step.Call)
	method := extractMethod(step.Call)
	args := resolveArgs(refs, step.Args)

	_, err := ref.Call(ctx, method, args...)
	if err != nil {
		return nil, err
	}

	// Return a reference for chaining
	return ref.Get(method), nil
}

// resolveCallTarget finds the Ref to call based on the call string.
// E.g., "counter.increment" -> refs["counter"], "makeCounter" -> root
func resolveCallTarget(refs map[string]*Ref[any], call string) *Ref[any] {
	// Check if call has a dot (method on capability)
	for i, c := range call {
		if c == '.' {
			refName := call[:i]
			if ref, ok := refs[refName]; ok {
				return ref
			}
		}
	}
	// Default to root/self
	return refs["self"]
}

// extractMethod extracts the method name from a call string.
// E.g., "counter.increment" -> "increment", "makeCounter" -> "makeCounter"
func extractMethod(call string) string {
	for i := len(call) - 1; i >= 0; i-- {
		if call[i] == '.' {
			return call[i+1:]
		}
	}
	return call
}

// resolveArgs replaces $ref placeholders with actual Ref objects.
func resolveArgs(refs map[string]*Ref[any], args []any) []any {
	resolved := make([]any, len(args))
	for i, arg := range args {
		if s, ok := arg.(string); ok && len(s) > 0 && s[0] == '$' {
			refName := s[1:]
			if ref, ok := refs[refName]; ok {
				resolved[i] = ref
				continue
			}
		}
		resolved[i] = arg
	}
	return resolved
}

// compareValues compares expected and actual values for test assertions.
func compareValues(actual, expected any) bool {
	// Handle nil cases
	if expected == nil {
		return actual == nil
	}
	if actual == nil {
		return false
	}

	// Handle map comparison
	if expectedMap, ok := expected.(map[string]any); ok {
		actualMap, ok := actual.(map[string]any)
		if !ok {
			return false
		}
		if len(expectedMap) != len(actualMap) {
			return false
		}
		for k, v := range expectedMap {
			if !compareValues(actualMap[k], v) {
				return false
			}
		}
		return true
	}

	// Handle slice comparison
	if expectedSlice, ok := expected.([]any); ok {
		actualSlice, ok := actual.([]any)
		if !ok {
			return false
		}
		if len(expectedSlice) != len(actualSlice) {
			return false
		}
		for i, v := range expectedSlice {
			if !compareValues(actualSlice[i], v) {
				return false
			}
		}
		return true
	}

	// Handle numeric comparison (YAML may parse as int or float)
	if expectedNum, ok := toFloat64(expected); ok {
		if actualNum, ok := toFloat64(actual); ok {
			return expectedNum == actualNum
		}
	}

	// Default comparison
	return fmt.Sprintf("%v", actual) == fmt.Sprintf("%v", expected)
}

// toFloat64 attempts to convert a value to float64.
func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case float64:
		return n, true
	case float32:
		return float64(n), true
	default:
		return 0, false
	}
}

// TestConformanceSpecLoading verifies that spec files can be loaded.
func TestConformanceSpecLoading(t *testing.T) {
	specs := loadSpecs(t)

	if len(specs) == 0 {
		t.Skip("No specs found")
	}

	for _, spec := range specs {
		t.Logf("Loaded spec: %s (%d tests)", spec.Name, len(spec.Tests))
		if spec.Name == "" {
			t.Errorf("Spec missing name")
		}
		for _, test := range spec.Tests {
			if test.Name == "" {
				t.Errorf("Test missing name in spec %s", spec.Name)
			}
		}
	}
}

// TestServerConnection verifies connection to the test server.
func TestServerConnection(t *testing.T) {
	serverURL := getServerURL()
	t.Logf("Testing connection to %s", serverURL)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	session, err := Connect(ctx, serverURL)
	if err == ErrNotImplemented {
		t.Skip("SDK not implemented: Connect")
	}
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer session.Close()

	t.Log("Connection successful")
}
