# CapnWeb Swift Client: Syntax Exploration

This document explores divergent syntax approaches for the Swift implementation of Cap'n Web, a bidirectional capability-based RPC protocol over JSON.

## Design Goals

1. **Swifty**: Feel native to Swift developers familiar with async/await, actors, and protocol-oriented design
2. **Type-Safe**: Leverage Swift's strong type system while supporting dynamic method dispatch
3. **Ergonomic Pipelining**: Make promise pipelining feel natural and invisible
4. **Error Handling**: Integrate cleanly with Swift's `throws` and structured concurrency

## Reference: How Other Swift Libraries Do It

### gRPC-Swift
```swift
// Generated client stub
let client = Greeter_GreeterAsyncClient(channel: channel)
let response = try await client.sayHello(.with { $0.name = "World" })
```

### Alamofire
```swift
let response = await AF.request("https://api.example.com/users")
    .serializingDecodable(User.self)
    .value
```

### URLSession
```swift
let (data, response) = try await URLSession.shared.data(from: url)
```

### SwiftNIO
```swift
let channel = try await ClientBootstrap(group: eventLoopGroup)
    .connect(host: "example.com", port: 443)
    .get()
```

---

## Approach 1: Dynamic Member Lookup with Chained Callables

This approach uses `@dynamicMemberLookup` and `@dynamicCallable` to create a fluid, JavaScript-like API where property access and method calls chain seamlessly.

### Philosophy
- Stubs are "magic proxies" - any property access returns another stub
- Method calls are just property access followed by invocation
- Pipelining is completely invisible - just chain naturally

### Connection/Session Creation

```swift
import CapnWeb

// WebSocket session (persistent connection)
let api = try await CapnWeb.connect("wss://api.example.com")

// HTTP batch session (single request)
let api = try await CapnWeb.batch("https://api.example.com") { api in
    // All calls in this closure are batched
    let user = api.users.get(123)
    let profile = api.profiles.get(user.id)
    return try await (user.resolve(), profile.resolve())
}

// With explicit type annotation for IDE support
let api: RpcStub<MyAPI> = try await CapnWeb.connect("wss://api.example.com")
```

### Making RPC Calls

```swift
@dynamicMemberLookup
@dynamicCallable
public struct RpcStub<T>: Sendable {
    // Property access returns another stub pointing to that property
    public subscript<U>(dynamicMember member: String) -> RpcStub<U> { ... }

    // Method invocation via @dynamicCallable
    public func dynamicallyCall<R>(withArguments args: [Any]) -> RpcPromise<R> { ... }
    public func dynamicallyCall<R>(withKeywordArguments args: KeyValuePairs<String, Any>) -> RpcPromise<R> { ... }
}

// Usage - completely dynamic
let greeting = try await api.greet("World")
let user = try await api.users.get(123)
let name = try await api.users.get(123).profile.name

// With type hints for better IDE experience
let user: User = try await api.users.get(123)
```

### Pipelining Syntax

```swift
// Pipelining is just chaining - no special syntax needed!
// Both calls sent in a single round-trip
let userName = try await api.authenticate(token).getUserName()

// Property access on unresolved promises
let profile = api.users.get(123)  // Not awaited - returns RpcPromise
let name = try await profile.name  // Pipelines through the promise

// Complex pipelining
let authedApi = api.authenticate(apiToken)  // Promise, not awaited
let userId = authedApi.getUserId()           // Pipelined call
let profile = api.getUserProfile(userId)     // Uses promise as parameter
let friends = authedApi.getFriendIds()       // Another pipelined call

// Only await what you need - system optimizes wire protocol
let (profileResult, friendsResult) = try await (profile.resolve(), friends.resolve())
```

### Error Handling

```swift
// Standard Swift throws
do {
    let result = try await api.riskyOperation()
} catch let error as RpcError {
    switch error {
    case .connectionLost(let reason):
        print("Connection lost: \(reason)")
    case .remoteError(let type, let message):
        print("Server error: \(type) - \(message)")
    case .timeout:
        print("Request timed out")
    }
}

// Broken stub monitoring (callback-based)
api.onBroken { error in
    print("API connection broken: \(error)")
}
```

