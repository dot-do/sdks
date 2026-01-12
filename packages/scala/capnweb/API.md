# Cap'n Web Scala Client Library - API Design

**Package:** `com.dotdo.capnweb`
**Scala Version:** 3.3+
**Design Philosophy:** *Elegant composition through algebraic effects and for-comprehensions*

---

## Design Principles

This API converges the best elements from functional Scala traditions into a cohesive design:

1. **Effect-Polymorphic Core** - Write once, run with any effect system
2. **For-Comprehensions First** - Pipelining composes naturally via `flatMap`
3. **Algebraic Data Types** - Errors and messages as sealed hierarchies
4. **Contextual Abstractions** - Given instances flow implicitly
5. **Zero-Cost Abstractions** - Opaque types for protocol identifiers

---

## Quick Start

```scala
import capnweb.*
import capnweb.syntax.all.*

// Connect and call
Session.websocket[IO]("wss://api.example.com/rpc").use { session =>
  for
    api   <- session.stub[TodoService]
    todos <- api.list("work")
    _     <- IO.println(s"Found ${todos.size} items")
  yield ()
}
```

---

## Core Types

### Protocol Identifiers

```scala
package capnweb

// Zero-cost type-safe identifiers
opaque type ImportId = Int
opaque type ExportId = Int
opaque type PromiseId = Int

object ImportId:
  def apply(n: Int): ImportId = n
  extension (id: ImportId) def value: Int = id

object ExportId:
  def apply(n: Int): ExportId = n
  extension (id: ExportId) def value: Int = id
```

### Expressions (Cap'n Web Protocol)

```scala
package capnweb.protocol

import io.circe.Json

enum Expression:
  case Literal(value: Json)
  case ArrayExpr(elements: List[Expression])
  case ObjectExpr(fields: List[(String, Expression)])
  case Import(id: ImportId, path: List[String], args: Option[List[Expression]])
  case Pipeline(base: Expression, path: List[String], args: Option[List[Expression]])
  case Export(id: ExportId)
  case Promise(id: PromiseId)
```

### Messages

```scala
enum Message:
  case Push(expression: Expression)
  case Pull(importId: ImportId)
  case Resolve(exportId: ExportId, value: Expression)
  case Reject(exportId: ExportId, error: Expression)
  case Release(importId: ImportId, refcount: Int)
  case Abort(reason: Expression)
```

---

## Session Management

### Resource-Safe Sessions

```scala
package capnweb

import cats.effect.*

trait Session[F[_]]:
  /** Obtain a typed stub for a remote service */
  def stub[S](using RpcStub[S]): F[S[F]]

  /** Obtain a stub at a specific import path */
  def stubAt[S](path: String*)(using RpcStub[S]): F[S[F]]

  /** Export a local implementation as an RPC target */
  def export[S](name: String, impl: S)(using RpcTarget[S]): F[ExportId]

  /** Create a pipelining context for batched operations */
  def pipeline: Pipeline[F]

  /** Subscribe to a topic pattern */
  def subscribe(pattern: String): fs2.Stream[F, Message]

object Session:
  /** WebSocket session builder */
  def websocket[F[_]: Async](url: String): SessionBuilder[F] =
    SessionBuilder(url, Transport.WebSocket)

  /** HTTP batch session builder */
  def http[F[_]: Async](url: String): SessionBuilder[F] =
    SessionBuilder(url, Transport.HttpBatch)
```

### Session Builder (Fluent Configuration)

