## DotDo RPC Client for Nim
## Type-safe RPC with remap (server-side map) support
##
## Example usage:
## ```nim
## import dotdorpc
##
## # Create client and connect
## let client = newRpcClient("ws://api.do.example.com")
## await client.connect()
##
## # Simple RPC call
## let result = await client.call("square", %*[5])
##
## # Call with remap (server-side transformation)
## let squared = await client.call("generateNumbers", %*[6], remap = proc(x: JsonNode): JsonNode =
##   client.call("square", %*[x.getInt])
## )
##
## # Clean disconnect
## await client.disconnect()
## ```

import std/[asyncdispatch, json, tables, options, strutils, sequtils, locks, times, random]
import ws

const Version* = "0.1.0"

# ---------------------------------------------------------
# Error Types
# ---------------------------------------------------------

type
  RpcError* = object of CatchableError
    ## Base error type for RPC operations
    code*: string
    details*: Option[JsonNode]

  ConnectionError* = object of RpcError
    ## Connection-related errors

  TimeoutError* = object of RpcError
    ## Request timeout

  ProtocolError* = object of RpcError
    ## Protocol violation

proc newRpcError*(code, message: string, details: Option[JsonNode] = none(JsonNode)): ref RpcError =
  result = newException(RpcError, message)
  result.code = code
  result.details = details

proc newConnectionError*(message: string): ref ConnectionError =
  result = newException(ConnectionError, message)
  result.code = "CONNECTION_ERROR"

proc newTimeoutError*(message: string): ref TimeoutError =
  result = newException(TimeoutError, message)
  result.code = "TIMEOUT"

proc newProtocolError*(message: string): ref ProtocolError =
  result = newException(ProtocolError, message)
  result.code = "PROTOCOL_ERROR"

# ---------------------------------------------------------
# Remap Configuration
# ---------------------------------------------------------

type
  RemapConfig* = object
    ## Configuration for server-side remap (map) operation
    expression*: string
    captures*: seq[string]

proc remap*(expression: string, captures: seq[string] = @[]): RemapConfig =
  ## Create a remap configuration
  ##
  ## Example:
  ## ```nim
  ## let cfg = remap("x => self.square(x)", @["$self"])
  ## ```
  RemapConfig(expression: expression, captures: captures)

# ---------------------------------------------------------
# RPC Client
# ---------------------------------------------------------

type
  RpcClientState* = enum
    rcsDisconnected
    rcsConnecting
    rcsConnected
    rcsDisconnecting

  PendingCall = object
    future: Future[JsonNode]
    timestamp: Time
    methodName: string

  RpcClient* = ref object
    url*: string
    ws: WebSocket
    state*: RpcClientState
    pending: Table[int64, PendingCall]
    nextId: int64
    lock: Lock
    timeout*: Duration
    headers*: Table[string, string]
    onConnect*: proc() {.closure.}
    onDisconnect*: proc(reason: string) {.closure.}
    onError*: proc(err: ref RpcError) {.closure.}

proc newRpcClient*(url: string, timeout = initDuration(seconds = 30)): RpcClient =
  ## Create a new RPC client
  result = RpcClient(
    url: url,
    state: rcsDisconnected,
    pending: initTable[int64, PendingCall](),
    nextId: 0,
    timeout: timeout,
    headers: initTable[string, string]()
  )
  initLock(result.lock)

proc setHeader*(client: RpcClient, key, value: string) =
  ## Set a custom header for WebSocket connection
  client.headers[key] = value

proc getNextId(client: RpcClient): int64 =
  withLock client.lock:
    inc client.nextId
    result = client.nextId

# ---------------------------------------------------------
# Message Handler
# ---------------------------------------------------------

