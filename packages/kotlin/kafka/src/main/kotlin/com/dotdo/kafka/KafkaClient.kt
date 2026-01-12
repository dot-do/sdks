package com.dotdo.kafka

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
 * DotDo Kafka SDK for Kotlin
 *
 * A coroutine-native Kafka client with Cap'n Web RPC transport.
 * Features:
 * - Type-safe message production and consumption with kotlinx.serialization
 * - Kotlin Flow-based message streaming
 * - Consumer groups with automatic rebalancing
 * - Exactly-once semantics support
 * - DSL builders for configuration
 * - Backpressure handling
 *
 * @example
 * ```kotlin
 * // Connect to Kafka
 * val kafka = KafkaClient.connect("https://kafka.do") {
 *     auth { apiKey("my-key") }
 *     producer {
 *         acks = Acks.ALL
 *         compression = Compression.SNAPPY
 *     }
 *     consumer {
 *         groupId = "my-service"
 *         autoCommit = false
 *     }
 * }
 *
 * // Produce messages
 * val producer = kafka.producer<String, UserEvent>("user-events")
 * producer.send("user-123", UserEvent.Created(name = "Alice"))
 *
 * // Consume messages as a Flow
 * kafka.consumer<String, UserEvent>("user-events") { groupId = "processor" }
 *     .subscribe()
 *     .collect { record ->
 *         println("Received: ${record.value}")
 *         record.ack()
 *     }
 *
 * // Stream processing with operators
 * kafka.consumer<String, OrderEvent>("orders")
 *     .subscribe()
 *     .filter { it.value is OrderEvent.Completed }
 *     .map { record -> ProcessedOrder(record.key, record.value) }
 *     .buffer(100)
 *     .collect { /* process */ }
 * ```
 */
object KafkaClient {

    /**
     * Connect to a Kafka cluster via Cap'n Web RPC.
     */
    suspend fun connect(url: String): KafkaConnection = KafkaConnection(url, KafkaConfig())

    /**
     * Connect with DSL configuration.
     */
    suspend fun connect(url: String, configure: KafkaConfig.() -> Unit): KafkaConnection {
        val config = KafkaConfig().apply(configure)
        return KafkaConnection(url, config)
    }

    /**
     * Builder pattern for connection configuration.
     */
    fun builder(url: String): KafkaConnectionBuilder = KafkaConnectionBuilder(url)
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for Kafka connection.
 */
class KafkaConfig {
    var timeout: Duration = 30.seconds
    var authProvider: KafkaAuthProvider? = null
    var producerConfig: ProducerConfig = ProducerConfig()
    var consumerConfig: ConsumerConfig = ConsumerConfig()
    var adminConfig: AdminConfig = AdminConfig()

    /**
     * Configure authentication.
     */
    fun auth(configure: KafkaAuthConfig.() -> Unit) {
        val authConfig = KafkaAuthConfig().apply(configure)
        authProvider = when {
            authConfig.apiKey != null -> KafkaAuthProvider.ApiKey(authConfig.apiKey!!)
            authConfig.sasl != null -> authConfig.sasl
            else -> null
        }
    }

    /**
     * Configure producer defaults.
     */
    fun producer(configure: ProducerConfig.() -> Unit) {
        producerConfig = ProducerConfig().apply(configure)
    }

    /**
     * Configure consumer defaults.
     */
    fun consumer(configure: ConsumerConfig.() -> Unit) {
        consumerConfig = ConsumerConfig().apply(configure)
    }

    /**
     * Configure admin client.
     */
    fun admin(configure: AdminConfig.() -> Unit) {
        adminConfig = AdminConfig().apply(configure)
    }
}

class KafkaAuthConfig {
    var apiKey: String? = null
    var sasl: KafkaAuthProvider.Sasl? = null

    fun apiKey(key: String) {
        apiKey = key
    }

    fun sasl(
        mechanism: SaslMechanism,
        username: String,
        password: String
    ) {
        sasl = KafkaAuthProvider.Sasl(mechanism, username, password)
    }

