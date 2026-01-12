// Package rpc provides a Go SDK for DotDo RPC services.
//
// The SDK implements Cap'n Proto over WebSocket with support for
// promise pipelining, server-side map operations, and bidirectional RPC.
package rpc

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// ErrPromiseRejected is returned when a promise is rejected.
var ErrPromiseRejected = errors.New("rpc: promise rejected")

// ErrPromiseCanceled is returned when a promise is canceled.
var ErrPromiseCanceled = errors.New("rpc: promise canceled")

// PromiseState represents the state of a Promise.
type PromiseState int

const (
	// PromisePending means the promise has not yet resolved.
	PromisePending PromiseState = iota
	// PromiseFulfilled means the promise resolved successfully.
	PromiseFulfilled
	// PromiseRejected means the promise was rejected with an error.
	PromiseRejected
)

// Promise represents an asynchronous RPC result that may not yet be available.
// It supports promise pipelining - calling methods on results before they resolve.
//
// Example:
//
//	promise := client.Call("makeCounter", 10)
//	value := promise.Call("increment", 5)  // Pipelined call
//	result, err := value.Await()            // Single round trip
type Promise struct {
	mu       sync.Mutex
	state    PromiseState
	value    any
	err      error
	done     chan struct{}
	client   *Client
	target   string        // For pipelining: the capability path
	pipeline []*pendingCall // Calls waiting on this promise
}

// pendingCall represents a call that is waiting to be sent.
type pendingCall struct {
	method string
	args   []any
	result *Promise
}

// newPromise creates a new pending promise.
func newPromise(client *Client) *Promise {
	return &Promise{
		state:  PromisePending,
		done:   make(chan struct{}),
		client: client,
	}
}

// newResolvedPromise creates a promise that is already resolved.
func newResolvedPromise(value any) *Promise {
	p := &Promise{
		state: PromiseFulfilled,
		value: value,
		done:  make(chan struct{}),
	}
	close(p.done)
	return p
}

// newRejectedPromise creates a promise that is already rejected.
func newRejectedPromise(err error) *Promise {
	p := &Promise{
		state: PromiseRejected,
		err:   err,
		done:  make(chan struct{}),
	}
	close(p.done)
	return p
}

// resolve fulfills the promise with a value.
func (p *Promise) resolve(value any) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.state != PromisePending {
		return // Already resolved
	}

	p.state = PromiseFulfilled
	p.value = value
	close(p.done)

	// Execute any pipelined calls
	for _, pc := range p.pipeline {
		go p.executePipelinedCall(pc)
	}
	p.pipeline = nil
}

// reject rejects the promise with an error.
func (p *Promise) reject(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.state != PromisePending {
		return // Already resolved
	}

	p.state = PromiseRejected
	p.err = err
	close(p.done)

	// Reject any pipelined calls
	for _, pc := range p.pipeline {
		pc.result.reject(err)
	}
	p.pipeline = nil
}

// executePipelinedCall executes a call that was pipelined on this promise.
func (p *Promise) executePipelinedCall(pc *pendingCall) {
	// Get the resolved value as a capability
	if cap, ok := p.value.(*Capability); ok {
		// Call the method on the capability
		result := cap.Call(pc.method, pc.args...)
		val, err := result.Await()
		if err != nil {
			pc.result.reject(err)
		} else {
			pc.result.resolve(val)
		}
	} else {
		pc.result.reject(fmt.Errorf("cannot call method %q on non-capability value", pc.method))
	}
}

// Await blocks until the promise is resolved and returns the result.
// If the promise was rejected, it returns the error.
func (p *Promise) Await() (any, error) {
	<-p.done

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.state == PromiseRejected {
		return nil, p.err
	}
	return p.value, nil
}

// State returns the current state of the promise.
func (p *Promise) State() PromiseState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.state
}

// IsPending returns true if the promise has not yet resolved.
func (p *Promise) IsPending() bool {
	return p.State() == PromisePending
}

// IsFulfilled returns true if the promise resolved successfully.
func (p *Promise) IsFulfilled() bool {
	return p.State() == PromiseFulfilled
}

// IsRejected returns true if the promise was rejected.
func (p *Promise) IsRejected() bool {
	return p.State() == PromiseRejected
}

