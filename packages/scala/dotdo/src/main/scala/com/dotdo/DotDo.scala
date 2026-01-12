package com.dotdo

import cats.{Functor, Monad, Applicative}
import cats.effect.{Async, Resource, Sync, Ref, Deferred, Temporal}
import cats.effect.std.{Semaphore, Queue}
import cats.syntax.all.*
import io.circe.{Json, Encoder, Decoder}
import io.circe.syntax.*
import io.circe.parser.parse
import sttp.client3.*
import sttp.client3.circe.*

import scala.concurrent.duration.*
import java.util.concurrent.atomic.AtomicLong

/**
 * DotDo Platform SDK for Scala
 *
 * A functional, type-safe SDK for interacting with the DotDo platform.
 * Features:
 * - Authentication with multiple strategies
 * - Connection pooling with resource management
 * - Automatic retry with exponential backoff
 * - Functional error handling
 */

// =============================================================================
// Authentication
// =============================================================================

/** Authentication strategies for DotDo */
sealed trait AuthStrategy:
  def toHeaders: Map[String, String]

object AuthStrategy:
  /** Bearer token authentication */
  case class BearerToken(token: String) extends AuthStrategy:
    def toHeaders: Map[String, String] =
      Map("Authorization" -> s"Bearer $token")

  /** API key authentication */
  case class ApiKey(key: String, headerName: String = "X-API-Key") extends AuthStrategy:
    def toHeaders: Map[String, String] =
      Map(headerName -> key)

  /** OAuth2 with refresh support */
  case class OAuth2(
    accessToken: String,
    refreshToken: Option[String] = None,
    expiresAt: Option[Long] = None
  ) extends AuthStrategy:
    def toHeaders: Map[String, String] =
      Map("Authorization" -> s"Bearer $accessToken")

    def isExpired: Boolean =
      expiresAt.exists(_ < System.currentTimeMillis())

  /** No authentication */
  case object Anonymous extends AuthStrategy:
    def toHeaders: Map[String, String] = Map.empty

  /** Create from environment variables */
  def fromEnv: AuthStrategy =
    sys.env.get("DOTDO_API_KEY")
      .map(ApiKey(_))
      .orElse(sys.env.get("DOTDO_TOKEN").map(BearerToken(_)))
      .getOrElse(Anonymous)

// =============================================================================
// Connection Pool
// =============================================================================

/**
 * Connection pool configuration
 */
case class PoolConfig(
  maxConnections: Int = 10,
  maxIdleTime: FiniteDuration = 5.minutes,
  connectionTimeout: FiniteDuration = 30.seconds,
  acquireTimeout: FiniteDuration = 10.seconds
)

/**
 * Managed connection pool with resource safety
 */
trait ConnectionPool[F[_]]:
  /** Acquire a connection from the pool */
  def acquire: F[PooledConnection[F]]

  /** Get pool statistics */
  def stats: F[PoolStats]

  /** Shutdown the pool */
  def shutdown: F[Unit]

case class PoolStats(
  active: Int,
  idle: Int,
  total: Int,
  waiters: Int
)

trait PooledConnection[F[_]]:
  /** Execute a request with this connection */
  def execute[A: Decoder](request: Json): F[A]

  /** Return connection to pool */
  def release: F[Unit]

  /** Mark connection as invalid (will be destroyed) */
  def invalidate: F[Unit]

object ConnectionPool:
  /** Create a resource-managed connection pool */
  def create[F[_]: Async](
    baseUrl: String,
    config: PoolConfig = PoolConfig()
  ): Resource[F, ConnectionPool[F]] =
    Resource.make(
      SimpleConnectionPool.create[F](baseUrl, config)
    )(_.shutdown)

/** Simple connection pool implementation */
private class SimpleConnectionPool[F[_]: Async](
  baseUrl: String,
  config: PoolConfig,
  semaphore: Semaphore[F],
  activeCount: Ref[F, Int],
  backend: SttpBackend[cats.Id, Any]
) extends ConnectionPool[F]:

  def acquire: F[PooledConnection[F]] =
    for
      _ <- semaphore.acquire
      _ <- activeCount.update(_ + 1)
    yield new SimplePooledConnection[F](baseUrl, backend, this)

  private[dotdo] def release: F[Unit] =
    activeCount.update(_ - 1) *> semaphore.release

  def stats: F[PoolStats] =
    for
      active <- activeCount.get
      available <- semaphore.available.map(_.toInt)
    yield PoolStats(
      active = active,
      idle = available,
      total = config.maxConnections,
      waiters = 0
    )

  def shutdown: F[Unit] =
    Async[F].delay(backend.close())

private object SimpleConnectionPool:
  def create[F[_]: Async](
    baseUrl: String,
    config: PoolConfig
  ): F[SimpleConnectionPool[F]] =
    for
      semaphore <- Semaphore[F](config.maxConnections.toLong)
      activeCount <- Ref.of[F, Int](0)
      backend = HttpClientSyncBackend()
    yield new SimpleConnectionPool[F](baseUrl, config, semaphore, activeCount, backend)

