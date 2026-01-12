# go.rpc.do

A managed RPC client for Go with automatic routing, promise pipelining, and server-side transformations.

```go
result, err := client.Call("square", 5).Await()
```

Promises. Pipelining. The Go way.

## What rpc.do Adds Over capnweb

The `go.rpc.do` package builds on the raw capabilities of capnweb to provide:

| Feature | capnweb | rpc.do |
|---------|---------|--------|
| **Connection Management** | Manual WebSocket handling | Automatic connect/reconnect |
| **Service Routing** | Raw method calls | Proxies with dot-notation routing |
| **Promise Pipelining** | Basic support | Full pipeline builder with named refs |
| **Server-Side Map** | Not available | `Remap`, `ServerMap`, collections |
| **Type-Safe Proxies** | Manual type assertions | Generic `Proxy[T]` and `Stub[T]` |
| **Error Handling** | Basic errors | Rich `RPCError` with codes |

**Requirements**: Go 1.21+

## Installation

```bash
go get go.rpc.do
```

Or with a specific version:

```bash
go get go.rpc.do@v0.1.0
```

In your Go module:

```go
import "go.rpc.do"
```

## Quick Start

```go
package main

import (
    "fmt"
    "log"

    rpc "go.rpc.do"
)

func main() {
    // Connect to a DotDo service
    client, err := rpc.Connect("wss://api.example.do")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Make an RPC call
    promise := client.Call("square", 5)

    // Await the result
    result, err := promise.Await()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("5 squared = %v\n", result) // 5 squared = 25
}
```

## Core Concepts

### The Client

The `Client` manages your WebSocket connection to a DotDo service. It handles:

- Connection establishment and lifecycle
- Message serialization (JSON over WebSocket)
- Request/response correlation
- Automatic reconnection (when configured)
- Bidirectional RPC (exports)

```go
// Simple connection
client, err := rpc.Connect("wss://api.example.do")

// Connection with context (for cancellation)
client, err := rpc.ConnectContext(ctx, "wss://api.example.do")

// Connection with options
client, err := rpc.Connect("wss://api.example.do",
    rpc.WithTimeout(30*time.Second),
    rpc.WithReconnect(5, time.Second),
    rpc.WithHeaders(http.Header{
        "Authorization": []string{"Bearer " + token},
    }),
)
```

### Promises

Every RPC call returns a `*Promise` - an asynchronous result that may not yet be available.

```go
// Start an async call
promise := client.Call("longRunningOperation", args...)

// Do other work while waiting...
doOtherStuff()

// Block until result is ready
result, err := promise.Await()
```

Promises have three states:

```go
const (
    PromisePending   PromiseState = iota  // Not yet resolved
    PromiseFulfilled                       // Resolved with a value
    PromiseRejected                        // Rejected with an error
)

// Check state without blocking
if promise.IsPending() {
    fmt.Println("Still waiting...")
}
if promise.IsFulfilled() {
    result, _ := promise.Await() // Returns immediately
}
if promise.IsRejected() {
    _, err := promise.Await() // Returns immediately with error
}
```

### Capabilities

Capabilities are references to remote objects that can have methods called on them. When an RPC call returns a capability, you can chain method calls:

```go
// makeCounter returns a capability with increment/decrement/value methods
counter := client.Call("makeCounter", 10)

// Call methods on the capability (pipelined - see below)
counter.Call("increment", 5)
counter.Call("increment", 3)

// Get the final value
value, err := counter.Call("value").Await()
fmt.Println(value) // 18
```

## Making RPC Calls

### Basic Calls

```go
// Call with no arguments
result, err := client.Call("getServerTime").Await()

// Call with arguments
result, err := client.Call("square", 5).Await()

// Call with multiple arguments
result, err := client.Call("add", 10, 20).Await()

// Call with complex arguments
user := map[string]any{
    "name":  "Alice",
    "email": "alice@example.com",
}
result, err := client.Call("createUser", user).Await()
```

### URL Normalization

The client automatically normalizes URLs:

```go
// All of these work
client, _ := rpc.Connect("wss://api.example.do")      // WebSocket secure
client, _ := rpc.Connect("ws://localhost:8080")        // WebSocket
client, _ := rpc.Connect("https://api.example.do")     // Converted to wss://
client, _ := rpc.Connect("http://localhost:8080")      // Converted to ws://
client, _ := rpc.Connect("api.example.do")             // Defaults to wss://
```

