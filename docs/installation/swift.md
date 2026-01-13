# Swift Installation

The Swift SDK provides async/await-based access to Cap'n Web RPC for iOS, macOS, and server-side Swift.

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/dot-do/capnweb-swift", from: "0.1.0")
]
```

Or in Xcode: File > Add Packages > Enter the URL.

## Requirements

- Swift 5.9 or later
- iOS 15+ / macOS 12+ / watchOS 8+ / tvOS 15+
- Linux with Swift 5.9+

## Basic Usage

### Client

```swift
import CapnWeb

@main
struct Example {
    static func main() async throws {
        // Connect to server
        let api = try await CapnWeb.connect("wss://api.example.com")
        defer { api.close() }

        // Make RPC calls
        let greeting: String = try await api.call("greet", "World")
        print(greeting)  // "Hello, World!"
    }
}
```

### Typed Stubs

```swift
import CapnWeb

// Define your API
protocol MyApi: RpcTarget {
    func greet(_ name: String) async throws -> String
    func getUser(_ id: Int) async throws -> User
}

struct User: Codable {
    let id: Int
    let name: String
    let email: String
}

@main
struct Example {
    static func main() async throws {
        let session = try await CapnWeb.connect("wss://api.example.com")
        defer { session.close() }

        let api: MyApi = session.stub()

        let greeting = try await api.greet("World")
        print(greeting)

        let user = try await api.getUser(123)
        print("User: \(user.name)")
    }
}
```

### Promise Pipelining

```swift
import CapnWeb

@main
struct Example {
    static func main() async throws {
        let session = try await CapnWeb.connect("wss://api.example.com")
        defer { session.close() }

        // Start call without awaiting
        let userPromise = session.callAsync("getUser", 123)

        // Pipeline another call
        let profile: Profile = try await session.call("getProfile", userPromise.field("id"))

        print("Profile: \(profile.name)")
    }
}
```

## Server Implementation

```swift
import CapnWeb
import Vapor

class MyApiImpl: RpcTarget {
    func greet(_ name: String) -> String {
        return "Hello, \(name)!"
    }

    func getUser(_ id: Int) -> User {
        return User(id: id, name: "Alice", email: "alice@example.com")
    }
}

func routes(_ app: Application) throws {
    app.webSocket("api") { req, ws in
        let api = MyApiImpl()
        await CapnWeb.serve(ws, api)
    }
}
```

## Error Handling

```swift
import CapnWeb

@main
struct Example {
    static func main() async {
        do {
            let api = try await CapnWeb.connect("wss://api.example.com")
            defer { api.close() }

            let result: String = try await api.call("riskyOperation")
        } catch let error as RpcError {
            print("RPC failed: \(error.message)")
        } catch let error as ConnectionError {
            print("Connection lost: \(error)")
        } catch {
            print("Other error: \(error)")
        }
    }
}
```

## Configuration Options

```swift
let session = try await CapnWeb.connect(
    "wss://api.example.com",
    timeout: .seconds(30),
    headers: ["Authorization": "Bearer \(token)"],
    reconnect: true
)
```

## HTTP Batch Mode

```swift
import CapnWeb

@main
struct Example {
    static func main() async throws {
        let batch = CapnWeb.httpBatch("https://api.example.com")

        let greeting1 = batch.callAsync("greet", "Alice")
        let greeting2 = batch.callAsync("greet", "Bob")

        try await batch.execute()

        print(try await greeting1.get())
        print(try await greeting2.get())
    }
}
```

## iOS/macOS Integration

### SwiftUI

```swift
import SwiftUI
import CapnWeb

@MainActor
class ApiViewModel: ObservableObject {
    @Published var greeting: String = ""
    private var session: RpcSession?

    func connect() async {
        do {
            session = try await CapnWeb.connect("wss://api.example.com")
            greeting = try await session?.call("greet", "World") ?? ""
        } catch {
            greeting = "Error: \(error)"
        }
    }
}

struct ContentView: View {
    @StateObject private var viewModel = ApiViewModel()

    var body: some View {
        Text(viewModel.greeting)
            .task {
                await viewModel.connect()
            }
    }
}
```

### Combine Integration

```swift
import Combine
import CapnWeb

class ApiService {
    private var session: RpcSession?

    func greet(_ name: String) -> AnyPublisher<String, Error> {
        Future { promise in
            Task {
                do {
                    let result: String = try await self.session?.call("greet", name) ?? ""
                    promise(.success(result))
                } catch {
                    promise(.failure(error))
                }
            }
        }
        .eraseToAnyPublisher()
    }
}
```

## Server-Side Swift (Vapor)

```swift
import Vapor
import CapnWeb

func configure(_ app: Application) throws {
    app.webSocket("api") { req, ws in
        let api = MyApiImpl()
        await CapnWeb.serve(ws, api)
    }
}

class MyApiImpl: RpcTarget {
    func greet(_ name: String) -> String {
        return "Hello, \(name)!"
    }
}
```

## Troubleshooting

### Actor Isolation

Use `@MainActor` for UI-related code:

```swift
// WRONG - may crash on background thread
class ViewModel {
    @Published var data: String = ""
}

// CORRECT - main actor isolation
@MainActor
class ViewModel: ObservableObject {
    @Published var data: String = ""
}
```

### Codable Errors

Ensure types conform to Codable:

```swift
// WRONG - missing Codable
struct User {
    let name: String
}

// CORRECT - with Codable
struct User: Codable {
    let name: String
}
```

### Concurrency

Use structured concurrency with Task:

```swift
// In SwiftUI
.task {
    await viewModel.loadData()
}

// Or with Task
Task {
    try await api.call("method")
}
```