```scala
case class SessionBuilder[F[_]: Async](
  url: String,
  transport: Transport.Type,
  config: SessionConfig = SessionConfig.default
):
  def withTimeout(d: FiniteDuration): SessionBuilder[F] =
    copy(config = config.copy(timeout = d))

  def withAuth(auth: Auth): SessionBuilder[F] =
    copy(config = config.copy(auth = Some(auth)))

  def withRetry(policy: RetryPolicy): SessionBuilder[F] =
    copy(config = config.copy(retry = policy))

  def withCodec[C: MessageCodec]: SessionBuilder[F] =
    copy(config = config.copy(codec = summon[MessageCodec[C]]))

  /** Build as a Resource for safe lifecycle management */
  def build: Resource[F, Session[F]]

  /** Connect without resource management (caller manages lifecycle) */
  def connect: F[Session[F]]

case class SessionConfig(
  timeout: FiniteDuration = 30.seconds,
  auth: Option[Auth] = None,
  retry: RetryPolicy = RetryPolicy.exponential(3),
  codec: MessageCodec[?] = MessageCodec.json
)

enum Auth:
  case Bearer(token: String)
  case ApiKey(key: String, header: String = "X-API-Key")
  case Basic(username: String, password: String)
  case Custom(headers: Map[String, String])
```

---

## Defining Remote Interfaces

### Trait-Based Interface Definition

```scala
package capnweb

/** Marker trait for RPC service interfaces */
trait RpcService

/** Type class for stub derivation */
trait RpcStub[S]:
  def create[F[_]: Async](session: Session[F], path: List[String]): S[F]

object RpcStub:
  /** Derive stub implementation from trait definition */
  inline given derived[S <: RpcService]: RpcStub[S] = ${ deriveMacro[S] }
```

### Example: Todo Service

```scala
import capnweb.*

// Service trait - parameterized by effect type F[_]
trait TodoService[F[_]] extends RpcService:
  def list(category: String): F[List[Todo]]
  def getById(id: TodoId): F[Todo]
  def create(title: String, category: String): F[Todo]
  def update(id: TodoId, todo: Todo): F[Todo]
  def delete(id: TodoId): F[Unit]

  // Capability - returns another service
  def comments(todoId: TodoId): F[CommentService[F]]

trait CommentService[F[_]] extends RpcService:
  def list: F[List[Comment]]
  def add(text: String, author: String): F[Comment]
  def delete(id: CommentId): F[Unit]

trait UserService[F[_]] extends RpcService:
  def getById(id: UserId): F[User]
  def profile(userId: UserId): F[UserProfile]
```

### Data Types with Derived Codecs

```scala
import capnweb.codec.*
import io.circe.{Encoder, Decoder}

// Opaque type aliases for type safety
opaque type TodoId = String
opaque type CommentId = String
opaque type UserId = String

object TodoId:
  def apply(s: String): TodoId = s
  given Encoder[TodoId] = Encoder.encodeString
  given Decoder[TodoId] = Decoder.decodeString

// Domain models with derived JSON codecs
case class Todo(
  id: TodoId,
  title: String,
  completed: Boolean,
  category: String,
  authorId: UserId
) derives Encoder.AsObject, Decoder

case class Comment(
  id: CommentId,
  todoId: TodoId,
  text: String,
  author: String,
  createdAt: Instant
) derives Encoder.AsObject, Decoder

case class User(
  id: UserId,
  name: String,
  email: String
) derives Encoder.AsObject, Decoder

case class UserProfile(
  user: User,
  avatarUrl: Option[String],
  bio: Option[String]
) derives Encoder.AsObject, Decoder
```

---

## Making RPC Calls

### Sequential Calls with For-Comprehensions

```scala
import cats.effect.*
import cats.syntax.all.*

def fetchTodoWithAuthor(
  todos: TodoService[IO],
  users: UserService[IO],
  id: TodoId
): IO[(Todo, User)] =
  for
    todo   <- todos.getById(id)
    author <- users.getById(todo.authorId)
  yield (todo, author)

def fetchTodoDetails(
  todos: TodoService[IO],
  users: UserService[IO],
  id: TodoId
): IO[TodoDetails] =
  for
    todo     <- todos.getById(id)
    comments <- todos.comments(id).flatMap(_.list)
    author   <- users.getById(todo.authorId)
  yield TodoDetails(todo, comments, author)
```