    fun saslScram256(username: String, password: String) {
        sasl(SaslMechanism.SCRAM_SHA_256, username, password)
    }

    fun saslScram512(username: String, password: String) {
        sasl(SaslMechanism.SCRAM_SHA_512, username, password)
    }

    fun saslPlain(username: String, password: String) {
        sasl(SaslMechanism.PLAIN, username, password)
    }
}

/**
 * Authentication providers for Kafka.
 */
sealed class KafkaAuthProvider {
    abstract fun toHeaders(): Map<String, String>

    data class ApiKey(val key: String) : KafkaAuthProvider() {
        override fun toHeaders() = mapOf("Authorization" to "Bearer $key")
    }

    data class Sasl(
        val mechanism: SaslMechanism,
        val username: String,
        val password: String
    ) : KafkaAuthProvider() {
        override fun toHeaders() = mapOf(
            "X-Kafka-SASL-Mechanism" to mechanism.value,
            "X-Kafka-SASL-Username" to username
        )
    }
}

enum class SaslMechanism(val value: String) {
    PLAIN("PLAIN"),
    SCRAM_SHA_256("SCRAM-SHA-256"),
    SCRAM_SHA_512("SCRAM-SHA-512"),
    OAUTHBEARER("OAUTHBEARER")
}

/**
 * Producer configuration.
 */
class ProducerConfig {
    var acks: Acks = Acks.ALL
    var compression: Compression = Compression.NONE
    var batchSize: Int = 16384
    var lingerMs: Long = 0
    var maxInFlightRequests: Int = 5
    var retries: Int = Int.MAX_VALUE
    var deliveryTimeout: Duration = 2.seconds
    var idempotence: Boolean = true
    var transactionalId: String? = null
}

enum class Acks(val value: String) {
    NONE("0"),
    LEADER("1"),
    ALL("all")
}

enum class Compression(val value: String) {
    NONE("none"),
    GZIP("gzip"),
    SNAPPY("snappy"),
    LZ4("lz4"),
    ZSTD("zstd")
}

/**
 * Consumer configuration.
 */
class ConsumerConfig {
    var groupId: String? = null
    var autoCommit: Boolean = true
    var autoCommitInterval: Duration = 5.seconds
    var autoOffsetReset: AutoOffsetReset = AutoOffsetReset.LATEST
    var maxPollRecords: Int = 500
    var maxPollInterval: Duration = 5.seconds
    var sessionTimeout: Duration = 45.seconds
    var heartbeatInterval: Duration = 3.seconds
    var isolationLevel: IsolationLevel = IsolationLevel.READ_UNCOMMITTED
}

enum class AutoOffsetReset(val value: String) {
    EARLIEST("earliest"),
    LATEST("latest"),
    NONE("none")
}

enum class IsolationLevel(val value: String) {
    READ_UNCOMMITTED("read_uncommitted"),
    READ_COMMITTED("read_committed")
}

/**
 * Admin client configuration.
 */
class AdminConfig {
    var requestTimeout: Duration = 30.seconds
}

/**
 * Builder for Kafka connections.
 */
class KafkaConnectionBuilder(private val url: String) {
    private val config = KafkaConfig()

    fun timeout(duration: Duration): KafkaConnectionBuilder {
        config.timeout = duration
        return this
    }

    fun apiKey(key: String): KafkaConnectionBuilder {
        config.authProvider = KafkaAuthProvider.ApiKey(key)
        return this
    }

    fun producer(configure: ProducerConfig.() -> Unit): KafkaConnectionBuilder {
        config.producer(configure)
        return this
    }

    fun consumer(configure: ConsumerConfig.() -> Unit): KafkaConnectionBuilder {
        config.consumer(configure)
        return this
    }

