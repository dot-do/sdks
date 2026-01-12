# RpcDo

**Managed RPC client for Swift with automatic routing, promise pipelining, and native SwiftUI integration.**

[![Swift 5.9+](https://img.shields.io/badge/Swift-5.9+-orange.svg)](https://swift.org)
[![Platforms](https://img.shields.io/badge/Platforms-iOS%2016+%20|%20macOS%2013+%20|%20tvOS%2016+%20|%20watchOS%209+-blue.svg)](https://developer.apple.com)
[![SPM Compatible](https://img.shields.io/badge/SPM-Compatible-brightgreen.svg)](https://swift.org/package-manager/)

```swift
import RpcDo

let client = try RpcClient(url: "wss://api.example.com")
try await client.connect()

// Magic proxy syntax - chain calls naturally
let userName: String = try await client.api
    .users.get(id: "123")
    .profile
    .displayName

// Four operations. One network round-trip. Full type safety.
```

RpcDo builds on top of raw CapnWeb to provide a managed proxy layer with automatic connection handling, intelligent routing, and Swift-native idioms. Write natural Swift code using `@dynamicMemberLookup` and `async/await`; RpcDo optimizes everything behind the scenes.

---

## What RpcDo Adds Over Raw CapnWeb

| Feature | Raw CapnWeb | RpcDo |
|---------|-------------|-------|
| Connection Management | Manual | Automatic with reconnection |
| Request Routing | Manual dispatch | Intelligent proxy routing |
| Error Recovery | Manual retry | Built-in exponential backoff |
| Rate Limiting | Manual | Automatic with retry-after |
| Pipeline Building | Manual expression trees | `@dynamicMemberLookup` magic |
| SwiftUI Integration | Manual | `@Observable` patterns included |
| Streaming | Manual WebSocket handling | `AsyncSequence` wrappers |

RpcDo wraps the low-level CapnWeb protocol in a developer-friendly API that feels like calling local Swift methods.

---

## Installation

### Swift Package Manager

Add RpcDo to your `Package.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "YourApp",
    platforms: [
        .macOS(.v13),
        .iOS(.v16),
        .tvOS(.v16),
        .watchOS(.v9)
    ],
    dependencies: [
        .package(url: "https://github.com/dot-do/rpc", from: "1.0.0")
    ],
    targets: [
        .target(
            name: "YourApp",
            dependencies: [
                .product(name: "RpcDo", package: "rpc")
            ]
        )
    ]
)
```

### Xcode

1. Open your project in Xcode
2. Go to **File > Add Package Dependencies...**
3. Enter repository URL: `https://github.com/dot-do/rpc`
4. Select version: **1.0.0** or later
5. Add **RpcDo** to your target

### Requirements

- Swift 5.9+
- macOS 13+ (Ventura)
- iOS 16+
- tvOS 16+
- watchOS 9+
- visionOS 1+

---

## Quick Start

### Connect to a Server

```swift
import RpcDo

// Create and connect the client
let client = try RpcClient(url: "wss://api.example.com")
try await client.connect()

// Access the magic proxy
let api = client.api

// Make calls using natural Swift syntax
let result = try await api.echo(message: "Hello, RpcDo!")
```

### Scoped Connections

Use `withConnection` for automatic lifecycle management:

```swift
let result = try await RpcClient.withConnection(to: "wss://api.example.com") { client in
    // Client is connected here
    let user = try await client.api.users.get(id: "123")
    return user
    // Client disconnects automatically, even on error
}
```

### Disconnect Gracefully

```swift
await client.disconnect()
```

---

## The Magic Proxy Syntax

RpcDo's `RpcRef<T>` type uses `@dynamicMemberLookup` to enable a natural, chainable API that looks like local Swift code but executes remotely.

### Property Access

```swift
// Access nested properties - no network calls yet
let profileRef = client.api.users.current.profile   // RpcRef<Profile>
let nameRef = profileRef.displayName                 // RpcRef<String>

// Await to resolve - NOW the network call happens
let name: String = try await nameRef
```

### Method Calls

```swift
// Call methods with arguments
let user = try await client.api.users.create(
    name: "Alice",
    email: "alice@example.com"
)

// Chain method calls with property access
let posts = try await client.api
    .users.authenticate(token: bearerToken)
    .currentUser
    .posts
    .list(limit: 10)
```

### Subscript Access

```swift
// Access array elements or dictionary keys
let firstUser = try await client.api.users.all[0]
let userById = try await client.api.users["abc-123"]
```

### Building Pipelines

The key insight is that property access and method calls don't trigger network requests immediately. They build up an expression tree:

```swift
// This builds an expression tree, no network yet
let ref = client.api
    .authenticate(token: "secret")
    .currentUser
    .profile
    .avatar
    .url

// This sends the entire pipeline in ONE request
let avatarUrl: String = try await ref

// The server evaluates: authenticate() -> currentUser -> profile -> avatar -> url
// Only the final result comes back over the wire
```

This is **promise pipelining** - a technique from Cap'n Proto that eliminates round-trips.

---

## Promise Pipelining

### Traditional REST: N+1 Round Trips

With traditional REST APIs:

```swift
// 4 separate HTTP requests!
let session = try await api.POST("/auth", body: ["token": token])
let user = try await api.GET("/users/\(session.userId)")
let profile = try await api.GET("/profiles/\(user.profileId)")
let avatar = try await api.GET("/avatars/\(profile.avatarId)")
let url = avatar.url  // Finally have the data
```

### RpcDo: Single Round Trip

With RpcDo's pipelining:

```swift
// 1 request, 1 response
let url: String = try await client.api
    .authenticate(token: token)
    .currentUser
    .profile
    .avatar
    .url
```

The entire chain is serialized and sent to the server, which evaluates it locally and returns only the final result.

### Server-Side Composition

Pass unresolved refs as arguments to enable server-side data composition:

```swift
// The userId is extracted on the SERVER, not the client
let authed = client.api.authenticate(token: token)

let profile = try await client.api.profiles.forUser(
    userId: authed.currentUser.id  // This is a Ref, not a String!
)

// Single round-trip: server resolves authed.currentUser.id internally
```

### Parallel Pipelines

Use Swift's `async let` to run independent pipelines in parallel:

```swift
async let user = client.api.users.current
async let notifications = client.api.notifications.unread(limit: 10)
async let stats = client.api.analytics.dashboard

// All three pipelines execute concurrently
let (u, n, s) = try await (user, notifications, stats)
```

---

## The `RpcRef<T>` Type

`RpcRef<T>` is the core abstraction. It represents a lazy reference to a remote value.

### Type Definition

```swift
@dynamicMemberLookup
public struct RpcRef<T>: Sendable {
    /// Access a property on the remote object
    public subscript<U>(dynamicMember member: String) -> RpcRef<U> { get }

    /// Debug representation of the expression path
    public var expressionString: String { get }
}
```

### Implicit Awaiting

When you `await` an `RpcRef`, it resolves to the underlying value:

```swift
let ref: RpcRef<User> = client.api.users.get(id: "123")

// Explicitly await to get the value
let user: User = try await ref

// Or use in an async context
print(try await ref.name)  // Implicitly creates Ref<String> and awaits
```

### Expression Debugging

Inspect what operations a ref will perform:

```swift
let ref = client.api.users.get(id: "123").profile.displayName

print(ref.expressionString)
// Output: .users.get(id: "123").profile.displayName
```

### Map Operations

Transform collections server-side to avoid N+1 queries:

```swift
// BAD: N+1 round trips
let users = try await client.api.users.list()
var profiles: [Profile] = []
for user in users {
    let profile = try await client.api.profiles.forUser(userId: user.id)
    profiles.append(profile)
}

// GOOD: Single round trip with .map
let profiles: [Profile] = try await client.api.users.list()
    .map { user in
        client.api.profiles.forUser(userId: user.id)
    }
```

---

## Configuration

### Basic Configuration

```swift
let config = RpcClientConfiguration(
    url: URL(string: "wss://api.example.com")!,
    timeout: 30.0,
    maxRetries: 3,
    retryBaseDelay: 0.1,
    maxRetryDelay: 10.0,
    headers: [
        "Authorization": "Bearer \(token)",
        "X-Client-Version": "1.0.0"
    ]
)

let client = RpcClient(configuration: config)
try await client.connect()
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `URL` | Required | WebSocket server URL |
| `timeout` | `TimeInterval` | 30.0 | Request timeout in seconds |
| `maxRetries` | `Int` | 3 | Maximum retry attempts |
| `retryBaseDelay` | `TimeInterval` | 0.1 | Initial retry delay |
| `maxRetryDelay` | `TimeInterval` | 10.0 | Maximum retry delay |
| `headers` | `[String: String]` | `[:]` | Custom headers |

### Per-Request Timeout

Override timeout for specific operations:

```swift
let result = try await client.api
    .longRunningOperation()
    .timeout(.seconds(120))
```

### Authentication Headers

Set or update authentication at runtime:

```swift
// Set initial auth
let client = RpcClient(configuration: .init(
    url: apiURL,
    headers: ["Authorization": "Bearer \(accessToken)"]
))

// Update on token refresh
await client.updateHeader("Authorization", value: "Bearer \(newToken)")
```

---

## Error Handling

### RpcError Types

RpcDo provides strongly-typed errors:

```swift
public enum RpcError: Error, Sendable, Equatable {
    /// Remote server returned an error
    case remote(type: String, message: String)

    /// Connection was lost
    case connectionLost(String?)

    /// Request timed out
    case timeout

    /// Request was cancelled
    case cancelled

    /// Invalid response from server
    case invalidResponse(String)

    /// Invalid argument provided
    case invalidArgument(String)

    /// Resource not found
    case notFound(String)

    /// Method not implemented
    case notImplemented(String)

    /// Authentication failed
    case authenticationFailed(String)

    /// Rate limit exceeded
    case rateLimitExceeded(retryAfter: TimeInterval?)
}
```

### Basic Error Handling

```swift
do {
    let user = try await client.api.users.get(id: invalidId)
} catch let error as RpcError {
    switch error {
    case .remote(let type, let message):
        print("Server error [\(type)]: \(message)")

    case .connectionLost(let reason):
        print("Disconnected: \(reason ?? "unknown")")

    case .timeout:
        print("Request timed out")

    case .cancelled:
        print("Request was cancelled")

    case .notFound(let resource):
        print("Not found: \(resource)")

    case .authenticationFailed(let reason):
        print("Auth failed: \(reason)")

    case .rateLimitExceeded(let retryAfter):
        if let delay = retryAfter {
            print("Rate limited. Retry after \(delay)s")
        }

    case .invalidResponse(let details):
        print("Bad response: \(details)")

    case .invalidArgument(let details):
        print("Invalid argument: \(details)")

    case .notImplemented(let method):
        print("Not implemented: \(method)")
    }
}
```

### Broken References

When a pipeline fails partway through, downstream refs become "broken":

```swift
let authed = client.api.authenticate(token: badToken)  // Will fail
let user = authed.currentUser                           // Broken ref
let profile = user.profile                              // Also broken

// Awaiting any broken ref throws the original error
do {
    let name: String = try await profile.displayName
} catch let error as RpcError {
    // error is .authenticationFailed("Invalid token")
}
```

### Automatic Retry

RpcDo automatically retries transient errors with exponential backoff:

```swift
// Built-in retry for:
// - .timeout
// - .connectionLost
// - .rateLimitExceeded (respects retry-after header)

// Customize retry behavior
let config = RpcClientConfiguration(
    url: apiURL,
    maxRetries: 5,
    retryBaseDelay: 0.2,    // Start with 200ms
    maxRetryDelay: 30.0     // Cap at 30 seconds
)
```

### Custom Retry Logic

Implement custom retry for specific error types:

```swift
func fetchWithRetry<T: Decodable>(
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
                // Retry with backoff
                let delay = pow(2.0, Double(attempt)) * 0.5
                try await Task.sleep(for: .seconds(delay))
                continue

            case .rateLimitExceeded(let retryAfter):
                if let delay = retryAfter {
                    try await Task.sleep(for: .seconds(delay))
                    continue
                }
                throw error

            default:
                // Don't retry other errors
                throw error
            }
        }
    }

    throw lastError!
}

// Usage
let user = try await fetchWithRetry {
    try await client.api.users.get(id: userId)
}
```

---

## Streaming with AsyncSequence

### Server-Sent Events

Subscribe to server-pushed events using Swift's `AsyncSequence`:

```swift
let events: AsyncThrowingStream<Event, Error> = try await client.api
    .events
    .subscribe(topic: "notifications")

for try await event in events {
    print("Received: \(event.type) - \(event.payload)")
}
```

### Cancellation

Cancellation propagates from Swift Tasks to the server:

```swift
let task = Task {
    let stream = try await client.api.events.subscribe(topic: "updates")

    for try await event in stream {
        process(event)
    }
}

// Later: cancel the subscription
task.cancel()  // Server-side subscription is also cancelled
```

### Bidirectional Streaming

Send messages while receiving:

```swift
let chat = try await client.api.chat.join(room: "general")

// Start receiving in background
Task {
    for try await message in chat.messages {
        displayMessage(message)
    }
}

// Send messages
try await chat.send(text: "Hello everyone!")
try await chat.send(text: "How's it going?")
```

### Stream Operators

Combine with Swift's async sequence operators:

```swift
// Filter events client-side
let importantEvents = try await client.api.events
    .subscribe(topic: "all")
    .filter { $0.priority == .high }

// Take first N items
let recentLogs = try await client.api.logs
    .stream(level: .error)
    .prefix(100)
    .reduce(into: []) { $0.append($1) }

// Transform items
let userNames = try await client.api.users
    .streamUpdates()
    .map { $0.displayName }
```

---

## Actors for Thread Safety

`RpcClient` is implemented as a Swift `actor`, ensuring thread-safe access:

```swift
public actor RpcClient {
    public let configuration: RpcClientConfiguration
    public private(set) var isConnected: Bool

    public func connect() async throws
    public func disconnect() async
    public nonisolated var api: RpcRef<Any> { get }
}
```

### Why Actor?

- **Isolation**: All mutable state is protected
- **Safe Concurrency**: Multiple tasks can call methods safely
- **No Data Races**: Swift compiler enforces isolation
- **Sendable**: Can be passed between tasks

### Using RpcClient from Multiple Tasks

```swift
let client = try RpcClient(url: "wss://api.example.com")
try await client.connect()

// Safe to call from multiple concurrent tasks
await withTaskGroup(of: User.self) { group in
    for id in userIds {
        group.addTask {
            try await client.api.users.get(id: id)
        }
    }
}
```

### Custom Service Actors

Wrap RpcClient in your own actors for domain-specific APIs:

```swift
actor UserService {
    private let client: RpcClient
    private var cache: [String: User] = [:]

    init(client: RpcClient) {
        self.client = client
    }

    func getUser(id: String) async throws -> User {
        if let cached = cache[id] {
            return cached
        }

        let user: User = try await client.api.users.get(id: id)
        cache[id] = user
        return user
    }

    func invalidateCache() {
        cache.removeAll()
    }
}
```

---

## SwiftUI Integration

RpcDo is designed with SwiftUI in mind, using Swift's modern `@Observable` macro.

### Observable View Models

```swift
import SwiftUI
import RpcDo

@Observable
final class UserListViewModel {
    private let client: RpcClient

    var users: [User] = []
    var isLoading = false
    var error: RpcError?

    init(client: RpcClient) {
        self.client = client
    }

    @MainActor
    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            users = try await client.api.users.list()
        } catch let rpcError as RpcError {
            self.error = rpcError
        } catch {
            self.error = .remote(type: "Unknown", message: error.localizedDescription)
        }
    }

    @MainActor
    func createUser(name: String, email: String) async throws -> User {
        let user: User = try await client.api.users.create(
            name: name,
            email: email
        )
        users.insert(user, at: 0)
        return user
    }

    @MainActor
    func deleteUser(_ user: User) async throws {
        try await client.api.users.delete(id: user.id)
        users.removeAll { $0.id == user.id }
    }
}
```

### SwiftUI Views

```swift
struct UserListView: View {
    @State private var viewModel: UserListViewModel
    @State private var showingAddSheet = false

    init(client: RpcClient) {
        _viewModel = State(initialValue: UserListViewModel(client: client))
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(viewModel.users) { user in
                    NavigationLink(value: user) {
                        UserRow(user: user)
                    }
                }
                .onDelete(perform: deleteUsers)
            }
            .navigationTitle("Users")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add", systemImage: "plus") {
                        showingAddSheet = true
                    }
                }
            }
            .overlay {
                if viewModel.isLoading {
                    ProgressView()
                }
            }
            .task {
                await viewModel.load()
            }
            .refreshable {
                await viewModel.load()
            }
            .sheet(isPresented: $showingAddSheet) {
                AddUserSheet(viewModel: viewModel)
            }
            .alert("Error", isPresented: .constant(viewModel.error != nil)) {
                Button("OK") { viewModel.error = nil }
            } message: {
                Text(viewModel.error?.localizedDescription ?? "")
            }
        }
    }

    private func deleteUsers(at offsets: IndexSet) {
        Task {
            for index in offsets {
                try? await viewModel.deleteUser(viewModel.users[index])
            }
        }
    }
}