### Parallel Calls

```scala
// Parallel with parTupled
def fetchDashboard(api: TodoService[IO]): IO[(List[Todo], List[Todo])] =
  (api.list("work"), api.list("personal")).parTupled

// Parallel with parTraverse
def fetchAllTodos(api: TodoService[IO], ids: List[TodoId]): IO[List[Todo]] =
  ids.parTraverse(api.getById)

// Racing - first to complete wins
def fetchWithFallback(
  primary: TodoService[IO],
  fallback: TodoService[IO],
  id: TodoId
): IO[Todo] =
  IO.race(primary.getById(id), fallback.getById(id)).map(_.merge)
```

---

## Pipelining

The crown jewel of Cap'n Web: composing operations through unresolved promises
for **single round-trip execution**.

### The Pipeline Monad

```scala
package capnweb.pipeline

/**
 * A Pipeline represents a computation over RPC promises that can be
 * composed via flatMap before execution. All operations are batched
 * and sent as a single request.
 */
sealed trait Pipeline[F[_], A]:
  def map[B](f: A => B): Pipeline[F, B]
  def flatMap[B](f: A => Pipeline[F, B]): Pipeline[F, B]
  def as[B](b: B): Pipeline[F, B] = map(_ => b)
  def void: Pipeline[F, Unit] = as(())

  /** Execute the pipeline, sending all batched operations */
  def run(using session: Session[F]): F[A]

object Pipeline:
  /** Lift a pure value into Pipeline */
  def pure[F[_], A](a: A): Pipeline[F, A] = Pure(a)

  /** Lift an effect into Pipeline (executes before pipeline runs) */
  def liftF[F[_], A](fa: F[A]): Pipeline[F, A] = LiftF(fa)

  /** Combine pipelines in parallel (for independent operations) */
  def parTupled[F[_], A, B](
    pa: Pipeline[F, A],
    pb: Pipeline[F, B]
  ): Pipeline[F, (A, B)]

  given [F[_]]: Monad[Pipeline[F, _]] with
    def pure[A](a: A) = Pipeline.pure(a)
    def flatMap[A, B](fa: Pipeline[F, A])(f: A => Pipeline[F, B]) = fa.flatMap(f)
    def tailRecM[A, B](a: A)(f: A => Pipeline[F, Either[A, B]]) = ???
```

### Pipeline-Enabled Stubs

```scala
/** Extension to create pipeline-enabled stub */
extension [F[_]: Async, S <: RpcService](stub: S[F])
  def pipelined(using session: Session[F]): S[Pipeline[F, _]] =
    session.pipeline.stub[S]

/** Or directly from session */
extension [F[_]: Async](session: Session[F])
  def pipelined[S <: RpcService](using RpcStub[S]): S[Pipeline[F, _]] =
    session.pipeline.stub[S]
```

### Pipelining in Action

```scala
// WITHOUT pipelining: 3 sequential round trips
def fetchAuthorNameSlow(
  todos: TodoService[IO],
  users: UserService[IO],
  id: TodoId
): IO[String] =
  for
    todo    <- todos.getById(id)           // Round trip 1
    author  <- users.getById(todo.authorId) // Round trip 2
    profile <- users.profile(author.id)     // Round trip 3
  yield profile.user.name

// WITH pipelining: SINGLE round trip!
def fetchAuthorNameFast(
  id: TodoId
)(using session: Session[IO]): IO[String] =
  val todos = session.pipelined[TodoService]
  val users = session.pipelined[UserService]

  (for
    todo    <- todos.getById(id)            // Promise, not executed
    author  <- users.getById(todo.authorId) // Chained through promise
    profile <- users.profile(author.id)     // Further chaining
  yield profile.user.name).run              // NOW executes everything
```

### Complex Pipeline Patterns

