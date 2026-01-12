<?php

declare(strict_types=1);

namespace DotDo\Kafka;

use Closure;
use JsonSerializable;
use Stringable;

/**
 * Compression types for Kafka messages
 */
enum CompressionType: string
{
    case None = 'none';
    case Gzip = 'gzip';
    case Snappy = 'snappy';
    case Lz4 = 'lz4';
    case Zstd = 'zstd';
}

/**
 * Acknowledgment modes for producer
 */
enum Acks: int
{
    case None = 0;      // Don't wait for any acknowledgment
    case Leader = 1;    // Wait for leader to acknowledge
    case All = -1;      // Wait for all replicas to acknowledge
}

/**
 * Offset reset strategies for consumer
 */
enum OffsetReset: string
{
    case Earliest = 'earliest';  // Start from beginning
    case Latest = 'latest';      // Start from end
    case None = 'none';          // Throw error if no offset found
}

/**
 * Isolation levels for consumer
 */
enum IsolationLevel: string
{
    case ReadUncommitted = 'read_uncommitted';
    case ReadCommitted = 'read_committed';
}

/**
 * Partition assignment strategies
 */
enum AssignmentStrategy: string
{
    case Range = 'range';
    case RoundRobin = 'roundrobin';
    case Sticky = 'sticky';
    case CooperativeSticky = 'cooperative-sticky';
}

/**
 * Kafka exception for general errors
 */
class KafkaException extends \Exception
{
    public function __construct(
        string $message,
        public readonly ?string $errorCode = null,
        public readonly ?array $details = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}

/**
 * Exception for producer errors
 */
class ProducerException extends KafkaException
{
    public function __construct(
        string $message,
        public readonly ?string $topic = null,
        public readonly ?int $partition = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 'PRODUCER_ERROR', [
            'topic' => $topic,
            'partition' => $partition,
        ], $previous);
    }
}

/**
 * Exception for consumer errors
 */
class ConsumerException extends KafkaException
{
    public function __construct(
        string $message,
        public readonly ?string $groupId = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 'CONSUMER_ERROR', [
            'groupId' => $groupId,
        ], $previous);
    }
}

/**
 * Exception for serialization errors
 */
class SerializationException extends KafkaException
{
    public function __construct(
        string $message,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 'SERIALIZATION_ERROR', previous: $previous);
    }
}

/**
 * Message headers collection
 */
class Headers implements \ArrayAccess, \IteratorAggregate, \Countable, JsonSerializable
{
    /** @var array<string, string[]> */
    private array $headers = [];

    public function __construct(array $headers = [])
    {
        foreach ($headers as $key => $value) {
            $this->add($key, $value);
        }
    }

    /**
     * Add a header (allows multiple values per key)
     */
    public function add(string $key, string|array $value): self
    {
        if (!isset($this->headers[$key])) {
            $this->headers[$key] = [];
        }

        if (is_array($value)) {
            $this->headers[$key] = array_merge($this->headers[$key], $value);
        } else {
            $this->headers[$key][] = $value;
        }

        return $this;
    }

    /**
     * Set a header (replaces existing values)
     */
    public function set(string $key, string|array $value): self
    {
        $this->headers[$key] = is_array($value) ? $value : [$value];
        return $this;
    }

    /**
     * Get all values for a header
     */
    public function get(string $key): array
    {
        return $this->headers[$key] ?? [];
    }

    /**
     * Get the first value for a header
     */
    public function getFirst(string $key): ?string
    {
        return $this->headers[$key][0] ?? null;
    }

    /**
     * Check if a header exists
     */
    public function has(string $key): bool
    {
        return isset($this->headers[$key]) && count($this->headers[$key]) > 0;
    }

    /**
     * Remove a header
     */
    public function remove(string $key): self
    {
        unset($this->headers[$key]);
        return $this;
    }

    /**
     * Get all headers
     */
    public function all(): array
    {
        return $this->headers;
    }

    // ArrayAccess implementation
    public function offsetExists(mixed $offset): bool
    {
        return $this->has($offset);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->getFirst($offset);
    }

    public function offsetSet(mixed $offset, mixed $value): void
    {
        $this->set($offset, $value);
    }

    public function offsetUnset(mixed $offset): void
    {
        $this->remove($offset);
    }

    // IteratorAggregate implementation
    public function getIterator(): \Traversable
    {
        return new \ArrayIterator($this->headers);
    }

    // Countable implementation
    public function count(): int
    {
        return count($this->headers);
    }

    // JsonSerializable implementation
    public function jsonSerialize(): array
    {
        return $this->headers;
    }
}

/**
 * Kafka message record
 */
