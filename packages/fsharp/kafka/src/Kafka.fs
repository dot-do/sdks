namespace DotDo.Kafka

open System
open System.Text.Json

/// Main entry point for the DotDo Kafka SDK.
/// Provides a functional-first API for Kafka operations.
type Kafka private (config: KafkaConfig) =
    let mutable transport: obj option = None

    /// Creates a new Kafka client with default configuration.
    new() = Kafka(KafkaConfig.defaultConfig)

    /// Creates a new Kafka client with custom configuration.
    static member Create(config: KafkaConfig) : Kafka =
        Kafka(config)

    /// Creates a new Kafka client from environment variables.
    static member FromEnv() : Kafka =
        Kafka(KafkaConfig.defaultConfig)

    /// Gets the configuration.
    member _.Config = config

    /// Creates a producer for the specified topic.
    member this.Producer<'T>(topic: string, ?config: ProducerConfig, ?serialize: 'T -> string) : Producer<'T> =
        let producerConfig = defaultArg config ProducerConfig.defaultConfig
        let serializeFn = defaultArg serialize (fun v -> JsonSerializer.Serialize(v))
        Producer<'T>(this, topic, producerConfig, serializeFn)

    /// Creates a consumer for the specified topic and group.
    member this.Consumer<'T>(topic: string, group: string, ?config: ConsumerConfig, ?deserialize: string -> 'T option) : Consumer<'T> =
        let consumerConfig = defaultArg config ConsumerConfig.defaultConfig
        let deserializeFn = defaultArg deserialize (fun s ->
            try Some (JsonSerializer.Deserialize<'T>(s))
            with _ -> None
        )
        Consumer<'T>(this, topic, group, consumerConfig, deserializeFn)

    /// Creates a batch consumer for the specified topic and group.
    member this.BatchConsumer<'T>(topic: string, group: string, ?config: BatchConsumerConfig, ?deserialize: string -> 'T option) : BatchConsumer<'T> =
        let batchConfig = defaultArg config BatchConsumerConfig.defaultConfig
        let deserializeFn = defaultArg deserialize (fun s ->
            try Some (JsonSerializer.Deserialize<'T>(s))
            with _ -> None
        )
        BatchConsumer<'T>(this, topic, group, batchConfig, deserializeFn)

    /// Gets the admin client.
    member this.Admin : Admin =
        Admin(this)

    /// Runs a function within a transaction.
    member this.Transaction<'T>(topic: string, action: Transaction<'T> -> unit) : KafkaResult<RecordMetadata list> =
        let producer = this.Producer<'T>(topic)
        Transaction.run producer action

    /// Runs an async function within a transaction.
    member this.TransactionAsync<'T>(topic: string, action: Transaction<'T> -> Async<unit>) : AsyncKafkaResult<RecordMetadata list> =
        let producer = this.Producer<'T>(topic)
        Transaction.runAsync producer action

/// Module for Kafka operations.
[<RequireQualifiedAccess>]
module Kafka =

    // =========================================================================
    // Client Creation
    // =========================================================================

    /// Creates a new Kafka client with default configuration.
    let create () = Kafka()

    /// Creates a Kafka client with custom configuration.
    let withConfig config = Kafka.Create(config)

    /// Creates a Kafka client from environment variables.
    let fromEnv () = Kafka.FromEnv()

    /// Creates a Kafka client with a specific URL.
    let withUrl url =
        Kafka.Create({ KafkaConfig.defaultConfig with Url = url })

    /// Creates a Kafka client with URL and API key.
    let withCredentials url apiKey =
        Kafka.Create({ KafkaConfig.defaultConfig with Url = url; ApiKey = Some apiKey })

    // =========================================================================
    // Producer Operations
    // =========================================================================

    /// Creates a producer.
    let producer<'T> topic (kafka: Kafka) = kafka.Producer<'T>(topic)

    /// Creates a producer with config.
    let producerWithConfig<'T> topic config (kafka: Kafka) = kafka.Producer<'T>(topic, config)

    /// Sends a message to a topic.
    let send<'T> topic (value: 'T) (kafka: Kafka) =
        kafka.Producer<'T>(topic).Send(value)

    /// Sends a message with a key.
    let sendWithKey<'T> topic key (value: 'T) (kafka: Kafka) =
        kafka.Producer<'T>(topic).Send(value, key = key)

    /// Sends a batch of messages.
    let sendBatch<'T> topic (values: 'T list) (kafka: Kafka) =
        kafka.Producer<'T>(topic).SendBatch(values)

    // =========================================================================
    // Consumer Operations
    // =========================================================================

    /// Creates a consumer.
    let consumer<'T> topic group (kafka: Kafka) = kafka.Consumer<'T>(topic, group)

    /// Creates a consumer with config.
    let consumerWithConfig<'T> topic group config (kafka: Kafka) = kafka.Consumer<'T>(topic, group, config)

    /// Creates a batch consumer.
    let batchConsumer<'T> topic group (kafka: Kafka) = kafka.BatchConsumer<'T>(topic, group)

    /// Creates a batch consumer with config.
    let batchConsumerWithConfig<'T> topic group config (kafka: Kafka) = kafka.BatchConsumer<'T>(topic, group, config)

    // =========================================================================
    // Admin Operations
    // =========================================================================

    /// Gets the admin client.
    let admin (kafka: Kafka) = kafka.Admin

    /// Creates a topic.
    let createTopic name (kafka: Kafka) = kafka.Admin.CreateTopic(name)

    /// Creates a topic with configuration.
    let createTopicWithConfig name config (kafka: Kafka) = kafka.Admin.CreateTopic(name, config)

    /// Lists all topics.
    let listTopics (kafka: Kafka) = kafka.Admin.ListTopics()

    /// Deletes a topic.
    let deleteTopic name (kafka: Kafka) = kafka.Admin.DeleteTopic(name)

    // =========================================================================
    // Transaction Operations
    // =========================================================================

    /// Runs a transaction.
    let transaction<'T> topic action (kafka: Kafka) = kafka.Transaction<'T>(topic, action)

    /// Runs an async transaction.
    let transactionAsync<'T> topic action (kafka: Kafka) = kafka.TransactionAsync<'T>(topic, action)

