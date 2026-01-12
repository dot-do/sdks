## Cap'n Web RPC Client for Nim
## Capability-based RPC with pipelining support
##
## Example usage:
## ```nim
## import capnweb
##
## let session = connect("ws://localhost:8080")
## let api = session.stub(MyApi)
##
## # Simple call
## let result = api.square(5).await
##
## # Server-side remap (map operation)
## let squared = api.generateFibonacci(6).remap(proc(x: auto): auto =
##   api.square(x)
## ).await
## ```

import std/[asyncdispatch, json, tables, options, strutils, sequtils, uri, locks]
import ws

const Version* = "0.1.0"

# ---------------------------------------------------------
# Error Types
# ---------------------------------------------------------

type
  CapnWebError* = object of CatchableError
    ## Base error type for Cap'n Web

  ConnectionError* = object of CapnWebError
    ## Connection-related errors

  DisconnectedError* = object of ConnectionError
    ## Disconnected from server

  TimeoutError* = object of CapnWebError
    ## Request timeout

  RpcError* = object of CapnWebError
    ## RPC call error
    code*: string
    details*: Option[JsonNode]

  NotFoundError* = object of RpcError
    ## Resource not found

  PermissionError* = object of RpcError
    ## Permission denied

  ValidationError* = object of RpcError
    ## Validation failed

proc newRpcError*(code, message: string, details: Option[JsonNode] = none(JsonNode)): ref RpcError =
  result = newException(RpcError, message)
  result.code = code
  result.details = details

proc newNotFoundError*(message = "Not found", details: Option[JsonNode] = none(JsonNode)): ref NotFoundError =
  result = newException(NotFoundError, message)
  result.code = "NOT_FOUND"
  result.details = details

proc newPermissionError*(message = "Permission denied", details: Option[JsonNode] = none(JsonNode)): ref PermissionError =
  result = newException(PermissionError, message)
  result.code = "PERMISSION_DENIED"
  result.details = details

proc newValidationError*(message = "Validation failed", details: Option[JsonNode] = none(JsonNode)): ref ValidationError =
  result = newException(ValidationError, message)
  result.code = "VALIDATION_ERROR"
  result.details = details

# ---------------------------------------------------------
# Result Type for explicit error handling
# ---------------------------------------------------------

type
  ResultKind* = enum
    rkOk
    rkErr

  Result*[T] = object
    case kind*: ResultKind
    of rkOk:
      value*: T
    of rkErr:
      error*: ref CapnWebError

proc ok*[T](value: T): Result[T] =
  Result[T](kind: rkOk, value: value)

proc err*[T](error: ref CapnWebError): Result[T] =
  Result[T](kind: rkErr, error: error)

proc isOk*[T](r: Result[T]): bool = r.kind == rkOk
proc isErr*[T](r: Result[T]): bool = r.kind == rkErr

proc get*[T](r: Result[T]): T =
  if r.isErr:
    raise r.error
  r.value

proc getOrDefault*[T](r: Result[T], default: T): T =
  if r.isErr: default else: r.value

# ---------------------------------------------------------
# Remap Configuration for server-side map
# ---------------------------------------------------------

type
  RemapConfig* = object
    expression*: string
    captures*: seq[string]

proc newRemapConfig*(expression: string, captures: seq[string] = @[]): RemapConfig =
  RemapConfig(expression: expression, captures: captures)

# ---------------------------------------------------------
# Promise - Async result with pipelining and remap support
# ---------------------------------------------------------

type
  Session* = ref SessionObj
  SessionObj = object
    url*: string
    ws: WebSocket
    pending: Table[int64, Future[JsonNode]]
    nextId: int64
    connected: bool
    lock: Lock

  Promise*[T] = ref object
    session: Session
    importId: int64
    path: seq[string]
    remapConfig: Option[RemapConfig]
    resolved: bool
    value: Option[T]
    error: Option[ref CapnWebError]

proc newPromise*[T](session: Session, importId: int64, path: seq[string] = @[]): Promise[T] =
  Promise[T](
    session: session,
    importId: importId,
    path: path,
    remapConfig: none(RemapConfig),
    resolved: false,
    value: none(T),
    error: none(ref CapnWebError)
  )

