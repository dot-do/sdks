# do.platform:sdk

The official Scala SDK for the DotDo platform. This library provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling using Cats Effect.

## Overview

`do.platform:sdk` is the highest-level SDK in the DotDo stack, built on top of:

- **do.rpc:sdk** - Type-safe RPC client
- **do.capnweb:sdk** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with a purely functional Scala API.

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
- **Cats Effect Integration**: Pure functional IO with Resource management
- **Circe JSON**: Type-safe JSON encoding/decoding
- **sttp Client**: Modern HTTP client with multiple backends

## Requirements

- Scala 3.3+
- JDK 21+
- sbt 1.9+

## Installation

### sbt

```scala
libraryDependencies += "do.platform" %% "sdk" % "0.1.0"
```

### Mill

```scala
ivy"do.platform::sdk:0.1.0"
```

### Scala CLI

```scala
//> using dep "do.platform::sdk:0.1.0"
```

## Quick Start

### Basic Usage

```scala
import do.platform.*
import cats.effect.{IO, IOApp}

object Example extends IOApp.Simple:
  def run: IO[Unit] =
    DotDo.resource[IO](
      DotDoConfig(
        apiKey = Some(sys.env("DOTDO_API_KEY"))
      )
    ).use { client =>
      for
        result <- client.call("ai.generate", Map(
          "prompt" -> "Hello, world!",
          "model" -> "claude-3"
        ))
        _ <- IO.println(result)
      yield ()
    }
```

### With Circe Codecs

```scala
import do.platform.*
import cats.effect.{IO, IOApp}
import io.circe.generic.auto.*

case class GenerateRequest(prompt: String, model: String)
case class GenerateResponse(text: String, usage: Usage)
case class Usage(promptTokens: Int, completionTokens: Int)

object TypedExample extends IOApp.Simple:
  def run: IO[Unit] =
    DotDo.resource[IO](
      DotDoConfig(apiKey = Some(sys.env("DOTDO_API_KEY")))
    ).use { client =>
      for
        response <- client.call[GenerateRequest, GenerateResponse](
          "ai.generate",
          GenerateRequest("Hello!", "claude-3")
        )
        _ <- IO.println(s"Generated: ${response.text}")
        _ <- IO.println(s"Tokens: ${response.usage.completionTokens}")
      yield ()
    }
```

## Configuration

### DotDoConfig

```scala
case class DotDoConfig(
  // Authentication
  apiKey: Option[String] = None,
  accessToken: Option[String] = None,
  headers: Map[String, String] = Map.empty,

  // Endpoint
  endpoint: String = "wss://api.dotdo.dev/rpc",

  // Connection Pool
  poolSize: Int = 10,
  poolTimeout: FiniteDuration = 30.seconds,

  // Retry Policy
  maxRetries: Int = 3,
  retryDelay: FiniteDuration = 100.millis,
  retryMaxDelay: FiniteDuration = 30.seconds,
  retryMultiplier: Double = 2.0,

  // Request Settings
  timeout: FiniteDuration = 30.seconds,

  // Debug
  debug: Boolean = false
)
```

### DSL Configuration

```scala
import do.platform.dsl.*

val client = dotDo[IO] {
  apiKey := sys.env("DOTDO_API_KEY")
  endpoint := "wss://api.dotdo.dev/rpc"
  poolSize := 20
  timeout := 60.seconds
  maxRetries := 5
  debug := true
}
```

### Environment Configuration

```bash
# Authentication
export DOTDO_API_KEY=your-api-key
export DOTDO_ACCESS_TOKEN=oauth-token

# Endpoint
export DOTDO_ENDPOINT=wss://api.dotdo.dev/rpc

# Connection Pool
export DOTDO_POOL_SIZE=10

# Retry
export DOTDO_MAX_RETRIES=3

# Request
export DOTDO_TIMEOUT=30

# Debug
export DOTDO_DEBUG=true
```

```scala
// Load from environment
val config = DotDoConfig.fromEnv
```

## Authentication

### API Key

```scala
val config = DotDoConfig(apiKey = Some("your-api-key"))
```

### OAuth Token

```scala
val config = DotDoConfig(accessToken = Some("oauth-access-token"))
```

### Custom Headers

```scala
val config = DotDoConfig(
  apiKey = Some("your-api-key"),
  headers = Map(
    "X-Tenant-ID" -> "tenant-123",
    "X-Request-ID" -> java.util.UUID.randomUUID().toString
  )
)
```

