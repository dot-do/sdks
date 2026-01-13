# Go Installation

The Go SDK provides idiomatic Go access to Cap'n Web RPC with full type safety.

## Installation

```bash
go get go.capnweb.do
```

## Requirements

- Go 1.21 or later
- `gorilla/websocket` (installed automatically)

## Basic Usage

### Client

```go
package main

import (
    "context"
    "fmt"
    "log"

    "go.capnweb.do"
)

func main() {
    ctx := context.Background()

    // Connect to server
    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Make RPC calls
    var greeting string
    err = session.Call(ctx, "greet", &greeting, "World")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(greeting) // "Hello, World!"
}
```

### Typed Stubs

```go
package main

import (
    "context"
    "fmt"
    "log"

    "go.capnweb.do"
)

// Define your API interface
type MyApi interface {
    Greet(ctx context.Context, name string) (string, error)
    GetUser(ctx context.Context, id int) (*User, error)
}

type User struct {
    ID    int    `json:"id"`
    Name  string `json:"name"`
    Email string `json:"email"`
}

func main() {
    ctx := context.Background()

    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Create typed stub
    api := capnweb.Stub[MyApi](session)

    greeting, err := api.Greet(ctx, "World")
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(greeting)

    user, err := api.GetUser(ctx, 123)
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("User: %s\n", user.Name)
}
```

### Promise Pipelining

```go
package main

import (
    "context"
    "fmt"
    "log"

    "go.capnweb.do"
)

func main() {
    ctx := context.Background()

    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // Start call without waiting
    userPromise := session.CallAsync(ctx, "getUser", 123)

    // Pipeline another call using the promise
    profilePromise := session.CallAsync(ctx, "getProfile", userPromise.Field("id"))

    // Await the final result (single round trip)
    var profile Profile
    err = profilePromise.Await(&profile)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Profile: %s\n", profile.Name)
}
```

## Server Implementation

```go
package main

import (
    "context"
    "log"
    "net/http"

    "github.com/gorilla/websocket"
    "go.capnweb.do"
)

// Implement your API
type MyApiImpl struct {
    capnweb.RpcTarget
}

func (api *MyApiImpl) Greet(ctx context.Context, name string) (string, error) {
    return fmt.Sprintf("Hello, %s!", name), nil
}

func (api *MyApiImpl) GetUser(ctx context.Context, id int) (*User, error) {
    return &User{
        ID:    id,
        Name:  "Alice",
        Email: "alice@example.com",
    }, nil
}

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool { return true },
}

func handler(w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("upgrade failed: %v", err)
        return
    }
    defer conn.Close()

    api := &MyApiImpl{}
    capnweb.Serve(conn, api)
}

func main() {
    http.HandleFunc("/api", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

## Error Handling

```go
package main

import (
    "context"
    "errors"
    "fmt"
    "log"

    "go.capnweb.do"
)

func main() {
    ctx := context.Background()

    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    api := capnweb.Stub[MyApi](session)

    result, err := api.RiskyOperation(ctx)
    if err != nil {
        var rpcErr *capnweb.RpcError
        if errors.As(err, &rpcErr) {
            fmt.Printf("RPC error: %s\n", rpcErr.Message)
        } else {
            fmt.Printf("Other error: %v\n", err)
        }
        return
    }

    fmt.Println(result)
}
```

## Configuration Options

```go
session, err := capnweb.Dial(ctx, "wss://api.example.com",
    capnweb.WithTimeout(30 * time.Second),
    capnweb.WithHeader("Authorization", "Bearer "+token),
    capnweb.WithReconnect(true),
)
```

## HTTP Batch Mode

```go
package main

import (
    "context"
    "fmt"
    "log"

    "go.capnweb.do"
)

func main() {
    ctx := context.Background()

    batch := capnweb.NewHttpBatch("https://api.example.com")

    // Queue up calls
    greeting1 := batch.CallAsync(ctx, "greet", "Alice")
    greeting2 := batch.CallAsync(ctx, "greet", "Bob")

    // Send batch and get results
    results, err := batch.Execute(ctx)
    if err != nil {
        log.Fatal(err)
    }

    var g1, g2 string
    results[0].Decode(&g1)
    results[1].Decode(&g2)

    fmt.Println(g1, g2)
}
```

## Context Cancellation

```go
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    session, err := capnweb.Dial(ctx, "wss://api.example.com")
    if err != nil {
        log.Fatal(err)
    }
    defer session.Close()

    // This call will be cancelled if it takes too long
    result, err := session.Call(ctx, "slowOperation")
    if errors.Is(err, context.DeadlineExceeded) {
        log.Println("Operation timed out")
    }
}
```

## Concurrency

The Go SDK is goroutine-safe:

```go
func main() {
    session, _ := capnweb.Dial(ctx, "wss://api.example.com")
    defer session.Close()

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            var result string
            session.Call(ctx, "process", &result, id)
            fmt.Println(result)
        }(i)
    }
    wg.Wait()
}
```

## Troubleshooting

### Connection Refused

Check that the server is running and the URL is correct:

```go
session, err := capnweb.Dial(ctx, "wss://api.example.com")
if err != nil {
    // Check error type
    var netErr *net.OpError
    if errors.As(err, &netErr) {
        log.Printf("Network error: %v", netErr)
    }
}
```

### JSON Unmarshaling Errors

Ensure your struct tags match the server's response:

```go
type User struct {
    ID    int    `json:"id"`    // Must match server field name
    Name  string `json:"name"`
    Email string `json:"email"`
}
```

### Context Errors

Always pass a context with appropriate timeout:

```go
// WRONG - no timeout, could hang forever
ctx := context.Background()

// CORRECT - with timeout
ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
```