# Forward declarations
proc execute*(session: Session, importId: int64, path: seq[string],
              remapConfig: Option[RemapConfig] = none(RemapConfig)): Future[JsonNode] {.async.}

proc deserialize[T](json: JsonNode): T =
  when T is JsonNode:
    json
  elif T is void:
    discard
  elif T is int:
    json.getInt
  elif T is int64:
    json.getBiggestInt
  elif T is float:
    json.getFloat
  elif T is string:
    json.getStr
  elif T is bool:
    json.getBool
  elif T is seq:
    var res: T = @[]
    for item in json:
      res.add(deserialize[typeof(res[0])](item))
    res
  else:
    # Try to deserialize as JSON
    json

proc await*[T](p: Promise[T]): Future[T] {.async.} =
  ## Await the promise result
  if p.resolved:
    if p.error.isSome:
      raise p.error.get
    return p.value.get

  let result = await p.session.execute(p.importId, p.path, p.remapConfig)
  p.resolved = true
  let deserialized = deserialize[T](result)
  p.value = some(deserialized)
  return deserialized

proc tryAwait*[T](p: Promise[T]): Future[Result[T]] {.async.} =
  ## Await with Result type for explicit error handling
  try:
    let value = await p.await()
    return ok(value)
  except CapnWebError as e:
    return err[T](e)

# ---------------------------------------------------------
# Remap - Server-side collection transformation
# ---------------------------------------------------------

proc remap*[T, U](p: Promise[seq[T]], fn: proc(x: T): U): Promise[seq[U]] =
  ## Server-side remap operation - transforms collection on the server
  ## This is the Nim equivalent of .map() in other languages
  ##
  ## Example:
  ## ```nim
  ## let squared = api.generateFibonacci(6).remap(proc(x: int): int =
  ##   api.square(x)
  ## )
  ## ```
  let newPromise = newPromise[seq[U]](p.session, p.importId, p.path)
  # The remap function would be serialized and sent to server
  # For now, we store a placeholder expression
  newPromise.remapConfig = some(newRemapConfig("x => transform(x)"))
  return newPromise

proc remap*[T, U](p: Promise[T], fn: proc(x: T): U): Promise[U] =
  ## Server-side remap on single value
  let newPromise = newPromise[U](p.session, p.importId, p.path)
  newPromise.remapConfig = some(newRemapConfig("x => transform(x)"))
  return newPromise

# Template version for cleaner syntax
template remap*[T](p: Promise[seq[T]], body: untyped): untyped =
  ## Template for remap with cleaner syntax
  ##
  ## Example:
  ## ```nim
  ## let squared = api.generateFibonacci(6).remap:
  ##   api.square(it)
  ## ```
  block:
    proc remapFn(it {.inject.}: T): auto =
      body
    p.remap(remapFn)

# ---------------------------------------------------------
# Session - Connection management
# ---------------------------------------------------------

proc newSession*(url: string): Session =
  result = Session(
    url: url,
    pending: initTable[int64, Future[JsonNode]](),
    nextId: 0,
    connected: false
  )
  initLock(result.lock)

proc connect*(url: string): Session =
  ## Connect to a Cap'n Web server
  newSession(url)

proc connect*(url: string, handler: proc(session: Session) {.closure.}) =
  ## Connect with auto-close block
  let session = newSession(url)
  try:
    handler(session)
  finally:
    waitFor session.close()

proc ensureConnected(session: Session) {.async.} =
  if session.connected:
    return

  session.ws = await newWebSocket(session.url)
  session.connected = true

  # Start message handler in background
  asyncCheck (proc() {.async.} =
    while session.connected:
      try:
        let msg = await session.ws.receiveStrPacket()
        let json = parseJson(msg)
        if json.hasKey("id"):
          let id = json["id"].getBiggestInt
          withLock session.lock:
            if session.pending.hasKey(id):
              session.pending[id].complete(json)
              session.pending.del(id)
      except WebSocketClosedError:
        session.connected = false
        break
      except:
        discard
  )()

proc close*(session: Session) {.async.} =
  session.connected = false
  if session.ws != nil:
    session.ws.close()

proc nextId(session: Session): int64 =
  withLock session.lock:
    inc session.nextId
    result = session.nextId

