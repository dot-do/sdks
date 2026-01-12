package rpc

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

// ConformanceSpec represents a YAML conformance test specification file.
type ConformanceSpec struct {
	Name        string            `yaml:"name"`
	Description string            `yaml:"description"`
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
	Setup    []SetupStep    `yaml:"setup,omitempty"`
	Sequence []SequenceStep `yaml:"sequence,omitempty"`

	// Map operation
	Map *MapSpec `yaml:"map,omitempty"`

	// Export for callbacks
	Export *ExportSpec `yaml:"export,omitempty"`

	// Performance constraints
	MaxRoundTrips int `yaml:"max_round_trips,omitempty"`

	// Error expectations
	ExpectError *ErrorExpectation `yaml:"expect_error,omitempty"`

	// Type expectations
	ExpectType   string `yaml:"expect_type,omitempty"`
	ExpectLength int    `yaml:"expect_length,omitempty"`

	// Verification steps
	Verify []VerifyStep `yaml:"verify,omitempty"`
}

// PipelineStep represents a step in a pipelined call sequence.
type PipelineStep struct {
	Call string `yaml:"call"`
	Args []any  `yaml:"args,omitempty"`
	As   string `yaml:"as,omitempty"`
}

// SetupStep represents a setup step before the main test.
type SetupStep struct {
	Call    string     `yaml:"call,omitempty"`
	Args    []any      `yaml:"args,omitempty"`
	As      string     `yaml:"as,omitempty"`
	Await   bool       `yaml:"await,omitempty"`
	Map     *MapSpec   `yaml:"map,omitempty"`
	Pipeline []PipelineStep `yaml:"pipeline,omitempty"`
}

// SequenceStep represents a step in a sequential test.
type SequenceStep struct {
	Call   string `yaml:"call"`
	Args   []any  `yaml:"args,omitempty"`
	Expect any    `yaml:"expect,omitempty"`
}

// MapSpec represents a server-side map operation.
type MapSpec struct {
	Expression string   `yaml:"expression"`
	Captures   []string `yaml:"captures,omitempty"`
}

// ExportSpec represents a client-exported function.
type ExportSpec struct {
	Name     string `yaml:"name"`
	Type     string `yaml:"type"`
	Behavior string `yaml:"behavior"`
}

// ErrorExpectation describes an expected error response.
type ErrorExpectation struct {
	Type            string `yaml:"type,omitempty"`
	MessageContains string `yaml:"message_contains,omitempty"`
	AnyOf           []any  `yaml:"any_of,omitempty"`
}

// VerifyStep represents a verification step after the main call.
type VerifyStep struct {
	Call   string `yaml:"call"`
	Expect any    `yaml:"expect,omitempty"`
}

// getSpecDir returns the directory containing conformance spec files.
func getSpecDir() string {
	if dir := os.Getenv("TEST_SPEC_DIR"); dir != "" {
		return dir
	}
	return "../../../test/conformance/"
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

	// Connect to the test server
	client, err := Connect(serverURL)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer client.Close()

	// Create a test runner with capability references
	runner := &testRunner{
		t:      t,
		ctx:    ctx,
		client: client,
		refs:   make(map[string]*Promise),
	}

	// Handle exported callbacks
	if test.Export != nil {
		runner.registerCallback(test.Export)
	}

	// Run setup steps
	if len(test.Setup) > 0 {
		for _, step := range test.Setup {
			if err := runner.runSetup(step); err != nil {
				t.Fatalf("Setup step failed: %v", err)
			}
		}
	}

	// Determine test type and run
	if len(test.Pipeline) > 0 {
		runner.runPipelineTest(test)
	} else if len(test.Sequence) > 0 {
		runner.runSequenceTest(test)
	} else if test.Call != "" {
		runner.runSimpleCallTest(test)
	} else {
		t.Skip("Unknown test format")
	}
}

// testRunner manages state during test execution.
type testRunner struct {
	t         *testing.T
	ctx       context.Context
	client    *Client
	refs      map[string]*Promise
	callbacks map[string]func(any) any
}

// registerCallback registers an exported callback function.
func (r *testRunner) registerCallback(export *ExportSpec) {
	if r.callbacks == nil {
		r.callbacks = make(map[string]func(any) any)
	}

	// Parse the behavior expression to create a callback function
	// For now, we support simple expressions like "x => x * 2"
	fn := parseCallback(export.Behavior)
	r.callbacks[export.Name] = fn

	// Register with the client
	r.client.Export(export.Name, fn)
}