proc handleMessage(client: RpcClient, msg: string) =
  try:
    let json = parseJson(msg)

    if json.hasKey("id"):
      let id = json["id"].getBiggestInt

      withLock client.lock:
        if client.pending.hasKey(id):
          let pending = client.pending[id]
          client.pending.del(id)

          if json.hasKey("error"):
            let error = json["error"]
            let code = error.getOrDefault("code").getStr("UNKNOWN")
            let message = error.getOrDefault("message").getStr("Unknown error")
            let details = if error.hasKey("details"): some(error["details"]) else: none(JsonNode)
            pending.future.fail(newRpcError(code, message, details))
          else:
            pending.future.complete(json.getOrDefault("result"))
  except JsonParsingError as e:
    if client.onError != nil:
      client.onError(newProtocolError("Invalid JSON: " & e.msg))

proc startMessageLoop(client: RpcClient) {.async.} =
  while client.state == rcsConnected:
    try:
      let msg = await client.ws.receiveStrPacket()
      client.handleMessage(msg)
    except WebSocketClosedError:
      client.state = rcsDisconnected
      if client.onDisconnect != nil:
        client.onDisconnect("Connection closed")
      break
    except WebSocketError as e:
      if client.onError != nil:
        client.onError(newConnectionError(e.msg))

# ---------------------------------------------------------
# Connection Management
# ---------------------------------------------------------

proc connect*(client: RpcClient) {.async.} =
  ## Connect to the RPC server
  if client.state != rcsDisconnected:
    return

  client.state = rcsConnecting

  try:
    client.ws = await newWebSocket(client.url)
    client.state = rcsConnected

    if client.onConnect != nil:
      client.onConnect()

    asyncCheck client.startMessageLoop()
  except:
    client.state = rcsDisconnected
    raise newConnectionError("Failed to connect: " & getCurrentExceptionMsg())

proc disconnect*(client: RpcClient) {.async.} =
  ## Disconnect from the RPC server
  if client.state != rcsConnected:
    return

  client.state = rcsDisconnecting

  # Cancel all pending calls
  withLock client.lock:
    for id, pending in client.pending.pairs:
      pending.future.fail(newConnectionError("Client disconnected"))
    client.pending.clear()

  if client.ws != nil:
    client.ws.close()

  client.state = rcsDisconnected

proc isConnected*(client: RpcClient): bool =
  client.state == rcsConnected

# ---------------------------------------------------------
# RPC Calls
# ---------------------------------------------------------

proc call*(client: RpcClient, methodName: string, args: JsonNode,
           remapCfg: Option[RemapConfig] = none(RemapConfig)): Future[JsonNode] {.async.} =
  ## Call a remote method
  ##
  ## Example:
  ## ```nim
  ## let result = await client.call("square", %*[5])
  ## ```
  if client.state != rcsConnected:
    raise newConnectionError("Not connected")

  let callId = client.getNextId()
  let future = newFuture[JsonNode]("rpc.call." & methodName)

  withLock client.lock:
    client.pending[callId] = PendingCall(
      future: future,
      timestamp: getTime(),
      methodName: methodName
    )

  var message = %*{
    "jsonrpc": "2.0",
    "id": callId,
    "method": methodName,
    "params": args
  }

  if remapCfg.isSome:
    let cfg = remapCfg.get
    message["remap"] = %*{
      "expression": cfg.expression,
      "captures": cfg.captures
    }

  await client.ws.send($message)

  return await future

proc call*(client: RpcClient, methodName: string, args: varargs[JsonNode]): Future[JsonNode] =
  ## Call with varargs
  var argsArray = newJArray()
  for arg in args:
    argsArray.add(arg)
  client.call(methodName, argsArray, none(RemapConfig))

# ---------------------------------------------------------
# Remap - Server-side transformation
# ---------------------------------------------------------

