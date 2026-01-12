# PlatformDo

The official Swift SDK for the DotDo platform. This package provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`PlatformDo` is the highest-level SDK in the DotDo stack, built on top of:

- **RpcDo** - Type-safe RPC client
- **CapnwebDo** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Swift API using async/await.

```
+------------------+
|   PlatformDo     |  <-- You are here (auth, pooling, retries)
+------------------+
|     RpcDo        |  <-- RPC client layer
+------------------+
|   CapnwebDo      |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and client credentials
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with jitter
- **Native Async/Await**: Built for modern Swift concurrency
- **Actor-Based Safety**: Thread-safe by design using Swift actors
- **Cross-Platform**: Works on macOS, iOS, tvOS, and watchOS

## Requirements

- macOS 13.0+ / iOS 16.0+ / tvOS 16.0+ / watchOS 9.0+
- Swift 5.9+
- Xcode 15.0+

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/dotdo-dev/platform-do-swift.git", from: "0.1.0")
]
```

Then add to your target:

```swift
.target(
    name: "YourApp",
    dependencies: ["PlatformDo"]
)
```

### Xcode

1. File > Add Package Dependencies
2. Enter: `https://github.com/dotdo-dev/platform-do-swift.git`
3. Select version: `0.1.0`

## Quick Start

### Basic Usage

```swift
import PlatformDo

// Create a client with API key
let client = DotDoClient.withApiKey(
    "your-api-key",
    baseURL: URL(string: "wss://api.dotdo.dev")!
)

// Start the client
try await client.start()

// Make requests (example)
let result = try await client.execute {
    // Your operation here
    return "result"
}

// Stop when done
await client.stop()
```

### Using Configuration

```swift
import PlatformDo

let config = DotDoConfiguration(
    baseURL: URL(string: "wss://api.dotdo.dev")!,
    credentials: .apiKey("your-api-key"),
    retry: RetryConfiguration(maxAttempts: 5),
    connectionPool: ConnectionPoolConfiguration(maxConnections: 10),
    timeout: 30.0
)

let client = DotDoClient(configuration: config)
try await client.start()

defer {
    Task { await client.stop() }
}

// Use client...
```

### Scoped Client

```swift
import PlatformDo

let config = DotDoConfiguration(
    baseURL: URL(string: "wss://api.dotdo.dev")!,
    credentials: .apiKey("your-api-key")
)

try await withDotDoClient(configuration: config) { client in
    // Client is started and will be stopped automatically
    let result = try await client.execute {
        // Your operation
        return "result"
    }
    print(result)
}
```

## Configuration

### DotDoConfiguration

```swift
public struct DotDoConfiguration: Sendable {
    /// The base URL for the DotDo service
    public let baseURL: URL
    /// Authentication credentials
    public let credentials: AuthCredentials
    /// Retry configuration
    public var retry: RetryConfiguration
    /// Connection pool configuration
    public var connectionPool: ConnectionPoolConfiguration
    /// Request timeout
    public var timeout: TimeInterval
    /// Custom headers
    public var headers: [String: String]
}
```

### Default Configuration

```swift
let config = DotDoConfiguration(
    baseURL: URL(string: "wss://api.dotdo.dev")!,
    credentials: .apiKey("key")
    // retry: defaults to 3 attempts
    // connectionPool: defaults to 10 max connections
    // timeout: defaults to 30 seconds
)
```

### Full Configuration

```swift
let config = DotDoConfiguration(
    baseURL: URL(string: "wss://api.dotdo.dev")!,
    credentials: .apiKey("your-api-key"),
    retry: RetryConfiguration(
        maxAttempts: 5,
        baseDelay: 0.2,
        maxDelay: 30.0,
        jitterFactor: 0.1,
        retryOnTimeout: true,
        retryOnConnectionLoss: true,
        retryableStatusCodes: [408, 429, 500, 502, 503, 504]
    ),
    connectionPool: ConnectionPoolConfiguration(
        maxConnections: 20,
        minConnections: 2,
        idleTimeout: 300,
        acquisitionTimeout: 30,
        healthCheckInterval: 30
    ),
    timeout: 60.0,
    headers: ["X-Custom": "value"]
)
```

## Authentication

### API Key