```scala
// Branching pipelines
def fetchTodoAndComments(id: TodoId)(using Session[IO]): IO[(Todo, List[Comment])] =
  val todos = session.pipelined[TodoService]

  (for
    todo     <- todos.getById(id)
    comments <- todos.comments(id).flatMap(_.pipelined.list)
  yield (todo, comments)).run

// Parallel within pipeline
def fetchMultipleAuthors(ids: List[TodoId])(using Session[IO]): IO[List[User]] =
  val todos = session.pipelined[TodoService]
  val users = session.pipelined[UserService]

  Pipeline.parTraverse(ids) { id =>
    for
      todo   <- todos.getById(id)
      author <- users.getById(todo.authorId)
    yield author
  }.run

// Conditional pipelining with access paths
def fetchAuthorIfComplete(id: TodoId)(using Session[IO]): IO[Option[String]] =
  val todos = session.pipelined[TodoService]
  val users = session.pipelined[UserService]

  (for
    todo <- todos.getById(id)
    name <- Pipeline.whenA(todo.completed) {
      users.getById(todo.authorId).map(_.name)
    }
  yield name).run
```

### Pipeline Syntax Sugar

```scala
package capnweb.syntax

import capnweb.pipeline.*

/** Implicit class for fluent pipeline access */
extension [F[_]: Async, A](pipeline: Pipeline[F, A])
  /** Chain through a field access */
  def ~>[B](path: A => B): Pipeline[F, B] =
    pipeline.access(path)

  /** Chain through a method call */
  def >>=[B](f: A => Pipeline[F, B]): Pipeline[F, B] =
    pipeline.flatMap(f)

// Fluent API style
val authorName: IO[String] =
  todos.pipelined
    .getById(TodoId("123"))
    .~>(_.authorId)
    .>>=(users.pipelined.getById)
    .~>(_.name)
    .run
```

---

## Error Handling

### Error ADT

```scala
package capnweb.errors

enum RpcError:
  /** Resource not found */
  case NotFound(resource: String, id: String)

  /** Permission denied for operation */
  case PermissionDenied(operation: String, reason: Option[String])

  /** Input validation failed */
  case ValidationError(errors: NonEmptyList[FieldError])

  /** Transport layer failure */
  case TransportError(cause: Throwable)

  /** Operation timed out */
  case Timeout(operation: String, duration: FiniteDuration)

  /** Server-side error */
  case ServerError(code: Int, message: String, details: Option[Json])

  /** Protocol violation */
  case ProtocolError(message: String)

case class FieldError(field: String, message: String, code: Option[String] = None)
```

### Error Handling Patterns

```scala
import cats.data.EitherT
import cats.syntax.all.*

// Type alias for RPC operations with typed errors
type RpcIO[A] = EitherT[IO, RpcError, A]

// Pattern matching on errors
def safeFetch(api: TodoService[IO], id: TodoId): IO[Option[Todo]] =
  api.getById(id)
    .map(_.some)
    .recover {
      case RpcError.NotFound(_, _) => none[Todo]
    }

// Explicit error type via attempt
def handleErrors(api: TodoService[IO], id: TodoId): IO[String] =
  api.getById(id).attempt.flatMap {
    case Right(todo) =>
      IO.pure(s"Found: ${todo.title}")
    case Left(RpcError.NotFound(_, id)) =>
      IO.pure(s"Todo $id not found")
    case Left(RpcError.PermissionDenied(op, reason)) =>
      IO.raiseError(SecurityException(s"$op denied: ${reason.getOrElse("unknown")}"))
    case Left(RpcError.Timeout(op, duration)) =>
      IO.pure(s"Operation $op timed out after $duration")
    case Left(e) =>
      IO.raiseError(RuntimeException(e.toString))
  }

// EitherT for explicit error threading
def transactionalUpdate(
  api: TodoService[RpcIO],
  id: TodoId,
  update: Todo => Todo
): RpcIO[Todo] =
  for
    existing <- api.getById(id)
    updated  <- api.update(id, update(existing))
  yield updated

// Recovering with fallback
def fetchWithFallback(
  api: TodoService[IO],
  id: TodoId,
  fallback: Todo
): IO[Todo] =
  api.getById(id).handleErrorWith {
    case RpcError.NotFound(_, _) => IO.pure(fallback)
    case RpcError.Timeout(_, _) => IO.pure(fallback)
    case e => IO.raiseError(e)
  }
```

