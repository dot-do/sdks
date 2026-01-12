namespace DotDo.Mongo

open System

/// Main entry point for the DotDo MongoDB SDK.
/// Provides a functional-first API for MongoDB operations.
[<RequireQualifiedAccess>]
module Mongo =

    // =========================================================================
    // Connection
    // =========================================================================

    /// Creates a new MongoDB client from a connection string.
    let client (connectionString: string) : MongoClient =
        MongoClient.Create(connectionString)

    /// Creates and connects a MongoDB client.
    let connect (connectionString: string) : MongoResult<MongoClient> =
        MongoClient.Connect(connectionString)

    /// Creates and connects a MongoDB client asynchronously.
    let connectAsync (connectionString: string) : AsyncMongoResult<MongoClient> =
        MongoClient.ConnectAsync(connectionString)

    /// Runs an operation with a connected client, ensuring proper cleanup.
    let withConnection (connectionString: string) (f: MongoClient -> 'T) : MongoResult<'T> =
        MongoClient.withClient connectionString f

    /// Runs an async operation with a connected client.
    let withConnectionAsync (connectionString: string) (f: MongoClient -> Async<'T>) : AsyncMongoResult<'T> =
        MongoClient.withClientAsync connectionString f

    // =========================================================================
    // Database Operations
    // =========================================================================

    /// Gets a database from a client.
    let database (name: string) (client: MongoClient) : MongoDatabase =
        client.GetDatabase(name)

    /// Gets the default database from a client.
    let defaultDatabase (client: MongoClient) : MongoDatabase =
        client.GetDefaultDatabase()

    // =========================================================================
    // Collection Operations
    // =========================================================================

    /// Gets a collection from a database.
    let collection (name: string) (db: MongoDatabase) : MongoCollection<Document> =
        db.GetCollection(name)

    /// Gets a typed collection from a database.
    let typedCollection<'T> (name: string) (codec: Document -> 'T option) (encode: 'T -> Document) (db: MongoDatabase) : MongoCollection<'T> =
        db.GetCollection(name, codec, encode)

    // =========================================================================
    // Document Builders (Re-exports for convenience)
    // =========================================================================

    /// Creates an empty document.
    let doc () = Document.empty

    /// Creates a document from key-value pairs.
    let docFrom (pairs: (string * obj) list) = Document.from pairs

    // =========================================================================
    // Computation Expression Builders
    // =========================================================================

    /// Builder for MongoDB operations with result handling.
    type MongoBuilder() =
        member _.Bind(result: MongoResult<'T>, f: 'T -> MongoResult<'U>) : MongoResult<'U> =
            Result.bind f result

        member _.Return(value: 'T) : MongoResult<'T> =
            Ok value

        member _.ReturnFrom(result: MongoResult<'T>) : MongoResult<'T> =
            result

        member _.Zero() : MongoResult<unit> =
            Ok ()

        member _.Combine(a: MongoResult<unit>, b: MongoResult<'T>) : MongoResult<'T> =
            match a with
            | Ok () -> b
            | Error e -> Error e

        member _.Delay(f: unit -> MongoResult<'T>) : unit -> MongoResult<'T> =
            f

        member _.Run(f: unit -> MongoResult<'T>) : MongoResult<'T> =
            f ()

        member _.TryWith(body: unit -> MongoResult<'T>, handler: exn -> MongoResult<'T>) : MongoResult<'T> =
            try
                body ()
            with ex ->
                handler ex

        member _.TryFinally(body: unit -> MongoResult<'T>, compensation: unit -> unit) : MongoResult<'T> =
            try
                body ()
            finally
                compensation ()

        member this.Using(resource: 'T when 'T :> IDisposable, body: 'T -> MongoResult<'U>) : MongoResult<'U> =
            this.TryFinally(
                (fun () -> body resource),
                (fun () -> if not (obj.ReferenceEquals(resource, null)) then resource.Dispose())
            )

        member _.While(guard: unit -> bool, body: unit -> MongoResult<unit>) : MongoResult<unit> =
            let rec loop () =
                if guard () then
                    match body () with
                    | Ok () -> loop ()
                    | Error e -> Error e
                else
                    Ok ()
            loop ()

        member _.For(sequence: 'T seq, body: 'T -> MongoResult<unit>) : MongoResult<unit> =
            sequence
            |> Seq.fold (fun acc item ->
                match acc with
                | Ok () -> body item
                | Error e -> Error e
            ) (Ok ())

    /// Builder for async MongoDB operations.
    type AsyncMongoBuilder() =
        member _.Bind(result: AsyncMongoResult<'T>, f: 'T -> AsyncMongoResult<'U>) : AsyncMongoResult<'U> =
            AsyncMongoResult.bind f result

        member _.Bind(asyncOp: Async<'T>, f: 'T -> AsyncMongoResult<'U>) : AsyncMongoResult<'U> =
            async {
                let! value = asyncOp
                return! f value
            }

        member _.Return(value: 'T) : AsyncMongoResult<'T> =
            AsyncMongoResult.ok value

        member _.ReturnFrom(result: AsyncMongoResult<'T>) : AsyncMongoResult<'T> =
            result

        member _.Zero() : AsyncMongoResult<unit> =
            AsyncMongoResult.ok ()

        member _.Combine(a: AsyncMongoResult<unit>, b: AsyncMongoResult<'T>) : AsyncMongoResult<'T> =
            AsyncMongoResult.bind (fun () -> b) a

        member _.Delay(f: unit -> AsyncMongoResult<'T>) : unit -> AsyncMongoResult<'T> =
            f

        member _.Run(f: unit -> AsyncMongoResult<'T>) : AsyncMongoResult<'T> =
            f ()

        member _.TryWith(body: unit -> AsyncMongoResult<'T>, handler: exn -> AsyncMongoResult<'T>) : AsyncMongoResult<'T> =
            async {
                try
                    return! body ()
                with ex ->
                    return! handler ex
            }

        member _.TryFinally(body: unit -> AsyncMongoResult<'T>, compensation: unit -> unit) : AsyncMongoResult<'T> =
            async {
                try
                    return! body ()
                finally
                    compensation ()
            }

        member this.Using(resource: 'T when 'T :> IDisposable, body: 'T -> AsyncMongoResult<'U>) : AsyncMongoResult<'U> =
            this.TryFinally(
                (fun () -> body resource),
                (fun () -> if not (obj.ReferenceEquals(resource, null)) then resource.Dispose())
            )

        member _.While(guard: unit -> bool, body: unit -> AsyncMongoResult<unit>) : AsyncMongoResult<unit> =
            async {
                let rec loop () = async {
                    if guard () then
                        match! body () with
                        | Ok () -> return! loop ()
                        | Error e -> return Error e
                    else
                        return Ok ()
                }
                return! loop ()
            }

        member _.For(sequence: 'T seq, body: 'T -> AsyncMongoResult<unit>) : AsyncMongoResult<unit> =
            async {
                let mutable result = Ok ()
                for item in sequence do
                    match result with
                    | Ok () ->
                        let! r = body item
                        result <- r
                    | Error _ -> ()
                return result
            }

    /// Computation expression for MongoDB operations.
    let mongo = MongoBuilder()

    /// Computation expression for async MongoDB operations.
    let mongoAsync = AsyncMongoBuilder()

// =========================================================================
// Auto-Open Module for Common Functions
// =========================================================================

/// Auto-opened module providing common MongoDB functions.
[<AutoOpen>]
module MongoPrelude =
    /// Computation expression for MongoDB operations.
    let mongo = Mongo.mongo

    /// Computation expression for async MongoDB operations.
    let mongoAsync = Mongo.mongoAsync