struct UserRow: View {
    let user: User

    var body: some View {
        HStack {
            AsyncImage(url: URL(string: user.avatarUrl)) { image in
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } placeholder: {
                Color.gray.opacity(0.3)
            }
            .frame(width: 44, height: 44)
            .clipShape(Circle())

            VStack(alignment: .leading) {
                Text(user.name)
                    .font(.headline)
                Text(user.email)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }
}
```

### Add User Sheet

```swift
struct AddUserSheet: View {
    @Environment(\.dismiss) private var dismiss
    let viewModel: UserListViewModel

    @State private var name = ""
    @State private var email = ""
    @State private var isCreating = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                    .textContentType(.name)

                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
            }
            .navigationTitle("Add User")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            isCreating = true
                            defer { isCreating = false }

                            do {
                                _ = try await viewModel.createUser(
                                    name: name,
                                    email: email
                                )
                                dismiss()
                            } catch {
                                // Handle error
                            }
                        }
                    }
                    .disabled(name.isEmpty || email.isEmpty || isCreating)
                }
            }
            .overlay {
                if isCreating {
                    ProgressView()
                }
            }
        }
    }
}
```

### Real-Time Updates

Subscribe to server events and update UI in real-time:

```swift
@Observable
final class NotificationViewModel {
    private let client: RpcClient
    private var subscriptionTask: Task<Void, Never>?

