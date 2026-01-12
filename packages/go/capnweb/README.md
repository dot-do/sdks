# capnweb

A Go client for Cap'n Web - capability-based RPC built for Go's idioms.

```go
user, err := users.Get(ctx, 123)
```

Context for cancellation. Value and error. The Go way.

## Key Features

- **Context-first** - Every call respects `context.Context` for timeouts, cancellation, and tracing
- **Errors are values** - Standard `(value, error)` returns with `errors.Is/As` support
- **Interface contracts** - Define APIs as Go interfaces, mock for tests
- **Promise pipelining** - Chain dependent calls in a single round trip
- **Bidirectional RPC** - Export local services, receive remote calls
- **Full protocol support** - Transports, streaming, remap operations

**Requirements**: Go 1.21+

## Installation

```bash
go get github.com/dot-do/sdks/packages/go/capnweb
```

## Quick Start

```go
package main

import (
    "context"
    "errors"
    "log"
    "os"

    "github.com/dot-do/sdks/packages/go/capnweb"
)

// Define your API as a Go interface
type UsersAPI interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, name, email string) (*User, error)
    List(ctx context.Context, opts ListOpts) ([]*User, error)
}

type User struct {
    ID    int64
    Name  string
    Email string
}

type ListOpts struct {
    Limit  int
    Offset int
}

func main() {
    ctx := context.Background()

    // Connect via WebSocket
    session, err := capnweb.Dial(ctx, "wss://api.example.com",
        capnweb.WithAuth(os.Getenv("API_KEY")),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Get a typed stub - the stub implements your interface
    users := capnweb.Stub[UsersAPI](session, "users")

    // Make calls - standard Go patterns
    user, err := users.Get(ctx, 123)
    if err != nil {
        var rpcErr *capnweb.Error
        if errors.As(err, &rpcErr) {
            log.Printf("RPC error: %s - %s", rpcErr.Code, rpcErr.Message)
        }
        log.Fatal(err)
    }

    log.Printf("Hello, %s", user.Name)
}
```

## Defining APIs

Your remote API is a Go interface. Methods follow one rule:

```go
func(ctx context.Context, args...) (Result, error)
func(ctx context.Context, args...) error  // for void returns
```

```go
type OrdersAPI interface {
    Get(ctx context.Context, id string) (*Order, error)
    Create(ctx context.Context, req CreateOrderReq) (*Order, error)
    Cancel(ctx context.Context, id string) error
    ListForUser(ctx context.Context, userID int64, opts PageOpts) ([]*Order, error)
}

type PaymentsAPI interface {
    Charge(ctx context.Context, orderID string, amount int64) (*Payment, error)
    Refund(ctx context.Context, paymentID string) error
}
```

The interface is your contract. Cap'n Web handles the wire protocol.

## Making Calls

```go
// Get typed stubs
orders := capnweb.Stub[OrdersAPI](session, "orders")
payments := capnweb.Stub[PaymentsAPI](session, "payments")

// Call methods - they return (value, error) like any Go function
order, err := orders.Get(ctx, "ord_123")
if err != nil {
    return fmt.Errorf("get order: %w", err)
}

// Context controls timeouts
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()

order, err = orders.Get(ctx, "ord_123")
if errors.Is(err, context.DeadlineExceeded) {
    // Handle timeout
}
```

## Error Handling

Errors are values. Handle them the Go way with `errors.Is` and `errors.As`.

### Error Codes

Cap'n Web defines error codes as string constants:

```go
// Error code constants
const (
    CodeNotFound         = "not_found"
    CodePermissionDenied = "permission_denied"
    CodeRateLimited      = "rate_limited"
    CodeInvalidArgument  = "invalid_argument"
    CodeInternal         = "internal"
)

// Sentinel errors for connection-level issues
var (
    ErrDisconnected = errors.New("capnweb: disconnected")
    ErrClosed       = errors.New("capnweb: session closed")
)
```

