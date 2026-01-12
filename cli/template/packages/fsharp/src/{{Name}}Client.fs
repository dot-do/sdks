namespace {{Name}}.Do

open System
open System.Threading
open System.Threading.Tasks

/// Configuration options for {{Name}}Client
type {{Name}}ClientOptions = {
    /// API key for authentication
    ApiKey: string option
    /// Base URL for the service (defaults to https://{{name}}.do)
    BaseUrl: string
    /// Connection timeout
    Timeout: TimeSpan
}

module {{Name}}ClientOptions =
    /// Default options
    let defaults = {
        ApiKey = None
        BaseUrl = "https://{{name}}.do"
        Timeout = TimeSpan.FromSeconds(30.0)
    }

    /// Create options with API key
    let withApiKey apiKey options =
        { options with ApiKey = Some apiKey }

    /// Create options with custom base URL
    let withBaseUrl baseUrl options =
        { options with BaseUrl = baseUrl }

    /// Create options with custom timeout
    let withTimeout timeout options =
        { options with Timeout = timeout }

/// {{Name}}.do client for interacting with the {{name}} service
///
/// Example:
/// ```fsharp
/// async {
///     use! client = {{Name}}Client.connectAsync options
///     let! result = client.callAsync "greet" [| "World" |]
///     printfn "Result: %A" result
/// }
/// ```
type {{Name}}Client private (options: {{Name}}ClientOptions) =
    let mutable rpcClient: Rpc.Do.RpcClient option = None
    let mutable disposed = false

    /// Check if the client is connected
    member _.IsConnected = rpcClient.IsSome

    /// Connect to the {{name}}.do service
    member _.ConnectAsync(?cancellationToken: CancellationToken) = async {
        let ct = defaultArg cancellationToken CancellationToken.None

        match rpcClient with
        | Some client -> return client
        | None ->
            let headers =
                options.ApiKey
                |> Option.map (fun key -> dict [ "Authorization", sprintf "Bearer %s" key ])
                |> Option.defaultValue (dict [])

            let! client =
                Rpc.Do.RpcClient.ConnectAsync(options.BaseUrl, headers, ct)
                |> Async.AwaitTask

            rpcClient <- Some client
            return client
    }

    /// Disconnect from the service
    member _.DisconnectAsync() = async {
        match rpcClient with
        | Some client ->
            do! client.CloseAsync() |> Async.AwaitTask
            rpcClient <- None
        | None -> ()
    }

    /// Get the underlying RPC client (must be connected first)
    member _.GetRpc() =
        match rpcClient with
        | Some client -> client
        | None -> {{Name}}Exception.raise NotConnected

    interface IAsyncDisposable with
        member this.DisposeAsync() =
            if not disposed then
                disposed <- true
                this.DisconnectAsync()
                |> Async.StartAsTask
                |> fun t -> ValueTask(t :> Task)
            else
                ValueTask.CompletedTask

module {{Name}}Client =
    /// Create a new client with options
    let create options = new {{Name}}Client(options)

    /// Create a new client with default options
    let createDefault () = create {{Name}}ClientOptions.defaults

    /// Create a new client with API key
    let createWithApiKey apiKey =
        {{Name}}ClientOptions.defaults
        |> {{Name}}ClientOptions.withApiKey apiKey
        |> create

    /// Connect and return a client
    let connectAsync options = async {
        let client = create options
        let! _ = client.ConnectAsync()
        return client
    }