    var notifications: [Notification] = []
    var unreadCount: Int { notifications.filter { !$0.isRead }.count }
    var connectionState: ConnectionState = .disconnected

    enum ConnectionState {
        case disconnected
        case connecting
        case connected
        case error(Error)
    }

    init(client: RpcClient) {
        self.client = client
    }

    func startListening() {
        subscriptionTask = Task { [weak self] in
            guard let self else { return }

            await MainActor.run {
                connectionState = .connecting
            }

            do {
                let stream: AsyncThrowingStream<Notification, Error> =
                    try await client.api.notifications.subscribe()

                await MainActor.run {
                    connectionState = .connected
                }

                for try await notification in stream {
                    await MainActor.run {
                        notifications.insert(notification, at: 0)

                        // Keep only last 100 notifications
                        if notifications.count > 100 {
                            notifications.removeLast()
                        }
                    }
                }
            } catch is CancellationError {
                await MainActor.run {
                    connectionState = .disconnected
                }
            } catch {
                await MainActor.run {
                    connectionState = .error(error)
                }
            }
        }
    }

    func stopListening() {
        subscriptionTask?.cancel()
        subscriptionTask = nil
    }

    @MainActor
    func markAllRead() async throws {
        try await client.api.notifications.markAllRead()

        for i in notifications.indices {
            notifications[i].isRead = true
        }
    }
}
```

```swift
struct NotificationBadge: View {
    @State private var viewModel: NotificationViewModel

