package capnweb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"nhooyr.io/websocket"
)

// mockServer creates a test WebSocket server for unit testing.
type mockServer struct {
	server   *httptest.Server
	handlers map[string]func([]any) (any, error)
	mu       sync.RWMutex
	conns    []*websocket.Conn
	connMu   sync.Mutex
}

// rpcMessage is the wire format for RPC messages (for testing).
type testRPCMessage struct {
	ID     uint64 `json:"id,omitempty"`
	Type   string `json:"type"`
	Method string `json:"method,omitempty"`
	Args   []any  `json:"args,omitempty"`
	Result any    `json:"result,omitempty"`
	Error  *Error `json:"error,omitempty"`
}

func newMockServer() *mockServer {
	ms := &mockServer{
		handlers: make(map[string]func([]any) (any, error)),
	}

	// Register default test handlers
	ms.registerDefaults()

	ms.server = httptest.NewServer(http.HandlerFunc(ms.handleConnection))
	return ms
}

func (ms *mockServer) registerDefaults() {
	// square(x) = x * x
	ms.handlers["square"] = func(args []any) (any, error) {
		if len(args) == 0 {
			return nil, &Error{Code: "Error", Message: "missing argument"}
		}
		x, _ := toFloat64(args[0])
		return x * x, nil
	}

	// returnNumber(x) = x
	ms.handlers["returnNumber"] = func(args []any) (any, error) {
		if len(args) == 0 {
			return 0.0, nil
		}
		return args[0], nil
	}

	// returnNull() = null
	ms.handlers["returnNull"] = func(args []any) (any, error) {
		return nil, nil
	}

	// add(a, b) = a + b
	ms.handlers["add"] = func(args []any) (any, error) {
		if len(args) < 2 {
			return nil, &Error{Code: "Error", Message: "missing arguments"}
		}
		a, _ := toFloat64(args[0])
		b, _ := toFloat64(args[1])
		return a + b, nil
	}

	// generateFibonacci(n) = [0, 1, 1, 2, 3, 5, ...]
	ms.handlers["generateFibonacci"] = func(args []any) (any, error) {
		if len(args) == 0 {
			return []float64{}, nil
		}
		n, _ := toFloat64(args[0])
		count := int(n)
		if count <= 0 {
			return []float64{}, nil
		}
		fib := make([]float64, count)
		for i := 0; i < count; i++ {
			if i == 0 {
				fib[i] = 0
			} else if i == 1 {
				fib[i] = 1
			} else {
				fib[i] = fib[i-1] + fib[i-2]
			}
		}
		return fib, nil
	}

	// throwError() throws an error
	ms.handlers["throwError"] = func(args []any) (any, error) {
		return nil, &Error{Code: "RangeError", Message: "test error"}
	}
}

func (ms *mockServer) handleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}

	ms.connMu.Lock()
	ms.conns = append(ms.conns, conn)
	ms.connMu.Unlock()

	defer conn.Close(websocket.StatusNormalClosure, "")

	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}

		var msg testRPCMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		if msg.Type == "call" {
			ms.handleCall(ctx, conn, msg)
		}
	}
}

func (ms *mockServer) handleCall(ctx context.Context, conn *websocket.Conn, msg testRPCMessage) {
	response := testRPCMessage{
		ID:   msg.ID,
		Type: "return",
	}

	ms.mu.RLock()
	handler, ok := ms.handlers[msg.Method]
	ms.mu.RUnlock()

	if !ok {
		response.Error = &Error{
			Code:    "Error",
			Message: msg.Method + " is not a function",
		}
	} else {
		result, err := handler(msg.Args)
		if err != nil {
			if capnErr, ok := err.(*Error); ok {
				response.Error = capnErr
			} else {
				response.Error = &Error{Code: "Error", Message: err.Error()}
			}
		} else {
			response.Result = result
		}
	}

	data, _ := json.Marshal(response)
	conn.Write(ctx, websocket.MessageText, data)
}