### Exposing Local Objects as RPC Targets

```swift
// Protocol-based targets
protocol UserService: RpcTarget {
    func getUser(id: Int) async throws -> User
    func updateUser(_ user: User) async throws
}

class UserServiceImpl: UserService {
    func getUser(id: Int) async throws -> User {
        return try await database.fetchUser(id: id)
    }

    func updateUser(_ user: User) async throws {
        try await database.save(user)
    }
}

// Expose to remote callers
let session = try await CapnWeb.connect(
    "wss://api.example.com",
    exposing: UserServiceImpl()
)
```

### Full Example

```swift
import CapnWeb

// Type definitions (optional, for IDE support)
protocol PublicApi {
    func authenticate(apiToken: String) -> AuthedApi
    func getUserProfile(userId: any RpcPromise<Int>) -> UserProfile
}

protocol AuthedApi {
    func getUserId() -> Int
    func getFriendIds() -> [Int]
}

// Client code
let api: RpcStub<PublicApi> = try await CapnWeb.connect("wss://api.example.com")

// Everything pipelines automatically
let authedApi = api.authenticate(myToken)
let userId = authedApi.getUserId()
let profile = api.getUserProfile(userId)

// Await only the final result - one round trip!
let result: UserProfile = try await profile.resolve()
print("Hello, \(result.name)!")
```

### Pros
- Extremely fluid and JavaScript-like
- Pipelining is completely invisible
- Minimal ceremony