    init(client: RpcClient) {
        _viewModel = State(initialValue: NotificationViewModel(client: client))
    }

    var body: some View {
        Menu {
            ForEach(viewModel.notifications.prefix(5)) { notification in
                Button {
                    // Handle tap
                } label: {
                    Label {
                        VStack(alignment: .leading) {
                            Text(notification.title)
                            Text(notification.body)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: notification.isRead ? "bell" : "bell.badge")
                    }
                }
            }

            Divider()

            Button("Mark All Read") {
                Task {
                    try? await viewModel.markAllRead()
                }
            }
        } label: {
            Image(systemName: "bell.fill")
                .symbolRenderingMode(.hierarchical)
                .overlay(alignment: .topTrailing) {
                    if viewModel.unreadCount > 0 {
                        Text("\(min(viewModel.unreadCount, 99))")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundStyle(.white)
                            .padding(4)
                            .background(.red, in: Circle())
                            .offset(x: 8, y: -8)
                    }
                }
        }
        .task {
            viewModel.startListening()
        }
        .onDisappear {
            viewModel.stopListening()
        }
    }
}
```

### Environment-Based Session Injection

Inject the RPC client through SwiftUI's environment:

```swift
// Define environment key
struct RpcClientKey: EnvironmentKey {
    static let defaultValue: RpcClient? = nil
}

extension EnvironmentValues {
    var rpcClient: RpcClient? {
        get { self[RpcClientKey.self] }
        set { self[RpcClientKey.self] = newValue }
    }
}

// App setup
@main
struct MyApp: App {
    @State private var client: RpcClient?
    @State private var isConnecting = true
    @State private var connectionError: Error?

    var body: some Scene {
        WindowGroup {
            Group {
                if let client {
                    ContentView()
                        .environment(\.rpcClient, client)
                } else if let error = connectionError {
                    ConnectionErrorView(error: error) {
                        Task { await connect() }
                    }
                } else {
                    ProgressView("Connecting...")
                }
            }
            .task {
                await connect()
            }
        }
    }

    private func connect() async {
        isConnecting = true
        connectionError = nil

        do {
            let newClient = try RpcClient(url: "wss://api.example.com")
            try await newClient.connect()
            client = newClient
        } catch {
            connectionError = error
        }

        isConnecting = false
    }
}

// Usage in views
struct ProfileView: View {
    @Environment(\.rpcClient) private var client
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
            guard let client else { return }
            user = try? await client.api.users.current
        }
    }
}
```

### Custom Property Wrapper

Create a property wrapper for automatic data fetching:

```swift
@propertyWrapper
struct RpcFetch<T: Decodable & Sendable>: DynamicProperty {
    @State private var value: T?
    @State private var error: RpcError?
    @State private var isLoading = false

    let keyPath: KeyPath<RpcRef<Any>, RpcRef<T>>

    var wrappedValue: T? { value }

    var projectedValue: FetchState<T> {
        FetchState(value: value, error: error, isLoading: isLoading)
    }

    struct FetchState<T> {
        let value: T?
        let error: RpcError?
        let isLoading: Bool

        var hasError: Bool { error != nil }
    }
}
```

---

## Todo List Example

A complete SwiftUI todo app demonstrating RpcDo patterns:

### Models

```swift
struct Todo: Identifiable, Codable, Sendable {
    let id: String
    var title: String
    var completed: Bool
    var createdAt: Date
    var updatedAt: Date
}

struct TodoFilter: Sendable {
    enum Status: String, Sendable {
        case all
        case active
        case completed
    }

