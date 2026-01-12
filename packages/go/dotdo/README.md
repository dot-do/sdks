# go.platform.do

The official Go SDK for the DotDo platform. This package provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`go.platform.do` is the highest-level SDK in the DotDo stack, built on top of:

- **[go.rpc.do](../rpc)** - Type-safe RPC client
- **[go.capnweb.do](../capnweb)** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Go API.

```
+------------------+
| go.platform.do   |  <-- You are here (auth, pooling, retries)
+------------------+
|   go.rpc.do      |  <-- RPC client layer
+------------------+
| go.capnweb.do    |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **Context Support**: Full `context.Context` integration for cancellation and timeouts
- **Type Safety**: Strongly typed interfaces and error handling
- **Graceful Shutdown**: Clean connection cleanup with `Close()`

## Installation

```bash
go get go.platform.do
```

## Quick Start

### Basic Usage

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    "go.platform.do"
)

func main() {
    ctx := context.Background()

    // Create a client
    client, err := dotdo.New(ctx, dotdo.Options{
        APIKey: os.Getenv("DOTDO_API_KEY"),
    })
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Make an RPC call
    result, err := client.Call(ctx, "ai.generate", map[string]any{
        "prompt": "Hello, world!",
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(result)
}
```

### Using Collections

```go
package main

import (
    "context"
    "fmt"
    "log"

    "go.platform.do"
)

func main() {
    ctx := context.Background()

    client, err := dotdo.New(ctx, dotdo.Options{
        APIKey: "your-api-key",
    })
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Get a collection reference
    users := client.Collection("users")

    // Create a document
    err = users.Set(ctx, "user-123", map[string]any{
        "name":  "Alice",
        "email": "alice@example.com",
    })
    if err != nil {
        log.Fatal(err)
    }

    // Read a document
    user, err := users.Get(ctx, "user-123")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("User: %v\n", user)

    // Query documents
    results, err := users.Query().
        Where("name", "==", "Alice").
        Limit(10).
        Execute(ctx)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Found %d users\n", len(results))
}
```

## Configuration Options

### Options Struct

```go
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
```

### Default Options

```go
func DefaultOptions() Options {
    return Options{
        Endpoint:   "wss://api.dotdo.dev/rpc",
        Timeout:    30 * time.Second,
        MaxRetries: 3,
        RetryDelay: 100 * time.Millisecond,
        PoolSize:   10,
        Debug:      false,
    }
}
```

### Full Configuration Example

```go
client, err := dotdo.New(ctx, dotdo.Options{
    APIKey:     os.Getenv("DOTDO_API_KEY"),
    Endpoint:   "wss://api.dotdo.dev/rpc",
    Timeout:    60 * time.Second,
    MaxRetries: 5,
    RetryDelay: 200 * time.Millisecond,
    PoolSize:   20,
    Debug:      true,
})
```

## Authentication

### API Key

```go
client, err := dotdo.New(ctx, dotdo.Options{
    APIKey: "your-api-key",
})
```

### Environment Variable

```bash
export DOTDO_API_KEY=your-api-key
```

```go
client, err := dotdo.New(ctx, dotdo.Options{
    APIKey: os.Getenv("DOTDO_API_KEY"),
})
```

## Connection Pooling

The SDK maintains a pool of WebSocket connections for efficiency:

```go
client, err := dotdo.New(ctx, dotdo.Options{
    PoolSize: 20, // Maximum concurrent connections
})
```

### Pool Behavior

1. Connections are created on-demand up to `PoolSize`
2. Idle connections are reused for subsequent requests
3. If all connections are busy and pool is at capacity, requests wait
4. Connections are automatically cleaned up on `Close()`

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```go
client, err := dotdo.New(ctx, dotdo.Options{
    MaxRetries: 5,
    RetryDelay: 200 * time.Millisecond,
})
```

### Retry Timing

With default settings (RetryDelay: 100ms):

| Attempt | Delay    |
|---------|----------|
| 1       | 0ms      |
| 2       | 100ms    |
| 3       | 200ms    |
| 4       | 400ms    |
| 5       | 800ms    |

### Non-Retryable Errors

Some errors are not retried:
- `ErrUnauthorized` - Authentication failure
- `context.Canceled` - Request was cancelled
- `context.DeadlineExceeded` - Timeout

## Error Handling

### Sentinel Errors

```go
var (
    ErrUnauthorized     = errors.New("dotdo: unauthorized")
    ErrRateLimited      = errors.New("dotdo: rate limited")
    ErrConnectionFailed = errors.New("dotdo: connection failed")
)
```

### Error Checking

```go
result, err := client.Call(ctx, "ai.generate", params)
if err != nil {
    switch {
    case errors.Is(err, dotdo.ErrUnauthorized):
        log.Fatal("Invalid API key")
    case errors.Is(err, dotdo.ErrRateLimited):
        log.Println("Rate limited, backing off...")
        time.Sleep(time.Second)
        // Retry
    case errors.Is(err, dotdo.ErrConnectionFailed):
        log.Println("Connection failed, retrying...")
    case errors.Is(err, context.DeadlineExceeded):
        log.Println("Request timed out")
    default:
        log.Printf("Unknown error: %v", err)
    }
}
```

## Context Integration

All operations accept a `context.Context` for cancellation and timeouts:

### With Timeout

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