```swift
let client = DotDoClient.withApiKey(
    "your-api-key",
    baseURL: URL(string: "wss://api.dotdo.dev")!
)
```

### Bearer Token (OAuth)

```swift
let client = DotDoClient.withBearerToken(
    "oauth-access-token",
    baseURL: URL(string: "wss://api.dotdo.dev")!
)
```

### Client Credentials

```swift
let config = DotDoConfiguration(
    baseURL: URL(string: "wss://api.dotdo.dev")!,
    credentials: .clientCredentials(
        clientId: "your-client-id",
        clientSecret: "your-client-secret"
    )
)
let client = DotDoClient(configuration: config)
```

### AuthCredentials Enum

```swift
public enum AuthCredentials: Sendable {
    /// API key authentication
    case apiKey(String)
    /// OAuth2 bearer token
    case bearerToken(String)
    /// OAuth2 client credentials
    case clientCredentials(clientId: String, clientSecret: String)
    /// No authentication
    case none
}
```

### AuthToken

```swift
public struct AuthToken: Sendable {
    public let accessToken: String
    public let tokenType: String
    public let expiresAt: Date?
    public let refreshToken: String?

    /// Check if the token is expired
    public var isExpired: Bool

    /// Check if the token needs refresh
    public func needsRefresh(buffer: TimeInterval = 60) -> Bool
}
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```swift
let poolConfig = ConnectionPoolConfiguration(
    maxConnections: 20,       // Maximum connections
    minConnections: 2,        // Pre-warm 2 connections
    idleTimeout: 300,         // Close idle connections after 5 min
    acquisitionTimeout: 30,   // Wait up to 30s for connection
    healthCheckInterval: 30   // Check health every 30s
)
```

### Pool Statistics

```swift
let stats = await client.poolStats()
print("Available: \(stats.available)")
print("In use: \(stats.inUse)")
print("Waiting: \(stats.waiting)")
print("Total: \(stats.total)")
```

### Using Connections

```swift
try await client.withConnection { connection in
    // Use the connection
    // Automatically returned to pool after use
}
```

## Retry Logic

The SDK automatically retries failed requests:

```swift
let retryConfig = RetryConfiguration(
    maxAttempts: 5,
    baseDelay: 0.2,          // Start with 200ms
    maxDelay: 30.0,          // Cap at 30 seconds
    jitterFactor: 0.1,       // Add 10% randomness
    retryOnTimeout: true,
    retryOnConnectionLoss: true,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504]
)
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms +/- jitter |
| 3       | 400ms +/- jitter |
| 4       | 800ms +/- jitter |
| 5       | 1600ms +/- jitter |

### Manual Retry

```swift
let result = try await withRetry(configuration: retryConfig) {
    try await someOperation()
}
```

## Error Handling

### DotDoError Enum

```swift
public enum DotDoError: Error, Sendable, Equatable {
    /// Authentication failed
    case authenticationFailed(String)
    /// Token has expired
    case tokenExpired
    /// Insufficient permissions
    case unauthorized(String)
    /// Connection to server failed
    case connectionFailed(String)
    /// Connection was lost
    case connectionLost(String?)
    /// Request timed out
    case timeout
    /// Rate limit exceeded
    case rateLimitExceeded(retryAfter: TimeInterval?)
    /// Invalid configuration
    case invalidConfiguration(String)
    /// Resource not found
    case notFound(String)
    /// Server error
    case serverError(code: Int, message: String)
    /// Request was cancelled
    case cancelled
}
```

### Error Handling Example

```swift
do {
    try await client.execute {
        // Operation
    }
} catch DotDoError.authenticationFailed(let message) {
    print("Auth failed: \(message)")
    // Re-authenticate
} catch DotDoError.rateLimitExceeded(let retryAfter) {
    if let delay = retryAfter {
        try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        // Retry
    }
} catch DotDoError.timeout {
    print("Request timed out")
} catch DotDoError.connectionLost {
    print("Connection lost, reconnecting...")
    try await client.start()
} catch {
    print("Unexpected error: \(error)")
}
```

## Actor-Based Safety

The SDK uses Swift actors for thread safety:

### DotDoClient Actor

