package capnweb

import cats.{Monad, Functor, Applicative}
import cats.effect.{Async, Resource, Sync}
import cats.syntax.all.*
import io.circe.{Json, Encoder, Decoder}
import io.circe.syntax.*
import io.circe.parser.parse
import sttp.client3.*
import sttp.client3.circe.*

import scala.concurrent.duration.*

/**
 * Cap'n Web Scala SDK - Stub Implementation
 *
 * This is a minimal stub SDK for conformance testing.
 * It demonstrates the Pipeline[F, A] monad with map/flatMap support.
 */

// =============================================================================
// Core Protocol Types
// =============================================================================

/** Opaque type-safe identifiers */
opaque type ImportId = Int
object ImportId:
  def apply(n: Int): ImportId = n
  extension (id: ImportId) def value: Int = id
  given Encoder[ImportId] = Encoder.encodeInt
  given Decoder[ImportId] = Decoder.decodeInt

opaque type ExportId = Int
object ExportId:
  def apply(n: Int): ExportId = n
  extension (id: ExportId) def value: Int = id
  given Encoder[ExportId] = Encoder.encodeInt
  given Decoder[ExportId] = Decoder.decodeInt

/** RPC Expression types for protocol encoding */
enum Expression:
  case Literal(value: Json)
  case ArrayExpr(elements: List[Expression])
  case ObjectExpr(fields: List[(String, Expression)])
  case Import(id: ImportId, path: List[String], args: Option[List[Expression]])
  case PipelineExpr(base: Expression, path: List[String], args: Option[List[Expression]])
  case Export(id: ExportId)
  case Promise(id: ExportId)

object Expression:
  given Encoder[Expression] = new Encoder[Expression]:
    def apply(e: Expression): Json = e match
      case Literal(v) => v
      case ArrayExpr(elements) => Json.arr(elements.map(apply): _*)
      case ObjectExpr(fields) => Json.obj(fields.map((k, v) => k -> apply(v)): _*)
      case Import(id, path, args) =>
        val base = Json.obj("$import" -> Json.fromInt(id.value))
        // Simplified encoding
        base
      case PipelineExpr(base, path, args) =>
        val baseJson = apply(base)
        Json.obj("$pipeline" -> baseJson, "path" -> Json.arr(path.map(Json.fromString): _*))
      case Export(id) => Json.obj("$export" -> Json.fromInt(id.value))
      case Promise(id) => Json.obj("$promise" -> Json.fromInt(id.value))

// =============================================================================
// Error Types
// =============================================================================

enum RpcError extends Exception:
  case NotFound(resource: String, id: String)
  case PermissionDenied(operation: String, reason: Option[String])
  case TransportError(cause: Throwable)
  case Timeout(operation: String, duration: FiniteDuration)
  case ServerError(code: Int, message: String)
  case ProtocolError(message: String)
  case ConnectionClosed(reason: String)

// =============================================================================
// Pipeline Monad - Server-Side Map Support
// =============================================================================

/**
 * Pipeline[F, A] represents an RPC computation that can be composed
 * via flatMap/map before execution. The key insight is that `.map()`
 * operations can be sent to the server for execution, eliminating N+1
 * round trips when mapping over collections.
 */
sealed trait Pipeline[F[_], A]:
  /** Map a function over the result - MAY execute on server for collections */
  def map[B](f: A => B): Pipeline[F, B]

  /** FlatMap for monadic composition */
  def flatMap[B](f: A => Pipeline[F, B]): Pipeline[F, B]

  /** Convenience method */
  def as[B](b: B): Pipeline[F, B] = map(_ => b)

  /** Discard result */
  def void: Pipeline[F, Unit] = as(())

  /** Execute the pipeline and return the result */
  def run(using session: Session[F]): F[A]

  /** Get the internal representation for testing */
  def toExpr: PipelineExpr[A]

/** Internal representation of pipeline operations */
sealed trait PipelineExpr[A]:
  def isServerMap: Boolean = this match
    case PipelineExpr.ServerMap(_, _, _) => true
    case _ => false

object PipelineExpr:
  case class Pure[A](value: A) extends PipelineExpr[A]
  case class Call[A](method: String, args: List[Json]) extends PipelineExpr[A]
  case class Chain[A, B](prev: PipelineExpr[A], f: A => PipelineExpr[B]) extends PipelineExpr[B]
  case class LocalMap[A, B](prev: PipelineExpr[A], f: A => B) extends PipelineExpr[B]
  case class ServerMap[A, B](prev: PipelineExpr[List[A]], mapExpr: MapExpression, elemDecoder: Decoder[B]) extends PipelineExpr[List[B]]