result, err := client.Call(ctx, "ai.generate", params)
```

### With Cancellation

```go
ctx, cancel := context.WithCancel(context.Background())

go func() {
    // Cancel after user input
    <-userCancelChan
    cancel()
}()

result, err := client.Call(ctx, "ai.generate", params)
if errors.Is(err, context.Canceled) {
    log.Println("Request was cancelled")
}
```

## Collection API

### CollectionRef

```go
// Get a collection reference
users := client.Collection("users")

// Create/Update a document
err := users.Set(ctx, "doc-id", data)

// Read a document
doc, err := users.Get(ctx, "doc-id")

// Delete a document
err := users.Delete(ctx, "doc-id")

// Query documents
results, err := users.Query().
    Where("field", "==", value).
    OrderBy("created").
    Limit(10).
    Execute(ctx)
```

### QueryBuilder

```go
query := users.Query().
    Where("status", "==", "active").
    Where("age", ">=", 18).
    OrderByDesc("created").
    Offset(20).
    Limit(10)

// Execute the query
results, err := query.Execute(ctx)

// Or get just the first result
first, err := query.First(ctx)
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `==`     | Equal to |
| `!=`     | Not equal to |
| `<`      | Less than |
| `<=`     | Less than or equal |
| `>`      | Greater than |
| `>=`     | Greater than or equal |
| `in`     | In array |

## Graceful Shutdown

Always close the client when done:

```go
client, err := dotdo.New(ctx, options)
if err != nil {
    log.Fatal(err)
}
defer client.Close()

// Or handle shutdown signal
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

go func() {
    <-sigChan
    log.Println("Shutting down...")
    client.Close()
    os.Exit(0)
}()
```

## Platform Features

When connected to the DotDo platform, you get access to:

### Managed Authentication

```go
// Auth is handled automatically with API key
client, _ := dotdo.New(ctx, dotdo.Options{
    APIKey: os.Getenv("DOTDO_API_KEY"),
})
```

### Usage Metrics

```go
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```go
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```go
// Enable debug mode for verbose logging
client, _ := dotdo.New(ctx, dotdo.Options{
    Debug: true,
})
```

## Best Practices

### 1. Use a Single Client Instance

```go
// Good - create once, reuse
var client *dotdo.DotDo

func init() {
    var err error
    client, err = dotdo.New(context.Background(), dotdo.Options{
        APIKey: os.Getenv("DOTDO_API_KEY"),
    })
    if err != nil {
        log.Fatal(err)
    }
}

// Bad - creates new connections each time
func getClient() *dotdo.DotDo {
    client, _ := dotdo.New(context.Background(), options)
    return client
}
```

### 2. Always Use Context

```go
// Good - with timeout
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
result, err := client.Call(ctx, method, args)

// Bad - background context for long operations
result, err := client.Call(context.Background(), method, args)
```

### 3. Handle All Errors

```go
result, err := client.Call(ctx, "ai.generate", params)
if err != nil {
    // Log the error
    log.Printf("Call failed: %v", err)

    // Return appropriate error to caller
    return nil, fmt.Errorf("generate failed: %w", err)
}
```

### 4. Close on Shutdown

```go
func main() {
    client, err := dotdo.New(ctx, options)
    if err != nil {
        log.Fatal(err)
    }

    // Ensure cleanup
    defer client.Close()

    // ... application logic
}
```

## API Reference

### DotDo Type

```go
type DotDo struct {
    // unexported fields
}

// New creates a new DotDo client
func New(ctx context.Context, opts Options) (*DotDo, error)

// Close terminates all connections
func (d *DotDo) Close() error

// Collection returns a collection reference
func (d *DotDo) Collection(name string) *CollectionRef

// Call invokes a remote method
func (d *DotDo) Call(ctx context.Context, method string, args ...any) (any, error)
```

### CollectionRef Type

```go
type CollectionRef struct {
    // unexported fields
}

// Get retrieves a document by ID
func (c *CollectionRef) Get(ctx context.Context, id string) (map[string]any, error)

// Set creates or updates a document
func (c *CollectionRef) Set(ctx context.Context, id string, data map[string]any) error

// Delete removes a document
func (c *CollectionRef) Delete(ctx context.Context, id string) error

// Query returns a query builder
func (c *CollectionRef) Query() *QueryBuilder
```

### QueryBuilder Type

```go
type QueryBuilder struct {
    // unexported fields
}

// Where adds a filter condition
func (q *QueryBuilder) Where(field, op string, value any) *QueryBuilder

// OrderBy sets ascending sort order
func (q *QueryBuilder) OrderBy(field string) *QueryBuilder

// OrderByDesc sets descending sort order
func (q *QueryBuilder) OrderByDesc(field string) *QueryBuilder

// Limit sets maximum results
func (q *QueryBuilder) Limit(n int) *QueryBuilder

// Offset sets number of results to skip
func (q *QueryBuilder) Offset(n int) *QueryBuilder

// Execute runs the query
func (q *QueryBuilder) Execute(ctx context.Context) ([]map[string]any, error)

// First returns the first result
func (q *QueryBuilder) First(ctx context.Context) (map[string]any, error)
```

## Requirements

- Go 1.21+

## License

MIT

## Links

- [Documentation](https://do.md/docs/go)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [Go Package Documentation](https://pkg.go.dev/go.platform.do)