func (ms *mockServer) URL() string {
	return "ws" + strings.TrimPrefix(ms.server.URL, "http")
}

func (ms *mockServer) Close() {
	ms.connMu.Lock()
	for _, conn := range ms.conns {
		conn.Close(websocket.StatusNormalClosure, "server closing")
	}
	ms.connMu.Unlock()
	ms.server.Close()
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

// compareValues compares expected and actual values for test assertions.
func compareValues(actual, expected any) bool {
	if expected == nil {
		return actual == nil
	}
	if actual == nil {
		return false
	}

	// Handle numeric comparison
	if expectedNum, ok := toFloat64(expected); ok {
		if actualNum, ok := toFloat64(actual); ok {
			return expectedNum == actualNum
		}
	}

	return fmt.Sprintf("%v", actual) == fmt.Sprintf("%v", expected)
}

// TestConnect verifies basic connection establishment.
func TestConnect(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	if !session.IsConnected() {
		t.Error("Expected session to be connected")
	}
}

// TestSimpleCall verifies basic RPC calls.
func TestSimpleCall(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	tests := []struct {
		name   string
		method string
		args   []any
		expect any
	}{
		{"square_positive", "square", []any{5.0}, 25.0},
		{"square_negative", "square", []any{-3.0}, 9.0},
		{"square_zero", "square", []any{0.0}, 0.0},
		{"return_number", "returnNumber", []any{42.0}, 42.0},
		{"return_null", "returnNull", []any{}, nil},
		{"add", "add", []any{3.0, 4.0}, 7.0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, err := session.Call(ctx, tc.method, tc.args...)
			if err != nil {
				t.Fatalf("Call failed: %v", err)
			}

			if !compareValues(result, tc.expect) {
				t.Errorf("Expected %v, got %v", tc.expect, result)
			}
		})
	}
}

// TestFibonacci verifies array returns.
func TestFibonacci(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	result, err := session.Call(ctx, "generateFibonacci", 10.0)
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	expected := []float64{0, 1, 1, 2, 3, 5, 8, 13, 21, 34}

	// Result will be []interface{} from JSON
	if slice, ok := result.([]interface{}); ok {
		if len(slice) != len(expected) {
			t.Fatalf("Expected %d elements, got %d", len(expected), len(slice))
		}
		for i, v := range expected {
			if actual, ok := toFloat64(slice[i]); !ok || actual != v {
				t.Errorf("Element %d: expected %v, got %v", i, v, slice[i])
			}
		}
	} else if slice, ok := result.([]float64); ok {
		if len(slice) != len(expected) {
			t.Fatalf("Expected %d elements, got %d", len(expected), len(slice))
		}
		for i, v := range expected {
			if slice[i] != v {
				t.Errorf("Element %d: expected %v, got %v", i, v, slice[i])
			}
		}
	} else {
		t.Errorf("Expected []float64 or []interface{}, got %T", result)
	}
}

// TestErrorHandling verifies error propagation.
func TestErrorHandling(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	_, err = session.Call(ctx, "throwError")
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	if !strings.Contains(err.Error(), "RangeError") && !strings.Contains(err.Error(), "test error") {
		t.Errorf("Expected RangeError or test error, got: %v", err)
	}
}

// TestNonexistentMethod verifies error on unknown methods.
func TestNonexistentMethod(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	_, err = session.Call(ctx, "nonExistentMethod")
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	if !strings.Contains(err.Error(), "not a function") {
		t.Errorf("Expected 'not a function' error, got: %v", err)
	}
}

// TestSessionClose verifies graceful shutdown.
func TestSessionClose(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	if err := session.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}

	if session.IsConnected() {
		t.Error("Expected session to be disconnected")
	}

	// Calls after close should fail
	_, err = session.Call(ctx, "square", 5.0)
	if err == nil {
		t.Error("Expected error after close")
	}
}

