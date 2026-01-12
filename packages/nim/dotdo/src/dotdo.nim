## DotDo Platform SDK for Nim
## Enterprise features: authentication, connection pooling, retry logic
##
## Example usage:
## ```nim
## import dotdo
##
## # Create platform client with authentication
## let platform = newDotDoPlatform("https://api.do.example.com")
## platform.setApiKey("your-api-key")
##
## # Connect with automatic retry and pooling
## await platform.connect()
##
## # Make authenticated calls with automatic retry
## let result = await platform.call("myService.method", %*{"key": "value"})
##
## # Use connection pool for high throughput
## let pool = platform.pool(size = 5)
## let results = await pool.parallel([
##   ("service.methodA", %*[1]),
##   ("service.methodB", %*[2]),
##   ("service.methodC", %*[3])
## ])
##
## # Clean shutdown
## await platform.shutdown()
## ```

import std/[asyncdispatch, json, tables, options, strutils, sequtils, locks, times, random, deques, os]
import ws

const
  Version* = "0.1.0"
  DefaultPoolSize* = 4
  DefaultMaxRetries* = 3
  DefaultBaseDelayMs* = 100
  DefaultMaxDelayMs* = 10000
  DefaultTimeoutMs* = 30000

# ---------------------------------------------------------
# Error Types
# ---------------------------------------------------------

type
  DotDoError* = object of CatchableError
    ## Base error type for DotDo operations
    code*: string
    retryable*: bool
    details*: Option[JsonNode]

  AuthError* = object of DotDoError
    ## Authentication error

  RateLimitError* = object of DotDoError
    ## Rate limit exceeded
    retryAfter*: Duration

  ServiceError* = object of DotDoError
    ## Service-level error

  ConnectionError* = object of DotDoError
    ## Connection error

proc newDotDoError*(code, message: string, retryable = false,
                    details: Option[JsonNode] = none(JsonNode)): ref DotDoError =
  result = newException(DotDoError, message)
  result.code = code
  result.retryable = retryable
  result.details = details

proc newAuthError*(message: string): ref AuthError =
  result = newException(AuthError, message)
  result.code = "AUTH_ERROR"
  result.retryable = false

proc newRateLimitError*(message: string, retryAfter: Duration): ref RateLimitError =
  result = newException(RateLimitError, message)
  result.code = "RATE_LIMIT"
  result.retryable = true
  result.retryAfter = retryAfter

proc newServiceError*(code, message: string): ref ServiceError =
  result = newException(ServiceError, message)
  result.code = code
  result.retryable = false

proc newConnectionError*(message: string): ref ConnectionError =
  result = newException(ConnectionError, message)
  result.code = "CONNECTION_ERROR"
  result.retryable = true

# ---------------------------------------------------------
# Authentication
# ---------------------------------------------------------

type
  AuthMethod* = enum
    amNone
    amApiKey
    amBearer
    amOAuth2
    amCustom

  AuthConfig* = ref object
    case method*: AuthMethod
    of amNone:
      discard
    of amApiKey:
      apiKey*: string
      headerName*: string
    of amBearer:
      token*: string
    of amOAuth2:
      clientId*: string
      clientSecret*: string
      tokenUrl*: string
      accessToken*: string
      refreshToken*: string
      expiresAt*: Time
    of amCustom:
      customAuth*: proc(): Future[Table[string, string]] {.closure.}

proc newApiKeyAuth*(apiKey: string, headerName = "X-API-Key"): AuthConfig =
  AuthConfig(method: amApiKey, apiKey: apiKey, headerName: headerName)

proc newBearerAuth*(token: string): AuthConfig =
  AuthConfig(method: amBearer, token: token)

proc newOAuth2Auth*(clientId, clientSecret, tokenUrl: string): AuthConfig =
  AuthConfig(
    method: amOAuth2,
    clientId: clientId,
    clientSecret: clientSecret,
    tokenUrl: tokenUrl,
    expiresAt: fromUnix(0)
  )

proc newCustomAuth*(authFn: proc(): Future[Table[string, string]]): AuthConfig =
  AuthConfig(method: amCustom, customAuth: authFn)

