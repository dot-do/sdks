package dotdo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// mockServer creates a WebSocket server for testing.
func mockServer(t *testing.T, handler func(conn *websocket.Conn)) *httptest.Server {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("Failed to upgrade connection: %v", err)
			return
		}
		defer conn.Close()
		handler(conn)
	}))

	return server
}

// wsURL converts http URL to ws URL.
func wsURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}

func TestNew(t *testing.T) {
	ctx := context.Background()

	t.Run("default options", func(t *testing.T) {
		client, err := New(ctx, Options{APIKey: "test-key"})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		defer client.Close()

		if client.options.Endpoint != DefaultEndpoint {
			t.Errorf("Expected endpoint %q, got %q", DefaultEndpoint, client.options.Endpoint)
		}
		if client.options.PoolSize != 10 {
			t.Errorf("Expected pool size 10, got %d", client.options.PoolSize)
		}
	})

	t.Run("custom options", func(t *testing.T) {
		client, err := New(ctx, Options{
			APIKey:     "test-key",
			Endpoint:   "wss://custom.endpoint/rpc",
			PoolSize:   5,
			MaxRetries: 5,
		})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		defer client.Close()

		if client.options.Endpoint != "wss://custom.endpoint/rpc" {
			t.Errorf("Expected custom endpoint, got %q", client.options.Endpoint)
		}
		if client.options.PoolSize != 5 {
			t.Errorf("Expected pool size 5, got %d", client.options.PoolSize)
		}
		if client.options.MaxRetries != 5 {
			t.Errorf("Expected max retries 5, got %d", client.options.MaxRetries)
		}
	})
}

func TestConnectionPool(t *testing.T) {
	t.Run("acquire and release", func(t *testing.T) {
		pool := newConnectionPool(2)
		ctx := context.Background()

		// Acquire first connection
		conn1, err := pool.acquire(ctx)
		if err != nil {
			t.Fatalf("acquire() error = %v", err)
		}
		if conn1 == nil {
			t.Fatal("Expected non-nil connection")
		}

		// Acquire second connection
		conn2, err := pool.acquire(ctx)
		if err != nil {
			t.Fatalf("acquire() error = %v", err)
		}
		if conn2 == nil {
			t.Fatal("Expected non-nil connection")
		}

		// Release first connection
		pool.release(conn1)

		// Should be able to acquire again
		conn3, err := pool.acquire(ctx)
		if err != nil {
			t.Fatalf("acquire() error = %v", err)
		}
		if conn3 != conn1 {
			t.Error("Expected to reuse released connection")
		}

		pool.close()
	})

	t.Run("pool exhaustion with context timeout", func(t *testing.T) {
		pool := newConnectionPool(1)
		ctx := context.Background()

		// Acquire only connection
		conn, err := pool.acquire(ctx)
		if err != nil {
			t.Fatalf("acquire() error = %v", err)
		}

		// Try to acquire with timeout - should fail
		timeoutCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		defer cancel()

		_, err = pool.acquire(timeoutCtx)
		if err == nil {
			t.Error("Expected error from exhausted pool")
		}

		pool.release(conn)
		pool.close()
	})

	t.Run("concurrent access", func(t *testing.T) {
		pool := newConnectionPool(5)
		ctx := context.Background()

		var wg sync.WaitGroup
		errors := make(chan error, 10)

		for i := 0; i < 10; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				conn, err := pool.acquire(ctx)
				if err != nil {
					errors <- err
					return
				}
				// Simulate some work
				time.Sleep(10 * time.Millisecond)
				pool.release(conn)
			}()
		}

		wg.Wait()
		close(errors)

		for err := range errors {
			t.Errorf("Concurrent acquire error: %v", err)
		}

		pool.close()
	})

	t.Run("close pool", func(t *testing.T) {
		pool := newConnectionPool(2)
		ctx := context.Background()

		conn, _ := pool.acquire(ctx)
		pool.release(conn)

		if err := pool.close(); err != nil {
			t.Errorf("close() error = %v", err)
		}

		// Should fail to acquire after close
		_, err := pool.acquire(ctx)
		if err != ErrConnectionFailed {
			t.Errorf("Expected ErrConnectionFailed, got %v", err)
		}
	})
}