    var status: Status = .all
    var searchQuery: String = ""
}
```

### View Model

```swift
@Observable
final class TodoViewModel {
    private let client: RpcClient

    var todos: [Todo] = []
    var filter = TodoFilter()
    var isLoading = false
    var error: RpcError?

    var filteredTodos: [Todo] {
        todos.filter { todo in
            // Status filter
            switch filter.status {
            case .all: break
            case .active: guard !todo.completed else { return false }
            case .completed: guard todo.completed else { return false }
            }

            // Search filter
            if !filter.searchQuery.isEmpty {
                guard todo.title.localizedCaseInsensitiveContains(filter.searchQuery) else {
                    return false
                }
            }

            return true
        }
    }

    var activeCount: Int {
        todos.filter { !$0.completed }.count
    }

    var completedCount: Int {
        todos.filter { $0.completed }.count
    }

    init(client: RpcClient) {
        self.client = client
    }

    @MainActor
    func load() async {
        isLoading = true
        error = nil
        defer { isLoading = false }

        do {
            todos = try await client.api.todos.list()
        } catch let rpcError as RpcError {
            self.error = rpcError
        } catch {
            self.error = .invalidResponse(error.localizedDescription)
        }
    }

    @MainActor
    func create(title: String) async throws {
        let todo: Todo = try await client.api.todos.create(title: title)
        todos.insert(todo, at: 0)
    }

    @MainActor
    func toggle(_ todo: Todo) async throws {
        let updated: Todo = try await client.api.todos[todo.id].update(
            completed: !todo.completed
        )

        if let index = todos.firstIndex(where: { $0.id == todo.id }) {
            todos[index] = updated
        }
    }

    @MainActor
    func delete(_ todo: Todo) async throws {
        try await client.api.todos.delete(id: todo.id)
        todos.removeAll { $0.id == todo.id }
    }

    @MainActor
    func clearCompleted() async throws {
        let completedIds = todos.filter { $0.completed }.map { $0.id }
        try await client.api.todos.deleteMany(ids: completedIds)
        todos.removeAll { $0.completed }
    }

    @MainActor
    func updateTitle(_ todo: Todo, newTitle: String) async throws {
        let updated: Todo = try await client.api.todos[todo.id].update(
            title: newTitle
        )

        if let index = todos.firstIndex(where: { $0.id == todo.id }) {
            todos[index] = updated
        }
    }
}
```

### Main View

```swift
struct TodoListView: View {
    @State private var viewModel: TodoViewModel
    @State private var newTodoTitle = ""
    @State private var editingTodo: Todo?
    @FocusState private var isInputFocused: Bool