### Retry Policies

```scala
package capnweb.retry

import cats.effect.*
import scala.concurrent.duration.*

trait RetryPolicy:
  def shouldRetry(error: RpcError, attempt: Int): Boolean
  def delay(attempt: Int): FiniteDuration

object RetryPolicy:
  /** Exponential backoff with jitter */
  def exponential(
    maxAttempts: Int,
    baseDelay: FiniteDuration = 100.millis,
    maxDelay: FiniteDuration = 10.seconds
  ): RetryPolicy = new RetryPolicy:
    def shouldRetry(error: RpcError, attempt: Int) =
      attempt < maxAttempts && isRetryable(error)

    def delay(attempt: Int) =
      (baseDelay * math.pow(2, attempt).toLong).min(maxDelay)

  /** Fixed delay between attempts */
  def fixed(maxAttempts: Int, delay: FiniteDuration): RetryPolicy

  /** No retries */
  val none: RetryPolicy = new RetryPolicy:
    def shouldRetry(error: RpcError, attempt: Int) = false
    def delay(attempt: Int) = Duration.Zero

  private def isRetryable(error: RpcError): Boolean = error match
    case RpcError.TransportError(_) => true
    case RpcError.Timeout(_, _) => true
    case RpcError.ServerError(code, _, _) if code >= 500 => true
    case _ => false

// Extension for retry operations
extension [F[_]: Temporal, A](fa: F[A])
  def withRetry(policy: RetryPolicy): F[A] =
    fs2.Stream.retry(fa, policy.delay(0), identity, policy.maxAttempts)
      .compile.lastOrError
```

---

## Exposing Local Objects as RPC Targets

### Target Type Class

```scala
package capnweb.target

/** Type class for exposing local implementations as RPC targets */
trait RpcTarget[S]:
  def dispatch[F[_]: Async](
    impl: S,
    method: String,
    args: List[Expression]
  ): F[Expression]

object RpcTarget:
  /** Derive target dispatcher from trait implementation */
  inline given derived[S <: RpcService]: RpcTarget[S] = ${ deriveTargetMacro[S] }
```

### Implementing Services

```scala
import capnweb.*
import capnweb.target.*
import cats.effect.*

// Implement the trait directly with IO effects
class LocalTodoService(db: Database[IO]) extends TodoService[IO]:
  def list(category: String): IO[List[Todo]] =
    db.query[Todo](sql"SELECT * FROM todos WHERE category = $category")

  def getById(id: TodoId): IO[Todo] =
    db.queryOne[Todo](sql"SELECT * FROM todos WHERE id = ${id.value}")
      .flatMap {
        case Some(todo) => IO.pure(todo)
        case None => IO.raiseError(RpcError.NotFound("todo", id.value))
      }

  def create(title: String, category: String): IO[Todo] =
    val todo = Todo(
      id = TodoId(UUID.randomUUID().toString),
      title = title,
      completed = false,
      category = category,
      authorId = UserId("system") // Would come from auth context
    )
    db.insert(todo).as(todo)

  def update(id: TodoId, todo: Todo): IO[Todo] =
    db.update(todo).as(todo)

  def delete(id: TodoId): IO[Unit] =
    db.delete[Todo](id.value)

  // Return a capability - automatically exported
  def comments(todoId: TodoId): IO[CommentService[IO]] =
    IO.pure(LocalCommentService(db, todoId))

class LocalCommentService(db: Database[IO], todoId: TodoId) extends CommentService[IO]:
  def list: IO[List[Comment]] =
    db.query[Comment](sql"SELECT * FROM comments WHERE todo_id = ${todoId.value}")

  def add(text: String, author: String): IO[Comment] =
    val comment = Comment(
      id = CommentId(UUID.randomUUID().toString),
      todoId = todoId,
      text = text,
      author = author,
      createdAt = Instant.now()
    )
    db.insert(comment).as(comment)

  def delete(id: CommentId): IO[Unit] =
    db.delete[Comment](id.value)
```

