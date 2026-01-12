# CapnWeb

**Capability-based RPC for Swift with native async/await and SwiftUI integration.**

[![Swift 5.9+](https://img.shields.io/badge/Swift-5.9+-orange.svg)](https://swift.org)
[![Platforms](https://img.shields.io/badge/Platforms-iOS%2016+%20|%20macOS%2013+%20|%20visionOS%201+-blue.svg)](https://developer.apple.com)
[![SPM Compatible](https://img.shields.io/badge/SPM-Compatible-brightgreen.svg)](https://swift.org/package-manager/)

```swift
let session = try await RpcSession<TodoAPI>.connect(to: "wss://api.example.com")

let authorName: String = try await session.api
    .todos.get(id: "123")
    .author
    .profile
    .displayName

// Four chained calls. One network round-trip. Full type safety.
```

CapnWeb brings promise pipelining to Swift with an API that embraces `@dynamicMemberLookup`, actors, and structured concurrency. Write natural Swift code; the framework optimizes network traffic automatically.

---

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/dot-do/capnweb-swift.git", from: "1.0.0")
]

targets: [
    .target(
        name: "YourApp",
        dependencies: [
            .product(name: "CapnWeb", package: "capnweb-swift")
        ]
    )
]
```

Or in Xcode: File > Add Package Dependencies, then enter the repository URL.

**Requirements**: Swift 5.9+, macOS 13+, iOS 16+, tvOS 16+, watchOS 9+, visionOS 1+

---

## Quick Start

### Connect

```swift
import CapnWeb

// Untyped session (dynamic member lookup)
let session = try await RpcSession.connect(to: "wss://api.example.com")

// Typed session (full autocomplete)
let typedSession = try await RpcSession<TodoAPI>.connect(to: "wss://api.example.com")
```

### Call

```swift
// Access properties - builds pipeline, no network yet
let userRef = session.api.users.get(id: 123)    // Ref<User>

// Await to resolve - NOW the network call happens
let user: User = try await userRef
```

### Pipeline

Chain calls naturally. CapnWeb sends them in a single round-trip:

```swift
// All four operations execute as ONE network request
let displayName: String = try await session.api
    .authenticate(token)
    .currentUser
    .profile
    .displayName
```

### Disconnect

```swift
await session.close()

// Or use scoped lifecycle (recommended)
try await withRpcSession(to: url) { session in
    let result = try await session.api.doWork()
    // Connection closes automatically
}
```

---

## SwiftUI Integration

CapnWeb is built for SwiftUI with native `@Observable` support.

### Observable View Models

```swift
import SwiftUI
import CapnWeb

@Observable
final class TodoListViewModel {
    private let session: RpcSession<TodoAPI>

    var todos: [Todo] = []
    var isLoading = false
    var error: Error?

    init(session: RpcSession<TodoAPI>) {
        self.session = session
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        do {
            todos = try await session.api.todos.list()
        } catch {
            self.error = error
        }
    }

    func create(title: String) async throws -> Todo {
        let todo = try await session.api.todos.create(title: title)
        todos.insert(todo, at: 0)
        return todo
    }

    func toggle(_ todo: Todo) async throws {
        let updated = try await session.api
            .todos[todo.id]
            .update(completed: !todo.completed)

        if let index = todos.firstIndex(where: { $0.id == todo.id }) {
            todos[index] = updated
        }
    }
}
```

### SwiftUI Views

```swift
struct TodoListView: View {
    @State private var viewModel: TodoListViewModel
    @State private var newTodoTitle = ""

    init(session: RpcSession<TodoAPI>) {
        _viewModel = State(initialValue: TodoListViewModel(session: session))
    }

    var body: some View {
        List {
            Section {
                HStack {
                    TextField("New todo", text: $newTodoTitle)
                    Button("Add") {
                        Task {
                            try await viewModel.create(title: newTodoTitle)
                            newTodoTitle = ""
                        }
                    }
                    .disabled(newTodoTitle.isEmpty)
                }
            }

            Section {
                ForEach(viewModel.todos) { todo in
                    TodoRow(todo: todo) {
                        Task { try await viewModel.toggle(todo) }
                    }
                }
            }
        }
        .task { await viewModel.load() }
        .overlay {
            if viewModel.isLoading {
                ProgressView()
            }
        }
    }
}

struct TodoRow: View {
    let todo: Todo
    let onToggle: () -> Void

    var body: some View {
        HStack {
            Image(systemName: todo.completed ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(todo.completed ? .green : .secondary)

            Text(todo.title)
                .strikethrough(todo.completed)

            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onToggle)
    }
}
```

### Real-Time Updates with AsyncSequence

```swift
@Observable
final class NotificationViewModel {
    private let session: RpcSession<API>
    private var streamTask: Task<Void, Never>?

    var notifications: [Notification] = []
    var connectionState: ConnectionState = .disconnected

    init(session: RpcSession<API>) {
        self.session = session
    }

    func startListening() {
        streamTask = Task {
            do {
                let stream: AsyncThrowingStream<Notification, Error> =
                    try await session.api.notifications.subscribe(topic: "updates")

                for try await notification in stream {
                    await MainActor.run {
                        notifications.insert(notification, at: 0)
                    }
                }
            } catch {
                await MainActor.run {
                    connectionState = .error(error)
                }
            }
        }
    }

    func stopListening() {
        streamTask?.cancel()
        streamTask = nil
    }
}

struct NotificationBadge: View {
    @State private var viewModel: NotificationViewModel

    var body: some View {
        Menu {
            ForEach(viewModel.notifications.prefix(5)) { notification in
                Text(notification.message)
            }
        } label: {
            Image(systemName: "bell.fill")
                .overlay(alignment: .topTrailing) {
                    if !viewModel.notifications.isEmpty {
                        Circle()
                            .fill(.red)
                            .frame(width: 8, height: 8)
                    }
                }
        }
        .task { viewModel.startListening() }
    }
}
```

### Environment-Based Session Injection

```swift
// Define environment key
struct RpcSessionKey: EnvironmentKey {
    static let defaultValue: RpcSession<API>? = nil
}

extension EnvironmentValues {
    var rpcSession: RpcSession<API>? {
        get { self[RpcSessionKey.self] }
        set { self[RpcSessionKey.self] = newValue }
    }
}

// App setup
@main
struct MyApp: App {
    @State private var session: RpcSession<API>?

    var body: some Scene {
        WindowGroup {
            Group {
                if let session {
                    ContentView()
                        .environment(\.rpcSession, session)
                } else {
                    ProgressView("Connecting...")
                }
            }
            .task {
                session = try? await RpcSession<API>.connect(to: apiURL)
            }
        }
    }
}

// Usage in views
struct ProfileView: View {
    @Environment(\.rpcSession) private var session
    @State private var user: User?

    var body: some View {
        Group {
            if let user {
                UserProfileCard(user: user)
            } else {
                ProgressView()
            }
        }
        .task {
            guard let session else { return }
            user = try? await session.api.currentUser
        }
    }
}
```

---

## The `Ref<T>` Type

`Ref<T>` is the heart of CapnWeb. It represents a reference to a remote value that hasn't been fetched yet.

```swift
let userRef = session.api.users.get(id: 123)   // Ref<User> - no network call yet
let nameRef = userRef.profile.displayName       // Ref<String> - still no call
let name: String = try await nameRef            // NOW the call happens
```

### Dynamic Member Lookup

`Ref<T>` uses `@dynamicMemberLookup` to forward property access:

```swift
@dynamicMemberLookup
@dynamicCallable
public struct Ref<T>: Sendable {
    /// Access a property on the remote object
    public subscript<U>(dynamicMember member: String) -> Ref<U> { get }

    /// Call a method on the remote object
    public func dynamicallyCall<R>(
        withKeywordArguments args: KeyValuePairs<String, any Sendable>
    ) -> Ref<R>
}

// Enables natural syntax:
let profile = session.api.users.get(id: 123).profile  // Ref<Profile>
```

### Passing Refs as Arguments

Pass unresolved refs to other calls for server-side composition:

```swift
let authed = session.api.authenticate(token)  // Ref<AuthedAPI>

// userId is extracted from authed.currentUser.id on the SERVER
let profile: Profile = try await session.api.getUserProfile(
    userId: authed.currentUser.id  // Ref<Int>, not Int
)
```

This executes as a single round-trip. The server resolves `authed.currentUser.id` internally.

---

## Typed APIs with Protocols

For compile-time safety and IDE autocompletion, define your API as protocols:

```swift
@RpcProtocol
protocol TodoAPI {
    var todos: TodoService { get async throws }
    var users: UserService { get async throws }
    func authenticate(token: String) async throws -> AuthenticatedAPI
}

@RpcProtocol
protocol TodoService {
    func list(filter: TodoFilter?) async throws -> [Todo]
    func get(id: String) async throws -> Todo
    func create(title: String) async throws -> Todo
    subscript(id: String) -> SingleTodoService { get }
}

@RpcProtocol
protocol SingleTodoService {
    var author: UserService { get async throws }
    func get() async throws -> Todo
    func update(completed: Bool) async throws -> Todo
    func delete() async throws
}

@RpcProtocol
protocol AuthenticatedAPI {
    var currentUser: User { get async throws }
    var todos: MutableTodoService { get async throws }
}
```

Use with a typed session:

```swift
let session = try await RpcSession<TodoAPI>.connect(to: url)

// Full autocomplete and compile-time type checking
let todos = try await session.api.todos.list(filter: .active)
let author = try await session.api.todos["123"].author
```

The `@RpcProtocol` macro generates conforming stub types automatically.

---

## Connection Configuration

### Result Builder DSL

```swift
let session = try await RpcSession<API>.connect(to: url) {
    Timeout(.seconds(30))

    Reconnect {
        MaxAttempts(10)
        Backoff(.exponential(base: .seconds(1), max: .seconds(30)))
    }

    Headers {
        Header("X-Client-Version", "1.0.0")
        Header("X-Platform", "iOS")
    }

    TLS {
        PinnedCertificates(bundle: .main, named: "api-cert")
    }
}
```

### Closure-Based Configuration

```swift
let session = try await RpcSession<API>.connect(to: url) { config in
    config.timeout = .seconds(30)
    config.reconnect = .exponentialBackoff(
        maxAttempts: 10,
        baseDelay: .seconds(1),
        maxDelay: .seconds(30)
    )
    config.headers = [
        "X-Client-Version": "1.0.0",
        "X-Platform": "iOS"
    ]
}
```

### HTTP Batch Mode

For stateless environments or when WebSockets aren't available:

```swift
let results = try await RpcSession<API>.batch(url: url) { api in
    async let user: User = api.users.get(id: 123)
    async let posts: [Post] = api.posts.forUser(id: 123)
    async let friends: [User] = api.friends.of(userId: 123)

    return try await (user, posts, friends)
}

let (user, posts, friends) = results
```

All calls in the batch execute as a single HTTP POST request.

---

## Streaming

### AsyncSequence for Server Streams

```swift
// Direct type annotation on the stream
let events: AsyncThrowingStream<Event, Error> =
    try await session.api.events.subscribe(topic: "updates")

for try await event in events {
    print("Event: \(event.name)")
}
```

### Cancellation

```swift
let task = Task {
    let stream: AsyncThrowingStream<Event, Error> =
        try await session.api.events.subscribe(topic: "updates")

    for try await event in stream {
        process(event)
    }
}

// Later: cancellation propagates to server
task.cancel()
```

### With SwiftUI

```swift
struct LiveFeedView: View {
    let session: RpcSession<API>
    @State private var events: [Event] = []

    var body: some View {
        List(events) { event in
            EventRow(event: event)
        }
        .task {
            do {
                let stream: AsyncThrowingStream<Event, Error> =
                    try await session.api.events.subscribe(topic: "live")

                for try await event in stream {
                    events.insert(event, at: 0)
                    if events.count > 100 {
                        events.removeLast()
                    }
                }
            } catch {
                // Handle stream error
            }
        }
    }
}
```

---

## Exposing Local Objects

Make Swift types callable from the remote side using the `@Rpc` macro:

```swift
@Rpc actor NotificationHandler {
    private var received: [Message] = []

    func onMessage(_ message: Message) {
        received.append(message)
        NotificationCenter.default.post(
            name: .newMessage,
            object: message
        )
    }

    func onError(_ error: String) {
        print("Error: \(error)")
    }
}

let handler = NotificationHandler()
try await session.api.subscribe(callback: handler.stub)
```

### Actors for Thread Safety (Recommended)

```swift
@Rpc actor ChatRoom {
    private var messages: [Message] = []
    private var participants: Set<String> = []

    func join(userId: String) -> [Message] {
        participants.insert(userId)
        return Array(messages.suffix(50))
    }

    func send(_ text: String, from userId: String) -> Message {
        let message = Message(
            id: UUID().uuidString,
            text: text,
            from: userId,
            timestamp: .now
        )
        messages.append(message)
        return message
    }

    func leave(userId: String) {
        participants.remove(userId)
    }
}
```

### What Gets Exposed

The `@Rpc` macro exposes all public and internal methods. Private methods are not exposed:

```swift
@Rpc actor SecureService {
    func publicMethod() -> String {      // Exposed
        return internalHelper()
    }

    private func internalHelper() -> String {  // NOT exposed
        return "secret"
    }
}
```

---

## Workflow Orchestration

### Sequential Operations

```swift
func onboardUser(email: String, name: String) async throws -> User {
    // Each step uses the result of the previous
    let invitation = try await session.api.invitations.create(email: email)
    let user = try await session.api.users.register(
        invitationCode: invitation.code,
        name: name
    )
    let profile = try await session.api.profiles.setup(
        userId: user.id,
        defaults: .standard
    )

    return user
}
```

### Pipelined Operations

```swift
func onboardUserOptimized(email: String, name: String) async throws -> User {
    // Single round-trip: server chains operations
    let user: User = try await session.api
        .invitations.create(email: email)
        .accept(name: name)
        .setupProfile(defaults: .standard)
        .user

    return user
}
```

### Parallel Resolution

```swift
func loadDashboard() async throws -> Dashboard {
    async let user: User = session.api.currentUser
    async let todos: [Todo] = session.api.todos.list(filter: .active)
    async let notifications: [Notification] = session.api.notifications.unread()
    async let stats: Stats = session.api.analytics.summary()

    return try await Dashboard(
        user: user,
        todos: todos,
        notifications: notifications,
        stats: stats
    )
}
```

### Task Groups for Dynamic Parallelism

```swift
func fetchAllUserProfiles(ids: [String]) async throws -> [String: Profile] {
    try await withThrowingTaskGroup(of: (String, Profile).self) { group in
        for id in ids {
            group.addTask {
                let profile: Profile = try await session.api.users[id].profile
                return (id, profile)
            }
        }

        var profiles: [String: Profile] = [:]
        for try await (id, profile) in group {
            profiles[id] = profile
        }
        return profiles
    }
}
```

---

## Error Handling

CapnWeb uses standard Swift error handling:

```swift
do {
    let result = try await session.api.riskyOperation()
} catch let error as RpcError {
    switch error {
    case .remote(let type, let message):
        // Server threw an exception
        print("Server error [\(type)]: \(message)")

    case .connectionLost(let underlying):
        // WebSocket disconnected
        print("Connection lost: \(underlying?.localizedDescription ?? "unknown")")

    case .timeout:
        print("Request timed out")

    case .cancelled:
        print("Request was cancelled")

    case .invalidResponse:
        print("Malformed server response")
    }
}
```

### Broken References

When a pipeline fails partway through, downstream refs become "broken":

```swift
let authed = session.api.authenticate(badToken)  // Will fail
let user = authed.currentUser                     // Broken ref

// Awaiting a broken ref throws the original error
do {
    let profile: Profile = try await user.profile
} catch let error as RpcError {
    // error is .remote("AuthenticationError", "Invalid token")
}
```

### Retry with Exponential Backoff

```swift
func fetchWithRetry<T>(
    maxAttempts: Int = 3,
    operation: () async throws -> T
) async throws -> T {
    var lastError: Error?

    for attempt in 0..<maxAttempts {
        do {
            return try await operation()
        } catch let error as RpcError {
            lastError = error

            switch error {
            case .connectionLost, .timeout:
                let delay = Duration.seconds(pow(2.0, Double(attempt)))
                try await Task.sleep(for: delay)
                continue
            default:
                throw error
            }
        }
    }

    throw lastError!
}

// Usage
let user = try await fetchWithRetry {
    try await session.api.users.get(id: userId)
}
```

---

## Resource Management

### Actor Isolation

`RpcSession` is an actor, ensuring thread-safe access:

```swift
public actor RpcSession<API> {
    public nonisolated var api: Ref<API> { get }

    public static func connect(
        to url: URL,
        configure: ((inout Configuration) -> Void)? = nil
    ) async throws -> RpcSession<API>

    public func close() async
}
```

### Task Cancellation

CapnWeb respects Swift's structured concurrency:

```swift
let task = Task {
    try await session.api.longRunningOperation()
}

// Later...
task.cancel()  // Sends cancellation to server
```

### Scoped Sessions

```swift
try await withRpcSession(to: url) { session in
    // Session is valid here
    let data = try await session.api.fetchData()
    process(data)
    // Session closes automatically, even on throw
}
```

### Connection Monitoring

```swift
// Observe connection state
for await state in session.connectionStates {
    switch state {
    case .connected:
        hideReconnectingBanner()
    case .reconnecting(attempt: let n):
        showReconnectingBanner(attempt: n)
    case .disconnected(let error):
        showDisconnectedAlert(error)
    }
}

// Or with callbacks
session.onDisconnect { error in
    print("Disconnected: \(error)")
}

session.onReconnect {
    print("Reconnected!")
}
```

---

## Security

### Transport Security

```swift
let session = try await RpcSession<API>.connect(to: url) { config in
    config.tls = .init(
        minimumVersion: .TLSv12,
        pinnedCertificates: [myCertificate]
    )
}
```

### Authentication

```swift
// Bearer token
let session = try await RpcSession<API>.connect(to: url) { config in
    config.headers["Authorization"] = "Bearer \(token)"
}

// Or authenticate after connection
let authedAPI = try await session.api.authenticate(token: apiKey)
```

### Capability Security

CapnWeb uses capability-based security. Access is granted by possession of object references:

```swift
// The server returns a capability that grants specific access
let adminAPI = try await session.api.authenticate(adminToken)

// This capability can perform admin operations
try await adminAPI.users.delete(id: userId)

// Regular API cannot
// session.api.users.delete(id: userId)  // Would fail - no permission
```

---

## Platform Setup

### iOS App

```swift
import SwiftUI
import CapnWeb

@main
struct MyApp: App {
    @State private var session: RpcSession<API>?

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcSession, session)
                .task {
                    do {
                        session = try await RpcSession<API>.connect(
                            to: URL(string: "wss://api.example.com")!
                        ) { config in
                            config.reconnect = .exponentialBackoff(
                                maxAttempts: .max,
                                baseDelay: .seconds(1),
                                maxDelay: .seconds(30)
                            )
                        }
                    } catch {
                        // Handle connection error
                    }
                }
        }
    }
}
```

### macOS App

```swift
import AppKit
import CapnWeb

@main
struct MyMacApp: App {
    @State private var session: RpcSession<API>?

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcSession, session)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Reconnect") {
                    Task {
                        await session?.reconnect()
                    }
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }
    }
}
```

### Server-Side Swift (Vapor)

```swift
import Vapor
import CapnWeb