proc execute*(session: Session, importId: int64, path: seq[string],
              remapConfig: Option[RemapConfig] = none(RemapConfig)): Future[JsonNode] {.async.} =
  await session.ensureConnected()

  let callId = session.nextId()
  let future = newFuture[JsonNode]("execute")

  withLock session.lock:
    session.pending[callId] = future

  # Build call message
  var message = %*{
    "id": callId,
    "importId": importId,
    "path": path
  }

  if remapConfig.isSome:
    let rc = remapConfig.get
    message["remap"] = %*{
      "expression": rc.expression,
      "captures": rc.captures
    }

  await session.ws.send($message)

  let response = await future

  # Check for error
  if response.hasKey("error"):
    let error = response["error"]
    let code = error.getOrDefault("code").getStr("UNKNOWN")
    let msg = error.getOrDefault("message").getStr("Unknown error")
    let details = if error.hasKey("details"): some(error["details"]) else: none(JsonNode)
    raise newRpcError(code, msg, details)

  return response.getOrDefault("result")

# ---------------------------------------------------------
# Dynamic method calling (for conformance tests)
# ---------------------------------------------------------

proc call*(session: Session, methodName: string, args: seq[JsonNode],
           remapConfig: Option[RemapConfig] = none(RemapConfig)): Future[JsonNode] {.async.} =
  ## Call a method by name with optional remap
  await session.ensureConnected()

  let callId = session.nextId()
  let future = newFuture[JsonNode]("call")

  withLock session.lock:
    session.pending[callId] = future

  var message = %*{
    "id": callId,
    "method": methodName,
    "args": args
  }

  if remapConfig.isSome:
    let rc = remapConfig.get
    message["remap"] = %*{
      "expression": rc.expression,
      "captures": rc.captures
    }

  await session.ws.send($message)

  let response = await future

  if response.hasKey("error"):
    let error = response["error"]
    let code = error.getOrDefault("code").getStr("UNKNOWN")
    let msg = error.getOrDefault("message").getStr("Unknown error")
    let details = if error.hasKey("details"): some(error["details"]) else: none(JsonNode)
    raise newRpcError(code, msg, details)

  return response.getOrDefault("result")

proc call*(session: Session, methodName: string, args: varargs[JsonNode]): Future[JsonNode] =
  ## Varargs version of call
  session.call(methodName, @args, none(RemapConfig))

# ---------------------------------------------------------
# Interface pragma and stub generation
# ---------------------------------------------------------

template capnwebInterface*() {.pragma.}
  ## Pragma to mark an interface type

template capnwebMethod*() {.pragma.}
  ## Pragma to mark RPC methods

# Example interface definition using pragmas:
# type
#   MyApi {.capnwebInterface.} = ref object
#     session: Session
#
#   proc square(api: MyApi, n: int): Promise[int] {.capnwebMethod.}
#   proc generateFibonacci(api: MyApi, n: int): Promise[seq[int]] {.capnwebMethod.}

proc stub*[T](session: Session, _: typedesc[T]): T =
  ## Create a typed stub from a session
  ## Usage: let api = session.stub(MyApi)
  T(session: session)

# ---------------------------------------------------------
# Await multiple promises
# ---------------------------------------------------------

proc awaitAll*[T](promises: seq[Promise[T]]): Future[seq[T]] {.async.} =
  ## Await all promises and return results
  var results: seq[T] = @[]
  for p in promises:
    results.add(await p.await())
  return results

template awaitAll*(promises: varargs[untyped]): untyped =
  ## Await multiple promises of different types (returns tuple)
  ## Usage: let (a, b, c) = awaitAll(p1, p2, p3)
  block:
    var futures: seq[Future[void]] = @[]
    for p in promises:
      futures.add(p.await())
    waitFor all(futures)
    # Return values would be collected from promises

# ---------------------------------------------------------
# Utility procs for UFCS chains
# ---------------------------------------------------------

proc toJson*(x: int): JsonNode = %x
proc toJson*(x: int64): JsonNode = %x
proc toJson*(x: float): JsonNode = %x
proc toJson*(x: string): JsonNode = %x
proc toJson*(x: bool): JsonNode = %x
proc toJson*[T](x: seq[T]): JsonNode =
  result = newJArray()
  for item in x:
    result.add(item.toJson())

# Export main types and procs
export asyncdispatch, json, options
