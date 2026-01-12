// Package dotdo provides the official Go SDK for the DotDo platform.
//
// This package offers a high-level client for interacting with DotDo services,
// including authentication, connection pooling, automatic retries, and
// typed access to platform resources.
//
// Example:
//
//	client, err := dotdo.New(ctx, dotdo.Options{
//	    APIKey: os.Getenv("DOTDO_API_KEY"),
//	})
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
//
//	// Access a collection
//	users := client.Collection("users")
package dotdo

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Version is the current SDK version.
const Version = "0.1.0"

// DefaultEndpoint is the default DotDo API endpoint.
const DefaultEndpoint = "wss://api.dotdo.dev/rpc"

// ErrUnauthorized is returned when authentication fails.
var ErrUnauthorized = errors.New("dotdo: unauthorized")

// ErrRateLimited is returned when the API rate limit is exceeded.
var ErrRateLimited = errors.New("dotdo: rate limited")

// ErrConnectionFailed is returned when connection cannot be established.
var ErrConnectionFailed = errors.New("dotdo: connection failed")

// Options configures the DotDo client.
type Options struct {
	// APIKey is the API key for authentication.
	// Can also be set via DOTDO_API_KEY environment variable.
	APIKey string

	// Endpoint is the API endpoint URL.
	// Defaults to DefaultEndpoint if empty.
	Endpoint string

	// Timeout is the default timeout for operations.
	Timeout time.Duration

	// MaxRetries is the maximum number of retry attempts.
	MaxRetries int

	// RetryDelay is the initial delay between retries.
	RetryDelay time.Duration

	// PoolSize is the maximum number of concurrent connections.
	PoolSize int

	// Debug enables debug logging.
	Debug bool
}

// DefaultOptions returns Options with sensible defaults.
func DefaultOptions() Options {
	return Options{
		Endpoint:   DefaultEndpoint,
		Timeout:    30 * time.Second,
		MaxRetries: 3,
		RetryDelay: 100 * time.Millisecond,
		PoolSize:   10,
		Debug:      false,
	}
}

// DotDo is the main client for interacting with the DotDo platform.
type DotDo struct {
	options Options
	mu      sync.RWMutex
	pool    *connectionPool
	auth    *authManager
	ctx     context.Context
	cancel  context.CancelFunc
}

// New creates a new DotDo client with the given options.
//
// The client manages connection pooling, authentication, and automatic
// retries internally. Call Close() when done to release resources.
func New(ctx context.Context, opts Options) (*DotDo, error) {
	// Merge with defaults
	defaults := DefaultOptions()
	if opts.Endpoint == "" {
		opts.Endpoint = defaults.Endpoint
	}
	if opts.Timeout == 0 {
		opts.Timeout = defaults.Timeout
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = defaults.MaxRetries
	}
	if opts.RetryDelay == 0 {
		opts.RetryDelay = defaults.RetryDelay
	}
	if opts.PoolSize == 0 {
		opts.PoolSize = defaults.PoolSize
	}

	clientCtx, cancel := context.WithCancel(ctx)

	d := &DotDo{
		options: opts,
		ctx:     clientCtx,
		cancel:  cancel,
	}

	// Initialize auth manager
	d.auth = newAuthManager(opts.APIKey)

	// Initialize connection pool
	d.pool = newConnectionPool(opts.PoolSize)

	return d, nil
}

// Close terminates all connections and releases resources.
func (d *DotDo) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.cancel != nil {
		d.cancel()
	}

	if d.pool != nil {
		return d.pool.close()
	}

	return nil
}

// Collection returns a reference to a named collection.
func (d *DotDo) Collection(name string) *CollectionRef {
	return &CollectionRef{
		client: d,
		name:   name,
	}
}

// Call invokes a remote method on the platform.
func (d *DotDo) Call(ctx context.Context, method string, args ...any) (any, error) {
	return d.callWithRetry(ctx, method, args...)
}

// callWithRetry implements retry logic for RPC calls.
func (d *DotDo) callWithRetry(ctx context.Context, method string, args ...any) (any, error) {
	var lastErr error

	for attempt := 0; attempt <= d.options.MaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff
			delay := d.options.RetryDelay * time.Duration(1<<uint(attempt-1))
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		result, err := d.doCall(ctx, method, args...)
		if err == nil {
			return result, nil
		}

		lastErr = err

		// Don't retry on certain errors
		if errors.Is(err, ErrUnauthorized) {
			return nil, err
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
	}

	return nil, fmt.Errorf("dotdo: max retries exceeded: %w", lastErr)
}

// doCall performs a single RPC call.
func (d *DotDo) doCall(ctx context.Context, method string, args ...any) (any, error) {
	// TODO: Implement actual RPC call through connection pool
	return nil, errors.New("dotdo: not implemented")
}

// CollectionRef represents a reference to a collection on the platform.
type CollectionRef struct {
	client *DotDo
	name   string
}