proc getAuthHeaders*(auth: AuthConfig): Future[Table[string, string]] {.async.} =
  result = initTable[string, string]()

  case auth.method
  of amNone:
    discard
  of amApiKey:
    result[auth.headerName] = auth.apiKey
  of amBearer:
    result["Authorization"] = "Bearer " & auth.token
  of amOAuth2:
    # Check if token needs refresh
    if auth.accessToken.len > 0 and getTime() < auth.expiresAt:
      result["Authorization"] = "Bearer " & auth.accessToken
    else:
      # Token refresh would happen here
      # For now, use existing token
      if auth.accessToken.len > 0:
        result["Authorization"] = "Bearer " & auth.accessToken
  of amCustom:
    result = await auth.customAuth()

# ---------------------------------------------------------
# Retry Policy
# ---------------------------------------------------------

type
  RetryPolicy* = ref object
    maxRetries*: int
    baseDelayMs*: int
    maxDelayMs*: int
    exponentialBase*: float
    jitterFactor*: float
    retryOn*: proc(err: ref CatchableError): bool

proc newRetryPolicy*(
  maxRetries = DefaultMaxRetries,
  baseDelayMs = DefaultBaseDelayMs,
  maxDelayMs = DefaultMaxDelayMs,
  exponentialBase = 2.0,
  jitterFactor = 0.1
): RetryPolicy =
  RetryPolicy(
    maxRetries: maxRetries,
    baseDelayMs: baseDelayMs,
    maxDelayMs: maxDelayMs,
    exponentialBase: exponentialBase,
    jitterFactor: jitterFactor,
    retryOn: proc(err: ref CatchableError): bool =
      if err of DotDoError:
        return (ref DotDoError)(err).retryable
      return false
  )

proc calculateDelay*(policy: RetryPolicy, attempt: int): Duration =
  ## Calculate delay with exponential backoff and jitter
  var delayMs = float(policy.baseDelayMs) * pow(policy.exponentialBase, float(attempt))
  delayMs = min(delayMs, float(policy.maxDelayMs))

  # Add jitter
  let jitter = delayMs * policy.jitterFactor * (rand(2.0) - 1.0)
  delayMs = max(0.0, delayMs + jitter)

  initDuration(milliseconds = int(delayMs))

proc shouldRetry*(policy: RetryPolicy, err: ref CatchableError, attempt: int): bool =
  if attempt >= policy.maxRetries:
    return false
  return policy.retryOn(err)

# ---------------------------------------------------------
# Connection Pool
# ---------------------------------------------------------

type
  PooledConnection* = ref object
    ws: WebSocket
    url: string
    inUse: bool
    createdAt: Time
    lastUsedAt: Time
    pending: Table[int64, Future[JsonNode]]
    nextId: int64
    lock: Lock

  ConnectionPool* = ref object
    url*: string
    size*: int
    connections: seq[PooledConnection]
    available: Deque[int]
    lock: Lock
    auth: AuthConfig
    timeout*: Duration

proc newPooledConnection(url: string): PooledConnection =
  result = PooledConnection(
    url: url,
    inUse: false,
    createdAt: getTime(),
    lastUsedAt: getTime(),
    pending: initTable[int64, Future[JsonNode]](),
    nextId: 0
  )
  initLock(result.lock)

proc connectPooled(conn: PooledConnection) {.async.} =
  conn.ws = await newWebSocket(conn.url)

proc disconnectPooled(conn: PooledConnection) {.async.} =
  if conn.ws != nil:
    conn.ws.close()

proc getNextId(conn: PooledConnection): int64 =
  withLock conn.lock:
    inc conn.nextId
    result = conn.nextId

proc newConnectionPool*(url: string, size = DefaultPoolSize,
                        auth: AuthConfig = nil): ConnectionPool =
  result = ConnectionPool(
    url: url,
    size: size,
    connections: @[],
    available: initDeque[int](),
    auth: auth,
    timeout: initDuration(milliseconds = DefaultTimeoutMs)
  )
  initLock(result.lock)

proc initialize*(pool: ConnectionPool) {.async.} =
  ## Initialize the connection pool
  for i in 0 ..< pool.size:
    let conn = newPooledConnection(pool.url)
    await conn.connectPooled()
    pool.connections.add(conn)
    pool.available.addLast(i)

