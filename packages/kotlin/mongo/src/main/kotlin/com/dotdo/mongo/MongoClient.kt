package com.dotdo.mongo

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.*
import kotlinx.serialization.*
import kotlinx.serialization.json.*
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * DotDo Mongo SDK for Kotlin
 *
 * A coroutine-based MongoDB client with Cap'n Web RPC transport.
 * Features:
 * - Type-safe document operations with kotlinx.serialization
 * - Coroutine-native async operations
 * - Server-side aggregation pipelines
 * - DSL builders for queries and updates
 * - Connection pooling with health checks
 * - Automatic retry with exponential backoff
 *
 * @example
 * ```kotlin
 * // Connect to Mongo
 * val client = MongoClient.connect("https://mongo.do") {
 *     auth { apiKey("my-key") }
 *     pool { maxConnections = 10 }
 * }
 *
 * // Get a typed collection
 * val users = client.database("mydb").collection<User>("users")
 *
 * // Find documents
 * users.find { "age" gte 18 }.limit(10).toList()
 *
 * // Insert documents
 * users.insertOne(User("Alice", 25))
 *
 * // Aggregate with server-side mapping
 * users.aggregate {
 *     match { "status" eq "active" }
 *     group("_id" to "\$department") {
 *         "count" accumulator Count
 *         "avgAge" accumulator Avg("\$age")
 *     }
 * }.toList()
 * ```
 */
object MongoClient {

    /**
     * Connect to a MongoDB instance via Cap'n Web RPC.
     */
    suspend fun connect(url: String): MongoConnection = MongoConnection(url, MongoConfig())

    /**
     * Connect with DSL configuration.
     */
    suspend fun connect(url: String, configure: MongoConfig.() -> Unit): MongoConnection {
        val config = MongoConfig().apply(configure)
        return MongoConnection(url, config)
    }

    /**
     * Builder pattern for connection configuration.
     */
    fun builder(url: String): MongoConnectionBuilder = MongoConnectionBuilder(url)
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for MongoDB connection.
 */
class MongoConfig {
    var timeout: Duration = 30.seconds
    var authProvider: MongoAuthProvider? = null
    var poolConfig: MongoPoolConfig = MongoPoolConfig()
    var retryConfig: MongoRetryConfig = MongoRetryConfig()

    /**
     * Configure authentication.
     */
    fun auth(configure: MongoAuthConfig.() -> Unit) {
        val authConfig = MongoAuthConfig().apply(configure)
        authProvider = when {
            authConfig.apiKey != null -> MongoAuthProvider.ApiKey(authConfig.apiKey!!)
            authConfig.connectionString != null -> MongoAuthProvider.ConnectionString(authConfig.connectionString!!)
            authConfig.credentials != null -> authConfig.credentials
            else -> null
        }
    }

    /**
     * Configure connection pooling.
     */
    fun pool(configure: MongoPoolConfig.() -> Unit) {
        poolConfig = MongoPoolConfig().apply(configure)
    }

    /**
     * Configure retry behavior.
     */
    fun retry(configure: MongoRetryConfig.() -> Unit) {
        retryConfig = MongoRetryConfig().apply(configure)
    }
}

class MongoAuthConfig {
    var apiKey: String? = null
    var connectionString: String? = null
    var credentials: MongoAuthProvider.Credentials? = null

    fun apiKey(key: String) {
        apiKey = key
    }

    fun connectionString(uri: String) {
        connectionString = uri
    }

    fun credentials(username: String, password: String, authDb: String = "admin") {
        credentials = MongoAuthProvider.Credentials(username, password, authDb)
    }
}

/**
 * Authentication providers for MongoDB.
 */
sealed class MongoAuthProvider {
    abstract fun toHeaders(): Map<String, String>

    data class ApiKey(val key: String) : MongoAuthProvider() {
        override fun toHeaders() = mapOf("Authorization" to "Bearer $key")
    }

    data class ConnectionString(val uri: String) : MongoAuthProvider() {
        override fun toHeaders() = mapOf("X-MongoDB-Connection" to uri)
    }

