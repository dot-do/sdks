# Cap'n Web Go Client API

The final API design for `github.com/dot-do/capnweb`.

## Design Principles

1. **Context-first**: Every blocking operation takes `context.Context`
2. **Errors are values**: Standard `(value, error)` returns
3. **Interfaces for contracts**: Define your API as Go interfaces
4. **Pipelining without magic**: Explicit but ergonomic
5. **Zero ceremony start**: Works immediately, scales to production

---

## Core Types

```go
package capnweb

// Session is a multiplexed Cap'n Web connection.
type Session struct { /* ... */ }

// Ref represents an unresolved reference to a remote value.
// It enables pipelining by deferring resolution.
type Ref[T any] interface {
    // Await blocks until the value is available.
    Await(ctx context.Context) (T, error)

    // Field returns a reference to a field on the result.
    // Enables chained pipelining without round trips.
    Field(name string) Ref[any]
}

// Stub creates a typed client from a session.
func Stub[T any](s *Session, name string) T

// Export registers a local object for remote invocation.
func (s *Session) Export(name string, target any)
```

---

## Connection

```go
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithAuth(os.Getenv("API_KEY")),
)
if err != nil {
    return err
}
defer session.Close()
```

**Options:**

```go
capnweb.WithAuth(token string)           // Bearer authentication
capnweb.WithTimeout(d time.Duration)     // Connection timeout
capnweb.WithReconnect(attempts int)      // Auto-reconnect
capnweb.WithCompression(enabled bool)    // WebSocket compression
```

---

## Defining Your API

Define your remote API as a Go interface. Methods must follow the signature:

```go
Method(ctx context.Context, args...) (Result, error)
```

```go
// UsersAPI defines the remote users service contract.
type UsersAPI interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, name, email string) (*User, error)
    Delete(ctx context.Context, id int64) error
    List(ctx context.Context, opts ListOpts) ([]*User, error)
}

type User struct {
    ID      int64
    Name    string
    Email   string
    Profile *Profile
}

type Profile struct {
    Bio    string
    Avatar string
}
```

---

## Making Calls

```go
// Get a typed stub
users := capnweb.Stub[UsersAPI](session, "users")

// Call methods naturally
user, err := users.Get(ctx, 123)
if err != nil {
    return fmt.Errorf("get user: %w", err)
}

fmt.Println(user.Name)
```

That's it. Standard Go.

---

## Pipelining

Pipelining sends dependent calls before receiving responses, eliminating round trips.

### Fluent Chaining

For interfaces that return struct pointers, use the `P` (pipeline) variant:

```go
// Define pipelined interface alongside your regular one
type UsersAPIp interface {
    Get(ctx context.Context, id int64) Ref[*User]
}

// Get the pipelined stub
users := capnweb.Stub[UsersAPIp](session, "users")

// Chain without waiting - ONE round trip total
name, err := users.Get(ctx, 123).
    Field("Profile").
    Field("Bio").
    Await(ctx)
```

### Parallel Calls

Use `errgroup` for concurrent calls that pipeline automatically:

```go
g, ctx := errgroup.WithContext(ctx)

var user *User
var orders []*Order

g.Go(func() error {
    var err error
    user, err = users.Get(ctx, 123)
    return err
})

g.Go(func() error {
    var err error
    orders, err = ordersAPI.ListForUser(ctx, 123)
    return err
})

if err := g.Wait(); err != nil {
    return err
}
// Both calls were pipelined
```

### Explicit Pipeline Builder

For complex pipelines with dependencies:

```go
pipe := capnweb.NewPipeline(session)

userRef := pipe.Call(users.Get, 123)
profileRef := pipe.Call(profiles.GetForUser, userRef.Field("ID"))
avatarRef := profileRef.Field("Avatar")

// Execute entire pipeline in one round trip
results, err := pipe.Execute(ctx)
if err != nil {
    return err
}

avatar := results.Get(avatarRef).(string)
```

---

## Error Handling

Errors follow standard Go patterns with typed inspection:

```go
user, err := users.Get(ctx, 123)
if err != nil {
    // Check specific error types
    var rpcErr *capnweb.Error
    if errors.As(err, &rpcErr) {
        switch rpcErr.Code {
        case capnweb.ErrNotFound:
            return nil, ErrUserNotFound
        case capnweb.ErrPermissionDenied:
            return nil, ErrForbidden
        case capnweb.ErrRateLimited:
            retryAfter := rpcErr.RetryAfter()
            time.Sleep(retryAfter)
            return users.Get(ctx, 123) // Retry
        }
    }

    // Check connection errors
    if errors.Is(err, capnweb.ErrDisconnected) {
        // Handle disconnection
    }

    return nil, fmt.Errorf("get user %d: %w", 123, err)
}
```

**Error Types:**

```go
var (
    ErrDisconnected     = errors.New("capnweb: disconnected")
    ErrNotFound         = errors.New("capnweb: not found")
    ErrPermissionDenied = errors.New("capnweb: permission denied")
    ErrRateLimited      = errors.New("capnweb: rate limited")
    ErrInvalidArgument  = errors.New("capnweb: invalid argument")
)

type Error struct {
    Code    string
    Message string
    Details map[string]any
}
```

---

## Exposing Local Services

Register Go types to receive remote calls:

```go
// Your implementation
type Calculator struct{}

func (c *Calculator) Add(ctx context.Context, a, b int) (int, error) {
    return a + b, nil
}

func (c *Calculator) Divide(ctx context.Context, a, b int) (int, error) {
    if b == 0 {
        return 0, capnweb.Errorf(capnweb.ErrInvalidArgument, "division by zero")
    }
    return a / b, nil
}

// Export it
session.Export("calculator", &Calculator{})
```

