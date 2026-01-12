## {{Name}}.do Nim SDK
##
## {{description}}
##
## Example:
## ```nim
## import {{name}}_do
##
## let client = new{{Name}}Client(apiKey = getEnv("DOTDO_KEY"))
## waitFor client.connect()
## ```

import std/[asyncdispatch, options, tables]
import rpc_do

export rpc_do

type
  {{Name}}ClientOptions* = object
    apiKey*: Option[string]
    baseUrl*: string

  {{Name}}Client* = ref object
    rpc: Option[RpcClient]
    options: {{Name}}ClientOptions

  {{Name}}Error* = object of CatchableError
    code*: Option[string]
    details*: Option[string]

proc new{{Name}}ClientOptions*(
  apiKey: Option[string] = none(string),
  baseUrl: string = "https://{{name}}.do"
): {{Name}}ClientOptions =
  {{Name}}ClientOptions(apiKey: apiKey, baseUrl: baseUrl)

proc new{{Name}}Client*(
  apiKey: string = "",
  baseUrl: string = "https://{{name}}.do"
): {{Name}}Client =
  let opts = {{Name}}ClientOptions(
    apiKey: if apiKey.len > 0: some(apiKey) else: none(string),
    baseUrl: baseUrl
  )
  {{Name}}Client(rpc: none(RpcClient), options: opts)

proc new{{Name}}Client*(options: {{Name}}ClientOptions): {{Name}}Client =
  {{Name}}Client(rpc: none(RpcClient), options: options)

proc baseUrl*(client: {{Name}}Client): string =
  client.options.baseUrl

proc connected*(client: {{Name}}Client): bool =
  client.rpc.isSome

proc connect*(client: {{Name}}Client): Future[RpcClient] {.async.} =
  if client.rpc.isSome:
    return client.rpc.get

  var headers = initTable[string, string]()
  if client.options.apiKey.isSome:
    headers["Authorization"] = "Bearer " & client.options.apiKey.get

  let rpcClient = await rpcConnect(client.options.baseUrl, headers)
  client.rpc = some(rpcClient)
  return rpcClient

proc disconnect*(client: {{Name}}Client) {.async.} =
  if client.rpc.isSome:
    await client.rpc.get.close()
    client.rpc = none(RpcClient)

proc new{{Name}}Error*(
  message: string,
  code: Option[string] = none(string),
  details: Option[string] = none(string)
): ref {{Name}}Error =
  result = new({{Name}}Error)
  result.msg = message
  result.code = code
  result.details = details