## Error Handling

### The RPCError Type

Remote errors are wrapped in the `RPCError` type:

```go
type RPCError struct {
    Type    string `json:"type"`     // Error type (e.g., "RangeError", "TypeError")
    Message string `json:"message"`  // Human-readable message
    Code    string `json:"code"`     // Optional error code
}

func (e *RPCError) Error() string // Implements the error interface
```

### Checking Errors with errors.Is and errors.As

Go's standard error handling patterns work naturally:

```go
result, err := client.Call("riskyOperation").Await()
if err != nil {
    // Check for specific error types
    var rpcErr *rpc.RPCError
    if errors.As(err, &rpcErr) {
        switch rpcErr.Type {
        case "NotFoundError":
            return nil, ErrNotFound
        case "ValidationError":
            return nil, fmt.Errorf("validation failed: %s", rpcErr.Message)
        case "RateLimitError":
            // Retry after delay
            time.Sleep(time.Second)
            return retryOperation()
        default:
            return nil, fmt.Errorf("RPC error: %w", err)
        }
    }

    // Check for connection errors
    if errors.Is(err, rpc.ErrNotConnected) {
        return nil, fmt.Errorf("lost connection: %w", err)
    }
    if errors.Is(err, rpc.ErrConnectionClosed) {
        return nil, fmt.Errorf("connection was closed: %w", err)
    }
    if errors.Is(err, rpc.ErrTimeout) {
        return nil, fmt.Errorf("operation timed out: %w", err)
    }

    return nil, err
}
```

### Sentinel Errors

The package defines sentinel errors for common conditions:

```go
var (
    // ErrNotConnected is returned when an operation requires an active connection
    ErrNotConnected = errors.New("rpc: not connected")

    // ErrConnectionClosed is returned when the connection has been closed
    ErrConnectionClosed = errors.New("rpc: connection closed")

    // ErrTimeout is returned when an operation times out
    ErrTimeout = errors.New("rpc: operation timed out")

    // ErrPromiseRejected is returned when a promise is rejected
    ErrPromiseRejected = errors.New("rpc: promise rejected")

    // ErrPromiseCanceled is returned when a promise is canceled
    ErrPromiseCanceled = errors.New("rpc: promise canceled")
)
```

### Error Wrapping

Always wrap errors with context for better debugging:

```go
func GetUserProfile(client *rpc.Client, userID int64) (*Profile, error) {
    result, err := client.Call("users.getProfile", userID).Await()
    if err != nil {
        return nil, fmt.Errorf("get profile for user %d: %w", userID, err)
    }

    profile, ok := result.(*Profile)
    if !ok {
        return nil, fmt.Errorf("unexpected result type: %T", result)
    }

    return profile, nil
}
```

## Promise Pipelining

Pipelining is the killer feature of capability-based RPC. It lets you chain dependent calls and execute them in a single round trip.

### The Problem with Sequential Calls

Without pipelining, dependent calls require multiple round trips:

```go
// BAD: Three round trips
fibonacci := client.Call("generateFibonacci", 10)
fib, _ := fibonacci.Await()                     // Round trip 1

firstNum := fib.([]any)[0]
squared := client.Call("square", firstNum)
sq, _ := squared.Await()                        // Round trip 2

doubled := client.Call("double", sq)
result, _ := doubled.Await()                    // Round trip 3
```

### Pipelining with Promise.Call

Call methods on unresolved promises - the calls are queued and sent efficiently:

```go
// GOOD: Single round trip with pipelining
counter := client.Call("makeCounter", 10)

// These calls are pipelined - they don't wait for makeCounter to resolve
counter.Call("increment", 5)
counter.Call("increment", 3)
counter.Call("decrement", 2)

// Single round trip for all operations
value, err := counter.Call("value").Await()
fmt.Println(value) // 16
```

### Promise.Then for Local Transformations

Transform results locally after they resolve:

```go
promise := client.Call("generateFibonacci", 10).Then(func(result any) any {
    // This runs locally after the RPC completes
    if slice, ok := result.([]float64); ok {
        sum := 0.0
        for _, v := range slice {
            sum += v
        }
        return sum
    }
    return result
})

sum, err := promise.Await()
fmt.Printf("Sum of first 10 Fibonacci numbers: %v\n", sum)
```