### Exporting Services

```scala
// Export to session
Session.websocket[IO]("wss://api.example.com/rpc").use { session =>
  for
    db       <- Database.connect[IO](dbConfig)
    todoSvc  =  LocalTodoService(db)
    userSvc  =  LocalUserService(db)

    // Export services - clients can now call them
    _        <- session.export("todos", todoSvc)
    _        <- session.export("users", userSvc)

    // Keep session alive
    _        <- IO.never
  yield ()
}
```

---

## Effect System Integration

### Cats Effect Module (`capnweb-ce3`)

```scala
package capnweb.ce3

import cats.effect.*
import cats.syntax.all.*
import fs2.Stream

// Primary entry point for Cats Effect users
object CapnWeb:
  def session(url: String): Resource[IO, Session[IO]] =
    Session.websocket[IO](url).build

// Stream-based subscriptions
extension [F[_]: Async](session: Session[F])
  def subscribeStream(pattern: String): Stream[F, Message] =
    session.subscribe(pattern)

  def broadcastStream(topic: String): fs2.Pipe[F, Message, Unit] =
    _.evalMap(msg => session.broadcast(topic, msg))
```

### ZIO Module (`capnweb-zio`)

```scala
package capnweb.zio

import zio.*

// ZLayer for dependency injection
object CapnWeb:
  val live: ZLayer[Scope, SessionError, Session] =
    ZLayer.scoped {
      ZIO.acquireRelease(
        Session.connect("wss://api.example.com/rpc")
      )(_.close.orDie)
    }

  def layer(url: String): ZLayer[Scope, SessionError, Session] =
    ZLayer.scoped {
      ZIO.acquireRelease(Session.connect(url))(_.close.orDie)
    }

// Typed error integration
type RpcIO[+A] = ZIO[Session, RpcError, A]

// Accessor pattern
object TodoService:
  def list(category: String): RpcIO[List[Todo]] =
    ZIO.serviceWithZIO[Session](_.stub[TodoService].flatMap(_.list(category)))
```

---

## Complete Example

```scala
import capnweb.*
import capnweb.syntax.all.*
import capnweb.pipeline.*
import cats.effect.*
import cats.syntax.all.*

object TodoApp extends IOApp.Simple:

  val sessionResource: Resource[IO, Session[IO]] =
    Session.websocket[IO]("wss://api.example.com/rpc")
      .withTimeout(30.seconds)
      .withAuth(Auth.Bearer(sys.env("API_TOKEN")))
      .withRetry(RetryPolicy.exponential(3))
      .build

  def run: IO[Unit] = sessionResource.use { session =>
    given Session[IO] = session

    for
      // Get stubs
      todos <- session.stub[TodoService]
      users <- session.stub[UserService]

      // Fetch dashboard data in parallel
      (work, personal) <- (todos.list("work"), todos.list("personal")).parTupled

      // Display summary
      _ <- IO.println(s"Work: ${work.size} items, Personal: ${personal.size} items")

      // Pipelined fetch of first work item's author (single round trip)
      authorName <- (for
        todo   <- session.pipelined[TodoService].getById(work.head.id)
        author <- session.pipelined[UserService].getById(todo.authorId)
      yield author.name).run

      _ <- IO.println(s"First work item by: $authorName")

      // Create a new todo
      newTodo <- todos.create("Review PR", "work")
      _ <- IO.println(s"Created: ${newTodo.title}")

      // Add a comment (capability returned from method)
      commentSvc <- todos.comments(newTodo.id)
      comment <- commentSvc.add("LGTM!", "reviewer")
      _ <- IO.println(s"Added comment: ${comment.text}")

    yield ()
  }
```

