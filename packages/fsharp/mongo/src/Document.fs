namespace DotDo.Mongo

open System
open System.Text.Json

/// A MongoDB document - a mutable dictionary-like type with type-safe accessors.
/// Provides functional-style operations returning Option and Result.
type Document private (data: Map<string, BsonValue>) =

    /// Creates a new empty document.
    new() = Document(Map.empty)

    /// Gets the underlying data as a Map.
    member _.ToMap() = data

    /// Gets the number of fields.
    member _.Count = Map.count data

    /// Checks if the document is empty.
    member _.IsEmpty = Map.isEmpty data

    /// Checks if the document contains a key.
    member _.ContainsKey(key: string) = Map.containsKey key data

    /// Gets all keys.
    member _.Keys = data |> Map.toSeq |> Seq.map fst

    /// Gets all values.
    member _.Values = data |> Map.toSeq |> Seq.map snd

    /// Gets a value by key.
    member _.Get(key: string) : BsonValue option =
        Map.tryFind key data

    /// Gets a value by key, returning a default if not found.
    member this.GetOrDefault(key: string, defaultValue: BsonValue) =
        this.Get(key) |> Option.defaultValue defaultValue

    /// Gets a string value.
    member this.GetString(key: string) : string option =
        this.Get(key) |> Option.bind BsonValue.tryString

    /// Gets an int value.
    member this.GetInt(key: string) : int option =
        this.Get(key) |> Option.bind BsonValue.tryInt32

    /// Gets a long value.
    member this.GetLong(key: string) : int64 option =
        this.Get(key) |> Option.bind BsonValue.tryInt64

    /// Gets a double value.
    member this.GetDouble(key: string) : float option =
        this.Get(key) |> Option.bind BsonValue.tryDouble

    /// Gets a boolean value.
    member this.GetBool(key: string) : bool option =
        this.Get(key) |> Option.bind BsonValue.tryBool

    /// Gets an ObjectId value.
    member this.GetObjectId(key: string) : ObjectId option =
        this.Get(key) |> Option.bind BsonValue.tryObjectId

    /// Gets the _id field as ObjectId.
    member this.Id : ObjectId option = this.GetObjectId("_id")

    /// Gets a DateTime value.
    member this.GetDateTime(key: string) : DateTimeOffset option =
        this.Get(key) |> Option.bind BsonValue.tryDateTime

    /// Gets a nested document.
    member this.GetDocument(key: string) : Document option =
        this.Get(key) |> Option.bind (function
            | BsonValue.Document map -> Some (Document(map))
            | _ -> None)

    /// Gets an array value.
    member this.GetArray(key: string) : BsonValue list option =
        this.Get(key) |> Option.bind BsonValue.tryArray

    /// Gets a typed list by mapping array elements.
    member this.GetList<'T>(key: string, mapper: BsonValue -> 'T option) : 'T list option =
        this.GetArray(key)
        |> Option.map (List.choose mapper)

    /// Gets a value using dot notation (e.g., "user.profile.name").
    member this.GetPath(path: string) : BsonValue option =
        let keys = path.Split('.')
        keys |> Array.fold (fun acc key ->
            acc |> Option.bind (fun doc ->
                match doc with
                | BsonValue.Document map -> Map.tryFind key map
                | _ -> None)
        ) (Some (BsonValue.Document data))

    /// Sets a value, returning a new Document.
    member _.Set(key: string, value: BsonValue) : Document =
        Document(Map.add key value data)

    /// Sets a value from an F# object.
    member this.SetValue(key: string, value: obj) : Document =
        this.Set(key, BsonValue.fromObj value)

    /// Removes a key, returning a new Document.
    member _.Remove(key: string) : Document =
        Document(Map.remove key data)

    /// Merges with another document (other's values take precedence).
    member _.Merge(other: Document) : Document =
        let merged =
            other.ToMap()
            |> Map.fold (fun acc k v -> Map.add k v acc) data
        Document(merged)

    /// Converts to a BsonValue.Document.
    member _.ToBsonValue() : BsonValue =
        BsonValue.Document data

    /// Converts to JSON string.
    member _.ToJson() : string =
        BsonValue.toJson (BsonValue.Document data)

    /// Converts to pretty-printed JSON.
    member _.ToPrettyJson() : string =
        let json = BsonValue.toJson (BsonValue.Document data)
        try
            use doc = JsonDocument.Parse(json)
            let options = JsonSerializerOptions(WriteIndented = true)
            JsonSerializer.Serialize(doc, options)
        with
        | _ -> json

    /// Iterates over key-value pairs.
    member _.ForEach(action: string -> BsonValue -> unit) =
        data |> Map.iter action

    /// Maps over values.
    member _.MapValues(f: BsonValue -> BsonValue) : Document =
        Document(data |> Map.map (fun _ v -> f v))

    /// Filters key-value pairs.
    member _.Filter(predicate: string -> BsonValue -> bool) : Document =
        Document(data |> Map.filter predicate)

    override _.ToString() = BsonValue.toJson (BsonValue.Document data)

    override _.Equals(obj) =
        match obj with
        | :? Document as other -> data = other.ToMap()
        | _ -> false

    override _.GetHashCode() = data.GetHashCode()

    /// Indexer for accessing values by key.
    member this.Item
        with get(key: string) = this.Get(key)

    /// Creates a document from key-value pairs using BsonValue.
    static member Create(pairs: (string * BsonValue) list) : Document =
        Document(Map.ofList pairs)

    /// Creates a document from key-value pairs using F# objects.
    static member From(pairs: (string * obj) list) : Document =
        pairs
        |> List.map (fun (k, v) -> k, BsonValue.fromObj v)
        |> Document.Create

    /// Creates an empty document.
    static member Empty = Document(Map.empty)

    /// Parses a document from JSON.
    static member Parse(json: string) : Result<Document, MongoError> =
        match BsonValue.parseJson json with
        | Ok (BsonValue.Document map) -> Ok (Document(map))
        | Ok _ -> Error (MongoError.SerializationError "JSON must be an object")
        | Error msg -> Error (MongoError.SerializationError msg)