### Promise.Map for Collection Transformations

Apply a function to each element of a collection:

```go
// Double each Fibonacci number
doubled := client.Call("generateFibonacci", 5).Map(func(x any) any {
    if n, ok := x.(float64); ok {
        return n * 2
    }
    return x
})

result, err := doubled.Await()
// [0, 2, 2, 4, 6] (doubled from [0, 1, 1, 2, 3])
```

When the map function returns a Promise, it's automatically awaited:

```go
// Square each Fibonacci number using the server's square function
squared := client.Call("generateFibonacci", 5).Map(func(x any) any {
    return client.Call("square", x) // Returns a Promise
})

result, err := squared.Await()
// [0, 1, 1, 4, 9] (squared from [0, 1, 1, 2, 3])
```

## The Pipeline Builder

For complex multi-step operations, use the `Pipeline` builder:

```go
pipe := rpc.NewPipeline(client)

// Add calls with names for referencing
pipe.AddAs("fib", "generateFibonacci", 10)
pipe.AddAs("squared", "square", "$fib") // $fib references the result

// Execute all calls
if err := pipe.Execute(); err != nil {
    log.Fatal(err)
}

// Get results by name
results, err := pipe.Results()
if err != nil {
    log.Fatal(err)
}

fmt.Println(results["fib"])     // [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
fmt.Println(results["squared"]) // Squared result
```

### Pipeline Methods

```go
// Add an anonymous call
promise := pipe.Add("square", 5)

// Add a named call (result can be referenced with $name)
promise := pipe.AddAs("myResult", "square", 5)

// Reference a previous result
pipe.AddAs("doubled", "double", "$myResult")

// Get a reference to a named result
ref := pipe.Ref("myResult")

// Execute all pending calls
err := pipe.Execute()

// Get all named results as a map
results, err := pipe.Results()
```

### Pipeline Example: User Dashboard

```go
func LoadDashboard(client *rpc.Client, userID int64) (*Dashboard, error) {
    pipe := rpc.NewPipeline(client)

    // Load user data, orders, and notifications in parallel
    pipe.AddAs("user", "users.get", userID)
    pipe.AddAs("orders", "orders.listForUser", userID)
    pipe.AddAs("notifications", "notifications.listUnread", userID)
    pipe.AddAs("preferences", "users.getPreferences", userID)

    if err := pipe.Execute(); err != nil {
        return nil, fmt.Errorf("load dashboard: %w", err)
    }

    results, err := pipe.Results()
    if err != nil {
        return nil, err
    }

    return &Dashboard{
        User:          results["user"],
        Orders:        results["orders"],
        Notifications: results["notifications"],
        Preferences:   results["preferences"],
    }, nil
}
```

## Server-Side Map Operations (Remap)

For large collections, transferring all data to the client just to transform it is inefficient. Server-side map operations let you transform data on the server.

### Basic Remap

```go
// Square each Fibonacci number on the server
result := rpc.Remap(client,
    client.Call("generateFibonacci", 10),
    func(x any) any {
        return client.Call("square", x)
    },
)

squared, err := result.Await()
```

### Remap with Captures

Pass additional context to the transformation:

```go
// Create counters from Fibonacci numbers, using self for callbacks
result := rpc.RemapWithCaptures(client,
    client.Call("generateFibonacci", 4),
    map[string]any{"self": client.Self()},
    func(x any, captures map[string]any) any {
        self := captures["self"].(*rpc.Client)
        return self.Call("makeCounter", x)
    },
)

counters, err := result.Await()
```

### ServerMap Builder

For more control, use the `ServerMap` builder:

```go
serverMap := rpc.NewServerMap(client, client.Call("generateFibonacci", 10)).
    Expression("x => self.square(x)").
    CaptureSelf()

result := serverMap.Execute()
squared, err := result.Await()
```

### ServerMap Methods

```go
// Create a server-side map operation
sm := rpc.NewServerMap(client, sourcePromise)

// Set the transformation expression
sm.Expression("x => self.transform(x)")

// Add a captured value
sm.Capture("multiplier", 2)

// Capture the client as "$self"
sm.CaptureSelf()

// Execute and get result
promise := sm.Execute()
```

## Typed Collections

The `Collection[T]` type provides type-safe operations on remote collections:

