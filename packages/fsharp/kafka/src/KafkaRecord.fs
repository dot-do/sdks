namespace DotDo.Kafka

open System

/// A Kafka record received from a consumer.
type KafkaRecord<'T> = {
    /// The topic name.
    Topic: string
    /// The partition number.
    Partition: int
    /// The offset within the partition.
    Offset: int64
    /// The message key (optional).
    Key: string option
    /// The message value.
    Value: 'T
    /// The message timestamp.
    Timestamp: DateTimeOffset
    /// Message headers.
    Headers: Map<string, string>
    /// Internal: commit function.
    CommitFn: unit -> KafkaResult<unit>
    /// Internal: async commit function.
    CommitAsyncFn: unit -> AsyncKafkaResult<unit>
}

module KafkaRecord =
    /// Creates a new record.
    let create topic partition offset key value timestamp headers commitFn commitAsyncFn =
        {
            Topic = topic
            Partition = partition
            Offset = offset
            Key = key
            Value = value
            Timestamp = timestamp
            Headers = headers
            CommitFn = commitFn
            CommitAsyncFn = commitAsyncFn
        }

    /// Gets the topic.
    let topic (record: KafkaRecord<'T>) = record.Topic

    /// Gets the partition.
    let partition (record: KafkaRecord<'T>) = record.Partition

    /// Gets the offset.
    let offset (record: KafkaRecord<'T>) = record.Offset

    /// Gets the key.
    let key (record: KafkaRecord<'T>) = record.Key

    /// Gets the value.
    let value (record: KafkaRecord<'T>) = record.Value

    /// Gets the timestamp.
    let timestamp (record: KafkaRecord<'T>) = record.Timestamp

    /// Gets the headers.
    let headers (record: KafkaRecord<'T>) = record.Headers

    /// Commits the record offset.
    let commit (record: KafkaRecord<'T>) = record.CommitFn()

    /// Commits the record offset asynchronously.
    let commitAsync (record: KafkaRecord<'T>) = record.CommitAsyncFn()

    /// Maps the value of a record.
    let map (f: 'T -> 'U) (record: KafkaRecord<'T>) : KafkaRecord<'U> =
        {
            Topic = record.Topic
            Partition = record.Partition
            Offset = record.Offset
            Key = record.Key
            Value = f record.Value
            Timestamp = record.Timestamp
            Headers = record.Headers
            CommitFn = record.CommitFn
            CommitAsyncFn = record.CommitAsyncFn
        }

/// A message to be sent to Kafka.
type Message<'T> = {
    /// The message key (optional, used for partitioning).
    Key: string option
    /// The message value.
    Value: 'T
    /// Message headers.
    Headers: Map<string, string>
}

module Message =
    /// Creates a message with just a value.
    let create value =
        {
            Key = None
            Value = value
            Headers = Map.empty
        }

    /// Creates a message with a key.
    let withKey key message =
        { message with Key = Some key }

    /// Creates a message with headers.
    let withHeaders headers message =
        { message with Headers = headers }

    /// Creates a message with a single header.
    let withHeader key value message =
        { message with Headers = Map.add key value message.Headers }

    /// Creates a keyed message.
    let keyed key value =
        {
            Key = Some key
            Value = value
            Headers = Map.empty
        }

/// Metadata returned after sending a message.
type RecordMetadata = {
    /// The topic the message was sent to.
    Topic: string
    /// The partition the message was sent to.
    Partition: int
    /// The offset of the message.
    Offset: int64
    /// The timestamp of the message.
    Timestamp: DateTimeOffset
}

module RecordMetadata =
    /// Creates new metadata.
    let create topic partition offset timestamp =
        {
            Topic = topic
            Partition = partition
            Offset = offset
            Timestamp = timestamp
        }

/// A batch of records from a batch consumer.
type RecordBatch<'T> = {
    /// The records in the batch.
    Records: KafkaRecord<'T> list
    /// Internal: commit function for the entire batch.
    CommitFn: unit -> KafkaResult<unit>
    /// Internal: async commit function.
    CommitAsyncFn: unit -> AsyncKafkaResult<unit>
}

module RecordBatch =
    /// Gets the records in the batch.
    let records (batch: RecordBatch<'T>) = batch.Records

    /// Gets the count of records.
    let count (batch: RecordBatch<'T>) = List.length batch.Records

    /// Checks if the batch is empty.
    let isEmpty (batch: RecordBatch<'T>) = List.isEmpty batch.Records

    /// Commits all offsets in the batch.
    let commit (batch: RecordBatch<'T>) = batch.CommitFn()

    /// Commits all offsets asynchronously.
    let commitAsync (batch: RecordBatch<'T>) = batch.CommitAsyncFn()

    /// Maps the values in all records.
    let map (f: 'T -> 'U) (batch: RecordBatch<'T>) : RecordBatch<'U> =
        {
            Records = batch.Records |> List.map (KafkaRecord.map f)
            CommitFn = batch.CommitFn
            CommitAsyncFn = batch.CommitAsyncFn
        }