### Inspecting Errors

```go
user, err := users.Get(ctx, 123)
if err != nil {
    // Check for RPC errors
    var rpcErr *capnweb.Error
    if errors.As(err, &rpcErr) {
        switch rpcErr.Code {
        case capnweb.CodeNotFound:
            return nil, ErrUserNotFound
        case capnweb.CodePermissionDenied:
            return nil, ErrForbidden
        case capnweb.CodeRateLimited:
            // Error includes retry metadata
            time.Sleep(rpcErr.RetryAfter())
            return users.Get(ctx, 123)
        }
        // Access additional details
        if detail, ok := rpcErr.Details["field"]; ok {
            log.Printf("Field error: %v", detail)
        }
    }

    // Connection-level errors
    if errors.Is(err, capnweb.ErrDisconnected) {
        // Handle disconnection
    }

    // Context errors propagate naturally
    if errors.Is(err, context.DeadlineExceeded) {
        // Timeout
    }
    if errors.Is(err, context.Canceled) {
        // Canceled
    }

    return nil, fmt.Errorf("get user %d: %w", 123, err)
}
```

### The Error Type

```go
// Error represents an RPC error from the remote service
type Error struct {
    Code    string         // Error code (e.g., "not_found")
    Message string         // Human-readable message
    Details map[string]any // Additional structured data
}

func (e *Error) Error() string           // Implements error interface
func (e *Error) RetryAfter() time.Duration // For rate limiting
```

### Returning Errors from Services

```go
func (s *usersService) Get(ctx context.Context, id int64) (*User, error) {
    user, err := s.db.FindUser(ctx, id)
    if errors.Is(err, sql.ErrNoRows) {
        return nil, &capnweb.Error{
            Code:    capnweb.CodeNotFound,
            Message: fmt.Sprintf("user %d not found", id),
        }
    }
    if err != nil {
        return nil, fmt.Errorf("database error: %w", err)
    }
    return user, nil
}

func (s *usersService) Create(ctx context.Context, name, email string) (*User, error) {
    if name == "" {
        return nil, &capnweb.Error{
            Code:    capnweb.CodeInvalidArgument,
            Message: "name is required",
            Details: map[string]any{"field": "name"},
        }
    }
    // ...
}
```

## Pipelining

Pipelining sends dependent calls before receiving responses - one round trip instead of many.

### The Problem

```go
// Without pipelining: 3 sequential round trips
user, _ := users.Get(ctx, 123)                    // Round trip 1
profile, _ := profiles.Get(ctx, user.ProfileID)   // Round trip 2 (waits for 1)
avatar, _ := avatars.Get(ctx, profile.AvatarID)   // Round trip 3 (waits for 2)
```

### Solution 1: Ref Methods

For simple pipelines, use the `Ref` variant of methods. Every stub method `Foo` has a corresponding `FooRef` that returns a `Ref[T]` instead of `(T, error)`:

```go
users := capnweb.Stub[UsersAPI](session, "users")

// Build pipeline - nothing sent yet
userRef := users.GetRef(ctx, 123)

// Access nested fields through the ref
profileID := capnweb.Field[int64](userRef, "ProfileID")
avatarURL := capnweb.Field[string](
    capnweb.Field[*Profile](userRef, "Profile"),
    "AvatarURL",
)

// Execute - ONE round trip, get final value
url, err := avatarURL.Await(ctx)
if err != nil {
    return "", fmt.Errorf("get avatar: %w", err)
}
```

### Solution 2: Pipeline Builder

For complex chains involving multiple services:

```go
pipe := capnweb.NewPipeline(session)

// Build the pipeline with type-safe calls
userRef := capnweb.PipeCall[*User](pipe, "users", "Get", 123)
profileRef := capnweb.PipeCall[*Profile](pipe, "profiles", "Get",
    capnweb.Field[int64](userRef, "ProfileID"))
avatarRef := capnweb.PipeCall[*Avatar](pipe, "avatars", "Get",
    capnweb.Field[string](profileRef, "AvatarID"))

// Execute entire chain - ONE round trip
if err := pipe.Execute(ctx); err != nil {
    return nil, fmt.Errorf("pipeline failed: %w", err)
}

// Extract results - type-safe
avatar, err := avatarRef.Value()
if err != nil {
    return nil, err
}
```

### Solution 3: Parallel Calls with errgroup

For independent calls that can run concurrently:

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)

var user *User
var orders []*Order
var notifications []*Notification

g.Go(func() error {
    var err error
    user, err = users.Get(ctx, userID)
    return err
})

g.Go(func() error {
    var err error
    orders, err = ordersAPI.ListForUser(ctx, userID, PageOpts{})
    return err
})

g.Go(func() error {
    var err error
    notifications, err = notificationsAPI.ListForUser(ctx, userID, PageOpts{})
    return err
})

if err := g.Wait(); err != nil {
    return nil, err
}
// All three calls were multiplexed over the connection
```

### Remap Operations

Transform data on the server before sending results. Useful for reducing bandwidth when you only need part of a large response:

```go
// Get only the names of all users, transformed server-side
names, err := capnweb.Remap(ctx, session,
    capnweb.Import("users"),       // Source: users service
    capnweb.Path("List"),          // Method to call
    capnweb.Args(ListOpts{}),      // Arguments
    func(user *User) string {      // Transform function
        return user.Name
    },
)
// Server applies the transform, only names are sent over the wire
```

For more complex remaps with captured references:

```go
// Server-side join: for each order, fetch its user
results, err := capnweb.RemapWithCaptures(ctx, session,
    capnweb.Import("orders"),
    capnweb.Path("ListRecent"),
    capnweb.Args(100),
    []capnweb.Capture{
        capnweb.CaptureImport("users"), // Capture users service
    },
    func(order *Order, users UsersAPI) *OrderWithUser {
        user, _ := users.Get(ctx, order.UserID)
        return &OrderWithUser{Order: order, User: user}
    },
)
```

## Exposing Local Services

Export Go types to receive remote calls.

```go
type Calculator struct{}

func (c *Calculator) Add(ctx context.Context, a, b int) (int, error) {
    return a + b, nil
}

func (c *Calculator) Divide(ctx context.Context, a, b int) (int, error) {
    if b == 0 {
        return 0, &capnweb.Error{
            Code:    capnweb.CodeInvalidArgument,
            Message: "division by zero",
        }
    }
    return a / b, nil
}

// Export with a name
session.Export("calculator", &Calculator{})
```

Remote clients call your methods:

```go
// On the remote side
type CalculatorAPI interface {
    Add(ctx context.Context, a, b int) (int, error)
    Divide(ctx context.Context, a, b int) (int, error)
}

calc := capnweb.Stub[CalculatorAPI](session, "calculator")
result, err := calc.Add(ctx, 40, 2) // 42
```

### Method Requirements

- First argument must be `context.Context`
- Return `(T, error)` or just `error`
- Exported methods only (uppercase first letter)
- Arguments and return types must be JSON-serializable

## Streaming

Return channels for streaming data:

```go
type EventsAPI interface {
    Subscribe(ctx context.Context, topic string) (<-chan Event, error)
}

events := capnweb.Stub[EventsAPI](session, "events")

ch, err := events.Subscribe(ctx, "user.created")
if err != nil {
    return err
}

