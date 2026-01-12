namespace DotDo.Kafka

open System

/// Kafka client configuration.
type KafkaConfig = {
    /// The Kafka.do URL.
    Url: string
    /// API key for authentication.
    ApiKey: string option
    /// Request timeout.
    Timeout: TimeSpan
    /// Number of retry attempts.
    Retries: int
    /// Retry backoff configuration.
    RetryBackoffMs: int
}

module KafkaConfig =
    /// Creates a default configuration.
    let defaultConfig = {
        Url = Environment.GetEnvironmentVariable("KAFKA_DO_URL") |> Option.ofObj |> Option.defaultValue "https://kafka.do"
        ApiKey = Environment.GetEnvironmentVariable("KAFKA_DO_API_KEY") |> Option.ofObj
        Timeout = TimeSpan.FromSeconds(30.0)
        Retries = 3
        RetryBackoffMs = 100
    }

    /// Creates a configuration with a custom URL.
    let withUrl url config = { config with Url = url }

    /// Creates a configuration with an API key.
    let withApiKey apiKey config = { config with ApiKey = Some apiKey }

    /// Creates a configuration with a custom timeout.
    let withTimeout timeout config = { config with Timeout = timeout }

    /// Creates a configuration with retry settings.
    let withRetries retries backoffMs config =
        { config with Retries = retries; RetryBackoffMs = backoffMs }

/// Producer configuration.
type ProducerConfig = {
    /// Batch size in bytes.
    BatchSize: int
    /// Linger time in milliseconds.
    LingerMs: int
    /// Compression type.
    Compression: Compression
    /// Acknowledgment mode.
    Acks: Acks
    /// Number of retry attempts.
    Retries: int
    /// Retry backoff in milliseconds.
    RetryBackoffMs: int
}

/// Compression types for messages.
and Compression =
    | None
    | Gzip
    | Snappy
    | Lz4
    | Zstd

/// Acknowledgment modes for producer.
and Acks =
    /// No acknowledgment required.
    | Zero
    /// Wait for leader acknowledgment.
    | One
    /// Wait for all replicas.
    | All

module ProducerConfig =
    /// Default producer configuration.
    let defaultConfig = {
        BatchSize = 16384
        LingerMs = 5
        Compression = None
        Acks = All
        Retries = 3
        RetryBackoffMs = 100
    }

    /// Sets the batch size.
    let withBatchSize size config = { config with BatchSize = size }

    /// Sets the linger time.
    let withLingerMs ms config = { config with LingerMs = ms }

    /// Sets the compression type.
    let withCompression compression config = { config with Compression = compression }

    /// Sets the acknowledgment mode.
    let withAcks acks config = { config with Acks = acks }

/// Consumer configuration.
type ConsumerConfig = {
    /// Starting offset.
    Offset: Offset
    /// Auto-commit enabled.
    AutoCommit: bool
    /// Minimum bytes to fetch.
    FetchMinBytes: int
    /// Maximum wait time in milliseconds.
    FetchMaxWaitMs: int
    /// Maximum records per poll.
    MaxPollRecords: int
    /// Session timeout.
    SessionTimeout: TimeSpan
    /// Heartbeat interval.
    HeartbeatInterval: TimeSpan
}

/// Starting offset for consumer.
and Offset =
    /// Start from the earliest available offset.
    | Earliest
    /// Start from the latest offset.
    | Latest
    /// Start from a specific offset.
    | Specific of int64
    /// Start from a specific timestamp.
    | Timestamp of DateTimeOffset

module ConsumerConfig =
    /// Default consumer configuration.
    let defaultConfig = {
        Offset = Latest
        AutoCommit = false
        FetchMinBytes = 1
        FetchMaxWaitMs = 500
        MaxPollRecords = 500
        SessionTimeout = TimeSpan.FromSeconds(30.0)
        HeartbeatInterval = TimeSpan.FromSeconds(3.0)
    }

    /// Sets the starting offset.
    let withOffset offset config = { config with Offset = offset }

    /// Enables or disables auto-commit.
    let withAutoCommit enabled config = { config with AutoCommit = enabled }

    /// Sets the maximum poll records.
    let withMaxPollRecords count config = { config with MaxPollRecords = count }

    /// Sets the session timeout.
    let withSessionTimeout timeout config = { config with SessionTimeout = timeout }

/// Batch consumer configuration.
type BatchConsumerConfig = {
    /// Batch size.
    BatchSize: int
    /// Batch timeout.
    BatchTimeout: TimeSpan
    /// Base consumer configuration.
    ConsumerConfig: ConsumerConfig
}

module BatchConsumerConfig =
    /// Default batch consumer configuration.
    let defaultConfig = {
        BatchSize = 100
        BatchTimeout = TimeSpan.FromSeconds(5.0)
        ConsumerConfig = ConsumerConfig.defaultConfig
    }

    /// Sets the batch size.
    let withBatchSize size config = { config with BatchSize = size }

    /// Sets the batch timeout.
    let withBatchTimeout timeout config = { config with BatchTimeout = timeout }

/// Topic configuration for admin operations.
type TopicConfig = {
    /// Number of partitions.
    Partitions: int
    /// Replication factor.
    ReplicationFactor: int
    /// Retention time in milliseconds.
    RetentionMs: int64 option
    /// Cleanup policy.
    CleanupPolicy: CleanupPolicy option
}

/// Cleanup policy for topics.
and CleanupPolicy =
    | Delete
    | Compact
    | CompactDelete

module TopicConfig =
    /// Default topic configuration.
    let defaultConfig = {
        Partitions = 1
        ReplicationFactor = 1
        RetentionMs = None
        CleanupPolicy = None
    }

    /// Sets the number of partitions.
    let withPartitions count config = { config with Partitions = count }

    /// Sets the replication factor.
    let withReplicationFactor factor config = { config with ReplicationFactor = factor }

    /// Sets the retention time.
    let withRetentionMs ms config = { config with RetentionMs = Some ms }

    /// Sets the cleanup policy.
    let withCleanupPolicy policy config = { config with CleanupPolicy = Some policy }
