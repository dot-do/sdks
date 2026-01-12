namespace DotDo.Mongo

open System

/// A MongoDB database.
type MongoDatabase internal (transport: obj, name: string) =

    /// The database name.
    member _.Name = name

    /// Gets a collection with Document type.
    member this.GetCollection(collectionName: string) : MongoCollection<Document> =
        MongoCollection<Document>(
            transport,
            name,
            collectionName,
            Some,  // codec: Document -> Document option
            id     // encode: Document -> Document
        )

    /// Gets a typed collection.
    member this.GetCollection<'T>(collectionName: string, codec: Document -> 'T option, encode: 'T -> Document) : MongoCollection<'T> =
        MongoCollection<'T>(
            transport,
            name,
            collectionName,
            codec,
            encode
        )

    /// Lists all collection names in the database.
    member _.ListCollectionNames() : MongoResult<string list> =
        // Stub implementation
        Ok []

    /// Lists collection names asynchronously.
    member this.ListCollectionNamesAsync() : AsyncMongoResult<string list> =
        async { return this.ListCollectionNames() }

    /// Lists all collections with full information.
    member _.ListCollections() : MongoResult<Document list> =
        // Stub implementation
        Ok []

    /// Lists collections asynchronously.
    member this.ListCollectionsAsync() : AsyncMongoResult<Document list> =
        async { return this.ListCollections() }

    /// Creates a collection.
    member _.CreateCollection(collectionName: string, ?options: Document) : MongoResult<unit> =
        ignore (collectionName, options)
        // Stub implementation
        Ok ()

    /// Creates a collection asynchronously.
    member this.CreateCollectionAsync(collectionName: string, ?options: Document) : AsyncMongoResult<unit> =
        async { return this.CreateCollection(collectionName, ?options = options) }

    /// Drops a collection.
    member _.DropCollection(collectionName: string) : MongoResult<unit> =
        ignore collectionName
        // Stub implementation
        Ok ()

    /// Drops a collection asynchronously.
    member this.DropCollectionAsync(collectionName: string) : AsyncMongoResult<unit> =
        async { return this.DropCollection(collectionName) }

    /// Renames a collection.
    member _.RenameCollection(oldName: string, newName: string, ?dropTarget: bool) : MongoResult<unit> =
        ignore (oldName, newName, dropTarget)
        // Stub implementation
        Ok ()

    /// Renames a collection asynchronously.
    member this.RenameCollectionAsync(oldName: string, newName: string, ?dropTarget: bool) : AsyncMongoResult<unit> =
        async { return this.RenameCollection(oldName, newName, ?dropTarget = dropTarget) }

    /// Runs a database command.
    member _.RunCommand(command: Document) : MongoResult<Document> =
        ignore command
        // Stub implementation
        Ok Document.empty

    /// Runs a database command asynchronously.
    member this.RunCommandAsync(command: Document) : AsyncMongoResult<Document> =
        async { return this.RunCommand(command) }

    /// Gets database statistics.
    member this.Stats() : MongoResult<Document> =
        this.RunCommand(Document.from [ "dbStats", box 1 ])

    /// Gets database statistics asynchronously.
    member this.StatsAsync() : AsyncMongoResult<Document> =
        async { return this.Stats() }

/// Module for MongoDatabase operations.
module MongoDatabase =
    /// Gets a collection.
    let getCollection name (db: MongoDatabase) = db.GetCollection(name)

    /// Gets a typed collection.
    let getTypedCollection name codec encode (db: MongoDatabase) =
        db.GetCollection(name, codec, encode)

    /// Lists collection names.
    let listCollectionNames (db: MongoDatabase) = db.ListCollectionNames()

    /// Lists collections.
    let listCollections (db: MongoDatabase) = db.ListCollections()

    /// Creates a collection.
    let createCollection name (db: MongoDatabase) = db.CreateCollection(name)

    /// Drops a collection.
    let dropCollection name (db: MongoDatabase) = db.DropCollection(name)

    /// Runs a command.
    let runCommand cmd (db: MongoDatabase) = db.RunCommand(cmd)
