# {{Name}}.Do.FSharp

[![NuGet](https://img.shields.io/nuget/v/{{Name}}.Do.FSharp.svg)](https://www.nuget.org/packages/{{Name}}.Do.FSharp)

{{Name}}.do SDK for F# - {{description}}

## Installation

```bash
dotnet add package {{Name}}.Do.FSharp
```

## Quick Start

```fsharp
open {{Name}}.Do

// Create client with API key
let options =
    {{Name}}ClientOptions.defaults
    |> {{Name}}ClientOptions.withApiKey (Environment.GetEnvironmentVariable("DOTDO_KEY"))

async {
    // Connect (client is IAsyncDisposable)
    use! client = {{Name}}Client.connectAsync options

    // Make RPC calls through the client
    let rpc = client.GetRpc()
    // ...
}
|> Async.RunSynchronously
```

## Configuration

```fsharp
let options =
    {{Name}}ClientOptions.defaults
    |> {{Name}}ClientOptions.withApiKey "your-api-key"
    |> {{Name}}ClientOptions.withBaseUrl "https://{{name}}.do"
    |> {{Name}}ClientOptions.withTimeout (TimeSpan.FromSeconds(30.0))

let client = {{Name}}Client.create options
```

## Error Handling

Using discriminated union pattern matching:

```fsharp
let handleError = function
    | NotConnected ->
        printfn "Client not connected"
    | AuthenticationFailed reason ->
        printfn "Auth failed: %s" reason
    | NotFound (entity, id) ->
        printfn "%s not found: %s" entity id
    | ConnectionFailed reason ->
        printfn "Connection failed: %s" reason
    | RpcError (code, message) ->
        printfn "RPC error [%A]: %s" code message
```

With Result type:

```fsharp
let tryConnect options = async {
    try
        let! client = {{Name}}Client.connectAsync options
        return Ok client
    with
    | {{Name}}Exception error ->
        return Error error
}
```

## Functional Style

```fsharp
// Create options with pipeline
let client =
    {{Name}}ClientOptions.defaults
    |> {{Name}}ClientOptions.withApiKey apiKey
    |> {{Name}}ClientOptions.withBaseUrl baseUrl
    |> {{Name}}Client.create

// Or use convenience function
let client = {{Name}}Client.createWithApiKey apiKey
```

## License

MIT