// =========================================================================
// Computation Expression Builders
// =========================================================================

/// Builder for Kafka operations with result handling.
type KafkaBuilder() =
    member _.Bind(result: KafkaResult<'T>, f: 'T -> KafkaResult<'U>) : KafkaResult<'U> =
        Result.bind f result

    member _.Return(value: 'T) : KafkaResult<'T> =
        Ok value

    member _.ReturnFrom(result: KafkaResult<'T>) : KafkaResult<'T> =
        result

    member _.Zero() : KafkaResult<unit> =
        Ok ()

    member _.Combine(a: KafkaResult<unit>, b: KafkaResult<'T>) : KafkaResult<'T> =
        match a with
        | Ok () -> b
        | Error e -> Error e

    member _.Delay(f: unit -> KafkaResult<'T>) : unit -> KafkaResult<'T> =
        f

    member _.Run(f: unit -> KafkaResult<'T>) : KafkaResult<'T> =
        f ()

    member _.TryWith(body: unit -> KafkaResult<'T>, handler: exn -> KafkaResult<'T>) : KafkaResult<'T> =
        try body () with ex -> handler ex

    member this.Using(resource: 'T when 'T :> IDisposable, body: 'T -> KafkaResult<'U>) : KafkaResult<'U> =
        try body resource finally resource.Dispose()

    member _.While(guard: unit -> bool, body: unit -> KafkaResult<unit>) : KafkaResult<unit> =
        let rec loop () =
            if guard () then
                match body () with
                | Ok () -> loop ()
                | Error e -> Error e
            else
                Ok ()
        loop ()

    member _.For(sequence: 'T seq, body: 'T -> KafkaResult<unit>) : KafkaResult<unit> =
        sequence
        |> Seq.fold (fun acc item ->
            match acc with
            | Ok () -> body item
            | Error e -> Error e
        ) (Ok ())

/// Builder for async Kafka operations.
type AsyncKafkaBuilder() =
    member _.Bind(result: AsyncKafkaResult<'T>, f: 'T -> AsyncKafkaResult<'U>) : AsyncKafkaResult<'U> =
        AsyncKafkaResult.bind f result

    member _.Bind(asyncOp: Async<'T>, f: 'T -> AsyncKafkaResult<'U>) : AsyncKafkaResult<'U> =
        async {
            let! value = asyncOp
            return! f value
        }

    member _.Return(value: 'T) : AsyncKafkaResult<'T> =
        AsyncKafkaResult.ok value

    member _.ReturnFrom(result: AsyncKafkaResult<'T>) : AsyncKafkaResult<'T> =
        result

    member _.Zero() : AsyncKafkaResult<unit> =
        AsyncKafkaResult.ok ()

    member _.Combine(a: AsyncKafkaResult<unit>, b: AsyncKafkaResult<'T>) : AsyncKafkaResult<'T> =
        AsyncKafkaResult.bind (fun () -> b) a

    member _.Delay(f: unit -> AsyncKafkaResult<'T>) : unit -> AsyncKafkaResult<'T> =
        f

    member _.Run(f: unit -> AsyncKafkaResult<'T>) : AsyncKafkaResult<'T> =
        f ()

    member _.TryWith(body: unit -> AsyncKafkaResult<'T>, handler: exn -> AsyncKafkaResult<'T>) : AsyncKafkaResult<'T> =
        async {
            try return! body ()
            with ex -> return! handler ex
        }

    member this.Using(resource: 'T when 'T :> IDisposable, body: 'T -> AsyncKafkaResult<'U>) : AsyncKafkaResult<'U> =
        async {
            try return! body resource
            finally resource.Dispose()
        }

// =========================================================================
// Auto-Open Module for Common Functions
// =========================================================================

/// Auto-opened module providing common Kafka functions.
[<AutoOpen>]
module KafkaPrelude =
    /// Computation expression for Kafka operations.
    let kafka = KafkaBuilder()

    /// Computation expression for async Kafka operations.
    let kafkaAsync = AsyncKafkaBuilder()