Remote clients can now call:

```go
calc := capnweb.Stub[CalculatorAPI](remoteSession, "calculator")
result, err := calc.Add(ctx, 40, 2) // 42
```

**Rules for exported methods:**

- First argument must be `context.Context`
- Must return `(T, error)` or just `error`
- Exported methods only (uppercase first letter)
- Arguments and return types must be serializable

---

## Streaming

For methods that return streams, use channels:

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
}
```

To expose a streaming endpoint:

```go
func (s *EventService) Subscribe(ctx context.Context, topic string) (<-chan Event, error) {
    ch := make(chan Event)
    go func() {
        defer close(ch)
        for {
            select {
            case <-ctx.Done():
                return
            case event := <-s.events:
                if event.Topic == topic {
                    ch <- event
                }
            }
        }
    }()
    return ch, nil
}
```

---

## Dynamic Client

For prototyping or when you don't have interface definitions:

```go
dyn := capnweb.Dynamic(session)

// Call any method
result, err := dyn.Call(ctx, "users", "Get", 123)
if err != nil {
    return err
}

user := result.(map[string]any)
name := user["Name"].(string)

// Access nested paths
bio, err := dyn.Get(ctx, "users", "123", "Profile", "Bio")
```

---

## Complete Example

```go
package main

import (
    "context"
    "log"
    "os"

    "github.com/dot-do/capnweb"
)

// Define your API contract
type UsersAPI interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, name, email string) (*User, error)
}

type UsersAPIp interface {
    Get(ctx context.Context, id int64) capnweb.Ref[*User]
}

type User struct {
    ID      int64
    Name    string
    Email   string
    Profile *Profile
}

type Profile struct {
    Bio    string
    Avatar string
}

func main() {
    ctx := context.Background()

    // Connect
    session, err := capnweb.Dial(ctx, "wss://api.example.com",
        capnweb.WithAuth(os.Getenv("API_KEY")),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Simple call
    users := capnweb.Stub[UsersAPI](session, "users")
    user, err := users.Get(ctx, 123)
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("User: %s", user.Name)

    // Pipelined call - one round trip
    usersP := capnweb.Stub[UsersAPIp](session, "users")
    bio, err := usersP.Get(ctx, 123).
        Field("Profile").
        Field("Bio").
        Await(ctx)
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("Bio: %s", bio)

    // Export local service
    session.Export("echo", &EchoService{})

    // Keep alive for bidirectional calls
    select {}
}

type EchoService struct{}

func (e *EchoService) Echo(ctx context.Context, msg string) (string, error) {
    return msg, nil
}
```

---

## Interface Definitions

```go
package capnweb

import (
    "context"
    "time"
)

// Session manages a Cap'n Web connection.
type Session struct{}

// Dial establishes a new session.
func Dial(ctx context.Context, url string, opts ...Option) (*Session, error)

// Close terminates the session.
func (s *Session) Close() error

// Export registers a local target for remote calls.
func (s *Session) Export(name string, target any)

// Stub returns a typed client for a remote service.
func Stub[T any](s *Session, name string) T

// Ref is an unresolved reference enabling pipelining.
type Ref[T any] interface {
    Await(ctx context.Context) (T, error)
    Field(name string) Ref[any]
}

// Pipeline builds explicit multi-call pipelines.
type Pipeline struct{}

func NewPipeline(s *Session) *Pipeline
func (p *Pipeline) Call(fn any, args ...any) Ref[any]
func (p *Pipeline) Execute(ctx context.Context) (*Results, error)

// Results holds pipeline execution results.
type Results struct{}

func (r *Results) Get(ref Ref[any]) any

// Dynamic provides an untyped client.
type Dynamic struct{}

func Dynamic(s *Session) *Dynamic
func (d *Dynamic) Call(ctx context.Context, service, method string, args ...any) (any, error)
func (d *Dynamic) Get(ctx context.Context, path ...string) (any, error)

// Error is a Cap'n Web RPC error.
type Error struct {
    Code    string
    Message string
    Details map[string]any
}

func (e *Error) Error() string
func (e *Error) RetryAfter() time.Duration

// Errorf creates a new Error with the given code.
func Errorf(code error, format string, args ...any) error

// Option configures a session.
type Option func(*sessionConfig)

func WithAuth(token string) Option
func WithTimeout(d time.Duration) Option
func WithReconnect(attempts int) Option
func WithCompression(enabled bool) Option
```

---

## Why This API is Idiomatic Go

1. **Context propagation**: Every call accepts `context.Context` for cancellation and deadlines
2. **Error values**: No panics, no exceptions - `(value, error)` everywhere
3. **Interface contracts**: Define behavior with interfaces, implement with structs
4. **Explicit over implicit**: Pipelining is opt-in and visible
5. **Zero dependencies start**: Just `capnweb.Dial` and `capnweb.Stub` to begin
6. **Standard library patterns**: Follows `database/sql`, `net/http`, and `google.golang.org/grpc` conventions
7. **Goroutine-friendly**: Works naturally with `errgroup` and channels
8. **Testable**: Interfaces make mocking trivial

```go
// Mock for testing
type mockUsers struct{}

func (m *mockUsers) Get(ctx context.Context, id int64) (*User, error) {
    return &User{ID: id, Name: "Test User"}, nil
}

func TestUserService(t *testing.T) {
    svc := NewUserService(&mockUsers{})
    // Test without network
}
```

---

*This API makes Cap'n Web feel like native Go.*