```swift
public actor DotDoClient {
    /// Client configuration
    public let configuration: DotDoConfiguration

    /// Whether the client is started
    public private(set) var isStarted: Bool

    /// Start the client
    public func start() async throws

    /// Stop the client
    public func stop() async

    /// Execute an operation with retry logic
    public func execute<T>(
        _ operation: @Sendable @escaping () async throws -> T
    ) async throws -> T

    /// Get a connection from the pool
    public func withConnection<T>(
        _ operation: @Sendable @escaping (PooledConnection) async throws -> T
    ) async throws -> T

    /// Get authentication header
    public func getAuthHeader() async throws -> (key: String, value: String)?

    /// Get pool statistics
    public func poolStats() async -> ConnectionPoolStats
}
```

### AuthProvider Actor

```swift
public actor AuthProvider {
    /// Get a valid token, refreshing if necessary
    public func getToken() async throws -> AuthToken?

    /// Set a new token
    public func setToken(_ token: AuthToken)

    /// Clear the current token
    public func clearToken()
}
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```swift
// Auth is handled automatically
let client = DotDoClient.withApiKey(
    ProcessInfo.processInfo.environment["DOTDO_API_KEY"]!,
    baseURL: URL(string: "wss://api.dotdo.dev")!
)
```

### Usage Metrics

```swift
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```swift
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

## Best Practices

### 1. Use Scoped Client

```swift
// Good - automatic lifecycle management
try await withDotDoClient(configuration: config) { client in
    try await client.execute { /* operation */ }
}

// Also good - explicit lifecycle
let client = DotDoClient(configuration: config)
try await client.start()
defer { Task { await client.stop() } }
```

### 2. Reuse Client Instance

```swift
// Good - single client instance
@MainActor
class APIService {
    static let shared = APIService()
    private let client: DotDoClient

    private init() {
        let config = DotDoConfiguration(
            baseURL: URL(string: "wss://api.dotdo.dev")!,
            credentials: .apiKey(Config.apiKey)
        )
        client = DotDoClient(configuration: config)
    }

    func start() async throws {
        try await client.start()
    }
}

// Bad - new client per request
func badRequest() async throws {
    let client = DotDoClient(configuration: config)
    try await client.start()
    // Missing stop()!
}
```

### 3. Handle Cancellation

```swift
func cancelableOperation() async throws {
    try await client.execute {
        // Check for cancellation
        try Task.checkCancellation()

        // Long operation...

        try Task.checkCancellation()
        // More work...
    }
}
```

### 4. Use Structured Concurrency

```swift
// Good - structured concurrency
try await withThrowingTaskGroup(of: String.self) { group in
    for prompt in prompts {
        group.addTask {
            try await client.execute {
                // Generate
                return "result"
            }
        }
    }

    for try await result in group {
        print(result)
    }
}
```

## API Reference

### DotDoClient

```swift
public actor DotDoClient {
    // Initializers
    init(configuration: DotDoConfiguration)
    static func withApiKey(_ apiKey: String, baseURL: URL) -> DotDoClient
    static func withBearerToken(_ token: String, baseURL: URL) -> DotDoClient

    // Lifecycle
    func start() async throws
    func stop() async

    // Operations
    func execute<T>(_ operation: @Sendable () async throws -> T) async throws -> T
    func withConnection<T>(_ operation: @Sendable (PooledConnection) async throws -> T) async throws -> T

    // Authentication
    func getAuthHeader() async throws -> (key: String, value: String)?

    // Pool
    func poolStats() async -> ConnectionPoolStats
}
```

### ConnectionPool

```swift
public actor ConnectionPool {
    func start() async throws
    func stop() async
    func acquire() async throws -> PooledConnection
    func release(_ connection: PooledConnection)
    func stats() -> ConnectionPoolStats
}
```

### Helper Functions

```swift
// Scoped client with automatic lifecycle
public func withDotDoClient<T>(
    configuration: DotDoConfiguration,
    operation: @Sendable @escaping (DotDoClient) async throws -> T
) async throws -> T

// Retry helper
public func withRetry<T>(
    configuration: RetryConfiguration,
    operation: @Sendable () async throws -> T
) async throws -> T
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/swift)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [Swift Package Index](https://swiftpackageindex.com/dotdo-dev/platform-do-swift)
