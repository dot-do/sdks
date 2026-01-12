# {{Name}}Do

{{Name}}.do SDK for Swift - {{description}}

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/dot-do/{{name}}-swift.git", from: "0.1.0")
]
```

## Quick Start

```swift
import {{Name}}Do

// Create client with API key
let client = {{Name}}Client(
    apiKey: ProcessInfo.processInfo.environment["DOTDO_KEY"]
)

// Connect to the service
try await client.connect()
defer { await client.disconnect() }

// Make RPC calls through the client
let rpc = try await client.getRpc()
// ...
```

## Configuration

```swift
let options = {{Name}}ClientOptions(
    apiKey: "your-api-key",
    baseUrl: "https://{{name}}.do",   // Custom endpoint
    timeout: 30.0                       // Connection timeout
)
let client = {{Name}}Client(options: options)
```

## Error Handling

```swift
do {
    try await client.connect()
    // ...
} catch {{Name}}Error.authenticationFailed(let reason) {
    print("Authentication failed: \(reason)")
} catch {{Name}}Error.connectionFailed(let reason) {
    print("Connection failed: \(reason)")
} catch {{Name}}Error.notConnected {
    print("Client not connected")
} catch {
    print("Error: \(error)")
}
```

## Actor-based Concurrency

The client is implemented as an actor for safe concurrent access:

```swift
// Safe to call from multiple tasks
async let result1 = client.someOperation()
async let result2 = client.anotherOperation()
let (r1, r2) = try await (result1, result2)
```

## License

MIT
