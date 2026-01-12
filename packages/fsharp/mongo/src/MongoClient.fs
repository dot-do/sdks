namespace DotDo.Mongo

open System
open System.Text.RegularExpressions

/// MongoDB client settings parsed from a connection string.
type MongoClientSettings = {
    ConnectionString: string
    Hosts: string list
    Username: string option
    Password: string option
    DefaultDatabase: string option
    AuthSource: string option
    ReplicaSet: string option
    Ssl: bool
    ConnectTimeoutMs: int
    SocketTimeoutMs: int
    MaxPoolSize: int
    MinPoolSize: int
    RetryWrites: bool
    RetryReads: bool
}

module MongoClientSettings =
    let private uriPattern =
        Regex(@"^(mongodb(?:\+srv)?)://(?:([^:@]+)(?::([^@]*))?@)?([^/?]+)(?:/([^?]*))?(?:\?(.*))?$")

    let private parseOptions (options: string) : Map<string, string> =
        if String.IsNullOrEmpty(options) then
            Map.empty
        else
            options.Split('&')
            |> Array.choose (fun pair ->
                match pair.Split('=', 2) with
                | [| key; value |] -> Some (key, value)
                | _ -> None
            )
            |> Map.ofArray

    /// Creates settings from a connection string.
    let fromConnectionString (uri: string) : MongoClientSettings =
        let m = uriPattern.Match(uri)
        if m.Success then
            let protocol = m.Groups.[1].Value
            let username = if m.Groups.[2].Success then Some m.Groups.[2].Value else None
            let password = if m.Groups.[3].Success then Some m.Groups.[3].Value else None
            let hosts = m.Groups.[4].Value.Split(',') |> Array.toList
            let database = if m.Groups.[5].Success && not (String.IsNullOrEmpty(m.Groups.[5].Value)) then Some m.Groups.[5].Value else None
            let options = if m.Groups.[6].Success then parseOptions m.Groups.[6].Value else Map.empty

            {
                ConnectionString = uri
                Hosts = hosts
                Username = username
                Password = password
                DefaultDatabase = database
                AuthSource = Map.tryFind "authSource" options
                ReplicaSet = Map.tryFind "replicaSet" options
                Ssl = protocol = "mongodb+srv" || Map.tryFind "ssl" options = Some "true"
                ConnectTimeoutMs = Map.tryFind "connectTimeoutMS" options |> Option.bind (fun s -> try Some (int s) with _ -> None) |> Option.defaultValue 10000
                SocketTimeoutMs = Map.tryFind "socketTimeoutMS" options |> Option.bind (fun s -> try Some (int s) with _ -> None) |> Option.defaultValue 0
                MaxPoolSize = Map.tryFind "maxPoolSize" options |> Option.bind (fun s -> try Some (int s) with _ -> None) |> Option.defaultValue 100
                MinPoolSize = Map.tryFind "minPoolSize" options |> Option.bind (fun s -> try Some (int s) with _ -> None) |> Option.defaultValue 0
                RetryWrites = Map.tryFind "retryWrites" options |> Option.map ((=) "true") |> Option.defaultValue true
                RetryReads = Map.tryFind "retryReads" options |> Option.map ((=) "true") |> Option.defaultValue true
            }
        else
            {
                ConnectionString = uri
                Hosts = [ "localhost:27017" ]
                Username = None
                Password = None
                DefaultDatabase = None
                AuthSource = None
                ReplicaSet = None
                Ssl = false
                ConnectTimeoutMs = 10000
                SocketTimeoutMs = 0
                MaxPoolSize = 100
                MinPoolSize = 0
                RetryWrites = true
                RetryReads = true
            }

    /// Default settings for local development.
    let defaultSettings = fromConnectionString "mongodb://localhost:27017"