private class SimplePooledConnection[F[_]: Async](
  baseUrl: String,
  backend: SttpBackend[cats.Id, Any],
  pool: SimpleConnectionPool[F]
) extends PooledConnection[F]:

  def execute[A: Decoder](request: Json): F[A] =
    Async[F].defer {
      val httpRequest = basicRequest
        .post(uri"$baseUrl/rpc")
        .contentType("application/json")
        .body(request.noSpaces)
        .response(asJson[Json])

      try
        val response = httpRequest.send(backend)
        response.body match
          case Right(json) =>
            json.as[A] match
              case Right(result) => Async[F].pure(result)
              case Left(err) =>
                Async[F].raiseError(DotDoError.DecodeError(json, err.message))
          case Left(err) =>
            Async[F].raiseError(DotDoError.ServerError(response.code.code, err.getMessage))
      catch
        case e: Exception =>
          Async[F].raiseError(DotDoError.ConnectionFailed(baseUrl, e))
    }

  def release: F[Unit] = pool.release

  def invalidate: F[Unit] = pool.release

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Retry configuration with exponential backoff
 */
case class RetryConfig(
  maxAttempts: Int = 3,
  initialDelay: FiniteDuration = 100.millis,
  maxDelay: FiniteDuration = 10.seconds,
  backoffMultiplier: Double = 2.0,
  retryableErrors: Set[Class[? <: Throwable]] = Set(
    classOf[DotDoError.ConnectionFailed],
    classOf[DotDoError.Timeout]
  )
):
  def isRetryable(error: Throwable): Boolean =
    retryableErrors.exists(_.isInstance(error)) ||
      (error match
        case DotDoError.ServerError(code, _) => code >= 500
        case _ => false
      )

  def delayForAttempt(attempt: Int): FiniteDuration =
    val delay = initialDelay * math.pow(backoffMultiplier, attempt - 1)
    if delay > maxDelay then maxDelay else FiniteDuration(delay.toNanos, NANOSECONDS)

object Retry:
  /**
   * Execute an operation with retry logic
   */
  def withRetry[F[_]: Temporal, A](
    operation: F[A],
    config: RetryConfig = RetryConfig()
  ): F[A] =
    def attempt(n: Int, lastError: Option[Throwable]): F[A] =
      if n > config.maxAttempts then
        lastError match
          case Some(e) => Temporal[F].raiseError(e)
          case None => Temporal[F].raiseError(DotDoError.Unknown("Max retries exceeded"))
      else
        operation.handleErrorWith { error =>
          if config.isRetryable(error) && n < config.maxAttempts then
            val delay = config.delayForAttempt(n)
            Temporal[F].sleep(delay) *> attempt(n + 1, Some(error))
          else
            Temporal[F].raiseError(error)
        }

    attempt(1, None)

// =============================================================================
// Error Types
// =============================================================================

sealed trait DotDoError extends Exception:
  def message: String
  override def getMessage: String = message

object DotDoError:
  case class ConnectionFailed(host: String, cause: Throwable) extends DotDoError:
    def message = s"Failed to connect to $host: ${cause.getMessage}"

  case class Timeout(operation: String, duration: FiniteDuration) extends DotDoError:
    def message = s"Operation '$operation' timed out after $duration"

  case class ServerError(code: Int, details: String) extends DotDoError:
    def message = s"Server error $code: $details"

  case class DecodeError(json: Json, cause: String) extends DotDoError:
    def message = s"Failed to decode response: $cause"

  case class AuthError(reason: String) extends DotDoError:
    def message = s"Authentication failed: $reason"

  case class RateLimited(retryAfter: Option[FiniteDuration]) extends DotDoError:
    def message = s"Rate limited${retryAfter.map(d => s", retry after $d").getOrElse("")}"

  case class Unknown(details: String) extends DotDoError:
    def message = s"Unknown error: $details"

// =============================================================================
// DotDo Client
// =============================================================================

/**
 * Main DotDo client configuration
 */
case class DotDoConfig(
  baseUrl: String = "https://api.dotdo.com",
  auth: AuthStrategy = AuthStrategy.Anonymous,
  pool: PoolConfig = PoolConfig(),
  retry: RetryConfig = RetryConfig(),
  timeout: FiniteDuration = 30.seconds
)

object DotDoConfig:
  /** Create config from environment */
  def fromEnv: DotDoConfig =
    DotDoConfig(
      baseUrl = sys.env.getOrElse("DOTDO_URL", "https://api.dotdo.com"),
      auth = AuthStrategy.fromEnv
    )

/**
 * DotDo client - main entry point for platform interaction
 */
