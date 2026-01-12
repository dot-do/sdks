// Package capnweb provides a Go SDK for Cap'n Proto over WebSocket RPC.
//
// This package implements Cap'n Proto RPC semantics over WebSocket transport,
// supporting promise pipelining, capability references, and bidirectional communication.
package capnweb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"nhooyr.io/websocket"
)

// ErrNotImplemented is returned when SDK functionality is not yet implemented.
var ErrNotImplemented = errors.New("capnweb: SDK not implemented")

// ErrNotConnected is returned when an operation requires an active connection.
var ErrNotConnected = errors.New("capnweb: not connected")

// ErrConnectionClosed is returned when the connection has been closed.
var ErrConnectionClosed = errors.New("capnweb: connection closed")

// Error represents an RPC error returned from the server.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("capnweb: %s: %s", e.Code, e.Message)
	}
	return fmt.Sprintf("capnweb: %s", e.Message)
}

// rpcMessage is the wire format for RPC messages.
type rpcMessage struct {
	ID      uint64    `json:"id,omitempty"`
	Type    string    `json:"type"`
	Method  string    `json:"method,omitempty"`
	Target  string    `json:"target,omitempty"`
	Args    []any     `json:"args,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *Error    `json:"error,omitempty"`
	CapID   string    `json:"capId,omitempty"`
	Path    []string  `json:"path,omitempty"`
}

// Session represents an active connection to a capnweb server.
type Session struct {
	url    string
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.RWMutex

	// WebSocket connection
	conn      *websocket.Conn
	connected bool
	closed    bool

	// Message handling
	msgID     uint64
	pending   map[uint64]*pendingRequest
	pendingMu sync.Mutex

	// Exported capabilities (for bidirectional RPC)
	exports   map[string]any
	exportsMu sync.RWMutex

	// Remote capabilities
	caps   map[string]*Capability
	capsMu sync.RWMutex
}

// pendingRequest tracks an in-flight RPC request.
type pendingRequest struct {
	resultCh chan *rpcMessage
	errCh    chan error
}

// Connect establishes a connection to a capnweb server.
//
// The returned Session can be used to make RPC calls. The connection
// remains open until Close is called or the context is cancelled.
func Connect(ctx context.Context, url string) (*Session, error) {
	sessionCtx, cancel := context.WithCancel(ctx)

	// Dial the WebSocket server
	conn, _, err := websocket.Dial(sessionCtx, url, nil)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("capnweb: dial failed: %w", err)
	}

	s := &Session{
		url:       url,
		ctx:       sessionCtx,
		cancel:    cancel,
		conn:      conn,
		connected: true,
		pending:   make(map[uint64]*pendingRequest),
		exports:   make(map[string]any),
		caps:      make(map[string]*Capability),
	}

	// Start receiving messages
	go s.receiveLoop()

	return s, nil
}

// receiveLoop handles incoming messages from the server.
func (s *Session) receiveLoop() {
	defer func() {
		s.mu.Lock()
		s.connected = false
		s.mu.Unlock()
	}()

	for {
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		_, data, err := s.conn.Read(s.ctx)
		if err != nil {
			// Check if this is a normal closure
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure ||
				websocket.CloseStatus(err) == websocket.StatusGoingAway {
				return
			}
			// Connection error - reject all pending requests
			s.pendingMu.Lock()
			for _, req := range s.pending {
				select {
				case req.errCh <- err:
				default:
				}
			}
			s.pending = make(map[uint64]*pendingRequest)
			s.pendingMu.Unlock()
			return
		}

		var msg rpcMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // Skip malformed messages
		}

		s.handleMessage(msg)
	}
}

// handleMessage processes an incoming RPC message.
func (s *Session) handleMessage(msg rpcMessage) {
	switch msg.Type {
	case "return", "result":
		s.handleReturn(msg)
	case "call":
		s.handleIncomingCall(msg)
	case "error":
		s.handleError(msg)
	case "resolve":
		s.handleResolve(msg)
	case "reject":
		s.handleReject(msg)
	}
}

// handleReturn processes a method return message.
func (s *Session) handleReturn(msg rpcMessage) {
	s.pendingMu.Lock()
	req, ok := s.pending[msg.ID]
	if ok {
		delete(s.pending, msg.ID)
	}
	s.pendingMu.Unlock()

	if !ok {
		return // Unknown request ID
	}

	if msg.Error != nil {
		select {
		case req.errCh <- msg.Error:
		default:
		}
	} else {
		select {
		case req.resultCh <- &msg:
		default:
		}
	}
}

// handleIncomingCall processes an incoming RPC call (bidirectional RPC).
func (s *Session) handleIncomingCall(msg rpcMessage) {
	s.exportsMu.RLock()
	export, ok := s.exports[msg.Method]
	s.exportsMu.RUnlock()

	var response rpcMessage
	response.ID = msg.ID
	response.Type = "return"

	if !ok {
		response.Error = &Error{
			Code:    "METHOD_NOT_FOUND",
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
			response.Error = &Error{
				Code:    "INVALID_EXPORT",
				Message: "invalid export type",
			}
		}
	}

	s.sendMessage(response)
}

// handleError processes an error message.
func (s *Session) handleError(msg rpcMessage) {
	s.pendingMu.Lock()
	req, ok := s.pending[msg.ID]
	if ok {
		delete(s.pending, msg.ID)
	}
	s.pendingMu.Unlock()

	if ok && msg.Error != nil {
		select {
		case req.errCh <- msg.Error:
		default:
		}
	}
}

// handleResolve processes a promise resolution message.
func (s *Session) handleResolve(msg rpcMessage) {
	s.handleReturn(msg)
}

// handleReject processes a promise rejection message.
func (s *Session) handleReject(msg rpcMessage) {
	s.handleError(msg)
}

// sendMessage sends an RPC message over the WebSocket.
func (s *Session) sendMessage(msg rpcMessage) error {
	s.mu.RLock()
	conn := s.conn
	connected := s.connected
	closed := s.closed
	s.mu.RUnlock()

	if closed {
		return ErrConnectionClosed
	}
	if !connected || conn == nil {
		return ErrNotConnected
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("capnweb: marshal failed: %w", err)
	}

	s.mu.Lock()
	err = conn.Write(s.ctx, websocket.MessageText, data)
	s.mu.Unlock()

	if err != nil {
		return fmt.Errorf("capnweb: write failed: %w", err)
	}

	return nil
}

// Close terminates the session and releases resources.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	conn := s.conn
	s.mu.Unlock()

	s.cancel()

	// Reject all pending requests
	s.pendingMu.Lock()
	for _, req := range s.pending {
		select {
		case req.errCh <- ErrConnectionClosed:
		default:
		}
	}
	s.pending = make(map[uint64]*pendingRequest)
	s.pendingMu.Unlock()

	if conn != nil {
		return conn.Close(websocket.StatusNormalClosure, "session closed")
	}
	return nil
}

// Call invokes a method on the root capability.
func (s *Session) Call(ctx context.Context, method string, args ...any) (any, error) {
	s.mu.RLock()
	if s.closed {
		s.mu.RUnlock()
		return nil, ErrConnectionClosed
	}
	if !s.connected {
		s.mu.RUnlock()
		return nil, ErrNotConnected
	}
	s.mu.RUnlock()

	// Generate message ID
	id := atomic.AddUint64(&s.msgID, 1)

	// Create pending request
	req := &pendingRequest{
		resultCh: make(chan *rpcMessage, 1),
		errCh:    make(chan error, 1),
	}

	s.pendingMu.Lock()
	s.pending[id] = req
	s.pendingMu.Unlock()

	// Send the message
	msg := rpcMessage{
		ID:     id,
		Type:   "call",
		Method: method,
		Args:   args,
	}

	if err := s.sendMessage(msg); err != nil {
		s.pendingMu.Lock()
		delete(s.pending, id)
		s.pendingMu.Unlock()
		return nil, err
	}

	// Wait for response
	select {
	case <-ctx.Done():
		s.pendingMu.Lock()
		delete(s.pending, id)
		s.pendingMu.Unlock()
		return nil, ctx.Err()
	case <-s.ctx.Done():
		return nil, ErrConnectionClosed
	case result := <-req.resultCh:
		// Check if result is a capability reference
		if result.CapID != "" {
			cap := newCapability(s, result.CapID)
			s.capsMu.Lock()
			s.caps[result.CapID] = cap
			s.capsMu.Unlock()
			return cap, nil
		}
		return result.Result, nil
	case err := <-req.errCh:
		return nil, err
	}
}

// Export registers a local function to be callable by the server.
func (s *Session) Export(name string, fn any) {
	s.exportsMu.Lock()
	s.exports[name] = fn
	s.exportsMu.Unlock()
}

// Root returns a reference to the root capability.
func (s *Session) Root() *Ref[any] {
	return &Ref[any]{
		session: s,
		path:    nil,
	}
}

// IsConnected returns true if the session has an active connection.
func (s *Session) IsConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connected && !s.closed
}

// Ref represents a reference to a remote capability.
// T is the expected type of the capability (used for type safety).
type Ref[T any] struct {
	session *Session
	path    []string // capability path for pipelining
	id      string   // resolved capability ID (once resolved)
}

// Call invokes a method on this capability reference.
func (r *Ref[T]) Call(ctx context.Context, method string, args ...any) (any, error) {
	// If we have a resolved ID, use it
	if r.id != "" {
		return r.session.Call(ctx, r.id+"."+method, args...)
	}

	// For pipelined calls, build the full method path
	fullMethod := method
	if len(r.path) > 0 {
		fullMethod = ""
		for _, p := range r.path {
			fullMethod += p + "."
		}
		fullMethod += method
	}

	return r.session.Call(ctx, fullMethod, args...)
}

// Get retrieves a nested capability by name.
// This enables promise pipelining by returning a Ref that can be used
// before the parent promise resolves.
func (r *Ref[T]) Get(name string) *Ref[any] {
	newPath := make([]string, len(r.path)+1)
	copy(newPath, r.path)
	newPath[len(r.path)] = name
	return &Ref[any]{
		session: r.session,
		path:    newPath,
	}
}

// Await blocks until the capability reference is resolved.
func (r *Ref[T]) Await(ctx context.Context) (*T, error) {
	// For now, we can call a special "resolve" method
	// In a full implementation, this would wait for the capability to be resolved
	result, err := r.session.Call(ctx, "__resolve__", r.path)
	if err != nil {
		return nil, err
	}
	if t, ok := result.(T); ok {
		return &t, nil
	}
	// Try to convert via type assertion
	var zero T
	return &zero, nil
}

// Capability represents a resolved remote capability reference.
type Capability struct {
	session *Session
	id      string
}

// newCapability creates a new capability reference.
func newCapability(session *Session, id string) *Capability {
	return &Capability{
		session: session,
		id:      id,
	}
}

// Call invokes a method on this capability.
func (c *Capability) Call(ctx context.Context, method string, args ...any) (any, error) {
	return c.session.Call(ctx, c.id+"."+method, args...)
}

// Pipeline represents a chain of pipelined calls.
type Pipeline struct {
	session *Session
	steps   []pipelineStep
}

type pipelineStep struct {
	ref    *Ref[any]
	method string
	args   []any
	alias  string
}

// NewPipeline creates a new pipeline for batching calls.
func (s *Session) NewPipeline() *Pipeline {
	return &Pipeline{
		session: s,
		steps:   nil,
	}
}

// Add adds a call to the pipeline.
func (p *Pipeline) Add(ref *Ref[any], method string, args []any, alias string) *Ref[any] {
	step := pipelineStep{
		ref:    ref,
		method: method,
		args:   args,
		alias:  alias,
	}
	p.steps = append(p.steps, step)
	// Return a pipelined reference
	return &Ref[any]{
		session: p.session,
		path:    []string{alias},
	}
}

// Execute runs all pipelined calls and returns results.
func (p *Pipeline) Execute(ctx context.Context) (map[string]any, error) {
	results := make(map[string]any)

	// Execute each step sequentially
	// A more advanced implementation would batch these into a single message
	for _, step := range p.steps {
		// Build the full method name
		fullMethod := step.method
		if step.ref != nil && len(step.ref.path) > 0 {
			fullMethod = ""
			for _, segment := range step.ref.path {
				fullMethod += segment + "."
			}
			fullMethod += step.method
		}

		result, err := p.session.Call(ctx, fullMethod, step.args...)
		if err != nil {
			return results, err
		}

		if step.alias != "" {
			results[step.alias] = result
		}
	}

	return results, nil
}

// Promise represents an asynchronous RPC result.
type Promise struct {
	session  *Session
	id       uint64
	resultCh chan any
	errCh    chan error
	resolved bool
	result   any
	err      error
	mu       sync.Mutex
}

// newPromise creates a new pending promise.
func newPromise(session *Session, id uint64) *Promise {
	return &Promise{
		session:  session,
		id:       id,
		resultCh: make(chan any, 1),
		errCh:    make(chan error, 1),
	}
}

// Await blocks until the promise is resolved and returns the result.
func (p *Promise) Await(ctx context.Context) (any, error) {
	p.mu.Lock()
	if p.resolved {
		result, err := p.result, p.err
		p.mu.Unlock()
		return result, err
	}
	p.mu.Unlock()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-p.resultCh:
		p.mu.Lock()
		p.resolved = true
		p.result = result
		p.mu.Unlock()
		return result, nil
	case err := <-p.errCh:
		p.mu.Lock()
		p.resolved = true
		p.err = err
		p.mu.Unlock()
		return nil, err
	}
}

// resolve fulfills the promise with a value.
func (p *Promise) resolve(value any) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.resolved {
		return
	}
	p.resolved = true
	p.result = value
	select {
	case p.resultCh <- value:
	default:
	}
}

// reject rejects the promise with an error.
func (p *Promise) reject(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.resolved {
		return
	}
	p.resolved = true
	p.err = err
	select {
	case p.errCh <- err:
	default:
	}
}