---

## Module Structure

```
com.dotdo.capnweb
  |-- core/           # Protocol, expressions, messages
  |-- Session         # Session trait and builder
  |-- RpcService      # Service marker trait
  |-- RpcStub         # Stub derivation type class
  |
  |-- pipeline/       # Pipeline monad and combinators
  |   |-- Pipeline    # The core Pipeline[F, A] type
  |   |-- syntax      # Extension methods and operators
  |
  |-- target/         # Local implementation exports
  |   |-- RpcTarget   # Target type class
  |
  |-- errors/         # Error ADT and handling
  |   |-- RpcError    # Sealed error hierarchy
  |   |-- retry/      # Retry policies
  |
  |-- codec/          # Serialization
  |   |-- MessageCodec
  |   |-- given instances for common types
  |
  |-- syntax/         # Extension methods
      |-- all         # Import all syntax

capnweb-ce3           # Cats Effect 3 integration
capnweb-zio           # ZIO 2 integration
capnweb-pekko         # Apache Pekko integration
```

---

## SBT Configuration

```scala
// build.sbt
val capnwebVersion = "1.0.0"

// Core library (effect-polymorphic)
libraryDependencies += "com.dotdo" %% "capnweb" % capnwebVersion

// Choose your effect system integration
libraryDependencies += "com.dotdo" %% "capnweb-ce3" % capnwebVersion   // Cats Effect 3
libraryDependencies += "com.dotdo" %% "capnweb-zio" % capnwebVersion   // ZIO 2
libraryDependencies += "com.dotdo" %% "capnweb-pekko" % capnwebVersion // Apache Pekko
```

---

## Design Rationale

### Why Effect-Polymorphic?

The `F[_]` type parameter allows library users to choose their preferred effect system
without forcing a particular runtime. Teams using Cats Effect, ZIO, or even Monix can
all use the same core API.

### Why For-Comprehensions for Pipelining?

Scala's `for` syntax provides a natural notation for sequential composition. By making
`Pipeline[F, A]` a monad, we get pipelining "for free" through `flatMap` chains:

```scala
// This for-comprehension:
for
  a <- getA()
  b <- getB(a)
  c <- getC(b)
yield c

// Desugars to:
getA().flatMap(a => getB(a).flatMap(b => getC(b).map(c => c)))
```

Each `flatMap` in a Pipeline adds to the operation queue rather than executing.
The entire chain executes on `.run`.

### Why Opaque Types for IDs?

Opaque types provide zero-cost type safety. `ImportId`, `ExportId`, `TodoId` etc.
are all `Int` or `String` at runtime but distinct types at compile time:

```scala
val importId: ImportId = ImportId(1)
val exportId: ExportId = ExportId(1)

// importId == exportId  // Compile error! Different types
```

### Why ADT for Errors?

Algebraic data types with sealed hierarchies enable:
1. Exhaustive pattern matching (compiler warns on missing cases)
2. Type-safe error handling without exceptions
3. Clear documentation of all possible failure modes

---

## Summary

This API design brings together:

- **For-comprehensions** for natural sequential composition
- **Pipeline monad** for single-round-trip batched operations
- **Effect polymorphism** via `F[_]` type parameter
- **Type classes** (`RpcStub`, `RpcTarget`) for derivation
- **ADTs** for protocol messages and errors
- **Opaque types** for zero-cost type safety
- **Resource safety** via Cats Effect `Resource`
- **Given instances** for contextual configuration

The result is an API that feels native to Scala, leverages the language's
strengths in functional programming, and makes the power of Cap'n Web's
pipelining accessible through familiar patterns.

*"Beautiful code is code that reveals its intent through its structure."*