```go
// Create a typed collection from a promise
source := client.Call("generateFibonacci", 10)
coll := rpc.NewCollection[float64](client, source)

// Map with type safety
doubled := coll.Map(func(n float64) any {
    return n * 2
})

// Filter elements
evens := coll.Filter(func(n float64) bool {
    return int(n)%2 == 0
})

// Collect all elements
numbers, err := coll.Collect()
fmt.Println(numbers) // []float64{0, 1, 1, 2, 3, 5, 8, 13, 21, 34}

// Get the first element
first, err := coll.First()
fmt.Println(*first) // 0

// Count elements
count, err := coll.Count()
fmt.Println(count) // 10
```

## Proxy Types

### Typed Proxy

Create a proxy for calling methods on a specific target:

```go
type Calculator interface {
    Square(x int) int
    Add(a, b int) int
}

// Create a typed proxy
proxy := rpc.NewProxy[Calculator](client, "calculator")

// Call methods by name
result, err := proxy.Call("Square", 5).Await()
fmt.Println(result) // 25

// Get a property
value, err := proxy.Get("lastResult").Await()
```

### Stub

Create a stub for interface-like access:

```go
stub := rpc.NewStub[Calculator](client, "calculator")

// Call methods
result, err := stub.CallMethod("Add", 10, 20).Await()
fmt.Println(result) // 30
```

### Dynamic Proxy

For runtime-determined method names:

```go
proxy := rpc.NewDynamicProxy(client)

// Chain path segments
userProxy := proxy.Get("users").Get("123").Get("profile")

// Call a method
bio, err := userProxy.Get("bio").Call().Await()

// Or invoke directly
result, err := proxy.Get("users").Invoke("create", userData).Await()
```

### Method Proxy

Wrap a single method for repeated invocation:

```go
square := rpc.NewMethodProxy(client, "square")

// Call multiple times
a, _ := square.Call(5).Await()
b, _ := square.Call(10).Await()
c, _ := square.Call(15).Await()

// Also available as Invoke
d, _ := square.Invoke(20).Await()
```

## Bidirectional RPC (Exports)

Export local functions that the server can call back:

```go
// Export a simple function
client.Export("doubler", func(x any) any {
    if n, ok := x.(float64); ok {
        return n * 2
    }
    return x
})

// Now the server can call "doubler" on this client
// This is useful for callbacks, event handlers, etc.
```

### Using Self in Calls

Pass a reference to your client so the server can call back:

```go
// Get a reference to self
self := client.Self()

// Pass it to a server function that expects a callback capability
client.Call("processWithCallback", data, self)
```

### Export Patterns

```go
// Event handler
client.Export("onUserCreated", func(event any) any {
    user := event.(map[string]any)
    fmt.Printf("User created: %s\n", user["name"])
    return nil
})

// Progress callback
client.Export("onProgress", func(progress any) any {
    pct := progress.(float64)
    fmt.Printf("Progress: %.1f%%\n", pct*100)
    return nil
})

// Bidirectional stream handler
client.Export("handleMessage", func(msg any) any {
    message := msg.(map[string]any)
    // Process and optionally return a response
    return map[string]any{
        "received": true,
        "echo":     message["content"],
    }
})
```

## Connection Options

### WithTimeout

Set the connection timeout:

```go
client, err := rpc.Connect("wss://api.example.do",
    rpc.WithTimeout(30*time.Second),
)
```

### WithHeaders

Add custom headers to the WebSocket handshake:

```go
headers := http.Header{}
headers.Set("Authorization", "Bearer "+token)
headers.Set("X-Request-ID", requestID)

client, err := rpc.Connect("wss://api.example.do",
    rpc.WithHeaders(headers),
)
```

### WithReconnect

Enable automatic reconnection:

```go
client, err := rpc.Connect("wss://api.example.do",
    rpc.WithReconnect(
        5,              // Maximum reconnection attempts
        time.Second,    // Initial delay (doubles each attempt)
    ),
)
```

### WithDialer

Use a custom WebSocket dialer:

```go
dialer := &websocket.Dialer{
    HandshakeTimeout: 10 * time.Second,
    TLSClientConfig: &tls.Config{
        InsecureSkipVerify: false,
    },
    Proxy: http.ProxyFromEnvironment,
}

client, err := rpc.Connect("wss://api.example.do",
    rpc.WithDialer(dialer),
)
```

### Combining Options

