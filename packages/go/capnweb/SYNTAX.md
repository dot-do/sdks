# Cap'n Web Go Client Syntax Exploration

This document explores divergent syntax approaches for the Go client library (`github.com/dot-do/sdks/packages/go/capnweb`). Each approach prioritizes different Go idioms and makes different trade-offs.

## Background: What Makes Go Different

Before diving into approaches, let's acknowledge Go's unique constraints:

1. **No async/await** - Go uses goroutines and channels for concurrency
2. **No method overloading** - Each method name must be unique
3. **No generics on methods** (only on types) - Limits fluent API design
4. **Explicit error handling** - `(value, error)` pattern is sacred
5. **Interfaces are implicit** - "Duck typing" at compile time
6. **Reflection is expensive** - Code generation preferred for hot paths

Pipelining is the biggest challenge: in async/await languages, you chain promises naturally. In Go, we need creative solutions.

---

## Approach 1: The gRPC Way (Code Generation First)

**Philosophy**: Generate typed clients from a schema. Maximum type safety, familiar to anyone using gRPC-go.

### Connection/Session Creation

```go
package main

import (
    "context"
    "github.com/dot-do/sdks/packages/go/capnweb"
    "github.com/example/myapi" // Generated from schema
)

func main() {
    ctx := context.Background()

    // Dial returns a typed connection
    conn, err := capnweb.Dial(ctx, "wss://api.example.com",
        capnweb.WithAuth(os.Getenv("API_KEY")),
        capnweb.WithKeepAlive(30*time.Second),
    )
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    // Get typed client from connection
    client := myapi.NewUsersClient(conn)
}
```

### Making RPC Calls

```go
// Simple call - very gRPC-like
user, err := client.GetUser(ctx, &myapi.GetUserRequest{ID: 123})
if err != nil {
    if capnweb.IsNotFound(err) {
        // Handle specific error
    }
    return err
}
fmt.Println(user.Name)

// Call with options
user, err := client.GetUser(ctx, &myapi.GetUserRequest{ID: 123},
    capnweb.WithTimeout(5*time.Second),
    capnweb.WithRetry(3),
)
```

### Pipelining Syntax

This is where it gets interesting. gRPC doesn't have pipelining, so we need to invent something.

```go
// Option A: Explicit pipeline builder
pipe := conn.Pipeline()
userCall := pipe.Push(client.GetUser, &myapi.GetUserRequest{ID: 123})
profileCall := pipe.Push(myapi.NewProfilesClient(conn).GetProfile,
    &myapi.GetProfileRequest{UserID: userCall.Field("ID")})
results, err := pipe.Execute(ctx)
if err != nil {
    return err
}
user := results.Get(userCall).(*myapi.User)
profile := results.Get(profileCall).(*myapi.Profile)

// Option B: Generated pipeline methods
// The code generator creates special "pipelining" methods
nameResult := client.GetUser_Pipeline(ctx, &myapi.GetUserRequest{ID: 123}).
    Then(func(u *myapi.UserRef) capnweb.PipelineCall {
        return profileClient.GetProfile_Pipeline(ctx, &myapi.GetProfileRequest{
            UserID: u.ID(), // u.ID() returns a reference, not a value
        })
    }).
    Field("Name")

name, err := nameResult.Resolve(ctx)
```

### Error Handling

```go
user, err := client.GetUser(ctx, &myapi.GetUserRequest{ID: 123})
if err != nil {
    // Unwrap Cap'n Web specific errors
    var rpcErr *capnweb.Error
    if errors.As(err, &rpcErr) {
        switch rpcErr.Code {
        case capnweb.ErrNotFound:
            return nil, ErrUserNotFound
        case capnweb.ErrPermissionDenied:
            return nil, ErrUnauthorized
        }
    }
    return nil, fmt.Errorf("get user: %w", err)
}
```

### Exposing Local Objects as RPC Targets