// Get retrieves a document by ID.
func (c *CollectionRef) Get(ctx context.Context, id string) (map[string]any, error) {
	result, err := c.client.Call(ctx, "collection.get", c.name, id)
	if err != nil {
		return nil, err
	}
	if doc, ok := result.(map[string]any); ok {
		return doc, nil
	}
	return nil, errors.New("dotdo: unexpected response type")
}

// Set creates or updates a document.
func (c *CollectionRef) Set(ctx context.Context, id string, data map[string]any) error {
	_, err := c.client.Call(ctx, "collection.set", c.name, id, data)
	return err
}

// Delete removes a document by ID.
func (c *CollectionRef) Delete(ctx context.Context, id string) error {
	_, err := c.client.Call(ctx, "collection.delete", c.name, id)
	return err
}

// Query returns a query builder for this collection.
func (c *CollectionRef) Query() *QueryBuilder {
	return &QueryBuilder{
		collection: c,
		filters:    nil,
	}
}

// QueryBuilder constructs queries against a collection.
type QueryBuilder struct {
	collection *CollectionRef
	filters    []filter
	orderBy    string
	orderDesc  bool
	limitVal   int
	offsetVal  int
}

type filter struct {
	field string
	op    string
	value any
}

// Where adds a filter condition.
func (q *QueryBuilder) Where(field, op string, value any) *QueryBuilder {
	q.filters = append(q.filters, filter{field: field, op: op, value: value})
	return q
}

// OrderBy sets the sort order.
func (q *QueryBuilder) OrderBy(field string) *QueryBuilder {
	q.orderBy = field
	q.orderDesc = false
	return q
}

// OrderByDesc sets descending sort order.
func (q *QueryBuilder) OrderByDesc(field string) *QueryBuilder {
	q.orderBy = field
	q.orderDesc = true
	return q
}

// Limit sets the maximum number of results.
func (q *QueryBuilder) Limit(n int) *QueryBuilder {
	q.limitVal = n
	return q
}

// Offset sets the number of results to skip.
func (q *QueryBuilder) Offset(n int) *QueryBuilder {
	q.offsetVal = n
	return q
}

// Execute runs the query.
func (q *QueryBuilder) Execute(ctx context.Context) ([]map[string]any, error) {
	// TODO: Implement query execution
	return nil, errors.New("dotdo: query not implemented")
}

// First returns the first matching document.
func (q *QueryBuilder) First(ctx context.Context) (map[string]any, error) {
	q.limitVal = 1
	results, err := q.Execute(ctx)
	if err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, errors.New("dotdo: no documents found")
	}
	return results[0], nil
}

// connectionPool manages a pool of RPC connections.
type connectionPool struct {
	mu       sync.Mutex
	maxSize  int
	conns    []pooledConn
	closed   bool
}

type pooledConn struct {
	// TODO: Add actual connection type
	inUse bool
}

func newConnectionPool(size int) *connectionPool {
	return &connectionPool{
		maxSize: size,
		conns:   make([]pooledConn, 0, size),
	}
}

func (p *connectionPool) acquire(ctx context.Context) (*pooledConn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil, ErrConnectionFailed
	}

	// Find an available connection
	for i := range p.conns {
		if !p.conns[i].inUse {
			p.conns[i].inUse = true
			return &p.conns[i], nil
		}
	}

	// Create new connection if pool not full
	if len(p.conns) < p.maxSize {
		conn := pooledConn{inUse: true}
		p.conns = append(p.conns, conn)
		return &p.conns[len(p.conns)-1], nil
	}

	// TODO: Wait for available connection
	return nil, errors.New("dotdo: connection pool exhausted")
}

func (p *connectionPool) release(conn *pooledConn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn.inUse = false
}

func (p *connectionPool) close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.conns = nil
	return nil
}

// authManager handles authentication state and token refresh.
type authManager struct {
	mu     sync.RWMutex
	apiKey string
	token  string
	expiry time.Time
}

func newAuthManager(apiKey string) *authManager {
	return &authManager{
		apiKey: apiKey,
	}
}

// getToken returns a valid authentication token.
func (a *authManager) getToken(ctx context.Context) (string, error) {
	a.mu.RLock()
	if a.token != "" && time.Now().Before(a.expiry) {
		token := a.token
		a.mu.RUnlock()
		return token, nil
	}
	a.mu.RUnlock()

	return a.refreshToken(ctx)
}

// refreshToken obtains a new authentication token.
func (a *authManager) refreshToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// Check if another goroutine already refreshed
	if a.token != "" && time.Now().Before(a.expiry) {
		return a.token, nil
	}

	if a.apiKey == "" {
		return "", ErrUnauthorized
	}

	// TODO: Implement actual token exchange
	// For now, use API key directly
	a.token = a.apiKey
	a.expiry = time.Now().Add(1 * time.Hour)

	return a.token, nil
}