// parseCallback parses a simple callback expression.
func parseCallback(behavior string) func(any) any {
	// Parse simple arrow functions like "x => x * 2"
	behavior = strings.TrimSpace(behavior)
	parts := strings.SplitN(behavior, "=>", 2)
	if len(parts) != 2 {
		return func(x any) any { return x }
	}

	param := strings.TrimSpace(parts[0])
	expr := strings.TrimSpace(parts[1])
	_ = param // unused but parsed for clarity

	// Handle common patterns
	switch {
	case strings.Contains(expr, "* 2"):
		return func(x any) any {
			if n, ok := toFloat64(x); ok {
				return n * 2
			}
			return x
		}
	case strings.Contains(expr, "* x") || strings.Contains(expr, "x * x"):
		return func(x any) any {
			if n, ok := toFloat64(x); ok {
				return n * n
			}
			return x
		}
	case expr == "0":
		return func(x any) any { return 0.0 }
	case strings.HasPrefix(expr, "-"):
		return func(x any) any {
			if n, ok := toFloat64(x); ok {
				return -n
			}
			return x
		}
	default:
		// Identity function
		return func(x any) any { return x }
	}
}

// runSetup executes a setup step.
func (r *testRunner) runSetup(step SetupStep) error {
	if step.Pipeline != nil {
		// Handle pipeline in setup
		for _, ps := range step.Pipeline {
			promise := r.executeCall(ps.Call, ps.Args)
			if ps.As != "" {
				r.refs[ps.As] = promise
			}
		}
		return nil
	}

	if step.Call != "" {
		promise := r.executeCall(step.Call, step.Args)
		if step.Map != nil {
			promise = r.applyMap(promise, step.Map)
		}
		if step.As != "" {
			r.refs[step.As] = promise
		}
		if step.Await {
			_, err := promise.Await()
			return err
		}
	}
	return nil
}

// executeCall executes a call and returns a promise.
func (r *testRunner) executeCall(call string, args []any) *Promise {
	// Replace $ref placeholders with actual references
	resolvedArgs := r.resolveArgs(args)

	// Check if it's a method on a reference (e.g., "counter.increment")
	if strings.HasPrefix(call, "$") {
		// It's a reference call like "$counters"
		refName := call[1:]
		if ref, ok := r.refs[refName]; ok {
			return ref
		}
	}

	if strings.Contains(call, ".") {
		parts := strings.SplitN(call, ".", 2)
		refName := parts[0]
		method := parts[1]

		if ref, ok := r.refs[refName]; ok {
			// Call method on the referenced capability
			return ref.Call(method, resolvedArgs...)
		}
	}

	// It's a root call
	return r.client.Call(call, resolvedArgs...)
}

// applyMap applies a map operation to a promise.
func (r *testRunner) applyMap(promise *Promise, mapSpec *MapSpec) *Promise {
	// Resolve captures
	captures := make(map[string]any)
	for _, cap := range mapSpec.Captures {
		if strings.HasPrefix(cap, "$") {
			name := cap[1:]
			if name == "self" {
				captures["self"] = r.client.Self()
			} else if ref, ok := r.refs[name]; ok {
				captures[name] = ref
			}
		}
	}

	// Create a mapping function based on the expression
	return promise.Map(func(item any) any {
		return r.evaluateMapExpression(mapSpec.Expression, item, captures)
	})
}

// evaluateMapExpression evaluates a map expression.
func (r *testRunner) evaluateMapExpression(expr string, item any, captures map[string]any) any {
	// Parse expressions like "x => self.square(x)"
	expr = strings.TrimSpace(expr)
	parts := strings.SplitN(expr, "=>", 2)
	if len(parts) != 2 {
		return item
	}

	body := strings.TrimSpace(parts[1])

	// Handle method calls on captures
	if strings.HasPrefix(body, "self.") {
		methodCall := body[5:]
		parenIdx := strings.Index(methodCall, "(")
		if parenIdx > 0 {
			method := methodCall[:parenIdx]
			if client, ok := captures["self"].(*Client); ok {
				promise := client.Call(method, item)
				result, _ := promise.Await()
				return result
			}
		}
	}

	// Handle method calls on the item (e.g., "counter => counter.value")
	if strings.Contains(body, ".") {
		parts := strings.SplitN(body, ".", 2)
		method := parts[1]
		if strings.HasSuffix(method, "()") {
			method = method[:len(method)-2]
		}
		if pItem, ok := item.(*Promise); ok {
			result, _ := pItem.Call(method).Await()
			return result
		}
	}

	return item
}

// resolveArgs replaces $ref placeholders with actual values.
func (r *testRunner) resolveArgs(args []any) []any {
	resolved := make([]any, len(args))
	for i, arg := range args {
		if s, ok := arg.(string); ok && strings.HasPrefix(s, "$") {
			refName := s[1:]
			if refName == "self" {
				resolved[i] = r.client.Self()
			} else if ref, ok := r.refs[refName]; ok {
				resolved[i] = ref
			} else if cb, ok := r.callbacks[refName]; ok {
				resolved[i] = cb
			} else {
				resolved[i] = arg
			}
		} else {
			resolved[i] = arg
		}
	}
	return resolved
}

