package rpc

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// mockServer creates a test WebSocket server for unit testing.
type mockServer struct {
	server   *httptest.Server
	upgrader websocket.Upgrader
	handlers map[string]func([]any) (any, error)
	mu       sync.RWMutex
	conns    []*websocket.Conn
	connMu   sync.Mutex
}

func newMockServer() *mockServer {
	ms := &mockServer{
		handlers: make(map[string]func([]any) (any, error)),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
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
			return nil, &RPCError{Type: "Error", Message: "missing argument"}
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

	// returnUndefined() = null (JSON equivalent)
	ms.handlers["returnUndefined"] = func(args []any) (any, error) {
		return nil, nil
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

	// throwError() throws a RangeError
	ms.handlers["throwError"] = func(args []any) (any, error) {
		return nil, &RPCError{Type: "RangeError", Message: "test error"}
	}
}

func (ms *mockServer) handleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := ms.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	ms.connMu.Lock()
	ms.conns = append(ms.conns, conn)
	ms.connMu.Unlock()

	defer conn.Close()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg rpcMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		if msg.Type == "call" {
			ms.handleCall(conn, msg)
		}
	}
}

func (ms *mockServer) handleCall(conn *websocket.Conn, msg rpcMessage) {
	response := rpcMessage{
		ID:   msg.ID,
		Type: "return",
	}

	ms.mu.RLock()
	handler, ok := ms.handlers[msg.Method]
	ms.mu.RUnlock()

	if !ok {
		response.Error = &RPCError{
			Type:    "Error",
			Message: msg.Method + " is not a function",
		}
	} else {
		result, err := handler(msg.Args)
		if err != nil {
			if rpcErr, ok := err.(*RPCError); ok {
				response.Error = rpcErr
			} else {
				response.Error = &RPCError{Type: "Error", Message: err.Error()}
			}
		} else {
			response.Result = result
		}
	}

	data, _ := json.Marshal(response)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (ms *mockServer) URL() string {
	return "ws" + strings.TrimPrefix(ms.server.URL, "http")
}

func (ms *mockServer) Close() {
	ms.connMu.Lock()
	for _, conn := range ms.conns {
		conn.Close()
	}
	ms.connMu.Unlock()
	ms.server.Close()
}

// TestConnect verifies basic connection establishment.
func TestConnect(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	if !client.IsConnected() {
		t.Error("Expected client to be connected")
	}
}

// TestSimpleCall verifies basic RPC calls.
func TestSimpleCall(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

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
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			promise := client.Call(tc.method, tc.args...)
			result, err := promise.Await()
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

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	promise := client.Call("generateFibonacci", 10.0)
	result, err := promise.Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	expected := []float64{0, 1, 1, 2, 3, 5, 8, 13, 21, 34}
	if slice, ok := result.([]float64); ok {
		if len(slice) != len(expected) {
			t.Fatalf("Expected %d elements, got %d", len(expected), len(slice))
		}
		for i, v := range expected {
			if slice[i] != v {
				t.Errorf("Element %d: expected %v, got %v", i, v, slice[i])
			}
		}
	} else {
		t.Errorf("Expected []float64, got %T", result)
	}
}

// TestErrorHandling verifies error propagation.
func TestErrorHandling(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	promise := client.Call("throwError")
	_, err = promise.Await()
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	if !strings.Contains(err.Error(), "RangeError") {
		t.Errorf("Expected RangeError, got: %v", err)
	}
}

// TestNonexistentMethod verifies error on unknown methods.
func TestNonexistentMethod(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	promise := client.Call("nonExistentMethod")
	_, err = promise.Await()
	if err == nil {
		t.Fatal("Expected error, got nil")
	}

	if !strings.Contains(err.Error(), "not a function") {
		t.Errorf("Expected 'not a function' error, got: %v", err)
	}
}

// TestPromiseThen verifies promise chaining.
func TestPromiseThen(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	promise := client.Call("returnNumber", 10.0).Then(func(x any) any {
		if n, ok := toFloat64(x); ok {
			return n * 2
		}
		return x
	})

	result, err := promise.Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	if n, ok := toFloat64(result); !ok || n != 20.0 {
		t.Errorf("Expected 20, got %v", result)
	}
}

// TestPromiseMap verifies the Map operation.
func TestPromiseMap(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	// Map over fibonacci to double each value
	promise := client.Call("generateFibonacci", 5.0).Map(func(x any) any {
		if n, ok := toFloat64(x); ok {
			return n * 2
		}
		return x
	})

	result, err := promise.Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	expected := []float64{0, 2, 2, 4, 6}
	if slice, ok := toSlice(result); ok {
		if len(slice) != len(expected) {
			t.Fatalf("Expected %d elements, got %d", len(expected), len(slice))
		}
		for i, v := range expected {
			if n, ok := toFloat64(slice[i]); !ok || n != v {
				t.Errorf("Element %d: expected %v, got %v", i, v, slice[i])
			}
		}
	} else {
		t.Errorf("Expected slice, got %T", result)
	}
}

// TestMapOnNil verifies Map on nil returns nil.
func TestMapOnNil(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	promise := client.Call("returnNull").Map(func(x any) any {
		return "should not be called"
	})

	result, err := promise.Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	if result != nil {
		t.Errorf("Expected nil, got %v", result)
	}
}

// TestClientClose verifies graceful shutdown.
func TestClientClose(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	if err := client.Close(); err != nil {
		t.Errorf("Close failed: %v", err)
	}

	if client.IsConnected() {
		t.Error("Expected client to be disconnected")
	}

	// Calls after close should fail
	promise := client.Call("square", 5.0)
	_, err = promise.Await()
	if err == nil {
		t.Error("Expected error after close")
	}
}

// TestTimeout verifies connection timeout.
func TestTimeout(t *testing.T) {
	client, err := Connect("ws://localhost:59999", WithTimeout(100*time.Millisecond))
	if err == nil {
		client.Close()
		t.Error("Expected connection to fail")
	}
}

// TestPipeline verifies pipeline execution.
func TestPipeline(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	pipe := NewPipeline(client)
	pipe.AddAs("a", "square", 3.0)
	pipe.AddAs("b", "square", 4.0)
	pipe.AddAs("c", "returnNumber", 5.0)

	if err := pipe.Execute(); err != nil {
		t.Fatalf("Pipeline failed: %v", err)
	}

	results, err := pipe.Results()
	if err != nil {
		t.Fatalf("Results failed: %v", err)
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

// TestProxy verifies proxy-based invocation.
func TestProxy(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	proxy := NewDynamicProxy(client)
	promise := proxy.Get("square").Call(7.0)

	result, err := promise.Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	if n, ok := toFloat64(result); !ok || n != 49.0 {
		t.Errorf("Expected 49, got %v", result)
	}
}

// TestMethodProxy verifies single-method proxy.
func TestMethodProxy(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	square := NewMethodProxy(client, "square")

	result, err := square.Call(6.0).Await()
	if err != nil {
		t.Fatalf("Call failed: %v", err)
	}

	if n, ok := toFloat64(result); !ok || n != 36.0 {
		t.Errorf("Expected 36, got %v", result)
	}
}

// TestCollection verifies collection operations.
func TestCollection(t *testing.T) {
	server := newMockServer()
	defer server.Close()

	client, err := Connect(server.URL())
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	source := client.Call("generateFibonacci", 6.0)
	coll := NewCollection[float64](client, source)

	count, err := coll.Count()
	if err != nil {
		t.Fatalf("Count failed: %v", err)
	}
	if count != 6 {
		t.Errorf("Expected count 6, got %d", count)
	}
}

// TestPromiseState verifies promise state transitions.
func TestPromiseState(t *testing.T) {
	p := newPromise(nil)

	if !p.IsPending() {
		t.Error("New promise should be pending")
	}

	p.resolve(42)

	if !p.IsFulfilled() {
		t.Error("Resolved promise should be fulfilled")
	}

	val, err := p.Await()
	if err != nil {
		t.Errorf("Await failed: %v", err)
	}
	if val != 42 {
		t.Errorf("Expected 42, got %v", val)
	}
}

// TestRejectedPromise verifies rejected promise behavior.
func TestRejectedPromise(t *testing.T) {
	p := newPromise(nil)
	testErr := &RPCError{Type: "TestError", Message: "test"}
	p.reject(testErr)

	if !p.IsRejected() {
		t.Error("Promise should be rejected")
	}

	_, err := p.Await()
	if err == nil {
		t.Error("Expected error")
	}
	if err != testErr {
		t.Errorf("Expected testErr, got %v", err)
	}
}
