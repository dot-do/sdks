# Cap'n Web for Scala

**Capability-based RPC with effect polymorphism and pipelining monads.**

[![Maven Central](https://img.shields.io/maven-central/v/com.dotdo/capnweb_3.svg)](https://search.maven.org/artifact/com.dotdo/capnweb_3)

```scala
import capnweb.*
import cats.effect.*

// One round trip. Not three.
val authorName: IO[String] =
  Pipeline[IO] { p =>
    for
      todo   <- p.stub[TodoService].getById("123")
      author <- p.stub[UserService].getById(todo.authorId)
    yield author.name
  }.run
```

Cap'n Web brings capability-based RPC to Scala with first-class support for **effect polymorphism**, **pipeline monads**, and **functional composition**. Chain calls through unresolved promises. Compose with for-comprehensions. Handle errors as values.

**Key differentiators:**
- **Effect polymorphic** - Write once, run with Cats Effect or ZIO
- **Pipeline monad** - For-comprehensions that compile to single round-trips
- **Opaque types** - Zero-cost type-safe identifiers
- **Scala 3 first** - `derives`, `given`/`using`, union types, enums

---

## Installation

### sbt

```scala
// Core library (effect-agnostic)
libraryDependencies += "com.dotdo" %% "capnweb" % "1.0.0"

// Choose your effect system
libraryDependencies += "com.dotdo" %% "capnweb-ce3" % "1.0.0"   // Cats Effect 3
libraryDependencies += "com.dotdo" %% "capnweb-zio" % "1.0.0"   // ZIO 2
```

### Mill

```scala
def ivyDeps = Agg(
  ivy"com.dotdo::capnweb:1.0.0",
  ivy"com.dotdo::capnweb-ce3:1.0.0"  // or capnweb-zio
)
```

### Maven

```xml
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-ce3_3</artifactId>
    <version>1.0.0</version>
</dependency>
```

**Requirements**: Scala 3.3+, JDK 11+

---

## Quick Start

### Define Your Types

```scala
import capnweb.*
import io.circe.{Encoder, Decoder}

// Domain models with derived codecs
case class Todo(
  id: TodoId,
  title: String,
  completed: Boolean,
  authorId: UserId
) derives Encoder.AsObject, Decoder

case class User(
  id: UserId,
  name: String,
  email: String
) derives Encoder.AsObject, Decoder

// Opaque type-safe identifiers (zero runtime cost)
opaque type TodoId = String
object TodoId:
  def apply(s: String): TodoId = s
  extension (id: TodoId) def value: String = id
  given Encoder[TodoId] = Encoder.encodeString
  given Decoder[TodoId] = Decoder.decodeString

opaque type UserId = String
object UserId:
  def apply(s: String): UserId = s
  extension (id: UserId) def value: String = id
  given Encoder[UserId] = Encoder.encodeString
  given Decoder[UserId] = Decoder.decodeString
```

### Define Service Traits

Services are parameterized by effect type `F[_]`:

```scala
// Effect-polymorphic service traits
trait TodoService[F[_]] extends RpcService:
  def list(category: String): F[List[Todo]]
  def getById(id: TodoId): F[Todo]
  def create(title: String): F[Todo]
  def comments(todoId: TodoId): F[CommentService[F]]  // Returns a capability

trait UserService[F[_]] extends RpcService:
  def getById(id: UserId): F[User]
  def profile(userId: UserId): F[UserProfile]

trait CommentService[F[_]] extends RpcService:
  def list: F[List[Comment]]
  def add(text: String): F[Comment]
```

### Connect and Call (Cats Effect)

```scala
import capnweb.*
import capnweb.ce3.*
import cats.effect.*
import cats.syntax.all.*

object Main extends IOApp.Simple:

  val session: Resource[IO, Session[IO]] =
    Session.websocket[IO]("wss://api.example.com/rpc")
      .withTimeout(30.seconds)
      .withAuth(Auth.Bearer(sys.env("API_TOKEN")))
      .build

  def run: IO[Unit] = session.use { s =>
    given Session[IO] = s

    for
      todos <- s.stub[TodoService].list("work")
      users <- s.stub[UserService]

      // Parallel fetch with Cats syntax
      (work, personal) <- (
        s.stub[TodoService].list("work"),
        s.stub[TodoService].list("personal")
      ).parTupled

      _ <- IO.println(s"Found ${work.size + personal.size} todos")

      // Pipelined fetch (single round-trip!)
      authorName <- Pipeline[IO] { p =>
        for
          todo   <- p.stub[TodoService].getById(work.head.id)
          author <- p.stub[UserService].getById(todo.authorId)
        yield author.name
      }.run

      _ <- IO.println(s"First item by $authorName")
    yield ()
  }
```

---

## The Pipeline Monad

Cap'n Web's killer feature is **promise pipelining**: make calls through promises before they resolve. The `Pipeline[F, A]` monad batches operations into a single network round-trip.

### Without Pipelining: Three Round Trips

```scala
// Each flatMap waits for the network - three round trips!
def fetchAuthorName(id: TodoId)(using s: Session[IO]): IO[String] =
  for
    todo    <- s.stub[TodoService].getById(id)           // Round trip 1
    author  <- s.stub[UserService].getById(todo.authorId) // Round trip 2
    profile <- s.stub[UserService].profile(author.id)     // Round trip 3
  yield profile.name
```

### With Pipelining: One Round Trip

```scala
// The entire for-comprehension executes in ONE round trip
def fetchAuthorName(id: TodoId)(using s: Session[IO]): IO[String] =
  Pipeline[IO] { p =>
    for
      todo    <- p.stub[TodoService].getById(id)
      author  <- p.stub[UserService].getById(todo.authorId)
      profile <- p.stub[UserService].profile(author.id)
    yield profile.name
  }.run
```

### How It Works

Each operation inside `Pipeline` returns a `Pipelined[A]` - a description of a call, not an executed call. The `flatMap` chains these descriptions together. Only when you call `.run` does the entire batch get sent to the server.

```scala
// Conceptually:
Pipeline[IO] { p =>
  for
    todo   <- p.stub[TodoService].getById(id)    // Pipelined[Todo]
    author <- p.stub[UserService].getById(todo.authorId)  // Pipelined[User]
  yield author.name
}
// Type: Pipeline[IO, String]
// Calling .run sends: getById(id).authorId |> getById |> .name
```

The server evaluates the chain using the result of each step, without round-trip delays between steps.

### Pipeline Combinators

```scala
import capnweb.pipeline.*

// Parallel within a pipeline
def fetchTodoWithComments(id: TodoId)(using Session[IO]): IO[(Todo, List[Comment])] =
  Pipeline[IO] { p =>
    val todoP = p.stub[TodoService].getById(id)
    val commentsP = p.stub[TodoService].comments(id).flatMap(_.list)
    (todoP, commentsP).tupled
  }.run

// Traverse with pipelining - all fetches in ONE round-trip
def fetchAllAuthors(ids: List[TodoId])(using Session[IO]): IO[List[User]] =
  Pipeline[IO] { p =>
    ids.traverse { id =>
      for
        todo   <- p.stub[TodoService].getById(id)
        author <- p.stub[UserService].getById(todo.authorId)
      yield author
    }
  }.run

// Map over pipeline results
def fetchTodoTitle(id: TodoId)(using Session[IO]): IO[String] =
  Pipeline[IO] { p =>
    p.stub[TodoService].getById(id).map(_.title.toUpperCase)
  }.run
```

### What Cannot Be Pipelined

Conditional logic that depends on resolved values requires a new round-trip:

```scala
// This requires TWO round-trips (correct behavior!)
def fetchAuthorIfComplete(id: TodoId)(using Session[IO]): IO[Option[String]] =
  for
    todo <- Pipeline[IO](_.stub[TodoService].getById(id)).run  // Round trip 1
    name <- if todo.completed then
              Pipeline[IO](_.stub[UserService].getById(todo.authorId).map(u => Some(u.name))).run
            else
              IO.pure(None)  // Round trip 2 (only if completed)
  yield name
```

Pipelining works when the server can evaluate the entire chain without client decisions. If your logic branches based on values, you need separate pipelines.

---

## Effect Polymorphism

Write your RPC logic once, run it with any effect system. The `F[_]` type parameter abstracts over the effect.

### Polymorphic Business Logic

```scala
import cats.Monad
import cats.syntax.all.*

// Works with IO, ZIO, or any Monad
def fetchDashboard[F[_]: Monad](
  todos: TodoService[F],
  users: UserService[F]
): F[Dashboard] =
  for
    allTodos <- todos.list("all")
    active   =  allTodos.filterNot(_.completed)
    authors  <- active.traverse(t => users.getById(t.authorId))
  yield Dashboard(active, authors.distinct)

// Instantiate with Cats Effect
val dashboardIO: IO[Dashboard] = session.use { s =>
  fetchDashboard(s.stub[TodoService], s.stub[UserService])
}

// Or with ZIO (same logic!)
val dashboardZIO: ZIO[Session, RpcError, Dashboard] =
  ZIO.serviceWithZIO[Session] { s =>
    fetchDashboard(s.stub[TodoService], s.stub[UserService])
  }
```

### Type Class Constraints

```scala
import cats.{Monad, Parallel}
import cats.effect.Concurrent

// Require parallel execution capability
def fetchInParallel[F[_]: Monad: Parallel](
  todos: TodoService[F]
): F[(List[Todo], List[Todo])] =
  (todos.list("work"), todos.list("personal")).parTupled

// Require concurrency for racing
def fetchWithTimeout[F[_]: Concurrent](
  todos: TodoService[F],
  timeout: FiniteDuration
): F[List[Todo]] =
  Concurrent[F].race(
    todos.list("all"),
    Concurrent[F].sleep(timeout) *> Concurrent[F].raiseError(TimeoutError())
  ).map(_.merge)
```

---

## Cats Effect Integration

The `capnweb-ce3` module provides idiomatic Cats Effect support.

### Resource-Safe Sessions

```scala
import capnweb.ce3.*
import cats.effect.*

val session: Resource[IO, Session[IO]] =
  Session.websocket[IO]("wss://api.example.com/rpc")
    .withTimeout(30.seconds)
    .withRetry(RetryPolicy.exponential(maxAttempts = 3))
    .build

// Automatic cleanup on completion or error
session.use { s =>
  for
    api <- IO.pure(s.stub[TodoService])
    _   <- api.list("work").flatMap(IO.println)
  yield ()
}
```

### Streaming with fs2

```scala
import fs2.Stream
import capnweb.ce3.streaming.*

// Subscribe to events
def watchTodos(using s: Session[IO]): Stream[IO, TodoEvent] =
  s.subscribe[TodoEvent]("todos.*")

// Process with backpressure
watchTodos
  .filter(_.eventType == "created")
  .evalMap(event => sendNotification(event.todo))
  .compile
  .drain

// Bidirectional streaming
def chatStream(
  outgoing: Stream[IO, Message]
)(using s: Session[IO]): Stream[IO, Message] =
  s.bidirectional[Message, Message]("chat", outgoing)
```

### Pipelining with Cats Effect

```scala
import capnweb.ce3.*
import cats.effect.*

// The unified Pipeline API
def example(using s: Session[IO]): IO[String] =
  Pipeline[IO] { p =>
    for
      todo   <- p.stub[TodoService].getById(TodoId("123"))
      author <- p.stub[UserService].getById(todo.authorId)
    yield author.name
  }.run

// Parallel pipelines
def parallelPipelines(using s: Session[IO]): IO[(String, Int)] =
  (
    Pipeline[IO](_.stub[TodoService].getById(TodoId("1")).map(_.title)).run,
    Pipeline[IO](_.stub[CommentService].list.map(_.size)).run
  ).parTupled
```

---

## ZIO Integration

The `capnweb-zio` module brings typed errors, ZLayer dependency injection, and ZIO-style service accessors.

### ZIO Service Pattern

Define services with companion object accessors:

```scala
import capnweb.zio.*
import zio.*

// Service trait
trait TodoService:
  def list(category: String): IO[RpcError, List[Todo]]
  def getById(id: TodoId): IO[RpcError, Todo]
  def create(title: String): IO[RpcError, Todo]

// Companion with accessor methods (ZIO style)
object TodoService:
  def list(category: String): ZIO[TodoService, RpcError, List[Todo]] =
    ZIO.serviceWithZIO[TodoService](_.list(category))

  def getById(id: TodoId): ZIO[TodoService, RpcError, Todo] =
    ZIO.serviceWithZIO[TodoService](_.getById(id))

  def create(title: String): ZIO[TodoService, RpcError, Todo] =
    ZIO.serviceWithZIO[TodoService](_.create(title))

// Same pattern for UserService
trait UserService:
  def getById(id: UserId): IO[RpcError, User]

object UserService:
  def getById(id: UserId): ZIO[UserService, RpcError, User] =
    ZIO.serviceWithZIO[UserService](_.getById(id))
```

### ZLayer Construction

```scala
import capnweb.zio.*
import zio.*

// Session layer with automatic resource management
val sessionLayer: ZLayer[Scope, SessionError, Session] =
  ZLayer.scoped {
    ZIO.acquireRelease(
      Session.connect("wss://api.example.com/rpc")
        .withAuth(Auth.Bearer(sys.env("API_TOKEN")))
    )(_.close.orDie)
  }

// Service layers from session
val todoServiceLayer: URLayer[Session, TodoService] =
  ZLayer {
    ZIO.serviceWith[Session](_.stub[TodoService])
  }

val userServiceLayer: URLayer[Session, UserService] =
  ZLayer {
    ZIO.serviceWith[Session](_.stub[UserService])
  }
```

### ZIO Pipelining

```scala
import capnweb.zio.*
import zio.*

// Unified Pipeline API (same as Cats Effect!)
val authorName: ZIO[Session, RpcError, String] =
  ZIO.serviceWithZIO[Session] { s =>
    Pipeline[Task] { p =>
      for
        todo   <- p.stub[TodoService].getById(TodoId("123"))
        author <- p.stub[UserService].getById(todo.authorId)
      yield author.name
    }.run
  }

// Or use the ZIO-specific syntax
val authorNameAlt: ZIO[Session, RpcError, String] =
  Session.pipelined { p =>
    for
      todo   <- p.stub[TodoService].getById(TodoId("123"))
      author <- p.stub[UserService].getById(todo.authorId)
    yield author.name
  }
```

### Typed Errors

```scala
// Errors in the type signature
def safeFetch(id: TodoId): ZIO[TodoService, RpcError.NotFound, Todo] =
  TodoService.getById(id).refineOrDie {
    case e: RpcError.NotFound => e
  }

// Catch specific errors
def fetchOrNone(id: TodoId): ZIO[TodoService, Nothing, Option[Todo]] =
  TodoService.getById(id)
    .map(Some(_))
    .catchSome {
      case RpcError.NotFound(_, _) => ZIO.none
    }
    .orDie

// Accumulate errors with validation
def validateMany(ids: List[TodoId]): ZIO[TodoService, ::[RpcError], List[Todo]] =
  ZIO.validatePar(ids)(TodoService.getById)
```

### Full ZIO Application

```scala
import capnweb.zio.*
import zio.*

object TodoApp extends ZIOAppDefault:

  val program: ZIO[TodoService & UserService, RpcError, Unit] =
    for
      todos  <- TodoService.list("work")
      _      <- ZIO.foreachDiscard(todos)(t => Console.printLine(t.title).orDie)
      author <- UserService.getById(todos.head.authorId)
      _      <- Console.printLine(s"First by: ${author.name}").orDie
    yield ()

  def run = program.provide(
    todoServiceLayer,
    userServiceLayer,
    sessionLayer,
    Scope.default
  )
```

---

## Workflow Orchestration

Cap'n Web excels at complex multi-step workflows that would otherwise require many round-trips.

### Order Processing Workflow

```scala
import capnweb.*
import cats.effect.*

trait OrderService[F[_]] extends RpcService:
  def create(items: List[Item]): F[Order]
  def validate(orderId: OrderId): F[ValidationResult]

trait PaymentService[F[_]] extends RpcService:
  def authorize(orderId: OrderId, amount: BigDecimal): F[PaymentAuth]
  def capture(authId: AuthId): F[Payment]

trait InventoryService[F[_]] extends RpcService:
  def reserve(orderId: OrderId, items: List[Item]): F[Reservation]
  def commit(reservationId: ReservationId): F[Unit]

trait ShippingService[F[_]] extends RpcService:
  def createLabel(orderId: OrderId, address: Address): F[ShippingLabel]

// Complex workflow - all setup in ONE round-trip!
def processOrder(items: List[Item], address: Address)(using s: Session[IO]): IO[OrderResult] =
  for
    // Pipeline 1: Create order and get capabilities
    (order, validation, reservation) <- Pipeline[IO] { p =>
      for
        order       <- p.stub[OrderService].create(items)
        validation  <- p.stub[OrderService].validate(order.id)
        reservation <- p.stub[InventoryService].reserve(order.id, items)
      yield (order, validation, reservation)
    }.run

    // Client-side validation (requires resolved data)
    _ <- IO.raiseUnless(validation.isValid)(ValidationError(validation.errors))

    // Pipeline 2: Payment and shipping (depends on order)
    (payment, label) <- Pipeline[IO] { p =>
      for
        auth    <- p.stub[PaymentService].authorize(order.id, order.total)
        payment <- p.stub[PaymentService].capture(auth.id)
        _       <- p.stub[InventoryService].commit(reservation.id)
        label   <- p.stub[ShippingService].createLabel(order.id, address)
      yield (payment, label)
    }.run

  yield OrderResult(order, payment, label)
```

### Saga Pattern with Compensation

```scala
import cats.effect.*
import cats.syntax.all.*

def orderSaga(items: List[Item])(using s: Session[IO]): IO[Either[SagaError, Order]] =
  (for
    // Step 1: Reserve inventory
    reservation <- Pipeline[IO](_.stub[InventoryService].reserve(items)).run
      .onError(_ => IO.unit)  // No compensation needed yet

    // Step 2: Process payment (compensate by releasing inventory on failure)
    payment <- Pipeline[IO](_.stub[PaymentService].charge(items.map(_.price).sum)).run
      .onError(_ => Pipeline[IO](_.stub[InventoryService].release(reservation.id)).run.attempt.void)

    // Step 3: Create order (compensate by refunding and releasing)
    order <- Pipeline[IO](_.stub[OrderService].create(items, payment.id, reservation.id)).run
      .onError { _ =>
        (
          Pipeline[IO](_.stub[PaymentService].refund(payment.id)).run,
          Pipeline[IO](_.stub[InventoryService].release(reservation.id)).run
        ).parTupled.attempt.void
      }

  yield order).attempt.map(_.leftMap(SagaError(_)))
```

---

## Events and Subscriptions

Cap'n Web supports bidirectional event streaming.

### Subscribing to Events (Cats Effect)

```scala
import capnweb.ce3.streaming.*
import fs2.Stream

// Typed event subscription
sealed trait TodoEvent derives Encoder, Decoder
case class TodoCreated(todo: Todo) extends TodoEvent
case class TodoCompleted(id: TodoId) extends TodoEvent
case class TodoDeleted(id: TodoId) extends TodoEvent

def watchTodos(using s: Session[IO]): Stream[IO, TodoEvent] =
  s.subscribe[TodoEvent]("todos.*")

// Process events
def processEvents(using s: Session[IO]): IO[Unit] =
  watchTodos
    .evalMap {
      case TodoCreated(todo) =>
        IO.println(s"New todo: ${todo.title}")
      case TodoCompleted(id) =>
        IO.println(s"Completed: ${id.value}")
      case TodoDeleted(id) =>
        IO.println(s"Deleted: ${id.value}")
    }
    .compile
    .drain

// With filtering
def watchCompletions(using s: Session[IO]): Stream[IO, TodoCompleted] =
  s.subscribe[TodoEvent]("todos.*")
    .collect { case e: TodoCompleted => e }
```

### Subscribing to Events (ZIO)

```scala
import capnweb.zio.streaming.*
import zio.stream.*

def watchTodos: ZStream[Session, RpcError, TodoEvent] =
  ZStream.serviceWithStream[Session](_.subscribe[TodoEvent]("todos.*"))

// Process with ZIO streams
val processEvents: ZIO[Session, RpcError, Unit] =
  watchTodos
    .tap {
      case TodoCreated(todo) => Console.printLine(s"New: ${todo.title}").orDie
      case TodoCompleted(id) => Console.printLine(s"Done: ${id.value}").orDie
      case TodoDeleted(id)   => Console.printLine(s"Removed: ${id.value}").orDie
    }
    .runDrain
```

### Publishing Events (Server Side)

```scala
import capnweb.target.*

class EventfulTodoService(
  db: Database[IO],
  events: EventPublisher[IO]
) extends TodoService[IO]:

  def create(title: String): IO[Todo] =
    for
      todo <- db.insert(Todo(TodoId(UUID.randomUUID.toString), title, false))
      _    <- events.publish("todos.created", TodoCreated(todo))
    yield todo

  def complete(id: TodoId): IO[Todo] =
    for
      todo <- db.update(id, _.copy(completed = true))
      _    <- events.publish("todos.completed", TodoCompleted(id))
    yield todo
```

---

## Implementing RPC Targets

Expose your Scala objects as remote services.

### Basic Implementation

```scala
import capnweb.target.*
import cats.effect.*

class LocalTodoService(db: Database[IO]) extends TodoService[IO]:

  def list(category: String): IO[List[Todo]] =
    db.query[Todo](sql"SELECT * FROM todos WHERE category = $category")

  def getById(id: TodoId): IO[Todo] =
    db.queryOne[Todo](sql"SELECT * FROM todos WHERE id = ${id.value}")
      .flatMap {
        case Some(todo) => IO.pure(todo)
        case None       => IO.raiseError(RpcError.NotFound("todo", id.value))
      }

  def create(title: String): IO[Todo] =
    val todo = Todo(
      id = TodoId(UUID.randomUUID().toString),
      title = title,
      completed = false,
      authorId = UserId("system")
    )
    db.insert(todo).as(todo)

  // Return a capability - automatically exported to the client
  def comments(todoId: TodoId): IO[CommentService[IO]] =
    IO.pure(LocalCommentService(db, todoId))
```

### Export to Session

```scala
Session.websocket[IO]("wss://api.example.com/rpc").use { session =>
  for
    db <- Database.connect[IO](dbConfig)

    // Export services
    _ <- session.export("todos", LocalTodoService(db))
    _ <- session.export("users", LocalUserService(db))

    // Keep alive
    _ <- IO.never
  yield ()
}
```

### Bidirectional Communication

Cap'n Web is fully bidirectional. The "server" can call the "client" too. Pass capabilities (not string IDs) to enable callbacks.

```scala
// Client provides a callback capability
trait ProgressCallback[F[_]] extends RpcService:
  def onProgress(percent: Int): F[Unit]
  def onComplete(result: String): F[Unit]
  def onError(error: String): F[Unit]

// Server-side task service accepts a callback capability
trait TaskService[F[_]] extends RpcService:
  def runWithProgress(taskId: String, callback: ProgressCallback[F]): F[Unit]

// Client implementation of callback
class ClientProgressHandler(onUpdate: Int => IO[Unit]) extends ProgressCallback[IO]:
  def onProgress(percent: Int): IO[Unit] =
    onUpdate(percent) *> IO.println(s"Progress: $percent%")

  def onComplete(result: String): IO[Unit] =
    IO.println(s"Done: $result")

  def onError(error: String): IO[Unit] =
    IO.println(s"Error: $error")

// Pass callback as a capability (not a string ID!)
def startLongTask(taskId: String)(using s: Session[IO]): IO[Unit] =
  for
    callback <- IO.pure(ClientProgressHandler(pct => updateUI(pct)))
    _        <- s.stub[TaskService].runWithProgress(taskId, callback)
  yield ()
```

The callback capability is automatically exported. The server calls methods on it directly - no manual ID management needed.

---

## Functional Error Handling

Errors are values, not exceptions. Pattern match exhaustively.

### Error ADT

```scala
import capnweb.errors.*

enum RpcError:
  case NotFound(resource: String, id: String)
  case PermissionDenied(operation: String, reason: Option[String])
  case ValidationError(errors: NonEmptyList[FieldError])
  case TransportError(cause: Throwable)
  case Timeout(operation: String, duration: FiniteDuration)
  case ServerError(code: Int, message: String)

case class FieldError(field: String, message: String)
```

### Pattern Matching

```scala
def handleErrors(id: TodoId)(using s: Session[IO]): IO[String] =
  s.stub[TodoService].getById(id).attempt.flatMap {
    case Right(todo) =>
      IO.pure(s"Found: ${todo.title}")

    case Left(RpcError.NotFound(_, id)) =>
      IO.pure(s"Todo $id not found")

    case Left(RpcError.PermissionDenied(op, reason)) =>
      IO.raiseError(SecurityException(s"$op denied: ${reason.getOrElse("unknown")}"))

    case Left(RpcError.Timeout(op, duration)) =>
      IO.pure(s"$op timed out after $duration")

    case Left(e: RpcError) =>
      IO.raiseError(RuntimeException(e.toString))

    case Left(e) =>
      IO.raiseError(e)
  }
```

### EitherT for Explicit Error Threading

```scala
import cats.data.EitherT

type RpcIO[A] = EitherT[IO, RpcError, A]

def transactionalUpdate(
  id: TodoId,
  f: Todo => Todo
)(using s: Session[IO]): RpcIO[Todo] =
  for
    existing <- EitherT(s.stub[TodoService].getById(id).attempt.map(_.leftMap {
      case e: RpcError => e
      case e => RpcError.ServerError(-1, e.getMessage)
    }))
    updated  <- EitherT(s.stub[TodoService].update(id, f(existing)).attempt.map(_.leftMap {
      case e: RpcError => e
      case e => RpcError.ServerError(-1, e.getMessage)
    }))
  yield updated
```

---

## Security

### Capability-Based Access Control

Capabilities naturally encode permissions. You can only call methods on stubs you've been given:

```scala
trait AdminService[F[_]] extends RpcService:
  def deleteUser(id: UserId): F[Unit]
  def resetDatabase(): F[Unit]

trait AuthService[F[_]] extends RpcService:
  def login(credentials: Credentials): F[AuthResult]

case class AuthResult(
  user: User,
  admin: Option[AdminService[IO]]  // Only admins get this capability!
)

// Client code
def performAdminAction(auth: AuthResult)(using Session[IO]): IO[Unit] =
  auth.admin match
    case Some(admin) => admin.deleteUser(UserId("spam-user"))
    case None        => IO.raiseError(NotAdminError())
```

### Input Validation

```scala
import cats.data.ValidatedNel
import cats.syntax.all.*

case class CreateTodoRequest(title: String, category: String)

def validateRequest(req: CreateTodoRequest): ValidatedNel[String, CreateTodoRequest] =
  (
    (if req.title.nonEmpty then req.title.validNel else "Title required".invalidNel),
    (if req.category.length <= 50 then req.category.validNel else "Category too long".invalidNel)
  ).mapN((t, c) => req.copy(title = t, category = c))

class ValidatedTodoService(inner: TodoService[IO]) extends TodoService[IO]:
  def create(title: String): IO[Todo] =
    validateRequest(CreateTodoRequest(title, "default")) match
      case cats.data.Validated.Valid(req) => inner.create(req.title)
      case cats.data.Validated.Invalid(errors) =>
        IO.raiseError(RpcError.ValidationError(errors.map(e => FieldError("request", e))))

  // ... delegate other methods
```

---

## Platform Setup

### http4s (Cats Effect)

```scala
import capnweb.ce3.http4s.*
import org.http4s.ember.server.*
import cats.effect.*

object Server extends IOApp.Simple:
  def run: IO[Unit] =
    for
      db <- Database.connect[IO](config)
      todoService = LocalTodoService(db)
      userService = LocalUserService(db)

      server <- EmberServerBuilder
        .default[IO]
        .withHost(host"0.0.0.0")
        .withPort(port"8080")
        .withHttpWebSocketApp { wsb =>
          CapnWebRoutes[IO](wsb)
            .withService("todos", todoService)
            .withService("users", userService)
            .build
        }
        .build
        .useForever
    yield ()
```

### ZIO HTTP

```scala
import capnweb.zio.http.*
import zio.*
import zio.http.*

object Server extends ZIOAppDefault:
  val app: Http[Session, Nothing, Request, Response] =
    CapnWebRoutes.websocket
      .withService("todos", TodoServiceLive)
      .withService("users", UserServiceLive)
      .build

  def run = Server.serve(app)
    .provide(
      Server.default,
      sessionLayer,
      todoServiceLayer,
      userServiceLayer
    )
```

---

## Configuration

### Session Builder

```scala
Session.websocket[IO]("wss://api.example.com/rpc")
  .withTimeout(30.seconds)
  .withAuth(Auth.Bearer(token))
  .withRetry(RetryPolicy.exponential(maxAttempts = 3, baseDelay = 100.millis))
  .withCodec(MessageCodec.json)
  .build
```

### Authentication Options

```scala
enum Auth:
  case Bearer(token: String)
  case ApiKey(key: String, header: String = "X-API-Key")
  case Basic(username: String, password: String)
  case Custom(headers: Map[String, String])
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
```

---

## Protocol Overview

Cap'n Web is a bidirectional capability-based RPC protocol over JSON. Key concepts:

- **Stubs**: Proxies for remote objects. Method calls become network requests.
- **Promises**: Lazy results that can be pipelined through before resolution.
- **Targets**: Local objects exposed for remote invocation.
- **Capabilities**: Stubs can be passed as arguments or return values, enabling object-capability security.

### Wire Protocol

```
["push", expression]     // Evaluate expression, assign next import ID
["pull", importId]       // Request resolution of import
["resolve", exportId, e] // Resolve export with expression value
["reject", exportId, e]  // Reject export with error
["release", id, refcnt]  // Release import reference
["abort", expression]    // Terminate session with error
```

See [protocol.md](../../protocol.md) for the complete specification.

---

## Module Structure

```
com.dotdo.capnweb
  |-- core/           # Protocol, expressions, messages
  |-- Session         # Session trait and builder
  |-- RpcService      # Service marker trait
  |-- RpcStub         # Stub derivation type class
  |-- Pipeline        # Pipeline monad and combinators
  |
  |-- target/         # Local implementation exports
  |-- errors/         # Error ADT and retry policies
  |-- codec/          # JSON serialization
  |-- syntax/         # Extension methods

capnweb-ce3           # Cats Effect 3 integration
  |-- ce3/streaming/  # fs2 Stream support
  |-- ce3/http4s/     # http4s server integration

capnweb-zio           # ZIO 2 integration
  |-- zio/streaming/  # ZStream support
  |-- zio/http/       # ZIO HTTP server integration
```

---

## Why Cap'n Web for Scala?

| Feature | Benefit |
|---------|---------|
| **Pipeline monad** | For-comprehensions compile to single round-trips |
| **Effect polymorphism** | Write once, run with Cats Effect or ZIO |
| **Functional errors** | ADTs, pattern matching, EitherT composition |
| **Type-safe capabilities** | Services as values, opaque IDs prevent mixups |
| **Resource safety** | Sessions are Resources/Scoped, auto-cleanup guaranteed |
| **Bidirectional** | Server can call client; callbacks are just capabilities |
| **Scala 3 native** | derives, given/using, opaque types, enums |

---

## License

Apache 2.0
