# CapnWeb Swift API

A capability-based RPC client that feels native to Swift.

## Design Principles

1. **Type-safe by default** - Compile-time guarantees via protocols and generics
2. **Pipelining is invisible** - Chain calls naturally; the framework optimizes wire traffic
3. **Actor-isolated sessions** - Thread safety without ceremony
4. **Standard error handling** - `async throws` everywhere

---

## Quick Start

```swift
import CapnWeb

// Connect
let session = try await RpcSession.connect(to: "wss://api.example.com")

// Call
let user: User = try await session.api.users.get(123)

// Pipeline (single round-trip)
let name: String = try await session.api
    .authenticate(token)
    .currentUser
    .profile
    .displayName
```

---

## Core API

### Connection

```swift
// WebSocket (persistent)
let session = try await RpcSession.connect(to: "wss://api.example.com")

// With configuration
let session = try await RpcSession.connect(to: url) {
    $0.timeout = .seconds(30)
    $0.reconnect = .exponentialBackoff(max: 3)
}

// Scoped lifecycle
try await withRpcSession(url: url) { session in
    let result = try await session.api.doWork()
}
```

### Remote Calls

```swift
// Property access
let users = session.api.users           // Ref<Users>

// Method calls
let user = session.api.users.get(123)   // Ref<User>

// Resolve to Swift type
let user: User = try await session.api.users.get(123)

// Explicit resolution
let user = try await session.api.users.get(123).resolve(as: User.self)
```

### Pipelining

Pipelining sends dependent calls in a single round-trip. Just chain naturally:

```swift
// All three calls execute in ONE round-trip
let displayName: String = try await session.api
    .authenticate(token)     // Returns Ref<AuthedAPI>
    .currentUser             // Returns Ref<User>
    .profile                 // Returns Ref<Profile>
    .displayName             // Returns Ref<String>

// Pass unresolved refs as arguments
let authed = session.api.authenticate(token)
let profile: Profile = try await session.api.getUserProfile(
    userId: authed.currentUser.id    // Ref<Int> passed directly
)
```

### Error Handling

```swift
do {
    let result = try await session.api.riskyOperation()
} catch let error as RpcError {
    switch error {
    case .remote(let type, let message):
        print("Server error: \(type) - \(message)")
    case .connectionLost:
        print("Connection lost")
    case .timeout:
        print("Request timed out")
    }
}
```

### Exposing Local Objects

```swift
@Rpc actor NotificationHandler {
    func onMessage(_ msg: Message) {
        print("Received: \(msg)")
    }
}

let handler = NotificationHandler()
try await session.api.subscribe(callback: handler.stub)
```

---

## Type Definitions

### Core Types

```swift
/// Actor-isolated RPC session
public actor RpcSession {
    /// The root API reference
    public var api: Ref<Any> { get }

    /// Connect to a CapnWeb server
    public static func connect(
        to url: URL,
        configure: ((inout Configuration) -> Void)? = nil
    ) async throws -> RpcSession

    /// Close the connection
    public func close() async
}

/// A reference to a remote value (pipelineable)
@dynamicMemberLookup
@dynamicCallable
public struct Ref<T>: Sendable {
    /// Access a property on the remote object
    public subscript<U>(dynamicMember member: String) -> Ref<U>

    /// Call a method on the remote object
    public func dynamicallyCall<R>(
        withKeywordArguments args: KeyValuePairs<String, Any>
    ) -> Ref<R>

    /// Resolve to a concrete Swift type
    public func resolve<U: Decodable>(as type: U.Type) async throws -> U
}

/// Resolve Ref<T> directly when T is Decodable
extension Ref where T: Decodable {
    public static func resolve(_ ref: Ref<T>) async throws -> T
}

/// Enable `let x: T = try await ref` syntax
extension Ref: AsyncResolvable where T: Decodable {}
```

### Error Types

```swift
public enum RpcError: Error, Sendable {
    /// Server returned an error
    case remote(type: String, message: String)

    /// Connection was lost
    case connectionLost(underlying: Error?)

    /// Request timed out
    case timeout

    /// Request was cancelled
    case cancelled
}
```

### Configuration