    init(client: RpcClient) {
        _viewModel = State(initialValue: TodoViewModel(client: client))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Input field
                HStack {
                    TextField("What needs to be done?", text: $newTodoTitle)
                        .textFieldStyle(.plain)
                        .submitLabel(.done)
                        .focused($isInputFocused)
                        .onSubmit(createTodo)

                    if !newTodoTitle.isEmpty {
                        Button("Add", action: createTodo)
                            .buttonStyle(.borderedProminent)
                    }
                }
                .padding()
                .background(.ultraThinMaterial)

                // Filter bar
                if !viewModel.todos.isEmpty {
                    filterBar
                }

                // Todo list
                List {
                    ForEach(viewModel.filteredTodos) { todo in
                        TodoRow(
                            todo: todo,
                            onToggle: { toggleTodo(todo) },
                            onEdit: { editingTodo = todo }
                        )
                    }
                    .onDelete(perform: deleteTodos)
                }
                .listStyle(.plain)
                .overlay {
                    if viewModel.isLoading {
                        ProgressView()
                    } else if viewModel.filteredTodos.isEmpty && !viewModel.todos.isEmpty {
                        ContentUnavailableView(
                            "No matches",
                            systemImage: "magnifyingglass",
                            description: Text("Try a different filter")
                        )
                    } else if viewModel.todos.isEmpty {
                        ContentUnavailableView(
                            "No todos",
                            systemImage: "checklist",
                            description: Text("Add a todo to get started")
                        )
                    }
                }

                // Footer
                if !viewModel.todos.isEmpty {
                    footer
                }
            }
            .navigationTitle("Todos")
            .searchable(text: $viewModel.filter.searchQuery)
            .task {
                await viewModel.load()
            }
            .refreshable {
                await viewModel.load()
            }
            .sheet(item: $editingTodo) { todo in
                EditTodoSheet(
                    todo: todo,
                    onSave: { newTitle in
                        Task {
                            try? await viewModel.updateTitle(todo, newTitle: newTitle)
                        }
                    }
                )
            }
        }
    }

    private var filterBar: some View {
        Picker("Filter", selection: $viewModel.filter.status) {
            Text("All").tag(TodoFilter.Status.all)
            Text("Active").tag(TodoFilter.Status.active)
            Text("Completed").tag(TodoFilter.Status.completed)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var footer: some View {
        HStack {
            Text("\(viewModel.activeCount) items left")
                .foregroundStyle(.secondary)

            Spacer()

            if viewModel.completedCount > 0 {
                Button("Clear Completed") {
                    Task {
                        try? await viewModel.clearCompleted()
                    }
                }
                .font(.caption)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    private func createTodo() {
        guard !newTodoTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }

        Task {
            try? await viewModel.create(title: newTodoTitle)
            newTodoTitle = ""
        }
    }

    private func toggleTodo(_ todo: Todo) {
        Task {
            try? await viewModel.toggle(todo)
        }
    }

    private func deleteTodos(at offsets: IndexSet) {
        Task {
            for index in offsets {
                let todo = viewModel.filteredTodos[index]
                try? await viewModel.delete(todo)
            }
        }
    }
}
```

### Todo Row

```swift
struct TodoRow: View {
    let todo: Todo
    let onToggle: () -> Void
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: todo.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(todo.completed ? .green : .secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(todo.title)
                    .strikethrough(todo.completed)
                    .foregroundStyle(todo.completed ? .secondary : .primary)

                Text(todo.createdAt, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Spacer()
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onEdit)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                // Delete handled by onDelete
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            Button(action: onToggle) {
                Label(
                    todo.completed ? "Uncomplete" : "Complete",
                    systemImage: todo.completed ? "arrow.uturn.backward" : "checkmark"
                )
            }
            .tint(todo.completed ? .orange : .green)
        }
    }
}
```

---

## Workflow Orchestration

### Sequential Operations

Chain dependent operations:

```swift
func onboardUser(email: String) async throws -> OnboardingResult {
    // Step 1: Create invitation
    let invitation: Invitation = try await client.api.invitations.create(
        email: email
    )

    // Step 2: Wait for user to accept (polling or webhook)
    let user: User = try await client.api.users.waitForRegistration(
        invitationCode: invitation.code,
        timeout: 3600
    )

    // Step 3: Set up default profile
    let profile: Profile = try await client.api.profiles.create(
        userId: user.id,
        defaults: .standard
    )

    // Step 4: Send welcome email
    try await client.api.emails.sendWelcome(userId: user.id)

    return OnboardingResult(user: user, profile: profile)
}
```

### Pipelined Operations

Combine into a single round-trip when the server supports it:

```swift
func onboardUserOptimized(email: String) async throws -> OnboardingResult {
    // Single pipeline - server chains all operations
    let result: OnboardingResult = try await client.api
        .invitations.create(email: email)
        .waitForAcceptance()
        .createDefaultProfile()
        .sendWelcomeEmail()
        .result

    return result
}
```

### Parallel Operations

Run independent operations concurrently:

```swift
func loadDashboard() async throws -> Dashboard {
    // All four requests execute in parallel
    async let user: User = client.api.users.current
    async let stats: DashboardStats = client.api.analytics.dashboard
    async let notifications: [Notification] = client.api.notifications.recent(limit: 5)
    async let todos: [Todo] = client.api.todos.list(filter: .active)

    return try await Dashboard(
        user: user,
        stats: stats,
        notifications: notifications,
        todos: todos
    )
}
```

### Task Groups for Dynamic Parallelism

When the number of parallel operations is dynamic:

```swift
func fetchAllUserProfiles(ids: [String]) async throws -> [String: Profile] {
    try await withThrowingTaskGroup(of: (String, Profile).self) { group in
        for id in ids {
            group.addTask {
                let profile: Profile = try await client.api.users[id].profile
                return (id, profile)
            }
        }

        var results: [String: Profile] = [:]
        for try await (id, profile) in group {
            results[id] = profile
        }
        return results
    }
}
```

### Batch Operations

Execute multiple operations as a single HTTP request:

```swift
// All operations in this closure execute as ONE HTTP POST
let results = try await RpcClient.batch(url: "https://api.example.com") { api in
    async let user: User = api.users.get(id: userId)
    async let posts: [Post] = api.posts.forUser(id: userId)
    async let following: [User] = api.social.following(userId: userId)

    return try await (user, posts, following)
}

let (user, posts, following) = results
```

---

## Platform Integration

### iOS App with Background Tasks

```swift
import SwiftUI
import BackgroundTasks
import RpcDo

@main
struct MyiOSApp: App {
    @State private var client: RpcClient?
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcClient, client)
                .task {
                    client = try? RpcClient(url: "wss://api.example.com")
                    try? await client?.connect()
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                    Task {
                        if client?.isConnected == false {
                            try? await client?.connect()
                        }
                    }
                }
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Register background tasks
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: "com.example.refresh",
            using: nil
        ) { task in
            self.handleRefresh(task: task as! BGAppRefreshTask)
        }
        return true
    }

    func handleRefresh(task: BGAppRefreshTask) {
        Task {
            let client = try? RpcClient(url: "wss://api.example.com")
            try? await client?.connect()

            // Perform background sync
            _ = try? await client?.api.sync.pull()

            await client?.disconnect()
            task.setTaskCompleted(success: true)
        }
    }
}
```

### macOS App with Menu Bar

```swift
import SwiftUI
import RpcDo

@main
struct MyMacApp: App {
    @State private var client: RpcClient?
    @State private var connectionStatus: ConnectionStatus = .disconnected

    enum ConnectionStatus {
        case disconnected
        case connecting
        case connected
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcClient, client)
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Reconnect") {
                    Task { await reconnect() }
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(connectionStatus == .connecting)

                Divider()

                Text("Status: \(statusText)")
            }
        }

        MenuBarExtra("API", systemImage: statusIcon) {
            Text("Status: \(statusText)")
            Divider()
            Button("Reconnect") {
                Task { await reconnect() }
            }
            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private var statusText: String {
        switch connectionStatus {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        }
    }

    private var statusIcon: String {
        switch connectionStatus {
        case .disconnected: return "network.slash"
        case .connecting: return "network"
        case .connected: return "network.badge.shield.half.filled"
        }
    }

    private func reconnect() async {
        connectionStatus = .connecting

        await client?.disconnect()
        client = nil

        do {
            let newClient = try RpcClient(url: "wss://api.example.com")
            try await newClient.connect()
            client = newClient
            connectionStatus = .connected
        } catch {
            connectionStatus = .disconnected
        }
    }
}
```

### watchOS App

```swift
import SwiftUI
import RpcDo

@main
struct MyWatchApp: App {
    @State private var client: RpcClient?

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcClient, client)
                .task {
                    // Use shorter timeout for watch
                    let config = RpcClientConfiguration(
                        url: URL(string: "wss://api.example.com")!,
                        timeout: 15.0,  // Shorter for watch
                        maxRetries: 2
                    )
                    client = RpcClient(configuration: config)
                    try? await client?.connect()
                }
        }
    }
}

struct ContentView: View {
    @Environment(\.rpcClient) private var client
    @State private var summary: DailySummary?