```go
// Define your service interface (generated from schema)
type UsersServer interface {
    GetUser(context.Context, *GetUserRequest) (*User, error)
    CreateUser(context.Context, *CreateUserRequest) (*User, error)
    DeleteUser(context.Context, *DeleteUserRequest) error
}

// Implement it
type usersServerImpl struct {
    db *sql.DB
}

func (s *usersServerImpl) GetUser(ctx context.Context, req *GetUserRequest) (*User, error) {
    // Implementation
}

// Register with the connection
conn.RegisterTarget("users", myapi.NewUsersServerHandler(&usersServerImpl{db}))
```

### Pros/Cons

**Pros:**
- Familiar to Go developers (gRPC-like)
- Full type safety
- IDE autocomplete works perfectly
- Efficient - no reflection in hot path

**Cons:**
- Requires schema + code generation step
- Pipelining syntax is awkward
- Heavy tooling requirement

---

## Approach 2: The Resty Way (Fluent Runtime API)

**Philosophy**: Dynamic, reflection-based client that feels like REST clients (resty, req). No code generation required.

### Connection/Session Creation

```go
package main

import (
    "context"
    "github.com/dot-do/sdks/packages/go/capnweb"
)

func main() {
    ctx := context.Background()

    // Create session with fluent config
    session := capnweb.New().
        BaseURL("wss://api.example.com").
        Auth(os.Getenv("API_KEY")).
        Timeout(30 * time.Second).
        Debug(true)

    // Connect (lazy or explicit)
    if err := session.Connect(ctx); err != nil {
        log.Fatal(err)
    }
    defer session.Close()
}
```

### Making RPC Calls

```go
// Dynamic method calls using generics for return type
var user User
err := session.Stub("users").Call(ctx, "get", 123).Decode(&user)
if err != nil {
    return err
}

// Or using type parameter
user, err := capnweb.Call[User](ctx, session.Stub("users"), "get", 123)
if err != nil {
    return err
}

// Chained property access
var name string
err = session.Stub("users").
    Get("123").          // property access
    Get("profile").      // nested property
    Get("name").         // leaf property
    Pull(ctx, &name)     // resolve and decode

// Method call with args
var result Order
err = session.Stub("orders").
    Call(ctx, "create", OrderRequest{
        UserID: 123,
        Items:  []string{"item1", "item2"},
    }).
    Decode(&result)
```

### Pipelining Syntax

```go
// Natural chaining - pipelining happens automatically!
// The library batches these into a single round trip
var userName string
err := session.Stub("api").
    Get("users").           // returns stub reference
    Call(ctx, "get", 123).  // call on stub (not awaited yet)
    Get("profile").         // access property of result
    Get("name").            // access nested property
    Pull(ctx, &userName)    // NOW we await and decode

// Explicit batching for parallel calls
batch := session.Batch()

call1 := batch.Stub("users").Call(ctx, "get", 123)
call2 := batch.Stub("orders").Call(ctx, "list", OrderQuery{UserID: 123})
call3 := batch.Stub("notifications").Call(ctx, "count", 123)

results, err := batch.Execute(ctx)
if err != nil {
    return err
}

var user User
var orders []Order
var count int
results.Decode(call1, &user)
results.Decode(call2, &orders)
results.Decode(call3, &count)
```

### Error Handling

```go
var user User
err := session.Stub("users").Call(ctx, "get", 123).Decode(&user)
if err != nil {
    // Check for specific RPC errors
    if capnweb.IsCode(err, "NOT_FOUND") {
        return ErrUserNotFound
    }
    if capnweb.IsCode(err, "RATE_LIMITED") {
        // Access error details
        var rpcErr *capnweb.RPCError
        if errors.As(err, &rpcErr) {
            retryAfter := rpcErr.Details["retryAfter"].(float64)
            time.Sleep(time.Duration(retryAfter) * time.Second)
            // Retry...
        }
    }
    return fmt.Errorf("fetch user: %w", err)
}
```

### Exposing Local Objects as RPC Targets

```go
// Any struct can be a target - methods are automatically exposed
type Calculator struct{}

func (c *Calculator) Add(ctx context.Context, a, b int) (int, error) {
    return a + b, nil
}

func (c *Calculator) Divide(ctx context.Context, a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// Export it
session.Export("calculator", &Calculator{})

// Remote side can now call:
// stub("calculator").Call(ctx, "Add", 1, 2) -> 3
// stub("calculator").Call(ctx, "Divide", 10, 2) -> 5
```