```swift
public struct Configuration {
    /// Request timeout
    public var timeout: Duration = .seconds(30)

    /// Reconnection policy
    public var reconnect: ReconnectPolicy = .none

    /// Custom headers for WebSocket upgrade
    public var headers: [String: String] = [:]
}

public enum ReconnectPolicy {
    case none
    case immediate(maxAttempts: Int)
    case exponentialBackoff(max: Int, base: Duration = .seconds(1))
}
```

---

## The `@Rpc` Macro

The `@Rpc` macro generates RPC dispatch code for local objects:

```swift
@Rpc actor ChatRoom {
    private var messages: [Message] = []

    func send(_ text: String, from user: String) -> Message {
        let msg = Message(text: text, from: user, at: .now)
        messages.append(msg)
        return msg
    }

    func history(limit: Int = 50) -> [Message] {
        Array(messages.suffix(limit))
    }
}

// Generated: ChatRoom.stub property returning Ref<ChatRoom>
// that can be passed to remote callers
```

For classes:

```swift
@Rpc class Calculator {
    func add(_ a: Int, _ b: Int) -> Int { a + b }
    func multiply(_ a: Int, _ b: Int) -> Int { a * b }
}
```

---

## Protocol-Based APIs (Optional)

For compile-time type safety, define your API as a protocol:

```swift
@RpcProtocol
protocol UserAPI {
    func get(id: Int) async throws -> User
    func create(name: String, email: String) async throws -> User
    func delete(id: Int) async throws
}

// Use with typed session
let session = try await RpcSession<UserAPI>.connect(to: url)
let user = try await session.api.get(id: 123)  // Full autocomplete
```

The `@RpcProtocol` macro generates a conforming stub type with full IDE support.

---

## Advanced Patterns

### Parallel Resolution

```swift
// Resolve multiple refs in parallel
async let user: User = session.api.users.get(123)
async let posts: [Post] = session.api.posts.forUser(123)

let (u, p) = try await (user, posts)
```

### Streaming (AsyncSequence)

```swift
// Server returns a stream
let events = session.api.events.subscribe()

for try await event in events.stream(of: Event.self) {
    print("Event: \(event)")
}
```

### HTTP Batch Mode

```swift
// Single HTTP request for multiple calls
let results = try await RpcSession.batch(url: url) { api in
    let user = api.users.get(123)
    let posts = api.posts.forUser(123)
    return try await (user.resolve(), posts.resolve())
}
```

---

## Why This Design

### Invisible Pipelining

Other RPC frameworks require explicit batching or special syntax. CapnWeb's `Ref<T>` type enables natural chaining where the framework automatically optimizes wire traffic:

```swift
// Looks like 4 calls, executes as 1 round-trip
let name: String = try await api.auth(token).user.profile.name
```

### Actor-Isolated Sessions

The session is an actor, eliminating data races without requiring users to think about thread safety:

```swift
// Safe to call from any context
Task.detached {
    let user = try await session.api.users.get(123)
}
```

### Dynamic with Type Hints

`@dynamicMemberLookup` provides fluid syntax while explicit type annotations enable inference:

```swift
let user: User = try await api.users.get(123)  // Type inferred
```

For full type safety, use `@RpcProtocol` to get compile-time checking and autocomplete.

### Swift Error Handling

No custom result types or callbacks. Standard `async throws`:

```swift
do {
    let result = try await api.operation()
} catch {
    // Handle error
}
```

---

## Summary

| Aspect | Design Choice |
|--------|---------------|
| Connection | `RpcSession.connect(to:)` actor |
| Remote calls | `Ref<T>` with `@dynamicMemberLookup` |
| Pipelining | Automatic via `Ref` chaining |
| Resolution | `try await ref` or `.resolve(as:)` |
| Local objects | `@Rpc` macro on actor/class |
| Type safety | Optional `@RpcProtocol` for full IDE support |
| Errors | `RpcError` enum with `async throws` |

```swift
// The complete picture
import CapnWeb

let session = try await RpcSession.connect(to: "wss://api.example.com")

let profile: Profile = try await session.api
    .authenticate(token)
    .currentUser
    .profile

print("Hello, \(profile.name)!")

await session.close()
```
