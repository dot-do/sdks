package com.dotdo

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.*
import kotlinx.serialization.*
import kotlinx.serialization.json.*
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * DotDo Platform SDK for Kotlin
 *
 * The main entry point for the DotDo platform, providing:
 * - Authentication and token management
 * - Connection pooling with automatic health checks
 * - Retry logic with exponential backoff
 * - Coroutine-based async operations
 */
object DotDo {

    private val defaultConfig = DotDoConfig()

    /**
     * Create a new DotDo client instance.
     */
    suspend fun connect(configure: DotDoConfig.() -> Unit = {}): DotDoClient {
        val config = DotDoConfig().apply(configure)
        return DotDoClient(config)
    }

    /**
     * Create a client with a specific endpoint.
     */
    suspend fun connect(endpoint: String, configure: DotDoConfig.() -> Unit = {}): DotDoClient {
        val config = DotDoConfig().apply {
            this.endpoint = endpoint
            configure()
        }
        return DotDoClient(config)
    }
}

/**
 * Configuration for DotDo client.
 */
class DotDoConfig {
    var endpoint: String = "https://api.dotdo.com"
    var authProvider: AuthProvider? = null
    var connectionPool: ConnectionPoolConfig = ConnectionPoolConfig()
    var retry: RetryConfig = RetryConfig()
    var timeout: Duration = 30.seconds

    /**
     * Configure authentication.
     */
    fun auth(configure: AuthConfig.() -> Unit) {
        val authConfig = AuthConfig().apply(configure)
        authProvider = when {
            authConfig.apiKey != null -> AuthProvider.ApiKey(authConfig.apiKey!!)
            authConfig.token != null -> AuthProvider.BearerToken(authConfig.token!!)
            authConfig.oauth != null -> authConfig.oauth!!
            else -> null
        }
    }

    /**
     * Configure connection pooling.
     */
    fun pool(configure: ConnectionPoolConfig.() -> Unit) {
        connectionPool = ConnectionPoolConfig().apply(configure)
    }

    /**
     * Configure retry behavior.
     */
    fun retry(configure: RetryConfig.() -> Unit) {
        retry = RetryConfig().apply(configure)
    }
}

/**
 * Authentication configuration.
 */
class AuthConfig {
    var apiKey: String? = null
    var token: String? = null
    var oauth: AuthProvider.OAuth? = null

    fun apiKey(key: String) {
        apiKey = key
    }

    fun bearerToken(token: String) {
        this.token = token
    }

    fun oauth(configure: OAuthConfig.() -> Unit) {
        val config = OAuthConfig().apply(configure)
        oauth = AuthProvider.OAuth(
            clientId = config.clientId,
            clientSecret = config.clientSecret,
            tokenUrl = config.tokenUrl,
            scopes = config.scopes
        )
    }
}

class OAuthConfig {
    var clientId: String = ""
    var clientSecret: String = ""
    var tokenUrl: String = ""
    var scopes: List<String> = emptyList()
}

/**
 * Authentication providers.
 */
sealed class AuthProvider {
    abstract suspend fun getAuthHeader(): String

    data class ApiKey(val key: String) : AuthProvider() {
        override suspend fun getAuthHeader(): String = "X-API-Key $key"
    }

    data class BearerToken(val token: String) : AuthProvider() {
        override suspend fun getAuthHeader(): String = "Bearer $token"
    }

    data class OAuth(
        val clientId: String,
        val clientSecret: String,
        val tokenUrl: String,
        val scopes: List<String>
    ) : AuthProvider() {
        private var cachedToken: String? = null
        private var tokenExpiry: Long = 0

        override suspend fun getAuthHeader(): String {
            if (cachedToken == null || System.currentTimeMillis() >= tokenExpiry) {
                refreshToken()
            }
            return "Bearer $cachedToken"
        }

        private suspend fun refreshToken() {
            // TODO: Implement OAuth token refresh
            throw NotImplementedError("OAuth token refresh not yet implemented")
        }
    }
}

/**
 * Connection pool configuration.
 */
class ConnectionPoolConfig {
    var maxConnections: Int = 10
    var maxIdleTime: Duration = 5.seconds
    var healthCheckInterval: Duration = 30.seconds
    var acquireTimeout: Duration = 10.seconds
}

/**
 * Retry configuration with exponential backoff.
 */
class RetryConfig {
    var maxAttempts: Int = 3
    var initialDelay: Duration = 100.milliseconds
    var maxDelay: Duration = 10.seconds
    var multiplier: Double = 2.0
    var retryOn: Set<Class<out Throwable>> = setOf(
        java.io.IOException::class.java,
        java.net.SocketTimeoutException::class.java
    )

    fun retryOn(vararg exceptions: Class<out Throwable>) {
        retryOn = exceptions.toSet()
    }
}

/**
 * Main DotDo client.
 */
