# rpc.do for Scala

**High-level RPC client with managed proxies, automatic routing, and effect-polymorphic operations.**

[![Maven Central](https://img.shields.io/maven-central/v/do.rpc/sdk_3.svg?label=Maven%20Central)](https://search.maven.org/artifact/do.rpc/sdk_3)
[![Scala](https://img.shields.io/badge/scala-3.3%2B-red.svg)](https://scala-lang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

```scala
import rpc.do.*
import cats.effect.*

// Server-side map eliminates N+1 round trips
val squares: IO[List[Int]] = client.rpc
  .invoke[List[Int]]("fibonacci", 10)
  .serverMap(n => client.rpc.invoke[Int]("square", n))
  .run

// Four operations, one round trip
```

rpc.do builds on top of [capnweb](../capnweb/README.md) to provide a higher-level abstraction with managed connections, effect polymorphism, and server-side batch operations. Write expressive Scala code with Cats Effect or ZIO, and let the SDK optimize network calls for you.

**What rpc.do adds over raw capnweb:**
- **Managed Proxy** - Connection pooling, automatic reconnection, and resource-safe lifecycle
- **Automatic Routing** - Route calls to the optimal endpoint based on method signatures
- **Server-Side Operations** - Execute `map`, `filter`, and `flatMap` on the server in a single round trip
- **Effect Polymorphism** - Write once, run with Cats Effect IO, ZIO, or any `Async[F]`
- **FS2 Streaming** - First-class streaming support with backpressure
- **Given/Using Integration** - Idiomatic Scala 3 contextual abstractions

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [The Magic Proxy](#the-magic-proxy)
- [Promise Pipelining](#promise-pipelining)
- [Server-Side Operations](#server-side-operations)
- [Streaming with FS2](#streaming-with-fs2)
- [Error Handling](#error-handling)
- [Effect Polymorphism](#effect-polymorphism)
- [ZIO Integration](#zio-integration)
- [Configuration DSL](#configuration-dsl)
- [Typed Method Definitions](#typed-method-definitions)
- [Testing](#testing)
- [Migration from capnweb](#migration-from-capnweb)
- [Complete Example](#complete-example)
- [API Reference](#api-reference)

---

## Installation

### sbt

```scala
// build.sbt
val rpcDoVersion = "0.1.0"

libraryDependencies ++= Seq(
  // Core rpc.do SDK
  "do.rpc" %% "sdk" % rpcDoVersion,

  // Choose your effect system
  "do.rpc" %% "sdk-ce3" % rpcDoVersion,  // Cats Effect 3
  // OR
  "do.rpc" %% "sdk-zio" % rpcDoVersion   // ZIO 2
)
```

### Mill

```scala
def ivyDeps = Agg(
  ivy"do.rpc::sdk:0.1.0",
  ivy"do.rpc::sdk-ce3:0.1.0"  // or sdk-zio
)
```

### Maven

```xml
<dependencies>
    <!-- Core SDK -->
    <dependency>
        <groupId>do.rpc</groupId>
        <artifactId>sdk_3</artifactId>
        <version>0.1.0</version>
    </dependency>

    <!-- Cats Effect 3 integration -->
    <dependency>
        <groupId>do.rpc</groupId>
        <artifactId>sdk-ce3_3</artifactId>
        <version>0.1.0</version>
    </dependency>
</dependencies>
```

**Requirements:** Scala 3.3+, JDK 11+

---

## Quick Start

```scala
import rpc.do.*
import rpc.do.ce3.*
import cats.effect.*
import cats.syntax.all.*
import scala.concurrent.duration.*

object QuickStart extends IOApp.Simple:

  def run: IO[Unit] =
    // Resource-safe client with automatic cleanup
    RpcClient.connect[IO]("wss://api.example.do")
      .withTimeout(30.seconds)
      .withAuth(Auth.Bearer(sys.env("API_TOKEN")))
      .build
      .use { client =>
        for
          // Simple RPC call
          users <- client.call[List[User]]("users.list")
          _     <- IO.println(s"Found ${users.size} users")

          // Magic proxy syntax
          profile <- client.$.users.get("user-123").profile.settings.run
          _       <- IO.println(s"Theme: ${profile.theme}")

          // Server-side map (single round trip!)
          profiles <- client.rpc
            .invoke[List[User]]("users.list")
            .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
            .run
          _        <- IO.println(s"Loaded ${profiles.size} profiles")
        yield ()
      }

// Data models with derived codecs
case class User(id: String, name: String, email: String)
  derives io.circe.Codec.AsObject

case class Profile(userId: String, bio: String, theme: String)
  derives io.circe.Codec.AsObject
```

---

## Core Concepts

### RpcClient: The Managed Proxy

`RpcClient[F]` is the central entry point. Unlike raw capnweb which requires manual session management, `RpcClient` handles:

- **Connection pooling** - Reuses connections efficiently
- **Automatic reconnection** - Recovers from network failures with configurable backoff
- **Request queuing** - Buffers calls during reconnection
- **Timeout management** - Configurable per-call and global timeouts
- **Resource safety** - Integrates with Cats Effect `Resource` or ZIO `Scope`

```scala
import rpc.do.*
import rpc.do.ce3.*
import cats.effect.*

// Create a client with full configuration
val clientResource: Resource[IO, RpcClient[IO]] =
  RpcClient.connect[IO]("wss://api.example.do")
    .withTimeout(30.seconds)
    .withAuth(Auth.Bearer("your-token"))
    .withRetry(RetryPolicy.exponential(
      maxAttempts = 5,
      baseDelay = 100.millis,
      maxDelay = 10.seconds
    ))
    .withHeader("X-Client-Version", "1.0.0")
    .build

// Use with resource safety
clientResource.use { client =>
  for
    result <- client.call[String]("ping")
    _      <- IO.println(s"Server says: $result")
  yield ()
}

// Or use directly (caller manages lifecycle)
val client: IO[RpcClient[IO]] = RpcClient.connect[IO]("wss://api.example.do").connect
```

### Three Ways to Call: `call`, `$`, and `rpc`

rpc.do provides three patterns for making RPC calls, each optimized for different use cases:

| Method | Returns | Use When |
|--------|---------|----------|
| `call[T](method, args)` | `F[T]` directly | You need the result immediately |
| `$.path.to.method(args)` | `RpcPromise[F, T]` | You want magic proxy pipelining |
| `rpc.invoke[T](method, args)` | `RpcPromise[F, T]` | You want explicit pipelining or server-side ops |

```scala
// call[T]: Effect directly, returns value when awaited
val user: IO[User] = client.call[User]("users.get", "user-123")
val posts: IO[List[Post]] = client.call[List[Post]]("posts.list", userId)

// $.magic.proxy: Pipelined path navigation
val theme: IO[String] = client.$.users.get("123").profile.settings.theme.run
val email: IO[String] = client.$("users").get("123")("profile")("email").run

// rpc.invoke: Explicit promises for server-side operations
val promise: RpcPromise[IO, User] = client.rpc.invoke[User]("users.get", userId)
val profiles: IO[List[Profile]] = promise
  .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
  .run
```

### RpcPromise: The Pipelining Primitive

`RpcPromise[F, A]` represents a pending RPC result. It's the key to:

1. **Promise Pipelining** - Chain calls that execute in a single round trip
2. **Server-Side Batch Operations** - Map/filter/flatMap executed on the server
3. **Composable Error Handling** - Transform errors without executing

```scala
import rpc.do.*
import cats.syntax.all.*

// Create a promise
val promise: RpcPromise[IO, User] = client.rpc.invoke[User]("users.get", userId)

// Navigate through nested properties (pipelining)
val emailPromise: RpcPromise[IO, String] = promise.get("profile").get("email")
val email: IO[String] = emailPromise.run

// Chain calls
val postsPromise: RpcPromise[IO, List[Post]] = promise.chain("posts.list")
val posts: IO[List[Post]] = postsPromise.run

// Map over results (client-side)
val upperName: RpcPromise[IO, String] = promise.map(_.name.toUpperCase)

// Server-side map (single round trip!)
val enriched: IO[List[UserWithProfile]] = client.rpc
  .invoke[List[User]]("users.list")
  .serverMap(u => client.rpc.invoke[UserWithProfile]("users.enrich", u.id))
  .run

// Convert to Either for explicit error handling
val result: IO[Either[RpcError, User]] = promise.attempt.run
```

---

## The Magic Proxy

The `$` property returns a magic proxy that intercepts all property access and method calls, sending them as pipelined RPC requests.

### How It Works

```scala
val client = RpcClient.connect[IO]("wss://api.example.do").use { c => ... }

// Every property access is recorded
c.$                           // proxy
c.$.users                     // proxy with path ["users"]
c.$.users.get                 // proxy with path ["users", "get"]
c.$.users.get("123")          // RPC call to "users.get" with args ["123"]
c.$.users.get("123").profile  // pipelined: call + property access
```

The proxy doesn't know what methods exist on the server. It records the path and sends it when you call `.run`.

### Nested Access with Pipelining

Access deeply nested APIs with single round-trip execution:

```scala
// All of these work - single round trip each!
val result1: IO[User] = client.$.users.get("123").run
val result2: IO[String] = client.$.users.get("123").profile.settings.theme.run
val result3: IO[Unit] = client.$.api.v2.admin.users.deactivate(userId).run

// Chained method calls
val result4: IO[Summary] = client.$
  .documents.get(docId)
  .extractText()
  .summarize(100)
  .run
```

### Dynamic Keys with Apply

Use `apply` for dynamic property names:

```scala
val tableName = "users"
val columnName = "email"

// Dynamic path construction
val result: IO[String] = client.$(tableName).get("123")(columnName).run

// Equivalent to
val result2: IO[String] = client.$.users.get("123").email.run
```

### Typed Proxy Syntax

For compile-time safety, use typed stub derivation:

```scala
// Define your service interface
trait UserService[F[_]] derives RpcStub:
  def list(): F[List[User]]
  def get(id: String): F[User]
  def create(data: CreateUser): F[User]

// Get a typed stub
val users: UserService[IO] = client.stub[UserService]

// Full type safety
val user: IO[User] = users.get("123")
val all: IO[List[User]] = users.list()
```

---

## Promise Pipelining

Promise pipelining is the foundation of efficient RPC. When you chain property accesses or method calls on a promise, rpc.do batches them into a single network request.

### The Problem: Multiple Round Trips

```scala
// WITHOUT pipelining: 4 sequential round trips
def fetchUserThemeSlow(userId: String): IO[String] =
  for
    user     <- client.call[User]("users.get", userId)        // Round trip 1
    profile  <- client.call[Profile]("profiles.get", user.profileId) // Round trip 2
    settings <- client.call[Settings]("settings.get", profile.settingsId) // Round trip 3
    theme    =  settings.theme                                 // Local access
  yield theme
```

### The Solution: Single Round Trip

```scala
// WITH pipelining: 1 round trip
def fetchUserThemeFast(userId: String): IO[String] =
  client.$
    .users.get(userId)
    .profile
    .settings
    .theme
    .run

// Or with explicit promise API
def fetchUserThemeFast2(userId: String): IO[String] =
  client.rpc
    .invoke[User]("users.get", userId)
    .get("profile")
    .get("settings")
    .get("theme")
    .run
```

### Chained Method Calls

```scala
// Chain related operations through unresolved promises
val postWithComments: IO[PostWithComments] = client.rpc
  .invoke[Post]("posts.get", postId)
  .chain[PostWithComments]("enrichWithComments")
  .run

// Multiple transformations in single round trip
val summary: IO[String] = client.rpc
  .invoke[Document]("documents.get", docId)
  .chain[String]("extractText")
  .chain[String]("summarize", 100)  // Summarize in 100 words
  .run
```

### How Pipelining Works Under the Hood

Under the hood, rpc.do sends a single JSON expression that describes the entire pipeline:

```json
{
  "pipeline": [
    {"call": "users.get", "args": ["user-123"]},
    {"get": "profile"},
    {"get": "settings"},
    {"get": "theme"}
  ]
}
```

The server executes all operations sequentially using promise pipelining and returns only the final result.

### Parallel Pipelining

Fork a pipeline to fetch multiple things at once:

```scala
// Start with authentication
val session = client.$.authenticate(token)

// Branch into parallel requests (still batched!)
val dashboard: IO[(User, Permissions, Settings)] =
  (
    session.getUser.run,
    session.getPermissions.run,
    session.getSettings.run
  ).parTupled
```

### Pipeline Combinators

```scala
import rpc.do.pipeline.*

// Combine multiple pipelines
def fetchTodoAndComments(id: TodoId)(using client: RpcClient[IO]): IO[(Todo, List[Comment])] =
  (
    client.$.todos.get(id.value).run,
    client.$.todos.get(id.value).comments.list.run
  ).parTupled

// Traverse with pipelining - all fetches in ONE round-trip
def fetchAllAuthors(ids: List[TodoId])(using client: RpcClient[IO]): IO[List[User]] =
  ids.parTraverse { id =>
    client.$.todos.get(id.value).author.run
  }
```

---

## Server-Side Operations

**This is the killer feature.** rpc.do supports executing `map`, `filter`, and `flatMap` operations on the server, eliminating N+1 query problems entirely.

### The N+1 Problem

Traditional RPC has a fundamental issue:

```scala
// BAD: N+1 round trips
def fetchAllProfiles(using client: RpcClient[IO]): IO[List[Profile]] =
  for
    users    <- client.call[List[User]]("users.list")  // 1 round trip
    profiles <- users.traverse { user =>
      client.call[Profile]("profiles.get", user.id)    // N round trips!
    }
  yield profiles
```

For 100 users, this makes 101 network calls.

### Server-Side Map: The Solution

```scala
// GOOD: Single round trip with server-side map
def fetchAllProfiles(using client: RpcClient[IO]): IO[List[Profile]] =
  client.rpc
    .invoke[List[User]]("users.list")
    .serverMap { user =>
      client.rpc.invoke[Profile]("profiles.get", user.id)
    }
    .run
```

The `serverMap` lambda is **serialized and sent to the server**, which executes it in a single batch operation. No matter how many users, it's always one round trip.

### For-Comprehension Syntax

rpc.do provides a special `Pipeline` monad for natural for-comprehension syntax:

```scala
import rpc.do.pipeline.*

// All operations batched into a single round trip
val authorName: IO[String] = Pipeline[IO] { p =>
  for
    todo   <- p.$.todos.get("123")
    author <- p.$.users.get(todo.authorId)
  yield author.name
}.run

// Server-side map with for-comprehension
val enrichedUsers: IO[List[EnrichedUser]] = Pipeline[IO] { p =>
  p.$.users.list.serverMap { user =>
    for
      profile <- p.$.profiles.get(user.id)
      stats   <- p.$.stats.forUser(user.id)
    yield EnrichedUser(user, profile, stats)
  }
}.run
```

### Server-Side Filter

Filter items without fetching everything to the client:

```scala
// Filter users with premium subscriptions (on server)
val premiumUsers: IO[List[User]] = client.rpc
  .invoke[List[User]]("users.list")
  .serverFilter { user =>
    client.rpc.invoke[Boolean]("subscriptions.isPremium", user.id)
  }
  .run

// Find orders that need attention
val urgentOrders: IO[List[Order]] = client.rpc
  .invoke[List[Order]]("orders.all")
  .serverFilter { order =>
    client.rpc.invoke[Boolean]("orders.isUrgent", order.id)
  }
  .run
```

### Server-Side FlatMap

For operations that return lists:

```scala
// Get all comments from all posts
val allComments: IO[List[Comment]] = client.rpc
  .invoke[List[Post]]("posts.recent", 10)
  .serverFlatMap { post =>
    client.rpc.invoke[List[Comment]]("posts.comments", post.id)
  }
  .run

// Gather all tags from user's bookmarks
val allTags: IO[List[String]] = client.rpc
  .invoke[List[Bookmark]]("bookmarks.list")
  .serverFlatMap { bookmark =>
    client.rpc.invoke[List[String]]("bookmarks.tags", bookmark.id)
  }
  .run
```

### Chaining Server-Side Operations

Operations can be chained:

```scala
// Get active users, filter by premium, map to their profiles
val premiumProfiles: IO[List[Profile]] = client.rpc
  .invoke[List[User]]("users.active")
  .serverFilter { user =>
    client.rpc.invoke[Boolean]("subscriptions.isPremium", user.id)
  }
  .serverMap { user =>
    client.rpc.invoke[Profile]("profiles.detailed", user.id)
  }
  .run
```

### Real-World Example: E-Commerce Dashboard

```scala
import cats.effect.*
import cats.syntax.all.*

case class DashboardData(
  recentOrders: List[OrderWithCustomer],
  lowStockItems: List[ProductWithSupplier],
  pendingReviews: List[ReviewWithProduct]
)

def loadDashboard(using client: RpcClient[IO]): IO[DashboardData] =
  // All three run in parallel, each with server-side joins
  (
    // Recent orders with customer info
    client.rpc
      .invoke[List[Order]]("orders.recent", 10)
      .serverMap(order => client.rpc.invoke[OrderWithCustomer]("orders.withCustomer", order.id))
      .run,

    // Low stock products with supplier info
    client.rpc
      .invoke[List[Product]]("products.lowStock")
      .serverMap(product => client.rpc.invoke[ProductWithSupplier]("products.withSupplier", product.id))
      .run,

    // Pending reviews with product info
    client.rpc
      .invoke[List[Review]]("reviews.pending")
      .serverMap(review => client.rpc.invoke[ReviewWithProduct]("reviews.withProduct", review.id))
      .run
  ).parMapN(DashboardData.apply)
```

---

## Streaming with FS2

rpc.do provides first-class support for FS2 streams with backpressure handling.

### Basic Streaming

```scala
import fs2.Stream
import rpc.do.ce3.streaming.*

// Subscribe to real-time updates
def watchNotifications(userId: String)(using client: RpcClient[IO]): Stream[IO, Notification] =
  client.subscribe[Notification]("notifications.subscribe", userId)

// Process with backpressure
watchNotifications("user-123")
  .filter(_.priority >= Priority.High)
  .evalMap(notification => sendPushNotification(notification))
  .compile
  .drain
```

### Filtered Streams

```scala
// Stream only high-priority events
val highPriorityEvents: Stream[IO, Event] =
  client.subscribe[Event]("events.subscribe")
    .filter(_.priority >= Priority.High)

// Collect specific event types
val loginEvents: Stream[IO, LoginEvent] =
  client.subscribe[Event]("events.subscribe")
    .collect { case e: LoginEvent => e }
```

### Transforming Streams

```scala
// Transform stream data
val priceUpdates: Stream[IO, PriceDisplay] =
  client.subscribe[PriceTick]("market.prices", "AAPL")
    .map { tick =>
      PriceDisplay(
        symbol = tick.symbol,
        price = formatCurrency(tick.price),
        change = calculateChange(tick)
      )
    }

// Async transformation
val enrichedEvents: Stream[IO, EnrichedEvent] =
  client.subscribe[Event]("events.subscribe")
    .evalMap { event =>
      enrichEvent(event)  // Returns IO[EnrichedEvent]
    }
```

### Combining Streams

```scala
// Merge multiple streams
val combinedFeed: Stream[IO, ChatEvent] =
  client.subscribe[Message]("chat.messages", roomId)
    .merge(client.subscribe[Presence]("chat.presence", roomId))

// Process combined stream
combinedFeed.evalMap {
  case msg: Message => displayMessage(msg)
  case presence: Presence => updateUserList(presence)
}.compile.drain
```

### Bidirectional Streaming

```scala
// Bidirectional chat stream
def chatStream(
  outgoing: Stream[IO, Message]
)(using client: RpcClient[IO]): Stream[IO, Message] =
  client.bidirectional[Message, Message]("chat", outgoing)

// Usage
val userMessages: Stream[IO, Message] = Stream.eval(readUserInput).repeat
val incoming: Stream[IO, Message] = chatStream(userMessages)

incoming.evalMap(displayMessage).compile.drain
```

### Stream with Timeout and Retry

```scala
import scala.concurrent.duration.*

client.subscribe[HeartBeat]("system.heartbeat")
  .timeout(30.seconds)
  .handleErrorWith { case _: TimeoutException =>
    // Reconnect on timeout
    client.subscribe[HeartBeat]("system.heartbeat")
  }
  .evalMap(heartbeat => updateConnectionStatus(heartbeat.latency))
  .compile
  .drain
```

### Backpressure Handling

```scala
// Buffer and sample high-frequency streams
client.subscribe[SensorData]("sensors.data", sensorId)
  .through(fs2.Stream.buffer(1024))
  .metered(100.millis)  // Take one sample every 100ms
  .evalMap(data => updateSensorDisplay(data))
  .compile
  .drain
```

### Streaming to Ref/SignallingRef

```scala
import cats.effect.std.Queue
import fs2.concurrent.SignallingRef

class NotificationService(client: RpcClient[IO]):

  def start: Resource[IO, SignallingRef[IO, List[Notification]]] =
    for
      ref <- Resource.eval(SignallingRef[IO, List[Notification]](Nil))
      _   <- client.subscribe[Notification]("notifications.subscribe")
               .evalMap(n => ref.update(n :: _))
               .compile
               .drain
               .background
    yield ref

// Usage
notificationService.start.use { notifications =>
  notifications.discrete
    .evalMap(ns => updateUI(ns.take(10)))
    .compile
    .drain
}
```

---

## Error Handling

rpc.do uses a sealed error hierarchy for exhaustive pattern matching.

### Error ADT

```scala
package rpc.do.errors

enum RpcError:
  /** Connection failed to establish */
  case ConnectionFailed(url: String, cause: Option[Throwable])

  /** Method doesn't exist on server */
  case MethodNotFound(method: String)

  /** Invalid arguments passed to method */
  case InvalidArguments(method: String, reason: String)

  /** Server returned an error */
  case ServerError(code: Int, message: String, details: Option[io.circe.Json])

  /** Call timed out */
  case Timeout(method: String, duration: FiniteDuration)

  /** Client disconnected */
  case Disconnected(reason: Option[String])

  /** Permission denied */
  case PermissionDenied(operation: String, reason: Option[String])

  /** Resource not found */
  case NotFound(resource: String, id: String)

  /** Validation failed */
  case ValidationError(errors: NonEmptyList[FieldError])

case class FieldError(field: String, message: String, code: Option[String] = None)
```

### Exhaustive Pattern Matching

Scala's pattern matching ensures you handle all cases:

```scala
import rpc.do.errors.*

def handleUserFetch(userId: String)(using client: RpcClient[IO]): IO[String] =
  client.call[User]("users.get", userId).attempt.flatMap {
    case Right(user) =>
      IO.pure(s"Hello, ${user.name}!")

    case Left(RpcError.NotFound(_, id)) =>
      IO.pure(s"User $id not found")

    case Left(RpcError.PermissionDenied(op, reason)) =>
      IO.raiseError(SecurityException(s"$op denied: ${reason.getOrElse("unknown")}"))

    case Left(RpcError.Timeout(method, duration)) =>
      IO.pure(s"Request to $method timed out after $duration")

    case Left(RpcError.ServerError(code, msg, _)) =>
      code match
        case 500 => IO.pure("Server error. Please try again later.")
        case 503 => IO.pure("Service temporarily unavailable.")
        case _   => IO.pure(s"Error $code: $msg")

    case Left(RpcError.ConnectionFailed(url, _)) =>
      IO.pure(s"Cannot connect to $url. Check your network.")

    case Left(RpcError.Disconnected(_)) =>
      IO.pure("Connection lost. Reconnecting...")

    case Left(error) =>
      IO.raiseError(RuntimeException(s"Unexpected error: $error"))
  }
```

### EitherT for Explicit Error Threading

```scala
import cats.data.EitherT

type RpcIO[A] = EitherT[IO, RpcError, A]

def transactionalUpdate(
  userId: String,
  update: User => User
)(using client: RpcClient[IO]): RpcIO[User] =
  for
    existing <- EitherT(client.call[User]("users.get", userId).attempt)
    updated  <- EitherT(client.call[User]("users.update", userId, update(existing)).attempt)
  yield updated

// Usage
transactionalUpdate("user-123", _.copy(name = "New Name")).value.flatMap {
  case Right(user) => IO.println(s"Updated: ${user.name}")
  case Left(error) => IO.println(s"Failed: $error")
}
```

### MonadError with ApplicativeError

```scala
import cats.syntax.all.*
import cats.ApplicativeError

// Recover from specific errors
def safeGetUser(userId: String)(using client: RpcClient[IO]): IO[Option[User]] =
  client.call[User]("users.get", userId)
    .map(_.some)
    .recover {
      case RpcError.NotFound(_, _) => none[User]
    }

// Provide fallback
def getUserOrDefault(userId: String)(using client: RpcClient[IO]): IO[User] =
  client.call[User]("users.get", userId)
    .handleErrorWith {
      case RpcError.NotFound(_, _) => IO.pure(User.anonymous)
      case RpcError.Timeout(_, _)  => IO.pure(User.anonymous)
      case other                   => IO.raiseError(other)
    }

// Accumulate errors with parTraverse
def fetchManyUsers(ids: List[String])(using client: RpcClient[IO]): IO[List[Either[RpcError, User]]] =
  ids.parTraverse(id => client.call[User]("users.get", id).attempt)
```

### Retry with Backoff

```scala
import cats.effect.std.Random
import scala.concurrent.duration.*

def withRetry[A](
  maxAttempts: Int = 3,
  baseDelay: FiniteDuration = 100.millis
)(fa: IO[A]): IO[A] =
  def loop(attempt: Int): IO[A] =
    fa.handleErrorWith { error =>
      error match
        // Don't retry client errors
        case RpcError.NotFound(_, _) | RpcError.PermissionDenied(_, _) =>
          IO.raiseError(error)

        // Retry transient errors
        case _ if attempt < maxAttempts =>
          val delay = baseDelay * math.pow(2, attempt - 1).toLong
          IO.sleep(delay) *> loop(attempt + 1)

        case _ =>
          IO.raiseError(error)
    }

  loop(1)

// Usage
withRetry(maxAttempts = 5) {
  client.call[User]("users.get", userId)
}
```

### Circuit Breaker Pattern

```scala
import cats.effect.std.AtomicCell

class CircuitBreaker[F[_]: Temporal](
  failureThreshold: Int = 5,
  resetTimeout: FiniteDuration = 30.seconds
):
  enum State:
    case Closed(failures: Int)
    case Open(openedAt: Long)
    case HalfOpen

  private val state: AtomicCell[F, State] = ???

  def protect[A](fa: F[A]): F[A] =
    state.evalModify {
      case State.Open(openedAt) =>
        val now = System.currentTimeMillis()
        if now - openedAt > resetTimeout.toMillis then
          (State.HalfOpen, fa.attempt)
        else
          (State.Open(openedAt), Temporal[F].raiseError(CircuitOpenException()))

      case s @ State.Closed(failures) =>
        (s, fa.attempt)

      case State.HalfOpen =>
        (State.HalfOpen, fa.attempt)
    }.flatMap {
      case Right(a) =>
        state.set(State.Closed(0)).as(a)
      case Left(e) =>
        state.modify {
          case State.Closed(f) if f + 1 >= failureThreshold =>
            (State.Open(System.currentTimeMillis()), e)
          case State.Closed(f) =>
            (State.Closed(f + 1), e)
          case State.HalfOpen =>
            (State.Open(System.currentTimeMillis()), e)
          case s =>
            (s, e)
        }.flatMap(Temporal[F].raiseError)
    }

// Usage
val breaker = CircuitBreaker[IO](failureThreshold = 5, resetTimeout = 30.seconds)

breaker.protect {
  client.call[User]("users.get", userId)
}
```

---

## Effect Polymorphism

Write your RPC logic once, run with any effect system. The `F[_]` type parameter abstracts over the effect.

### Polymorphic Business Logic

```scala
import cats.Monad
import cats.syntax.all.*

// Works with IO, ZIO Task, or any Monad
def fetchDashboard[F[_]: Monad](
  client: RpcClient[F]
): F[Dashboard] =
  for
    allTodos <- client.call[List[Todo]]("todos.list")
    active   =  allTodos.filterNot(_.completed)
    authors  <- active.traverse(t => client.call[User]("users.get", t.authorId))
  yield Dashboard(active, authors.distinct)

// Instantiate with Cats Effect
val dashboardIO: IO[Dashboard] = clientResource.use(fetchDashboard[IO])

// Or with ZIO (same logic!)
val dashboardZIO: ZIO[RpcClient[Task], RpcError, Dashboard] =
  ZIO.service[RpcClient[Task]].flatMap(fetchDashboard[Task])
```

### Type Class Constraints

```scala
import cats.{Monad, Parallel}
import cats.effect.Concurrent

// Require parallel execution capability
def fetchInParallel[F[_]: Monad: Parallel](
  client: RpcClient[F]
): F[(List[Todo], List[Todo])] =
  (
    client.call[List[Todo]]("todos.list", "work"),
    client.call[List[Todo]]("todos.list", "personal")
  ).parTupled

// Require concurrency for racing
def fetchWithTimeout[F[_]: Concurrent](
  client: RpcClient[F],
  timeout: FiniteDuration
): F[List[Todo]] =
  Concurrent[F].race(
    client.call[List[Todo]]("todos.list"),
    Concurrent[F].sleep(timeout) *> Concurrent[F].raiseError(TimeoutException())
  ).map {
    case Left(todos) => todos
    case Right(_)    => Nil
  }
```

### Tagless Final Style

```scala
// Define your service algebra
trait TodoRepository[F[_]]:
  def list(category: String): F[List[Todo]]
  def get(id: TodoId): F[Todo]
  def create(title: String): F[Todo]

// RPC implementation
class RpcTodoRepository[F[_]: Async](client: RpcClient[F]) extends TodoRepository[F]:
  def list(category: String): F[List[Todo]] =
    client.call[List[Todo]]("todos.list", category)

  def get(id: TodoId): F[Todo] =
    client.call[Todo]("todos.get", id.value)

  def create(title: String): F[Todo] =
    client.call[Todo]("todos.create", title)

// Use polymorphically
def program[F[_]: Monad](repo: TodoRepository[F]): F[Unit] =
  for
    todos <- repo.list("work")
    _     <- todos.traverse_(t => println(t.title).pure[F])
  yield ()

// Wire up
clientResource.use { client =>
  program(RpcTodoRepository[IO](client))
}
```

---

## ZIO Integration

The `rpc.do-zio` module brings typed errors, ZLayer dependency injection, and ZIO-style service accessors.

### ZIO Service Pattern

```scala
import rpc.do.zio.*
import zio.*

// Service trait
trait TodoService:
  def list(category: String): IO[RpcError, List[Todo]]
  def get(id: TodoId): IO[RpcError, Todo]
  def create(title: String): IO[RpcError, Todo]

// Companion with accessor methods (ZIO style)
object TodoService:
  def list(category: String): ZIO[TodoService, RpcError, List[Todo]] =
    ZIO.serviceWithZIO[TodoService](_.list(category))

  def get(id: TodoId): ZIO[TodoService, RpcError, Todo] =
    ZIO.serviceWithZIO[TodoService](_.get(id))

  def create(title: String): ZIO[TodoService, RpcError, Todo] =
    ZIO.serviceWithZIO[TodoService](_.create(title))
```

### ZLayer Construction

```scala
import rpc.do.zio.*
import zio.*

// Client layer with automatic resource management
val clientLayer: ZLayer[Scope, RpcError, RpcClient[Task]] =
  ZLayer.scoped {
    ZIO.acquireRelease(
      RpcClient.connectZIO("wss://api.example.do")
        .withAuth(Auth.Bearer(sys.env("API_TOKEN")))
    )(_.close.orDie)
  }

// Service layers from client
val todoServiceLayer: URLayer[RpcClient[Task], TodoService] =
  ZLayer {
    for
      client <- ZIO.service[RpcClient[Task]]
    yield new TodoService:
      def list(category: String) = client.call[List[Todo]]("todos.list", category)
      def get(id: TodoId) = client.call[Todo]("todos.get", id.value)
      def create(title: String) = client.call[Todo]("todos.create", title)
  }
```

### ZIO Pipelining

```scala
import rpc.do.zio.*
import zio.*

// Unified Pipeline API
val authorName: ZIO[RpcClient[Task], RpcError, String] =
  ZIO.serviceWithZIO[RpcClient[Task]] { client =>
    Pipeline[Task] { p =>
      for
        todo   <- p.$.todos.get("123")
        author <- p.$.users.get(todo.authorId)
      yield author.name
    }.run
  }

// Server-side operations with ZIO
val enrichedUsers: ZIO[RpcClient[Task], RpcError, List[EnrichedUser]] =
  ZIO.serviceWithZIO[RpcClient[Task]] { client =>
    client.rpc
      .invoke[List[User]]("users.list")
      .serverMap(u => client.rpc.invoke[EnrichedUser]("users.enrich", u.id))
      .run
  }
```

### Typed Errors

```scala
// Errors in the type signature
def safeFetch(id: TodoId): ZIO[TodoService, RpcError.NotFound, Todo] =
  TodoService.get(id).refineOrDie {
    case e: RpcError.NotFound => e
  }

// Catch specific errors
def fetchOrNone(id: TodoId): ZIO[TodoService, Nothing, Option[Todo]] =
  TodoService.get(id)
    .map(Some(_))
    .catchSome {
      case RpcError.NotFound(_, _) => ZIO.none
    }
    .orDie

// Accumulate errors with validation
def validateMany(ids: List[TodoId]): ZIO[TodoService, ::[RpcError], List[Todo]] =
  ZIO.validatePar(ids)(TodoService.get)
```

### Full ZIO Application

```scala
import rpc.do.zio.*
import zio.*

object TodoApp extends ZIOAppDefault:

  val program: ZIO[TodoService & UserService, RpcError, Unit] =
    for
      todos  <- TodoService.list("work")
      _      <- ZIO.foreachDiscard(todos)(t => Console.printLine(t.title).orDie)
      author <- UserService.get(todos.head.authorId)
      _      <- Console.printLine(s"First by: ${author.name}").orDie
    yield ()

  def run = program.provide(
    todoServiceLayer,
    userServiceLayer,
    clientLayer,
    Scope.default
  )
```

### ZStream for Subscriptions

```scala
import zio.stream.*

def watchNotifications: ZStream[RpcClient[Task], RpcError, Notification] =
  ZStream.serviceWithStream[RpcClient[Task]](_.subscribeZIO[Notification]("notifications.subscribe"))

// Process with ZIO streams
val processNotifications: ZIO[RpcClient[Task], RpcError, Unit] =
  watchNotifications
    .tap {
      case Notification(_, msg, false) => Console.printLine(s"New: $msg").orDie
      case _ => ZIO.unit
    }
    .runDrain
```

---

## Configuration DSL

rpc.do uses a Scala 3 builder DSL for expressive configuration.

### Basic Configuration

```scala
val client: Resource[IO, RpcClient[IO]] =
  RpcClient.connect[IO]("wss://api.example.do")
    .withTimeout(30.seconds)
    .withAuth(Auth.Bearer("your-token"))
    .build
```

### Full Configuration Options

```scala
val client: Resource[IO, RpcClient[IO]] =
  RpcClient.connect[IO]("wss://api.example.do")
    // Request timeout
    .withTimeout(30.seconds)

    // Retry configuration
    .withRetry(RetryPolicy.exponential(
      maxAttempts = 5,
      baseDelay = 100.millis,
      maxDelay = 10.seconds
    ))

    // Authentication
    .withAuth(Auth.Bearer("your-token"))

    // Custom headers
    .withHeader("X-Client-Version", "1.0.0")
    .withHeader("X-Platform", "scala")
    .withHeader("X-Request-ID", java.util.UUID.randomUUID().toString)

    // Transport options
    .withCodec(MessageCodec.json)
    .withCompression(Compression.gzip)

    // Build as Resource
    .build
```

### Authentication Options

```scala
enum Auth:
  case Bearer(token: String)
  case ApiKey(key: String, header: String = "X-API-Key")
  case Basic(username: String, password: String)
  case Custom(headers: Map[String, String])
  case OAuth2(
    clientId: String,
    clientSecret: String,
    tokenUrl: String
  )

// Usage
RpcClient.connect[IO]("wss://api.example.do")
  .withAuth(Auth.Bearer("token"))
  // or
  .withAuth(Auth.ApiKey("key", "X-API-Key"))
  // or
  .withAuth(Auth.Basic("user", "pass"))
  // or
  .withAuth(Auth.Custom(Map(
    "X-Custom-Auth" -> "value",
    "X-Tenant-ID" -> "tenant-123"
  )))
```

### Retry Policies

```scala
// Exponential backoff with jitter
RetryPolicy.exponential(
  maxAttempts = 5,
  baseDelay = 100.millis,
  maxDelay = 10.seconds
)

// Fixed delay
RetryPolicy.fixed(maxAttempts = 3, delay = 1.second)

// No retries
RetryPolicy.none

// Custom retry logic
RetryPolicy.custom { (error, attempt) =>
  error match
    case RpcError.ServerError(code, _, _) if code >= 500 =>
      Some(100.millis * math.pow(2, attempt).toLong)
    case RpcError.Timeout(_, _) =>
      Some(1.second)
    case _ =>
      None  // Don't retry
}
```

### Environment-Based Configuration

```scala
enum Environment:
  case Development, Staging, Production

def createClient(env: Environment): Resource[IO, RpcClient[IO]] =
  val baseConfig = RpcClient.connect[IO](env match
    case Environment.Development => "ws://localhost:8080/rpc"
    case Environment.Staging     => "wss://staging.api.example.do"
    case Environment.Production  => "wss://api.example.do"
  )

  val configured = env match
    case Environment.Development =>
      baseConfig
        .withTimeout(60.seconds)  // Longer for debugging
        .withHeader("X-Debug", "true")
        .withRetry(RetryPolicy.none)

    case Environment.Staging =>
      baseConfig
        .withTimeout(30.seconds)
        .withHeader("X-Environment", "staging")
        .withRetry(RetryPolicy.exponential(maxAttempts = 3))

    case Environment.Production =>
      baseConfig
        .withTimeout(15.seconds)
        .withHeader("X-Environment", "production")
        .withRetry(RetryPolicy.exponential(maxAttempts = 5))

  configured
    .withAuth(Auth.Bearer(sys.env(s"API_TOKEN_${env.toString.toUpperCase}")))
    .build
```

---

## Typed Method Definitions

For compile-time safety, define your RPC methods using the type-safe builder.

### Defining Methods

```scala
import rpc.do.typed.*

// Define typed methods
object UserMethods:
  val list = method[List[User]]("users.list")
  val get = method[User]("users.get")
  val create = method[User]("users.create")
  val update = method[User]("users.update")
  val delete = method[Unit]("users.delete")

object PostMethods:
  val list = method[List[Post]]("posts.list")
  val get = method[Post]("posts.get")
  val create = method[Post]("posts.create")
  val byAuthor = method[List[Post]]("posts.byAuthor")
```

### Using Typed Methods

```scala
// Type-safe calls
val users: IO[List[User]] = client.call(UserMethods.list)
val user: IO[User] = client.call(UserMethods.get, userId)
val newUser: IO[User] = client.call(UserMethods.create, userData)

// Type-safe promises
val userPromise: RpcPromise[IO, User] = client.rpc.invoke(UserMethods.get, userId)
val postsPromise: RpcPromise[IO, List[Post]] = client.rpc.invoke(PostMethods.byAuthor, userId)
```

### Grouping Methods

```scala
// Group related methods
object Api:
  object Users:
    val list = method[List[User]]("users.list")
    val get = method[User]("users.get")
    val create = method[User]("users.create")
    val update = method[User]("users.update")
    val delete = method[Unit]("users.delete")

    object Profile:
      val get = method[Profile]("users.profile.get")
      val update = method[Profile]("users.profile.update")

  object Posts:
    val list = method[List[Post]]("posts.list")
    val get = method[Post]("posts.get")
    val create = method[Post]("posts.create")

    object Comments:
      val list = method[List[Comment]]("posts.comments.list")
      val add = method[Comment]("posts.comments.add")

  object Notifications:
    val list = method[List[Notification]]("notifications.list")
    val markRead = method[Unit]("notifications.markRead")

// Usage
val user: IO[User] = client.call(Api.Users.get, userId)
val profile: IO[Profile] = client.call(Api.Users.Profile.get, userId)
val posts: IO[List[Post]] = client.call(Api.Posts.list)
val comments: IO[List[Comment]] = client.call(Api.Posts.Comments.list, postId)
```

### Service Trait Derivation

For even more type safety, use trait-based service definitions:

```scala
// Define service trait
trait TodoService[F[_]] derives RpcStub:
  def list(category: String): F[List[Todo]]
  def get(id: TodoId): F[Todo]
  def create(title: String, category: String): F[Todo]
  def update(id: TodoId, todo: Todo): F[Todo]
  def delete(id: TodoId): F[Unit]
  def comments(todoId: TodoId): F[CommentService[F]]  // Returns capability

trait CommentService[F[_]] derives RpcStub:
  def list: F[List[Comment]]
  def add(text: String): F[Comment]

// Usage
val todos: TodoService[IO] = client.stub[TodoService]
val comments: IO[CommentService[IO]] = todos.comments(todoId)

// Full type safety
val todo: IO[Todo] = todos.get(TodoId("123"))
val all: IO[List[Todo]] = todos.list("work")
```

---

## Testing

### Unit Testing with Mocks

```scala
import cats.effect.testing.scalatest.AsyncIOSpec
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AsyncWordSpec
import org.scalamock.scalatest.AsyncMockFactory

class UserServiceSpec extends AsyncWordSpec with AsyncIOSpec with Matchers with AsyncMockFactory:

  "UserService" should:
    "fetch user by id" in:
      val mockClient = mock[RpcClient[IO]]

      (mockClient.call[User](_: String, _: Any*))
        .expects("users.get", Seq("user-123"))
        .returning(IO.pure(User("user-123", "Alice", "alice@example.com")))

      val service = UserService[IO](mockClient)

      service.get(UserId("user-123")).asserting { user =>
        user.name shouldBe "Alice"
      }

    "handle not found error" in:
      val mockClient = mock[RpcClient[IO]]

      (mockClient.call[User](_: String, _: Any*))
        .expects("users.get", *)
        .returning(IO.raiseError(RpcError.NotFound("user", "invalid")))

      val service = UserService[IO](mockClient)

      service.get(UserId("invalid")).attempt.asserting { result =>
        result shouldBe Left(RpcError.NotFound("user", "invalid"))
      }
```

### Integration Testing with Test Server

```scala
import rpc.do.testing.*
import cats.effect.*

class RpcClientIntegrationSpec extends CatsEffectSuite:

  val clientFixture = ResourceSuiteLocalFixture(
    "client",
    TestServer.create[IO]
      .withHandler("users.get") { args =>
        val userId = args.head.asString.get
        IO.pure(User(userId, "Test User", "test@example.com"))
      }
      .withHandler("users.list") { _ =>
        IO.pure(List(
          User("1", "Alice", "alice@example.com"),
          User("2", "Bob", "bob@example.com")
        ))
      }
      .build
  )

  override def munitFixtures = List(clientFixture)

  test("call returns parsed response"):
    val client = clientFixture()

    client.call[User]("users.get", "123").map { user =>
      assertEquals(user.name, "Test User")
    }

  test("server-side map executes in single batch"):
    val client = clientFixture()

    client.rpc
      .invoke[List[User]]("users.list")
      .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
      .run
      .map { profiles =>
        assertEquals(profiles.size, 2)
      }
```

### Testing Server-Side Operations

```scala
class ServerSideMapSpec extends CatsEffectSuite:

  test("serverMap executes server-side batch operation"):
    TestServer.create[IO]
      .withHandler("users.list") { _ =>
        IO.pure(List(
          User("1", "Alice", "alice@example.com"),
          User("2", "Bob", "bob@example.com")
        ))
      }
      .withHandler("profiles.get") { args =>
        val userId = args.head.asString.get
        IO.pure(Profile(userId, s"Bio for $userId"))
      }
      .withBatchAssertion { calls =>
        // Verify the map was batched into a single call
        assertEquals(calls.size, 1)
        assert(calls.head.method.startsWith("remap"))
      }
      .build
      .use { client =>
        client.rpc
          .invoke[List[User]]("users.list")
          .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
          .run
          .map { profiles =>
            assertEquals(profiles.size, 2)
          }
      }
```

### Testing Streams

```scala
import fs2.Stream

class StreamingSpec extends CatsEffectSuite:

  test("stream emits values from server"):
    val testNotifications = List(
      Notification("1", "Hello"),
      Notification("2", "World")
    )

    TestServer.create[IO]
      .withStreamHandler[Notification]("notifications.subscribe") { _ =>
        Stream.emits(testNotifications)
      }
      .build
      .use { client =>
        client.subscribe[Notification]("notifications.subscribe")
          .compile
          .toList
          .map { notifications =>
            assertEquals(notifications, testNotifications)
          }
      }

  test("stream handles errors gracefully"):
    TestServer.create[IO]
      .withStreamHandler[Notification]("notifications.subscribe") { _ =>
        Stream.emit(Notification("1", "First")) ++
          Stream.raiseError[IO](RpcError.Disconnected(None))
      }
      .build
      .use { client =>
        client.subscribe[Notification]("notifications.subscribe")
          .handleErrorWith(_ => Stream.empty)
          .compile
          .toList
          .map { notifications =>
            assertEquals(notifications.size, 1)
          }
      }
```

### Property-Based Testing

```scala
import org.scalacheck.effect.PropF
import org.scalacheck.Gen

class RpcPropertySpec extends CatsEffectSuite with ScalaCheckEffectSuite:

  val userGen: Gen[User] = for
    id    <- Gen.uuid.map(_.toString)
    name  <- Gen.alphaNumStr.map(_.take(50))
    email <- Gen.alphaNumStr.map(s => s"$s@example.com")
  yield User(id, name, email)

  test("roundtrip serialization preserves data"):
    PropF.forAllF(userGen) { user =>
      TestServer.create[IO]
        .withHandler("users.echo") { args =>
          IO.pure(args.head.as[User].getOrElse(throw new Exception("Invalid user")))
        }
        .build
        .use { client =>
          client.call[User]("users.echo", user).map { echoed =>
            assertEquals(echoed, user)
          }
        }
    }
```

---

## Migration from capnweb

If you're migrating from raw capnweb to rpc.do, here's what changes:

### Connection Management

```scala
// Before (capnweb)
val session: Resource[IO, Session[IO]] =
  Session.websocket[IO]("wss://api.example.com/rpc")
    .withTimeout(30.seconds)
    .build

session.use { s =>
  val api = s.stub[TodoService]
  api.list("work")
}

// After (rpc.do)
val client: Resource[IO, RpcClient[IO]] =
  RpcClient.connect[IO]("wss://api.example.com")
    .withTimeout(30.seconds)
    .build

client.use { c =>
  c.call[List[Todo]]("todos.list", "work")
  // Or with magic proxy
  c.$.todos.list("work").run
}
```

### Making Calls

```scala
// Before (capnweb) - typed interface required
val todos: IO[List[Todo]] = api.list("work")
val name: IO[String] = Pipeline[IO] { p =>
  for
    todo   <- p.stub[TodoService].getById(TodoId("123"))
    author <- p.stub[UserService].getById(todo.authorId)
  yield author.name
}.run

// After (rpc.do) - method name as string, magic proxy, or typed
val todos: IO[List[Todo]] = client.call[List[Todo]]("todos.list", "work")
val name: IO[String] = client.$.todos.get("123").author.name.run
// Or with typed methods
val name: IO[String] = client.call(Api.Todos.get, "123").flatMap(t =>
  client.call(Api.Users.get, t.authorId).map(_.name)
)
```

### Server-Side Operations

```scala
// Before (capnweb) - Manual batching required
val profiles: IO[List[Profile]] =
  for
    users    <- session.stub[UserService].list()
    profiles <- users.parTraverse(u => session.stub[ProfileService].get(u.id))
  yield profiles
// This makes N+1 calls!

// After (rpc.do) - Native server-side support
val profiles: IO[List[Profile]] = client.rpc
  .invoke[List[User]]("users.list")
  .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
  .run
// Single round trip!
```

### Pipelining

```scala
// Before (capnweb) - Pipeline monad
val name: IO[String] = Pipeline[IO] { p =>
  for
    todo   <- p.stub[TodoService].getById(id)
    author <- p.stub[UserService].getById(todo.authorId)
  yield author.name
}.run

// After (rpc.do) - Magic proxy or explicit
val name: IO[String] = client.$.todos.get(id.value).author.name.run
// Or
val name: IO[String] = client.rpc
  .invoke[Todo]("todos.get", id.value)
  .get("author")
  .get("name")
  .run
```

### Error Handling

```scala
// Before (capnweb)
api.getById(id).attempt.flatMap {
  case Right(todo) => ...
  case Left(RpcError.NotFound(_, id)) => ...
}

// After (rpc.do) - Same pattern, different error types
client.call[Todo]("todos.get", id).attempt.flatMap {
  case Right(todo) => ...
  case Left(RpcError.NotFound(_, id)) => ...
  case Left(RpcError.ServerError(404, _, _)) => ...
}
```

### When to Use Each

| Use Case | Recommendation |
|----------|----------------|
| Full typed API with interfaces | capnweb with `derives RpcStub` |
| Dynamic method calls | rpc.do magic proxy |
| Server-side batch operations | rpc.do |
| Maximum type safety | capnweb |
| Quick prototyping | rpc.do |
| Complex nested pipelining | capnweb Pipeline monad |
| Existing capnweb codebase | Keep capnweb, add rpc.do for serverMap |

---

## Complete Example

Here's a comprehensive example showing all features together.

```scala
//> using scala 3.3
//> using dep do.rpc::sdk-ce3:0.1.0

import rpc.do.*
import rpc.do.ce3.*
import rpc.do.ce3.streaming.*
import cats.effect.*
import cats.syntax.all.*
import fs2.Stream
import io.circe.{Encoder, Decoder}
import io.circe.generic.semiauto.*
import scala.concurrent.duration.*

// Data Models
case class User(id: String, name: String, email: String) derives Encoder.AsObject, Decoder
case class Post(id: String, title: String, authorId: String) derives Encoder.AsObject, Decoder
case class Comment(id: String, postId: String, text: String) derives Encoder.AsObject, Decoder
case class Profile(userId: String, bio: String, avatarUrl: String) derives Encoder.AsObject, Decoder
case class Notification(id: String, message: String, read: Boolean) derives Encoder.AsObject, Decoder

// Typed Method Definitions
object Api:
  object Users:
    val list = method[List[User]]("users.list")
    val get = method[User]("users.get")
    val isActive = method[Boolean]("users.isActive")
    val hasPosts = method[Boolean]("users.hasPosts")

  object Posts:
    val list = method[List[Post]]("posts.list")
    val recent = method[List[Post]]("posts.recent")
    val get = method[Post]("posts.get")
    val byAuthor = method[List[Post]]("posts.byAuthor")

  object Profiles:
    val get = method[Profile]("profiles.get")

  object Comments:
    val byPost = method[List[Comment]]("comments.byPost")

// Main Application
object CompleteExample extends IOApp.Simple:

  def run: IO[Unit] =
    // Create client with configuration
    RpcClient.connect[IO]("wss://api.example.do")
      .withTimeout(30.seconds)
      .withAuth(Auth.Bearer(sys.env.getOrElse("API_TOKEN", "demo-token")))
      .withRetry(RetryPolicy.exponential(maxAttempts = 3))
      .withHeader("X-Client", "scala-example")
      .build
      .use { client =>
        for
          // 1. Simple calls
          _ <- IO.println("=== Simple Calls ===")
          users <- client.call(Api.Users.list)
          _ <- IO.println(s"Found ${users.size} users")

          // 2. Magic proxy pipelining
          _ <- IO.println("\n=== Magic Proxy Pipelining ===")
          firstUserProfile <- client.$.users.get(users.head.id).profile.run
          _ <- IO.println(s"First user profile: $firstUserProfile")

          // 3. Server-side map (eliminates N+1)
          _ <- IO.println("\n=== Server-Side Map ===")
          allProfiles <- client.rpc
            .invoke[List[User]]("users.list")
            .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
            .run
          _ <- IO.println(s"Fetched ${allProfiles.size} profiles in single round trip")

          // 4. Server-side filter
          _ <- IO.println("\n=== Server-Side Filter ===")
          activeUsers <- client.rpc
            .invoke[List[User]]("users.list")
            .serverFilter(u => client.rpc.invoke[Boolean]("users.isActive", u.id))
            .run
          _ <- IO.println(s"Found ${activeUsers.size} active users")

          // 5. Server-side flatMap
          _ <- IO.println("\n=== Server-Side FlatMap ===")
          allComments <- client.rpc
            .invoke[List[Post]]("posts.recent", 5)
            .serverFlatMap(post => client.rpc.invoke[List[Comment]]("comments.byPost", post.id))
            .run
          _ <- IO.println(s"Found ${allComments.size} comments across 5 posts")

          // 6. Chained server-side operations
          _ <- IO.println("\n=== Chained Operations ===")
          enrichedPosts <- client.rpc
            .invoke[List[User]]("users.list")
            .serverFilter(u => client.rpc.invoke[Boolean]("users.isActive", u.id))
            .serverFilter(u => client.rpc.invoke[Boolean]("users.hasPosts", u.id))
            .serverFlatMap(u => client.rpc.invoke[List[Post]]("posts.byAuthor", u.id))
            .run
          _ <- IO.println(s"Found ${enrichedPosts.size} posts from active users")

          // 7. Parallel loading with Cats Effect
          _ <- IO.println("\n=== Parallel Loading ===")
          (usersResult, postsResult, profilesResult) <- (
            client.call[List[User]]("users.list"),
            client.call[List[Post]]("posts.recent", 10),
            client.rpc
              .invoke[List[User]]("users.list")
              .serverMap(u => client.rpc.invoke[Profile]("profiles.get", u.id))
              .run
          ).parTupled
          _ <- IO.println(s"Loaded ${usersResult.size} users, ${postsResult.size} posts, ${profilesResult.size} profiles")

          // 8. Error handling
          _ <- IO.println("\n=== Error Handling ===")
          _ <- client.call[User]("users.get", "nonexistent-id").attempt.flatMap {
            case Right(user) =>
              IO.println(s"Found user: ${user.name}")
            case Left(RpcError.NotFound(resource, id)) =>
              IO.println(s"Not found: $resource with id $id")
            case Left(RpcError.ServerError(code, msg, _)) =>
              IO.println(s"Server error $code: $msg")
            case Left(error) =>
              IO.println(s"Error: $error")
          }

          // 9. Either-based handling
          _ <- IO.println("\n=== Either-Based Handling ===")
          displayName <- client.rpc
            .invoke[User]("users.get", "maybe-exists")
            .attempt
            .run
            .map {
              case Right(user) => user.name
              case Left(_)     => "Unknown User"
            }
          _ <- IO.println(s"Display name: $displayName")

          // 10. Streaming (subscribe to notifications)
          _ <- IO.println("\n=== Streaming ===")
          _ <- client.subscribe[Notification]("notifications.subscribe")
            .take(3)  // Just take first 3 for demo
            .evalMap(n => IO.println(s"Notification: ${n.message}"))
            .compile
            .drain
            .timeout(5.seconds)
            .handleError(_ => ())

          _ <- IO.println("\n=== Complete ===")
        yield ()
      }

// Expected output:
// === Simple Calls ===
// Found 42 users
//
// === Magic Proxy Pipelining ===
// First user profile: Profile(u1, Hello!, https://...)
//
// === Server-Side Map ===
// Fetched 42 profiles in single round trip
//
// === Server-Side Filter ===
// Found 28 active users
//
// === Server-Side FlatMap ===
// Found 156 comments across 5 posts
//
// === Chained Operations ===
// Found 87 posts from active users
//
// === Parallel Loading ===
// Loaded 42 users, 10 posts, 42 profiles
//
// === Error Handling ===
// Not found: user with id nonexistent-id
//
// === Either-Based Handling ===
// Display name: Unknown User
//
// === Streaming ===
// Notification: New comment on your post
// Notification: Someone followed you
// Notification: Your post was liked
//
// === Complete ===
```

---

## API Reference

### RpcClient

| Method | Description |
|--------|-------------|
| `connect[F](url)` | Create a new RPC client builder |
| `call[T](method, args*)` | Make an RPC call and return `F[T]` directly |
| `rpc.invoke[T](method, args*)` | Create an `RpcPromise[F, T]` for pipelining |
| `$.path.to.method(args)` | Magic proxy for pipelined path navigation |
| `stub[S]` | Get a typed stub for service `S` |
| `subscribe[T](topic, args*)` | Create an `fs2.Stream[F, T]` for subscriptions |
| `close` | Close the client and release resources |

### RpcClientBuilder

| Method | Description |
|--------|-------------|
| `withTimeout(duration)` | Set request timeout |
| `withAuth(auth)` | Set authentication |
| `withRetry(policy)` | Configure retry behavior |
| `withHeader(name, value)` | Add a custom header |
| `withCodec(codec)` | Set message codec |
| `build` | Build as `Resource[F, RpcClient[F]]` |
| `connect` | Build as `F[RpcClient[F]]` (caller manages lifecycle) |

### RpcPromise

| Method | Description |
|--------|-------------|
| `run` | Execute the promise and return `F[A]` |
| `get(property)` | Navigate to a property (pipelining) |
| `chain[B](method, args*)` | Chain another RPC call |
| `map[B](f: A => B)` | Transform the result (client-side) |
| `flatMap[B](f: A => RpcPromise[F, B])` | Chain promises |
| `serverMap[B](f: A => RpcPromise[F, B])` | Server-side map for `List[A]` |
| `serverFilter(f: A => RpcPromise[F, Boolean])` | Server-side filter for `List[A]` |
| `serverFlatMap[B](f: A => RpcPromise[F, List[B]])` | Server-side flatMap for `List[A]` |
| `attempt` | Convert to `RpcPromise[F, Either[RpcError, A]]` |

### Pipeline

| Method | Description |
|--------|-------------|
| `Pipeline[F](f: PipelineContext => ...)` | Create a pipeline with for-comprehension support |
| `run` | Execute the pipeline |

### Auth

| Type | Description |
|------|-------------|
| `Bearer(token)` | Bearer token authentication |
| `ApiKey(key, header)` | API key in custom header |
| `Basic(user, pass)` | HTTP Basic authentication |
| `Custom(headers)` | Custom headers |

### RetryPolicy

| Factory | Description |
|---------|-------------|
| `exponential(max, base, maxDelay)` | Exponential backoff with jitter |
| `fixed(max, delay)` | Fixed delay between attempts |
| `none` | No retries |
| `custom(f)` | Custom retry logic |

### RpcError

| Type | Description |
|------|-------------|
| `ConnectionFailed` | Failed to establish connection |
| `MethodNotFound` | RPC method doesn't exist |
| `InvalidArguments` | Invalid arguments passed |
| `ServerError` | Server returned an error |
| `Timeout` | Request timed out |
| `Disconnected` | Client disconnected |
| `PermissionDenied` | Permission denied |
| `NotFound` | Resource not found |
| `ValidationError` | Validation failed |

### Typed Methods

| Function | Description |
|----------|-------------|
| `method[T](name)` | Define a typed RPC method |
| `client.call(method, args*)` | Call a typed method |
| `client.rpc.invoke(method, args*)` | Invoke a typed method for pipelining |

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](../capnweb/README.md) | The underlying RPC protocol implementation |
| [mongo.do](../mongo/README.md) | MongoDB client built on rpc.do |
| [kafka.do](../kafka/README.md) | Kafka client built on rpc.do |
| [database.do](../database/README.md) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Effect polymorphism** | Write once, run with Cats Effect or ZIO |
| **Server-side operations** | `serverMap`, `serverFilter`, `serverFlatMap` for single round-trips |
| **Magic when you want it** | `client.$.anything.you.want()` just works |
| **Types when you need them** | Full Scala 3 type safety with `derives` |
| **Functional composition** | For-comprehensions, ADT errors, Resource safety |
| **Streaming first** | FS2 and ZStream support with backpressure |

---

## License

MIT

---

*rpc.do for Scala: Server-side operations, effect polymorphism, single round trips.*
