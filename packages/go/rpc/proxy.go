package rpc

import (
	"reflect"
	"sync"
)

// Proxy provides a dynamic interface for calling RPC methods.
// It uses reflection to enable type-safe method invocation.
//
// Example:
//
//	type Calculator interface {
//	    Square(x int) int
//	    Add(a, b int) int
//	}
//
//	proxy := NewProxy[Calculator](client, "calculator")
//	result := proxy.Square(5) // Returns 25
type Proxy[T any] struct {
	client *Client
	target string
	mu     sync.RWMutex
	cache  map[string]*Promise
}

// NewProxy creates a typed proxy for the given target.
func NewProxy[T any](client *Client, target string) *Proxy[T] {
	return &Proxy[T]{
		client: client,
		target: target,
		cache:  make(map[string]*Promise),
	}
}

// Call invokes a method on the proxy target by name.
func (p *Proxy[T]) Call(method string, args ...any) *Promise {
	fullMethod := p.target
	if fullMethod != "" {
		fullMethod += "."
	}
	fullMethod += method
	return p.client.Call(fullMethod, args...)
}

// Get retrieves a property value from the proxy target.
func (p *Proxy[T]) Get(property string) *Promise {
	return p.Call(property)
}

// Stub creates a dynamic stub that implements the interface T.
// Methods called on the stub are forwarded as RPC calls.
//
// Note: This uses reflection and may have performance overhead.
// For high-performance applications, consider using typed proxies directly.
type Stub[T any] struct {
	proxy *Proxy[T]
}

// NewStub creates a stub that implements interface T via RPC.
func NewStub[T any](client *Client, target string) *Stub[T] {
	return &Stub[T]{
		proxy: NewProxy[T](client, target),
	}
}

// CallMethod invokes a method by name with arguments.
func (s *Stub[T]) CallMethod(method string, args ...any) *Promise {
	return s.proxy.Call(method, args...)
}

// DynamicProxy is a non-generic proxy for dynamic method invocation.
// Use this when you don't know the method names at compile time.
type DynamicProxy struct {
	client *Client
	path   []string
}

// NewDynamicProxy creates a new dynamic proxy.
func NewDynamicProxy(client *Client) *DynamicProxy {
	return &DynamicProxy{
		client: client,
		path:   nil,
	}
}

// Get returns a new proxy with the given path segment appended.
// This enables chained property access: proxy.Get("users").Get("123").Get("profile")
func (p *DynamicProxy) Get(segment string) *DynamicProxy {
	return &DynamicProxy{
		client: p.client,
		path:   append(append([]string{}, p.path...), segment),
	}
}

// Call invokes a method on this path with the given arguments.
func (p *DynamicProxy) Call(args ...any) *Promise {
	method := joinPath(p.path)
	return p.client.Call(method, args...)
}

// Invoke invokes a named method on this path.
func (p *DynamicProxy) Invoke(method string, args ...any) *Promise {
	fullPath := append(append([]string{}, p.path...), method)
	return p.client.Call(joinPath(fullPath), args...)
}

// joinPath joins path segments with dots.
func joinPath(segments []string) string {
	if len(segments) == 0 {
		return ""
	}
	result := segments[0]
	for i := 1; i < len(segments); i++ {
		result += "." + segments[i]
	}
	return result
}

// MethodProxy wraps a single method for repeated invocation.
type MethodProxy struct {
	client *Client
	method string
}

// NewMethodProxy creates a proxy for a single method.
func NewMethodProxy(client *Client, method string) *MethodProxy {
	return &MethodProxy{
		client: client,
		method: method,
	}
}

// Call invokes the method with arguments.
func (m *MethodProxy) Call(args ...any) *Promise {
	return m.client.Call(m.method, args...)
}

// Invoke is an alias for Call.
func (m *MethodProxy) Invoke(args ...any) *Promise {
	return m.Call(args...)
}

// ReflectCall uses reflection to call a method dynamically.
// This is useful when integrating with existing Go interfaces.
func ReflectCall(client *Client, method string, args ...any) ([]reflect.Value, error) {
	promise := client.Call(method, args...)
	result, err := promise.Await()
	if err != nil {
		return nil, err
	}

	// Wrap result in reflect.Value
	return []reflect.Value{reflect.ValueOf(result)}, nil
}

// Pipeline enables batching multiple calls into a single round trip.
type Pipeline struct {
	client *Client
	calls  []*pipelineCall
	refs   map[string]*Promise
}

type pipelineCall struct {
	method string
	args   []any
	as     string
	result *Promise
}

// NewPipeline creates a new pipeline for batching calls.
func NewPipeline(client *Client) *Pipeline {
	return &Pipeline{
		client: client,
		refs:   make(map[string]*Promise),
	}
}

// Add adds a call to the pipeline.
func (p *Pipeline) Add(method string, args ...any) *Promise {
	promise := newPromise(p.client)
	call := &pipelineCall{
		method: method,
		args:   args,
		result: promise,
	}
	p.calls = append(p.calls, call)
	return promise
}

// AddAs adds a named call to the pipeline.
// The name can be used to reference the result in later calls.
func (p *Pipeline) AddAs(name, method string, args ...any) *Promise {
	promise := p.Add(method, args...)
	p.refs[name] = promise
	return promise
}

// Ref returns a reference to a named result.
func (p *Pipeline) Ref(name string) *Promise {
	return p.refs[name]
}

// Execute sends all pipeline calls and waits for results.
func (p *Pipeline) Execute() error {
	// For now, execute calls sequentially
	// A more advanced implementation would batch them
	for _, call := range p.calls {
		// Resolve any $ref arguments
		resolvedArgs := make([]any, len(call.args))
		for i, arg := range call.args {
			if s, ok := arg.(string); ok && len(s) > 1 && s[0] == '$' {
				refName := s[1:]
				if ref, ok := p.refs[refName]; ok {
					val, err := ref.Await()
					if err != nil {
						call.result.reject(err)
						continue
					}
					resolvedArgs[i] = val
					continue
				}
			}
			resolvedArgs[i] = arg
		}

		result := p.client.Call(call.method, resolvedArgs...)
		val, err := result.Await()
		if err != nil {
			call.result.reject(err)
		} else {
			call.result.resolve(val)
		}
	}

	return nil
}

// Results returns all pipeline results as a map.
func (p *Pipeline) Results() (map[string]any, error) {
	results := make(map[string]any)
	for name, promise := range p.refs {
		val, err := promise.Await()
		if err != nil {
			return nil, err
		}
		results[name] = val
	}
	return results, nil
}
