namespace DotDo.Mongo

/// MongoDB sort builders for ordering query results.
[<RequireQualifiedAccess>]
module Sorts =

    /// Creates an empty sort (no ordering).
    let empty : Document = Document.empty

    /// Sorts by a field in ascending order.
    let ascending (field: string) : Document =
        Document.from [ field, box 1 ]

    /// Sorts by a field in descending order.
    let descending (field: string) : Document =
        Document.from [ field, box -1 ]

    /// Sorts by multiple fields in ascending order.
    let ascendingMany (fields: string list) : Document =
        fields
        |> List.map (fun f -> f, box 1)
        |> Document.from

    /// Sorts by multiple fields in descending order.
    let descendingMany (fields: string list) : Document =
        fields
        |> List.map (fun f -> f, box -1)
        |> Document.from

    /// Sorts by text search score.
    let textScore (field: string) : Document =
        Document.from [ field, box (Document.from [ "$meta", box "textScore" ]) ]

    /// Combines multiple sort specifications.
    let combine (sorts: Document seq) : Document =
        sorts
        |> Seq.fold (fun acc sort ->
            sort.ToMap()
            |> Map.fold (fun a k v -> Map.add k v a) acc
        ) Map.empty
        |> fun m -> Document.Create (Map.toList m)

    /// Creates a sort from a list of (field, ascending) pairs.
    let fromPairs (pairs: (string * bool) list) : Document =
        pairs
        |> List.map (fun (field, asc) -> field, box (if asc then 1 else -1))
        |> Document.from

/// Infix operators for combining sorts.
[<AutoOpen>]
module SortOperators =

    /// Combines two sorts (left takes precedence on conflicts).
    let (>>>) (a: Document) (b: Document) : Document =
        Sorts.combine [ a; b ]