for event := range ch {
    log.Printf("Event: %+v", event)
    // Channel closes when context is canceled or stream ends
}
```

Implement streaming on the server:

```go
func (s *EventService) Subscribe(ctx context.Context, topic string) (<-chan Event, error) {
    ch := make(chan Event)
    go func() {
        defer close(ch)
        sub := s.pubsub.Subscribe(topic)
        defer sub.Unsubscribe()

        for {
            select {
            case <-ctx.Done():
                return
            case event := <-sub.C:
                select {
                case ch <- event:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()
    return ch, nil
}
```

## Transports

Cap'n Web supports multiple transport mechanisms:

### WebSocket (Default)

Persistent bidirectional connection, ideal for most use cases:

```go
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithAuth("bearer-token"),
)
```

### HTTP Batch

Stateless HTTP POST, batches multiple calls per request. Good for serverless or when WebSockets aren't available:

```go
session, err := capnweb.DialHTTP(ctx, "https://api.example.com/rpc",
    capnweb.WithAuth("bearer-token"),
    capnweb.WithBatchWindow(10*time.Millisecond), // Collect calls for batching
)
```

### Custom Transport

Implement the `Transport` interface for custom protocols:

```go
type Transport interface {
    Send(ctx context.Context, msg []byte) error
    Receive(ctx context.Context) ([]byte, error)
    Close() error
}

// Use with any transport
session := capnweb.NewSession(myTransport, opts...)
```

## Session Options

```go
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithAuth("bearer-token"),
    capnweb.WithTimeout(30*time.Second),
    capnweb.WithReconnect(capnweb.ReconnectConfig{
        MaxAttempts: 5,
        InitialDelay: 100*time.Millisecond,
        MaxDelay: 10*time.Second,
    }),
    capnweb.WithCompression(true),
    capnweb.WithLogger(slog.Default()),
)
```

| Option | Description |
|--------|-------------|
| `WithAuth(token)` | Bearer token authentication |
| `WithTimeout(d)` | Connection timeout |
| `WithReconnect(cfg)` | Auto-reconnect configuration |
| `WithCompression(bool)` | Enable WebSocket compression |
| `WithLogger(logger)` | Structured logging via slog |
| `WithTLS(cfg)` | Custom TLS configuration |

## Resource Management

### Session Lifecycle

```go
// Sessions should be long-lived and reused
session, err := capnweb.Dial(ctx, url)
if err != nil {
    return err
}
defer session.Close() // Always close when done

// Check session health
if !session.IsConnected() {
    // Handle disconnection
}

// Wait for graceful shutdown
<-session.Done()
```

### Context Cancellation

All operations respect context cancellation:

```go
// Timeout for a single call
ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
defer cancel()
user, err := users.Get(ctx, 123)

// Cancel propagates to the server
ctx, cancel := context.WithCancel(ctx)
go func() {
    time.Sleep(time.Second)
    cancel() // This cancels the in-flight request
}()
result, err := longRunningOp.Execute(ctx)
if errors.Is(err, context.Canceled) {
    // Request was canceled
}
```

## Dynamic Client

When you don't have type definitions or need dynamic access:

```go
dyn := session.Dynamic()

// Call any method dynamically
result, err := dyn.Call(ctx, "users", "Get", 123)
if err != nil {
    return err
}

// Result is map[string]any for objects
user := result.(map[string]any)
name := user["Name"].(string)

// Access nested paths
bio, err := dyn.Get(ctx, "users", "123", "Profile", "Bio")

// Dynamic pipelining
pipe := dyn.Pipeline()
userRef := pipe.Call("users", "Get", 123)
profileRef := pipe.Call("profiles", "Get", userRef.Field("ProfileID"))
if err := pipe.Execute(ctx); err != nil {
    return err
}
profile := profileRef.Value().(map[string]any)
```

## Testing

Interfaces make testing straightforward:

```go
// Mock implementation
type mockUsers struct{}

func (m *mockUsers) Get(ctx context.Context, id int64) (*User, error) {
    if id == 404 {
        return nil, &capnweb.Error{Code: capnweb.CodeNotFound}
    }
    return &User{ID: id, Name: "Test User"}, nil
}

func (m *mockUsers) Create(ctx context.Context, name, email string) (*User, error) {
    return &User{ID: 1, Name: name, Email: email}, nil
}

func (m *mockUsers) List(ctx context.Context, opts ListOpts) ([]*User, error) {
    return []*User{{ID: 1, Name: "User 1"}}, nil
}

// Use in tests
func TestUserService(t *testing.T) {
    svc := NewUserService(&mockUsers{})

    user, err := svc.GetUser(context.Background(), 123)
    if err != nil {
        t.Fatal(err)
    }
    if user.Name != "Test User" {
        t.Errorf("got %q, want %q", user.Name, "Test User")
    }
}

// Test error handling
func TestUserNotFound(t *testing.T) {
    svc := NewUserService(&mockUsers{})

    _, err := svc.GetUser(context.Background(), 404)
    if err == nil {
        t.Fatal("expected error")
    }

    var rpcErr *capnweb.Error
    if !errors.As(err, &rpcErr) || rpcErr.Code != capnweb.CodeNotFound {
        t.Errorf("expected not found error, got %v", err)
    }
}
```

### Integration Testing

```go
func TestIntegration(t *testing.T) {
    if testing.Short() {
        t.Skip("skipping integration test")
    }

    ctx := context.Background()
    session, err := capnweb.Dial(ctx, os.Getenv("TEST_API_URL"),
        capnweb.WithAuth(os.Getenv("TEST_API_KEY")),
    )
    if err != nil {
        t.Fatal(err)
    }
    defer session.Close()

    users := capnweb.Stub[UsersAPI](session, "users")

    // Test real API
    user, err := users.Create(ctx, "Integration Test", "test@example.com")
    if err != nil {
        t.Fatal(err)
    }

    // Cleanup
    t.Cleanup(func() {
        // Delete test user
    })
}
```

## Security Considerations

### Authentication

Always use TLS in production and pass tokens securely:

```go
// Good: Token from environment
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithAuth(os.Getenv("API_KEY")),
)

// Good: Token from secure secret manager
token, err := secretManager.GetSecret(ctx, "api-key")
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithAuth(token),
)
```

### Input Validation

Always validate inputs in your exported services:

```go
func (s *service) Create(ctx context.Context, req CreateReq) (*Result, error) {
    if req.Name == "" || len(req.Name) > 100 {
        return nil, &capnweb.Error{
            Code:    capnweb.CodeInvalidArgument,
            Message: "name must be 1-100 characters",
        }
    }
    // ... rest of implementation
}
```

### Context Values

Cap'n Web can propagate context values for tracing:

```go
// Client side - add trace ID
ctx = capnweb.WithTraceID(ctx, "trace-123")
user, err := users.Get(ctx, 123)

