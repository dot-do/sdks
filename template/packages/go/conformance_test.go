package {{name}}

import (
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

type ConformanceTest struct {
	Name        string      `yaml:"name"`
	Description string      `yaml:"description"`
	Input       interface{} `yaml:"input"`
	Expected    interface{} `yaml:"expected"`
}

func loadConformanceTests(t *testing.T) []ConformanceTest {
	t.Helper()

	testPath := filepath.Join("..", "..", "test", "conformance", "tests.yaml")
	data, err := os.ReadFile(testPath)
	if err != nil {
		t.Logf("No conformance tests found at %s, skipping", testPath)
		return nil
	}

	var tests []ConformanceTest
	if err := yaml.Unmarshal(data, &tests); err != nil {
		t.Fatalf("Failed to parse conformance tests: %v", err)
	}

	return tests
}

func TestConformance(t *testing.T) {
	tests := loadConformanceTests(t)
	if len(tests) == 0 {
		t.Skip("No conformance tests found")
	}

	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			t.Logf("Running test: %s", test.Name)
			// TODO: Implement actual test execution
		})
	}
}