// TestConnectionTimeout verifies connection timeout.
func TestConnectionTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	_, err := Connect(ctx, "ws://localhost:59999")
	if err == nil {
		t.Error("Expected connection to fail")
	}
}

// TestRefGet verifies capability reference chaining.
func TestRefGet(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	root := session.Root()
	ref := root.Get("child").Get("grandchild")

	// Verify path building
	if len(ref.path) != 2 {
		t.Errorf("Expected path length 2, got %d", len(ref.path))
	}
	if ref.path[0] != "child" {
		t.Errorf("Expected path[0]='child', got %q", ref.path[0])
	}
	if ref.path[1] != "grandchild" {
		t.Errorf("Expected path[1]='grandchild', got %q", ref.path[1])
	}
}

// TestPipeline verifies pipeline execution.
func TestPipeline(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	pipe := session.NewPipeline()
	root := session.Root()

	pipe.Add(root, "square", []any{3.0}, "a")
	pipe.Add(root, "square", []any{4.0}, "b")
	pipe.Add(root, "returnNumber", []any{5.0}, "c")

	results, err := pipe.Execute(ctx)
	if err != nil {
		t.Fatalf("Pipeline failed: %v", err)
	}

	if a, ok := toFloat64(results["a"]); !ok || a != 9.0 {
		t.Errorf("Expected a=9, got %v", results["a"])
	}
	if b, ok := toFloat64(results["b"]); !ok || b != 16.0 {
		t.Errorf("Expected b=16, got %v", results["b"])
	}
	if c, ok := toFloat64(results["c"]); !ok || c != 5.0 {
		t.Errorf("Expected c=5, got %v", results["c"])
	}
}

// TestExport verifies function export for bidirectional RPC.
func TestExport(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	// Export a function
	session.Export("double", func(x any) any {
		if n, ok := toFloat64(x); ok {
			return n * 2
		}
		return x
	})

	// Verify it was registered (internal check)
	session.exportsMu.RLock()
	_, exists := session.exports["double"]
	session.exportsMu.RUnlock()

	if !exists {
		t.Error("Expected 'double' to be exported")
	}
}

// TestConcurrentCalls verifies concurrent RPC calls work correctly.
func TestConcurrentCalls(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	const numCalls = 10
	var wg sync.WaitGroup
	results := make(chan float64, numCalls)
	errors := make(chan error, numCalls)

	for i := 0; i < numCalls; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			result, err := session.Call(ctx, "square", float64(n))
			if err != nil {
				errors <- err
				return
			}
			if v, ok := toFloat64(result); ok {
				results <- v
			}
		}(i)
	}

	wg.Wait()
	close(results)
	close(errors)

	// Check for errors
	for err := range errors {
		t.Errorf("Concurrent call failed: %v", err)
	}

	// Verify we got all results
	count := 0
	for range results {
		count++
	}
	if count != numCalls {
		t.Errorf("Expected %d results, got %d", numCalls, count)
	}
}

// TestContextCancellation verifies that context cancellation works.
func TestContextCancellation(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	ctx := context.Background()
	session, err := Connect(ctx, server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer session.Close()

	// Create a cancelled context
	cancelledCtx, cancel := context.WithCancel(ctx)
	cancel()

	_, err = session.Call(cancelledCtx, "square", 5.0)
	if err == nil {
		t.Error("Expected error with cancelled context")
	}
}

// TestErrorType verifies that errors are properly typed.
func TestErrorType(t *testing.T) {
	err := &Error{
		Code:    "TEST_ERROR",
		Message: "test message",
	}

	expected := "capnweb: TEST_ERROR: test message"
	if err.Error() != expected {
		t.Errorf("Expected %q, got %q", expected, err.Error())
	}

	// Without code
	err2 := &Error{
		Message: "only message",
	}
	expected2 := "capnweb: only message"
	if err2.Error() != expected2 {
		t.Errorf("Expected %q, got %q", expected2, err2.Error())
	}
}