### Pros/Cons

**Pros:**
- No code generation needed
- Very flexible - works with any server
- Familiar to REST client users
- Quick prototyping

**Cons:**
- No compile-time type safety on methods
- Reflection overhead
- Typos in method names fail at runtime
- IDE can't autocomplete method names

---

## Approach 3: The go-kit Way (Interface-Centric with Middleware)

**Philosophy**: Interfaces as contracts, middleware for cross-cutting concerns. Embrace Go's implicit interface satisfaction.

### Connection/Session Creation

```go
package main

import (
    "context"
    "github.com/dot-do/sdks/packages/go/capnweb"
    "github.com/dot-do/sdks/packages/go/capnweb/transport/websocket"
)

func main() {
    ctx := context.Background()

    // Transport layer (swappable)
    transport, err := websocket.NewTransport("wss://api.example.com",
        websocket.WithCompression(true),
    )
    if err != nil {
        log.Fatal(err)
    }

    // Session with middleware stack
    session := capnweb.NewSession(transport,
        capnweb.WithLogging(logger),
        capnweb.WithMetrics(prometheus.DefaultRegisterer),
        capnweb.WithTracing(tracer),
        capnweb.WithCircuitBreaker(gobreaker.NewCircuitBreaker(settings)),
    )
    defer session.Close()
}
```

### Making RPC Calls

The key insight: define your API as a Go interface, then wrap it.

```go
// Define your API contract as a Go interface
type UsersAPI interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, req CreateUserRequest) (*User, error)
    Delete(ctx context.Context, id int64) error
    List(ctx context.Context, opts ListOptions) ([]*User, error)
}

// capnweb generates or provides a way to create a client
client := capnweb.NewClient[UsersAPI](session, "users")

// Now use it naturally
user, err := client.Get(ctx, 123)
if err != nil {
    return err
}

// The interface IS the contract
func processUser(api UsersAPI, id int64) error {
    user, err := api.Get(context.Background(), id)
    // ...
}

// Easy to mock for testing
type mockUsersAPI struct {}
func (m *mockUsersAPI) Get(ctx context.Context, id int64) (*User, error) {
    return &User{ID: id, Name: "Mock User"}, nil
}
```

### Pipelining Syntax

This is where go-kit style gets creative: use a special "pipeline context" type.

```go
// Pipeline-aware interface methods return PipelineResult instead of value
type UsersAPIPipeline interface {
    Get(ctx context.Context, id int64) capnweb.Ref[*User]
    GetProfile(ctx context.Context, userRef capnweb.Ref[int64]) capnweb.Ref[*Profile]
}

// Usage with pipelining
func getPipelinedName(ctx context.Context, api UsersAPIPipeline, id int64) (string, error) {
    // Build the pipeline
    userRef := api.Get(ctx, id)                        // Returns Ref[*User], doesn't block
    profileRef := api.GetProfile(ctx, userRef.Field("ID")) // Uses ref, still doesn't block
    nameRef := profileRef.Field("Name")                    // Access field on ref

    // Resolve the entire pipeline in one round trip
    name, err := nameRef.Resolve(ctx)
    return name, err
}

// Alternative: Pipeline builder pattern
pipe := capnweb.NewPipeline(session)
userRef := pipe.Call(usersClient.Get, 123)
profileRef := pipe.Call(profileClient.GetForUser, userRef.Field("ID"))
nameRef := profileRef.Field("Name")

// Execute pipeline
name, err := pipe.Resolve(ctx, nameRef)
```

### Error Handling

go-kit style embraces endpoint-level error handling.

```go
// Errors are part of the response, not exceptions
type GetUserResponse struct {
    User *User
    Err  error // Transport-independent error
}

// But for Cap'n Web, we use standard Go error handling
user, err := client.Get(ctx, 123)
if err != nil {
    // Middleware can transform errors
    // e.g., circuit breaker adds context
    if errors.Is(err, gobreaker.ErrOpenState) {
        return nil, ErrServiceUnavailable
    }

    // RPC-specific error inspection
    var rpcErr capnweb.RPCError
    if errors.As(err, &rpcErr) {
        log.Printf("RPC failed: method=%s code=%s", rpcErr.Method, rpcErr.Code)
    }

    return nil, err
}
```