/** Represents a map expression that can be sent to the server */
case class MapExpression(
  expression: String,
  captures: List[String]
)

object Pipeline:
  /** Create a pure pipeline containing a value */
  def pure[F[_], A](a: A): Pipeline[F, A] = PipelineImpl(PipelineExpr.Pure(a))

  /** Create a pipeline from an RPC call */
  def call[F[_], A](method: String, args: List[Json])(using Decoder[A]): Pipeline[F, A] =
    PipelineImpl(PipelineExpr.Call[A](method, args))

  /** Create a server-side map pipeline */
  def serverMap[F[_], A, B](
    prev: Pipeline[F, List[A]],
    mapExpr: MapExpression
  )(using Decoder[B]): Pipeline[F, List[B]] =
    PipelineImpl(PipelineExpr.ServerMap(prev.toExpr.asInstanceOf[PipelineExpr[List[A]]], mapExpr, summon[Decoder[B]]))

  /** Monad instance for Pipeline */
  given [F[_]]: Monad[Pipeline[F, _]] with
    def pure[A](a: A): Pipeline[F, A] = Pipeline.pure(a)

    def flatMap[A, B](fa: Pipeline[F, A])(f: A => Pipeline[F, B]): Pipeline[F, B] =
      fa.flatMap(f)

    def tailRecM[A, B](a: A)(f: A => Pipeline[F, Either[A, B]]): Pipeline[F, B] =
      // Simplified implementation for conformance testing
      f(a) match
        case p => p.flatMap {
          case Right(b) => Pipeline.pure(b)
          case Left(a1) => tailRecM(a1)(f)
        }

/** Implementation of Pipeline */
private case class PipelineImpl[F[_], A](expr: PipelineExpr[A]) extends Pipeline[F, A]:
  def toExpr: PipelineExpr[A] = expr

  def map[B](f: A => B): Pipeline[F, B] =
    PipelineImpl(PipelineExpr.LocalMap(expr, f))

  def flatMap[B](f: A => Pipeline[F, B]): Pipeline[F, B] =
    PipelineImpl(PipelineExpr.Chain(expr, (a: A) => f(a).toExpr))

  def run(using session: Session[F]): F[A] =
    session.execute(this)

// =============================================================================
// Session - Connection Management
// =============================================================================

trait Session[F[_]]:
  /** Execute a pipeline and return the result */
  def execute[A](pipeline: Pipeline[F, A]): F[A]

  /** Make a direct RPC call */
  def call[A: Decoder](method: String, args: Json*): F[A]

  /** Make a call with server-side map */
  def callWithMap[A: Decoder, B: Decoder](
    method: String,
    args: List[Json],
    mapExpr: Option[MapExpression]
  ): F[B]

  /** Close the session */
  def close: F[Unit]

object Session:
  /** Create a session builder */
  def connect[F[_]: Async](url: String): SessionBuilder[F] =
    SessionBuilder(url, SessionConfig())

case class SessionConfig(
  timeout: FiniteDuration = 30.seconds,
  retryAttempts: Int = 3
)

case class SessionBuilder[F[_]: Async](
  url: String,
  config: SessionConfig
):
  def withTimeout(d: FiniteDuration): SessionBuilder[F] =
    copy(config = config.copy(timeout = d))

  def withRetry(attempts: Int): SessionBuilder[F] =
    copy(config = config.copy(retryAttempts = attempts))

  def build: Resource[F, Session[F]] =
    Resource.make(connect)(_.close)

  def connect: F[Session[F]] =
    Async[F].pure(HttpSession[F](url, config))

// =============================================================================
// HTTP Session Implementation
// =============================================================================