func configure(_ app: Application) async throws {
    // Connect to backend service
    let rpcSession = try await RpcSession<BackendAPI>.connect(
        to: URL(string: "wss://internal-api.example.com")!
    )

    // Store in application storage
    app.storage[RpcSessionKey.self] = rpcSession

    // Use in routes
    app.get("users", ":id") { req async throws -> User in
        let session = req.application.storage[RpcSessionKey.self]!
        let id = req.parameters.get("id")!
        return try await session.api.users.get(id: id)
    }
}
```

---

## Type Reference

### RpcSession

```swift
public actor RpcSession<API> {
    /// The root API reference (nonisolated for easy access)
    public nonisolated var api: Ref<API> { get }

    /// Connect to a CapnWeb server
    public static func connect(
        to url: URL,
        configure: ((inout Configuration) -> Void)? = nil
    ) async throws -> RpcSession<API>

    /// Connect with result builder configuration
    public static func connect(
        to url: URL,
        @ConfigurationBuilder configure: () -> Configuration
    ) async throws -> RpcSession<API>

    /// Execute batched calls over HTTP
    public static func batch<T>(
        url: URL,
        execute: (Ref<API>) async throws -> T
    ) async throws -> T

    /// Close the connection gracefully
    public func close() async

    /// Attempt to reconnect
    public func reconnect() async throws

    /// Connection state stream
    public var connectionStates: AsyncStream<ConnectionState> { get }
}
```

### Ref

```swift
@dynamicMemberLookup
@dynamicCallable
public struct Ref<T>: Sendable {
    /// Access a property on the remote object
    public subscript<U>(dynamicMember member: String) -> Ref<U>