    data class Credentials(
        val username: String,
        val password: String,
        val authDb: String = "admin"
    ) : MongoAuthProvider() {
        override fun toHeaders() = mapOf(
            "X-MongoDB-User" to username,
            "X-MongoDB-AuthDb" to authDb
        )
    }
}

/**
 * Connection pool configuration.
 */
class MongoPoolConfig {
    var maxConnections: Int = 10
    var minConnections: Int = 1
    var maxIdleTime: Duration = 5.seconds
    var acquireTimeout: Duration = 10.seconds
    var healthCheckInterval: Duration = 30.seconds
}

/**
 * Retry configuration.
 */
class MongoRetryConfig {
    var maxAttempts: Int = 3
    var initialDelay: Duration = 100.milliseconds
    var maxDelay: Duration = 10.seconds
    var multiplier: Double = 2.0
    var retryableErrors: Set<String> = setOf(
        "NetworkError",
        "ConnectionTimeout",
        "TransientTransactionError"
    )
}

/**
 * Builder for MongoDB connections.
 */
class MongoConnectionBuilder(private val url: String) {
    private val config = MongoConfig()

    fun timeout(duration: Duration): MongoConnectionBuilder {
        config.timeout = duration
        return this
    }

    fun apiKey(key: String): MongoConnectionBuilder {
        config.authProvider = MongoAuthProvider.ApiKey(key)
        return this
    }

    fun connectionString(uri: String): MongoConnectionBuilder {
        config.authProvider = MongoAuthProvider.ConnectionString(uri)
        return this
    }

    fun pool(configure: MongoPoolConfig.() -> Unit): MongoConnectionBuilder {
        config.pool(configure)
        return this
    }

    fun retry(configure: MongoRetryConfig.() -> Unit): MongoConnectionBuilder {
        config.retry(configure)
        return this
    }

