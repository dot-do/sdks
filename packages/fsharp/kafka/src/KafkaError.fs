namespace DotDo.Kafka

open System

/// Represents errors that can occur during Kafka operations.
[<RequireQualifiedAccess>]
type KafkaError =
    /// Connection to the broker failed.
    | ConnectionError of message: string
    /// The operation timed out.
    | Timeout of operation: string * elapsed: TimeSpan
    /// Authentication failed.
    | AuthenticationError of reason: string
    /// The topic was not found.
    | TopicNotFound of topic: string
    /// The partition was not found.
    | PartitionNotFound of topic: string * partition: int
    /// The message is too large.
    | MessageTooLarge of size: int64 * maxSize: int64
    /// The broker is not the leader for the partition.
    | NotLeader of topic: string * partition: int
    /// The offset is out of range.
    | OffsetOutOfRange of topic: string * partition: int * offset: int64
    /// The consumer group coordinator error.
    | GroupCoordinatorError of message: string
    /// A rebalance is in progress.
    | RebalanceInProgress
    /// Not authorized to perform the operation.
    | Unauthorized of message: string
    /// Quota exceeded.
    | QuotaExceeded
    /// The connection was lost.
    | Disconnected
    /// Serialization/deserialization error.
    | SerializationError of message: string
    /// The operation was cancelled.
    | Cancelled
    /// An unknown error occurred.
    | Unknown of code: int * message: string

/// Module for working with KafkaError.
module KafkaError =
    /// Gets the error message.
    let message (error: KafkaError) : string =
        match error with
        | KafkaError.ConnectionError msg -> $"Connection error: {msg}"
        | KafkaError.Timeout (op, elapsed) -> $"Operation '{op}' timed out after {elapsed}"
        | KafkaError.AuthenticationError reason -> $"Authentication failed: {reason}"
        | KafkaError.TopicNotFound topic -> $"Topic not found: {topic}"
        | KafkaError.PartitionNotFound (topic, partition) -> $"Partition not found: {topic}[{partition}]"
        | KafkaError.MessageTooLarge (size, maxSize) -> $"Message too large: {size} bytes (max: {maxSize})"
        | KafkaError.NotLeader (topic, partition) -> $"Not leader for partition: {topic}[{partition}]"
        | KafkaError.OffsetOutOfRange (topic, partition, offset) -> $"Offset out of range: {topic}[{partition}]@{offset}"
        | KafkaError.GroupCoordinatorError msg -> $"Group coordinator error: {msg}"
        | KafkaError.RebalanceInProgress -> "Rebalance in progress"
        | KafkaError.Unauthorized msg -> $"Unauthorized: {msg}"
        | KafkaError.QuotaExceeded -> "Quota exceeded"
        | KafkaError.Disconnected -> "Connection lost"
        | KafkaError.SerializationError msg -> $"Serialization error: {msg}"
        | KafkaError.Cancelled -> "Operation was cancelled"
        | KafkaError.Unknown (code, msg) -> $"Unknown error {code}: {msg}"

    /// Checks if the error is retryable.
    let isRetryable (error: KafkaError) : bool =
        match error with
        | KafkaError.ConnectionError _ -> true
        | KafkaError.Timeout _ -> true
        | KafkaError.NotLeader _ -> true
        | KafkaError.RebalanceInProgress -> true
        | KafkaError.Disconnected -> true
        | KafkaError.GroupCoordinatorError _ -> true
        | _ -> false

    /// Converts the error to an exception.
    let toException (error: KafkaError) : Exception =
        Exception(message error)

/// Result type alias for Kafka operations.
type KafkaResult<'T> = Result<'T, KafkaError>

/// Async result type for Kafka operations.
type AsyncKafkaResult<'T> = Async<Result<'T, KafkaError>>

/// Module for working with KafkaResult.
module KafkaResult =
    /// Maps over the success value.
    let map (f: 'T -> 'U) (result: KafkaResult<'T>) : KafkaResult<'U> =
        Result.map f result

    /// Maps over the error value.
    let mapError (f: KafkaError -> KafkaError) (result: KafkaResult<'T>) : KafkaResult<'T> =
        Result.mapError f result

    /// Binds the result to another operation.
    let bind (f: 'T -> KafkaResult<'U>) (result: KafkaResult<'T>) : KafkaResult<'U> =
        Result.bind f result

    /// Returns a successful result.
    let ok (value: 'T) : KafkaResult<'T> = Ok value

    /// Returns an error result.
    let error (err: KafkaError) : KafkaResult<'T> = Error err

    /// Converts a result to an option.
    let toOption (result: KafkaResult<'T>) : 'T option =
        match result with
        | Ok value -> Some value
        | Error _ -> None

    /// Gets the value or a default.
    let defaultValue (defaultVal: 'T) (result: KafkaResult<'T>) : 'T =
        match result with
        | Ok value -> value
        | Error _ -> defaultVal

    /// Gets the value or raises an exception.
    let getOrThrow (result: KafkaResult<'T>) : 'T =
        match result with
        | Ok value -> value
        | Error err -> raise (KafkaError.toException err)

/// Module for working with AsyncKafkaResult.
module AsyncKafkaResult =
    /// Maps over the success value.
    let map (f: 'T -> 'U) (ar: AsyncKafkaResult<'T>) : AsyncKafkaResult<'U> =
        async {
            match! ar with
            | Ok value -> return Ok (f value)
            | Error err -> return Error err
        }

    /// Binds the result to another async operation.
    let bind (f: 'T -> AsyncKafkaResult<'U>) (ar: AsyncKafkaResult<'T>) : AsyncKafkaResult<'U> =
        async {
            match! ar with
            | Ok value -> return! f value
            | Error err -> return Error err
        }

    /// Returns a successful async result.
    let ok (value: 'T) : AsyncKafkaResult<'T> =
        async { return Ok value }

    /// Returns an error async result.
    let error (err: KafkaError) : AsyncKafkaResult<'T> =
        async { return Error err }