readonly class Record implements JsonSerializable
{
    public function __construct(
        public string $topic,
        public mixed $value,
        public ?string $key = null,
        public ?int $partition = null,
        public ?Headers $headers = null,
        public ?int $timestamp = null,
        public ?int $offset = null,
    ) {}

    /**
     * Create a record for producing
     */
    public static function create(
        string $topic,
        mixed $value,
        ?string $key = null,
        ?int $partition = null,
        ?Headers $headers = null,
        ?int $timestamp = null,
    ): self {
        return new self(
            topic: $topic,
            value: $value,
            key: $key,
            partition: $partition,
            headers: $headers,
            timestamp: $timestamp ?? (int)(microtime(true) * 1000),
        );
    }

    /**
     * Create a record with JSON value
     */
    public static function json(
        string $topic,
        array $value,
        ?string $key = null,
        ?int $partition = null,
        ?Headers $headers = null,
    ): self {
        $jsonValue = json_encode($value);
        if ($jsonValue === false) {
            throw new SerializationException('Failed to encode JSON: ' . json_last_error_msg());
        }

        return self::create($topic, $jsonValue, $key, $partition, $headers);
    }

    /**
     * Get value decoded as JSON
     */
    public function valueAsJson(): mixed
    {
        if (!is_string($this->value)) {
            return $this->value;
        }

        $decoded = json_decode($this->value, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new SerializationException('Failed to decode JSON: ' . json_last_error_msg());
        }

        return $decoded;
    }

    /**
     * Get header value
     */
    public function header(string $key): ?string
    {
        return $this->headers?->getFirst($key);
    }

    public function jsonSerialize(): array
    {
        return [
            'topic' => $this->topic,
            'key' => $this->key,
            'value' => $this->value,
            'partition' => $this->partition,
            'headers' => $this->headers?->all(),
            'timestamp' => $this->timestamp,
            'offset' => $this->offset,
        ];
    }
}

/**
 * Metadata about a published record
 */
readonly class RecordMetadata
{
    public function __construct(
        public string $topic,
        public int $partition,
        public int $offset,
        public int $timestamp,
        public ?int $serializedKeySize = null,
        public ?int $serializedValueSize = null,
    ) {}
}

/**
 * Topic partition information
 */
readonly class TopicPartition implements Stringable, JsonSerializable
{
    public function __construct(
        public string $topic,
        public int $partition,
    ) {}

    public function __toString(): string
    {
        return "{$this->topic}-{$this->partition}";
    }

    public function jsonSerialize(): array
    {
        return [
            'topic' => $this->topic,
            'partition' => $this->partition,
        ];
    }
}

/**
 * Offset and metadata for a topic partition
 */
readonly class OffsetAndMetadata implements JsonSerializable
{
    public function __construct(
        public int $offset,
        public ?string $metadata = null,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'offset' => $this->offset,
            'metadata' => $this->metadata,
        ];
    }
}

/**
 * Partition info for a topic
 */
readonly class PartitionInfo implements JsonSerializable
{
    public function __construct(
        public string $topic,
        public int $partition,
        public int $leader,
        public array $replicas,
        public array $inSyncReplicas,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'topic' => $this->topic,
            'partition' => $this->partition,
            'leader' => $this->leader,
            'replicas' => $this->replicas,
            'inSyncReplicas' => $this->inSyncReplicas,
        ];
    }
}

/**
 * Topic description
 */
readonly class TopicDescription implements JsonSerializable
{
    public function __construct(
        public string $name,
        public bool $isInternal,
        /** @var PartitionInfo[] */
        public array $partitions,
    ) {}

    public function partitionCount(): int
    {
        return count($this->partitions);
    }

    public function jsonSerialize(): array
    {
        return [
            'name' => $this->name,
            'isInternal' => $this->isInternal,
            'partitions' => array_map(fn($p) => $p->jsonSerialize(), $this->partitions),
        ];
    }
}

/**
 * Consumer group member info
 */
readonly class MemberDescription implements JsonSerializable
{
    public function __construct(
        public string $memberId,
        public string $clientId,
        public string $host,
        /** @var TopicPartition[] */
        public array $assignment,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'memberId' => $this->memberId,
            'clientId' => $this->clientId,
            'host' => $this->host,
            'assignment' => array_map(fn($tp) => $tp->jsonSerialize(), $this->assignment),
        ];
    }
}

/**
 * Consumer group description
 */
readonly class ConsumerGroupDescription implements JsonSerializable
{
    public function __construct(
        public string $groupId,
        public string $state,
        public string $coordinator,
        public string $partitionAssignor,
        /** @var MemberDescription[] */
        public array $members,
    ) {}

    public function jsonSerialize(): array
    {
        return [
            'groupId' => $this->groupId,
            'state' => $this->state,
            'coordinator' => $this->coordinator,
            'partitionAssignor' => $this->partitionAssignor,
            'members' => array_map(fn($m) => $m->jsonSerialize(), $this->members),
        ];
    }
}

/**
 * Producer configuration
 */