### Exposing Local Objects as RPC Targets

```go
// Your service implements an interface
type UsersService interface {
    Get(ctx context.Context, id int64) (*User, error)
    Create(ctx context.Context, req CreateUserRequest) (*User, error)
}

type usersServiceImpl struct {
    repo UserRepository
}

func (s *usersServiceImpl) Get(ctx context.Context, id int64) (*User, error) {
    return s.repo.FindByID(ctx, id)
}

// Register the implementation
session.Serve("users", capnweb.AsTarget[UsersService](&usersServiceImpl{repo}))

// With middleware
session.Serve("users",
    capnweb.AsTarget[UsersService](&usersServiceImpl{repo}),
    capnweb.WithRateLimit(100),
    capnweb.WithAuth(authMiddleware),
)
```

### Pros/Cons

**Pros:**
- Very testable (interface mocking)
- Middleware pattern is powerful
- Familiar to go-kit users
- Clean separation of concerns

**Cons:**
- More boilerplate
- Need to define interfaces upfront
- Pipelining still awkward
- Steeper learning curve

---

## Approach 4: The Channel Way (Embrace Go's Concurrency Model)

**Philosophy**: Fully embrace channels and goroutines. Make pipelining feel like concurrent Go code.

### Connection/Session Creation

```go
package main

import (
    "context"
    "github.com/dot-do/sdks/packages/go/capnweb"
)

func main() {
    ctx := context.Background()

    // Session is a multiplexed connection
    session, err := capnweb.Open(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Stub returns a "capability" - a handle to remote object
    users := capnweb.Stub[UsersAPI](session, "users")
}
```

### Making RPC Calls

```go
// Standard call - blocks like normal Go
user, err := users.Get(ctx, 123)
if err != nil {
    return err
}

// Async call - returns immediately, result comes via channel
future := users.GetAsync(ctx, 123)
// ... do other work ...
user, err := future.Await() // or <-future.Done()

// Or use Go's select for timeouts
select {
case result := <-future.Done():
    if result.Err != nil {
        return result.Err
    }
    user := result.Value
case <-time.After(5 * time.Second):
    future.Cancel()
    return ErrTimeout
case <-ctx.Done():
    return ctx.Err()
}
```

### Pipelining Syntax

This is where the channel approach shines.

```go
// Option A: Pipeline as a goroutine-friendly construct
func getProfileName(ctx context.Context, session *capnweb.Session, userID int64) (string, error) {
    // Start a pipeline scope - all calls within are batched
    return capnweb.Pipeline(session, func(p *capnweb.Pipe) (string, error) {
        // These calls are pipelined, not awaited individually
        userRef := p.Call(users.Get, userID)              // Ref[User]
        profileRef := p.Call(profiles.Get, userRef.ID())  // Ref[Profile] using ref field
        return profileRef.Name(), nil                      // Returns the pipeline result
    })
}

// Option B: Channel-based streaming
func streamUsers(ctx context.Context, users UsersAPI) error {
    // Returns a channel of users
    userCh, errCh := users.List(ctx, ListOptions{PageSize: 100})

    for {
        select {
        case user, ok := <-userCh:
            if !ok {
                return nil // Channel closed, done
            }
            processUser(user)
        case err := <-errCh:
            return err
        case <-ctx.Done():
            return ctx.Err()
        }
    }
}

// Option C: Parallel calls with errgroup
func fetchUserData(ctx context.Context, userID int64) (*UserData, error) {
    g, ctx := errgroup.WithContext(ctx)

    var user *User
    var orders []*Order
    var notifications []*Notification

    // These run in parallel, automatically pipelined
    g.Go(func() error {
        var err error
        user, err = users.Get(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        orders, err = orders.ListForUser(ctx, userID)
        return err
    })
    g.Go(func() error {
        var err error
        notifications, err = notifications.ListForUser(ctx, userID)
        return err
    })

    if err := g.Wait(); err != nil {
        return nil, err
    }

    return &UserData{user, orders, notifications}, nil
}
```