    suspend fun build(): MongoConnection = MongoConnection(url, config)
}

// =============================================================================
// Connection
// =============================================================================

/**
 * A MongoDB connection.
 */
class MongoConnection internal constructor(
    private val url: String,
    private val config: MongoConfig
) : AutoCloseable {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private var closed = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /**
     * Get a database by name.
     */
    fun database(name: String): MongoDatabase = MongoDatabase(this, name)

    /**
     * List all databases.
     */
    suspend fun listDatabases(): List<DatabaseInfo> {
        return execute("listDatabases")
    }

    /**
     * Check if connection is healthy.
     */
    fun isConnected(): Boolean = !closed

    /**
     * Close the connection.
     */
    override fun close() {
        closed = true
        scope.cancel()
    }

    // Internal: Execute a command
    internal suspend fun <T> execute(command: String, vararg args: Any?): T {
        // TODO: Real implementation would send over Cap'n Web RPC
        throw NotImplementedError("MongoDB transport not yet implemented")
    }

    // Internal: Execute with retry
    internal suspend fun <T> executeWithRetry(command: String, vararg args: Any?): T {
        var lastException: Throwable? = null
        var currentDelay = config.retryConfig.initialDelay

        repeat(config.retryConfig.maxAttempts) { attempt ->
            try {
                return execute(command, *args)
            } catch (e: MongoException) {
                lastException = e
                val shouldRetry = config.retryConfig.retryableErrors.any {
                    e.code == it || e.message?.contains(it) == true
                }
                if (!shouldRetry || attempt == config.retryConfig.maxAttempts - 1) {
                    throw e
                }

                delay(currentDelay)
                currentDelay = minOf(
                    currentDelay * config.retryConfig.multiplier.toLong(),
                    config.retryConfig.maxDelay
                )
            }
        }

        throw lastException ?: IllegalStateException("Retry failed with no exception")
    }
}

/**
 * Database information.
 */
@Serializable
data class DatabaseInfo(
    val name: String,
    val sizeOnDisk: Long,
    val empty: Boolean
)

// =============================================================================
// Database
// =============================================================================

/**
 * A MongoDB database.
 */
class MongoDatabase internal constructor(
    private val connection: MongoConnection,
    val name: String
) {
    /**
     * Get a typed collection.
     */
    inline fun <reified T> collection(name: String): MongoCollection<T> {
        return MongoCollection(connection, this.name, name, serializer())
    }

    /**
     * List all collections in this database.
     */
    suspend fun listCollections(): List<CollectionInfo> {
        return connection.execute("listCollections", name)
    }

    /**
     * Create a new collection.
     */
    suspend fun createCollection(name: String, options: CreateCollectionOptions = CreateCollectionOptions()) {
        connection.execute<Unit>("createCollection", this.name, name, options)
    }

    /**
     * Drop the database.
     */
    suspend fun drop() {
        connection.execute<Unit>("dropDatabase", name)
    }

    /**
     * Run a database command.
     */
    suspend fun <T> runCommand(command: JsonObject): T {
        return connection.execute("runCommand", name, command)
    }
}

@Serializable
data class CollectionInfo(
    val name: String,
    val type: String,
    val options: JsonObject = JsonObject(emptyMap())
)

@Serializable
data class CreateCollectionOptions(
    val capped: Boolean = false,
    val size: Long? = null,
    val max: Long? = null,
    val validator: JsonObject? = null
)

// =============================================================================
// Collection
// =============================================================================

/**
 * A typed MongoDB collection.
 */
class MongoCollection<T> internal constructor(
    private val connection: MongoConnection,
    private val database: String,
    val name: String,
    private val serializer: KSerializer<T>
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    // -------------------------------------------------------------------------
    // Find Operations
    // -------------------------------------------------------------------------

    /**
     * Find documents matching a filter.
     */
    fun find(filter: FilterBuilder.() -> Unit = {}): FindCursor<T> {
        val filterDoc = FilterBuilder().apply(filter).build()
        return FindCursor(connection, database, name, serializer, filterDoc)
    }

    /**
     * Find a single document by ID.
     */
    suspend fun findById(id: String): T? {
        return find { "_id" eq id }.first()
    }

    /**
     * Find a single document matching a filter.
     */
    suspend fun findOne(filter: FilterBuilder.() -> Unit = {}): T? {
        return find(filter).first()
    }

    /**
     * Count documents matching a filter.
     */
    suspend fun countDocuments(filter: FilterBuilder.() -> Unit = {}): Long {
        val filterDoc = FilterBuilder().apply(filter).build()
        return connection.execute("countDocuments", database, name, filterDoc)
    }

    /**
     * Check if any documents match a filter.
     */
    suspend fun exists(filter: FilterBuilder.() -> Unit = {}): Boolean {
        return countDocuments(filter) > 0
    }

    // -------------------------------------------------------------------------
    // Insert Operations
    // -------------------------------------------------------------------------

    /**
     * Insert a single document.
     */
    suspend fun insertOne(document: T): InsertOneResult {
        val doc = json.encodeToJsonElement(serializer, document)
        return connection.execute("insertOne", database, name, doc)
    }

    /**
     * Insert multiple documents.
     */
    suspend fun insertMany(documents: List<T>): InsertManyResult {
        val docs = documents.map { json.encodeToJsonElement(serializer, it) }
        return connection.execute("insertMany", database, name, docs)
    }

    // -------------------------------------------------------------------------
    // Update Operations
    // -------------------------------------------------------------------------

    /**
     * Update a single document.
     */
    suspend fun updateOne(
        filter: FilterBuilder.() -> Unit,
        update: UpdateBuilder.() -> Unit
    ): UpdateResult {
        val filterDoc = FilterBuilder().apply(filter).build()
        val updateDoc = UpdateBuilder().apply(update).build()
        return connection.execute("updateOne", database, name, filterDoc, updateDoc)
    }

    /**
     * Update multiple documents.
     */
    suspend fun updateMany(
        filter: FilterBuilder.() -> Unit,
        update: UpdateBuilder.() -> Unit
    ): UpdateResult {
        val filterDoc = FilterBuilder().apply(filter).build()
        val updateDoc = UpdateBuilder().apply(update).build()
        return connection.execute("updateMany", database, name, filterDoc, updateDoc)
    }

    /**
     * Replace a single document.
     */
    suspend fun replaceOne(
        filter: FilterBuilder.() -> Unit,
        replacement: T
    ): UpdateResult {
        val filterDoc = FilterBuilder().apply(filter).build()
        val replacementDoc = json.encodeToJsonElement(serializer, replacement)
        return connection.execute("replaceOne", database, name, filterDoc, replacementDoc)
    }

    /**
     * Find and update a document atomically.
     */
    suspend fun findOneAndUpdate(
        filter: FilterBuilder.() -> Unit,
        update: UpdateBuilder.() -> Unit,
        options: FindOneAndUpdateOptions = FindOneAndUpdateOptions()
    ): T? {
        val filterDoc = FilterBuilder().apply(filter).build()
        val updateDoc = UpdateBuilder().apply(update).build()
        return connection.execute("findOneAndUpdate", database, name, filterDoc, updateDoc, options)
    }

    // -------------------------------------------------------------------------
    // Delete Operations
    // -------------------------------------------------------------------------

    /**
     * Delete a single document.
     */
    suspend fun deleteOne(filter: FilterBuilder.() -> Unit): DeleteResult {
        val filterDoc = FilterBuilder().apply(filter).build()
        return connection.execute("deleteOne", database, name, filterDoc)
    }

    /**
     * Delete multiple documents.
     */
    suspend fun deleteMany(filter: FilterBuilder.() -> Unit): DeleteResult {
        val filterDoc = FilterBuilder().apply(filter).build()
        return connection.execute("deleteMany", database, name, filterDoc)
    }

    /**
     * Find and delete a document atomically.
     */
    suspend fun findOneAndDelete(filter: FilterBuilder.() -> Unit): T? {
        val filterDoc = FilterBuilder().apply(filter).build()
        return connection.execute("findOneAndDelete", database, name, filterDoc)
    }

    // -------------------------------------------------------------------------
    // Aggregation
    // -------------------------------------------------------------------------

    /**
     * Run an aggregation pipeline.
     */
    fun aggregate(pipeline: AggregateBuilder.() -> Unit): AggregateCursor<T> {
        val stages = AggregateBuilder().apply(pipeline).build()
        return AggregateCursor(connection, database, name, serializer, stages)
    }

    /**
     * Run an aggregation pipeline with a different result type.
     */
    inline fun <reified R> aggregateAs(
        noinline pipeline: AggregateBuilder.() -> Unit
    ): AggregateCursor<R> {
        val stages = AggregateBuilder().apply(pipeline).build()
        return AggregateCursor(connection, database, name, serializer(), stages)
    }

    // -------------------------------------------------------------------------
    // Indexes
    // -------------------------------------------------------------------------

    /**
     * Create an index.
     */
    suspend fun createIndex(
        keys: IndexKeysBuilder.() -> Unit,
        options: IndexOptions = IndexOptions()
    ): String {
        val keysDoc = IndexKeysBuilder().apply(keys).build()
        return connection.execute("createIndex", database, name, keysDoc, options)
    }

    /**
     * List all indexes.
     */
    suspend fun listIndexes(): List<IndexInfo> {
        return connection.execute("listIndexes", database, name)
    }

    /**
     * Drop an index by name.
     */
    suspend fun dropIndex(indexName: String) {
        connection.execute<Unit>("dropIndex", database, name, indexName)
    }

    // -------------------------------------------------------------------------
    // Bulk Operations
    // -------------------------------------------------------------------------

    /**
     * Execute bulk write operations.
     */
    suspend fun bulkWrite(operations: BulkWriteBuilder<T>.() -> Unit): BulkWriteResult {
        val ops = BulkWriteBuilder<T>(json, serializer).apply(operations).build()
        return connection.execute("bulkWrite", database, name, ops)
    }

    // -------------------------------------------------------------------------
    // Watch (Change Streams)
    // -------------------------------------------------------------------------

    /**
     * Watch for changes on this collection.
     */
    fun watch(pipeline: AggregateBuilder.() -> Unit = {}): Flow<ChangeEvent<T>> = flow {
        val stages = AggregateBuilder().apply(pipeline).build()
        // TODO: Implement change stream via Cap'n Web RPC streaming
        throw NotImplementedError("Change streams not yet implemented")
    }
}

// =============================================================================
// Cursors
// =============================================================================

/**
 * A cursor for find operations.
 */
class FindCursor<T> internal constructor(
    private val connection: MongoConnection,
    private val database: String,
    private val collection: String,
    private val serializer: KSerializer<T>,
    private val filter: JsonObject
) {
    private var projection: JsonObject? = null
    private var sortDoc: JsonObject? = null
    private var skipCount: Int? = null
    private var limitCount: Int? = null
    private var hintIndex: String? = null

    /**
     * Project specific fields.
     */
    fun project(projection: ProjectionBuilder.() -> Unit): FindCursor<T> {
        this.projection = ProjectionBuilder().apply(projection).build()
        return this
    }

    /**
     * Sort the results.
     */
    fun sort(sort: SortBuilder.() -> Unit): FindCursor<T> {
        this.sortDoc = SortBuilder().apply(sort).build()
        return this
    }

    /**
     * Skip a number of documents.
     */
    fun skip(count: Int): FindCursor<T> {
        this.skipCount = count
        return this
    }

    /**
     * Limit the number of documents.
     */
    fun limit(count: Int): FindCursor<T> {
        this.limitCount = count
        return this
    }

    /**
     * Use a specific index.
     */
    fun hint(indexName: String): FindCursor<T> {
        this.hintIndex = indexName
        return this
    }

    /**
     * Execute and return results as a Flow.
     */
    fun asFlow(): Flow<T> = flow {
        val results: List<T> = connection.execute(
            "find",
            database,
            collection,
            filter,
            projection,
            sortDoc,
            skipCount,
            limitCount,
            hintIndex
        )
        results.forEach { emit(it) }
    }

    /**
     * Execute and return all results as a list.
     */
    suspend fun toList(): List<T> = asFlow().toList()

    /**
     * Execute and return the first result.
     */
    suspend fun first(): T? = limit(1).toList().firstOrNull()

    /**
     * Execute and return the first result or throw.
     */
    suspend fun firstOrThrow(): T = first() ?: throw MongoException.NotFound("No document found")

    /**
     * Execute and collect results.
     */
    suspend fun <R> collect(collector: FlowCollector<T>): R where R : Unit {
        @Suppress("UNCHECKED_CAST")
        return asFlow().collect(collector) as R
    }
}

/**
 * A cursor for aggregation operations.
 */
class AggregateCursor<T> internal constructor(
    private val connection: MongoConnection,
    private val database: String,
    private val collection: String,
    private val serializer: KSerializer<T>,
    private val pipeline: List<JsonObject>
) {
    private var allowDiskUse: Boolean = false
    private var batchSize: Int? = null

    /**
     * Allow disk use for large aggregations.
     */
    fun allowDiskUse(): AggregateCursor<T> {
        this.allowDiskUse = true
        return this
    }

    /**
     * Set batch size for cursor.
     */
    fun batchSize(size: Int): AggregateCursor<T> {
        this.batchSize = size
        return this
    }

    /**
     * Execute and return results as a Flow.
     */
    fun asFlow(): Flow<T> = flow {
        val results: List<T> = connection.execute(
            "aggregate",
            database,
            collection,
            pipeline,
            allowDiskUse,
            batchSize
        )
        results.forEach { emit(it) }
    }

    /**
     * Execute and return all results as a list.
     */
    suspend fun toList(): List<T> = asFlow().toList()

    /**
     * Execute and return the first result.
     */
    suspend fun first(): T? = toList().firstOrNull()
}

// =============================================================================
// Result Types
// =============================================================================

@Serializable
data class InsertOneResult(
    val insertedId: String,
    val acknowledged: Boolean = true
)

@Serializable
data class InsertManyResult(
    val insertedIds: List<String>,
    val acknowledged: Boolean = true
)

@Serializable
data class UpdateResult(
    val matchedCount: Long,
    val modifiedCount: Long,
    val upsertedId: String? = null,
    val acknowledged: Boolean = true
)

@Serializable
data class DeleteResult(
    val deletedCount: Long,
    val acknowledged: Boolean = true
)

@Serializable
data class BulkWriteResult(
    val insertedCount: Int,
    val matchedCount: Int,
    val modifiedCount: Int,
    val deletedCount: Int,
    val upsertedCount: Int,
    val upsertedIds: Map<Int, String> = emptyMap()
)

@Serializable
data class IndexInfo(
    val name: String,
    val key: JsonObject,
    val unique: Boolean = false,
    val sparse: Boolean = false
)

@Serializable
data class IndexOptions(
    val name: String? = null,
    val unique: Boolean = false,
    val sparse: Boolean = false,
    val expireAfterSeconds: Long? = null,
    val background: Boolean = false
)

@Serializable
data class FindOneAndUpdateOptions(
    val returnDocument: ReturnDocument = ReturnDocument.BEFORE,
    val upsert: Boolean = false,
    val projection: JsonObject? = null,
    val sort: JsonObject? = null
)

@Serializable
enum class ReturnDocument {
    BEFORE,
    AFTER
}

@Serializable
data class ChangeEvent<T>(
    val operationType: String,
    val documentKey: JsonObject,
    val fullDocument: T? = null,
    val updateDescription: UpdateDescription? = null
)

@Serializable
data class UpdateDescription(
    val updatedFields: JsonObject,
    val removedFields: List<String>
)

// =============================================================================
// Exceptions
// =============================================================================

/**
 * MongoDB-specific exceptions.
 */
sealed class MongoException(
    override val message: String,
    val code: String? = null
) : Exception(message) {

    data class ConnectionFailed(val host: String, override val cause: Throwable?) :
        MongoException("Failed to connect to MongoDB at $host", "ConnectionFailed")

    data class NotFound(val details: String) :
        MongoException("Document not found: $details", "NotFound")

    data class DuplicateKey(val key: String) :
        MongoException("Duplicate key error: $key", "DuplicateKey")

    data class WriteError(val errors: List<WriteErrorDetail>) :
        MongoException("Write error: ${errors.joinToString()}", "WriteError")

    data class Timeout(val operation: String, val duration: Duration) :
        MongoException("Operation '$operation' timed out after $duration", "Timeout")

    data class ValidationFailed(val errors: List<String>) :
        MongoException("Validation failed: ${errors.joinToString()}", "ValidationFailed")

    data class CommandFailed(val command: String, override val message: String) :
        MongoException("Command '$command' failed: $message", "CommandFailed")
}

@Serializable
data class WriteErrorDetail(
    val index: Int,
    val code: Int,
    val message: String
)