    /// Call a method on the remote object
    public func dynamicallyCall<R>(
        withKeywordArguments args: KeyValuePairs<String, any Sendable>
    ) -> Ref<R>
}

// Ref conforms to AsyncSequence when T is a stream
extension Ref: AsyncSequence where T: AsyncSequenceType {
    public typealias Element = T.Element

    public func makeAsyncIterator() -> AsyncThrowingStream<Element, Error>.Iterator
}
```

### Configuration

```swift
public struct Configuration: Sendable {
    /// Request timeout (default: 30 seconds)
    public var timeout: Duration

    /// Reconnection policy (default: none)
    public var reconnect: ReconnectPolicy

    /// Custom headers for WebSocket upgrade
    public var headers: [String: String]

    /// TLS configuration
    public var tls: TLSConfiguration?
}

public enum ReconnectPolicy: Sendable {
    case none
    case immediate(maxAttempts: Int)
    case exponentialBackoff(maxAttempts: Int, baseDelay: Duration, maxDelay: Duration)
}

public enum ConnectionState: Sendable {
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case disconnected(Error?)
}
```

---

## How It Works

### Promise Pipelining

When you write:

```swift
let name: String = try await api.authenticate(token).currentUser.profile.displayName
```

CapnWeb doesn't make four sequential network calls. Instead:

1. It builds an expression tree representing the entire chain
2. Sends that expression in a single `push` message
3. The server evaluates the chain locally
4. Returns just the final result

This is **promise pipelining** from Cap'n Proto, adapted for JSON-over-WebSocket.

### Import/Export Tables

CapnWeb maintains bidirectional reference tables:

- **Imports**: Remote objects you're calling (stubs)
- **Exports**: Local objects you've exposed (targets)

When you pass an `@Rpc` object's `.stub`, it gets an export ID. The remote side imports that ID and can call methods on it.

### Wire Protocol

Messages are JSON arrays:

```json
["push", ["import", 0, ["authenticate"], [["token123"]]]]
["pull", 1]
["resolve", 1, {"userId": 42, "name": "Alice"}]
["release", 1, 1]
```

See [protocol.md](../../protocol.md) for the complete specification.

---

## Comparison

| Feature | CapnWeb | gRPC-Swift | URLSession |
|---------|---------|------------|------------|
| Pipelining | Automatic | Manual batching | N/A |
| Bidirectional | Yes | Streaming only | No |
| Type Safety | Optional protocols | Generated stubs | Manual |
| Transport | WebSocket/HTTP | HTTP/2 | HTTP |
| Schema | None required | Protobuf | OpenAPI |
| SwiftUI | Native `@Observable` | Manual | Manual |
| Async/Await | Native | Native | Native |

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting PRs.

---

*Built for Swift developers who believe remote calls should feel as natural as local ones.*
