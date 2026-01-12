// Package capnweb provides a Go SDK for Cap'n Proto over WebSocket RPC.
//
// This is a stub implementation for conformance testing. The full SDK
// implementation is not yet complete.
package capnweb

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// ErrNotImplemented is returned when SDK functionality is not yet implemented.
var ErrNotImplemented = errors.New("capnweb: SDK not implemented")

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

// Session represents an active connection to a capnweb server.
type Session struct {
	url    string
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex

	// connected indicates if the WebSocket connection is established
	connected bool
}

// Connect establishes a connection to a capnweb server.
//
// The returned Session can be used to make RPC calls. The connection
// remains open until Close is called or the context is cancelled.
func Connect(ctx context.Context, url string) (*Session, error) {
	// TODO: Implement WebSocket connection
	// For now, return a stub session for testing
	sessionCtx, cancel := context.WithCancel(ctx)
	return &Session{
		url:       url,
		ctx:       sessionCtx,
		cancel:    cancel,
		connected: false,
	}, ErrNotImplemented
}

// Close terminates the session and releases resources.
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	s.connected = false
	return nil
}

// Call invokes a method on the root capability.
func (s *Session) Call(ctx context.Context, method string, args ...any) (any, error) {
	return nil, ErrNotImplemented
}

// Root returns a reference to the root capability.
func (s *Session) Root() *Ref[any] {
	return &Ref[any]{
		session: s,
		path:    nil,
	}
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
	return nil, ErrNotImplemented
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
	return nil, ErrNotImplemented
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
	return nil, ErrNotImplemented
}
