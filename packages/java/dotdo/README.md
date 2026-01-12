# do.platform:sdk

The official Java SDK for the DotDo platform. This library provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling.

## Overview

`do.platform:sdk` is the highest-level SDK in the DotDo stack, built on top of:

- **do.rpc:sdk** - Type-safe RPC client
- **do.capnweb:sdk** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Java API.

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
- **CompletableFuture Support**: Async API with Java standard futures
- **Virtual Threads Ready**: Works great with Java 21 virtual threads
- **Builder Pattern**: Fluent configuration API

## Requirements

- Java 21+
- Gradle 8+ or Maven 3.8+

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

```java
import do.platform.DotDo;
import do.platform.DotDoConfig;
import java.util.Map;

public class Example {
    public static void main(String[] args) throws Exception {
        // Create a client
        var client = DotDo.builder()
            .apiKey(System.getenv("DOTDO_API_KEY"))
            .build();

        try {
            // Make an RPC call
            var result = client.call("ai.generate", Map.of(
                "prompt", "Hello, world!",
                "model", "claude-3"
            ));

            System.out.println(result);
        } finally {
            client.close();
        }
    }
}
```

### Async Usage

```java
import do.platform.DotDo;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

public class AsyncExample {
    public static void main(String[] args) {
        var client = DotDo.builder()
            .apiKey(System.getenv("DOTDO_API_KEY"))
            .build();

        client.callAsync("ai.generate", Map.of("prompt", "Hello!"))
            .thenAccept(result -> System.out.println(result))
            .exceptionally(error -> {
                System.err.println("Error: " + error.getMessage());
                return null;
            })
            .join();

        client.close();
    }
}
```

### With Try-With-Resources

```java
import do.platform.DotDo;
import java.util.Map;

public class TryWithResourcesExample {
    public static void main(String[] args) throws Exception {
        try (var client = DotDo.builder()
                .apiKey(System.getenv("DOTDO_API_KEY"))
                .build()) {

            var result = client.call("ai.generate", Map.of(
                "prompt", "Hello!"
            ));

            System.out.println(result);
        }
        // Client automatically closed
    }
}
```

## Configuration

### DotDoConfig Builder

```java
var client = DotDo.builder()
    // Authentication
    .apiKey("your-api-key")
    .accessToken("oauth-token")
    .header("X-Custom", "value")

    // Endpoint
    .endpoint("wss://api.dotdo.dev/rpc")

    // Connection Pool
    .poolSize(10)
    .poolTimeout(Duration.ofSeconds(30))

    // Retry Policy
    .maxRetries(3)
    .retryDelay(Duration.ofMillis(100))
    .retryMaxDelay(Duration.ofSeconds(30))
    .retryMultiplier(2.0)

    // Request Settings
    .timeout(Duration.ofSeconds(30))

    // Debug
    .debug(true)

    .build();
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

### Configuration from Environment

```java
var client = DotDo.fromEnvironment();

// Or with overrides
var client = DotDo.builder()
    .fromEnvironment()
    .debug(true)  // Override
    .build();
```

## Authentication

### API Key

```java
var client = DotDo.builder()
    .apiKey("your-api-key")
    .build();
```

### OAuth Token

```java
var client = DotDo.builder()
    .accessToken("oauth-access-token")
    .build();
```

### Custom Headers

```java
var client = DotDo.builder()
    .apiKey("your-api-key")
    .header("X-Tenant-ID", "tenant-123")
    .header("X-Request-ID", UUID.randomUUID().toString())
    .build();
```

### Dynamic Authentication

```java
var client = DotDo.builder()
    .authProvider(request -> {
        String token = fetchToken(); // Your token refresh logic
        request.header("Authorization", "Bearer " + token);
    })
    .build();
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```java
var client = DotDo.builder()
    .poolSize(20)                       // Maximum concurrent connections
    .poolTimeout(Duration.ofSeconds(60)) // Wait up to 60s for available connection
    .build();
```

### Pool Behavior

