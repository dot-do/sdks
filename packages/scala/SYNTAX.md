# Cap'n Web Scala Client Library - Syntax Exploration

This document explores divergent syntax approaches for the Scala client library (`com.dotdo:capnweb`),
targeting Scala 3.3+ with modern idioms. Cap'n Web is a bidirectional capability-based RPC protocol
over JSON supporting stubs, pipelining, targets, and multiple transports.

---

## Background: What Makes Scala Unique

Scala brings a distinctive blend of OOP and FP paradigms with powerful features:

- **Given/Using (Scala 3)**: Contextual abstractions replacing implicits
- **For-Comprehensions**: Monadic composition with elegant syntax
- **Case Classes & Pattern Matching**: Algebraic data types with exhaustive matching
- **Traits & Mixins**: Flexible composition over inheritance
- **Effect Systems**: Cats Effect, ZIO for principled effects
- **Akka/Pekko**: Actor-based concurrency and streaming
- **Extension Methods**: Add methods to existing types without wrappers
- **Opaque Types**: Zero-cost type aliases with distinct semantics
- **Type Classes**: Ad-hoc polymorphism via given instances

The challenge: Design an API that feels native to Scala developers while leveraging
pipelining's unique ability to batch calls through unresolved promises.

---

## Approach 1: Cats Effect with For-Comprehensions (The "Typelevel" Way)