func TestAuthManager(t *testing.T) {
	t.Run("get token with API key", func(t *testing.T) {
		auth := newAuthManager("test-api-key")
		ctx := context.Background()

		token, err := auth.getToken(ctx)
		if err != nil {
			t.Fatalf("getToken() error = %v", err)
		}
		if token != "test-api-key" {
			t.Errorf("Expected token 'test-api-key', got %q", token)
		}
	})

	t.Run("get token without API key", func(t *testing.T) {
		auth := newAuthManager("")
		ctx := context.Background()

		_, err := auth.getToken(ctx)
		if err != ErrUnauthorized {
			t.Errorf("Expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("token caching", func(t *testing.T) {
		auth := newAuthManager("test-api-key")
		ctx := context.Background()

		// Get token first time
		token1, _ := auth.getToken(ctx)

		// Get token second time - should use cache
		token2, _ := auth.getToken(ctx)

		if token1 != token2 {
			t.Error("Expected cached token to be returned")
		}
	})

	t.Run("invalidate token", func(t *testing.T) {
		auth := newAuthManager("test-api-key")
		ctx := context.Background()

		auth.getToken(ctx)
		auth.invalidate()

		if auth.token != "" {
			t.Error("Expected token to be cleared after invalidate")
		}
	})

	t.Run("set token manually", func(t *testing.T) {
		auth := newAuthManager("api-key")
		expiry := time.Now().Add(2 * time.Hour)

		auth.setToken("custom-token", expiry)
		ctx := context.Background()

		token, _ := auth.getToken(ctx)
		if token != "custom-token" {
			t.Errorf("Expected 'custom-token', got %q", token)
		}
	})
}

func TestQueryBuilder(t *testing.T) {
	t.Run("build query with filters", func(t *testing.T) {
		ctx := context.Background()

		// Create a mock server that echoes back the query
		server := mockServer(t, func(conn *websocket.Conn) {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var msg rpcMessage
			json.Unmarshal(data, &msg)

			// Return empty results
			response := rpcMessage{
				ID:     msg.ID,
				Type:   "return",
				Result: []any{},
			}
			respData, _ := json.Marshal(response)
			conn.WriteMessage(websocket.TextMessage, respData)
		})
		defer server.Close()

		client, err := New(ctx, Options{
			APIKey:   "test-key",
			Endpoint: wsURL(server.URL),
		})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		defer client.Close()

		// Build a query
		query := client.Collection("users").Query().
			Where("age", ">", 18).
			Where("status", "==", "active").
			OrderBy("name").
			Limit(10).
			Offset(5)

		// Verify query builder state
		if len(query.filters) != 2 {
			t.Errorf("Expected 2 filters, got %d", len(query.filters))
		}
		if query.orderBy != "name" {
			t.Errorf("Expected orderBy 'name', got %q", query.orderBy)
		}
		if query.limitVal != 10 {
			t.Errorf("Expected limit 10, got %d", query.limitVal)
		}
		if query.offsetVal != 5 {
			t.Errorf("Expected offset 5, got %d", query.offsetVal)
		}
	})

	t.Run("order by descending", func(t *testing.T) {
		ctx := context.Background()
		client, _ := New(ctx, Options{APIKey: "test-key"})
		defer client.Close()

		query := client.Collection("users").Query().
			OrderByDesc("createdAt")

		if query.orderBy != "createdAt" {
			t.Errorf("Expected orderBy 'createdAt', got %q", query.orderBy)
		}
		if !query.orderDesc {
			t.Error("Expected orderDesc to be true")
		}
	})
}

func TestRPCMessage(t *testing.T) {
	t.Run("serialize message", func(t *testing.T) {
		msg := rpcMessage{
			ID:     1,
			Type:   "call",
			Method: "test.method",
			Args:   []any{"arg1", 42},
		}

		data, err := json.Marshal(msg)
		if err != nil {
			t.Fatalf("Marshal error: %v", err)
		}

		var decoded rpcMessage
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("Unmarshal error: %v", err)
		}

		if decoded.ID != msg.ID {
			t.Errorf("ID mismatch: got %d, want %d", decoded.ID, msg.ID)
		}
		if decoded.Type != msg.Type {
			t.Errorf("Type mismatch: got %q, want %q", decoded.Type, msg.Type)
		}
		if decoded.Method != msg.Method {
			t.Errorf("Method mismatch: got %q, want %q", decoded.Method, msg.Method)
		}
	})

	t.Run("rpc error", func(t *testing.T) {
		err := &rpcError{
			Type:    "ValidationError",
			Message: "Invalid input",
			Code:    "INVALID_INPUT",
		}

		errStr := err.Error()
		if !strings.Contains(errStr, "ValidationError") {
			t.Errorf("Error string should contain type: %q", errStr)
		}
		if !strings.Contains(errStr, "Invalid input") {
			t.Errorf("Error string should contain message: %q", errStr)
		}
	})
}

func TestCallWithRetry(t *testing.T) {
	t.Run("successful call", func(t *testing.T) {
		ctx := context.Background()

		callCount := 0
		server := mockServer(t, func(conn *websocket.Conn) {
			for {
				_, data, err := conn.ReadMessage()
				if err != nil {
					return
				}
				callCount++

				var msg rpcMessage
				json.Unmarshal(data, &msg)

				response := rpcMessage{
					ID:     msg.ID,
					Type:   "return",
					Result: map[string]any{"success": true},
				}
				respData, _ := json.Marshal(response)
				conn.WriteMessage(websocket.TextMessage, respData)
			}
		})
		defer server.Close()

		client, err := New(ctx, Options{
			APIKey:   "test-key",
			Endpoint: wsURL(server.URL),
		})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		defer client.Close()

		result, err := client.Call(ctx, "test.method", "arg1")
		if err != nil {
			t.Fatalf("Call() error = %v", err)
		}

		if result == nil {
			t.Error("Expected non-nil result")
		}
	})

	t.Run("context cancellation", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())

		// Create server that delays response
		server := mockServer(t, func(conn *websocket.Conn) {
			time.Sleep(500 * time.Millisecond)
		})
		defer server.Close()

		client, err := New(ctx, Options{
			APIKey:   "test-key",
			Endpoint: wsURL(server.URL),
		})
		if err != nil {
			t.Fatalf("New() error = %v", err)
		}
		defer client.Close()

		// Cancel context before call completes
		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		_, err = client.Call(ctx, "test.method")
		if err == nil {
			t.Error("Expected error from cancelled context")
		}
	})
}