class DotDoClient internal constructor(
    private val config: DotDoConfig
) : AutoCloseable {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val connectionPool = ConnectionPool(config.connectionPool)
    private val json = Json { ignoreUnknownKeys = true }
    private var closed = false

    init {
        // Start connection pool health checks
        scope.launch {
            connectionPool.startHealthChecks(config.connectionPool.healthCheckInterval)
        }
    }

    /**
     * Execute an operation with automatic retry.
     */
    suspend fun <T> withRetry(block: suspend () -> T): T {
        return retryWithBackoff(config.retry, block)
    }

    /**
     * Get an authenticated connection from the pool.
     */
    suspend fun <T> withConnection(block: suspend (Connection) -> T): T {
        val connection = connectionPool.acquire(config.connectionPool.acquireTimeout)
        return try {
            // Add auth header if configured
            config.authProvider?.let { auth ->
                connection.headers["Authorization"] = auth.getAuthHeader()
            }
            block(connection)
        } finally {
            connectionPool.release(connection)
        }
    }

    /**
     * Check if the client is connected and healthy.
     */
    fun isHealthy(): Boolean = !closed && connectionPool.hasHealthyConnections()

    /**
     * Get connection pool statistics.
     */
    fun poolStats(): PoolStats = connectionPool.stats()

    override fun close() {
        closed = true
        scope.cancel()
        connectionPool.close()
    }

    // Retry with exponential backoff
    private suspend fun <T> retryWithBackoff(
        config: RetryConfig,
        block: suspend () -> T
    ): T {
        var currentDelay = config.initialDelay
        var lastException: Throwable? = null

        repeat(config.maxAttempts) { attempt ->
            try {
                return block()
            } catch (e: Throwable) {
                lastException = e
                val shouldRetry = config.retryOn.any { it.isInstance(e) }
                if (!shouldRetry || attempt == config.maxAttempts - 1) {
                    throw e
                }

                delay(currentDelay)
                currentDelay = minOf(
                    currentDelay * config.multiplier.toLong(),
                    config.maxDelay
                )
            }
        }

        throw lastException ?: IllegalStateException("Retry failed with no exception")
    }
}

/**
 * A pooled connection.
 */
class Connection internal constructor(
    internal val id: String,
    internal val createdAt: Long = System.currentTimeMillis()
) {
    internal var lastUsed: Long = System.currentTimeMillis()
    internal var healthy: Boolean = true
    internal val headers: MutableMap<String, String> = mutableMapOf()

    fun isHealthy(): Boolean = healthy

    internal fun markUsed() {
        lastUsed = System.currentTimeMillis()
    }
}

/**
 * Connection pool with health checks.
 */
class ConnectionPool internal constructor(
    private val config: ConnectionPoolConfig
) {
    private val connections = Channel<Connection>(config.maxConnections)
    private val allConnections = mutableListOf<Connection>()
    private val mutex = Mutex()
    private var connectionCounter = 0

    init {
        // Pre-populate pool
        repeat(config.maxConnections) {
            val conn = createConnection()
            allConnections.add(conn)
            connections.trySend(conn)
        }
    }

    suspend fun acquire(timeout: Duration): Connection {
        return withTimeout(timeout) {
            val conn = connections.receive()
            conn.markUsed()
            conn
        }
    }

    fun release(connection: Connection) {
        connection.headers.clear()
        connections.trySend(connection)
    }

    fun hasHealthyConnections(): Boolean {
        return allConnections.any { it.healthy }
    }

    fun stats(): PoolStats {
        return PoolStats(
            totalConnections = allConnections.size,
            healthyConnections = allConnections.count { it.healthy },
            availableConnections = connections.isEmpty.let { if (it) 0 else allConnections.size }
        )
    }

    suspend fun startHealthChecks(interval: Duration) {
        while (true) {
            delay(interval)
            checkHealth()
        }
    }

    private suspend fun checkHealth() {
        mutex.withLock {
            val now = System.currentTimeMillis()
            allConnections.forEach { conn ->
                // Mark as unhealthy if idle too long
                val idleTime = now - conn.lastUsed
                if (idleTime > config.maxIdleTime.inWholeMilliseconds) {
                    conn.healthy = false
                }
            }

            // Replace unhealthy connections
            val unhealthy = allConnections.filter { !it.healthy }
            unhealthy.forEach { old ->
                allConnections.remove(old)
                val newConn = createConnection()
                allConnections.add(newConn)
                connections.trySend(newConn)
            }
        }
    }

    private fun createConnection(): Connection {
        return Connection(id = "conn-${++connectionCounter}")
    }

    fun close() {
        connections.close()
        allConnections.clear()
    }
}

/**
 * Pool statistics.
 */
data class PoolStats(
    val totalConnections: Int,
    val healthyConnections: Int,
    val availableConnections: Int
)

/**
 * DotDo-specific errors.
 */
sealed class DotDoException : Exception() {
    data class AuthenticationFailed(val reason: String) : DotDoException() {
        override val message: String = "Authentication failed: $reason"
    }

    data class ConnectionPoolExhausted(val timeout: Duration) : DotDoException() {
        override val message: String = "Connection pool exhausted after $timeout"
    }

    data class ServiceUnavailable(val service: String) : DotDoException() {
        override val message: String = "Service unavailable: $service"
    }

    data class RateLimited(val retryAfter: Duration?) : DotDoException() {
        override val message: String = "Rate limited${retryAfter?.let { ", retry after $it" } ?: ""}"
    }
}

/**
 * Extension function to run operations with a fresh client.
 */
suspend fun <T> withDotDo(
    configure: DotDoConfig.() -> Unit = {},
    block: suspend DotDoClient.() -> T
): T {
    return DotDo.connect(configure).use { client ->
        block(client)
    }
}