### Cons
- Limited compile-time type checking without explicit annotations
- `@dynamicCallable` syntax can be awkward for keyword arguments
- Less discoverable API (IDE can't autocomplete dynamic members)

---

## Approach 2: Protocol-Oriented with KeyPath-Based Pipelining

This approach emphasizes Swift's protocol-oriented design with compile-time type safety. Pipelining uses KeyPaths for a more "Swifty" feel.

### Philosophy
- Strong typing via protocols and generics
- KeyPaths provide type-safe property access for pipelining
- Explicit but ergonomic async/await integration

### Connection/Session Creation

```swift
import CapnWeb

// Actor-based session management for thread safety
public actor RpcSession<API: RpcProtocol> {
    public init(url: URL, transport: RpcTransport = .webSocket) async throws

    public var api: API.Stub { get }
}

// Usage
let session = try await RpcSession<MyAPI>(url: URL(string: "wss://api.example.com")!)
let api = session.api

// Builder pattern for complex configuration
let session = try await RpcSession<MyAPI>
    .connect(to: "wss://api.example.com")
    .withTimeout(.seconds(30))
    .withRetryPolicy(.exponentialBackoff(maxAttempts: 3))
    .build()
```

### Protocol-Based Stubs

```swift
// Define your API as a protocol
@RpcProtocol
protocol UserAPI {
    func getUser(id: Int) async throws -> User
    func createUser(name: String, email: String) async throws -> User
    func deleteUser(id: Int) async throws
}

// The macro generates a conforming Stub type:
// UserAPI.Stub - a struct that forwards calls via RPC
```

### Making RPC Calls

```swift
// Generated stub provides full type safety
let user = try await api.getUser(id: 123)
let newUser = try await api.createUser(name: "Alice", email: "alice@example.com")

// Stubs are Sendable for use across actors
Task {
    let user = try await api.getUser(id: 456)
}
```

### Pipelining with KeyPaths

```swift
// RpcPromise supports KeyPath subscripting
public struct RpcPromise<T>: Sendable {
    public subscript<V>(keyPath: KeyPath<T, V>) -> RpcPromise<V> { ... }

    public func call<R>(_ method: (T) -> (Args) -> R, with args: Args) -> RpcPromise<R> { ... }
}

// Usage with KeyPaths
let userPromise = api.getUser(id: 123)  // Returns RpcPromise<User>
let namePromise = userPromise[\.profile.name]  // KeyPath access
let name = try await namePromise.resolve()

// Fluent pipelining with method chaining
let result = try await api
    .authenticate(token: myToken)
    .then { $0.getUser(id: 123) }
    .then { $0.profile }
    [\.displayName]
    .resolve()
```

### Pipeline Builder

```swift
// Result builder for complex pipelines
@resultBuilder
struct PipelineBuilder<Root> {
    static func buildBlock<T>(_ promise: RpcPromise<T>) -> RpcPromise<T> { promise }
    // ... additional builder methods
}

// Usage
let result = try await Pipeline(from: api) {
    $0.authenticate(token)
    $0.getCurrentUser()
    $0.profile
    $0.friends
}.resolve()
```

### Error Handling

```swift
// Typed errors with RpcResult
public enum RpcResult<Success, Failure: Error> {
    case success(Success)
    case failure(Failure)
}

// Or use standard throws with typed catches
do {
    let user = try await api.getUser(id: 123)
} catch is RpcConnectionError {
    // Handle connection issues
} catch let error as RpcRemoteError {
    // Handle server-side errors
    print("Remote error: \(error.type) - \(error.message)")
}

// Check if promise will fail before resolving
let promise = api.getUser(id: 123)
if await promise.isBroken {
    print("Promise already failed")
}
```

### Exposing Local Objects as RPC Targets

```swift
// Actor-based targets for thread safety
@RpcTarget
actor DocumentService {
    private var documents: [UUID: Document] = [:]

    func getDocument(id: UUID) -> Document? {
        documents[id]
    }

    func saveDocument(_ doc: Document) {
        documents[doc.id] = doc
    }
}

// Class-based targets with @RpcTarget macro
@RpcTarget
class NotificationHandler {
    @RpcMethod
    func onNotification(_ notification: Notification) {
        print("Received: \(notification)")
    }

    // Private methods are not exposed
    private func internalHelper() { }
}

// Register as callback
let handler = NotificationHandler()
try await api.subscribe(handler: RpcStub(wrapping: handler))
```

### Full Example

```swift
import CapnWeb

@RpcProtocol
protocol PublicAPI {
    func authenticate(token: String) async throws -> AuthedAPI.Stub
    func getUserProfile(userId: RpcPromise<Int>) async throws -> UserProfile
}

@RpcProtocol
protocol AuthedAPI {
    func getUserId() async throws -> Int
    func getFriends() async throws -> [UserProfile]
}

// Client
let session = try await RpcSession<PublicAPI>(url: apiURL)

// Pipeline with KeyPaths
let authed = session.api.authenticate(token: myToken)
let profile = try await session.api
    .getUserProfile(userId: authed[\.getUserId()])  // Promise as parameter
    .resolve()

// Or with explicit pipeline
let friends = try await authed
    .call(\.getFriends)
    .resolve()
```

### Pros
- Full compile-time type safety
- Excellent IDE support (autocomplete, refactoring)
- KeyPaths feel very Swift-native
- Actor-based targets provide thread safety

### Cons
- Requires code generation (macros) for protocols
- KeyPath syntax can be verbose for deep access
- Less flexible for truly dynamic APIs

---

## Approach 3: Actor-Centric with Async Sequences

This approach treats the RPC session as an actor and uses Swift's async sequences for streaming and event handling. Emphasizes structured concurrency.

### Philosophy
- The session is an actor - all operations are automatically thread-safe
- Promises are AsyncSequence-compatible for streaming scenarios
- Embraces structured concurrency with TaskGroups

### Connection/Session Creation

```swift
import CapnWeb

// The session IS an actor
public actor RpcClient {
    public init(connecting url: URL) async throws

    public var root: RpcHandle { get }

    public func close() async
}

// Usage with structured concurrency
try await withRpcClient(url: apiURL) { client in
    let result = try await client.root.greet("World")
    print(result)
}  // Connection automatically closed

// Or manual lifecycle
let client = try await RpcClient(connecting: apiURL)
defer { Task { await client.close() } }
```

### RpcHandle: A Reference Type for Stubs

```swift
// RpcHandle is a reference to a remote object
public final class RpcHandle: @unchecked Sendable {
    // Dynamic member access
    public subscript(dynamicMember name: String) -> RpcHandle { ... }

    // Invoke as function
    public func callAsFunction(_ args: Any...) async throws -> RpcHandle { ... }

    // Resolve to a specific type
    public func `as`<T: Decodable>(_ type: T.Type) async throws -> T { ... }

    // For pipelining without resolution
    public func piped() -> RpcHandle { ... }
}

// Usage
let greeting: String = try await client.root.greet("World").as(String.self)
let user: User = try await client.root.users.get(123).as(User.self)
```

### Making RPC Calls

```swift
// Call and resolve in one step
let result: User = try await client.root.users.get(123).as(User.self)

// Or with type inference
let result = try await client.root.users.get(123).as(User.self)

// Void methods
try await client.root.notifications.send("Hello")

// Using callAsFunction for method-like syntax
let handle = client.root.users
let user = try await handle.get(123).as(User.self)
```

### Pipelining with RpcHandle

```swift
// Handles can be chained without resolution
let authedHandle = client.root.authenticate(token).piped()
let userIdHandle = authedHandle.getUserId().piped()
let profileHandle = client.root.getUserProfile(userIdHandle).piped()

// Resolve only what you need
let profile: UserProfile = try await profileHandle.as(UserProfile.self)

// Or use a pipeline operator
infix operator ~>: AdditionPrecedence

let profile = try await client.root
    ~> \.authenticate(token)
    ~> \.getUserId()
    ~> { client.root.getUserProfile($0) }
    .as(UserProfile.self)
```

### Async Sequences for Streaming

```swift
// Map operations return AsyncSequence
let friendIds = client.root.user.getFriendIds()  // Returns RpcHandle

// Iterate with for-await
for try await friend in friendIds.map({ client.root.getUser($0) }).stream() {
    print(friend.name)
}

// Or collect all at once
let allFriends = try await friendIds
    .map { client.root.getUser($0) }
    .collect()
    .as([User].self)
```

### Error Handling

```swift
// Actor method throws
actor RpcClient {
    public func call(_ handle: RpcHandle) async throws -> RpcHandle
}

// Errors are typed
public enum RpcError: Error, Sendable {
    case connectionFailed(underlying: Error)
    case remoteException(type: String, message: String, stack: String?)
    case timeout
    case cancelled
    case invalidResponse
}

// Pattern matching on errors
do {
    let result = try await client.root.riskyCall().as(Result.self)
} catch RpcError.remoteException(let type, let message, _) {
    print("Server said: \(type) - \(message)")
} catch RpcError.timeout {
    print("Request timed out")
}
```

### Exposing Local Objects as RPC Targets

```swift
// Actors are natural targets
public protocol RpcExposable: Actor {
    func handleCall(method: String, args: [Any]) async throws -> Any
}

// Macro generates the dispatch logic
@RpcExposable
actor ChatRoom {
    private var messages: [Message] = []
    private var listeners: [RpcHandle] = []

    func sendMessage(_ text: String, from user: String) async {
        let message = Message(text: text, from: user)
        messages.append(message)

        // Notify all listeners (they're RPC stubs to remote callbacks)
        for listener in listeners {
            try? await listener.onMessage(message)
        }
    }

    func subscribe(listener: RpcHandle) {
        listeners.append(listener)
    }
}

// Expose in session
let client = try await RpcClient(
    connecting: apiURL,
    exposing: ["chatRoom": ChatRoom()]
)
```

### Structured Concurrency Integration

```swift
// Use TaskGroups for parallel resolution
try await withThrowingTaskGroup(of: User.self) { group in
    let friendIds = try await client.root.user.getFriendIds().as([Int].self)

    for id in friendIds {
        group.addTask {
            try await client.root.getUser(id).as(User.self)
        }
    }

    for try await friend in group {
        print("Friend: \(friend.name)")
    }
}

// Cancellation is respected
let task = Task {
    try await client.root.longRunningOperation().as(Result.self)
}

// Later...
task.cancel()  // Attempts to cancel the RPC
```

### Full Example

```swift
import CapnWeb

try await withRpcClient(url: URL(string: "wss://api.example.com")!) { client in
    // Authenticate and pipeline
    let authed = client.root.authenticate(token: myToken).piped()

    // Get user profile in one round-trip
    let profile = try await client.root
        .getUserProfile(authed.getUserId().piped())
        .as(UserProfile.self)

    print("Hello, \(profile.name)!")

    // Stream friend profiles
    for try await friend in authed.getFriends().stream().map({
        client.root.getUser($0.id)
    }) {
        let friendProfile = try await friend.as(UserProfile.self)
        print("  Friend: \(friendProfile.name)")
    }
}
```

### Pros
- Perfect integration with structured concurrency
- Thread safety guaranteed by actors
- AsyncSequence integration for streaming
- Clean cancellation semantics

### Cons
- RpcHandle is less type-safe without explicit `.as()` calls
- More verbose for simple cases
- Actor isolation can make some patterns awkward

---

## Approach 4: Property Wrapper-Based with Declarative API

This approach uses property wrappers to create a declarative, SwiftUI-inspired API where remote resources are accessed like local properties.

### Philosophy
- Remote resources feel like local @State/@Binding in SwiftUI
- Property wrappers handle caching, invalidation, and refresh
- Combine/AsyncStream integration for reactive updates

### Connection/Session Creation

```swift
import CapnWeb

// Environment-based configuration (SwiftUI-style)
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .rpcSession(url: "wss://api.example.com")
    }
}

// Or programmatic
let config = RpcConfiguration(
    url: URL(string: "wss://api.example.com")!,
    transport: .webSocket,
    reconnectPolicy: .exponentialBackoff
)

let environment = RpcEnvironment(configuration: config)
```

### Property Wrappers for Remote Data

```swift
// @Remote property wrapper for fetching data
@propertyWrapper
public struct Remote<Value: Decodable>: DynamicProperty {
    public var wrappedValue: Value? { get }
    public var projectedValue: RemoteState<Value> { get }

    public init(_ path: RpcPath)
}

// Usage in a View
struct UserProfileView: View {
    let userId: Int

    @Remote(\.users[userId].profile)
    var profile: UserProfile?

    var body: some View {
        if let profile = profile {
            Text("Hello, \(profile.name)!")
        } else if $profile.isLoading {
            ProgressView()
        } else if let error = $profile.error {
            Text("Error: \(error.localizedDescription)")
        }
    }
}
```

### Making RPC Calls

```swift
// @RpcAction for mutations
@propertyWrapper
public struct RpcAction<Input, Output> {
    public func callAsFunction(_ input: Input) async throws -> Output
}

struct CreateUserView: View {
    @State private var name = ""
    @State private var email = ""

    @RpcAction(\.users.create)
    var createUser: (CreateUserInput) async throws -> User

    var body: some View {
        Form {
            TextField("Name", text: $name)
            TextField("Email", text: $email)

            Button("Create") {
                Task {
                    let user = try await createUser(
                        CreateUserInput(name: name, email: email)
                    )
                    print("Created user: \(user.id)")
                }
            }
        }
    }
}
```

### Pipelining with Path Expressions

```swift
// RpcPath uses KeyPath-like syntax
public struct RpcPath {
    // Subscript for indexed access
    public subscript(index: Int) -> RpcPath { ... }
    public subscript(key: String) -> RpcPath { ... }

    // Method calls
    public func call(_ name: String, _ args: Any...) -> RpcPath { ... }
}

// Usage
let path: RpcPath = \.users.get(123).profile.name

// Paths can be composed
let basePath: RpcPath = \.api.v2
let userPath = basePath.users.get(userId)

// Pipeline execution
@Remote(\.auth.authenticate(token).then(\.user.profile))
var profile: UserProfile?
```

### Reactive Updates with Combine/AsyncStream

```swift
// RemoteState provides reactive access
public struct RemoteState<Value> {
    public var value: Value? { get }
    public var isLoading: Bool { get }
    public var error: Error? { get }

    // Refresh the value
    public func refresh() async throws

    // Subscribe to changes
    public var updates: AsyncStream<Value> { get }

    // Combine publisher
    public var publisher: AnyPublisher<Value?, Never> { get }
}

// Usage
struct LiveDataView: View {
    @Remote(\.metrics.current)
    var metrics: Metrics?

    var body: some View {
        Text("Current: \(metrics?.value ?? 0)")
            .task {
                // Auto-refresh every 5 seconds
                for await _ in Timer.publish(every: 5, on: .main, in: .common).values {
                    try? await $metrics.refresh()
                }
            }
    }
}
```

### Error Handling

```swift
// Errors are captured in the state
struct SafeView: View {
    @Remote(\.data.important)
    var data: ImportantData?

    var body: some View {
        Group {
            if let data = data {
                DataView(data: data)
            } else if let error = $data.error {
                ErrorView(error: error)
                    .onTapGesture {
                        Task { try? await $data.refresh() }
                    }
            } else {
                LoadingView()
            }
        }
    }
}

// Or explicit try/catch for actions
@RpcAction(\.dangerous.operation)
var riskyAction: (Input) async throws -> Output

Button("Do It") {
    Task {
        do {
            let result = try await riskyAction(input)
        } catch let error as RpcError {
            showAlert(error.localizedDescription)
        }
    }
}
```

### Exposing Local Objects as RPC Targets

```swift
// @RpcHandler for incoming calls
@propertyWrapper
public struct RpcHandler<Input, Output> {
    public var wrappedValue: (Input) async throws -> Output { get set }
}

// Usage
class CallbackHandler: ObservableObject {
    @RpcHandler(\.notifications.onReceive)
    var onNotification: (Notification) async throws -> Void = { notification in
        print("Received: \(notification)")
    }

    @RpcHandler(\.sync.requestData)
    var onDataRequest: (DataRequest) async throws -> Data = { request in
        return try await fetchLocalData(for: request)
    }
}

// Register with environment
RpcEnvironment.current.register(handler: CallbackHandler())
```

### Full Example

```swift
import CapnWeb
import SwiftUI

// API path definitions (optional, for type safety)
extension RpcPath {
    static var auth: AuthPath { .init() }
    static var users: UsersPath { .init() }
}

struct AuthPath {
    func authenticate(_ token: String) -> AuthenticatedPath { ... }
}

struct AuthenticatedPath {
    var user: UserPath { ... }
}

// View using remote data
struct DashboardView: View {
    @Environment(\.rpcSession) var session

    @Remote(\.auth.authenticate(savedToken).user.profile)
    var profile: UserProfile?

    @Remote(\.auth.authenticate(savedToken).user.notifications)
    var notifications: [Notification]?

    @RpcAction(\.auth.authenticate(savedToken).user.markRead)
    var markAsRead: (NotificationID) async throws -> Void

    var body: some View {
        NavigationView {
            List {
                if let profile = profile {
                    Section("Profile") {
                        Text(profile.name)
                        Text(profile.email)
                    }
                }

                Section("Notifications") {
                    ForEach(notifications ?? []) { notification in
                        NotificationRow(notification: notification)
                            .swipeActions {
                                Button("Read") {
                                    Task {
                                        try await markAsRead(notification.id)
                                        try await $notifications.refresh()
                                    }
                                }
                            }
                    }
                }
            }
            .refreshable {
                try? await $profile.refresh()
                try? await $notifications.refresh()
            }
        }
    }
}
```

### Pros
- Extremely SwiftUI-friendly
- Declarative, reactive programming model
- Automatic loading/error states
- Great for data-driven UIs

### Cons
- Tightly coupled to SwiftUI/Combine
- Less suitable for non-UI code (CLI tools, servers)
- Property wrappers add complexity
- Pipelining is less explicit

---

## Comparison Matrix

| Feature | Approach 1: Dynamic | Approach 2: Protocol | Approach 3: Actor | Approach 4: Property Wrapper |
|---------|---------------------|----------------------|-------------------|------------------------------|
| Type Safety | Low (runtime) | High (compile-time) | Medium | Medium |
| IDE Support | Poor | Excellent | Good | Good |
| Pipelining | Invisible | KeyPath-based | Explicit handles | Path expressions |
| SwiftUI Integration | Manual | Manual | Good | Excellent |
| Learning Curve | Low | Medium | Medium | High |
| Flexibility | Very High | Medium | High | Low |
| Code Generation | None | Required (macros) | Optional | Optional |
| Thread Safety | Manual | Protocol-based | Actor-enforced | Framework-managed |

---

## Recommendation

For a general-purpose Swift package, I recommend **Approach 2 (Protocol-Oriented)** as the primary API with elements from **Approach 3 (Actor-Centric)** for session management.

### Rationale:
1. **Type Safety**: Swift developers expect and value compile-time type checking
2. **IDE Experience**: Autocomplete and refactoring are essential for adoption
3. **Actors for Sessions**: Provides thread safety without user effort
4. **KeyPaths for Pipelining**: Familiar to Swift developers from SwiftUI/Combine
5. **Macros for Ergonomics**: Swift 5.9+ macros can reduce boilerplate

### Suggested Hybrid API

```swift
import CapnWeb

// Define API protocol (macro generates stub)
@RpcProtocol
protocol MyAPI {
    func authenticate(token: String) async throws -> AuthedAPI.Stub
    func getPublicProfile(userId: Int) async throws -> UserProfile
}

@RpcProtocol
protocol AuthedAPI {
    var currentUser: User { get async throws }
    func getFriends() async throws -> [User]
}

// Actor-based session
let session = try await RpcSession<MyAPI>.connect(to: "wss://api.example.com")

// Type-safe calls with pipelining via KeyPaths
let authedApi = session.api.authenticate(token: myToken)  // Returns RpcPromise<AuthedAPI.Stub>
let profile = try await session.api
    .getPublicProfile(userId: authedApi[\.currentUser.id])  // Pipeline!
    .resolve()

// Expose local targets
@RpcTarget
actor MyCallbackHandler {
    func onEvent(_ event: Event) {
        print("Received event: \(event)")
    }
}

let handler = MyCallbackHandler()
try await session.api.subscribe(callback: RpcStub(wrapping: handler))

// Clean disposal
await session.close()
```

This hybrid approach provides:
- Full type safety via `@RpcProtocol` macro
- Actor-based session management for thread safety
- KeyPath subscripts on `RpcPromise` for type-safe pipelining
- `@RpcTarget` macro for exposing local actors/classes
- Standard `async throws` error handling

---

## Implementation Notes

### Swift 5.9+ Macros Required

The recommended approach relies heavily on Swift macros:
- `@RpcProtocol` - generates `.Stub` type with RPC forwarding
- `@RpcTarget` - generates method dispatch for incoming calls

### Key Types

```swift
// Core types
public actor RpcSession<API: RpcProtocol>
public struct RpcStub<T>: Sendable
public struct RpcPromise<T>: Sendable

// Error types
public enum RpcError: Error, Sendable

// Transport abstraction
public protocol RpcTransport: Sendable

// Target protocol
public protocol RpcTarget: AnyObject
```

### Package Structure

```
CapnWeb/
  Sources/
    CapnWeb/
      Session/
        RpcSession.swift
        RpcTransport.swift
        WebSocketTransport.swift
        HttpBatchTransport.swift
      Stub/
        RpcStub.swift
        RpcPromise.swift
      Target/
        RpcTarget.swift
      Protocol/
        RpcProtocol.swift
      Error/
        RpcError.swift
      Serialization/
        ExpressionEncoder.swift
        ExpressionDecoder.swift
    CapnWebMacros/
      RpcProtocolMacro.swift
      RpcTargetMacro.swift
  Tests/
    CapnWebTests/
```
