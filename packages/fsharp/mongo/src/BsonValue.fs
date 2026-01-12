namespace DotDo.Mongo

open System
open System.Text.Json

/// Represents a BSON value - the fundamental data type in MongoDB.
[<RequireQualifiedAccess>]
type BsonValue =
    | Null
    | Bool of bool
    | Int32 of int
    | Int64 of int64
    | Double of float
    | String of string
    | ObjectId of ObjectId
    | DateTime of DateTimeOffset
    | Binary of byte array
    | Array of BsonValue list
    | Document of Map<string, BsonValue>
    | Regex of pattern: string * options: string
    | MinKey
    | MaxKey

/// Module for working with BsonValue.
module BsonValue =
    /// Creates a null value.
    let nil = BsonValue.Null

    /// Creates a boolean value.
    let bool b = BsonValue.Bool b

    /// Creates an int32 value.
    let int32 i = BsonValue.Int32 i

    /// Creates an int64 value.
    let int64 i = BsonValue.Int64 i

    /// Creates a double value.
    let double d = BsonValue.Double d

    /// Creates a string value.
    let string s = BsonValue.String s

    /// Creates an ObjectId value.
    let objectId id = BsonValue.ObjectId id

    /// Creates a DateTime value.
    let dateTime dt = BsonValue.DateTime dt

    /// Creates a binary value.
    let binary b = BsonValue.Binary b

    /// Creates an array value.
    let array items = BsonValue.Array items

    /// Creates a document value.
    let document pairs = BsonValue.Document (Map.ofList pairs)

    /// Creates a regex value.
    let regex pattern options = BsonValue.Regex (pattern, options)

    /// The minimum key value.
    let minKey = BsonValue.MinKey

    /// The maximum key value.
    let maxKey = BsonValue.MaxKey

    /// Converts an F# value to BsonValue.
    let rec fromObj (obj: obj) : BsonValue =
        match obj with
        | null -> Null
        | :? bool as b -> Bool b
        | :? int as i -> Int32 i
        | :? int64 as i -> Int64 i
        | :? float as f -> Double f
        | :? float32 as f -> Double (float f)
        | :? decimal as d -> Double (float d)
        | :? string as s -> String s
        | :? ObjectId as id -> ObjectId id
        | :? DateTimeOffset as dt -> DateTime dt
        | :? DateTime as dt -> DateTime (DateTimeOffset dt)
        | :? (byte array) as b -> Binary b
        | :? BsonValue as bv -> bv
        | :? (Map<string, obj>) as m ->
            m |> Map.map (fun _ v -> fromObj v) |> Document
        | :? System.Collections.IEnumerable as e ->
            e |> Seq.cast<obj> |> Seq.map fromObj |> Seq.toList |> Array
        | _ -> String (obj.ToString())

    /// Converts a BsonValue to an F# object.
    let rec toObj (value: BsonValue) : obj =
        match value with
        | Null -> null
        | Bool b -> box b
        | Int32 i -> box i
        | Int64 i -> box i
        | Double d -> box d
        | String s -> box s
        | ObjectId id -> box id
        | DateTime dt -> box dt
        | Binary b -> box b
        | Array items -> items |> List.map toObj |> box
        | Document map -> map |> Map.map (fun _ v -> toObj v) |> box
        | Regex (p, o) -> box (p, o)
        | MinKey -> box "$$minKey"
        | MaxKey -> box "$$maxKey"

    /// Tries to get a boolean value.
    let tryBool = function
        | Bool b -> Some b
        | _ -> None

    /// Tries to get an int32 value.
    let tryInt32 = function
        | Int32 i -> Some i
        | Int64 i when i >= int64 Int32.MinValue && i <= int64 Int32.MaxValue -> Some (int i)
        | Double d when d = floor d && d >= float Int32.MinValue && d <= float Int32.MaxValue -> Some (int d)
        | _ -> None

    /// Tries to get an int64 value.
    let tryInt64 = function
        | Int64 i -> Some i
        | Int32 i -> Some (int64 i)
        | Double d when d = floor d -> Some (int64 d)
        | _ -> None

    /// Tries to get a double value.
    let tryDouble = function
        | Double d -> Some d
        | Int32 i -> Some (float i)
        | Int64 i -> Some (float i)
        | _ -> None

    /// Tries to get a string value.
    let tryString = function
        | String s -> Some s
        | _ -> None

    /// Tries to get an ObjectId value.
    let tryObjectId = function
        | ObjectId id -> Some id
        | String s -> ObjectId.tryParse s
        | _ -> None

    /// Tries to get a DateTime value.
    let tryDateTime = function
        | DateTime dt -> Some dt
        | Int64 ms -> Some (DateTimeOffset.FromUnixTimeMilliseconds ms)
        | _ -> None

    /// Tries to get an array value.
    let tryArray = function
        | Array items -> Some items
        | _ -> None

    /// Tries to get a document value.
    let tryDocument = function
        | Document map -> Some map
        | _ -> None

    /// Checks if the value is null.
    let isNull = function
        | Null -> true
        | _ -> false

    /// Gets a nested field from a document.
    let get (key: string) (value: BsonValue) : BsonValue option =
        match value with
        | Document map -> Map.tryFind key map
        | _ -> None

    /// Gets a nested field using dot notation (e.g., "user.profile.name").
    let getPath (path: string) (value: BsonValue) : BsonValue option =
        path.Split('.')
        |> Array.fold (fun acc key ->
            acc |> Option.bind (get key)
        ) (Some value)

    /// Converts to JSON string.
    let rec toJson (value: BsonValue) : string =
        match value with
        | Null -> "null"
        | Bool b -> if b then "true" else "false"
        | Int32 i -> string i
        | Int64 i -> string i
        | Double d ->
            if Double.IsNaN d then "null"
            elif Double.IsInfinity d then "null"
            else string d
        | String s -> JsonSerializer.Serialize(s)
        | ObjectId id -> sprintf """{"$oid":"%s"}""" (id.ToHexString())
        | DateTime dt -> sprintf """{"$date":%d}""" (dt.ToUnixTimeMilliseconds())
        | Binary b -> sprintf """{"$binary":"%s"}""" (Convert.ToBase64String b)
        | Array items ->
            let inner = items |> List.map toJson |> String.concat ","
            sprintf "[%s]" inner
        | Document map ->
            let inner =
                map
                |> Map.toList
                |> List.map (fun (k, v) -> sprintf "%s:%s" (JsonSerializer.Serialize k) (toJson v))
                |> String.concat ","
            sprintf "{%s}" inner
        | Regex (pattern, options) ->
            sprintf """{"$regex":%s,"$options":%s}"""
                (JsonSerializer.Serialize pattern)
                (JsonSerializer.Serialize options)
        | MinKey -> """{"$minKey":1}"""
        | MaxKey -> """{"$maxKey":1}"""

    /// Parses a JSON string into a BsonValue.
    let parseJson (json: string) : Result<BsonValue, string> =
        try
            let doc = JsonDocument.Parse(json)
            let rec parseElement (elem: JsonElement) : BsonValue =
                match elem.ValueKind with
                | JsonValueKind.Null -> Null
                | JsonValueKind.True -> Bool true
                | JsonValueKind.False -> Bool false
                | JsonValueKind.Number ->
                    if elem.TryGetInt32() |> fst then Int32 (elem.GetInt32())
                    elif elem.TryGetInt64() |> fst then Int64 (elem.GetInt64())
                    else Double (elem.GetDouble())
                | JsonValueKind.String -> String (elem.GetString())
                | JsonValueKind.Array ->
                    elem.EnumerateArray()
                    |> Seq.map parseElement
                    |> Seq.toList
                    |> Array
                | JsonValueKind.Object ->
                    // Check for extended JSON types
                    let props = elem.EnumerateObject() |> Seq.toList
                    match props with
                    | [ p ] when p.Name = "$oid" ->
                        match ObjectId.parse (p.Value.GetString()) with
                        | Ok id -> ObjectId id
                        | Error _ -> String (p.Value.GetString())
                    | [ p ] when p.Name = "$date" ->
                        DateTime (DateTimeOffset.FromUnixTimeMilliseconds(p.Value.GetInt64()))
                    | [ p ] when p.Name = "$binary" ->
                        Binary (Convert.FromBase64String(p.Value.GetString()))
                    | [ p ] when p.Name = "$minKey" -> MinKey
                    | [ p ] when p.Name = "$maxKey" -> MaxKey
                    | [ p1; p2 ] when p1.Name = "$regex" && p2.Name = "$options" ->
                        Regex (p1.Value.GetString(), p2.Value.GetString())
                    | _ ->
                        props
                        |> List.map (fun p -> p.Name, parseElement p.Value)
                        |> Map.ofList
                        |> Document
                | _ -> Null
            Ok (parseElement doc.RootElement)
        with
        | ex -> Error ex.Message