proc remap*[T](client: RpcClient, methodName: string, args: JsonNode,
               transform: proc(x: T): T): Future[seq[T]] {.async.} =
  ## Call with remap transformation using Nim proc syntax
  ##
  ## Example:
  ## ```nim
  ## let squared = await client.remap("generateNumbers", %*[6], proc(x: int): int =
  ##   x * x
  ## )
  ## ```
  let remapCfg = some(RemapConfig(
    expression: "x => transform(x)",
    captures: @[]
  ))

  let result = await client.call(methodName, args, remapCfg)

  var output: seq[T] = @[]
  if result.kind == JArray:
    for item in result:
      when T is int:
        output.add(item.getInt)
      elif T is int64:
        output.add(item.getBiggestInt)
      elif T is float:
        output.add(item.getFloat)
      elif T is string:
        output.add(item.getStr)
      elif T is bool:
        output.add(item.getBool)
      else:
        output.add(item)

  return output

proc callWithRemap*(client: RpcClient, methodName: string, args: JsonNode,
                    remapExpr: string, captures: seq[string] = @[]): Future[JsonNode] {.async.} =
  ## Call with explicit remap expression
  ##
  ## Example:
  ## ```nim
  ## let result = await client.callWithRemap(
  ##   "generateFibonacci",
  ##   %*[6],
  ##   "x => self.square(x)",
  ##   @["$self"]
  ## )
  ## ```
  let remapCfg = some(remap(remapExpr, captures))
  return await client.call(methodName, args, remapCfg)

# ---------------------------------------------------------
# Template for cleaner remap syntax
# ---------------------------------------------------------

template withRemap*(client: RpcClient, methodName: string, args: JsonNode,
                    body: untyped): untyped =
  ## Template for cleaner remap syntax
  ##
  ## Example:
  ## ```nim
  ## let squared = await client.withRemap("generateFibonacci", %*[6]):
  ##   client.call("square", %*[it.getInt])
  ## ```
  block:
    proc remapFn(it {.inject.}: JsonNode): Future[JsonNode] {.async.} =
      body

    let remapCfg = some(remap("x => transform(x)"))
    await client.call(methodName, args, remapCfg)

# ---------------------------------------------------------
# Batch Calls
# ---------------------------------------------------------

type
  BatchCall* = object
    methodName: string
    args: JsonNode
    remapCfg: Option[RemapConfig]

proc batch*(methodName: string, args: JsonNode,
            remapCfg: Option[RemapConfig] = none(RemapConfig)): BatchCall =
  BatchCall(methodName: methodName, args: args, remapCfg: remapCfg)

proc callBatch*(client: RpcClient, calls: seq[BatchCall]): Future[seq[JsonNode]] {.async.} =
  ## Execute multiple calls in a batch
  var futures: seq[Future[JsonNode]] = @[]

  for call in calls:
    futures.add(client.call(call.methodName, call.args, call.remapCfg))

  var results: seq[JsonNode] = @[]
  for fut in futures:
    results.add(await fut)

  return results

# ---------------------------------------------------------
# Notification (no response expected)
# ---------------------------------------------------------

proc notify*(client: RpcClient, methodName: string, args: JsonNode) {.async.} =
  ## Send a notification (no response expected)
  if client.state != rcsConnected:
    raise newConnectionError("Not connected")

  let message = %*{
    "jsonrpc": "2.0",
    "method": methodName,
    "params": args
  }

  await client.ws.send($message)

# ---------------------------------------------------------
# Typed Client Builder
# ---------------------------------------------------------

type
  TypedClient*[T] = ref object
    client*: RpcClient
    stub*: T

proc newTypedClient*[T](url: string): TypedClient[T] =
  ## Create a typed client wrapper
  TypedClient[T](
    client: newRpcClient(url)
  )

proc connect*[T](tc: TypedClient[T]) {.async.} =
  await tc.client.connect()

proc disconnect*[T](tc: TypedClient[T]) {.async.} =
  await tc.client.disconnect()

# ---------------------------------------------------------
# Exports
# ---------------------------------------------------------

export asyncdispatch, json, options, tables
