# do.platform:sdk

The official Kotlin SDK for the DotDo platform. This library provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`do.platform:sdk` is the highest-level SDK in the DotDo stack, built on top of:

- **do.rpc:sdk** - Type-safe RPC client
- **do.capnweb:sdk** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Kotlin API using coroutines.

```
+------------------+
| do.platform:sdk  |  <-- You are here (auth, pooling, retries)
+------------------+
|   do.rpc:sdk     |  <-- RPC client layer
+------------------+
| do.capnweb:sdk   |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **Kotlin Coroutines**: Native suspend functions and Flow support
- **Type Safety**: Full Kotlin type system with generics and DSL builders
- **Ktor Integration**: Built on Ktor for HTTP and WebSocket

## Requirements

- Kotlin 1.9+
- JDK 21+
- Coroutines 1.8+

## Installation

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("do.platform:sdk:0.1.0")
}
```

### Gradle (Groovy)

```groovy
dependencies {
    implementation 'do.platform:sdk:0.1.0'
}
```

### Maven

```xml
<dependency>
    <groupId>do.platform</groupId>
    <artifactId>sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Quick Start

### Basic Usage

```kotlin
import do.platform.DotDo
import do.platform.DotDoConfig
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    // Create a client
    val client = DotDo(
        DotDoConfig(
            apiKey = System.getenv("DOTDO_API_KEY")
        )
    )

    // Make an RPC call
    val result = client.call("ai.generate") {
        put("prompt", "Hello, world!")
        put("model", "claude-3")
    }

    println(result)

    // Close when done
    client.close()
}
```

### Using DSL Builder

```kotlin
import do.platform.dotDo
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val client = dotDo {
        apiKey = System.getenv("DOTDO_API_KEY")
        endpoint = "wss://api.dotdo.dev/rpc"
        timeout = 30_000
        poolSize = 10
    }

    client.use { c ->
        val result = c.call("ai.generate") {
            put("prompt", "Hello!")
        }
        println(result)
    }
}
```

## Configuration

### DotDoConfig

```kotlin
data class DotDoConfig(
    // Authentication
    val apiKey: String? = null,
    val accessToken: String? = null,
    val headers: Map<String, String> = emptyMap(),

    // Endpoint
    val endpoint: String = "wss://api.dotdo.dev/rpc",

    // Connection Pool
    val poolSize: Int = 10,
    val poolTimeout: Long = 30_000,

    // Retry Policy
    val maxRetries: Int = 3,
    val retryDelay: Long = 100,
    val retryMaxDelay: Long = 30_000,
    val retryMultiplier: Double = 2.0,

    // Request Settings
    val timeout: Long = 30_000,

    // Debug
    val debug: Boolean = false
)
```

### DSL Configuration

```kotlin
val client = dotDo {
    // Authentication
    apiKey = "your-api-key"
    accessToken = "oauth-token"
    header("X-Custom", "value")

    // Endpoint
    endpoint = "wss://api.dotdo.dev/rpc"

    // Connection Pool
    poolSize = 20
    poolTimeout = 60_000

    // Retry Policy
    maxRetries = 5
    retryDelay = 200
    retryMaxDelay = 60_000
    retryMultiplier = 2.0

    // Request Settings
    timeout = 60_000

    // Debug
    debug = true
}
```

### Environment Variables

```bash
# Authentication
export DOTDO_API_KEY=your-api-key
export DOTDO_ACCESS_TOKEN=oauth-token

# Endpoint
export DOTDO_ENDPOINT=wss://api.dotdo.dev/rpc

# Connection Pool
export DOTDO_POOL_SIZE=10
export DOTDO_POOL_TIMEOUT=30000

# Retry
export DOTDO_MAX_RETRIES=3
export DOTDO_RETRY_DELAY=100

# Request
export DOTDO_TIMEOUT=30000

# Debug
export DOTDO_DEBUG=true
```

## Authentication

### API Key

```kotlin
val client = dotDo {
    apiKey = "your-api-key"
}
```

### OAuth Token

```kotlin
val client = dotDo {
    accessToken = "oauth-access-token"
}
```

### Custom Headers

```kotlin
val client = dotDo {
    apiKey = "your-api-key"
    header("X-Tenant-ID", "tenant-123")
    header("X-Request-ID", UUID.randomUUID().toString())
}
```

### Dynamic Authentication

```kotlin
val client = dotDo {
    authProvider { request ->
        val token = fetchToken() // Your token refresh logic
        request.header("Authorization", "Bearer $token")
    }
}
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```kotlin
val client = dotDo {
    poolSize = 20       // Maximum concurrent connections
    poolTimeout = 60_000 // Wait up to 60s for available connection
}
```