```go
client, err := rpc.Connect("wss://api.example.do",
    rpc.WithTimeout(30*time.Second),
    rpc.WithHeaders(headers),
    rpc.WithReconnect(5, time.Second),
    rpc.WithDialer(customDialer),
)
```

## Connection Lifecycle

### Checking Connection Status

```go
if client.IsConnected() {
    // Safe to make calls
    result, _ := client.Call("ping").Await()
} else {
    // Connection lost - handle gracefully
    log.Println("Connection lost, attempting to reconnect...")
}
```

### Graceful Shutdown

```go
// Close releases all resources
if err := client.Close(); err != nil {
    log.Printf("Error closing connection: %v", err)
}

// After close, all pending calls are rejected with ErrConnectionClosed
```

### Round Trip Counting

Track network efficiency:

```go
client.ResetRoundTrips()

// Make some calls
client.Call("a").Await()
client.Call("b").Await()
client.Call("c").Await()

fmt.Printf("Made %d round trips\n", client.RoundTrips())

// With pipelining, this could be lower
pipe := rpc.NewPipeline(client)
pipe.Add("a")
pipe.Add("b")
pipe.Add("c")
pipe.Execute()
// Potentially fewer round trips due to batching
```

## Context Integration

### Connection with Context

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

client, err := rpc.ConnectContext(ctx, "wss://api.example.do")
if err != nil {
    if errors.Is(err, context.DeadlineExceeded) {
        log.Fatal("Connection timed out")
    }
    log.Fatal(err)
}
```

### Cancellation

The client respects its parent context:

```go
ctx, cancel := context.WithCancel(context.Background())

client, err := rpc.ConnectContext(ctx, "wss://api.example.do")
if err != nil {
    log.Fatal(err)
}

// Later, cancel all operations
cancel()

// The client will close and reject pending calls
```

## Concurrency

### Thread Safety

The `Client` is safe for concurrent use:

```go
client, _ := rpc.Connect("wss://api.example.do")

var wg sync.WaitGroup
for i := 0; i < 100; i++ {
    wg.Add(1)
    go func(n int) {
        defer wg.Done()
        result, err := client.Call("square", n).Await()
        if err != nil {
            log.Printf("Error: %v", err)
            return
        }
        fmt.Printf("%d squared = %v\n", n, result)
    }(i)
}
wg.Wait()
```

### Parallel Calls with errgroup

```go
import "golang.org/x/sync/errgroup"

func LoadUserData(client *rpc.Client, userID int64) (*UserData, error) {
    g, ctx := errgroup.WithContext(context.Background())
    _ = ctx // Available for cancellation

    var user, orders, notifications any
    var userErr, ordersErr, notifErr error

    g.Go(func() error {
        user, userErr = client.Call("users.get", userID).Await()
        return userErr
    })

    g.Go(func() error {
        orders, ordersErr = client.Call("orders.list", userID).Await()
        return ordersErr
    })

    g.Go(func() error {
        notifications, notifErr = client.Call("notifications.list", userID).Await()
        return notifErr
    })

    if err := g.Wait(); err != nil {
        return nil, err
    }

    return &UserData{
        User:          user,
        Orders:        orders,
        Notifications: notifications,
    }, nil
}
```

## Testing

### Mocking the Client

Create a mock client for unit tests:

```go
type MockClient struct {
    Calls    []MockCall
    Handlers map[string]func([]any) (any, error)
}

type MockCall struct {
    Method string
    Args   []any
}

