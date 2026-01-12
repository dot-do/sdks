namespace DotDo.Mongo

open System

/// MongoDB update builders for constructing update operations.
[<RequireQualifiedAccess>]
module Updates =

    /// Creates an empty update.
    let empty : Document = Document.empty

    /// Sets the value of a field.
    let set (field: string) (value: obj) : Document =
        Document.from [ "$set", box (Document.from [ field, value ]) ]

    /// Sets multiple field values.
    let setMany (pairs: (string * obj) list) : Document =
        Document.from [ "$set", box (Document.from pairs) ]

    /// Sets the value of a field if the document is inserted (upsert).
    let setOnInsert (field: string) (value: obj) : Document =
        Document.from [ "$setOnInsert", box (Document.from [ field, value ]) ]

    /// Removes a field from the document.
    let unset (field: string) : Document =
        Document.from [ "$unset", box (Document.from [ field, box "" ]) ]

    /// Removes multiple fields from the document.
    let unsetMany (fields: string list) : Document =
        let pairs = fields |> List.map (fun f -> f, box "")
        Document.from [ "$unset", box (Document.from pairs) ]

    /// Renames a field.
    let rename (field: string) (newName: string) : Document =
        Document.from [ "$rename", box (Document.from [ field, box newName ]) ]

    /// Increments a numeric field by the given amount.
    let inc (field: string) (amount: int) : Document =
        Document.from [ "$inc", box (Document.from [ field, box amount ]) ]

    /// Increments a numeric field by the given amount (long).
    let incLong (field: string) (amount: int64) : Document =
        Document.from [ "$inc", box (Document.from [ field, box amount ]) ]

    /// Increments a numeric field by the given amount (double).
    let incDouble (field: string) (amount: float) : Document =
        Document.from [ "$inc", box (Document.from [ field, box amount ]) ]

    /// Multiplies a numeric field by the given factor.
    let mul (field: string) (factor: float) : Document =
        Document.from [ "$mul", box (Document.from [ field, box factor ]) ]

    /// Sets the field to the specified value if it is less than the current value.
    let min (field: string) (value: obj) : Document =
        Document.from [ "$min", box (Document.from [ field, value ]) ]

    /// Sets the field to the specified value if it is greater than the current value.
    let max (field: string) (value: obj) : Document =
        Document.from [ "$max", box (Document.from [ field, value ]) ]

    /// Sets the field to the current date.
    let currentDate (field: string) : Document =
        Document.from [ "$currentDate", box (Document.from [ field, box true ]) ]

    /// Sets the field to the current timestamp.
    let currentTimestamp (field: string) : Document =
        Document.from [ "$currentDate", box (Document.from [ field, box (Document.from [ "$type", box "timestamp" ]) ]) ]

    /// Adds a value to an array if it doesn't already exist.
    let addToSet (field: string) (value: obj) : Document =
        Document.from [ "$addToSet", box (Document.from [ field, value ]) ]

    /// Adds multiple values to an array if they don't already exist.
    let addToSetEach (field: string) (values: 'T seq) : Document =
        Document.from [
            "$addToSet", box (Document.from [
                field, box (Document.from [ "$each", box (Seq.toList values) ])
            ])
        ]

    /// Removes the first element from an array.
    let popFirst (field: string) : Document =
        Document.from [ "$pop", box (Document.from [ field, box -1 ]) ]

    /// Removes the last element from an array.
    let popLast (field: string) : Document =
        Document.from [ "$pop", box (Document.from [ field, box 1 ]) ]

    /// Appends a value to an array.
    let push (field: string) (value: obj) : Document =
        Document.from [ "$push", box (Document.from [ field, value ]) ]

    /// Appends multiple values to an array.
    let pushEach (field: string) (values: 'T seq) : Document =
        Document.from [
            "$push", box (Document.from [
                field, box (Document.from [ "$each", box (Seq.toList values) ])
            ])
        ]

    /// Appends values to an array with sort and slice.
    let pushEachWithOptions
        (field: string)
        (values: 'T seq)
        (sort: Document option)
        (slice: int option)
        (position: int option) : Document =
        let opts = [
            "$each", box (Seq.toList values)
        ]
        let opts' =
            opts
            |> fun o -> match sort with Some s -> ("$sort", box s) :: o | None -> o
            |> fun o -> match slice with Some n -> ("$slice", box n) :: o | None -> o
            |> fun o -> match position with Some p -> ("$position", box p) :: o | None -> o
        Document.from [
            "$push", box (Document.from [ field, box (Document.from opts') ])
        ]

    /// Removes all matching values from an array.
    let pull (field: string) (value: obj) : Document =
        Document.from [ "$pull", box (Document.from [ field, value ]) ]

    /// Removes all elements matching the filter from an array.
    let pullFilter (field: string) (filter: Document) : Document =
        Document.from [ "$pull", box (Document.from [ field, box filter ]) ]

    /// Removes all matching values from an array.
    let pullAll (field: string) (values: 'T seq) : Document =
        Document.from [ "$pullAll", box (Document.from [ field, box (Seq.toList values) ]) ]

    /// Performs a bitwise AND on a field.
    let bitAnd (field: string) (mask: int64) : Document =
        Document.from [ "$bit", box (Document.from [ field, box (Document.from [ "and", box mask ]) ]) ]

    /// Performs a bitwise OR on a field.
    let bitOr (field: string) (mask: int64) : Document =
        Document.from [ "$bit", box (Document.from [ field, box (Document.from [ "or", box mask ]) ]) ]

    /// Performs a bitwise XOR on a field.
    let bitXor (field: string) (mask: int64) : Document =
        Document.from [ "$bit", box (Document.from [ field, box (Document.from [ "xor", box mask ]) ]) ]

    /// Combines multiple update operations.
    let combine (updates: Document seq) : Document =
        updates
        |> Seq.fold (fun acc update ->
            update.ToMap()
            |> Map.fold (fun (a: Map<string, BsonValue>) k v ->
                match Map.tryFind k a, v with
                | Some (BsonValue.Document existing), BsonValue.Document new' ->
                    Map.add k (BsonValue.Document (Map.fold (fun m k' v' -> Map.add k' v' m) existing new')) a
                | _ ->
                    Map.add k v a
            ) acc
        ) Map.empty
        |> fun m -> Document.Create (Map.toList m)

/// Infix operators for combining updates.
[<AutoOpen>]
module UpdateOperators =

    /// Combines two updates.
    let (++) (a: Document) (b: Document) : Document =
        Updates.combine [ a; b ]