1. Connections are created on-demand up to `poolSize`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, threads block up to `poolTimeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```java
var stats = client.poolStats();
System.out.println("Available: " + stats.getAvailable());
System.out.println("In use: " + stats.getInUse());
System.out.println("Total: " + stats.getTotal());
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```java
var client = DotDo.builder()
    .maxRetries(5)
    .retryDelay(Duration.ofMillis(200))    // Start with 200ms
    .retryMaxDelay(Duration.ofSeconds(60)) // Cap at 60 seconds
    .retryMultiplier(2.0)                   // Double each time
    .build();
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

```java
var client = DotDo.builder()
    .retryPolicy((error, attempt) -> {
        if (error instanceof RateLimitException rle) {
            Thread.sleep(rle.getRetryAfter());
            return true; // Retry
        }
        return attempt < 5; // Retry up to 5 times
    })
    .build();
```

## Making RPC Calls

### Synchronous Calls

```java
// With Map
var result = client.call("method.name", Map.of("param", "value"));

// With POJO
record GenerateRequest(String prompt, String model) {}
var request = new GenerateRequest("Hello!", "claude-3");
var result = client.call("ai.generate", request);
```

### Asynchronous Calls

```java
CompletableFuture<JsonObject> future = client.callAsync("ai.generate", Map.of(
    "prompt", "Hello!"
));

future.thenAccept(result -> {
    System.out.println(result);
}).exceptionally(error -> {
    System.err.println("Error: " + error.getMessage());
    return null;
});
```

### Typed Responses

```java
record GenerateResponse(String text, Usage usage) {}
record Usage(int promptTokens, int completionTokens) {}

GenerateResponse response = client.call(
    "ai.generate",
    Map.of("prompt", "Hello!"),
    GenerateResponse.class
);

System.out.println("Generated: " + response.text());
System.out.println("Tokens: " + response.usage().completionTokens());
```

### With Timeout Override

```java
var result = client.call(
    "ai.generate",
    Map.of("prompt", "Long task..."),
    Duration.ofMinutes(2)
);
```

## Error Handling

### Exception Hierarchy

```java
public class DotDoException extends Exception {}
public class AuthException extends DotDoException {}
public class ConnectionException extends DotDoException {}
public class TimeoutException extends DotDoException {}
public class RateLimitException extends DotDoException {
    public long getRetryAfter() { ... }
}
public class RpcException extends DotDoException {
    public int getCode() { ... }
}
public class PoolExhaustedException extends DotDoException {}
```

### Error Handling Example

```java
try {
    var result = client.call("ai.generate", Map.of("prompt", "Hello"));
} catch (AuthException e) {
    System.err.println("Authentication failed: " + e.getMessage());
    // Re-authenticate
} catch (RateLimitException e) {
    System.err.println("Rate limited. Retry after: " + e.getRetryAfter() + "ms");
    Thread.sleep(e.getRetryAfter());
    // Retry
} catch (TimeoutException e) {
    System.err.println("Request timed out");
} catch (RpcException e) {
    System.err.println("RPC error (" + e.getCode() + "): " + e.getMessage());
} catch (DotDoException e) {
    System.err.println("DotDo error: " + e.getMessage());
}
```

### Using Optional

```java
Optional<JsonObject> result = client.callOptional("ai.generate", Map.of(
    "prompt", "Hello"
));

result.ifPresentOrElse(
    response -> System.out.println(response),
    () -> System.out.println("No response")
);
```

## Collections API

### Working with Collections

```java
var users = client.collection("users");

// Create a document
users.set("user-123", Map.of(
    "name", "Alice",
    "email", "alice@example.com"
));

// Read a document
var user = users.get("user-123");
System.out.println(user);

// Update a document
users.update("user-123", Map.of("name", "Alice Smith"));

// Delete a document
users.delete("user-123");
```

### Typed Collections

```java
record User(String name, String email, int age) {}

var users = client.collection("users", User.class);

// Create with type safety
users.set("user-123", new User("Alice", "alice@example.com", 25));

// Read with type safety
User user = users.get("user-123");
```

### Querying Collections

```java
var users = client.collection("users");

// Build a query
var results = users.query()
    .where("status", "==", "active")
    .where("age", ">=", 18)
    .orderBy("createdAt", Direction.DESC)
    .limit(10)
    .execute();

for (var user : results) {
    System.out.println(user);
}
```

### Query Operators

| Operator | Description |
|----------|-------------|
| `==`     | Equal to |
| `!=`     | Not equal to |
| `<`      | Less than |
| `<=`     | Less than or equal |
| `>`      | Greater than |
| `>=`     | Greater than or equal |
| `in`     | In list |
| `not_in` | Not in list |

## Virtual Threads (Java 21+)

The SDK works great with virtual threads:

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = prompts.stream()
        .map(prompt -> executor.submit(() ->
            client.call("ai.generate", Map.of("prompt", prompt))
        ))
        .toList();

    for (var future : futures) {
        System.out.println(future.get());
    }
}
```