func (m *MockClient) Call(method string, args ...any) *rpc.Promise {
    m.Calls = append(m.Calls, MockCall{Method: method, Args: args})

    if handler, ok := m.Handlers[method]; ok {
        result, err := handler(args)
        if err != nil {
            return rpc.NewRejectedPromise(err)
        }
        return rpc.NewResolvedPromise(result)
    }

    return rpc.NewRejectedPromise(fmt.Errorf("no handler for %s", method))
}
```

### Testing with a Mock Server

```go
func TestSquare(t *testing.T) {
    // Start a mock WebSocket server
    server := httptest.NewServer(http.HandlerFunc(handleWS))
    defer server.Close()

    wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

    client, err := rpc.Connect(wsURL)
    if err != nil {
        t.Fatalf("Connect failed: %v", err)
    }
    defer client.Close()

    result, err := client.Call("square", 5).Await()
    if err != nil {
        t.Fatalf("Call failed: %v", err)
    }

    if result != 25.0 {
        t.Errorf("Expected 25, got %v", result)
    }
}
```

### Integration Tests

```go
func TestIntegration(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }

    serverURL := os.Getenv("TEST_SERVER_URL")
    if serverURL == "" {
        serverURL = "ws://localhost:8080"
    }

    client, err := rpc.Connect(serverURL)
    if err != nil {
        t.Fatalf("Connect failed: %v", err)
    }
    defer client.Close()

    // Run tests against real server
    tests := []struct {
        name   string
        method string
        args   []any
        expect any
    }{
        {"square_5", "square", []any{5.0}, 25.0},
        {"square_negative", "square", []any{-3.0}, 9.0},
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            result, err := client.Call(tc.method, tc.args...).Await()
            if err != nil {
                t.Fatalf("Call failed: %v", err)
            }
            if !reflect.DeepEqual(result, tc.expect) {
                t.Errorf("Expected %v, got %v", tc.expect, result)
            }
        })
    }
}
```

### Table-Driven Tests

```go
func TestFibonacci(t *testing.T) {
    client := setupTestClient(t)
    defer client.Close()

    tests := []struct {
        n      int
        expect []float64
    }{
        {1, []float64{0}},
        {2, []float64{0, 1}},
        {5, []float64{0, 1, 1, 2, 3}},
        {10, []float64{0, 1, 1, 2, 3, 5, 8, 13, 21, 34}},
    }

    for _, tc := range tests {
        t.Run(fmt.Sprintf("fib_%d", tc.n), func(t *testing.T) {
            result, err := client.Call("generateFibonacci", float64(tc.n)).Await()
            if err != nil {
                t.Fatalf("Call failed: %v", err)
            }

            got, ok := result.([]float64)
            if !ok {
                t.Fatalf("Expected []float64, got %T", result)
            }

            if !reflect.DeepEqual(got, tc.expect) {
                t.Errorf("Expected %v, got %v", tc.expect, got)
            }
        })
    }
}
```

## Complete Examples

### Example: Chat Application

```go
package main

import (
    "bufio"
    "fmt"
    "log"
    "os"

    rpc "go.rpc.do"
)

func main() {
    client, err := rpc.Connect("wss://chat.example.do",
        rpc.WithReconnect(10, time.Second),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Export message handler
    client.Export("onMessage", func(msg any) any {
        message := msg.(map[string]any)
        fmt.Printf("[%s]: %s\n", message["from"], message["text"])
        return nil
    })

    // Join a room
    room, err := client.Call("joinRoom", "general", client.Self()).Await()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println("Joined room. Type messages and press Enter.")

    // Read and send messages
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        text := scanner.Text()
        if text == "/quit" {
            break
        }

        _, err := client.Call("sendMessage", room, text).Await()
        if err != nil {
            log.Printf("Failed to send: %v", err)
        }
    }
}
```

### Example: Data Processing Pipeline

```go
package main

import (
    "fmt"
    "log"

    rpc "go.rpc.do"
)

func main() {
    client, err := rpc.Connect("wss://data.example.do")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Fetch data, transform on server, aggregate locally
    result := client.Call("fetchLargeDataset", "users").
        Map(func(user any) any {
            // This transformation happens on the server
            return client.Call("enrichUser", user)
        }).
        Then(func(users any) any {
            // This aggregation happens locally
            slice := users.([]any)
            var totalAge float64
            for _, u := range slice {
                user := u.(map[string]any)
                totalAge += user["age"].(float64)
            }
            return map[string]any{
                "count":      len(slice),
                "averageAge": totalAge / float64(len(slice)),
            }
        })

    stats, err := result.Await()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Statistics: %v\n", stats)
}
```

### Example: Monitoring Dashboard

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    rpc "go.rpc.do"
)

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    client, err := rpc.ConnectContext(ctx, "wss://monitor.example.do",
        rpc.WithReconnect(0, 0), // Infinite reconnects
    )
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Subscribe to metrics updates
    client.Export("onMetrics", func(metrics any) any {
        m := metrics.(map[string]any)
        fmt.Printf("\033[2J\033[H") // Clear screen
        fmt.Println("=== System Metrics ===")
        fmt.Printf("CPU:    %.1f%%\n", m["cpu"])
        fmt.Printf("Memory: %.1f%%\n", m["memory"])
        fmt.Printf("Disk:   %.1f%%\n", m["disk"])
        fmt.Printf("Network: %.2f MB/s\n", m["network"])
        return nil
    })

    // Register for updates
    _, err = client.Call("subscribeMetrics", client.Self(), time.Second).Await()
    if err != nil {
        log.Fatal(err)
    }

    // Keep running until interrupted
    select {}
}
```