private class HttpSession[F[_]: Async](
  baseUrl: String,
  config: SessionConfig
) extends Session[F]:

  private val backend = HttpClientSyncBackend()

  def execute[A](pipeline: Pipeline[F, A]): F[A] =
    executePipelineExpr(pipeline.toExpr)

  private def executePipelineExpr[A](expr: PipelineExpr[A]): F[A] =
    expr match
      case PipelineExpr.Pure(value) =>
        Async[F].pure(value)

      case PipelineExpr.Call(method, args) =>
        // This shouldn't happen directly - calls should have decoders
        Async[F].raiseError(RpcError.ProtocolError("Call without decoder"))

      case PipelineExpr.LocalMap(prev, f) =>
        executePipelineExpr(prev).map(f.asInstanceOf[Any => A])

      case PipelineExpr.Chain(prev, f) =>
        for
          a <- executePipelineExpr(prev)
          b <- executePipelineExpr(f(a))
        yield b.asInstanceOf[A]

      case PipelineExpr.ServerMap(prev, mapExpr, decoder) =>
        // First execute the previous expression to get the base result
        // Then send the map expression to the server
        for
          baseResult <- executePipelineExpr(prev)
          mapped <- callWithMapInternal(baseResult, mapExpr, decoder)
        yield mapped.asInstanceOf[A]

  private def callWithMapInternal[A, B](
    baseResult: A,
    mapExpr: MapExpression,
    decoder: Decoder[B]
  ): F[List[B]] =
    // For the stub, we simulate server-side mapping
    // In real implementation, this would send the map expression to server
    val resultList = baseResult match
      case list: List[?] => list
      case null => Nil
      case other => List(other)

    // Parse the map expression and apply locally (stub behavior)
    // Real implementation would send to server
    Async[F].pure(resultList.map(_.asInstanceOf[B]))

  def call[A: Decoder](method: String, args: Json*): F[A] =
    callWithMap[Json, A](method, args.toList, None)

  def callWithMap[A: Decoder, B: Decoder](
    method: String,
    args: List[Json],
    mapExpr: Option[MapExpression]
  ): F[B] =
    Async[F].defer {
      val requestBody = Json.obj(
        "method" -> Json.fromString(method),
        "args" -> Json.arr(args: _*),
        "map" -> mapExpr.fold(Json.Null)(m => Json.obj(
          "expression" -> Json.fromString(m.expression),
          "captures" -> Json.arr(m.captures.map(Json.fromString): _*)
        ))
      )

      val request = basicRequest
        .post(uri"$baseUrl/rpc")
        .contentType("application/json")
        .body(requestBody.noSpaces)
        .response(asJson[Json])

      try
        val response = request.send(backend)
        response.body match
          case Right(json) =>
            json.hcursor.get[B]("result") match
              case Right(result) => Async[F].pure(result)
              case Left(err) =>
                // Try parsing directly as result
                json.as[B] match
                  case Right(result) => Async[F].pure(result)
                  case Left(_) => Async[F].raiseError(RpcError.ProtocolError(s"Failed to decode: $err"))
          case Left(err) =>
            Async[F].raiseError(RpcError.TransportError(Exception(err.getMessage)))
      catch
        case e: Exception =>
          Async[F].raiseError(RpcError.TransportError(e))
    }

  def close: F[Unit] =
    Async[F].delay(backend.close())

// =============================================================================
// CapnWeb - Main Entry Point
// =============================================================================

object CapnWeb:
  /** Connect to a Cap'n Web server */
  def connect[F[_]: Async](url: String): Resource[F, Session[F]] =
    Session.connect[F](url).build

  /** Create a stub for an API */
  def stub[F[_]: Async](url: String): Resource[F, ApiStub[F]] =
    connect[F](url).map(session => ApiStub(session))

/** Generic API stub for making RPC calls */
class ApiStub[F[_]: Async](session: Session[F]):
  /** Call a method and get result */
  def call[A: Decoder](method: String, args: Json*): F[A] =
    session.call[A](method, args: _*)

  /** Call a method that returns a list, then map over it on the server */
  def callAndMap[A: Decoder, B: Decoder](
    method: String,
    args: List[Json],
    mapExpr: String,
    captures: List[String] = List("$self")
  ): F[List[B]] =
    session.callWithMap[A, List[B]](
      method,
      args,
      Some(MapExpression(mapExpr, captures))
    )

  /** Create a pipeline for chained operations */
  def pipeline[A: Decoder](method: String, args: Json*): Pipeline[F, A] =
    Pipeline.call[F, A](method, args.toList)

  /** Access the underlying session */
  def underlying: Session[F] = session

// =============================================================================
// Test Helpers
// =============================================================================

object TestHelpers:
  /** Create a test session from environment */
  def testSession[F[_]: Async]: Resource[F, Session[F]] =
    val url = sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000")
    Session.connect[F](url).build

  /** Check if an expression uses server-side map */
  def usesServerMap[A](pipeline: Pipeline[?, A]): Boolean =
    pipeline.toExpr.isServerMap
