package rpc

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

	"nhooyr.io/websocket"
)

// ErrNotConnected is returned when an operation requires an active connection.
var ErrNotConnected = errors.New("rpc: not connected")

// ErrConnectionClosed is returned when the connection has been closed.
var ErrConnectionClosed = errors.New("rpc: connection closed")

// ErrTimeout is returned when an operation times out.
var ErrTimeout = errors.New("rpc: operation timed out")

// RPCError represents an error returned by the RPC server.
type RPCError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Code    string `json:"code,omitempty"`
}

func (e *RPCError) Error() string {
	if e.Type != "" {
		return fmt.Sprintf("%s: %s", e.Type, e.Message)
	}
	return e.Message
}

// Option configures the Client.
type Option func(*clientConfig)

type clientConfig struct {
	timeout        time.Duration
	headers        http.Header
	dialOptions    *websocket.DialOptions
	reconnect      bool
	maxReconnects  int
	reconnectDelay time.Duration
}

// WithTimeout sets the default timeout for RPC calls.
func WithTimeout(d time.Duration) Option {
	return func(c *clientConfig) {
		c.timeout = d
	}
}

// WithHeaders sets custom headers for the WebSocket connection.
func WithHeaders(headers http.Header) Option {
	return func(c *clientConfig) {
		c.headers = headers
	}
}

// WithDialOptions sets custom dial options for nhooyr.io/websocket.
func WithDialOptions(opts *websocket.DialOptions) Option {
	return func(c *clientConfig) {
		c.dialOptions = opts
	}
}

// WithReconnect enables automatic reconnection.
func WithReconnect(maxAttempts int, delay time.Duration) Option {
	return func(c *clientConfig) {
		c.reconnect = true
		c.maxReconnects = maxAttempts
		c.reconnectDelay = delay
	}
}

// Client represents an RPC connection to a DotDo service.
type Client struct {
	config      clientConfig
	url         string
	conn        *websocket.Conn
	mu          sync.RWMutex
	connected   bool
	closed      bool
	ctx         context.Context
	cancel      context.CancelFunc
	msgID       uint64
	pending     map[uint64]*pendingRequest
	pendingMu   sync.Mutex
	exports     map[string]any
	exportsMu   sync.RWMutex
	caps        map[string]*Capability
	capsMu      sync.RWMutex
	selfRef     *Client
	roundTrips  int32
}

// pendingRequest tracks an in-flight RPC request.
type pendingRequest struct {
	promise *Promise
	sentAt  time.Time
}