proc acquire*(pool: ConnectionPool): Future[PooledConnection] {.async.} =
  ## Acquire a connection from the pool
  while true:
    withLock pool.lock:
      if pool.available.len > 0:
        let idx = pool.available.popFirst()
        let conn = pool.connections[idx]
        conn.inUse = true
        conn.lastUsedAt = getTime()
        return conn

    # Wait and retry
    await sleepAsync(10)

proc release*(pool: ConnectionPool, conn: PooledConnection) =
  ## Release a connection back to the pool
  withLock pool.lock:
    conn.inUse = false
    for i, c in pool.connections:
      if c == conn:
        pool.available.addLast(i)
        break

proc shutdown*(pool: ConnectionPool) {.async.} =
  ## Shutdown the connection pool
  for conn in pool.connections:
    await conn.disconnectPooled()
  pool.connections = @[]
  pool.available.clear()

proc callPooled(conn: PooledConnection, methodName: string,
                args: JsonNode): Future[JsonNode] {.async.} =
  let callId = conn.getNextId()
  let future = newFuture[JsonNode]("pool.call." & methodName)

  withLock conn.lock:
    conn.pending[callId] = future

  let message = %*{
    "jsonrpc": "2.0",
    "id": callId,
    "method": methodName,
    "params": args
  }

  await conn.ws.send($message)

  # Start listener if not running
  asyncCheck (proc() {.async.} =
    try:
      let msg = await conn.ws.receiveStrPacket()
      let json = parseJson(msg)

      if json.hasKey("id"):
        let id = json["id"].getBiggestInt
        withLock conn.lock:
          if conn.pending.hasKey(id):
            let fut = conn.pending[id]
            conn.pending.del(id)
            fut.complete(json.getOrDefault("result"))
    except:
      discard
  )()

  return await future

proc call*(pool: ConnectionPool, methodName: string,
           args: JsonNode): Future[JsonNode] {.async.} =
  ## Execute a call using a pooled connection
  let conn = await pool.acquire()
  defer: pool.release(conn)

  return await conn.callPooled(methodName, args)

type
  ParallelCall* = tuple[methodName: string, args: JsonNode]

proc parallel*(pool: ConnectionPool,
               calls: seq[ParallelCall]): Future[seq[JsonNode]] {.async.} =
  ## Execute multiple calls in parallel using the pool
  var futures: seq[Future[JsonNode]] = @[]

  for call in calls:
    futures.add(pool.call(call.methodName, call.args))

  var results: seq[JsonNode] = @[]
  for fut in futures:
    results.add(await fut)

  return results

# ---------------------------------------------------------
# DotDo Platform Client
# ---------------------------------------------------------

type
  PlatformState* = enum
    psDisconnected
    psConnecting
    psConnected
    psReconnecting
    psShuttingDown

  DotDoPlatform* = ref object
    baseUrl*: string
    auth*: AuthConfig
    retryPolicy*: RetryPolicy
    state*: PlatformState
    ws: WebSocket
    pending: Table[int64, Future[JsonNode]]
    nextId: int64
    lock: Lock
    timeout*: Duration
    connectionPool: ConnectionPool
    onStateChange*: proc(state: PlatformState) {.closure.}
    onError*: proc(err: ref DotDoError) {.closure.}

proc newDotDoPlatform*(baseUrl: string): DotDoPlatform =
  ## Create a new DotDo platform client
  result = DotDoPlatform(
    baseUrl: baseUrl,
    auth: AuthConfig(method: amNone),
    retryPolicy: newRetryPolicy(),
    state: psDisconnected,
    pending: initTable[int64, Future[JsonNode]](),
    nextId: 0,
    timeout: initDuration(milliseconds = DefaultTimeoutMs)
  )
  initLock(result.lock)

proc setApiKey*(platform: DotDoPlatform, apiKey: string, headerName = "X-API-Key") =
  ## Set API key authentication
  platform.auth = newApiKeyAuth(apiKey, headerName)

proc setBearerToken*(platform: DotDoPlatform, token: string) =
  ## Set Bearer token authentication
  platform.auth = newBearerAuth(token)

proc setOAuth2*(platform: DotDoPlatform, clientId, clientSecret, tokenUrl: string) =
  ## Set OAuth2 authentication
  platform.auth = newOAuth2Auth(clientId, clientSecret, tokenUrl)