// Server side - extract trace ID
func (s *service) Get(ctx context.Context, id int64) (*User, error) {
    traceID := capnweb.TraceIDFromContext(ctx)
    log.Printf("[%s] Getting user %d", traceID, id)
    // ...
}
```

## Complete Example

```go
package main

import (
    "context"
    "errors"
    "log"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/dot-do/sdks/packages/go/capnweb"
)

// Remote API contracts
type UsersAPI interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, name, email string) (*User, error)
    List(ctx context.Context, opts ListOpts) ([]*User, error)
}

type User struct {
    ID        int64
    Name      string
    Email     string
    Profile   *Profile
    CreatedAt time.Time
}

type Profile struct {
    Bio       string
    AvatarURL string
}

type ListOpts struct {
    Limit  int
    Offset int
}

// Local service we expose for bidirectional RPC
type EchoService struct{}

func (e *EchoService) Echo(ctx context.Context, msg string) (string, error) {
    return msg, nil
}

func (e *EchoService) Reverse(ctx context.Context, msg string) (string, error) {
    runes := []rune(msg)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes), nil
}

func main() {
    // Graceful shutdown setup
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    // Connect with options
    session, err := capnweb.Dial(ctx, "wss://api.example.com",
        capnweb.WithAuth(os.Getenv("API_KEY")),
        capnweb.WithReconnect(capnweb.ReconnectConfig{
            MaxAttempts: 3,
            InitialDelay: 100*time.Millisecond,
        }),
    )
    if err != nil {
        log.Fatalf("Failed to connect: %v", err)
    }
    defer session.Close()

    // Export local service for bidirectional RPC
    session.Export("echo", &EchoService{})

    // Get typed stub for remote API
    users := capnweb.Stub[UsersAPI](session, "users")

    // Make a call with proper error handling
    user, err := users.Get(ctx, 123)
    if err != nil {
        var rpcErr *capnweb.Error
        if errors.As(err, &rpcErr) {
            switch rpcErr.Code {
            case capnweb.CodeNotFound:
                log.Printf("User not found")
                return
            case capnweb.CodePermissionDenied:
                log.Printf("Access denied: %s", rpcErr.Message)
                return
            }
        }
        log.Fatalf("Failed to get user: %v", err)
    }

    log.Printf("User: %s <%s>", user.Name, user.Email)

    // Demonstrate pipelining
    pipe := capnweb.NewPipeline(session)
    userRef := capnweb.PipeCall[*User](pipe, "users", "Get", 123)
    avatarURL := capnweb.Field[string](
        capnweb.Field[*Profile](userRef, "Profile"),
        "AvatarURL",
    )

    if err := pipe.Execute(ctx); err != nil {
        log.Fatalf("Pipeline failed: %v", err)
    }

    url, _ := avatarURL.Value()
    log.Printf("Avatar URL: %s", url)

    // Keep alive for bidirectional calls until shutdown signal
    log.Println("Service running. Press Ctrl+C to exit.")
    <-ctx.Done()
    log.Println("Shutting down gracefully...")
}
```

## API Reference

```go
package capnweb