### Dynamic Authentication

```scala
val config = DotDoConfig(
  authProvider = Some { request =>
    for
      token <- fetchToken[IO]
      _ <- IO(request.header("Authorization", s"Bearer $token"))
    yield ()
  }
)
```

## Connection Pooling

The SDK uses Resource-managed connection pooling:

```scala
val config = DotDoConfig(
  poolSize = 20,           // Maximum concurrent connections
  poolTimeout = 60.seconds // Wait up to 60s for available connection
)
```

### Pool Behavior

1. Connections are created on-demand up to `poolSize`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, fibers wait up to `poolTimeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```scala
client.poolStats.flatMap { stats =>
  IO.println(s"Available: ${stats.available}") *>
  IO.println(s"In use: ${stats.inUse}") *>
  IO.println(s"Total: ${stats.total}")
}
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```scala
val config = DotDoConfig(
  maxRetries = 5,
  retryDelay = 200.millis,    // Start with 200ms
  retryMaxDelay = 60.seconds, // Cap at 60 seconds
  retryMultiplier = 2.0       // Double each time
)
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

```scala
import do.platform.retry.*

val retryPolicy = RetryPolicy[IO](
  maxRetries = 5,
  shouldRetry = {
    case _: ConnectionError => true
    case _: RateLimitError => true
    case _ => false
  },
  onRetry = (error, attempt) =>
    IO.println(s"Retry $attempt after $error")
)

val config = DotDoConfig(retryPolicy = Some(retryPolicy))
```

## Making RPC Calls

### Untyped Calls

```scala
val result: IO[Json] = client.call("method.name", Map("param" -> "value"))
```

### Typed Calls

```scala
import io.circe.generic.auto.*

case class Request(prompt: String)
case class Response(text: String)

val response: IO[Response] = client.call[Request, Response](
  "ai.generate",
  Request("Hello!")
)
```

### With Timeout Override

```scala
val result = client.call(
  "ai.generate",
  Map("prompt" -> "Long task..."),
  timeout = 2.minutes
)
```

### Streaming Responses

```scala
import fs2.Stream

val stream: Stream[IO, Json] = client.stream("ai.generate", Map(
  "prompt" -> "Hello"
))

stream.evalMap(chunk => IO.print(chunk)).compile.drain
```

## Error Handling

### Error Hierarchy

```scala
sealed trait DotDoError extends Throwable
case class AuthError(message: String) extends DotDoError
case class ConnectionError(message: String) extends DotDoError
case class TimeoutError(message: String) extends DotDoError
case class RateLimitError(retryAfter: FiniteDuration) extends DotDoError
case class RpcError(code: Int, message: String) extends DotDoError
case class PoolExhaustedError() extends DotDoError
```

### Error Handling Example

```scala
client.call("ai.generate", params).handleErrorWith {
  case AuthError(msg) =>
    IO.println(s"Authentication failed: $msg") *>
    refreshCredentials *>
    client.call("ai.generate", params)

  case RateLimitError(retryAfter) =>
    IO.println(s"Rate limited. Retry after: $retryAfter") *>
    IO.sleep(retryAfter) *>
    client.call("ai.generate", params)

  case TimeoutError(_) =>
    IO.println("Request timed out") *>
    IO.raiseError(TimeoutError("Timeout"))

  case RpcError(code, msg) =>
    IO.println(s"RPC error ($code): $msg") *>
    IO.raiseError(RpcError(code, msg))

  case e: DotDoError =>
    IO.println(s"DotDo error: ${e.getMessage}") *>
    IO.raiseError(e)
}
```

### Using EitherT

```scala
import cats.data.EitherT

val result: EitherT[IO, DotDoError, Response] =
  EitherT(client.callEither[Request, Response](
    "ai.generate",
    Request("Hello!")
  ))

result.fold(
  error => IO.println(s"Error: $error"),
  response => IO.println(s"Success: ${response.text}")
)
```

## Collections API

### Working with Collections

```scala
val users = client.collection("users")

// Create a document
users.set("user-123", Map(
  "name" -> "Alice",
  "email" -> "alice@example.com"
))

// Read a document
val user: IO[Json] = users.get("user-123")

// Update a document
users.update("user-123", Map("name" -> "Alice Smith"))

// Delete a document
users.delete("user-123")
```

### Typed Collections

```scala
import io.circe.generic.auto.*