func TestCollection(t *testing.T) {
	ctx := context.Background()

	server := mockServer(t, func(conn *websocket.Conn) {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var msg rpcMessage
			json.Unmarshal(data, &msg)

			var result any
			switch msg.Method {
			case "collection.get":
				result = map[string]any{
					"id":   "123",
					"name": "Test User",
				}
			case "collection.set":
				result = map[string]any{"success": true}
			case "collection.delete":
				result = map[string]any{"deleted": true}
			default:
				result = nil
			}

			response := rpcMessage{
				ID:     msg.ID,
				Type:   "return",
				Result: result,
			}
			respData, _ := json.Marshal(response)
			conn.WriteMessage(websocket.TextMessage, respData)
		}
	})
	defer server.Close()

	client, err := New(ctx, Options{
		APIKey:   "test-key",
		Endpoint: wsURL(server.URL),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	defer client.Close()

	t.Run("get document", func(t *testing.T) {
		users := client.Collection("users")
		doc, err := users.Get(ctx, "123")
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if doc["id"] != "123" {
			t.Errorf("Expected id '123', got %v", doc["id"])
		}
	})

	t.Run("set document", func(t *testing.T) {
		users := client.Collection("users")
		err := users.Set(ctx, "123", map[string]any{
			"name": "Updated User",
		})
		if err != nil {
			t.Fatalf("Set() error = %v", err)
		}
	})

	t.Run("delete document", func(t *testing.T) {
		users := client.Collection("users")
		err := users.Delete(ctx, "123")
		if err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
	})
}

func TestDefaultOptions(t *testing.T) {
	opts := DefaultOptions()

	if opts.Endpoint != DefaultEndpoint {
		t.Errorf("Expected endpoint %q, got %q", DefaultEndpoint, opts.Endpoint)
	}
	if opts.Timeout != 30*time.Second {
		t.Errorf("Expected timeout 30s, got %v", opts.Timeout)
	}
	if opts.MaxRetries != 3 {
		t.Errorf("Expected max retries 3, got %d", opts.MaxRetries)
	}
	if opts.RetryDelay != 100*time.Millisecond {
		t.Errorf("Expected retry delay 100ms, got %v", opts.RetryDelay)
	}
	if opts.PoolSize != 10 {
		t.Errorf("Expected pool size 10, got %d", opts.PoolSize)
	}
}

func TestPooledConn(t *testing.T) {
	t.Run("new pooled conn", func(t *testing.T) {
		conn := newPooledConn()
		if conn == nil {
			t.Fatal("Expected non-nil connection")
		}
		if conn.pending == nil {
			t.Error("Expected pending map to be initialized")
		}
		if conn.ws != nil {
			t.Error("Expected ws to be nil initially")
		}
	})

	t.Run("send without connection", func(t *testing.T) {
		conn := newPooledConn()
		err := conn.sendMessage(rpcMessage{Type: "test"})
		if err == nil {
			t.Error("Expected error when sending without connection")
		}
	})

	t.Run("read without connection", func(t *testing.T) {
		conn := newPooledConn()
		var msg rpcMessage
		err := conn.readMessage(&msg)
		if err == nil {
			t.Error("Expected error when reading without connection")
		}
	})
}