    suspend fun build(): KafkaConnection = KafkaConnection(url, config)
}

// =============================================================================
// Connection
// =============================================================================

/**
 * A Kafka connection.
 */
class KafkaConnection internal constructor(
    private val url: String,
    private val config: KafkaConfig
) : AutoCloseable {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private var closed = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val producers = mutableMapOf<String, KafkaProducer<*, *>>()
    private val consumers = mutableMapOf<String, KafkaConsumer<*, *>>()

    /**
     * Create a typed producer for a topic.
     */
    inline fun <reified K, reified V> producer(
        topic: String,
        noinline configure: ProducerConfig.() -> Unit = {}
    ): KafkaProducer<K, V> {
        val producerConfig = ProducerConfig().apply {
            // Copy defaults
            acks = this@KafkaConnection.config.producerConfig.acks
            compression = this@KafkaConnection.config.producerConfig.compression
            batchSize = this@KafkaConnection.config.producerConfig.batchSize
            lingerMs = this@KafkaConnection.config.producerConfig.lingerMs
            idempotence = this@KafkaConnection.config.producerConfig.idempotence
        }.apply(configure)

        return KafkaProducer(
            this,
            topic,
            producerConfig,
            serializer<K>(),
            serializer<V>()
        )
    }

    /**
     * Create a typed consumer for a topic.
     */
    inline fun <reified K, reified V> consumer(
        topic: String,
        noinline configure: ConsumerConfig.() -> Unit = {}
    ): KafkaConsumer<K, V> {
        val consumerConfig = ConsumerConfig().apply {
            // Copy defaults
            groupId = this@KafkaConnection.config.consumerConfig.groupId
            autoCommit = this@KafkaConnection.config.consumerConfig.autoCommit
            autoOffsetReset = this@KafkaConnection.config.consumerConfig.autoOffsetReset
            maxPollRecords = this@KafkaConnection.config.consumerConfig.maxPollRecords
        }.apply(configure)

        return KafkaConsumer(
            this,
            topic,
            consumerConfig,
            serializer<K>(),
            serializer<V>()
        )
    }

    /**
     * Get admin client for topic management.
     */
    fun admin(): KafkaAdmin = KafkaAdmin(this, config.adminConfig)

    /**
     * List all topics.
     */
    suspend fun listTopics(): List<TopicInfo> {
        return execute("listTopics")
    }

    /**
     * Check if connection is healthy.
     */
    fun isConnected(): Boolean = !closed

    /**
     * Close the connection and all producers/consumers.
     */
    override fun close() {
        closed = true
        producers.values.forEach { it.close() }
        consumers.values.forEach { it.close() }
        scope.cancel()
    }

    // Internal: Execute a command
    internal suspend fun <T> execute(command: String, vararg args: Any?): T {
        // TODO: Real implementation would send over Cap'n Web RPC
        throw NotImplementedError("Kafka transport not yet implemented")
    }

    // Internal: Stream from server
    internal fun <T> stream(command: String, vararg args: Any?): Flow<T> = flow {
        // TODO: Real implementation would use Cap'n Web RPC streaming
        throw NotImplementedError("Kafka streaming not yet implemented")
    }
}

/**
 * Topic information.
 */
@Serializable
data class TopicInfo(
    val name: String,
    val partitions: Int,
    val replicationFactor: Int,
    val configs: Map<String, String> = emptyMap()
)

// =============================================================================
// Producer
// =============================================================================

/**
 * A typed Kafka producer.
 */
class KafkaProducer<K, V> internal constructor(
    private val connection: KafkaConnection,
    private val topic: String,
    private val config: ProducerConfig,
    private val keySerializer: KSerializer<K>,
    private val valueSerializer: KSerializer<V>
) : AutoCloseable {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private var closed = false
    private val pendingBatch = mutableListOf<ProducerRecord<K, V>>()
    private val batchMutex = Mutex()

    /**
     * Send a message to the topic.
     */
    suspend fun send(key: K, value: V): RecordMetadata {
        return send(ProducerRecord(topic, key, value))
    }

    /**
     * Send a message with headers.
     */
    suspend fun send(
        key: K,
        value: V,
        headers: Map<String, ByteArray> = emptyMap()
    ): RecordMetadata {
        return send(ProducerRecord(topic, key, value, headers = headers))
    }

    /**
     * Send a message to a specific partition.
     */
    suspend fun send(
        key: K,
        value: V,
        partition: Int
    ): RecordMetadata {
        return send(ProducerRecord(topic, key, value, partition = partition))
    }

    /**
     * Send a producer record.
     */
    suspend fun send(record: ProducerRecord<K, V>): RecordMetadata {
        val keyJson = json.encodeToJsonElement(keySerializer, record.key)
        val valueJson = json.encodeToJsonElement(valueSerializer, record.value)
        return connection.execute(
            "produce",
            record.topic,
            keyJson,
            valueJson,
            record.partition,
            record.timestamp,
            record.headers.mapValues { it.value.decodeToString() }
        )
    }

    /**
     * Send a message without waiting for acknowledgment.
     */
    fun sendAsync(key: K, value: V): Deferred<RecordMetadata> {
        return CoroutineScope(Dispatchers.IO).async {
            send(key, value)
        }
    }

    /**
     * Send multiple messages in a batch.
     */
    suspend fun sendBatch(records: List<Pair<K, V>>): List<RecordMetadata> {
        val producerRecords = records.map { (key, value) ->
            ProducerRecord(topic, key, value)
        }
        return sendBatchRecords(producerRecords)
    }

    /**
     * Send multiple producer records in a batch.
     */
    suspend fun sendBatchRecords(records: List<ProducerRecord<K, V>>): List<RecordMetadata> {
        val serializedRecords = records.map { record ->
            buildJsonObject {
                put("topic", record.topic)
                put("key", json.encodeToJsonElement(keySerializer, record.key))
                put("value", json.encodeToJsonElement(valueSerializer, record.value))
                record.partition?.let { put("partition", it) }
                record.timestamp?.let { put("timestamp", it) }
                if (record.headers.isNotEmpty()) {
                    putJsonObject("headers") {
                        record.headers.forEach { (k, v) -> put(k, v.decodeToString()) }
                    }
                }
            }
        }
        return connection.execute("produceBatch", topic, serializedRecords)
    }

    /**
     * Begin a transaction.
     */
    suspend fun beginTransaction() {
        check(config.transactionalId != null) { "Transactional ID must be set for transactions" }
        connection.execute<Unit>("beginTransaction", config.transactionalId)
    }

    /**
     * Commit current transaction.
     */
    suspend fun commitTransaction() {
        connection.execute<Unit>("commitTransaction", config.transactionalId)
    }

    /**
     * Abort current transaction.
     */
    suspend fun abortTransaction() {
        connection.execute<Unit>("abortTransaction", config.transactionalId)
    }

    /**
     * Execute a block within a transaction.
     */
    suspend fun <T> transaction(block: suspend KafkaProducer<K, V>.() -> T): T {
        beginTransaction()
        return try {
            val result = block()
            commitTransaction()
            result
        } catch (e: Exception) {
            abortTransaction()
            throw e
        }
    }

    /**
     * Flush pending messages.
     */
    suspend fun flush() {
        connection.execute<Unit>("flush", topic)
    }

    override fun close() {
        closed = true
    }
}

/**
 * A producer record.
 */
data class ProducerRecord<K, V>(
    val topic: String,
    val key: K,
    val value: V,
    val partition: Int? = null,
    val timestamp: Long? = null,
    val headers: Map<String, ByteArray> = emptyMap()
)

/**
 * Metadata for a sent record.
 */
@Serializable
data class RecordMetadata(
    val topic: String,
    val partition: Int,
    val offset: Long,
    val timestamp: Long,
    val serializedKeySize: Int,
    val serializedValueSize: Int
)

// =============================================================================
// Consumer
// =============================================================================

/**
 * A typed Kafka consumer.
 */
class KafkaConsumer<K, V> internal constructor(
    private val connection: KafkaConnection,
    private val topic: String,
    private val config: ConsumerConfig,
    private val keySerializer: KSerializer<K>,
    private val valueSerializer: KSerializer<V>
) : AutoCloseable {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private var closed = false
    private val commitMutex = Mutex()

    /**
     * Subscribe and consume messages as a Flow.
     */
    fun subscribe(): Flow<ConsumerRecord<K, V>> = flow {
        check(config.groupId != null) { "Consumer group ID must be set" }

        connection.stream<JsonObject>("subscribe", topic, config.groupId, buildConfig())
            .collect { rawRecord ->
                val record = parseRecord(rawRecord)
                emit(record)
            }
    }

    /**
     * Subscribe to multiple topics.
     */
    fun subscribe(vararg topics: String): Flow<ConsumerRecord<K, V>> = flow {
        check(config.groupId != null) { "Consumer group ID must be set" }

        connection.stream<JsonObject>("subscribeMultiple", topics.toList(), config.groupId, buildConfig())
            .collect { rawRecord ->
                val record = parseRecord(rawRecord)
                emit(record)
            }
    }

    /**
     * Subscribe with pattern matching.
     */
    fun subscribePattern(pattern: String): Flow<ConsumerRecord<K, V>> = flow {
        check(config.groupId != null) { "Consumer group ID must be set" }

        connection.stream<JsonObject>("subscribePattern", pattern, config.groupId, buildConfig())
            .collect { rawRecord ->
                val record = parseRecord(rawRecord)
                emit(record)
            }
    }

    /**
     * Assign specific partitions (no consumer group).
     */
    fun assign(vararg partitions: TopicPartition): Flow<ConsumerRecord<K, V>> = flow {
        connection.stream<JsonObject>("assign", partitions.toList(), buildConfig())
            .collect { rawRecord ->
                val record = parseRecord(rawRecord)
                emit(record)
            }
    }

    /**
     * Seek to a specific offset.
     */
    suspend fun seek(partition: TopicPartition, offset: Long) {
        connection.execute<Unit>("seek", partition, offset)
    }

    /**
     * Seek to the beginning of partitions.
     */
    suspend fun seekToBeginning(vararg partitions: TopicPartition) {
        connection.execute<Unit>("seekToBeginning", partitions.toList())
    }

    /**
     * Seek to the end of partitions.
     */
    suspend fun seekToEnd(vararg partitions: TopicPartition) {
        connection.execute<Unit>("seekToEnd", partitions.toList())
    }

    /**
     * Commit offsets synchronously.
     */
    suspend fun commitSync() {
        commitMutex.withLock {
            connection.execute<Unit>("commitSync", topic, config.groupId)
        }
    }

    /**
     * Commit specific offsets.
     */
    suspend fun commitSync(offsets: Map<TopicPartition, OffsetAndMetadata>) {
        commitMutex.withLock {
            connection.execute<Unit>("commitSyncOffsets", offsets)
        }
    }

    /**
     * Get current position for a partition.
     */
    suspend fun position(partition: TopicPartition): Long {
        return connection.execute("position", partition)
    }

    /**
     * Get committed offset for a partition.
     */
    suspend fun committed(partition: TopicPartition): OffsetAndMetadata? {
        return connection.execute("committed", partition)
    }

    /**
     * Pause consumption from partitions.
     */
    suspend fun pause(vararg partitions: TopicPartition) {
        connection.execute<Unit>("pause", partitions.toList())
    }

    /**
     * Resume consumption from paused partitions.
     */
    suspend fun resume(vararg partitions: TopicPartition) {
        connection.execute<Unit>("resume", partitions.toList())
    }

    /**
     * Get paused partitions.
     */
    suspend fun paused(): Set<TopicPartition> {
        return connection.execute("paused")
    }

    private fun buildConfig(): JsonObject = buildJsonObject {
        put("autoCommit", config.autoCommit)
        put("autoCommitInterval", config.autoCommitInterval.inWholeMilliseconds)
        put("autoOffsetReset", config.autoOffsetReset.value)
        put("maxPollRecords", config.maxPollRecords)
        put("maxPollInterval", config.maxPollInterval.inWholeMilliseconds)
        put("sessionTimeout", config.sessionTimeout.inWholeMilliseconds)
        put("heartbeatInterval", config.heartbeatInterval.inWholeMilliseconds)
        put("isolationLevel", config.isolationLevel.value)
    }

    private fun parseRecord(rawRecord: JsonObject): ConsumerRecord<K, V> {
        val key = json.decodeFromJsonElement(keySerializer, rawRecord["key"]!!)
        val value = json.decodeFromJsonElement(valueSerializer, rawRecord["value"]!!)
        val headers = rawRecord["headers"]?.jsonObject?.mapValues {
            it.value.jsonPrimitive.content.encodeToByteArray()
        } ?: emptyMap()

        return ConsumerRecord(
            topic = rawRecord["topic"]!!.jsonPrimitive.content,
            partition = rawRecord["partition"]!!.jsonPrimitive.int,
            offset = rawRecord["offset"]!!.jsonPrimitive.long,
            timestamp = rawRecord["timestamp"]!!.jsonPrimitive.long,
            timestampType = TimestampType.valueOf(rawRecord["timestampType"]?.jsonPrimitive?.content ?: "CREATE_TIME"),
            key = key,
            value = value,
            headers = headers,
            consumer = this
        )
    }

    override fun close() {
        closed = true
    }
}

/**
 * A consumer record.
 */
data class ConsumerRecord<K, V>(
    val topic: String,
    val partition: Int,
    val offset: Long,
    val timestamp: Long,
    val timestampType: TimestampType,
    val key: K,
    val value: V,
    val headers: Map<String, ByteArray>,
    private val consumer: KafkaConsumer<K, V>
) {
    /**
     * Acknowledge this record (commit offset).
     */
    suspend fun ack() {
        consumer.commitSync(mapOf(
            TopicPartition(topic, partition) to OffsetAndMetadata(offset + 1)
        ))
    }

    /**
     * Get a header value.
     */
    fun header(key: String): ByteArray? = headers[key]

    /**
     * Get a header value as string.
     */
    fun headerString(key: String): String? = headers[key]?.decodeToString()
}

enum class TimestampType {
    CREATE_TIME,
    LOG_APPEND_TIME,
    NO_TIMESTAMP_TYPE
}

@Serializable
data class TopicPartition(
    val topic: String,
    val partition: Int
)

@Serializable
data class OffsetAndMetadata(
    val offset: Long,
    val metadata: String = "",
    val leaderEpoch: Int? = null
)

// =============================================================================
// Admin
// =============================================================================

/**
 * Kafka admin client for topic management.
 */
class KafkaAdmin internal constructor(
    private val connection: KafkaConnection,
    private val config: AdminConfig
) {
    /**
     * Create a new topic.
     */
    suspend fun createTopic(
        name: String,
        partitions: Int = 1,
        replicationFactor: Short = 1,
        configs: Map<String, String> = emptyMap()
    ) {
        connection.execute<Unit>("createTopic", name, partitions, replicationFactor, configs)
    }

    /**
     * Create a topic with DSL configuration.
     */
    suspend fun createTopic(name: String, configure: NewTopicConfig.() -> Unit) {
        val topicConfig = NewTopicConfig().apply(configure)
        createTopic(name, topicConfig.partitions, topicConfig.replicationFactor, topicConfig.configs)
    }

    /**
     * Delete a topic.
     */
    suspend fun deleteTopic(name: String) {
        connection.execute<Unit>("deleteTopic", name)
    }

    /**
     * Delete multiple topics.
     */
    suspend fun deleteTopics(vararg names: String) {
        connection.execute<Unit>("deleteTopics", names.toList())
    }

    /**
     * List all topics.
     */
    suspend fun listTopics(internal: Boolean = false): List<String> {
        return connection.execute("listTopicNames", internal)
    }

    /**
     * Describe a topic.
     */
    suspend fun describeTopic(name: String): TopicDescription {
        return connection.execute("describeTopic", name)
    }

    /**
     * Describe multiple topics.
     */
    suspend fun describeTopics(vararg names: String): Map<String, TopicDescription> {
        return connection.execute("describeTopics", names.toList())
    }

    /**
     * Get topic configuration.
     */
    suspend fun describeConfig(topic: String): Map<String, ConfigEntry> {
        return connection.execute("describeConfig", topic)
    }

    /**
     * Alter topic configuration.
     */
    suspend fun alterConfig(topic: String, configs: Map<String, String>) {
        connection.execute<Unit>("alterConfig", topic, configs)
    }

    /**
     * Create partitions for a topic.
     */
    suspend fun createPartitions(topic: String, totalCount: Int) {
        connection.execute<Unit>("createPartitions", topic, totalCount)
    }

    /**
     * List consumer groups.
     */
    suspend fun listConsumerGroups(): List<ConsumerGroupListing> {
        return connection.execute("listConsumerGroups")
    }

    /**
     * Describe a consumer group.
     */
    suspend fun describeConsumerGroup(groupId: String): ConsumerGroupDescription {
        return connection.execute("describeConsumerGroup", groupId)
    }

    /**
     * Delete a consumer group.
     */
    suspend fun deleteConsumerGroup(groupId: String) {
        connection.execute<Unit>("deleteConsumerGroup", groupId)
    }

    /**
     * Get cluster info.
     */
    suspend fun describeCluster(): ClusterDescription {
        return connection.execute("describeCluster")
    }
}

class NewTopicConfig {
    var partitions: Int = 1
    var replicationFactor: Short = 1
    var configs: MutableMap<String, String> = mutableMapOf()