readonly class ProducerConfig
{
    public function __construct(
        public ?Acks $acks = null,
        public ?int $batchSize = null,
        public ?int $lingerMs = null,
        public ?int $bufferMemory = null,
        public ?CompressionType $compression = null,
        public ?int $maxRequestSize = null,
        public ?int $retries = null,
        public ?int $retryBackoffMs = null,
        public ?int $deliveryTimeoutMs = null,
        public ?string $transactionalId = null,
        public ?bool $enableIdempotence = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'acks' => $this->acks?->value,
            'batch.size' => $this->batchSize,
            'linger.ms' => $this->lingerMs,
            'buffer.memory' => $this->bufferMemory,
            'compression.type' => $this->compression?->value,
            'max.request.size' => $this->maxRequestSize,
            'retries' => $this->retries,
            'retry.backoff.ms' => $this->retryBackoffMs,
            'delivery.timeout.ms' => $this->deliveryTimeoutMs,
            'transactional.id' => $this->transactionalId,
            'enable.idempotence' => $this->enableIdempotence,
        ], fn($v) => $v !== null);
    }
}

/**
 * Consumer configuration
 */
readonly class ConsumerConfig
{
    public function __construct(
        public string $groupId,
        public ?string $groupInstanceId = null,
        public ?OffsetReset $autoOffsetReset = null,
        public ?bool $enableAutoCommit = null,
        public ?int $autoCommitIntervalMs = null,
        public ?int $sessionTimeoutMs = null,
        public ?int $heartbeatIntervalMs = null,
        public ?int $maxPollIntervalMs = null,
        public ?int $maxPollRecords = null,
        public ?int $fetchMinBytes = null,
        public ?int $fetchMaxBytes = null,
        public ?int $fetchMaxWaitMs = null,
        public ?IsolationLevel $isolationLevel = null,
        public ?AssignmentStrategy $partitionAssignment = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'group.id' => $this->groupId,
            'group.instance.id' => $this->groupInstanceId,
            'auto.offset.reset' => $this->autoOffsetReset?->value,
            'enable.auto.commit' => $this->enableAutoCommit,
            'auto.commit.interval.ms' => $this->autoCommitIntervalMs,
            'session.timeout.ms' => $this->sessionTimeoutMs,
            'heartbeat.interval.ms' => $this->heartbeatIntervalMs,
            'max.poll.interval.ms' => $this->maxPollIntervalMs,
            'max.poll.records' => $this->maxPollRecords,
            'fetch.min.bytes' => $this->fetchMinBytes,
            'fetch.max.bytes' => $this->fetchMaxBytes,
            'fetch.max.wait.ms' => $this->fetchMaxWaitMs,
            'isolation.level' => $this->isolationLevel?->value,
            'partition.assignment.strategy' => $this->partitionAssignment?->value,
        ], fn($v) => $v !== null);
    }
}

/**
 * Kafka Producer for sending messages
 */
class Producer
{
    private bool $closed = false;
    private bool $inTransaction = false;

    public function __construct(
        private readonly KafkaClient $client,
        private readonly ProducerConfig $config,
    ) {}

    /**
     * Send a record to Kafka
     */
    public function send(Record $record): RecordMetadata
    {
        $this->ensureNotClosed();

        $result = $this->client->execute('produce', [
            'topic' => $record->topic,
            'key' => $record->key,
            'value' => $record->value,
            'partition' => $record->partition,
            'headers' => $record->headers?->all(),
            'timestamp' => $record->timestamp,
            'config' => $this->config->toArray(),
        ]);

        return new RecordMetadata(
            topic: $result['topic'] ?? $record->topic,
            partition: $result['partition'] ?? 0,
            offset: $result['offset'] ?? 0,
            timestamp: $result['timestamp'] ?? $record->timestamp ?? 0,
            serializedKeySize: $result['serializedKeySize'] ?? null,
            serializedValueSize: $result['serializedValueSize'] ?? null,
        );
    }

    /**
     * Send multiple records
     *
     * @param Record[] $records
     * @return RecordMetadata[]
     */
    public function sendBatch(array $records): array
    {
        $this->ensureNotClosed();

        $results = [];
        foreach ($records as $record) {
            $results[] = $this->send($record);
        }

        return $results;
    }

    /**
     * Send a message to a topic (convenience method)
     */
    public function produce(
        string $topic,
        mixed $value,
        ?string $key = null,
        ?int $partition = null,
        ?Headers $headers = null,
    ): RecordMetadata {
        return $this->send(Record::create($topic, $value, $key, $partition, $headers));
    }

    /**
     * Send a JSON message to a topic
     */
    public function produceJson(
        string $topic,
        array $value,
        ?string $key = null,
        ?int $partition = null,
        ?Headers $headers = null,
    ): RecordMetadata {
        return $this->send(Record::json($topic, $value, $key, $partition, $headers));
    }

    /**
     * Flush any buffered records
     */
    public function flush(?int $timeoutMs = null): void
    {
        $this->ensureNotClosed();

        $this->client->execute('flush', [
            'timeoutMs' => $timeoutMs,
        ]);
    }