// runSimpleCallTest executes a simple call test.
func (r *testRunner) runSimpleCallTest(test ConformanceTest) {
	promise := r.executeCall(test.Call, test.Args)

	if test.Map != nil {
		promise = r.applyMap(promise, test.Map)
	}

	result, err := promise.Await()

	if test.ExpectError != nil {
		if err == nil {
			r.t.Errorf("Expected error, got success with result: %v", result)
			return
		}
		r.verifyError(err, test.ExpectError)
		return
	}

	if err != nil {
		r.t.Fatalf("Call failed: %v", err)
	}

	if test.ExpectType != "" {
		r.verifyType(result, test.ExpectType, test.ExpectLength)
	} else {
		r.verifyResult(result, test.Expect)
	}

	// Run verification steps
	for _, verify := range test.Verify {
		r.runVerify(verify, result)
	}
}

// runPipelineTest executes a pipeline test.
func (r *testRunner) runPipelineTest(test ConformanceTest) {
	var lastPromise *Promise
	results := make(map[string]any)

	for _, step := range test.Pipeline {
		promise := r.executeCall(step.Call, step.Args)
		if step.As != "" {
			r.refs[step.As] = promise
		}
		lastPromise = promise
	}

	// Await all named results
	for name, ref := range r.refs {
		result, err := ref.Await()
		if err != nil {
			r.t.Fatalf("Pipeline step %s failed: %v", name, err)
		}
		results[name] = result
	}

	// Get final result
	var finalResult any
	var err error
	if lastPromise != nil {
		finalResult, err = lastPromise.Await()
		if err != nil {
			r.t.Fatalf("Pipeline failed: %v", err)
		}
	}

	// Verify based on expect type
	if test.Expect != nil {
		if expectMap, ok := test.Expect.(map[string]any); ok {
			for key, expectedVal := range expectMap {
				if actualVal, ok := results[key]; ok {
					r.verifyResult(actualVal, expectedVal)
				}
			}
		} else {
			r.verifyResult(finalResult, test.Expect)
		}
	}
}

// runSequenceTest executes a sequence of calls.
func (r *testRunner) runSequenceTest(test ConformanceTest) {
	for _, step := range test.Sequence {
		promise := r.executeCall(step.Call, step.Args)
		result, err := promise.Await()
		if err != nil {
			r.t.Fatalf("Sequence step %s failed: %v", step.Call, err)
		}
		if step.Expect != nil {
			r.verifyResult(result, step.Expect)
		}
	}
}

// runVerify executes a verification step.
func (r *testRunner) runVerify(verify VerifyStep, previousResult any) {
	// Parse the call path (e.g., "result.value")
	call := verify.Call
	if strings.HasPrefix(call, "result.") {
		method := call[7:]
		if pResult, ok := previousResult.(*Promise); ok {
			result, err := pResult.Call(method).Await()
			if err != nil {
				r.t.Fatalf("Verify step failed: %v", err)
			}
			r.verifyResult(result, verify.Expect)
		}
	}
}

// verifyError checks if the error matches expectations.
func (r *testRunner) verifyError(err error, expect *ErrorExpectation) {
	errMsg := err.Error()

	if expect.AnyOf != nil {
		// Check if error matches any of the acceptable conditions
		for _, option := range expect.AnyOf {
			if optMap, ok := option.(map[string]any); ok {
				if errType, ok := optMap["type"].(string); ok {
					if strings.Contains(errMsg, errType) {
						return // Match found
					}
				}
			}
		}
	}

	if expect.Type != "" && !strings.Contains(errMsg, expect.Type) {
		r.t.Errorf("Expected error type %q, got: %v", expect.Type, errMsg)
	}

	if expect.MessageContains != "" && !strings.Contains(errMsg, expect.MessageContains) {
		r.t.Errorf("Expected error message containing %q, got: %v", expect.MessageContains, errMsg)
	}
}

// verifyType checks the type of the result.
func (r *testRunner) verifyType(result any, expectType string, expectLength int) {
	switch expectType {
	case "array_of_capabilities":
		if slice, ok := result.([]any); ok {
			if expectLength > 0 && len(slice) != expectLength {
				r.t.Errorf("Expected array length %d, got %d", expectLength, len(slice))
			}
			for i, item := range slice {
				if _, ok := item.(*Promise); !ok {
					r.t.Errorf("Expected capability at index %d, got %T", i, item)
				}
			}
		} else {
			r.t.Errorf("Expected array_of_capabilities, got %T", result)
		}
	case "capability":
		if _, ok := result.(*Promise); !ok {
			r.t.Errorf("Expected capability, got %T", result)
		}
	}
}

// verifyResult checks if the result matches the expected value.
func (r *testRunner) verifyResult(actual, expected any) {
	if !compareValues(actual, expected) {
		r.t.Errorf("Expected %v (%T), got %v (%T)", expected, expected, actual, actual)
	}
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
			// Try to convert actual to []any
			rv := reflect.ValueOf(actual)
			if rv.Kind() == reflect.Slice {
				actualSlice = make([]any, rv.Len())
				for i := 0; i < rv.Len(); i++ {
					actualSlice[i] = rv.Index(i).Interface()
				}
			} else {
				return false
			}
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
	case int32:
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