### Example: Batch Operations with Pipelining

```go
package main

import (
    "fmt"
    "log"

    rpc "go.rpc.do"
)

func main() {
    client, err := rpc.Connect("wss://api.example.do")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Create multiple counters in a single pipeline
    pipe := rpc.NewPipeline(client)

    counters := make([]string, 5)
    for i := 0; i < 5; i++ {
        name := fmt.Sprintf("counter%d", i)
        counters[i] = name
        pipe.AddAs(name, "makeCounter", float64(i*10))
    }

    if err := pipe.Execute(); err != nil {
        log.Fatal(err)
    }

    results, err := pipe.Results()
    if err != nil {
        log.Fatal(err)
    }

    // Increment all counters and get final values
    for _, name := range counters {
        counterRef := results[name].(*rpc.Promise)

        // Pipeline operations on each counter
        counterRef.Call("increment", 5)
        counterRef.Call("increment", 3)

        value, err := counterRef.Call("value").Await()
        if err != nil {
            log.Printf("Error getting %s value: %v", name, err)
            continue
        }
        fmt.Printf("%s = %v\n", name, value)
    }
}
```

## API Reference

### Types

```go
// Client represents an RPC connection to a DotDo service.
type Client struct { ... }

// Promise represents an asynchronous RPC result.
type Promise struct { ... }

// Capability represents a remote capability reference.
type Capability struct { ... }

// RPCError represents an error returned by the RPC server.
type RPCError struct {
    Type    string
    Message string
    Code    string
}

// PromiseState represents the state of a Promise.
type PromiseState int
const (
    PromisePending PromiseState = iota
    PromiseFulfilled
    PromiseRejected
)

// Option configures the Client.
type Option func(*clientConfig)

// Pipeline enables batching multiple calls.
type Pipeline struct { ... }

// Proxy provides a dynamic interface for calling RPC methods.
type Proxy[T any] struct { ... }

// Stub creates a dynamic stub that implements interface T.
type Stub[T any] struct { ... }

// DynamicProxy is a non-generic proxy for dynamic method invocation.
type DynamicProxy struct { ... }

// MethodProxy wraps a single method for repeated invocation.
type MethodProxy struct { ... }

// Collection represents a remote collection.
type Collection[T any] struct { ... }

// ServerMap represents a server-side map operation.
type ServerMap struct { ... }
```

### Functions

