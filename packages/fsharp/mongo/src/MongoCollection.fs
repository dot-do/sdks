namespace DotDo.Mongo

open System

// =============================================================================
// Result Types
// =============================================================================

/// Result of an insertOne operation.
type InsertOneResult = {
    Acknowledged: bool
    InsertedId: ObjectId option
}

/// Result of an insertMany operation.
type InsertManyResult = {
    Acknowledged: bool
    InsertedCount: int
    InsertedIds: Map<int, ObjectId>
}

/// Result of an update operation.
type UpdateResult = {
    Acknowledged: bool
    MatchedCount: int64
    ModifiedCount: int64
    UpsertedId: ObjectId option
}

/// Result of a delete operation.
type DeleteResult = {
    Acknowledged: bool
    DeletedCount: int64
}

/// Options for find operations.
type FindOptions = {
    Projection: Document option
    Sort: Document option
    Skip: int option
    Limit: int option
    Hint: string option
    AllowDiskUse: bool
}

module FindOptions =
    let empty = {
        Projection = None
        Sort = None
        Skip = None
        Limit = None
        Hint = None
        AllowDiskUse = false
    }

/// Options for update operations.
type UpdateOptions = {
    Upsert: bool
    ArrayFilters: Document list
    Hint: string option
}

module UpdateOptions =
    let empty = {
        Upsert = false
        ArrayFilters = []
        Hint = None
    }

/// Options for delete operations.
type DeleteOptions = {
    Hint: string option
}

module DeleteOptions =
    let empty = { Hint = None }

// =============================================================================
// Find Fluent Builder
// =============================================================================

/// Fluent builder for find operations.
type FindFluent<'T> = {
    Collection: MongoCollection<'T>
    Filter: Document
    Options: FindOptions
}