Inspired by [http4s](https://http4s.org/), [fs2](https://fs2.io/), and the Typelevel ecosystem.
Uses `IO` monad, type classes, and for-comprehensions for pure functional style.

### Philosophy
- **Referential transparency**: All effects are values
- **Type classes for abstraction**: Polymorphic over effect type `F[_]`
- **For-comprehensions**: Natural syntax for sequential operations
- **Resource safety**: Bracket-based resource management

### Connection/Session Creation

```scala
import capnweb.*
import capnweb.syntax.*
import cats.effect.*
import cats.syntax.all.*

// Resource-safe session management
val sessionResource: Resource[IO, Session[IO]] =
  Session.websocket[IO]("wss://api.example.com/rpc")
    .withTimeout(30.seconds)
    .withAuth(ApiKey(sys.env("API_KEY")))
    .build

// Usage with use/bracket
sessionResource.use { session =>
  val api = session.stub[TodoService]
  for {
    todos <- api.list("work")
    _     <- IO.println(s"Found ${todos.size} items")
  } yield ()
}

// Or in a larger application
object Main extends IOApp.Simple:
  def run: IO[Unit] =
    sessionResource.use { session =>
      program(session)
    }
```

### Defining Remote Interfaces

```scala
import capnweb.{RpcStub, RpcCall}

// Trait defines the remote interface
trait TodoService[F[_]] extends RpcStub[F]:
  def list(category: String): F[List[Todo]]
  def getById(id: String): F[Todo]
  def create(todo: Todo): F[Todo]

  // Returns a capability (another stub)
  def comments(todoId: String): F[CommentService[F]]

trait CommentService[F[_]] extends RpcStub[F]:
  def list: F[List[Comment]]
  def add(text: String): F[Comment]

// Data types as case classes
case class Todo(id: String, title: String, completed: Boolean, authorId: String)
case class Comment(id: String, text: String, author: String)

// Codecs derived automatically
given Codec[Todo] = Codec.derived
given Codec[Comment] = Codec.derived
```

### Making RPC Calls

```scala
// For-comprehension for sequential calls
def fetchTodoWithComments(api: TodoService[IO], id: String): IO[(Todo, List[Comment])] =
  for
    todo     <- api.getById(id)
    comments <- api.comments(id).flatMap(_.list)
  yield (todo, comments)

// Parallel calls with parTupled
def fetchDashboard(api: TodoService[IO]): IO[(List[Todo], List[Todo])] =
  (api.list("work"), api.list("personal")).parTupled

// Error handling with MonadError
def safeFetch(api: TodoService[IO], id: String): IO[Option[Todo]] =
  api.getById(id)
    .map(_.some)
    .handleError(_ => none[Todo])
```

### Pipelining Syntax

The key innovation: `RpcPromise` is a monad that batches operations before execution.

```scala
import capnweb.pipeline.*

// RpcPromise[F, A] - lazy RPC that can be pipelined
trait RpcPromise[F[_], A]:
  def flatMap[B](f: A => RpcPromise[F, B]): RpcPromise[F, B]
  def map[B](f: A => B): RpcPromise[F, B]
  def run: F[A]  // Execute the pipeline

// Extension method on stub to return RpcPromise
extension [F[_]: Async](api: TodoService[F])
  def pipeline: TodoServicePipeline[F] = ???

// Pipelining via for-comprehension - SINGLE round trip!
val authorName: IO[String] = {
  for
    todo    <- api.pipeline.getById("123")         // Not executed yet
    author  <- users.pipeline.getById(todo.authorId) // Pipelined!
    profile <- author.profile                        // Still pipelining
  yield profile.name
}.run  // NOW executes as one batched request

// Alternative: fluent pipelining API
val authorName: IO[String] =
  api.pipeline
    .getById("123")
    .through(todo => users.pipeline.getById(todo.authorId))
    .access(_.profile.name)
    .run

// Pipeline combinator for branching
val (todo, comments): (Todo, List[Comment]) = {
  val todoP = api.pipeline.getById("123")
  val commentsP = todoP.flatMap(t => api.pipeline.comments(t.id).flatMap(_.list))
  (todoP, commentsP).tupled.run
}.unsafeRunSync()
```

### Error Handling

```scala
import capnweb.errors.*

// ADT for RPC errors
enum RpcError:
  case NotFound(resource: String, id: String)
  case PermissionDenied(reason: String)
  case ValidationError(field: String, message: String)
  case TransportError(cause: Throwable)
  case Timeout(duration: FiniteDuration)

// EitherT for explicit error handling
type RpcIO[A] = EitherT[IO, RpcError, A]

def fetchTodoSafe(api: TodoService[RpcIO], id: String): RpcIO[Todo] =
  api.getById(id).recoverWith {
    case RpcError.NotFound(_, _) =>
      EitherT.leftT(RpcError.NotFound("todo", id))
  }

// Pattern matching on errors
api.getById("missing").attempt.flatMap {
  case Right(todo) => IO.println(s"Found: ${todo.title}")
  case Left(RpcError.NotFound(_, id)) => IO.println(s"Todo $id not found")
  case Left(RpcError.PermissionDenied(r)) => IO.raiseError(SecurityException(r))
  case Left(e) => IO.raiseError(RuntimeException(e.toString))
}
```

### Exposing Local Objects as RPC Targets

```scala
import capnweb.target.*

// Implement trait with IO effect
class LocalTodoService(db: Database[IO]) extends TodoService[IO]:
  def list(category: String): IO[List[Todo]] =
    db.query(sql"SELECT * FROM todos WHERE category = $category")

  def getById(id: String): IO[Todo] =
    db.queryOne(sql"SELECT * FROM todos WHERE id = $id")
      .flatMap(_.liftTo[IO](RpcError.NotFound("todo", id)))

  def create(todo: Todo): IO[Todo] =
    db.insert(todo).as(todo)

  def comments(todoId: String): IO[CommentService[IO]] =
    IO.pure(LocalCommentService(db, todoId))

// Export to session
session.export("todos", LocalTodoService(db))

// Or return as capability in response
def getProject(id: String): IO[ProjectService[IO]] =
  db.findProject(id).map { project =>
    LocalProjectService(project) // Returned as remote capability
  }
```

### Pros
- Pure FP style familiar to Typelevel ecosystem users
- For-comprehensions provide elegant sequential composition
- Resource safety via Cats Effect Resource
- Polymorphic over effect type (can use IO, SyncIO, etc.)

### Cons
- Pipelining requires special `RpcPromise` type distinct from `F[A]`
- Learning curve for developers unfamiliar with Cats Effect
- Two "worlds": normal F[A] vs pipelined RpcPromise[F, A]

---

## Approach 2: ZIO with ZLayer (The "ZIO" Way)

Inspired by [ZIO](https://zio.dev/) and its layered architecture. Uses ZIO's typed errors,
fibers, and dependency injection via ZLayer.

### Philosophy
- **Typed errors**: Errors are part of the type signature
- **Layers for DI**: ZLayer for dependency injection
- **Fiber-based concurrency**: Lightweight threads for parallelism
- **Accessors pattern**: Service pattern with ZIO.serviceWith

### Connection/Session Creation

```scala
import zio.*
import zio.stream.*
import capnweb.zio.*

// Session as a ZLayer
val sessionLayer: ZLayer[Scope, SessionError, Session] =
  ZLayer.scoped {
    Session.websocket("wss://api.example.com/rpc")
      .withConfig(SessionConfig(timeout = 30.seconds))
      .connect
  }

// Service accessor pattern
trait TodoService:
  def list(category: String): IO[RpcError, List[Todo]]
  def getById(id: String): IO[RpcError, Todo]
  def comments(todoId: String): IO[RpcError, CommentService]

object TodoService:
  // Accessor
  def list(category: String): ZIO[TodoService, RpcError, List[Todo]] =
    ZIO.serviceWithZIO(_.list(category))

  def getById(id: String): ZIO[TodoService, RpcError, Todo] =
    ZIO.serviceWithZIO(_.getById(id))

// Live implementation from session
val todoServiceLayer: ZLayer[Session, Nothing, TodoService] =
  ZLayer {
    for
      session <- ZIO.service[Session]
    yield session.stub[TodoService]
  }
```

### Making RPC Calls

```scala
// ZIO's for-comprehension
val program: ZIO[TodoService, RpcError, Unit] =
  for
    todos <- TodoService.list("work")
    _     <- ZIO.foreachDiscard(todos)(t => Console.printLine(t.title).orDie)
  yield ()

// Parallel with zipPar
val dashboard: ZIO[TodoService, RpcError, (List[Todo], List[Todo])] =
  TodoService.list("work").zipPar(TodoService.list("personal"))

// Running with layers
object Main extends ZIOAppDefault:
  def run = program.provide(
    todoServiceLayer,
    sessionLayer,
    Scope.default
  )
```

### Pipelining Syntax

ZIO's native fiber model enables elegant pipelining through `ZPipeline`.

```scala
import capnweb.zio.pipeline.*

// Pipeline is a specialized ZIO that batches operations
opaque type Pipeline[-R, +E, +A] = ZIO[R, E, A]

object Pipeline:
  extension [R, E, A](self: Pipeline[R, E, A])
    def andThen[R1 <: R, E1 >: E, B](f: A => Pipeline[R1, E1, B]): Pipeline[R1, E1, B] =
      // Chains without executing - batched on run
      ???

    def run: ZIO[R, E, A] = self

// Stub returns Pipeline instead of ZIO for pipelining mode
trait TodoServicePipeline:
  def getById(id: String): Pipeline[Any, RpcError, Todo]
  def comments(todoId: String): Pipeline[Any, RpcError, CommentServicePipeline]

// Pipelining via chained andThen - SINGLE round trip
val authorName: ZIO[Session, RpcError, String] =
  session.pipelined { stub =>
    stub[TodoService]
      .getById("123")
      .andThen(todo => stub[UserService].getById(todo.authorId))
      .andThen(user => user.profile)
      .map(_.name)
  }

// For-comprehension style with pipeline block
val authorName: ZIO[Session, RpcError, String] =
  pipeline {
    for
      todo    <- TodoService.getById("123")
      author  <- UserService.getById(todo.authorId)
      profile <- author.profile
    yield profile.name
  }.run

// Parallel pipelines with zipPar
val result: ZIO[Session, RpcError, (Todo, List[Comment])] =
  pipeline {
    val todoP = TodoService.getById("123")
    val commentsP = todoP.flatMap(t => TodoService.comments(t.id).flatMap(_.list))
    todoP.zipPar(commentsP)
  }.run
```

### Error Handling

```scala
// ZIO's typed errors shine here
enum RpcError:
  case NotFound(resource: String, id: String)
  case PermissionDenied(reason: String)
  case Validation(errors: List[FieldError])
  case Transport(cause: Throwable)

case class FieldError(field: String, message: String)

// Catching specific errors
def safeFetch(id: String): ZIO[TodoService, RpcError.Transport, Option[Todo]] =
  TodoService.getById(id)
    .map(Some(_))
    .catchSome {
      case RpcError.NotFound(_, _) => ZIO.none
    }

// Refining error types
def mustExist(id: String): ZIO[TodoService, RpcError.NotFound, Todo] =
  TodoService.getById(id).refineOrDie {
    case e: RpcError.NotFound => e
  }

// Error accumulation
def validateMany(ids: List[String]): ZIO[TodoService, ::[RpcError], List[Todo]] =
  ZIO.validatePar(ids)(TodoService.getById)
```

### Exposing Local Objects as RPC Targets

```scala
import capnweb.zio.target.*

// Implement as ZIO service
case class LocalTodoService(db: Database) extends TodoService:
  def list(category: String): IO[RpcError, List[Todo]] =
    db.query(category)
      .mapError(e => RpcError.Transport(e))

  def getById(id: String): IO[RpcError, Todo] =
    db.find(id)
      .someOrFail(RpcError.NotFound("todo", id))
      .mapError {
        case e: RpcError => e
        case t: Throwable => RpcError.Transport(t)
      }

  def comments(todoId: String): IO[RpcError, CommentService] =
    ZIO.succeed(LocalCommentService(db, todoId))

// Layer for exporting
val exportLayer: ZLayer[Database & Session, Nothing, Unit] =
  ZLayer.scoped {
    for
      db      <- ZIO.service[Database]
      session <- ZIO.service[Session]
      _       <- session.export("todos", LocalTodoService(db))
    yield ()
  }
```

### Pros
- Typed errors as first-class citizens
- ZLayer provides elegant dependency injection
- Fiber-based parallelism integrates naturally
- ZIO ecosystem compatibility (ZIO HTTP, ZIO Streams)

### Cons
- ZIO-specific (not interoperable with Cats Effect without bridges)
- Learning curve for ZIO newcomers
- Heavier runtime than pure Cats Effect

---

## Approach 3: Akka/Pekko Actors with Ask Pattern (The "Actor" Way)

Inspired by [Akka](https://akka.io/) and [Apache Pekko](https://pekko.apache.org/). Uses the
actor model for concurrency, typed actors for safety, and streams for backpressure.

### Philosophy
- **Actors as natural RPC targets**: Each stub backed by an actor
- **Location transparency**: Same API for local/remote
- **Backpressure via streams**: Handle high-throughput scenarios
- **Supervision for resilience**: Automatic error recovery

### Connection/Session Creation

```scala
import org.apache.pekko.actor.typed.*
import org.apache.pekko.actor.typed.scaladsl.*
import capnweb.pekko.*

// ActorSystem is the entry point
given system: ActorSystem[Nothing] = ActorSystem(Behaviors.empty, "capnweb")

// Session as an actor
val session: Future[ActorRef[SessionCommand]] =
  Session.connect("wss://api.example.com/rpc")
    .withTimeout(30.seconds)
    .spawn()

// Or as an extension
val session = system.spawn(
  SessionBehavior("wss://api.example.com/rpc"),
  "rpc-session"
)
```

### Defining Remote Interfaces

```scala
import capnweb.pekko.stub.*

// Protocol messages for typed actor
sealed trait TodoCommand
object TodoCommand:
  case class List(category: String, replyTo: ActorRef[StatusReply[Seq[Todo]]]) extends TodoCommand
  case class GetById(id: String, replyTo: ActorRef[StatusReply[Todo]]) extends TodoCommand
  case class Create(todo: Todo, replyTo: ActorRef[StatusReply[Todo]]) extends TodoCommand
  case class Comments(todoId: String, replyTo: ActorRef[StatusReply[ActorRef[CommentCommand]]]) extends TodoCommand

// Stub wrapper for ergonomic API
class TodoStub(ref: ActorRef[TodoCommand])(using Timeout, Scheduler):
  def list(category: String): Future[Seq[Todo]] =
    ref.askWithStatus(TodoCommand.List(category, _))

  def getById(id: String): Future[Todo] =
    ref.askWithStatus(TodoCommand.GetById(id, _))

  def comments(todoId: String): Future[CommentStub] =
    ref.askWithStatus(TodoCommand.Comments(todoId, _))
      .map(CommentStub(_))
```

### Making RPC Calls

```scala
import scala.concurrent.ExecutionContext.Implicits.global

given Timeout = Timeout(5.seconds)

// Get stub from session
val todoStub: Future[TodoStub] = session.stub[TodoStub]

// Call methods via ask pattern
for
  stub  <- todoStub
  todos <- stub.list("work")
  _     <- Future.traverse(todos)(t => println(t.title))
yield ()

// Parallel calls
val dashboard: Future[(Seq[Todo], Seq[Todo])] =
  for
    stub <- todoStub
    result <- stub.list("work").zip(stub.list("personal"))
  yield result
```

### Pipelining Syntax

Actor messaging naturally supports pipelining through message batching.

```scala
import capnweb.pekko.pipeline.*

// Pipeline builder accumulates messages
class PipelineBuilder(session: ActorRef[SessionCommand]):
  private var operations: Vector[PipelineOp] = Vector.empty

  def call[A](stub: RpcStub, method: String, args: Any*): PipelineRef[A] =
    val ref = PipelineRef[A](operations.size)
    operations :+= PipelineOp.Call(stub, method, args)
    ref

  def access[A, B](ref: PipelineRef[A], path: String): PipelineRef[B] =
    val newRef = PipelineRef[B](operations.size)
    operations :+= PipelineOp.Access(ref.index, path)
    newRef

  def execute(): Future[PipelineResults] =
    session.ask(SessionCommand.ExecutePipeline(operations, _))

// Fluent API for pipelining - SINGLE round trip
val authorName: Future[String] = session.pipeline { p =>
  val todo = p.call[Todo](todoStub, "getById", "123")
  val authorId = p.access[Todo, String](todo, "authorId")
  val author = p.call[User](userStub, "getById", authorId)
  p.access[User, String](author, "name")
}.execute()

// DSL macro for cleaner syntax
val authorName: Future[String] = pipeline(session) {
  val todo = todoStub.getById("123")
  val author = userStub.getById(todo.authorId)
  author.name
}
```

### Streaming with Akka Streams

```scala
import org.apache.pekko.stream.*
import org.apache.pekko.stream.scaladsl.*

// Stream-based subscription
def watchTodos(category: String): Source[TodoEvent, NotUsed] =
  session.subscribe[TodoEvent](s"todos.$category.*")

// Process stream with backpressure
watchTodos("work")
  .filter(_.isUrgent)
  .mapAsync(4)(event => processEvent(event))
  .runWith(Sink.foreach(println))

// Batched operations via stream
Source(todoIds)
  .grouped(100)
  .mapAsync(2)(batch => todoStub.batchGet(batch))
  .mapConcat(identity)
  .runWith(Sink.seq)
```

### Error Handling

```scala
import org.apache.pekko.pattern.StatusReply

// StatusReply provides typed errors
todoStub.getById("missing").transformWith {
  case Success(todo) => Future.successful(todo)
  case Failure(StatusReply.ErrorMessage(msg)) =>
    // RPC error from server
    Future.failed(RpcException(msg))
  case Failure(ex: TimeoutException) =>
    // Ask timeout
    Future.failed(RpcException("Request timed out"))
  case Failure(ex) =>
    Future.failed(ex)
}

// Supervision for automatic recovery
val supervisedSession = Behaviors.supervise(SessionBehavior(url))
  .onFailure[ConnectionException](SupervisorStrategy.restart)

// Circuit breaker pattern
import org.apache.pekko.pattern.CircuitBreaker

val breaker = CircuitBreaker(
  system.scheduler,
  maxFailures = 5,
  callTimeout = 10.seconds,
  resetTimeout = 1.minute
)

def resilientCall(id: String): Future[Todo] =
  breaker.withCircuitBreaker(todoStub.getById(id))
```

### Exposing Local Objects as RPC Targets

```scala
import capnweb.pekko.target.*

// Implement as typed actor behavior
object LocalTodoService:
  def apply(db: Database): Behavior[TodoCommand] =
    Behaviors.receiveMessage {
      case TodoCommand.List(category, replyTo) =>
        db.query(category) match
          case Success(todos) => replyTo ! StatusReply.success(todos)
          case Failure(e) => replyTo ! StatusReply.error(e.getMessage)
        Behaviors.same

      case TodoCommand.GetById(id, replyTo) =>
        db.find(id) match
          case Some(todo) => replyTo ! StatusReply.success(todo)
          case None => replyTo ! StatusReply.error(s"Todo $id not found")
        Behaviors.same

      case TodoCommand.Comments(todoId, replyTo) =>
        val commentsActor = system.spawn(
          LocalCommentService(db, todoId),
          s"comments-$todoId"
        )
        replyTo ! StatusReply.success(commentsActor)
        Behaviors.same
    }

// Export to session
session ! SessionCommand.Export("todos", LocalTodoService(db))
```

### Pros
- Natural fit for bidirectional RPC (actors are inherently bidirectional)
- Built-in supervision and resilience patterns
- Akka Streams for backpressure handling
- Location transparency for distributed systems

### Cons
- Actor model has steep learning curve
- Verbose protocol definition (command case classes)
- Less idiomatic for simple request-response patterns
- Heavier runtime dependency

---

## Approach 4: Direct Style with Scala 3 Context Functions (The "Direct" Way)

A novel approach using Scala 3's context functions, extension methods, and direct style
(inspired by Ox and Loom). Minimal ceremony, maximum expressiveness.

### Philosophy
- **Direct style**: Write sequential code, get async behavior
- **Context functions**: Session flows implicitly through code
- **Extension methods**: Stubs feel like native objects
- **Minimal abstractions**: No explicit monads or actors

### Connection/Session Creation

```scala
import capnweb.direct.*
import scala.concurrent.duration.*

// Context function type - session is implicit
type Rpc[A] = Session ?=> A

// Simple connection with context
def withSession[A](url: String)(f: Session ?=> A): A =
  val session = Session.connect(url)
  try f(using session)
  finally session.close()

// Usage
withSession("wss://api.example.com/rpc") {
  val api = stub[TodoService]
  val todos = api.list("work").await
  println(s"Found ${todos.size} items")
}

// Or with resource syntax
Session.connect("wss://api.example.com/rpc").use { session ?=>
  val api = stub[TodoService]
  // session is available implicitly
}
```

### Defining Remote Interfaces

```scala
import capnweb.direct.stub.*

// Simple trait definition - no F[_] type parameter!
trait TodoService derives RpcStub:
  def list(category: String): List[Todo]
  def getById(id: String): Todo
  def create(todo: Todo): Todo
  def comments(todoId: String): CommentService

trait CommentService derives RpcStub:
  def list: List[Comment]
  def add(text: String): Comment

// Case classes with derived codecs
case class Todo(
  id: String,
  title: String,
  completed: Boolean,
  authorId: String
) derives RpcCodec

case class Comment(id: String, text: String) derives RpcCodec
```

### Making RPC Calls

```scala
// Direct style - looks synchronous, runs async!
def fetchDashboard(using Session): (List[Todo], List[Todo]) =
  val api = stub[TodoService]

  // Sequential calls
  val workTodos = api.list("work").await
  val personalTodos = api.list("personal").await

  (workTodos, personalTodos)

// Parallel with par block
def fetchDashboardParallel(using Session): (List[Todo], List[Todo]) =
  val api = stub[TodoService]

  par {
    (api.list("work").await, api.list("personal").await)
  }

// Extension methods for fluent access
extension (todo: Todo)(using Session)
  def author: User = stub[UserService].getById(todo.authorId).await
  def commentsService: CommentService = stub[TodoService].comments(todo.id).await
```

### Pipelining Syntax

Pipelining uses a special `pipeline` block that batches all operations.

```scala
import capnweb.direct.pipeline.*

// Pipeline block - all operations batched into ONE round trip
val authorName: String = pipeline {
  val todo = stub[TodoService].getById("123")
  val author = stub[UserService].getById(todo.authorId)
  author.profile.name
}

// The magic: inside pipeline, property access returns PipelineRef
// Outside pipeline block, the whole thing executes as single request

// Pipeline with branching
val (todo, comments) = pipeline {
  val t = stub[TodoService].getById("123")
  val c = stub[TodoService].comments(t.id).list
  (t, c)  // Tuple automatically batched
}

// Conditional pipelining
val result = pipeline {
  val todo = stub[TodoService].getById("123")
  if todo.completed then
    todo.author.name  // Pipelined through completed check
  else
    "Unknown"
}

// Pipeline combinators
val names: List[String] = pipeline {
  stub[TodoService]
    .list("work")
    .map(todo => stub[UserService].getById(todo.authorId).name)
}
```

### The Pipeline Macro

```scala
// Under the hood, pipeline is a macro that transforms code
inline def pipeline[A](inline body: PipelineContext ?=> A)(using Session): A =
  ${ pipelineMacro('body, 'session) }

// The macro analyzes the AST and:
// 1. Converts method calls to RPC operations
// 2. Builds dependency graph
// 3. Batches independent operations
// 4. Executes as single round-trip

// Example transformation:
// Input:
pipeline {
  val todo = stub[TodoService].getById("123")
  val author = stub[UserService].getById(todo.authorId)
  author.name
}

// Transformed to:
{
  val op1 = PipelineOp.Call(stubRef[TodoService], "getById", List("123"))
  val op2 = PipelineOp.Call(stubRef[UserService], "getById", List(op1.ref("authorId")))
  val op3 = PipelineOp.Access(op2, "name")
  session.executePipeline(List(op1, op2, op3)).last.as[String]
}
```

### Error Handling

```scala
import capnweb.direct.errors.*
import scala.util.boundary
import scala.util.boundary.break

// Errors as ADT
enum RpcError:
  case NotFound(resource: String, id: String)
  case PermissionDenied(reason: String)
  case NetworkError(cause: Throwable)

// Using boundary/break for early return
def safeFetch(id: String)(using Session): Option[Todo] =
  boundary:
    val todo = stub[TodoService].getById(id).tryAwait match
      case Right(t) => t
      case Left(RpcError.NotFound(_, _)) => break(None)
      case Left(e) => throw RpcException(e)
    Some(todo)

// Pattern matching with Either
def fetchWithReason(id: String)(using Session): Either[String, Todo] =
  stub[TodoService].getById(id).attempt match
    case Right(todo) => Right(todo)
    case Left(RpcError.NotFound(_, id)) => Left(s"Todo $id not found")
    case Left(RpcError.PermissionDenied(r)) => Left(s"Access denied: $r")
    case Left(e) => Left(s"Error: $e")

// Recover combinator
val todo: Todo = stub[TodoService]
  .getById("123")
  .recover {
    case RpcError.NotFound(_, _) => Todo.empty
  }
  .await
```

### Exposing Local Objects as RPC Targets

```scala
import capnweb.direct.target.*

// Simple implementation - just implement the trait!
class LocalTodoService(db: Database) extends TodoService:
  def list(category: String): List[Todo] =
    db.query(s"SELECT * FROM todos WHERE category = '$category'")

  def getById(id: String): Todo =
    db.find(id).getOrElse(throw NotFoundException("todo", id))

  def create(todo: Todo): Todo =
    db.insert(todo)
    todo

  def comments(todoId: String): CommentService =
    LocalCommentService(db, todoId)

// Export with extension method
extension (session: Session)
  def exportService[T: RpcTarget](name: String, impl: T): Unit =
    session.export(name, impl)

// Usage
session.exportService("todos", LocalTodoService(db))

// Or inline export
withSession(url) {
  export("todos", LocalTodoService(db))
  export("users", LocalUserService(db))

  // Session now serves both services
  awaitShutdown()
}
```

### Pros
- Cleanest, most readable syntax
- Minimal boilerplate - looks like regular Scala code
- Pipeline macro handles optimization automatically
- Context functions eliminate explicit parameter passing

### Cons
- Macro complexity for pipeline transformation
- Less explicit about what's happening under the hood
- May be harder to debug (macro-generated code)
- Novel patterns may surprise developers

---

## Comparison Matrix

| Feature | Approach 1 (Cats Effect) | Approach 2 (ZIO) | Approach 3 (Akka/Pekko) | Approach 4 (Direct Style) |
|---------|-------------------------|------------------|-------------------------|---------------------------|
| **Effect System** | IO / F[_] | ZIO | Future + Actors | Context functions |
| **Pipelining** | RpcPromise + for-comp | Pipeline block | Message batching | Macro transformation |
| **Error Handling** | MonadError / EitherT | Typed errors (E) | StatusReply / Try | boundary/break + Either |
| **DI Pattern** | Tagless final | ZLayer | Actor system | Context parameters |
| **Learning Curve** | Medium (FP required) | Medium-High | High (Actor model) | Low (looks synchronous) |
| **Type Safety** | High | Very High | High | High |
| **Interop** | Cats ecosystem | ZIO ecosystem | Akka ecosystem | Standalone |
| **Boilerplate** | Medium | Medium | High | Low |
| **Debugging** | Good (explicit effects) | Good (typed errors) | Complex (actors) | Harder (macros) |

---

## Recommendations

### For Teams Already Using Cats Effect
**Approach 1** - Natural extension of existing patterns. For-comprehensions work elegantly,
and the ecosystem integration (http4s, doobie, etc.) is seamless.

### For Teams Already Using ZIO
**Approach 2** - Leverages typed errors and ZLayer. The ecosystem integration
(ZIO HTTP, ZIO Streams) provides a complete solution.

### For Distributed Systems / High Concurrency
**Approach 3 (Akka/Pekko)** - Actor model excels at bidirectional communication,
supervision, and location transparency. Best for systems where RPC is just one
piece of a larger actor-based architecture.

### For Maximum Developer Ergonomics
**Approach 4 (Direct Style)** - Cleanest syntax, fastest onboarding. The `pipeline`
macro handles optimization automatically. Best for teams that want Cap'n Web to
"just work" without deep FP or actor knowledge.

### Hybrid Recommendation

Consider supporting multiple paradigms via modules:

```scala
// Core library with direct style
libraryDependencies += "com.dotdo" %% "capnweb" % "1.0.0"

// Cats Effect integration
libraryDependencies += "com.dotdo" %% "capnweb-ce3" % "1.0.0"

// ZIO integration
libraryDependencies += "com.dotdo" %% "capnweb-zio" % "1.0.0"

// Akka/Pekko integration
libraryDependencies += "com.dotdo" %% "capnweb-pekko" % "1.0.0"
```

Each module shares the core protocol implementation but provides
idiomatic wrappers for its ecosystem.

---

## Implementation Notes

### Core Protocol Layer

All approaches share a common protocol implementation:

```scala
// Core types (shared across all approaches)
package capnweb.core

opaque type ImportId = Int
opaque type ExportId = Int

enum Expression:
  case Literal(value: Json)
  case ArrayExpr(elements: List[Expression])
  case Import(id: ImportId, path: List[String], args: Option[List[Expression]])
  case Pipeline(id: ImportId, path: List[String], args: Option[List[Expression]])
  case Export(id: ExportId)
  case Promise(id: ExportId)

enum Message:
  case Push(expr: Expression)
  case Pull(importId: ImportId)
  case Resolve(exportId: ExportId, expr: Expression)
  case Reject(exportId: ExportId, expr: Expression)
  case Release(importId: ImportId, refcount: Int)
  case Abort(expr: Expression)

// Transport abstraction
trait Transport:
  def send(message: Message): Unit
  def receive(): Message
  def close(): Unit

object Transport:
  def websocket(url: String): Transport = ???
  def httpBatch(url: String): Transport = ???
```

### sbt Configuration

```scala
// build.sbt
ThisBuild / scalaVersion := "3.3.1"
ThisBuild / organization := "com.dotdo"

lazy val core = project
  .settings(
    name := "capnweb-core",
    libraryDependencies ++= Seq(
      "io.circe" %% "circe-core" % "0.14.6",
      "io.circe" %% "circe-parser" % "0.14.6",
    )
  )

lazy val catsEffect = project
  .dependsOn(core)
  .settings(
    name := "capnweb-ce3",
    libraryDependencies ++= Seq(
      "org.typelevel" %% "cats-effect" % "3.5.2",
      "co.fs2" %% "fs2-core" % "3.9.3",
    )
  )

lazy val zio = project
  .dependsOn(core)
  .settings(
    name := "capnweb-zio",
    libraryDependencies ++= Seq(
      "dev.zio" %% "zio" % "2.0.19",
      "dev.zio" %% "zio-streams" % "2.0.19",
    )
  )

lazy val pekko = project
  .dependsOn(core)
  .settings(
    name := "capnweb-pekko",
    libraryDependencies ++= Seq(
      "org.apache.pekko" %% "pekko-actor-typed" % "1.0.2",
      "org.apache.pekko" %% "pekko-stream" % "1.0.2",
    )
  )
```

### Maven Coordinates

```xml
<!-- Core -->
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-core_3</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Cats Effect 3 integration -->
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-ce3_3</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- ZIO 2 integration -->
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-zio_3</artifactId>
    <version>1.0.0</version>
</dependency>

<!-- Pekko integration -->
<dependency>
    <groupId>com.dotdo</groupId>
    <artifactId>capnweb-pekko_3</artifactId>
    <version>1.0.0</version>
</dependency>
```
