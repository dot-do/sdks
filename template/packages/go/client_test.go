package {{name}}

import (
	"testing"
)

func TestNewClient(t *testing.T) {
	client, err := NewClient("test-key")
	if err != nil {
		t.Fatalf("NewClient() error = %v", err)
	}
	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.options.APIKey != "test-key" {
		t.Errorf("APIKey = %v, want %v", client.options.APIKey, "test-key")
	}
}

func TestNewClientWithOptions(t *testing.T) {
	opts := ClientOptions{
		APIKey:  "test-key",
		BaseURL: "https://custom.{{name}}.do",
	}
	client, err := NewClientWithOptions(opts)
	if err != nil {
		t.Fatalf("NewClientWithOptions() error = %v", err)
	}
	if client.options.BaseURL != "https://custom.{{name}}.do" {
		t.Errorf("BaseURL = %v, want %v", client.options.BaseURL, "https://custom.{{name}}.do")
	}
}

func TestDefaultOptions(t *testing.T) {
	opts := DefaultOptions()
	if opts.BaseURL != "https://{{name}}.do" {
		t.Errorf("BaseURL = %v, want %v", opts.BaseURL, "https://{{name}}.do")
	}
	if opts.APIKey != "" {
		t.Errorf("APIKey = %v, want empty", opts.APIKey)
	}
}