    var body: some View {
        ScrollView {
            if let summary {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(summary.completedTasks) tasks done")
                        .font(.headline)

                    Text("\(summary.pendingTasks) remaining")
                        .foregroundStyle(.secondary)

                    if let nextTask = summary.nextTask {
                        Divider()
                        Text("Next: \(nextTask.title)")
                            .font(.caption)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .task {
            summary = try? await client?.api.dashboard.dailySummary
        }
    }
}
```

### visionOS App

```swift
import SwiftUI
import RealityKit
import RpcDo

@main
struct MyVisionApp: App {
    @State private var client: RpcClient?

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.rpcClient, client)
        }

        ImmersiveSpace(id: "DataVisualization") {
            DataVisualizationView()
                .environment(\.rpcClient, client)
        }
    }
}

struct DataVisualizationView: View {
    @Environment(\.rpcClient) private var client
    @State private var dataPoints: [DataPoint] = []

    var body: some View {
        RealityView { content in
            // Create 3D visualization from RPC data
            for (index, point) in dataPoints.enumerated() {
                let sphere = MeshResource.generateSphere(radius: 0.1)
                let material = SimpleMaterial(
                    color: point.category.color,
                    isMetallic: false
                )

                let entity = ModelEntity(mesh: sphere, materials: [material])
                entity.position = SIMD3(
                    Float(point.x),
                    Float(point.y),
                    Float(point.z)
                )

                content.add(entity)
            }
        }
        .task {
            // Stream real-time data points
            guard let client else { return }

            do {
                let stream: AsyncThrowingStream<DataPoint, Error> =
                    try await client.api.analytics.streamDataPoints()

                for try await point in stream {
                    dataPoints.append(point)
                }
            } catch {
                // Handle error
            }
        }
    }
}
```

---

## Testing

### Unit Testing View Models

```swift
import XCTest
@testable import YourApp
import RpcDo

final class TodoViewModelTests: XCTestCase {
    var client: RpcClient!
    var viewModel: TodoViewModel!

    override func setUp() async throws {
        client = try RpcClient(url: "wss://test.example.com")
        viewModel = TodoViewModel(client: client)
    }

    func testLoadTodos() async throws {
        // Given a connected client
        try await client.connect()

        // When loading todos
        await viewModel.load()

        // Then todos should be populated
        XCTAssertFalse(viewModel.todos.isEmpty)
        XCTAssertNil(viewModel.error)
    }

    func testFilteredTodos() {
        // Given some todos
        viewModel.todos = [
            Todo(id: "1", title: "Active", completed: false, createdAt: .now, updatedAt: .now),
            Todo(id: "2", title: "Done", completed: true, createdAt: .now, updatedAt: .now)
        ]

        // When filtering by active
        viewModel.filter.status = .active

        // Then only active todos should show
        XCTAssertEqual(viewModel.filteredTodos.count, 1)
        XCTAssertEqual(viewModel.filteredTodos.first?.title, "Active")
    }
}
```

### Mocking RpcClient

Create a mock client for testing:

```swift
actor MockRpcClient {
    var responses: [String: Any] = [:]
    var callHistory: [(method: String, params: [RpcValue])] = []

    func setResponse<T>(for method: String, response: T) {
        responses[method] = response
    }

    func call(_ method: String, params: [RpcValue] = []) async throws -> RpcValue {
        callHistory.append((method, params))

        if let response = responses[method] {
            return RpcValue.from(response)
        }

        throw RpcError.notFound(method)
    }
}
```

### Integration Testing

```swift
final class RpcIntegrationTests: XCTestCase {
    var client: RpcClient!

    override func setUp() async throws {
        client = try RpcClient(url: "wss://staging-api.example.com")
        try await client.connect()
    }

    override func tearDown() async throws {
        await client.disconnect()
    }

    func testFullUserFlow() async throws {
        // Create user
        let user: User = try await client.api.users.create(
            name: "Test User",
            email: "test-\(UUID())@example.com"
        )
        XCTAssertFalse(user.id.isEmpty)

        // Update user
        let updated: User = try await client.api.users[user.id].update(
            name: "Updated Name"
        )
        XCTAssertEqual(updated.name, "Updated Name")

        // Delete user
        try await client.api.users.delete(id: user.id)

        // Verify deletion
        do {
            let _: User = try await client.api.users.get(id: user.id)
            XCTFail("Should have thrown notFound")
        } catch let error as RpcError {
            if case .notFound = error {
                // Expected
            } else {
                throw error
            }
        }
    }
}
```

---

## Type Reference

### RpcClient

```swift
public actor RpcClient {
    /// Client configuration
    public let configuration: RpcClientConfiguration

    /// Whether connected to server
    public private(set) var isConnected: Bool

    /// Create client with configuration
    public init(configuration: RpcClientConfiguration)

    /// Create client with URL string
    public init(url: String) throws

    /// Connect to server
    public func connect() async throws

    /// Disconnect from server
    public func disconnect() async

    /// Root API reference (nonisolated for convenience)
    public nonisolated var api: RpcRef<Any> { get }

    /// Call a method directly
    public func call(_ method: String, params: [RpcValue]) async throws -> RpcValue

    /// Execute with automatic connection management
    public static func withConnection<T>(
        to url: String,
        operation: (RpcClient) async throws -> T
    ) async throws -> T
}
```

### RpcClientConfiguration

```swift
public struct RpcClientConfiguration: Sendable {
    /// Server URL
    public let url: URL

    /// Request timeout (default: 30 seconds)
    public var timeout: TimeInterval

    /// Maximum retry attempts (default: 3)
    public var maxRetries: Int

    /// Base delay for exponential backoff (default: 0.1 seconds)
    public var retryBaseDelay: TimeInterval

    /// Maximum delay between retries (default: 10 seconds)
    public var maxRetryDelay: TimeInterval

    /// Custom headers for WebSocket upgrade
    public var headers: [String: String]