    fun config(key: String, value: String) {
        configs[key] = value
    }

    fun retention(duration: Duration) {
        configs["retention.ms"] = duration.inWholeMilliseconds.toString()
    }

    fun compaction() {
        configs["cleanup.policy"] = "compact"
    }

    fun maxMessageSize(bytes: Int) {
        configs["max.message.bytes"] = bytes.toString()
    }
}

@Serializable
data class TopicDescription(
    val name: String,
    val internal: Boolean,
    val partitions: List<PartitionInfo>,
    val authorizedOperations: Set<String> = emptySet()
)

@Serializable
data class PartitionInfo(
    val partition: Int,
    val leader: Node?,
    val replicas: List<Node>,
    val isr: List<Node>
)

@Serializable
data class Node(
    val id: Int,
    val host: String,
    val port: Int,
    val rack: String? = null
)

@Serializable
data class ConfigEntry(
    val name: String,
    val value: String?,
    val source: ConfigSource,
    val isSensitive: Boolean,
    val isReadOnly: Boolean
)

@Serializable
enum class ConfigSource {
    DYNAMIC_TOPIC_CONFIG,
    DYNAMIC_BROKER_CONFIG,
    DYNAMIC_DEFAULT_BROKER_CONFIG,
    STATIC_BROKER_CONFIG,
    DEFAULT_CONFIG,
    UNKNOWN
}

@Serializable
data class ConsumerGroupListing(
    val groupId: String,
    val isSimpleConsumerGroup: Boolean,
    val state: ConsumerGroupState? = null
)

@Serializable
data class ConsumerGroupDescription(
    val groupId: String,
    val isSimpleConsumerGroup: Boolean,
    val members: List<MemberDescription>,
    val partitionAssignor: String,
    val state: ConsumerGroupState,
    val coordinator: Node
)

@Serializable
data class MemberDescription(
    val memberId: String,
    val clientId: String,
    val host: String,
    val assignment: List<TopicPartition>
)

@Serializable
enum class ConsumerGroupState {
    UNKNOWN,
    PREPARING_REBALANCE,
    COMPLETING_REBALANCE,
    STABLE,
    DEAD,
    EMPTY
}

@Serializable
data class ClusterDescription(
    val nodes: List<Node>,
    val controller: Node?,
    val clusterId: String
)

// =============================================================================
// Exceptions
// =============================================================================

/**
 * Kafka-specific exceptions.
 */
sealed class KafkaException(
    override val message: String,
    val code: String? = null
) : Exception(message) {

    data class ConnectionFailed(val host: String, override val cause: Throwable?) :
        KafkaException("Failed to connect to Kafka at $host", "ConnectionFailed")

    data class TopicNotFound(val topic: String) :
        KafkaException("Topic not found: $topic", "TopicNotFound")

    data class AuthenticationFailed(val reason: String) :
        KafkaException("Authentication failed: $reason", "AuthenticationFailed")

    data class AuthorizationFailed(val resource: String, val operation: String) :
        KafkaException("Not authorized to $operation on $resource", "AuthorizationFailed")

    data class SerializationError(val type: String, override val cause: Throwable?) :
        KafkaException("Failed to serialize $type", "SerializationError")

    data class DeserializationError(val type: String, override val cause: Throwable?) :
        KafkaException("Failed to deserialize $type", "DeserializationError")

    data class ProducerFenced(val transactionalId: String) :
        KafkaException("Producer with transactional ID $transactionalId has been fenced", "ProducerFenced")

    data class TransactionAborted(val reason: String) :
        KafkaException("Transaction aborted: $reason", "TransactionAborted")

    data class OffsetOutOfRange(val partition: TopicPartition, val offset: Long) :
        KafkaException("Offset $offset out of range for $partition", "OffsetOutOfRange")

    data class GroupCoordinatorNotAvailable(val groupId: String) :
        KafkaException("Group coordinator not available for $groupId", "GroupCoordinatorNotAvailable")

    data class RebalanceInProgress(val groupId: String) :
        KafkaException("Rebalance in progress for group $groupId", "RebalanceInProgress")

    data class Timeout(val operation: String, val duration: Duration) :
        KafkaException("Operation '$operation' timed out after $duration", "Timeout")
}

// =============================================================================
// Flow Extensions
// =============================================================================

/**
 * Process records in batches.
 */
fun <K, V> Flow<ConsumerRecord<K, V>>.batch(
    size: Int,
    timeout: Duration = 1.seconds
): Flow<List<ConsumerRecord<K, V>>> = flow {
    val batch = mutableListOf<ConsumerRecord<K, V>>()
    val timeoutJob = CoroutineScope(currentCoroutineContext()).launch {
        while (true) {
            delay(timeout)
            if (batch.isNotEmpty()) {
                emit(batch.toList())
                batch.clear()
            }
        }
    }

    try {
        collect { record ->
            batch.add(record)
            if (batch.size >= size) {
                emit(batch.toList())
                batch.clear()
            }
        }
        if (batch.isNotEmpty()) {
            emit(batch.toList())
        }
    } finally {
        timeoutJob.cancel()
    }
}

/**
 * Acknowledge after processing each record.
 */
fun <K, V> Flow<ConsumerRecord<K, V>>.withAutoAck(): Flow<ConsumerRecord<K, V>> = onEach { record ->
    record.ack()
}

/**
 * Retry failed record processing.
 */
fun <K, V, R> Flow<ConsumerRecord<K, V>>.mapWithRetry(
    maxRetries: Int = 3,
    delayMs: Long = 1000,
    transform: suspend (ConsumerRecord<K, V>) -> R
): Flow<R> = map { record ->
    var lastException: Throwable? = null
    repeat(maxRetries) { attempt ->
        try {
            return@map transform(record)
        } catch (e: Exception) {
            lastException = e
            if (attempt < maxRetries - 1) {
                delay(delayMs * (attempt + 1))
            }
        }
    }
    throw lastException!!
}

/**
 * Send failed records to a dead letter topic.
 */
fun <K, V> Flow<ConsumerRecord<K, V>>.withDeadLetterQueue(
    producer: KafkaProducer<K, V>,
    dlqTopic: String,
    onError: suspend (ConsumerRecord<K, V>, Throwable) -> Unit = { _, _ -> }
): Flow<ConsumerRecord<K, V>> = transform { record ->
    try {
        emit(record)
    } catch (e: Exception) {
        onError(record, e)
        producer.send(record.key, record.value)
    }
}
