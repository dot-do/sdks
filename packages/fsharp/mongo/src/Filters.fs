namespace DotDo.Mongo

/// MongoDB filter builders for constructing queries.
/// Returns Document representations suitable for query operations.
[<RequireQualifiedAccess>]
module Filters =

    /// Creates an empty filter (matches all documents).
    let empty : Document = Document.empty

    /// Matches documents where the field equals the value.
    let eq (field: string) (value: obj) : Document =
        Document.from [ field, value ]

    /// Matches documents where the field does not equal the value.
    let ne (field: string) (value: obj) : Document =
        Document.from [ field, box (Document.from [ "$ne", value ]) ]

    /// Matches documents where the field is greater than the value.
    let gt (field: string) (value: obj) : Document =
        Document.from [ field, box (Document.from [ "$gt", value ]) ]

    /// Matches documents where the field is greater than or equal to the value.
    let gte (field: string) (value: obj) : Document =
        Document.from [ field, box (Document.from [ "$gte", value ]) ]

    /// Matches documents where the field is less than the value.
    let lt (field: string) (value: obj) : Document =
        Document.from [ field, box (Document.from [ "$lt", value ]) ]

    /// Matches documents where the field is less than or equal to the value.
    let lte (field: string) (value: obj) : Document =
        Document.from [ field, box (Document.from [ "$lte", value ]) ]

    /// Matches documents where the field value is in the given list.
    let in' (field: string) (values: 'T seq) : Document =
        Document.from [ field, box (Document.from [ "$in", box (Seq.toList values) ]) ]

    /// Matches documents where the field value is not in the given list.
    let nin (field: string) (values: 'T seq) : Document =
        Document.from [ field, box (Document.from [ "$nin", box (Seq.toList values) ]) ]

    /// Matches documents where the field exists (or not).
    let exists (field: string) (exists: bool) : Document =
        Document.from [ field, box (Document.from [ "$exists", box exists ]) ]

    /// Matches documents where the field is of the specified BSON type.
    let typeIs (field: string) (bsonType: string) : Document =
        Document.from [ field, box (Document.from [ "$type", box bsonType ]) ]

    /// Matches documents where the field matches the regular expression.
    let regex (field: string) (pattern: string) : Document =
        Document.from [ field, box (Document.from [ "$regex", box pattern ]) ]

    /// Matches documents where the field matches the regular expression with options.
    let regexWithOptions (field: string) (pattern: string) (options: string) : Document =
        Document.from [ field, box (Document.from [ "$regex", box pattern; "$options", box options ]) ]

    /// Matches documents using a text search.
    let text (search: string) : Document =
        Document.from [ "$text", box (Document.from [ "$search", box search ]) ]

    /// Matches documents using a text search with options.
    let textWithOptions (search: string) (language: string option) (caseSensitive: bool) : Document =
        let opts = [
            "$search", box search
            "$caseSensitive", box caseSensitive
        ]
        let opts' =
            match language with
            | Some lang -> ("$language", box lang) :: opts
            | None -> opts
        Document.from [ "$text", box (Document.from opts') ]

    /// Matches documents where the field's modulo by divisor equals remainder.
    let mod' (field: string) (divisor: int64) (remainder: int64) : Document =
        Document.from [ field, box (Document.from [ "$mod", box [ divisor; remainder ] ]) ]

    /// Matches all of the given filters (AND).
    let and' (filters: Document seq) : Document =
        Document.from [ "$and", box (Seq.toList filters) ]

    /// Matches any of the given filters (OR).
    let or' (filters: Document seq) : Document =
        Document.from [ "$or", box (Seq.toList filters) ]

    /// Matches none of the given filters (NOR).
    let nor (filters: Document seq) : Document =
        Document.from [ "$nor", box (Seq.toList filters) ]

    /// Inverts the given filter (NOT).
    let not' (filter: Document) : Document =
        Document.from [ "$not", box filter ]

    /// Matches documents where the array field contains all the specified elements.
    let all (field: string) (values: 'T seq) : Document =
        Document.from [ field, box (Document.from [ "$all", box (Seq.toList values) ]) ]

    /// Matches documents where the array field contains at least one element matching the filter.
    let elemMatch (field: string) (filter: Document) : Document =
        Document.from [ field, box (Document.from [ "$elemMatch", box filter ]) ]

    /// Matches documents where the array field has the specified size.
    let size (field: string) (size: int) : Document =
        Document.from [ field, box (Document.from [ "$size", box size ]) ]

    /// Matches documents where the field's bits are all set.
    let bitsAllSet (field: string) (bitmask: int64) : Document =
        Document.from [ field, box (Document.from [ "$bitsAllSet", box bitmask ]) ]

    /// Matches documents where any of the field's bits are set.
    let bitsAnySet (field: string) (bitmask: int64) : Document =
        Document.from [ field, box (Document.from [ "$bitsAnySet", box bitmask ]) ]

    /// Matches documents where the field's bits are all clear.
    let bitsAllClear (field: string) (bitmask: int64) : Document =
        Document.from [ field, box (Document.from [ "$bitsAllClear", box bitmask ]) ]

    /// Matches documents where any of the field's bits are clear.
    let bitsAnyClear (field: string) (bitmask: int64) : Document =
        Document.from [ field, box (Document.from [ "$bitsAnyClear", box bitmask ]) ]

    /// Matches documents by _id.
    let byId (id: ObjectId) : Document =
        eq "_id" id

    /// Matches documents where the field is null or does not exist.
    let isNull (field: string) : Document =
        or' [
            eq field null
            exists field false
        ]

    /// Matches documents where the field is not null and exists.
    let isNotNull (field: string) : Document =
        and' [
            ne field null
            exists field true
        ]

    /// Matches documents within a geospatial box.
    let geoWithinBox (field: string) (bottomLeft: float * float) (topRight: float * float) : Document =
        let (x1, y1) = bottomLeft
        let (x2, y2) = topRight
        Document.from [
            field, box (Document.from [
                "$geoWithin", box (Document.from [
                    "$box", box [ [ x1; y1 ]; [ x2; y2 ] ]
                ])
            ])
        ]

    /// Matches documents within a geospatial sphere.
    let geoWithinSphere (field: string) (center: float * float) (radius: float) : Document =
        let (x, y) = center
        Document.from [
            field, box (Document.from [
                "$geoWithin", box (Document.from [
                    "$centerSphere", box [ [ x; y ]; radius ]
                ])
            ])
        ]

    /// Matches documents near a geospatial point.
    let near (field: string) (point: float * float) (maxDistance: float option) : Document =
        let (x, y) = point
        let geometry = Document.from [
            "type", box "Point"
            "coordinates", box [ x; y ]
        ]
        let nearDoc =
            match maxDistance with
            | Some dist ->
                Document.from [
                    "$geometry", box geometry
                    "$maxDistance", box dist
                ]
            | None ->
                Document.from [ "$geometry", box geometry ]
        Document.from [ field, box (Document.from [ "$near", box nearDoc ]) ]

/// Infix operators for filter composition.
[<AutoOpen>]
module FilterOperators =

    /// AND operator for combining filters.
    let (&&&) (a: Document) (b: Document) : Document =
        Filters.and' [ a; b ]

    /// OR operator for combining filters.
    let (|||) (a: Document) (b: Document) : Document =
        Filters.or' [ a; b ]

    /// NOT operator for inverting a filter.
    let (~~~) (filter: Document) : Document =
        Filters.not' filter