    /**
     * Initialize transactions (for exactly-once semantics)
     */
    public function initTransactions(): void
    {
        $this->ensureNotClosed();

        if ($this->config->transactionalId === null) {
            throw new ProducerException('Transactional ID required for transactions');
        }

        $this->client->execute('initTransactions', [
            'transactionalId' => $this->config->transactionalId,
        ]);
    }

    /**
     * Begin a transaction
     */
    public function beginTransaction(): void
    {
        $this->ensureNotClosed();

        if ($this->inTransaction) {
            throw new ProducerException('Transaction already in progress');
        }

        $this->client->execute('beginTransaction', []);
        $this->inTransaction = true;
    }

    /**
     * Commit the current transaction
     */
    public function commitTransaction(): void
    {
        $this->ensureNotClosed();

        if (!$this->inTransaction) {
            throw new ProducerException('No transaction in progress');
        }

        $this->client->execute('commitTransaction', []);
        $this->inTransaction = false;
    }

    /**
     * Abort the current transaction
     */
    public function abortTransaction(): void
    {
        $this->ensureNotClosed();

        if (!$this->inTransaction) {
            throw new ProducerException('No transaction in progress');
        }

        $this->client->execute('abortTransaction', []);
        $this->inTransaction = false;
    }

    /**
     * Execute a callback within a transaction
     *
     * @template T
     * @param Closure(Producer): T $callback
     * @return T
     */
    public function transaction(Closure $callback): mixed
    {
        $this->beginTransaction();

        try {
            $result = $callback($this);
            $this->commitTransaction();
            return $result;
        } catch (\Throwable $e) {
            $this->abortTransaction();
            throw $e;
        }
    }

    /**
     * Get partition info for a topic
     *
     * @return PartitionInfo[]
     */
    public function partitionsFor(string $topic): array
    {
        $result = $this->client->execute('partitionsFor', ['topic' => $topic]);

        return array_map(
            fn($p) => new PartitionInfo(
                topic: $p['topic'],
                partition: $p['partition'],
                leader: $p['leader'],
                replicas: $p['replicas'],
                inSyncReplicas: $p['inSyncReplicas'],
            ),
            $result['partitions'] ?? [],
        );
    }

    /**
     * Get producer metrics
     */
    public function metrics(): array
    {
        return $this->client->execute('producerMetrics', []);
    }

    /**
     * Close the producer
     */
    public function close(?int $timeoutMs = null): void
    {
        if (!$this->closed) {
            if ($this->inTransaction) {
                $this->abortTransaction();
            }
            $this->flush($timeoutMs);
            $this->closed = true;
        }
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    private function ensureNotClosed(): void
    {
        if ($this->closed) {
            throw new ProducerException('Producer has been closed');
        }
    }
}

/**
 * Consumer rebalance listener interface
 */
interface RebalanceListener
{
    /**
     * Called when partitions are assigned to this consumer
     *
     * @param TopicPartition[] $partitions
     */
    public function onPartitionsAssigned(array $partitions): void;

    /**
     * Called when partitions are revoked from this consumer
     *
     * @param TopicPartition[] $partitions
     */
    public function onPartitionsRevoked(array $partitions): void;

    /**
     * Called when partitions are lost (non-graceful revocation)
     *
     * @param TopicPartition[] $partitions
     */
    public function onPartitionsLost(array $partitions): void;
}

/**
 * Default no-op rebalance listener
 */
class NoOpRebalanceListener implements RebalanceListener
{
    public function onPartitionsAssigned(array $partitions): void {}
    public function onPartitionsRevoked(array $partitions): void {}
    public function onPartitionsLost(array $partitions): void {}
}

/**
 * Kafka Consumer for receiving messages
 */
class Consumer implements \Iterator
{
    private bool $closed = false;
    private bool $subscribed = false;
    /** @var Record[] */
    private array $currentBatch = [];
    private int $batchIndex = 0;
    private ?RebalanceListener $rebalanceListener = null;

    public function __construct(
        private readonly KafkaClient $client,
        private readonly ConsumerConfig $config,
    ) {}

    /**
     * Subscribe to topics
     *
     * @param string[] $topics
     */
    public function subscribe(array $topics, ?RebalanceListener $listener = null): void
    {
        $this->ensureNotClosed();

        $this->rebalanceListener = $listener ?? new NoOpRebalanceListener();

        $this->client->execute('subscribe', [
            'topics' => $topics,
            'groupId' => $this->config->groupId,
            'config' => $this->config->toArray(),
        ]);

        $this->subscribed = true;
    }