proc setCustomAuth*(platform: DotDoPlatform,
                    authFn: proc(): Future[Table[string, string]]) =
  ## Set custom authentication
  platform.auth = newCustomAuth(authFn)

proc setRetryPolicy*(platform: DotDoPlatform, policy: RetryPolicy) =
  ## Set retry policy
  platform.retryPolicy = policy

proc setState(platform: DotDoPlatform, state: PlatformState) =
  platform.state = state
  if platform.onStateChange != nil:
    platform.onStateChange(state)

proc getNextId(platform: DotDoPlatform): int64 =
  withLock platform.lock:
    inc platform.nextId
    result = platform.nextId

# ---------------------------------------------------------
# Connection Management
# ---------------------------------------------------------

proc handleMessage(platform: DotDoPlatform, msg: string) =
  try:
    let json = parseJson(msg)

    if json.hasKey("id"):
      let id = json["id"].getBiggestInt

      withLock platform.lock:
        if platform.pending.hasKey(id):
          let future = platform.pending[id]
          platform.pending.del(id)

          if json.hasKey("error"):
            let error = json["error"]
            let code = error.getOrDefault("code").getStr("UNKNOWN")
            let message = error.getOrDefault("message").getStr("Unknown error")
            let details = if error.hasKey("details"): some(error["details"]) else: none(JsonNode)

            case code
            of "UNAUTHORIZED", "FORBIDDEN":
              future.fail(newAuthError(message))
            of "RATE_LIMIT":
              let retryAfter = error.getOrDefault("retry_after").getInt(1000)
              future.fail(newRateLimitError(message, initDuration(milliseconds = retryAfter)))
            else:
              future.fail(newServiceError(code, message))
          else:
            future.complete(json.getOrDefault("result"))
  except:
    if platform.onError != nil:
      platform.onError(newDotDoError("PARSE_ERROR", "Invalid JSON response"))

proc startMessageLoop(platform: DotDoPlatform) {.async.} =
  while platform.state == psConnected:
    try:
      let msg = await platform.ws.receiveStrPacket()
      platform.handleMessage(msg)
    except WebSocketClosedError:
      if platform.state == psConnected:
        platform.setState(psReconnecting)
        # Attempt reconnect
        try:
          await platform.connect()
        except:
          platform.setState(psDisconnected)
      break
    except:
      discard

proc connect*(platform: DotDoPlatform) {.async.} =
  ## Connect to the DotDo platform with automatic retry
  if platform.state == psConnected:
    return

  platform.setState(psConnecting)

  var lastError: ref CatchableError = nil

  for attempt in 0 ..< platform.retryPolicy.maxRetries:
    try:
      # Build WebSocket URL
      var wsUrl = platform.baseUrl
      if wsUrl.startsWith("https://"):
        wsUrl = "wss://" & wsUrl[8..^1]
      elif wsUrl.startsWith("http://"):
        wsUrl = "ws://" & wsUrl[7..^1]

      platform.ws = await newWebSocket(wsUrl)
      platform.setState(psConnected)

      asyncCheck platform.startMessageLoop()
      return
    except CatchableError as e:
      lastError = e
      if platform.retryPolicy.shouldRetry(e, attempt):
        let delay = platform.retryPolicy.calculateDelay(attempt)
        await sleepAsync(int(delay.inMilliseconds))
      else:
        break

  platform.setState(psDisconnected)
  if lastError != nil:
    raise newConnectionError("Failed to connect after retries: " & lastError.msg)
  else:
    raise newConnectionError("Failed to connect")

proc disconnect*(platform: DotDoPlatform) {.async.} =
  ## Disconnect from the platform
  if platform.state != psConnected:
    return

  platform.setState(psShuttingDown)

  # Cancel pending calls
  withLock platform.lock:
    for id, future in platform.pending.pairs:
      future.fail(newConnectionError("Platform disconnected"))
    platform.pending.clear()

  if platform.ws != nil:
    platform.ws.close()

  platform.setState(psDisconnected)

proc shutdown*(platform: DotDoPlatform) {.async.} =
  ## Graceful shutdown
  await platform.disconnect()
  if platform.connectionPool != nil:
    await platform.connectionPool.shutdown()