### Error Handling

```go
// Standard (value, error) pattern
user, err := users.Get(ctx, 123)
if err != nil {
    return nil, fmt.Errorf("get user %d: %w", 123, err)
}

// With futures
future := users.GetAsync(ctx, 123)
result := <-future.Done()
if result.Err != nil {
    // Error types
    switch {
    case errors.Is(result.Err, capnweb.ErrDisconnected):
        // Reconnect logic
    case errors.Is(result.Err, context.DeadlineExceeded):
        // Timeout handling
    default:
        var rpcErr *capnweb.RemoteError
        if errors.As(result.Err, &rpcErr) {
            // Server-side error with stack trace
            log.Printf("Remote error: %s\nStack: %s", rpcErr.Message, rpcErr.Stack)
        }
    }
    return nil, result.Err
}

// Pipeline error handling
result, err := capnweb.Pipeline(session, func(p *capnweb.Pipe) (*Profile, error) {
    userRef := p.Call(users.Get, 123)
    if p.Err() != nil {
        return nil, p.Err() // Early exit if something failed
    }
    return p.Call(profiles.Get, userRef.ID()), nil
})
```

### Exposing Local Objects as RPC Targets

```go
// Method 1: Struct with methods
type Calculator struct{}

func (c *Calculator) Add(ctx context.Context, a, b int) (int, error) {
    return a + b, nil
}

session.Export("calc", &Calculator{})

// Method 2: Function-based (like http.HandleFunc)
session.HandleFunc("echo", func(ctx context.Context, msg string) (string, error) {
    return msg, nil
})

// Method 3: Channel-based handler for streaming
session.HandleStream("events", func(ctx context.Context, in <-chan Event) (<-chan Event, error) {
    out := make(chan Event)
    go func() {
        defer close(out)
        for event := range in {
            // Process and forward
            event.Processed = true
            select {
            case out <- event:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out, nil
})

// Method 4: Interface-based registration
type CalculatorService interface {
    Add(ctx context.Context, a, b int) (int, error)
    Subtract(ctx context.Context, a, b int) (int, error)
}

session.Serve[CalculatorService]("calc", &calculatorImpl{})
```

### Pros/Cons

**Pros:**
- Feels most "Go native"
- Leverages goroutines and channels
- Natural fit for streaming
- Parallel calls feel idiomatic

**Cons:**
- Automatic pipelining is "magic"
- May be confusing when pipelining happens vs doesn't
- Channel-heavy code can be complex
- Needs careful goroutine lifecycle management

---

## Approach 5: The Hybrid (Best of All Worlds)

**Philosophy**: Provide multiple APIs at different abstraction levels. Users choose their comfort level.

### The Layer Cake

```go
package capnweb

// Layer 1: Low-level protocol access
type Session interface {
    Push(ctx context.Context, expr Expression) (ImportID, error)
    Pull(ctx context.Context, id ImportID) (<-chan Resolution, error)
    Release(ctx context.Context, id ImportID) error
}

// Layer 2: Untyped dynamic client
type DynamicClient interface {
    Call(ctx context.Context, method string, args ...any) (any, error)
    Get(ctx context.Context, path ...string) (any, error)
    Pipeline() *PipelineBuilder
}

// Layer 3: Typed generic client
type Client[T any] interface {
    Stub() T
}

// Layer 4: Generated typed client (via go generate)
// Generated code uses Layer 3 under the hood
```

### Usage Examples

```go
// Layer 1: Protocol hacker
session, _ := capnweb.Dial(ctx, url)
id, _ := session.Push(ctx, capnweb.Expr{
    Type: "import",
    ID:   0,
    Path: []string{"users", "get"},
    Args: []any{123},
})
resCh, _ := session.Pull(ctx, id)
result := <-resCh

// Layer 2: Quick scripting
client := capnweb.Dynamic(session)
user, err := client.Call(ctx, "users.get", 123)
name := user.(map[string]any)["name"].(string)

// Layer 3: Type-safe generics
type UsersAPI struct {
    Get    func(ctx context.Context, id int64) (*User, error)
    Create func(ctx context.Context, req CreateUserRequest) (*User, error)
}
users := capnweb.Bind[UsersAPI](session, "users")
user, err := users.Get(ctx, 123)

// Layer 4: Generated client (best DX)
//go:generate capnweb generate --schema=api.yaml --out=client.go
users := myapi.NewUsersClient(session)
user, err := users.Get(ctx, &myapi.GetUserRequest{ID: 123})
```