case class User(name: String, email: String, age: Int)

val users = client.collection[User]("users")

// Create with type safety
users.set("user-123", User("Alice", "alice@example.com", 25))

// Read with type safety
val user: IO[User] = users.get("user-123")
```

### Querying Collections

```scala
val results: IO[List[Json]] = users.query
  .where("status", "==", "active")
  .where("age", ">=", 18)
  .orderBy("createdAt", Descending)
  .limit(10)
  .execute
```

### Query DSL

```scala
import do.platform.query.dsl.*

val results = users.query {
  "status" === "active"
  "age" >= 18
  orderBy("createdAt", desc)
  limit(10)
}
```

## Functional Patterns

### Resource Management

```scala
import cats.effect.Resource

val clientResource: Resource[IO, DotDo[IO]] =
  DotDo.resource[IO](config)

// Automatically released
clientResource.use { client =>
  client.call("method", params)
}
```

### Parallel Execution

```scala
import cats.syntax.parallel.*

val prompts = List("Hello", "World", "Test")

val results: IO[List[Response]] = prompts.parTraverse { prompt =>
  client.call[Request, Response](
    "ai.generate",
    Request(prompt)
  )
}
```

### Stream Processing

```scala
import fs2.Stream

Stream.emits(prompts)
  .parEvalMap(5) { prompt =>
    client.call[Request, Response]("ai.generate", Request(prompt))
  }
  .evalMap(response => IO.println(response.text))
  .compile
  .drain
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```scala
// Auth is handled automatically
val config = DotDoConfig(apiKey = Some(sys.env("DOTDO_API_KEY")))
```

### Usage Metrics

```scala
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```scala
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```scala
// Enable debug mode for verbose logging
val config = DotDoConfig(debug = true)
```

## Best Practices

### 1. Use Resource for Lifecycle

```scala
// Good - Resource handles cleanup
DotDo.resource[IO](config).use { client =>
  client.call("method", params)
}

// Also good - manual bracket
DotDo.make[IO](config).bracket { client =>
  client.call("method", params)
}(_.close)
```

### 2. Define a Single Resource

```scala
// Good - single resource for the application
object ApiClient:
  val resource: Resource[IO, DotDo[IO]] =
    DotDo.resource[IO](DotDoConfig(
      apiKey = Some(sys.env("DOTDO_API_KEY"))
    ))

// Use with composed resources
(ApiClient.resource, Database.resource).tupled.use { (client, db) =>
  // Use both
}
```

### 3. Use Typed Calls

```scala
// Good - type safety
case class Request(prompt: String)
case class Response(text: String)

val response: IO[Response] = client.call[Request, Response](
  "method",
  Request("Hello")
)

// Works but no type safety
val response: IO[Json] = client.call("method", Map("prompt" -> "Hello"))
```

### 4. Handle Errors Functionally

```scala
// Good - functional error handling
client.call[Request, Response]("method", request)
  .handleErrorWith {
    case RateLimitError(delay) =>
      IO.sleep(delay) *> client.call[Request, Response]("method", request)
    case e => IO.raiseError(e)
  }
  .flatMap(response => IO.println(response.text))
```

## API Reference

### DotDo Trait

```scala
trait DotDo[F[_]]:
  // Untyped calls
  def call(method: String, params: Map[String, Any]): F[Json]
  def call(method: String, params: Map[String, Any], timeout: FiniteDuration): F[Json]

  // Typed calls
  def call[A: Encoder, B: Decoder](method: String, params: A): F[B]
  def callEither[A: Encoder, B: Decoder](method: String, params: A): F[Either[DotDoError, B]]

  // Streaming
  def stream(method: String, params: Map[String, Any]): Stream[F, Json]

  // Collections
  def collection(name: String): Collection[F]
  def collection[A: Encoder: Decoder](name: String): TypedCollection[F, A]

  // Pool statistics
  def poolStats: F[PoolStats]

  // Lifecycle
  def close: F[Unit]
```

### Companion Object

```scala
object DotDo:
  def resource[F[_]: Async](config: DotDoConfig): Resource[F, DotDo[F]]
  def make[F[_]: Async](config: DotDoConfig): F[DotDo[F]]
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/scala)
- [Maven Central](https://search.maven.org/artifact/do.platform/sdk_3)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [Scaladoc Reference](https://do.md/api/scala)
