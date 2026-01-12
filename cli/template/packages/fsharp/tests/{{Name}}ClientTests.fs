module {{Name}}.Do.Tests

open System
open Xunit
open {{Name}}.Do

[<Fact>]
let ``creates with default options`` () =
    let client = {{Name}}Client.createDefault()
    Assert.False(client.IsConnected)

[<Fact>]
let ``creates with API key`` () =
    let client = {{Name}}Client.createWithApiKey "test-key"
    Assert.False(client.IsConnected)

[<Fact>]
let ``creates with custom options`` () =
    let options =
        {{Name}}ClientOptions.defaults
        |> {{Name}}ClientOptions.withApiKey "test-key"
        |> {{Name}}ClientOptions.withBaseUrl "https://test.{{name}}.do"

    let client = {{Name}}Client.create options
    Assert.False(client.IsConnected)

[<Fact>]
let ``throws when accessing RPC before connect`` () =
    let client = {{Name}}Client.createDefault()
    Assert.Throws<{{Name}}Exception>(fun () -> client.GetRpc() |> ignore)

[<Fact>]
let ``error message formats correctly`` () =
    let msg = {{Name}}Error.message NotConnected
    Assert.Contains("not connected", msg)

[<Fact>]
let ``error message includes code when present`` () =
    let msg = {{Name}}Error.message (RpcError (Some "ERR001", "Test error"))
    Assert.Contains("ERR001", msg)
    Assert.Contains("Test error", msg)
