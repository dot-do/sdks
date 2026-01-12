namespace DotDo.Mongo

open System

/// Represents errors that can occur during MongoDB operations.
[<RequireQualifiedAccess>]
type MongoError =
    /// Connection to the database failed.
    | ConnectionError of message: string
    /// The operation timed out.
    | Timeout of operation: string * elapsed: TimeSpan
    /// Authentication failed.
    | AuthenticationError of reason: string
    /// The requested entity was not found.
    | NotFound of collection: string * filter: string
    /// A document with the same key already exists.
    | DuplicateKey of collection: string * key: string
    /// The document validation failed.
    | ValidationError of field: string * message: string
    /// The document is too large.
    | DocumentTooLarge of size: int64 * maxSize: int64
    /// An error occurred during serialization.
    | SerializationError of message: string
    /// The write operation was not acknowledged.
    | WriteError of code: int * message: string
    /// A bulk write operation partially failed.
    | BulkWriteError of errors: (int * string) list
    /// The server returned an error.
    | ServerError of code: int * message: string
    /// The operation was cancelled.
    | Cancelled
    /// An unknown error occurred.
    | Unknown of message: string

/// Module for working with MongoError.
module MongoError =
    /// Gets the error message.
    let message (error: MongoError) : string =
        match error with
        | MongoError.ConnectionError msg -> $"Connection error: {msg}"
        | MongoError.Timeout (op, elapsed) -> $"Operation '{op}' timed out after {elapsed}"
        | MongoError.AuthenticationError reason -> $"Authentication failed: {reason}"
        | MongoError.NotFound (collection, filter) -> $"Not found in {collection}: {filter}"
        | MongoError.DuplicateKey (collection, key) -> $"Duplicate key in {collection}: {key}"
        | MongoError.ValidationError (field, msg) -> $"Validation error for {field}: {msg}"
        | MongoError.DocumentTooLarge (size, maxSize) -> $"Document too large: {size} bytes (max: {maxSize})"
        | MongoError.SerializationError msg -> $"Serialization error: {msg}"
        | MongoError.WriteError (code, msg) -> $"Write error {code}: {msg}"
        | MongoError.BulkWriteError errors ->
            let errMsgs = errors |> List.map (fun (i, m) -> $"  [{i}]: {m}") |> String.concat "\n"
            $"Bulk write errors:\n{errMsgs}"
        | MongoError.ServerError (code, msg) -> $"Server error {code}: {msg}"
        | MongoError.Cancelled -> "Operation was cancelled"
        | MongoError.Unknown msg -> $"Unknown error: {msg}"

    /// Checks if the error is retryable.
    let isRetryable (error: MongoError) : bool =
        match error with
        | MongoError.ConnectionError _ -> true
        | MongoError.Timeout _ -> true
        | MongoError.ServerError (code, _) ->
            // Network errors, not primary, etc.
            code = 6 || code = 7 || code = 89 || code = 91 || code = 189
        | _ -> false

    /// Creates an error from a server error code and message.
    let fromServerError (code: int) (message: string) : MongoError =
        match code with
        | 11000 | 11001 -> MongoError.DuplicateKey ("unknown", message)
        | 18 -> MongoError.AuthenticationError message
        | 50 -> MongoError.Timeout ("server", TimeSpan.Zero)
        | 121 -> MongoError.ValidationError ("document", message)
        | _ -> MongoError.ServerError (code, message)

    /// Converts the error to an exception.
    let toException (error: MongoError) : Exception =
        Exception(message error)

/// Result type alias for MongoDB operations.
type MongoResult<'T> = Result<'T, MongoError>

/// Async result type for MongoDB operations.
type AsyncMongoResult<'T> = Async<Result<'T, MongoError>>

/// Module for working with MongoResult.
module MongoResult =
    /// Maps over the success value.
    let map (f: 'T -> 'U) (result: MongoResult<'T>) : MongoResult<'U> =
        Result.map f result

    /// Maps over the error value.
    let mapError (f: MongoError -> MongoError) (result: MongoResult<'T>) : MongoResult<'T> =
        Result.mapError f result

    /// Binds the result to another operation.
    let bind (f: 'T -> MongoResult<'U>) (result: MongoResult<'T>) : MongoResult<'U> =
        Result.bind f result

    /// Returns a successful result.
    let ok (value: 'T) : MongoResult<'T> = Ok value

    /// Returns an error result.
    let error (err: MongoError) : MongoResult<'T> = Error err

    /// Converts an option to a result with a NotFound error.
    let ofOption (collection: string) (filter: string) (opt: 'T option) : MongoResult<'T> =
        match opt with
        | Some value -> Ok value
        | None -> Error (MongoError.NotFound (collection, filter))

    /// Converts a result to an option.
    let toOption (result: MongoResult<'T>) : 'T option =
        match result with
        | Ok value -> Some value
        | Error _ -> None

    /// Gets the value or a default.
    let defaultValue (defaultVal: 'T) (result: MongoResult<'T>) : 'T =
        match result with
        | Ok value -> value
        | Error _ -> defaultVal

    /// Gets the value or raises an exception.
    let getOrThrow (result: MongoResult<'T>) : 'T =
        match result with
        | Ok value -> value
        | Error err -> raise (MongoError.toException err)

/// Module for working with AsyncMongoResult.
module AsyncMongoResult =
    /// Maps over the success value.
    let map (f: 'T -> 'U) (ar: AsyncMongoResult<'T>) : AsyncMongoResult<'U> =
        async {
            match! ar with
            | Ok value -> return Ok (f value)
            | Error err -> return Error err
        }

    /// Binds the result to another async operation.
    let bind (f: 'T -> AsyncMongoResult<'U>) (ar: AsyncMongoResult<'T>) : AsyncMongoResult<'U> =
        async {
            match! ar with
            | Ok value -> return! f value
            | Error err -> return Error err
        }

    /// Maps over the error value.
    let mapError (f: MongoError -> MongoError) (ar: AsyncMongoResult<'T>) : AsyncMongoResult<'T> =
        async {
            match! ar with
            | Ok value -> return Ok value
            | Error err -> return Error (f err)
        }

    /// Returns a successful async result.
    let ok (value: 'T) : AsyncMongoResult<'T> =
        async { return Ok value }

    /// Returns an error async result.
    let error (err: MongoError) : AsyncMongoResult<'T> =
        async { return Error err }

    /// Kleisli composition operator.
    let (>=>) (f: 'A -> AsyncMongoResult<'B>) (g: 'B -> AsyncMongoResult<'C>) : 'A -> AsyncMongoResult<'C> =
        fun a -> bind g (f a)