and MongoCollection<'T>(transport: obj, databaseName: string, name: string, codec: Document -> 'T option, encode: 'T -> Document) =

    /// The collection name.
    member _.Name = name

    /// The database name.
    member _.DatabaseName = databaseName

    // ============ Insert Operations ============

    /// Inserts a single document.
    member _.InsertOne(document: 'T) : MongoResult<InsertOneResult> =
        try
            let doc = encode document
            // In a real implementation, this would call the RPC transport
            Ok {
                Acknowledged = true
                InsertedId = doc.GetObjectId("_id")
            }
        with ex ->
            Error (MongoError.SerializationError ex.Message)

    /// Inserts a single document asynchronously.
    member this.InsertOneAsync(document: 'T) : AsyncMongoResult<InsertOneResult> =
        async { return this.InsertOne(document) }

    /// Inserts multiple documents.
    member _.InsertMany(documents: 'T list) : MongoResult<InsertManyResult> =
        try
            let docs = documents |> List.map encode
            let insertedIds =
                docs
                |> List.mapi (fun i doc -> i, doc.GetObjectId("_id"))
                |> List.choose (fun (i, idOpt) -> idOpt |> Option.map (fun id -> i, id))
                |> Map.ofList
            Ok {
                Acknowledged = true
                InsertedCount = List.length documents
                InsertedIds = insertedIds
            }
        with ex ->
            Error (MongoError.SerializationError ex.Message)

    /// Inserts multiple documents asynchronously.
    member this.InsertManyAsync(documents: 'T list) : AsyncMongoResult<InsertManyResult> =
        async { return this.InsertMany(documents) }

    // ============ Find Operations ============

    /// Finds all documents matching the filter.
    member _.Find(filter: Document) : MongoResult<'T list> =
        // In a real implementation, this would call the RPC transport
        // For now, return an empty list as a stub
        Ok []

    /// Finds all documents matching the filter asynchronously.
    member this.FindAsync(filter: Document) : AsyncMongoResult<'T list> =
        async { return this.Find(filter) }

    /// Creates a fluent find builder.
    member this.FindFluent(filter: Document) : FindFluent<'T> =
        {
            Collection = this
            Filter = filter
            Options = FindOptions.empty
        }

    /// Finds a single document matching the filter.
    member this.FindOne(filter: Document) : MongoResult<'T option> =
        this.Find(filter) |> Result.map List.tryHead

    /// Finds a single document matching the filter asynchronously.
    member this.FindOneAsync(filter: Document) : AsyncMongoResult<'T option> =
        async { return this.FindOne(filter) }

    /// Finds a document by _id.
    member this.FindById(id: ObjectId) : MongoResult<'T option> =
        this.FindOne(Filters.byId id)

    /// Finds a document by _id asynchronously.
    member this.FindByIdAsync(id: ObjectId) : AsyncMongoResult<'T option> =
        async { return this.FindById(id) }

    // ============ Update Operations ============

    /// Updates a single document matching the filter.
    member _.UpdateOne(filter: Document, update: Document, ?options: UpdateOptions) : MongoResult<UpdateResult> =
        let _opts = defaultArg options UpdateOptions.empty
        // Stub implementation
        Ok {
            Acknowledged = true
            MatchedCount = 0L
            ModifiedCount = 0L
            UpsertedId = None
        }

    /// Updates a single document asynchronously.
    member this.UpdateOneAsync(filter: Document, update: Document, ?options: UpdateOptions) : AsyncMongoResult<UpdateResult> =
        async { return this.UpdateOne(filter, update, ?options = options) }

    /// Updates multiple documents matching the filter.
    member _.UpdateMany(filter: Document, update: Document, ?options: UpdateOptions) : MongoResult<UpdateResult> =
        let _opts = defaultArg options UpdateOptions.empty
        // Stub implementation
        Ok {
            Acknowledged = true
            MatchedCount = 0L
            ModifiedCount = 0L
            UpsertedId = None
        }

    /// Updates multiple documents asynchronously.
    member this.UpdateManyAsync(filter: Document, update: Document, ?options: UpdateOptions) : AsyncMongoResult<UpdateResult> =
        async { return this.UpdateMany(filter, update, ?options = options) }

    /// Replaces a single document.
    member _.ReplaceOne(filter: Document, replacement: 'T, ?options: UpdateOptions) : MongoResult<UpdateResult> =
        let _opts = defaultArg options UpdateOptions.empty
        let _doc = encode replacement
        // Stub implementation
        Ok {
            Acknowledged = true
            MatchedCount = 0L
            ModifiedCount = 0L
            UpsertedId = None
        }

    /// Replaces a single document asynchronously.
    member this.ReplaceOneAsync(filter: Document, replacement: 'T, ?options: UpdateOptions) : AsyncMongoResult<UpdateResult> =
        async { return this.ReplaceOne(filter, replacement, ?options = options) }

    // ============ Delete Operations ============

    /// Deletes a single document matching the filter.
    member _.DeleteOne(filter: Document, ?options: DeleteOptions) : MongoResult<DeleteResult> =
        let _opts = defaultArg options DeleteOptions.empty
        // Stub implementation
        Ok {
            Acknowledged = true
            DeletedCount = 0L
        }

    /// Deletes a single document asynchronously.
    member this.DeleteOneAsync(filter: Document, ?options: DeleteOptions) : AsyncMongoResult<DeleteResult> =
        async { return this.DeleteOne(filter, ?options = options) }

    /// Deletes multiple documents matching the filter.
    member _.DeleteMany(filter: Document, ?options: DeleteOptions) : MongoResult<DeleteResult> =
        let _opts = defaultArg options DeleteOptions.empty
        // Stub implementation
        Ok {
            Acknowledged = true
            DeletedCount = 0L
        }

    /// Deletes multiple documents asynchronously.
    member this.DeleteManyAsync(filter: Document, ?options: DeleteOptions) : AsyncMongoResult<DeleteResult> =
        async { return this.DeleteMany(filter, ?options = options) }

    // ============ Count Operations ============

    /// Counts documents matching the filter.
    member _.CountDocuments(filter: Document) : MongoResult<int64> =
        // Stub implementation
        Ok 0L

    /// Counts documents asynchronously.
    member this.CountDocumentsAsync(filter: Document) : AsyncMongoResult<int64> =
        async { return this.CountDocuments(filter) }

    /// Estimates the total number of documents in the collection.
    member _.EstimatedDocumentCount() : MongoResult<int64> =
        // Stub implementation
        Ok 0L

    /// Estimates the total count asynchronously.
    member this.EstimatedDocumentCountAsync() : AsyncMongoResult<int64> =
        async { return this.EstimatedDocumentCount() }

    // ============ Aggregation ============

    /// Performs an aggregation pipeline.
    member _.Aggregate(pipeline: Document list) : MongoResult<Document list> =
        // Stub implementation
        Ok []

    /// Performs an aggregation asynchronously.
    member this.AggregateAsync(pipeline: Document list) : AsyncMongoResult<Document list> =
        async { return this.Aggregate(pipeline) }

    // ============ Index Operations ============

    /// Creates an index.
    member _.CreateIndex(keys: Document, ?name: string) : MongoResult<string> =
        // Stub implementation
        Ok (defaultArg name "index_1")

    /// Creates an index asynchronously.
    member this.CreateIndexAsync(keys: Document, ?name: string) : AsyncMongoResult<string> =
        async { return this.CreateIndex(keys, ?name = name) }

    /// Lists all indexes.
    member _.ListIndexes() : MongoResult<Document list> =
        // Stub implementation
        Ok []

    /// Lists indexes asynchronously.
    member this.ListIndexesAsync() : AsyncMongoResult<Document list> =
        async { return this.ListIndexes() }

    /// Drops an index by name.
    member _.DropIndex(name: string) : MongoResult<unit> =
        // Stub implementation
        ignore name
        Ok ()

    /// Drops an index asynchronously.
    member this.DropIndexAsync(name: string) : AsyncMongoResult<unit> =
        async { return this.DropIndex(name) }

    // ============ Distinct ============

    /// Gets distinct values for a field.
    member _.Distinct(field: string, filter: Document) : MongoResult<BsonValue list> =
        // Stub implementation
        ignore (field, filter)
        Ok []

    /// Gets distinct values asynchronously.
    member this.DistinctAsync(field: string, filter: Document) : AsyncMongoResult<BsonValue list> =
        async { return this.Distinct(field, filter) }

// =============================================================================
// FindFluent Extensions
// =============================================================================

module FindFluent =
    /// Adds a projection to the find operation.
    let project (projection: Document) (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with Projection = Some projection } }

    /// Adds a sort to the find operation.
    let sort (sort: Document) (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with Sort = Some sort } }

    /// Skips a number of documents.
    let skip (n: int) (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with Skip = Some n } }

    /// Limits the number of results.
    let limit (n: int) (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with Limit = Some n } }

    /// Sets a hint for the query.
    let hint (indexName: string) (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with Hint = Some indexName } }

    /// Allows the query to use disk.
    let allowDiskUse (fluent: FindFluent<'T>) : FindFluent<'T> =
        { fluent with Options = { fluent.Options with AllowDiskUse = true } }

    /// Executes the find and returns the results.
    let toList (fluent: FindFluent<'T>) : MongoResult<'T list> =
        fluent.Collection.Find(fluent.Filter)

    /// Executes the find and returns the results asynchronously.
    let toListAsync (fluent: FindFluent<'T>) : AsyncMongoResult<'T list> =
        fluent.Collection.FindAsync(fluent.Filter)

    /// Executes the find and returns the first result.
    let first (fluent: FindFluent<'T>) : MongoResult<'T option> =
        toList fluent |> Result.map List.tryHead

    /// Executes the find and returns the first result asynchronously.
    let firstAsync (fluent: FindFluent<'T>) : AsyncMongoResult<'T option> =
        async {
            let! result = toListAsync fluent
            return result |> Result.map List.tryHead
        }