/// Document module for functional-style operations.
module Document =
    /// Creates an empty document.
    let empty = Document.Empty

    /// Creates a document from key-value pairs.
    let create pairs = Document.Create(pairs)

    /// Creates a document from F# object pairs.
    let from pairs = Document.From(pairs)

    /// Parses a document from JSON.
    let parse json = Document.Parse(json)

    /// Gets a value by key.
    let get key (doc: Document) = doc.Get(key)

    /// Gets a string value.
    let getString key (doc: Document) = doc.GetString(key)

    /// Gets an int value.
    let getInt key (doc: Document) = doc.GetInt(key)

    /// Gets a long value.
    let getLong key (doc: Document) = doc.GetLong(key)

    /// Gets a double value.
    let getDouble key (doc: Document) = doc.GetDouble(key)

    /// Gets a boolean value.
    let getBool key (doc: Document) = doc.GetBool(key)

    /// Gets an ObjectId value.
    let getObjectId key (doc: Document) = doc.GetObjectId(key)

    /// Gets the _id field.
    let id (doc: Document) = doc.Id

    /// Gets a DateTime value.
    let getDateTime key (doc: Document) = doc.GetDateTime(key)

    /// Gets a nested document.
    let getDocument key (doc: Document) = doc.GetDocument(key)

    /// Gets an array value.
    let getArray key (doc: Document) = doc.GetArray(key)

    /// Gets a value using dot notation.
    let getPath path (doc: Document) = doc.GetPath(path)

    /// Sets a value.
    let set key value (doc: Document) = doc.Set(key, value)

    /// Sets a value from an F# object.
    let setValue key value (doc: Document) = doc.SetValue(key, value)

    /// Removes a key.
    let remove key (doc: Document) = doc.Remove(key)

    /// Merges two documents.
    let merge other (doc: Document) = doc.Merge(other)

    /// Converts to BsonValue.
    let toBsonValue (doc: Document) = doc.ToBsonValue()

    /// Converts to JSON.
    let toJson (doc: Document) = doc.ToJson()

    /// Converts to pretty JSON.
    let toPrettyJson (doc: Document) = doc.ToPrettyJson()

    /// Converts to Map.
    let toMap (doc: Document) = doc.ToMap()

    /// Gets the number of fields.
    let count (doc: Document) = doc.Count

    /// Checks if empty.
    let isEmpty (doc: Document) = doc.IsEmpty

    /// Checks if contains a key.
    let containsKey key (doc: Document) = doc.ContainsKey(key)

    /// Gets all keys.
    let keys (doc: Document) = doc.Keys

    /// Gets all values.
    let values (doc: Document) = doc.Values

    /// Maps over values.
    let mapValues f (doc: Document) = doc.MapValues(f)

    /// Filters key-value pairs.
    let filter predicate (doc: Document) = doc.Filter(predicate)