// Session manages a Cap'n Web connection
type Session struct{}

func Dial(ctx context.Context, url string, opts ...Option) (*Session, error)
func DialHTTP(ctx context.Context, url string, opts ...Option) (*Session, error)
func NewSession(transport Transport, opts ...Option) *Session

func (s *Session) Close() error
func (s *Session) Done() <-chan struct{}
func (s *Session) IsConnected() bool
func (s *Session) Export(name string, target any)
func (s *Session) Dynamic() *DynamicClient

// Stub returns a typed client implementing the interface T
func Stub[T any](s *Session, name string) T

// Ref is a reference to an unresolved value, enabling pipelining
type Ref[T any] interface {
    Await(ctx context.Context) (T, error)  // Block until resolved
    Value() (T, error)                      // Get value after Execute()
}

// Field extracts a typed field from a Ref
func Field[T any](ref Ref[any], name string) Ref[T]

// Pipeline builds explicit multi-call pipelines
type Pipeline struct{}

func NewPipeline(s *Session) *Pipeline
func (p *Pipeline) Execute(ctx context.Context) error

// PipeCall adds a typed call to the pipeline
func PipeCall[T any](p *Pipeline, service, method string, args ...any) Ref[T]

// Remap performs a server-side map operation
func Remap[T, R any](ctx context.Context, s *Session,
    source Import, path Path, args Args, fn func(T) R) ([]R, error)

// Transport interface for custom protocols
type Transport interface {
    Send(ctx context.Context, msg []byte) error
    Receive(ctx context.Context) ([]byte, error)
    Close() error
}

// Error represents an RPC error
type Error struct {
    Code    string
    Message string
    Details map[string]any
}

func (e *Error) Error() string
func (e *Error) RetryAfter() time.Duration

// Error codes
const (
    CodeNotFound         = "not_found"
    CodePermissionDenied = "permission_denied"
    CodeRateLimited      = "rate_limited"
    CodeInvalidArgument  = "invalid_argument"
    CodeInternal         = "internal"
)

// Sentinel errors
var (
    ErrDisconnected = errors.New("capnweb: disconnected")
    ErrClosed       = errors.New("capnweb: session closed")
)
```

## License

MIT