    /**
     * Assign specific partitions to consume from
     *
     * @param TopicPartition[] $partitions
     */
    public function assign(array $partitions): void
    {
        $this->ensureNotClosed();

        $this->client->execute('assign', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * Unsubscribe from all topics
     */
    public function unsubscribe(): void
    {
        $this->ensureNotClosed();

        $this->client->execute('unsubscribe', []);
        $this->subscribed = false;
    }

    /**
     * Poll for records
     *
     * @return Record[]
     */
    public function poll(int $timeoutMs = 1000): array
    {
        $this->ensureNotClosed();

        if (!$this->subscribed) {
            return [];
        }

        $result = $this->client->execute('poll', [
            'timeoutMs' => $timeoutMs,
            'groupId' => $this->config->groupId,
        ]);

        $records = [];
        foreach ($result['records'] ?? [] as $r) {
            $records[] = new Record(
                topic: $r['topic'],
                value: $r['value'],
                key: $r['key'] ?? null,
                partition: $r['partition'] ?? 0,
                headers: isset($r['headers']) ? new Headers($r['headers']) : null,
                timestamp: $r['timestamp'] ?? null,
                offset: $r['offset'] ?? null,
            );
        }

        return $records;
    }

    /**
     * Consume records with a callback
     *
     * @param Closure(Record): void $handler
     */
    public function consume(Closure $handler, int $maxRecords = 100, int $timeoutMs = 1000): void
    {
        $processed = 0;

        while ($processed < $maxRecords) {
            $records = $this->poll($timeoutMs);

            if (empty($records)) {
                break;
            }

            foreach ($records as $record) {
                $handler($record);
                $processed++;

                if ($processed >= $maxRecords) {
                    break;
                }
            }
        }
    }

    /**
     * Consume records indefinitely until closed
     *
     * @param Closure(Record): void $handler
     */
    public function consumeForever(Closure $handler, int $pollTimeoutMs = 1000): void
    {
        while (!$this->closed) {
            $records = $this->poll($pollTimeoutMs);

            foreach ($records as $record) {
                $handler($record);
            }
        }
    }

    /**
     * Commit offsets for all consumed records
     */
    public function commitSync(): void
    {
        $this->ensureNotClosed();

        $this->client->execute('commitSync', [
            'groupId' => $this->config->groupId,
        ]);
    }

    /**
     * Commit offsets asynchronously
     */
    public function commitAsync(?Closure $callback = null): void
    {
        $this->ensureNotClosed();

        $this->client->execute('commitAsync', [
            'groupId' => $this->config->groupId,
        ]);
    }

    /**
     * Commit specific offsets
     *
     * @param array<string, OffsetAndMetadata> $offsets Map of TopicPartition string to OffsetAndMetadata
     */
    public function commitOffsets(array $offsets): void
    {
        $this->ensureNotClosed();

        $offsetData = [];
        foreach ($offsets as $tpStr => $offsetMeta) {
            $offsetData[$tpStr] = $offsetMeta->jsonSerialize();
        }

        $this->client->execute('commitOffsets', [
            'offsets' => $offsetData,
            'groupId' => $this->config->groupId,
        ]);
    }

    /**
     * Seek to a specific offset for a partition
     */
    public function seek(TopicPartition $partition, int $offset): void
    {
        $this->ensureNotClosed();

        $this->client->execute('seek', [
            'partition' => $partition->jsonSerialize(),
            'offset' => $offset,
        ]);
    }

    /**
     * Seek to the beginning of partitions
     *
     * @param TopicPartition[] $partitions
     */
    public function seekToBeginning(array $partitions): void
    {
        $this->ensureNotClosed();

        $this->client->execute('seekToBeginning', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * Seek to the end of partitions
     *
     * @param TopicPartition[] $partitions
     */
    public function seekToEnd(array $partitions): void
    {
        $this->ensureNotClosed();

        $this->client->execute('seekToEnd', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * Get the current position for a partition
     */
    public function position(TopicPartition $partition): int
    {
        $result = $this->client->execute('position', [
            'partition' => $partition->jsonSerialize(),
        ]);

        return $result['position'] ?? 0;
    }

    /**
     * Get committed offset for a partition
     */
    public function committed(TopicPartition $partition): ?OffsetAndMetadata
    {
        $result = $this->client->execute('committed', [
            'partition' => $partition->jsonSerialize(),
            'groupId' => $this->config->groupId,
        ]);

        if (!isset($result['offset'])) {
            return null;
        }

        return new OffsetAndMetadata(
            offset: $result['offset'],
            metadata: $result['metadata'] ?? null,
        );
    }

    /**
     * Get the current assignment
     *
     * @return TopicPartition[]
     */
    public function assignment(): array
    {
        $result = $this->client->execute('assignment', []);

        return array_map(
            fn($tp) => new TopicPartition($tp['topic'], $tp['partition']),
            $result['assignment'] ?? [],
        );
    }

    /**
     * Get the current subscription
     *
     * @return string[]
     */
    public function subscription(): array
    {
        $result = $this->client->execute('subscription', []);
        return $result['topics'] ?? [];
    }

    /**
     * Pause consumption for partitions
     *
     * @param TopicPartition[] $partitions
     */
    public function pause(array $partitions): void
    {
        $this->client->execute('pause', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * Resume consumption for partitions
     *
     * @param TopicPartition[] $partitions
     */
    public function resume(array $partitions): void
    {
        $this->client->execute('resume', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * Get paused partitions
     *
     * @return TopicPartition[]
     */
    public function paused(): array
    {
        $result = $this->client->execute('paused', []);

        return array_map(
            fn($tp) => new TopicPartition($tp['topic'], $tp['partition']),
            $result['partitions'] ?? [],
        );
    }

    /**
     * Get end offsets for partitions
     *
     * @param TopicPartition[] $partitions
     * @return array<string, int>
     */
    public function endOffsets(array $partitions): array
    {
        $result = $this->client->execute('endOffsets', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);

        return $result['offsets'] ?? [];
    }

    /**
     * Get beginning offsets for partitions
     *
     * @param TopicPartition[] $partitions
     * @return array<string, int>
     */
    public function beginningOffsets(array $partitions): array
    {
        $result = $this->client->execute('beginningOffsets', [
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);

        return $result['offsets'] ?? [];
    }

    /**
     * Get consumer metrics
     */
    public function metrics(): array
    {
        return $this->client->execute('consumerMetrics', []);
    }

    /**
     * Close the consumer
     */
    public function close(): void
    {
        if (!$this->closed) {
            if ($this->subscribed) {
                $this->unsubscribe();
            }
            $this->closed = true;
        }
    }

    public function isClosed(): bool
    {
        return $this->closed;
    }

    // Iterator implementation for foreach support
    public function current(): ?Record
    {
        return $this->currentBatch[$this->batchIndex] ?? null;
    }

    public function key(): int
    {
        return $this->batchIndex;
    }

    public function next(): void
    {
        $this->batchIndex++;
    }

    public function rewind(): void
    {
        $this->currentBatch = $this->poll();
        $this->batchIndex = 0;
    }

    public function valid(): bool
    {
        if ($this->batchIndex >= count($this->currentBatch)) {
            if ($this->closed) {
                return false;
            }
            $this->currentBatch = $this->poll();
            $this->batchIndex = 0;
        }

        return isset($this->currentBatch[$this->batchIndex]);
    }

    private function ensureNotClosed(): void
    {
        if ($this->closed) {
            throw new ConsumerException('Consumer has been closed', $this->config->groupId);
        }
    }
}

/**
 * Admin client for managing Kafka resources
 */
class AdminClient
{
    public function __construct(
        private readonly KafkaClient $client,
    ) {}

    /**
     * Create topics
     */
    public function createTopics(array $topics): void
    {
        $this->client->execute('createTopics', ['topics' => $topics]);
    }

    /**
     * Create a single topic
     */
    public function createTopic(
        string $name,
        int $partitions = 1,
        int $replicationFactor = 1,
        array $configs = [],
    ): void {
        $this->createTopics([[
            'name' => $name,
            'partitions' => $partitions,
            'replicationFactor' => $replicationFactor,
            'configs' => $configs,
        ]]);
    }

    /**
     * Delete topics
     *
     * @param string[] $topics
     */
    public function deleteTopics(array $topics): void
    {
        $this->client->execute('deleteTopics', ['topics' => $topics]);
    }

    /**
     * List all topics
     *
     * @return string[]
     */
    public function listTopics(): array
    {
        $result = $this->client->execute('listTopics', []);
        return $result['topics'] ?? [];
    }

    /**
     * Describe topics
     *
     * @param string[] $topics
     * @return TopicDescription[]
     */
    public function describeTopics(array $topics): array
    {
        $result = $this->client->execute('describeTopics', ['topics' => $topics]);

        return array_map(
            fn($t) => new TopicDescription(
                name: $t['name'],
                isInternal: $t['isInternal'] ?? false,
                partitions: array_map(
                    fn($p) => new PartitionInfo(
                        topic: $t['name'],
                        partition: $p['partition'],
                        leader: $p['leader'],
                        replicas: $p['replicas'],
                        inSyncReplicas: $p['inSyncReplicas'],
                    ),
                    $t['partitions'] ?? [],
                ),
            ),
            $result['topics'] ?? [],
        );
    }

    /**
     * Describe a single topic
     */
    public function describeTopic(string $topic): ?TopicDescription
    {
        $descriptions = $this->describeTopics([$topic]);
        return $descriptions[0] ?? null;
    }

    /**
     * List consumer groups
     *
     * @return string[]
     */
    public function listConsumerGroups(): array
    {
        $result = $this->client->execute('listConsumerGroups', []);
        return $result['groups'] ?? [];
    }

    /**
     * Describe consumer groups
     *
     * @param string[] $groupIds
     * @return ConsumerGroupDescription[]
     */
    public function describeConsumerGroups(array $groupIds): array
    {
        $result = $this->client->execute('describeConsumerGroups', ['groupIds' => $groupIds]);

        return array_map(
            fn($g) => new ConsumerGroupDescription(
                groupId: $g['groupId'],
                state: $g['state'],
                coordinator: $g['coordinator'],
                partitionAssignor: $g['partitionAssignor'],
                members: array_map(
                    fn($m) => new MemberDescription(
                        memberId: $m['memberId'],
                        clientId: $m['clientId'],
                        host: $m['host'],
                        assignment: array_map(
                            fn($tp) => new TopicPartition($tp['topic'], $tp['partition']),
                            $m['assignment'] ?? [],
                        ),
                    ),
                    $g['members'] ?? [],
                ),
            ),
            $result['groups'] ?? [],
        );
    }

    /**
     * Delete consumer groups
     *
     * @param string[] $groupIds
     */
    public function deleteConsumerGroups(array $groupIds): void
    {
        $this->client->execute('deleteConsumerGroups', ['groupIds' => $groupIds]);
    }

    /**
     * Delete consumer group offsets
     */
    public function deleteConsumerGroupOffsets(string $groupId, array $partitions): void
    {
        $this->client->execute('deleteConsumerGroupOffsets', [
            'groupId' => $groupId,
            'partitions' => array_map(fn($tp) => $tp->jsonSerialize(), $partitions),
        ]);
    }

    /**
     * List consumer group offsets
     *
     * @return array<string, OffsetAndMetadata>
     */
    public function listConsumerGroupOffsets(string $groupId): array
    {
        $result = $this->client->execute('listConsumerGroupOffsets', [
            'groupId' => $groupId,
        ]);

        $offsets = [];
        foreach ($result['offsets'] ?? [] as $tpStr => $offsetData) {
            $offsets[$tpStr] = new OffsetAndMetadata(
                offset: $offsetData['offset'],
                metadata: $offsetData['metadata'] ?? null,
            );
        }

        return $offsets;
    }

    /**
     * Alter consumer group offsets
     *
     * @param array<string, OffsetAndMetadata> $offsets
     */
    public function alterConsumerGroupOffsets(string $groupId, array $offsets): void
    {
        $offsetData = [];
        foreach ($offsets as $tpStr => $offsetMeta) {
            $offsetData[$tpStr] = $offsetMeta->jsonSerialize();
        }

        $this->client->execute('alterConsumerGroupOffsets', [
            'groupId' => $groupId,
            'offsets' => $offsetData,
        ]);
    }

    /**
     * Create partitions for a topic
     */
    public function createPartitions(string $topic, int $newTotalCount): void
    {
        $this->client->execute('createPartitions', [
            'topic' => $topic,
            'newTotalCount' => $newTotalCount,
        ]);
    }

    /**
     * Describe cluster
     */
    public function describeCluster(): array
    {
        return $this->client->execute('describeCluster', []);
    }

    /**
     * Describe cluster configuration
     */
    public function describeConfigs(array $resources): array
    {
        return $this->client->execute('describeConfigs', [
            'resources' => $resources,
        ]);
    }

    /**
     * Alter configurations
     */
    public function alterConfigs(array $configs): void
    {
        $this->client->execute('alterConfigs', [
            'configs' => $configs,
        ]);
    }
}

/**
 * Kafka client configuration
 */
readonly class KafkaClientConfig
{
    public function __construct(
        public string $bootstrapServers = 'localhost:9092',
        public ?string $clientId = null,
        public int $timeout = 30,
        public ?string $securityProtocol = null,
        public ?string $saslMechanism = null,
        public ?string $saslUsername = null,
        public ?string $saslPassword = null,
        public ?string $sslCaLocation = null,
        public ?string $sslCertificateLocation = null,
        public ?string $sslKeyLocation = null,
        public ?string $sslKeyPassword = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'bootstrap.servers' => $this->bootstrapServers,
            'client.id' => $this->clientId,
            'request.timeout.ms' => $this->timeout * 1000,
            'security.protocol' => $this->securityProtocol,
            'sasl.mechanism' => $this->saslMechanism,
            'sasl.username' => $this->saslUsername,
            'sasl.password' => $this->saslPassword,
            'ssl.ca.location' => $this->sslCaLocation,
            'ssl.certificate.location' => $this->sslCertificateLocation,
            'ssl.key.location' => $this->sslKeyLocation,
            'ssl.key.password' => $this->sslKeyPassword,
        ], fn($v) => $v !== null);
    }
}

/**
 * Kafka Client for the .do Platform
 *
 * Provides Kafka-compatible operations through Cap'n Web RPC.
 *
 * Example usage:
 * ```php
 * $kafka = KafkaClient::connect('localhost:9092');
 *
 * // Create a producer
 * $producer = $kafka->producer();
 * $producer->produce('my-topic', 'Hello, Kafka!', 'my-key');
 *
 * // Or with JSON
 * $producer->produceJson('events', ['type' => 'user.created', 'userId' => 123]);
 *
 * // Create a consumer
 * $consumer = $kafka->consumer('my-group');
 * $consumer->subscribe(['my-topic']);
 *
 * foreach ($consumer as $record) {
 *     echo "Received: {$record->value}\n";
 *     $consumer->commitSync();
 * }
 *
 * // Admin operations
 * $admin = $kafka->admin();
 * $admin->createTopic('new-topic', partitions: 3, replicationFactor: 2);
 * ```
 */
class KafkaClient
{
    private bool $connected = false;

    private function __construct(
        private readonly KafkaClientConfig $config,
    ) {}

    /**
     * Create a new Kafka client
     */
    public static function create(KafkaClientConfig|string $config): self
    {
        if (is_string($config)) {
            $config = new KafkaClientConfig(bootstrapServers: $config);
        }

        $client = new self($config);
        $client->connect();

        return $client;
    }

    /**
     * Connect to Kafka
     */
    public static function connect(string $bootstrapServers, array $options = []): self
    {
        $config = new KafkaClientConfig(
            bootstrapServers: $bootstrapServers,
            clientId: $options['clientId'] ?? null,
            timeout: $options['timeout'] ?? 30,
            securityProtocol: $options['securityProtocol'] ?? null,
            saslMechanism: $options['saslMechanism'] ?? null,
            saslUsername: $options['saslUsername'] ?? null,
            saslPassword: $options['saslPassword'] ?? null,
        );

        return self::create($config);
    }

    /**
     * Establish connection
     */
    private function connect(): void
    {
        // In a real implementation, this would establish the connection
        // through Cap'n Web RPC
        $this->connected = true;
    }

    /**
     * Create a producer
     */
    public function producer(?ProducerConfig $config = null): Producer
    {
        $config = $config ?? new ProducerConfig();
        return new Producer($this, $config);
    }

    /**
     * Create a consumer
     */
    public function consumer(string|ConsumerConfig $groupIdOrConfig): Consumer
    {
        $config = is_string($groupIdOrConfig)
            ? new ConsumerConfig(groupId: $groupIdOrConfig)
            : $groupIdOrConfig;

        return new Consumer($this, $config);
    }

    /**
     * Create an admin client
     */
    public function admin(): AdminClient
    {
        return new AdminClient($this);
    }

    /**
     * Close the client
     */
    public function close(): void
    {
        $this->connected = false;
    }

    /**
     * Check if connected
     */
    public function isConnected(): bool
    {
        return $this->connected;
    }

    /**
     * Get the client configuration
     */
    public function getConfig(): KafkaClientConfig
    {
        return $this->config;
    }

    /**
     * Execute a command via RPC
     *
     * @internal
     */
    public function execute(string $command, array $params): array
    {
        if (!$this->connected) {
            throw new KafkaException('Not connected to Kafka');
        }

        // This is a stub implementation.
        // In production, this would go through Cap'n Web RPC to the server.
        // For now, we simulate responses for testing purposes.

        return match ($command) {
            'produce' => ['topic' => $params['topic'] ?? '', 'partition' => 0, 'offset' => 0, 'timestamp' => time() * 1000],
            'poll' => ['records' => []],
            'subscribe' => [],
            'unsubscribe' => [],
            'commitSync', 'commitAsync', 'commitOffsets' => [],
            'seek', 'seekToBeginning', 'seekToEnd' => [],
            'assignment' => ['assignment' => []],
            'subscription' => ['topics' => []],
            'position' => ['position' => 0],
            'committed' => ['offset' => null],
            'listTopics' => ['topics' => []],
            'describeTopics' => ['topics' => []],
            'createTopics', 'deleteTopics' => [],
            'listConsumerGroups' => ['groups' => []],
            'describeConsumerGroups' => ['groups' => []],
            'deleteConsumerGroups' => [],
            'listConsumerGroupOffsets' => ['offsets' => []],
            'alterConsumerGroupOffsets' => [],
            'describeCluster' => ['clusterId' => '', 'controller' => null, 'nodes' => []],
            'partitionsFor' => ['partitions' => []],
            'flush' => [],
            'initTransactions', 'beginTransaction', 'commitTransaction', 'abortTransaction' => [],
            'producerMetrics', 'consumerMetrics' => [],
            default => [],
        };
    }
}

/**
 * Helper function to create a Headers instance
 */
function headers(array $headers = []): Headers
{
    return new Headers($headers);
}

/**
 * Helper function to create a Record
 */
function record(
    string $topic,
    mixed $value,
    ?string $key = null,
    ?int $partition = null,
    ?Headers $headers = null,
): Record {
    return Record::create($topic, $value, $key, $partition, $headers);
}

/**
 * Helper function to create a TopicPartition
 */
function partition(string $topic, int $partition): TopicPartition
{
    return new TopicPartition($topic, $partition);
}
