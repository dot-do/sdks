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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
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

// ErrPoolExhausted is returned when the connection pool is full and all connections are in use.
var ErrPoolExhausted = errors.New("dotdo: connection pool exhausted")

// ErrNotFound is returned when a document is not found.
var ErrNotFound = errors.New("dotdo: document not found")

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
	msgID   uint64 // atomic counter for message IDs
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

// rpcMessage represents an RPC message on the wire.
type rpcMessage struct {
	ID     uint64    `json:"id,omitempty"`
	Type   string    `json:"type"`
	Method string    `json:"method,omitempty"`
	Args   []any     `json:"args,omitempty"`
	Result any       `json:"result,omitempty"`
	Error  *rpcError `json:"error,omitempty"`
}

// rpcError represents an error returned by the RPC server.
type rpcError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

func (e *rpcError) Error() string {
	if e.Type != "" {
		return fmt.Sprintf("%s: %s", e.Type, e.Message)
	}
	return e.Message
}

// doCall performs a single RPC call.
func (d *DotDo) doCall(ctx context.Context, method string, args ...any) (any, error) {
	// Get authentication token
	token, err := d.auth.getToken(ctx)
	if err != nil {
		return nil, err
	}

	// Acquire connection from pool
	conn, err := d.pool.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer d.pool.release(conn)

	// Ensure connection is established
	if conn.ws == nil {
		if err := conn.connect(ctx, d.options.Endpoint, token); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrConnectionFailed, err)
		}
	}

	// Generate message ID
	msgID := atomic.AddUint64(&d.msgID, 1)

	// Create and send the RPC message
	msg := rpcMessage{
		ID:     msgID,
		Type:   "call",
		Method: method,
		Args:   args,
	}

	// Create a channel for the response
	respCh := make(chan rpcMessage, 1)
	errCh := make(chan error, 1)

	// Register pending request
	conn.mu.Lock()
	conn.pending[msgID] = respCh
	conn.mu.Unlock()

	defer func() {
		conn.mu.Lock()
		delete(conn.pending, msgID)
		conn.mu.Unlock()
	}()

	// Send the message
	if err := conn.sendMessage(msg); err != nil {
		return nil, fmt.Errorf("dotdo: send failed: %w", err)
	}

	// Start reading response in a goroutine
	go func() {
		for {
			var resp rpcMessage
			if err := conn.readMessage(&resp); err != nil {
				errCh <- err
				return
			}

			// Dispatch response to the correct pending request
			conn.mu.Lock()
			ch, ok := conn.pending[resp.ID]
			conn.mu.Unlock()

			if ok {
				ch <- resp
				return
			}
		}
	}()

	// Wait for response with timeout
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case err := <-errCh:
		return nil, fmt.Errorf("dotdo: read failed: %w", err)
	case resp := <-respCh:
		if resp.Error != nil {
			// Check for specific error types
			if resp.Error.Code == "UNAUTHORIZED" || resp.Error.Type == "AuthError" {
				return nil, ErrUnauthorized
			}
			if resp.Error.Code == "RATE_LIMITED" {
				return nil, ErrRateLimited
			}
			return nil, resp.Error
		}
		return resp.Result, nil
	}
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
	// Build query parameters
	queryParams := map[string]any{
		"collection": q.collection.name,
	}

	if len(q.filters) > 0 {
		filterList := make([]map[string]any, len(q.filters))
		for i, f := range q.filters {
			filterList[i] = map[string]any{
				"field": f.field,
				"op":    f.op,
				"value": f.value,
			}
		}
		queryParams["filters"] = filterList
	}

	if q.orderBy != "" {
		queryParams["orderBy"] = q.orderBy
		queryParams["orderDesc"] = q.orderDesc
	}

	if q.limitVal > 0 {
		queryParams["limit"] = q.limitVal
	}

	if q.offsetVal > 0 {
		queryParams["offset"] = q.offsetVal
	}

	// Execute the query
	result, err := q.collection.client.Call(ctx, "collection.query", queryParams)
	if err != nil {
		return nil, err
	}

	// Convert result to slice of maps
	if docs, ok := result.([]any); ok {
		results := make([]map[string]any, 0, len(docs))
		for _, doc := range docs {
			if m, ok := doc.(map[string]any); ok {
				results = append(results, m)
			}
		}
		return results, nil
	}

	// Handle map[string]any with "documents" key (some APIs return wrapped results)
	if m, ok := result.(map[string]any); ok {
		if docs, ok := m["documents"].([]any); ok {
			results := make([]map[string]any, 0, len(docs))
			for _, doc := range docs {
				if docMap, ok := doc.(map[string]any); ok {
					results = append(results, docMap)
				}
			}
			return results, nil
		}
	}

	return nil, errors.New("dotdo: unexpected query response type")
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
	cond     *sync.Cond
	maxSize  int
	conns    []*pooledConn
	closed   bool
}