// rpcMessage is the wire format for RPC messages.
type rpcMessage struct {
	ID      uint64    `json:"id,omitempty"`
	Type    string    `json:"type"`
	Method  string    `json:"method,omitempty"`
	Target  string    `json:"target,omitempty"`
	Args    []any     `json:"args,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *RPCError `json:"error,omitempty"`
	CapID   string    `json:"capId,omitempty"`
}

// Connect establishes a WebSocket connection to the RPC server.
//
// Example:
//
//	client, err := rpc.Connect("wss://api.example.do")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
func Connect(service string, opts ...Option) (*Client, error) {
	return ConnectContext(context.Background(), service, opts...)
}

// ConnectContext establishes a connection with a context.
func ConnectContext(ctx context.Context, service string, opts ...Option) (*Client, error) {
	// Parse and normalize the URL
	u, err := normalizeURL(service)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	// Apply options
	config := clientConfig{
		timeout:        30 * time.Second,
		reconnectDelay: time.Second,
		maxReconnects:  3,
	}
	for _, opt := range opts {
		opt(&config)
	}

	// Create client
	clientCtx, cancel := context.WithCancel(ctx)
	client := &Client{
		config:   config,
		url:      u,
		ctx:      clientCtx,
		cancel:   cancel,
		pending:  make(map[uint64]*pendingRequest),
		exports:  make(map[string]any),
		caps:     make(map[string]*Capability),
	}
	client.selfRef = client

	// Connect with timeout
	dialCtx := clientCtx
	if config.timeout > 0 {
		var dialCancel context.CancelFunc
		dialCtx, dialCancel = context.WithTimeout(clientCtx, config.timeout)
		defer dialCancel()
	}

	if err := client.connect(dialCtx); err != nil {
		cancel()
		return nil, err
	}

	// Start message receiver
	go client.receiveLoop()

	return client, nil
}

// normalizeURL converts a service URL to a WebSocket URL.
func normalizeURL(service string) (string, error) {
	u, err := url.Parse(service)
	if err != nil {
		return "", err
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
		// Default to wss
		u.Scheme = "wss"
	default:
		return "", fmt.Errorf("unsupported scheme: %s", u.Scheme)
	}

	return u.String(), nil
}

// connect establishes the WebSocket connection.
func (c *Client) connect(ctx context.Context) error {
	dialOpts := c.config.dialOptions
	if dialOpts == nil {
		dialOpts = &websocket.DialOptions{}
	}
	if c.config.headers != nil {
		dialOpts.HTTPHeader = c.config.headers
	}

	conn, _, err := websocket.Dial(ctx, c.url, dialOpts)
	if err != nil {
		return fmt.Errorf("dial failed: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.connected = true
	c.mu.Unlock()

	return nil
}

// receiveLoop handles incoming messages.
func (c *Client) receiveLoop() {
	defer func() {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
	}()

	for {
		select {
		case <-c.ctx.Done():
			return
		default:
		}

		_, data, err := c.conn.Read(c.ctx)
		if err != nil {
			closeStatus := websocket.CloseStatus(err)
			if closeStatus == websocket.StatusNormalClosure ||
				closeStatus == websocket.StatusGoingAway {
				return
			}
			if c.config.reconnect && !c.closed {
				c.tryReconnect()
				continue
			}
			return
		}

		var msg rpcMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // Skip malformed messages
		}

		c.handleMessage(msg)
	}
}

// handleMessage processes an incoming RPC message.
func (c *Client) handleMessage(msg rpcMessage) {
	switch msg.Type {
	case "return", "result":
		c.handleReturn(msg)
	case "call":
		c.handleCall(msg)
	case "error":
		c.handleError(msg)
	}
}

// handleReturn processes a method return message.
func (c *Client) handleReturn(msg rpcMessage) {
	c.pendingMu.Lock()
	req, ok := c.pending[msg.ID]
	if ok {
		delete(c.pending, msg.ID)
	}
	c.pendingMu.Unlock()

	if !ok {
		return // Unknown request ID
	}

	if msg.Error != nil {
		req.promise.reject(msg.Error)
	} else {
		// Check if result is a capability reference
		if msg.CapID != "" {
			cap := newCapability(c, msg.CapID)
			c.capsMu.Lock()
			c.caps[msg.CapID] = cap
			c.capsMu.Unlock()
			req.promise.resolve(cap)
		} else {
			req.promise.resolve(msg.Result)
		}
	}
}

// handleCall processes an incoming RPC call (bidirectional RPC).
func (c *Client) handleCall(msg rpcMessage) {
	c.exportsMu.RLock()
	export, ok := c.exports[msg.Method]
	c.exportsMu.RUnlock()

	var response rpcMessage
	response.ID = msg.ID
	response.Type = "return"

	if !ok {
		response.Error = &RPCError{
			Type:    "Error",
			Message: fmt.Sprintf("method %q not exported", msg.Method),
		}
	} else {
		// Call the exported function
		if fn, ok := export.(func(any) any); ok {
			var arg any
			if len(msg.Args) > 0 {
				arg = msg.Args[0]
			}
			result := fn(arg)
			response.Result = result
		} else {
			response.Error = &RPCError{
				Type:    "Error",
				Message: "invalid export type",
			}
		}
	}

	c.sendMessage(response)
}

// handleError processes an error message.
func (c *Client) handleError(msg rpcMessage) {
	c.pendingMu.Lock()
	req, ok := c.pending[msg.ID]
	if ok {
		delete(c.pending, msg.ID)
	}
	c.pendingMu.Unlock()

	if ok && msg.Error != nil {
		req.promise.reject(msg.Error)
	}
}

// tryReconnect attempts to reconnect with exponential backoff.
func (c *Client) tryReconnect() {
	delay := c.config.reconnectDelay
	for i := 0; i < c.config.maxReconnects; i++ {
		select {
		case <-c.ctx.Done():
			return
		case <-time.After(delay):
		}

		reconnectCtx, cancel := context.WithTimeout(c.ctx, c.config.timeout)
		if err := c.connect(reconnectCtx); err == nil {
			cancel()
			return
		}
		cancel()
		delay *= 2
	}
}

// sendMessage sends an RPC message.
func (c *Client) sendMessage(msg rpcMessage) error {
	c.mu.RLock()
	conn := c.conn
	connected := c.connected
	c.mu.RUnlock()

	if !connected || conn == nil {
		return ErrNotConnected
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal failed: %w", err)
	}

	c.mu.Lock()
	err = conn.Write(c.ctx, websocket.MessageText, data)
	c.mu.Unlock()

	if err != nil {
		return fmt.Errorf("write failed: %w", err)
	}

	return nil
}

// Call invokes a remote method and returns a Promise.
//
// Example:
//
//	promise := client.Call("square", 5)
//	result, err := promise.Await()
func (c *Client) Call(method string, args ...any) *Promise {
	return c.rawCall(method, args)
}

// rawCall performs the actual RPC call.
func (c *Client) rawCall(method string, args []any) *Promise {
	promise := newPromise(c)

	c.mu.RLock()
	if c.closed {
		c.mu.RUnlock()
		promise.reject(ErrConnectionClosed)
		return promise
	}
	if !c.connected {
		c.mu.RUnlock()
		promise.reject(ErrNotConnected)
		return promise
	}
	c.mu.RUnlock()

	// Generate message ID
	id := atomic.AddUint64(&c.msgID, 1)

	// Prepare arguments, converting capabilities to references
	preparedArgs := make([]any, len(args))
	for i, arg := range args {
		switch v := arg.(type) {
		case *Promise:
			// Wait for promise and use its value
			val, err := v.Await()
			if err != nil {
				promise.reject(err)
				return promise
			}
			preparedArgs[i] = val
		case *Capability:
			preparedArgs[i] = map[string]string{"$cap": v.id}
		case *Client:
			preparedArgs[i] = map[string]string{"$cap": "self"}
		case func(any) any:
			// Export the callback and pass a reference
			name := fmt.Sprintf("cb_%d", id)
			c.Export(name, v)
			preparedArgs[i] = map[string]string{"$fn": name}
		default:
			preparedArgs[i] = arg
		}
	}

	// Create and track the request
	c.pendingMu.Lock()
	c.pending[id] = &pendingRequest{
		promise: promise,
		sentAt:  time.Now(),
	}
	c.pendingMu.Unlock()

	// Send the message
	msg := rpcMessage{
		ID:     id,
		Type:   "call",
		Method: method,
		Args:   preparedArgs,
	}

	if err := c.sendMessage(msg); err != nil {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
		promise.reject(err)
	}

	atomic.AddInt32(&c.roundTrips, 1)

	return promise
}

// Export registers a local function to be callable by the server.
//
// Example:
//
//	client.Export("doubler", func(x any) any {
//	    if n, ok := x.(float64); ok {
//	        return n * 2
//	    }
//	    return x
//	})
func (c *Client) Export(name string, fn any) {
	c.exportsMu.Lock()
	c.exports[name] = fn
	c.exportsMu.Unlock()
}

// Self returns a reference to this client for use in RPC calls.
// This allows passing "self" as an argument to enable callbacks.
func (c *Client) Self() *Client {
	return c.selfRef
}

// IsConnected returns true if the client has an active connection.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected && !c.closed
}

// RoundTrips returns the number of round trips made.
func (c *Client) RoundTrips() int {
	return int(atomic.LoadInt32(&c.roundTrips))
}

// ResetRoundTrips resets the round trip counter.
func (c *Client) ResetRoundTrips() {
	atomic.StoreInt32(&c.roundTrips, 0)
}

// Close terminates the connection and releases resources.
func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	conn := c.conn
	c.mu.Unlock()

	c.cancel()

	// Reject all pending requests
	c.pendingMu.Lock()
	for _, req := range c.pending {
		req.promise.reject(ErrConnectionClosed)
	}
	c.pending = make(map[uint64]*pendingRequest)
	c.pendingMu.Unlock()

	if conn != nil {
		return conn.Close(websocket.StatusNormalClosure, "client closed")
	}
	return nil
}
