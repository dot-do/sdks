package capnweb

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.*
import kotlinx.serialization.json.*
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Cap'n Web Kotlin SDK - Stub implementation for conformance testing.
 *
 * This is a minimal stub implementation that provides the API surface
 * needed for the conformance tests. A full implementation would include
 * WebSocket transport, proper pipelining, and bidirectional RPC.
 */
object CapnWeb {

    /**
     * Connect to a Cap'n Web server.
     */
    suspend fun connect(url: String): Session = Session(url)

    /**
     * Connect with DSL configuration.
     */
    suspend fun connect(url: String, configure: SessionConfig.() -> Unit): Session {
        val config = SessionConfig().apply(configure)
        return Session(url, config)
    }

    /**
     * Builder for creating sessions with configuration.
     */
    fun builder(url: String): SessionBuilder = SessionBuilder(url)
}

/**
 * Configuration for a Cap'n Web session.
 */
class SessionConfig {
    var timeout: Duration = 30.seconds
    var authToken: String? = null
    var reconnectEnabled: Boolean = true
    var maxReconnectAttempts: Int = 5

    fun auth(token: String) {
        authToken = token
    }

    fun timeout(duration: Duration) {
        timeout = duration
    }

    fun reconnect(configure: ReconnectConfig.() -> Unit) {
        val config = ReconnectConfig().apply(configure)
        reconnectEnabled = config.enabled
        maxReconnectAttempts = config.maxAttempts
    }
}

class ReconnectConfig {
    var enabled: Boolean = true
    var maxAttempts: Int = 5
}

/**
 * Builder pattern for session configuration.
 */
class SessionBuilder(private val url: String) {
    private val config = SessionConfig()

    fun timeout(duration: Duration): SessionBuilder {
        config.timeout = duration
        return this
    }

    fun auth(token: String): SessionBuilder {
        config.authToken = token
        return this
    }

    suspend fun build(): Session = Session(url, config)
}

/**
 * A Cap'n Web session representing a connection to a server.
 */
class Session(
    private val url: String,
    private val config: SessionConfig = SessionConfig()
) : AutoCloseable {

    private var closed = false
    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Check if the session is connected.
     */
    fun isConnected(): Boolean = !closed

    /**
     * Make an RPC call.
     */
    fun <T> call(method: String, vararg args: Any?): RpcPromise<T> {
        return RpcPromise(this, method, args.toList())
    }

    /**
     * Get a capability by name.
     */
    fun capability(name: String): Capability {
        return Capability(this, listOf(name))
    }

    /**
     * Create a pipelining builder.
     */
    fun pipeline(): PipelineBuilder = PipelineBuilder(this)

    /**
     * Dynamic property access to capabilities.
     */
    operator fun get(name: String): Capability = capability(name)

    /**
     * Close the session.
     */
    override fun close() {
        closed = true
    }

    // Internal: execute a call (stub implementation)
    internal suspend fun <T> execute(method: String, args: List<Any?>): T {
        // TODO: Real implementation would send over WebSocket
        throw NotImplementedError("SDK not implemented - awaiting real transport")
    }
}

/**
 * A capability representing a remote object.
 */
class Capability(
    private val session: Session,
    private val path: List<String>
) {
    /**
     * Navigate to a nested capability.
     */
    operator fun get(name: String): Capability {
        return Capability(session, path + name)
    }

    /**
     * Make a call on this capability.
     */
    fun <T> call(method: String, vararg args: Any?): RpcPromise<T> {
        val fullPath = path + method
        return RpcPromise(session, fullPath.joinToString("."), args.toList())
    }
}

/**
 * An RPC promise representing a pending result.
 *
 * Supports pipelining through the `.map()` extension function.
 */
open class RpcPromise<T>(
    @PublishedApi internal val session: Session,
    private val method: String,
    private val args: List<Any?>,
    private val pipeline: List<PipelineStep> = emptyList()
) {
    /**
     * Await the result of this promise.
     */
    open suspend fun await(): T {
        return session.execute(method, args)
    }

    /**
     * Navigate to a property of the result (pipelining).
     */
    operator fun <R> get(property: String): RpcPromise<R> {
        return RpcPromise(
            session,
            method,
            args,
            pipeline + PipelineStep.Property(property)
        )
    }

    /**
     * Call a method on the result (pipelining).
     */
    fun <R> call(method: String, vararg callArgs: Any?): RpcPromise<R> {
        return RpcPromise(
            session,
            this.method,
            args,
            pipeline + PipelineStep.Call(method, callArgs.toList())
        )
    }

    /**
     * Transform the result with a local function.
     */
    fun <R> then(transform: (T) -> R): RpcPromise<R> {
        return RpcPromise(
            session,
            method,
            args,
            pipeline + PipelineStep.Transform(transform as (Any?) -> Any?)
        )
    }

    /**
     * Convert to a result type for explicit error handling.
     */
    suspend fun toResult(): RpcResult<T> {
        return try {
            RpcResult.Success(await())
        } catch (e: RpcError) {
            RpcResult.Failure(e)
        } catch (e: Exception) {
            RpcResult.Failure(RpcError.NetworkError(e))
        }
    }
}

/**
 * Extension function for server-side mapping.
 *
 * This is the KEY feature that eliminates N+1 round trips.
 * When mapping over an array of capabilities, the transform is
 * sent to the server and executed there in a single round trip.
 *
 * Usage:
 * ```kotlin
 * // Map square over fibonacci - single round trip
 * val squares = api.generateFibonacci(6).map { api.square(it) }.await()
 * ```
 */