### Concurrent Requests

```java
var prompts = List.of("Hello", "World", "Test");

var results = prompts.parallelStream()
    .map(prompt -> {
        try {
            return client.call("ai.generate", Map.of("prompt", prompt));
        } catch (DotDoException e) {
            throw new RuntimeException(e);
        }
    })
    .toList();

results.forEach(System.out::println);
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```java
// Auth is handled automatically
var client = DotDo.builder()
    .apiKey(System.getenv("DOTDO_API_KEY"))
    .build();
```

### Usage Metrics

```java
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```java
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```java
// Enable debug mode for verbose logging
var client = DotDo.builder()
    .debug(true)
    .build();
```

## Best Practices

### 1. Use Try-With-Resources

```java
// Good - automatic cleanup
try (var client = DotDo.builder().apiKey("key").build()) {
    client.call("method", params);
}

// Also good - explicit cleanup
var client = DotDo.builder().apiKey("key").build();
try {
    client.call("method", params);
} finally {
    client.close();
}
```

### 2. Reuse Client Instance

```java
// Good - single client instance (singleton pattern)
public class ApiClient {
    private static final DotDo INSTANCE = DotDo.builder()
        .apiKey(System.getenv("DOTDO_API_KEY"))
        .build();

    public static DotDo getInstance() {
        return INSTANCE;
    }
}

// Use anywhere
var result = ApiClient.getInstance().call("ai.generate", params);

// Bad - new client per request
public Object badGenerate(String prompt) throws DotDoException {
    var client = DotDo.builder().apiKey("key").build(); // Creates new pool!
    return client.call("ai.generate", Map.of("prompt", prompt));
    // Missing close()!
}
```

### 3. Use Typed Responses

```java
// Good - type safety
record Response(String text) {}
Response response = client.call("method", params, Response.class);

// Works but no compile-time safety
JsonObject response = client.call("method", params);
```

### 4. Handle All Exceptions

```java
// Good - specific exception handling
try {
    client.call("method", params);
} catch (RateLimitException e) {
    Thread.sleep(e.getRetryAfter());
    // Retry
} catch (AuthException e) {
    refreshCredentials();
    // Retry
} catch (DotDoException e) {
    log.error("DotDo error", e);
    throw e;
}

// Bad - catch-all
try {
    client.call("method", params);
} catch (Exception e) {
    // Swallowing all exceptions
}
```

## API Reference

### DotDo Class

```java
public class DotDo implements AutoCloseable {
    // Builder
    public static Builder builder();
    public static DotDo fromEnvironment();

    // Synchronous calls
    public JsonObject call(String method, Object params) throws DotDoException;
    public <T> T call(String method, Object params, Class<T> responseType) throws DotDoException;
    public JsonObject call(String method, Object params, Duration timeout) throws DotDoException;

    // Asynchronous calls
    public CompletableFuture<JsonObject> callAsync(String method, Object params);
    public <T> CompletableFuture<T> callAsync(String method, Object params, Class<T> responseType);

    // Optional results
    public Optional<JsonObject> callOptional(String method, Object params);

    // Collections
    public Collection collection(String name);
    public <T> TypedCollection<T> collection(String name, Class<T> type);

    // Pool statistics
    public PoolStats poolStats();

    // Lifecycle
    @Override
    public void close();
}
```

### Builder Class

```java
public class Builder {
    public Builder apiKey(String apiKey);
    public Builder accessToken(String token);
    public Builder endpoint(String endpoint);
    public Builder header(String name, String value);
    public Builder poolSize(int size);
    public Builder poolTimeout(Duration timeout);
    public Builder maxRetries(int retries);
    public Builder retryDelay(Duration delay);
    public Builder retryMaxDelay(Duration maxDelay);
    public Builder retryMultiplier(double multiplier);
    public Builder timeout(Duration timeout);
    public Builder debug(boolean debug);
    public Builder authProvider(AuthProvider provider);
    public Builder retryPolicy(RetryPolicy policy);
    public Builder fromEnvironment();
    public DotDo build();
}
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/java)
- [Maven Central](https://search.maven.org/artifact/do.platform/sdk)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [Javadoc Reference](https://do.md/api/java)