trait DotDo[F[_]]:
  /** Make an RPC call */
  def call[A: Decoder](method: String, args: Json*): F[A]

  /** Make an RPC call with explicit request */
  def request[A: Decoder](req: DotDoRequest): F[A]

  /** Get connection pool stats */
  def poolStats: F[PoolStats]

  /** Close the client */
  def close: F[Unit]

case class DotDoRequest(
  method: String,
  args: List[Json] = Nil,
  headers: Map[String, String] = Map.empty,
  timeout: Option[FiniteDuration] = None
)

object DotDo:
  /** Create a DotDo client builder */
  def builder[F[_]: Async](baseUrl: String): DotDoBuilder[F] =
    DotDoBuilder(DotDoConfig(baseUrl = baseUrl))

  /** Create a resource-managed client */
  def resource[F[_]: Async](config: DotDoConfig = DotDoConfig.fromEnv): Resource[F, DotDo[F]] =
    for
      pool <- ConnectionPool.create[F](config.baseUrl, config.pool)
    yield new DotDoImpl[F](config, pool)

  /** Create a client from environment */
  def fromEnv[F[_]: Async]: Resource[F, DotDo[F]] =
    resource(DotDoConfig.fromEnv)

case class DotDoBuilder[F[_]: Async](config: DotDoConfig):
  def withAuth(auth: AuthStrategy): DotDoBuilder[F] =
    copy(config = config.copy(auth = auth))

  def withBearerToken(token: String): DotDoBuilder[F] =
    withAuth(AuthStrategy.BearerToken(token))

  def withApiKey(key: String): DotDoBuilder[F] =
    withAuth(AuthStrategy.ApiKey(key))

  def withPool(poolConfig: PoolConfig): DotDoBuilder[F] =
    copy(config = config.copy(pool = poolConfig))

  def withRetry(retryConfig: RetryConfig): DotDoBuilder[F] =
    copy(config = config.copy(retry = retryConfig))

  def withTimeout(timeout: FiniteDuration): DotDoBuilder[F] =
    copy(config = config.copy(timeout = timeout))

  def resource: Resource[F, DotDo[F]] =
    DotDo.resource(config)

  def build: F[DotDo[F]] =
    for
      pool <- SimpleConnectionPool.create[F](config.baseUrl, config.pool)
    yield new DotDoImpl[F](config, pool)

/** DotDo client implementation */
private class DotDoImpl[F[_]: Async](
  config: DotDoConfig,
  pool: ConnectionPool[F]
) extends DotDo[F]:

  def call[A: Decoder](method: String, args: Json*): F[A] =
    request(DotDoRequest(method, args.toList))

  def request[A: Decoder](req: DotDoRequest): F[A] =
    val operation = for
      conn <- pool.acquire
      result <- conn.execute[A](buildRequestBody(req))
        .guarantee(conn.release)
    yield result

    Retry.withRetry(operation, config.retry)

  private def buildRequestBody(req: DotDoRequest): Json =
    Json.obj(
      "method" -> Json.fromString(req.method),
      "args" -> Json.arr(req.args: _*)
    )

  def poolStats: F[PoolStats] = pool.stats

  def close: F[Unit] = pool.shutdown

// =============================================================================
// Convenience Methods and Extensions
// =============================================================================

object DotDoHelpers:
  /** Create a test client */
  def testClient[F[_]: Async]: Resource[F, DotDo[F]] =
    val url = sys.env.getOrElse("DOTDO_TEST_URL", "http://localhost:3000")
    DotDo.builder[F](url).resource

  /** Execute with timeout */
  def withTimeout[F[_]: Temporal, A](
    operation: F[A],
    timeout: FiniteDuration
  ): F[A] =
    Temporal[F].timeoutTo(
      operation,
      timeout,
      Temporal[F].raiseError(DotDoError.Timeout("operation", timeout))
    )

/** Extension methods for DotDo client */
extension [F[_]: Async](client: DotDo[F])
  /** Call with automatic retry on failure */
  def callRetrying[A: Decoder](
    method: String,
    args: Json*
  )(using retryConfig: RetryConfig = RetryConfig()): F[A] =
    Retry.withRetry(client.call[A](method, args: _*), retryConfig)

  /** Call multiple methods in parallel */
  def callAll[A: Decoder](methods: List[(String, List[Json])]): F[List[A]] =
    methods.parTraverse { case (method, args) =>
      client.call[A](method, args: _*)
    }

// =============================================================================
// Usage Example (in comments)
// =============================================================================

/*
Usage:

import cats.effect.{IO, IOApp}
import com.dotdo.*

object Main extends IOApp.Simple:
  def run: IO[Unit] =
    DotDo.builder[IO]("https://api.dotdo.com")
      .withApiKey("my-api-key")
      .withRetry(RetryConfig(maxAttempts = 5))
      .resource
      .use { client =>
        for
          result <- client.call[Json]("users.list")
          _ <- IO.println(s"Got: $result")
          stats <- client.poolStats
          _ <- IO.println(s"Pool: $stats")
        yield ()
      }
*/
