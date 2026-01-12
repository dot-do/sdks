namespace DotDo.Kafka

open System

/// A Kafka producer for sending messages to a topic.
type Producer<'T>(
    client: obj,
    topic: string,
    config: ProducerConfig,
    serialize: 'T -> string
) =

    /// The topic this producer sends to.
    member _.Topic = topic

    /// Sends a single message.
    member _.Send(value: 'T, ?key: string, ?headers: Map<string, string>) : KafkaResult<RecordMetadata> =
        try
            let _serialized = serialize value
            // Stub implementation - would call RPC transport
            Ok {
                Topic = topic
                Partition = 0
                Offset = 0L
                Timestamp = DateTimeOffset.UtcNow
            }
        with ex ->
            Error (KafkaError.SerializationError ex.Message)

    /// Sends a single message asynchronously.
    member this.SendAsync(value: 'T, ?key: string, ?headers: Map<string, string>) : AsyncKafkaResult<RecordMetadata> =
        async { return this.Send(value, ?key = key, ?headers = headers) }

    /// Sends a message object.
    member this.SendMessage(message: Message<'T>) : KafkaResult<RecordMetadata> =
        this.Send(message.Value, ?key = message.Key, headers = message.Headers)

    /// Sends a message object asynchronously.
    member this.SendMessageAsync(message: Message<'T>) : AsyncKafkaResult<RecordMetadata> =
        async { return this.SendMessage(message) }

    /// Sends a batch of values.
    member this.SendBatch(values: 'T list) : KafkaResult<RecordMetadata list> =
        values
        |> List.fold (fun acc value ->
            match acc with
            | Ok results ->
                match this.Send(value) with
                | Ok meta -> Ok (meta :: results)
                | Error err -> Error err
            | Error err -> Error err
        ) (Ok [])
        |> Result.map List.rev

    /// Sends a batch of values asynchronously.
    member this.SendBatchAsync(values: 'T list) : AsyncKafkaResult<RecordMetadata list> =
        async { return this.SendBatch(values) }

    /// Sends a batch of messages.
    member this.SendMessages(messages: Message<'T> list) : KafkaResult<RecordMetadata list> =
        messages
        |> List.fold (fun acc msg ->
            match acc with
            | Ok results ->
                match this.SendMessage(msg) with
                | Ok meta -> Ok (meta :: results)
                | Error err -> Error err
            | Error err -> Error err
        ) (Ok [])
        |> Result.map List.rev

    /// Sends a batch of messages asynchronously.
    member this.SendMessagesAsync(messages: Message<'T> list) : AsyncKafkaResult<RecordMetadata list> =
        async { return this.SendMessages(messages) }

    /// Flushes any buffered messages.
    member _.Flush() : KafkaResult<unit> =
        // Stub implementation
        Ok ()

    /// Flushes any buffered messages asynchronously.
    member this.FlushAsync() : AsyncKafkaResult<unit> =
        async { return this.Flush() }

/// Module for Producer operations.
module Producer =
    /// Sends a value.
    let send value (producer: Producer<'T>) = producer.Send(value)

    /// Sends a value with a key.
    let sendWithKey key value (producer: Producer<'T>) = producer.Send(value, key = key)

    /// Sends a value asynchronously.
    let sendAsync value (producer: Producer<'T>) = producer.SendAsync(value)

    /// Sends a message.
    let sendMessage message (producer: Producer<'T>) = producer.SendMessage(message)

    /// Sends a batch of values.
    let sendBatch values (producer: Producer<'T>) = producer.SendBatch(values)

    /// Sends a batch of messages.
    let sendMessages messages (producer: Producer<'T>) = producer.SendMessages(messages)

    /// Flushes buffered messages.
    let flush (producer: Producer<'T>) = producer.Flush()

/// A transactional producer wrapper.
type Transaction<'T>(producer: Producer<'T>) =
    let mutable messages: Message<'T> list = []
    let mutable committed = false
    let mutable aborted = false

    /// Adds a message to the transaction.
    member _.Send(value: 'T, ?key: string, ?headers: Map<string, string>) =
        if committed then failwith "Transaction already committed"
        if aborted then failwith "Transaction already aborted"
        messages <- {
            Key = key
            Value = value
            Headers = headers |> Option.defaultValue Map.empty
        } :: messages

    /// Commits the transaction.
    member _.Commit() : KafkaResult<RecordMetadata list> =
        if committed then failwith "Transaction already committed"
        if aborted then failwith "Transaction already aborted"
        committed <- true
        producer.SendMessages(List.rev messages)

    /// Commits the transaction asynchronously.
    member this.CommitAsync() : AsyncKafkaResult<RecordMetadata list> =
        async { return this.Commit() }

    /// Aborts the transaction.
    member _.Abort() =
        aborted <- true
        messages <- []

module Transaction =
    /// Runs a function within a transaction.
    let run (producer: Producer<'T>) (f: Transaction<'T> -> unit) : KafkaResult<RecordMetadata list> =
        let tx = Transaction(producer)
        try
            f tx
            tx.Commit()
        with ex ->
            tx.Abort()
            Error (KafkaError.Unknown (0, ex.Message))

    /// Runs an async function within a transaction.
    let runAsync (producer: Producer<'T>) (f: Transaction<'T> -> Async<unit>) : AsyncKafkaResult<RecordMetadata list> =
        async {
            let tx = Transaction(producer)
            try
                do! f tx
                return tx.Commit()
            with ex ->
                tx.Abort()
                return Error (KafkaError.Unknown (0, ex.Message))
        }