### Universal Pipelining

```go
// All layers support pipelining through a unified interface

// Dynamic pipelining
pipe := client.Pipeline()
userRef := pipe.Call("users.get", 123)
profileRef := pipe.Call("profiles.get", userRef.Field("id"))
name, err := pipe.Resolve(ctx, profileRef.Field("name"))

// Typed pipelining
pipe := capnweb.NewPipeline(session)
userRef := pipe.Add(users.Get, 123)
profileRef := pipe.Add(profiles.Get, userRef.ID())
name, err := pipe.Execute(ctx).Get(profileRef).Name()

// Generated pipelining (nicest syntax)
user := users.Get(ctx, 123)  // Returns UserPromise
name, err := user.Profile().Name().Await(ctx)
```

---

## Comparison Matrix

| Feature | Approach 1 (gRPC) | Approach 2 (Resty) | Approach 3 (go-kit) | Approach 4 (Channels) | Approach 5 (Hybrid) |
|---------|-------------------|--------------------|--------------------|----------------------|---------------------|
| Type Safety | Full | Runtime | Full (interfaces) | Full | Layered |
| Code Generation | Required | None | Optional | Optional | Optional |
| Pipelining | Awkward | Natural chaining | Ref pattern | Goroutines | Multiple options |
| Learning Curve | Low (familiar) | Low | Medium | Medium | Low to High |
| Flexibility | Low | High | Medium | High | Very High |
| Performance | Best | Reflection overhead | Good | Good | Depends on layer |
| Testing | Mock interfaces | Mock HTTP | Mock interfaces | Mock channels | All options |
| IDE Support | Excellent | Limited | Excellent | Good | Depends on layer |

---

## Recommendation

For the Cap'n Web Go client, I recommend **Approach 5 (Hybrid)** with emphasis on:

1. **Primary API**: Approach 4 (Channel-based) for the main user-facing API
   - Most idiomatic Go
   - Natural concurrency patterns
   - Channels work well with streaming

2. **Type Safety**: Approach 1 (gRPC-style) code generation as an option
   - For users who want maximum type safety
   - Optional layer on top of the channel API

3. **Quick Start**: Approach 2 (Resty-style) dynamic client
   - For prototyping and scripting
   - No setup required

### Proposed Module Structure

```
github.com/dot-do/sdks/packages/go/capnweb
├── capnweb.go          # Core types and interfaces
├── session.go          # Session management
├── transport/          # Transport implementations
│   ├── websocket/
│   ├── http/
│   └── messageport/
├── dynamic/            # Dynamic/untyped client
├── pipeline/           # Pipeline builder
├── codegen/            # Code generation tools
│   └── cmd/capnweb/    # CLI tool
└── examples/
    ├── basic/
    ├── pipelining/
    ├── bidirectional/
    └── generated/
```

### Final Syntax Preview

```go
package main

import (
    "context"
    "log"

    "github.com/dot-do/sdks/packages/go/capnweb"
)

func main() {
    ctx := context.Background()

    // Connect
    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Get typed stub (using generics)
    users := capnweb.Stub[UsersAPI](session, "users")

    // Simple call
    user, err := users.Get(ctx, 123)
    if err != nil {
        log.Fatal(err)
    }

    // Pipelining with natural chaining
    name, err := users.Get(ctx, 123).
        Profile().
        Name().
        Await(ctx)
    if err != nil {
        log.Fatal(err)
    }

    // Expose local service
    session.Serve("calculator", &Calculator{})

    log.Printf("User %s", name)
}

// Local service
type Calculator struct{}

func (c *Calculator) Add(ctx context.Context, a, b int) (int, error) {
    return a + b, nil
}
```

This feels like idiomatic Go while providing the power of Cap'n Web's capability-based RPC.