inline fun <T, R> RpcPromise<List<T>>.map(crossinline transform: (T) -> RpcPromise<R>): RpcPromise<List<R>> {
    // Create a new promise that represents the server-side map operation
    return RpcPromiseMap(this.session, this, transform)
}

/**
 * Map over a single value (for consistency with array map).
 */
inline fun <T, R> RpcPromise<T>.mapValue(crossinline transform: (T) -> RpcPromise<R>): RpcPromise<R> {
    return RpcPromiseSingleMap(this.session, this, transform)
}

// Internal: Promise that represents a server-side map operation on a list
@PublishedApi
internal class RpcPromiseMap<T, R>(
    session: Session,
    private val source: RpcPromise<List<T>>,
    private val transform: (T) -> RpcPromise<R>
) : RpcPromise<List<R>>(session, "remap", emptyList()) {

    override suspend fun await(): List<R> {
        // TODO: Real implementation would send the map expression to the server
        // For now, execute locally (inefficient but correct)
        val sourceResult = source.await()
        return sourceResult.map { element ->
            transform(element).await()
        }
    }
}

// Internal: Promise that represents a server-side map on a single value
@PublishedApi
internal class RpcPromiseSingleMap<T, R>(
    session: Session,
    private val source: RpcPromise<T>,
    private val transform: (T) -> RpcPromise<R>
) : RpcPromise<R>(session, "remap", emptyList()) {

    override suspend fun await(): R {
        val sourceResult = source.await()
        return transform(sourceResult).await()
    }
}

/**
 * A step in a pipeline.
 */
sealed class PipelineStep {
    data class Property(val name: String) : PipelineStep()
    data class Call(val method: String, val args: List<Any?>) : PipelineStep()
    data class Transform(val fn: (Any?) -> Any?) : PipelineStep()
}

/**
 * Builder for constructing pipelines.
 */
class PipelineBuilder(private val session: Session) {
    private val steps = mutableListOf<Pair<String, List<Any?>>>()

    fun call(method: String, vararg args: Any?): PipelineBuilder {
        steps.add(method to args.toList())
        return this
    }

    suspend fun <T> execute(): T {
        // Execute the pipeline
        var result: Any? = null
        for ((method, args) in steps) {
            result = session.execute<Any?>(method, args)
        }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}

/**
 * Sealed class hierarchy for RPC errors.
 */
sealed class RpcError : Exception() {

    /**
     * Resource not found.
     */
    data class NotFound(
        val resource: String,
        val id: String? = null
    ) : RpcError() {
        override val message: String = "Not found: $resource${id?.let { "/$it" } ?: ""}"
    }

    /**
     * Permission denied for an action.
     */
    data class PermissionDenied(
        val action: String,
        val reason: String? = null
    ) : RpcError() {
        override val message: String = "Permission denied: $action${reason?.let { " ($it)" } ?: ""}"
    }

    /**
     * Validation failed.
     */
    data class ValidationFailed(
        val errors: Map<String, String>
    ) : RpcError() {
        override val message: String = "Validation failed: ${errors.entries.joinToString { "${it.key}: ${it.value}" }}"
    }

    /**
     * Unauthorized (authentication required).
     */
    data class Unauthorized(
        val realm: String? = null
    ) : RpcError() {
        override val message: String = "Unauthorized${realm?.let { " (realm: $it)" } ?: ""}"
    }

    /**
     * Remote exception from the server.
     */
    data class RemoteException(
        val type: String,
        override val message: String,
        val stack: String? = null
    ) : RpcError()

    /**
     * Network error.
     */
    data class NetworkError(
        override val cause: Throwable
    ) : RpcError() {
        override val message: String = "Network error: ${cause.message}"
    }

    /**
     * Timeout error.
     */
    data class Timeout(
        val operation: String,
        val duration: Duration
    ) : RpcError() {
        override val message: String = "Timeout after $duration: $operation"
    }

    /**
     * Disconnected from server.
     */
    data object Disconnected : RpcError() {
        override val message: String = "Disconnected"
    }

    /**
     * Session was closed.
     */
    data object SessionClosed : RpcError() {
        override val message: String = "Session closed"
    }
}

/**
 * Result type for explicit error handling.
 */
sealed class RpcResult<out T> {
    data class Success<T>(val value: T) : RpcResult<T>()
    data class Failure(val error: RpcError) : RpcResult<Nothing>()

    fun <R> map(transform: (T) -> R): RpcResult<R> = when (this) {
        is Success -> Success(transform(value))
        is Failure -> this
    }

    fun <R> flatMap(transform: (T) -> RpcResult<R>): RpcResult<R> = when (this) {
        is Success -> transform(value)
        is Failure -> this
    }

    fun getOrNull(): T? = when (this) {
        is Success -> value
        is Failure -> null
    }

    fun getOrElse(default: () -> T): T = when (this) {
        is Success -> value
        is Failure -> default()
    }

    fun getOrThrow(): T = when (this) {
        is Success -> value
        is Failure -> throw error
    }

    inline fun <R> fold(onSuccess: (T) -> R, onFailure: (RpcError) -> R): R = when (this) {
        is Success -> onSuccess(value)
        is Failure -> onFailure(error)
    }
}

/**
 * Connection state for monitoring.
 */
sealed class ConnectionState {
    data object Connecting : ConnectionState()
    data object Connected : ConnectionState()
    data class Reconnecting(val attempt: Int) : ConnectionState()
    data class Disconnected(val reason: String) : ConnectionState()
    data class Failed(val error: RpcError) : ConnectionState()
}