// Then applies a transformation to the promise result.
// The callback is called when the promise resolves.
// Returns a new promise with the transformed value.
func (p *Promise) Then(fn func(any) any) *Promise {
	result := newPromise(p.client)

	go func() {
		value, err := p.Await()
		if err != nil {
			result.reject(err)
			return
		}
		result.resolve(fn(value))
	}()

	return result
}

// Map applies a server-side transformation to the result.
// Unlike Then, Map sends the transformation to the server to be executed there.
// This is efficient for transforming large collections without sending all data to the client.
//
// Example:
//
//	// Square each number in the Fibonacci sequence - server-side
//	squares := client.Call("generateFibonacci", 10).Map(func(x any) any {
//	    return client.Call("square", x)
//	})
func (p *Promise) Map(fn func(any) any) *Promise {
	result := newPromise(p.client)

	go func() {
		value, err := p.Await()
		if err != nil {
			result.reject(err)
			return
		}

		// Handle nil/null values
		if value == nil {
			result.resolve(nil)
			return
		}

		// Handle arrays - apply fn to each element
		if slice, ok := toSlice(value); ok {
			mapped := make([]any, len(slice))
			for i, item := range slice {
				mappedItem := fn(item)
				// If the result is a promise, await it
				if promise, ok := mappedItem.(*Promise); ok {
					val, err := promise.Await()
					if err != nil {
						result.reject(err)
						return
					}
					mapped[i] = val
				} else {
					mapped[i] = mappedItem
				}
			}
			result.resolve(mapped)
			return
		}

		// Handle single values
		mappedValue := fn(value)
		if promise, ok := mappedValue.(*Promise); ok {
			val, err := promise.Await()
			if err != nil {
				result.reject(err)
				return
			}
			result.resolve(val)
		} else {
			result.resolve(mappedValue)
		}
	}()

	return result
}

// Call invokes a method on the result of this promise (pipelining).
// The call is sent before the promise resolves, enabling efficient batching.
func (p *Promise) Call(method string, args ...any) *Promise {
	p.mu.Lock()

	// If already resolved, call directly
	if p.state == PromiseFulfilled {
		p.mu.Unlock()
		if cap, ok := p.value.(*Capability); ok {
			return cap.Call(method, args...)
		}
		return newRejectedPromise(fmt.Errorf("cannot call method %q on non-capability value", method))
	}

	if p.state == PromiseRejected {
		p.mu.Unlock()
		return newRejectedPromise(p.err)
	}

	// Queue the pipelined call
	result := newPromise(p.client)
	pc := &pendingCall{
		method: method,
		args:   args,
		result: result,
	}
	p.pipeline = append(p.pipeline, pc)
	p.mu.Unlock()

	return result
}

// toSlice attempts to convert a value to []any.
func toSlice(v any) ([]any, bool) {
	switch s := v.(type) {
	case []any:
		return s, true
	case []float64:
		result := make([]any, len(s))
		for i, f := range s {
			result[i] = f
		}
		return result, true
	case []int:
		result := make([]any, len(s))
		for i, n := range s {
			result[i] = n
		}
		return result, true
	case []int64:
		result := make([]any, len(s))
		for i, n := range s {
			result[i] = n
		}
		return result, true
	case []string:
		result := make([]any, len(s))
		for i, str := range s {
			result[i] = str
		}
		return result, true
	case []interface{}:
		return s, true
	default:
		// Try JSON unmarshaling trick for unknown slice types
		data, err := json.Marshal(v)
		if err != nil {
			return nil, false
		}
		var result []any
		if err := json.Unmarshal(data, &result); err != nil {
			return nil, false
		}
		return result, true
	}
}

// Capability represents a remote capability reference.
// Capabilities can have methods called on them.
type Capability struct {
	client *Client
	id     string
	path   []string
}

// newCapability creates a new capability reference.
func newCapability(client *Client, id string) *Capability {
	return &Capability{
		client: client,
		id:     id,
	}
}

// Call invokes a method on this capability.
func (c *Capability) Call(method string, args ...any) *Promise {
	target := c.id + "." + method
	return c.client.rawCall(target, args)
}

// Get retrieves a property of this capability.
func (c *Capability) Get(property string) *Promise {
	return c.Call(property)
}