```go
// Connection
func Connect(service string, opts ...Option) (*Client, error)
func ConnectContext(ctx context.Context, service string, opts ...Option) (*Client, error)

// Options
func WithTimeout(d time.Duration) Option
func WithHeaders(headers http.Header) Option
func WithDialer(d *websocket.Dialer) Option
func WithReconnect(maxAttempts int, delay time.Duration) Option

// Client methods
func (c *Client) Call(method string, args ...any) *Promise
func (c *Client) Export(name string, fn any)
func (c *Client) Self() *Client
func (c *Client) IsConnected() bool
func (c *Client) RoundTrips() int
func (c *Client) ResetRoundTrips()
func (c *Client) Close() error

// Promise methods
func (p *Promise) Await() (any, error)
func (p *Promise) State() PromiseState
func (p *Promise) IsPending() bool
func (p *Promise) IsFulfilled() bool
func (p *Promise) IsRejected() bool
func (p *Promise) Then(fn func(any) any) *Promise
func (p *Promise) Map(fn func(any) any) *Promise
func (p *Promise) Call(method string, args ...any) *Promise

// Pipeline functions
func NewPipeline(client *Client) *Pipeline
func (p *Pipeline) Add(method string, args ...any) *Promise
func (p *Pipeline) AddAs(name, method string, args ...any) *Promise
func (p *Pipeline) Ref(name string) *Promise
func (p *Pipeline) Execute() error
func (p *Pipeline) Results() (map[string]any, error)

// Proxy functions
func NewProxy[T any](client *Client, target string) *Proxy[T]
func (p *Proxy[T]) Call(method string, args ...any) *Promise
func (p *Proxy[T]) Get(property string) *Promise

func NewStub[T any](client *Client, target string) *Stub[T]
func (s *Stub[T]) CallMethod(method string, args ...any) *Promise

func NewDynamicProxy(client *Client) *DynamicProxy
func (p *DynamicProxy) Get(segment string) *DynamicProxy
func (p *DynamicProxy) Call(args ...any) *Promise
func (p *DynamicProxy) Invoke(method string, args ...any) *Promise

func NewMethodProxy(client *Client, method string) *MethodProxy
func (m *MethodProxy) Call(args ...any) *Promise
func (m *MethodProxy) Invoke(args ...any) *Promise

// Collection functions
func NewCollection[T any](client *Client, source *Promise) *Collection[T]
func (c *Collection[T]) Map(fn func(T) any) *Promise
func (c *Collection[T]) Filter(predicate func(T) bool) *Collection[T]
func (c *Collection[T]) Collect() ([]T, error)
func (c *Collection[T]) First() (*T, error)
func (c *Collection[T]) Count() (int, error)

// Server-side map functions
func Remap(client *Client, source *Promise, fn MapFunc) *Promise
func RemapWithCaptures(client *Client, source *Promise, captures map[string]any, fn func(any, map[string]any) any) *Promise

func NewServerMap(client *Client, source *Promise) *ServerMap
func (m *ServerMap) Expression(expr string) *ServerMap
func (m *ServerMap) Capture(name string, value any) *ServerMap
func (m *ServerMap) CaptureSelf() *ServerMap
func (m *ServerMap) Execute() *Promise

// Reflection
func ReflectCall(client *Client, method string, args ...any) ([]reflect.Value, error)
```

### Error Variables

```go
var ErrNotConnected = errors.New("rpc: not connected")
var ErrConnectionClosed = errors.New("rpc: connection closed")
var ErrTimeout = errors.New("rpc: operation timed out")
var ErrPromiseRejected = errors.New("rpc: promise rejected")
var ErrPromiseCanceled = errors.New("rpc: promise canceled")
```

## Best Practices

### 1. Always Close Connections

```go
client, err := rpc.Connect("wss://api.example.do")
if err != nil {
    return err
}
defer client.Close() // Always defer close
```

### 2. Handle Errors at Every Level

```go
result, err := client.Call("operation").Await()
if err != nil {
    // Log with context
    log.Printf("operation failed: %v", err)

    // Check error types
    var rpcErr *rpc.RPCError
    if errors.As(err, &rpcErr) {
        // Handle specific error types
    }

    // Wrap and return
    return fmt.Errorf("operation: %w", err)
}
```

### 3. Use Pipelining for Dependent Calls

```go
// BAD: Multiple round trips
user, _ := client.Call("getUser", id).Await()
profile, _ := client.Call("getProfile", user["profileId"]).Await()

// GOOD: Pipelined
userPromise := client.Call("getUser", id)
profilePromise := userPromise.Call("getProfile")
profile, err := profilePromise.Await() // Single logical operation
```

### 4. Use Server-Side Map for Large Collections

```go
// BAD: Transfer all data, transform locally
data, _ := client.Call("getLargeDataset").Await()
transformed := transform(data)

// GOOD: Transform on server
transformed := client.Call("getLargeDataset").Map(func(item any) any {
    return client.Call("transformItem", item)
})
result, _ := transformed.Await()
```

### 5. Configure Reconnection for Production

```go
client, err := rpc.Connect("wss://api.example.do",
    rpc.WithReconnect(10, time.Second), // Auto-reconnect
    rpc.WithTimeout(30*time.Second),     // Reasonable timeout
)
```

### 6. Use Named Pipeline Results

```go
pipe := rpc.NewPipeline(client)
pipe.AddAs("user", "getUser", id)      // Named for easy reference
pipe.AddAs("orders", "getOrders", id)
pipe.Execute()

results, _ := pipe.Results()
fmt.Println(results["user"])
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines.

## Related Packages

- [capnweb](../capnweb/) - Low-level Cap'n Proto over WebSocket
- [rpc.do](https://rpc.do) - TypeScript/JavaScript SDK

## Links

- [Documentation](https://pkg.go.dev/go.rpc.do)
- [Examples](./examples/)
- [Conformance Tests](../../../test/conformance/)