# ---------------------------------------------------------
# RPC Calls with Retry
# ---------------------------------------------------------

proc callWithRetry(platform: DotDoPlatform, methodName: string,
                   args: JsonNode): Future[JsonNode] {.async.} =
  ## Execute a call with automatic retry
  var lastError: ref CatchableError = nil

  for attempt in 0 ..< platform.retryPolicy.maxRetries:
    try:
      if platform.state != psConnected:
        await platform.connect()

      let callId = platform.getNextId()
      let future = newFuture[JsonNode]("platform.call." & methodName)

      withLock platform.lock:
        platform.pending[callId] = future

      # Get auth headers
      let authHeaders = await platform.auth.getAuthHeaders()

      var message = %*{
        "jsonrpc": "2.0",
        "id": callId,
        "method": methodName,
        "params": args
      }

      if authHeaders.len > 0:
        message["auth"] = %authHeaders

      await platform.ws.send($message)

      return await future

    except RateLimitError as e:
      # Handle rate limiting specially
      await sleepAsync(int(e.retryAfter.inMilliseconds))
      lastError = e
      continue

    except CatchableError as e:
      lastError = e
      if platform.retryPolicy.shouldRetry(e, attempt):
        let delay = platform.retryPolicy.calculateDelay(attempt)
        await sleepAsync(int(delay.inMilliseconds))
      else:
        break

  if lastError != nil:
    raise lastError
  else:
    raise newServiceError("UNKNOWN", "Call failed after retries")

proc call*(platform: DotDoPlatform, methodName: string,
           args: JsonNode): Future[JsonNode] {.async.} =
  ## Call a method on the platform
  ##
  ## Example:
  ## ```nim
  ## let result = await platform.call("users.get", %*{"id": 123})
  ## ```
  return await platform.callWithRetry(methodName, args)

proc call*(platform: DotDoPlatform, methodName: string,
           args: varargs[JsonNode]): Future[JsonNode] =
  ## Call with varargs
  var argsArray = newJArray()
  for arg in args:
    argsArray.add(arg)
  platform.call(methodName, argsArray)

# ---------------------------------------------------------
# Connection Pool Access
# ---------------------------------------------------------

proc pool*(platform: DotDoPlatform, size = DefaultPoolSize): ConnectionPool =
  ## Get or create connection pool
  if platform.connectionPool == nil:
    platform.connectionPool = newConnectionPool(platform.baseUrl, size, platform.auth)
  return platform.connectionPool

proc initPool*(platform: DotDoPlatform, size = DefaultPoolSize) {.async.} =
  ## Initialize the connection pool
  let pool = platform.pool(size)
  await pool.initialize()

# ---------------------------------------------------------
# Service Clients
# ---------------------------------------------------------

type
  ServiceClient* = ref object
    platform*: DotDoPlatform
    serviceName*: string

proc service*(platform: DotDoPlatform, serviceName: string): ServiceClient =
  ## Create a service-specific client
  ServiceClient(platform: platform, serviceName: serviceName)

proc call*(service: ServiceClient, methodName: string,
           args: JsonNode): Future[JsonNode] =
  ## Call a method on this service
  service.platform.call(service.serviceName & "." & methodName, args)

# ---------------------------------------------------------
# Health Check
# ---------------------------------------------------------

proc health*(platform: DotDoPlatform): Future[JsonNode] {.async.} =
  ## Check platform health
  return await platform.call("system.health", %*{})

proc ping*(platform: DotDoPlatform): Future[Duration] {.async.} =
  ## Ping the platform and return latency
  let start = getTime()
  discard await platform.call("system.ping", %*{})
  return getTime() - start

# ---------------------------------------------------------
# Context Manager Pattern
# ---------------------------------------------------------

template withPlatform*(url: string, body: untyped): untyped =
  ## Context manager for platform connection
  ##
  ## Example:
  ## ```nim
  ## withPlatform("https://api.do.example.com"):
  ##   platform.setApiKey("key")
  ##   let result = await platform.call("method", %*{})
  ## ```
  block:
    let platform {.inject.} = newDotDoPlatform(url)
    try:
      await platform.connect()
      body
    finally:
      await platform.shutdown()

# ---------------------------------------------------------
# Exports
# ---------------------------------------------------------

export asyncdispatch, json, options, tables, times