    public init(
        url: URL,
        timeout: TimeInterval = 30.0,
        maxRetries: Int = 3,
        retryBaseDelay: TimeInterval = 0.1,
        maxRetryDelay: TimeInterval = 10.0,
        headers: [String: String] = [:]
    )
}
```

### RpcRef

```swift
@dynamicMemberLookup
public struct RpcRef<T>: Sendable {
    /// Access property on remote object
    public subscript<U>(dynamicMember member: String) -> RpcRef<U> { get }

    /// Debug representation of expression path
    public var expressionString: String { get }

    /// Transform array elements server-side
    public func map<U>(
        _ transform: @escaping @Sendable (RpcRef<Any>) async throws -> U
    ) -> RpcRef<[U]>
}
```

### RpcValue

```swift
public enum RpcValue: Sendable, Equatable, Codable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([RpcValue])
    case object([String: RpcValue])

    /// Create from Any value
    public static func from(_ any: Any?) -> RpcValue

    /// Convert to native Swift type
    public var asAny: Any? { get }
}
```

### RpcError

```swift
public enum RpcError: Error, Sendable, Equatable {
    case remote(type: String, message: String)
    case connectionLost(String?)
    case timeout
    case cancelled
    case invalidResponse(String)
    case invalidArgument(String)
    case notFound(String)
    case notImplemented(String)
    case authenticationFailed(String)
    case rateLimitExceeded(retryAfter: TimeInterval?)
}
```

### RpcRequest / RpcResponse

```swift
public struct RpcRequest: Sendable, Codable {
    public let id: String
    public let method: String
    public let params: [RpcValue]

    public init(id: String = UUID().uuidString, method: String, params: [RpcValue] = [])
}

public struct RpcResponse: Sendable, Codable {
    public let id: String
    public let result: RpcValue?
    public let error: RpcResponseError?
}

public struct RpcResponseError: Sendable, Codable, Equatable {
    public let code: Int
    public let message: String
    public let data: RpcValue?
}
```

---

## Best Practices

### Connection Lifecycle

```swift
// DO: Use scoped connections
try await RpcClient.withConnection(to: url) { client in
    // Operations here
}

// DO: Check connection before operations
if await client.isConnected {
    let data = try await client.api.getData()
}

// DON'T: Forget to disconnect
let client = try RpcClient(url: "wss://api.example.com")
try await client.connect()
// ... operations ...
// Missing: await client.disconnect()
```

### Error Handling

```swift
// DO: Handle specific error types
do {
    let user = try await client.api.users.get(id: id)
} catch let error as RpcError {
    switch error {
    case .notFound:
        showUserNotFoundMessage()
    case .authenticationFailed:
        redirectToLogin()
    default:
        showGenericError(error)
    }
}

// DON'T: Ignore errors
let user = try? await client.api.users.get(id: id)
// User might be nil for many reasons!
```

### Pipeline Building

```swift
// DO: Build long pipelines for fewer round-trips
let data = try await client.api
    .authenticate(token)
    .user
    .profile
    .settings
    .preferences

// DON'T: Make separate calls for each step
let authed = try await client.api.authenticate(token)
let user = try await authed.user
let profile = try await user.profile
// 3 round-trips instead of 1!
```

### SwiftUI State Management

```swift
// DO: Use @Observable for view models
@Observable
final class MyViewModel {
    var data: [Item] = []
    var isLoading = false
}

// DO: Mark UI-updating methods with @MainActor
@MainActor
func load() async {
    isLoading = true
    defer { isLoading = false }
    // ...
}

// DON'T: Update UI from background thread
func load() async {
    isLoading = true  // May crash - not on main thread!
}
```

### Cancellation

```swift
// DO: Respect task cancellation
for try await item in stream {
    try Task.checkCancellation()
    process(item)
}

// DO: Cancel subscriptions on view disappear
.task {
    viewModel.startListening()
}
.onDisappear {
    viewModel.stopListening()
}
```

---

## Comparison with Other Libraries

| Feature | RpcDo | URLSession | Alamofire | gRPC-Swift |
|---------|-------|------------|-----------|------------|
| Pipelining | Automatic | N/A | N/A | Manual |
| Bidirectional | WebSocket | No | No | Streaming |
| Dynamic API | `@dynamicMemberLookup` | Manual | Manual | Generated |
| Error Types | Rich enums | NSError | AFError | GRPCStatus |
| Retry Logic | Built-in | Manual | Interceptors | Manual |
| SwiftUI | `@Observable` | Manual | Manual | Manual |
| Actor-based | Yes | No | No | Partial |

---

## Troubleshooting

### Connection Issues

**Problem**: `connectionLost` errors after connecting

**Solution**: Check that your server URL is correct and supports WebSocket:
```swift
// Use wss:// for secure connections
let client = try RpcClient(url: "wss://api.example.com")

// Not https:// - that's for HTTP, not WebSocket
```

**Problem**: Timeouts during long operations

**Solution**: Increase timeout in configuration:
```swift
let config = RpcClientConfiguration(
    url: apiURL,
    timeout: 120.0  // 2 minutes
)
```

### Pipeline Issues

**Problem**: Getting `RpcRef` instead of actual value

**Solution**: Don't forget to `await` the ref:
```swift
// Wrong - returns RpcRef<User>
let user = client.api.users.get(id: "123")

// Correct - returns User
let user: User = try await client.api.users.get(id: "123")
```

### SwiftUI Issues

**Problem**: UI not updating when data changes

**Solution**: Ensure view model is `@Observable` and updates happen on MainActor:
```swift
@Observable
final class ViewModel {
    @MainActor
    func update() async {
        // This will trigger SwiftUI updates
        self.data = try? await client.api.getData()
    }
}
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

---

## Resources

- [GitHub Repository](https://github.com/dot-do/rpc)
- [API Documentation](https://rpc.do/docs/swift)
- [Protocol Specification](https://rpc.do/protocol)
- [Examples Repository](https://github.com/dot-do/rpc-examples-swift)

---

*Built for Swift developers who believe remote calls should feel like local ones.*