/// MongoDB client - the main entry point for database connections.
type MongoClient private (settings: MongoClientSettings) =
    let mutable transport: obj option = None
    let mutable connected = false
    let mutable closed = false
    let databases = System.Collections.Generic.Dictionary<string, MongoDatabase>()

    /// Creates a new client from a connection string.
    new(connectionString: string) =
        MongoClient(MongoClientSettings.fromConnectionString connectionString)

    /// Gets the client settings.
    member _.Settings = settings

    /// Checks if the client is connected.
    member _.IsConnected = connected && not closed

    /// Checks if the client is closed.
    member _.IsClosed = closed

    /// Connects to the MongoDB server.
    member this.Connect() : MongoResult<unit> =
        if closed then
            Error (MongoError.ConnectionError "Client is closed")
        elif connected then
            Ok ()
        else
            try
                // In a real implementation, this would create the RPC transport
                transport <- Some (box "mock_transport")
                connected <- true
                Ok ()
            with ex ->
                Error (MongoError.ConnectionError ex.Message)

    /// Connects asynchronously.
    member this.ConnectAsync() : AsyncMongoResult<unit> =
        async { return this.Connect() }

    /// Gets a database by name.
    member this.GetDatabase(name: string) : MongoDatabase =
        this.EnsureConnected()
        match databases.TryGetValue(name) with
        | true, db -> db
        | false, _ ->
            let db = MongoDatabase(transport.Value, name)
            databases.[name] <- db
            db

    /// Gets the default database (from connection string or "test").
    member this.GetDefaultDatabase() : MongoDatabase =
        let dbName = settings.DefaultDatabase |> Option.defaultValue "test"
        this.GetDatabase(dbName)

    /// Lists all database names.
    member this.ListDatabaseNames() : MongoResult<string list> =
        this.EnsureConnected()
        // Stub implementation
        Ok []

    /// Lists database names asynchronously.
    member this.ListDatabaseNamesAsync() : AsyncMongoResult<string list> =
        async { return this.ListDatabaseNames() }

    /// Lists all databases with full information.
    member this.ListDatabases() : MongoResult<Document list> =
        this.EnsureConnected()
        // Stub implementation
        Ok []

    /// Lists databases asynchronously.
    member this.ListDatabasesAsync() : AsyncMongoResult<Document list> =
        async { return this.ListDatabases() }

    /// Drops a database.
    member this.DropDatabase(name: string) : MongoResult<unit> =
        this.EnsureConnected()
        databases.Remove(name) |> ignore
        // Stub implementation
        Ok ()

    /// Drops a database asynchronously.
    member this.DropDatabaseAsync(name: string) : AsyncMongoResult<unit> =
        async { return this.DropDatabase(name) }

    /// Pings the server to check connectivity.
    member this.Ping() : MongoResult<bool> =
        this.EnsureConnected()
        // Stub implementation
        Ok true

    /// Pings asynchronously.
    member this.PingAsync() : AsyncMongoResult<bool> =
        async { return this.Ping() }

    /// Closes the client connection.
    member _.Close() : unit =
        if not closed then
            closed <- true
            connected <- false
            transport <- None
            databases.Clear()

    /// Closes asynchronously.
    member this.CloseAsync() : Async<unit> =
        async { return this.Close() }

    /// Ensures the client is connected.
    member private this.EnsureConnected() =
        if closed then
            failwith "Client is closed"
        if not connected then
            match this.Connect() with
            | Ok () -> ()
            | Error err -> failwith (MongoError.message err)

    /// Creates a new client from a connection string.
    static member Create(connectionString: string) : MongoClient =
        MongoClient(connectionString)

    /// Creates a new client from settings.
    static member Create(settings: MongoClientSettings) : MongoClient =
        MongoClient(settings)

    /// Creates and connects a client.
    static member Connect(connectionString: string) : MongoResult<MongoClient> =
        let client = MongoClient(connectionString)
        client.Connect() |> Result.map (fun () -> client)

    /// Creates and connects a client asynchronously.
    static member ConnectAsync(connectionString: string) : AsyncMongoResult<MongoClient> =
        async {
            let client = MongoClient(connectionString)
            let! result = client.ConnectAsync()
            return result |> Result.map (fun () -> client)
        }

    interface IDisposable with
        member this.Dispose() = this.Close()

/// Module for MongoClient operations.
module MongoClient =
    /// Creates a new client.
    let create connectionString = MongoClient.Create(connectionString)

    /// Creates and connects a client.
    let connect connectionString = MongoClient.Connect(connectionString)

    /// Creates and connects a client asynchronously.
    let connectAsync connectionString = MongoClient.ConnectAsync(connectionString)

    /// Gets a database.
    let getDatabase name (client: MongoClient) = client.GetDatabase(name)

    /// Gets the default database.
    let getDefaultDatabase (client: MongoClient) = client.GetDefaultDatabase()

    /// Lists database names.
    let listDatabaseNames (client: MongoClient) = client.ListDatabaseNames()

    /// Lists databases.
    let listDatabases (client: MongoClient) = client.ListDatabases()

    /// Drops a database.
    let dropDatabase name (client: MongoClient) = client.DropDatabase(name)

    /// Pings the server.
    let ping (client: MongoClient) = client.Ping()

    /// Closes the client.
    let close (client: MongoClient) = client.Close()

    /// Runs an operation with a connected client.
    let withClient (connectionString: string) (f: MongoClient -> 'T) : MongoResult<'T> =
        use client = new MongoClient(connectionString)
        match client.Connect() with
        | Ok () -> Ok (f client)
        | Error err -> Error err

    /// Runs an async operation with a connected client.
    let withClientAsync (connectionString: string) (f: MongoClient -> Async<'T>) : AsyncMongoResult<'T> =
        async {
            use client = new MongoClient(connectionString)
            match! client.ConnectAsync() with
            | Ok () ->
                let! result = f client
                return Ok result
            | Error err ->
                return Error err
        }
