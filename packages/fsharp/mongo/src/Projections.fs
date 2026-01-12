namespace DotDo.Mongo

/// MongoDB projection builders for selecting which fields to return.
[<RequireQualifiedAccess>]
module Projections =

    /// Creates an empty projection (returns all fields).
    let empty : Document = Document.empty

    /// Includes only the specified fields.
    let include' (fields: string list) : Document =
        fields
        |> List.map (fun f -> f, box 1)
        |> Document.from

    /// Excludes the specified fields.
    let exclude (fields: string list) : Document =
        fields
        |> List.map (fun f -> f, box 0)
        |> Document.from

    /// Excludes only the _id field.
    let excludeId : Document =
        Document.from [ "_id", box 0 ]

    /// Includes only the _id field.
    let idOnly : Document =
        include' [ "_id" ]

    /// Includes a computed field using an expression.
    let computed (field: string) (expression: Document) : Document =
        Document.from [ field, box expression ]

    /// Projects the first matching element of an array.
    let elemMatch (field: string) (filter: Document) : Document =
        Document.from [ field, box (Document.from [ "$elemMatch", box filter ]) ]

    /// Projects a slice of an array.
    let slice (field: string) (count: int) : Document =
        Document.from [ field, box (Document.from [ "$slice", box count ]) ]

    /// Projects a slice of an array starting at an offset.
    let sliceWithOffset (field: string) (skip: int) (limit: int) : Document =
        Document.from [ field, box (Document.from [ "$slice", box [ skip; limit ] ]) ]

    /// Projects the text search score.
    let textScore (field: string) : Document =
        Document.from [ field, box (Document.from [ "$meta", box "textScore" ]) ]

    /// Combines multiple projections.
    let combine (projections: Document seq) : Document =
        projections
        |> Seq.fold (fun acc proj ->
            proj.ToMap()
            |> Map.fold (fun a k v -> Map.add k v a) acc
        ) Map.empty
        |> fun m -> Document.Create (Map.toList m)