### Pool Behavior

1. Connections are created on-demand up to `poolSize`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, coroutines suspend up to `poolTimeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```kotlin
val stats = client.poolStats()
println("Available: ${stats.available}")
println("In use: ${stats.inUse}")
println("Total: ${stats.total}")
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```kotlin
val client = dotDo {
    maxRetries = 5
    retryDelay = 200        // Start with 200ms
    retryMaxDelay = 60_000  // Cap at 60 seconds
    retryMultiplier = 2.0   // Double each time
}
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Custom Retry Policy

```kotlin
val client = dotDo {
    retryPolicy { error, attempt ->
        when {
            error is RateLimitException -> {
                delay(error.retryAfter)
                true // Retry
            }
            attempt < 5 -> {
                delay(100L * (1 shl attempt))
                true // Retry
            }
            else -> false // Don't retry
        }
    }
}
```

## Making RPC Calls

### Basic Call

```kotlin
val result = client.call("method.name") {
    put("param", "value")
}
```

### With Timeout Override

```kotlin
val result = client.call("ai.generate", timeout = 120_000) {
    put("prompt", "Long task...")
}
```

### Typed Responses

```kotlin
@Serializable
data class GenerateResponse(
    val text: String,
    val usage: Usage
)

@Serializable
data class Usage(
    val promptTokens: Int,
    val completionTokens: Int
)

val response: GenerateResponse = client.call("ai.generate") {
    put("prompt", "Hello!")
}

println("Generated: ${response.text}")
println("Tokens: ${response.usage.completionTokens}")
```

### Flow-Based Streaming

```kotlin
client.stream("ai.generate") {
    put("prompt", "Hello")
}.collect { chunk ->
    print(chunk)
}
```

## Error Handling

### Exception Hierarchy

```kotlin
sealed class DotDoException : Exception()
class AuthException : DotDoException()
class ConnectionException : DotDoException()
class TimeoutException : DotDoException()
class RateLimitException(val retryAfter: Long) : DotDoException()
class RpcException(val code: Int, override val message: String) : DotDoException()
class PoolExhaustedException : DotDoException()
```

### Error Handling Example

```kotlin
try {
    val result = client.call("ai.generate") {
        put("prompt", "Hello")
    }
} catch (e: AuthException) {
    println("Authentication failed: ${e.message}")
    // Re-authenticate
} catch (e: RateLimitException) {
    println("Rate limited. Retry after: ${e.retryAfter}ms")
    delay(e.retryAfter)
    // Retry
} catch (e: TimeoutException) {
    println("Request timed out")
} catch (e: RpcException) {
    println("RPC error (${e.code}): ${e.message}")
} catch (e: DotDoException) {
    println("DotDo error: ${e.message}")
}
```

### Result Type

```kotlin
val result = client.callResult("ai.generate") {
    put("prompt", "Hello")
}

result.fold(
    onSuccess = { response ->
        println("Success: $response")
    },
    onFailure = { error ->
        println("Error: ${error.message}")
    }
)
```

## Collections API

### Working with Collections

```kotlin
val users = client.collection("users")

// Create a document
users.set("user-123", mapOf(
    "name" to "Alice",
    "email" to "alice@example.com"
))

// Read a document
val user = users.get("user-123")
println(user)

// Update a document
users.update("user-123", mapOf("name" to "Alice Smith"))

// Delete a document
users.delete("user-123")
```

### Typed Collections

```kotlin
@Serializable
data class User(
    val name: String,
    val email: String,
    val age: Int
)

val users = client.collection<User>("users")

// Create
users.set("user-123", User("Alice", "alice@example.com", 25))

// Read with type safety
val user: User = users.get("user-123")
```

### Querying Collections

```kotlin
val users = client.collection("users")

// Build a query
val results = users.query()
    .where("status", "==", "active")
    .where("age", ">=", 18)
    .orderBy("createdAt", descending = true)
    .limit(10)
    .execute()

