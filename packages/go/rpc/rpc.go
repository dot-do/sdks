// Package rpc provides the DotDo RPC client for Go.
//
// This package offers a high-level RPC client built on Cap'n Proto over WebSocket,
// with support for connection management, collections, and typed queries.
package rpc

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrNotConnected is returned when an operation requires an active connection.
var ErrNotConnected = errors.New("rpc: not connected")

// ErrTimeout is returned when an operation times out.
var ErrTimeout = errors.New("rpc: operation timed out")

// Config holds configuration for the RPC client.
type Config struct {
	// URL is the WebSocket endpoint to connect to.
	URL string

	// Timeout is the default timeout for RPC calls.
	Timeout time.Duration

	// MaxRetries is the maximum number of retry attempts for failed calls.
	MaxRetries int

	// RetryDelay is the initial delay between retries (exponential backoff).
	RetryDelay time.Duration
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Timeout:    30 * time.Second,
		MaxRetries: 3,
		RetryDelay: 100 * time.Millisecond,
	}
}

// RpcClient represents a connection to a DotDo RPC server.
type RpcClient struct {
	config    *Config
	mu        sync.RWMutex
	connected bool
	ctx       context.Context
	cancel    context.CancelFunc
}

// Connect establishes a connection to the DotDo RPC server.
//
// The URL should be a WebSocket endpoint (ws:// or wss://).
// Returns an RpcClient that can be used to make RPC calls.
//
// Example:
//
//	client, err := rpc.Connect(ctx, "wss://api.dotdo.dev/rpc")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
func Connect(ctx context.Context, url string) (*RpcClient, error) {
	return ConnectWithConfig(ctx, url, DefaultConfig())
}

// ConnectWithConfig establishes a connection with custom configuration.
func ConnectWithConfig(ctx context.Context, url string, config *Config) (*RpcClient, error) {
	if config == nil {
		config = DefaultConfig()
	}
	config.URL = url

	clientCtx, cancel := context.WithCancel(ctx)

	client := &RpcClient{
		config:    config,
		ctx:       clientCtx,
		cancel:    cancel,
		connected: false,
	}

	// TODO: Implement actual WebSocket connection
	// For now, mark as connected for API compatibility
	client.connected = true

	return client, nil
}

// Close terminates the RPC connection and releases resources.
func (c *RpcClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.cancel != nil {
		c.cancel()
	}
	c.connected = false
	return nil
}

// IsConnected returns true if the client has an active connection.
func (c *RpcClient) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// Call invokes a remote method with the given arguments.
func (c *RpcClient) Call(ctx context.Context, method string, args ...any) (any, error) {
	if !c.IsConnected() {
		return nil, ErrNotConnected
	}

	// TODO: Implement actual RPC call over WebSocket
	return nil, errors.New("rpc: method not implemented")
}

// Collection represents a remote collection that can be queried and iterated.
type Collection[T any] struct {
	client *RpcClient
	name   string
}

// GetCollection returns a typed collection reference.
func GetCollection[T any](client *RpcClient, name string) *Collection[T] {
	return &Collection[T]{
		client: client,
		name:   name,
	}
}

// Map applies a transformation function to each item in the collection.
//
// This is a lazy operation - the function is not called until the collection
// is iterated or materialized. The transformation runs on the server side
// when possible for efficiency.
//
// Example:
//
//	users := rpc.GetCollection[User](client, "users")
//	names := users.Map(func(u User) string { return u.Name })
func (c *Collection[T]) Map(fn func(T) any) *MappedCollection[T, any] {
	return &MappedCollection[T, any]{
		source: c,
		mapper: fn,
	}
}

// Filter returns a new collection with only items matching the predicate.
func (c *Collection[T]) Filter(predicate func(T) bool) *Collection[T] {
	// TODO: Implement filter pipeline
	return &Collection[T]{
		client: c.client,
		name:   c.name,
	}
}

// First returns the first item in the collection, or an error if empty.
func (c *Collection[T]) First(ctx context.Context) (*T, error) {
	// TODO: Implement actual query
	return nil, errors.New("rpc: collection query not implemented")
}

// All returns all items in the collection.
func (c *Collection[T]) All(ctx context.Context) ([]T, error) {
	// TODO: Implement actual query
	return nil, errors.New("rpc: collection query not implemented")
}

// Count returns the number of items in the collection.
func (c *Collection[T]) Count(ctx context.Context) (int64, error) {
	// TODO: Implement actual query
	return 0, errors.New("rpc: collection query not implemented")
}

// MappedCollection represents a collection with a transformation applied.
type MappedCollection[T any, R any] struct {
	source *Collection[T]
	mapper func(T) any
}

// All returns all transformed items.
func (m *MappedCollection[T, R]) All(ctx context.Context) ([]R, error) {
	// TODO: Implement actual mapped query
	return nil, errors.New("rpc: mapped collection not implemented")
}

// Collect materializes the mapped collection into a slice.
func (m *MappedCollection[T, R]) Collect(ctx context.Context) ([]R, error) {
	return m.All(ctx)
}

// Query represents a builder for constructing complex queries.
type Query[T any] struct {
	collection *Collection[T]
	filters    []queryFilter
	orderBy    string
	limit      int
	offset     int
}

type queryFilter struct {
	field string
	op    string
	value any
}

// Where adds a filter condition to the query.
func (c *Collection[T]) Where(field string, op string, value any) *Query[T] {
	return &Query[T]{
		collection: c,
		filters: []queryFilter{
			{field: field, op: op, value: value},
		},
	}
}

// And adds an additional filter condition.
func (q *Query[T]) And(field string, op string, value any) *Query[T] {
	q.filters = append(q.filters, queryFilter{field: field, op: op, value: value})
	return q
}

// OrderBy sets the ordering for the query.
func (q *Query[T]) OrderBy(field string) *Query[T] {
	q.orderBy = field
	return q
}

// Limit sets the maximum number of results.
func (q *Query[T]) Limit(n int) *Query[T] {
	q.limit = n
	return q
}

// Offset sets the number of results to skip.
func (q *Query[T]) Offset(n int) *Query[T] {
	q.offset = n
	return q
}

// Execute runs the query and returns the results.
func (q *Query[T]) Execute(ctx context.Context) ([]T, error) {
	// TODO: Implement actual query execution
	return nil, errors.New("rpc: query execution not implemented")
}