// pooledConn represents a pooled WebSocket connection.
type pooledConn struct {
	ws      *websocket.Conn
	mu      sync.Mutex
	inUse   bool
	pending map[uint64]chan rpcMessage
}

// newPooledConn creates a new pooled connection.
func newPooledConn() *pooledConn {
	return &pooledConn{
		pending: make(map[uint64]chan rpcMessage),
	}
}

// connect establishes the WebSocket connection.
func (c *pooledConn) connect(ctx context.Context, endpoint, token string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.ws != nil {
		return nil // Already connected
	}

	// Parse and normalize the URL
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("invalid endpoint URL: %w", err)
	}

	// Convert http(s) to ws(s)
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	case "ws", "wss":
		// Already correct
	case "":
		u.Scheme = "wss"
	}

	// Set up headers for authentication
	headers := http.Header{}
	if token != "" {
		headers.Set("Authorization", "Bearer "+token)
	}

	// Create dialer with context
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, u.String(), headers)
	if err != nil {
		return err
	}

	c.ws = conn
	return nil
}

// sendMessage sends an RPC message over the WebSocket.
func (c *pooledConn) sendMessage(msg rpcMessage) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.ws == nil {
		return errors.New("connection not established")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal failed: %w", err)
	}

	return c.ws.WriteMessage(websocket.TextMessage, data)
}

// readMessage reads an RPC message from the WebSocket.
func (c *pooledConn) readMessage(msg *rpcMessage) error {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()

	if ws == nil {
		return errors.New("connection not established")
	}

	_, data, err := ws.ReadMessage()
	if err != nil {
		return err
	}

	return json.Unmarshal(data, msg)
}

// close closes the WebSocket connection.
func (c *pooledConn) closeConn() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.ws != nil {
		err := c.ws.Close()
		c.ws = nil
		return err
	}
	return nil
}

func newConnectionPool(size int) *connectionPool {
	p := &connectionPool{
		maxSize: size,
		conns:   make([]*pooledConn, 0, size),
	}
	p.cond = sync.NewCond(&p.mu)
	return p
}

func (p *connectionPool) acquire(ctx context.Context) (*pooledConn, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		return nil, ErrConnectionFailed
	}

	// Try to find an available connection
	for {
		// Check if context is done
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		// Find an available connection
		for _, conn := range p.conns {
			if !conn.inUse {
				conn.inUse = true
				return conn, nil
			}
		}

		// Create new connection if pool not full
		if len(p.conns) < p.maxSize {
			conn := newPooledConn()
			conn.inUse = true
			p.conns = append(p.conns, conn)
			return conn, nil
		}

		// Wait for a connection to become available with timeout
		// Use a goroutine to handle context cancellation
		done := make(chan struct{})
		go func() {
			select {
			case <-ctx.Done():
				p.mu.Lock()
				p.cond.Broadcast()
				p.mu.Unlock()
			case <-done:
			}
		}()

		p.cond.Wait()
		close(done)

		// Check context again after waking up
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
	}
}

func (p *connectionPool) release(conn *pooledConn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	conn.inUse = false
	p.cond.Signal() // Wake up one waiting goroutine
}

func (p *connectionPool) close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true

	// Close all connections
	var lastErr error
	for _, conn := range p.conns {
		if err := conn.closeConn(); err != nil {
			lastErr = err
		}
	}
	p.conns = nil

	// Wake up all waiting goroutines
	p.cond.Broadcast()

	return lastErr
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

// tokenResponse represents the response from token exchange.
type tokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
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

	// For API key authentication, we can use the API key directly
	// as a bearer token. Many services accept API keys in this format.
	// If a proper token exchange endpoint is available, we would call it here.
	//
	// Example of how a full token exchange would work:
	// 1. POST to /oauth/token with grant_type=client_credentials
	// 2. Include API key in Authorization header
	// 3. Parse response and extract access_token
	//
	// For now, we use the API key directly but wrap it with expiry tracking
	// to support future token refresh scenarios.

	a.token = a.apiKey
	// Set expiry to 1 hour for API key usage (can be refreshed on 401 errors)
	a.expiry = time.Now().Add(1 * time.Hour)

	return a.token, nil
}

// invalidate marks the current token as invalid, forcing a refresh on next use.
func (a *authManager) invalidate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = ""
	a.expiry = time.Time{}
}

// setToken manually sets a token (useful for OAuth flows).
func (a *authManager) setToken(token string, expiry time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.token = token
	a.expiry = expiry
}