results.forEach { user ->
    println(user)
}
```

### Query DSL

```kotlin
val results = users.query {
    where("status" eq "active")
    where("age" gte 18)
    orderBy("createdAt", desc)
    limit(10)
}

results.forEach { println(it) }
```

## Coroutines Integration

### Suspend Functions

```kotlin
suspend fun generateText(prompt: String): String {
    return client.call<GenerateResponse>("ai.generate") {
        put("prompt", prompt)
    }.text
}
```

### Concurrent Requests

```kotlin
val prompts = listOf("Hello", "World", "Test")

val results = coroutineScope {
    prompts.map { prompt ->
        async {
            client.call("ai.generate") {
                put("prompt", prompt)
            }
        }
    }.awaitAll()
}

results.forEach { println(it) }
```

### Flow Operators

```kotlin
val prompts = flowOf("Hello", "World", "Test")

prompts
    .map { prompt ->
        client.call("ai.generate") {
            put("prompt", prompt)
        }
    }
    .catch { e -> println("Error: ${e.message}") }
    .collect { result -> println(result) }
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```kotlin
// Auth is handled automatically
val client = dotDo {
    apiKey = System.getenv("DOTDO_API_KEY")
}
```

### Usage Metrics

```kotlin
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```kotlin
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```kotlin
// Enable debug mode for verbose logging
val client = dotDo {
    debug = true
}
```

## Best Practices

### 1. Use `use` for Automatic Cleanup

```kotlin
// Good - automatic cleanup
dotDo { apiKey = "key" }.use { client ->
    client.call("method") { put("param", "value") }
}

// Also good - try-finally
val client = dotDo { apiKey = "key" }
try {
    client.call("method") { put("param", "value") }
} finally {
    client.close()
}
```

### 2. Reuse Client Instance

```kotlin
// Good - single client instance
object ApiClient {
    val client = dotDo {
        apiKey = System.getenv("DOTDO_API_KEY")
    }
}

// Use anywhere
suspend fun generate(prompt: String) = ApiClient.client.call("ai.generate") {
    put("prompt", prompt)
}

// Bad - new client per request
suspend fun badGenerate(prompt: String) {
    val client = dotDo { apiKey = "key" } // Creates new pool!
    client.call("ai.generate") { put("prompt", prompt) }
    // Missing close()!
}
```

### 3. Use Typed Responses

```kotlin
// Good - type safety
@Serializable
data class Response(val text: String)

val response: Response = client.call("method") {
    put("param", "value")
}

// Works but no compile-time safety
val response = client.call("method") {
    put("param", "value")
}
```

### 4. Handle Structured Concurrency

```kotlin
// Good - structured concurrency
coroutineScope {
    val results = prompts.map { prompt ->
        async {
            client.call("ai.generate") {
                put("prompt", prompt)
            }
        }
    }.awaitAll()
    // All requests complete or cancel together
}
```

## API Reference

### DotDo Class

```kotlin
class DotDo(config: DotDoConfig) : Closeable {
    // RPC Calls
    suspend fun <T> call(
        method: String,
        timeout: Long? = null,
        params: JsonObjectBuilder.() -> Unit
    ): T

    suspend fun <T> callResult(
        method: String,
        params: JsonObjectBuilder.() -> Unit
    ): Result<T>

    // Streaming
    fun stream(
        method: String,
        params: JsonObjectBuilder.() -> Unit
    ): Flow<JsonElement>

    // Collections
    fun collection(name: String): Collection
    fun <T> collection(name: String): TypedCollection<T>

    // Pool Statistics
    fun poolStats(): PoolStats

    // Lifecycle
    override fun close()
}
```

### DSL Builder

```kotlin
fun dotDo(block: DotDoBuilder.() -> Unit): DotDo

class DotDoBuilder {
    var apiKey: String?
    var accessToken: String?
    var endpoint: String
    var poolSize: Int
    var poolTimeout: Long
    var maxRetries: Int
    var retryDelay: Long
    var retryMaxDelay: Long
    var retryMultiplier: Double
    var timeout: Long
    var debug: Boolean

    fun header(name: String, value: String)
    fun authProvider(provider: suspend (HttpRequestBuilder) -> Unit)
    fun retryPolicy(policy: suspend (Throwable, Int) -> Boolean)
}
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/kotlin)
- [Maven Central](https://search.maven.org/artifact/do.platform/sdk)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [KDoc Reference](https://do.md/api/kotlin)
