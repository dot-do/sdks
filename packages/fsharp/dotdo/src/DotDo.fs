module DotDo

open System
open System.Collections.Concurrent
open System.Net.Http
open System.Net.Http.Headers
open System.Text.Json
open System.Threading
open DotDo.Rpc

// =============================================================================
// Authentication Types
// =============================================================================

/// Authentication token with expiration
type AuthToken = {
    AccessToken: string
    RefreshToken: string option
    ExpiresAt: DateTimeOffset
    TokenType: string
}

/// Authentication credentials
type Credentials =
    | ApiKey of key: string
    | BearerToken of token: string
    | OAuth2 of clientId: string * clientSecret: string
    | ServiceAccount of keyFile: string

/// Authentication configuration
type AuthConfig = {
    Credentials: Credentials
    TokenEndpoint: string option
    Scopes: string list
    AutoRefresh: bool
}

// =============================================================================
// Connection Pool Types
// =============================================================================

/// Connection pool configuration
type PoolConfig = {
    MaxConnections: int
    MinConnections: int
    IdleTimeout: TimeSpan
    MaxLifetime: TimeSpan
    AcquireTimeout: TimeSpan
}

/// Default pool configuration
let defaultPoolConfig = {
    MaxConnections = 10
    MinConnections = 1
    IdleTimeout = TimeSpan.FromMinutes(5.0)
    MaxLifetime = TimeSpan.FromHours(1.0)
    AcquireTimeout = TimeSpan.FromSeconds(30.0)
}

/// Pooled connection with metadata
type PooledConnection = {
    Client: HttpClient
    CreatedAt: DateTimeOffset
    LastUsedAt: DateTimeOffset
    Id: Guid
}

/// Connection pool state
type ConnectionPool = {
    Config: PoolConfig
    Connections: ConcurrentBag<PooledConnection>
    ActiveCount: int ref
    Semaphore: SemaphoreSlim
}

// =============================================================================
// Retry Types
// =============================================================================

/// Retry strategy
type RetryStrategy =
    | ExponentialBackoff of baseDelay: TimeSpan * maxDelay: TimeSpan * maxRetries: int
    | LinearBackoff of delay: TimeSpan * maxRetries: int
    | FixedDelay of delay: TimeSpan * maxRetries: int
    | NoRetry

/// Default retry strategy
let defaultRetryStrategy =
    ExponentialBackoff (
        TimeSpan.FromMilliseconds(100.0),
        TimeSpan.FromSeconds(30.0),
        5
    )

/// Retry configuration
type RetryConfig = {
    Strategy: RetryStrategy
    RetryableErrors: RpcError -> bool
    OnRetry: int * RpcError * TimeSpan -> unit
}

/// Default retry configuration
let defaultRetryConfig = {
    Strategy = defaultRetryStrategy
    RetryableErrors = fun error ->
        match error with
        | ConnectionFailed _ -> true
        | Timeout _ -> true
        | ServerError (msg, _) when msg.Contains("503") -> true
        | ServerError (msg, _) when msg.Contains("502") -> true
        | ServerError (msg, _) when msg.Contains("429") -> true
        | _ -> false
    OnRetry = fun _ -> ()
}

// =============================================================================
// DotDo Client Configuration
// =============================================================================

/// DotDo client configuration
type ClientConfig = {
    BaseUrl: string
    Auth: AuthConfig option
    Pool: PoolConfig
    Retry: RetryConfig
    Timeout: TimeSpan
    UserAgent: string
}

/// Default client configuration
let defaultClientConfig baseUrl = {
    BaseUrl = baseUrl
    Auth = None
    Pool = defaultPoolConfig
    Retry = defaultRetryConfig
    Timeout = TimeSpan.FromSeconds(30.0)
    UserAgent = "DotDo.FSharp/0.1.0"
}

// =============================================================================
// Authentication Module
// =============================================================================

module Auth =
    /// Cached tokens by endpoint
    let private tokenCache = ConcurrentDictionary<string, AuthToken>()

    /// Check if token is expired (with 30 second buffer)
    let isTokenExpired (token: AuthToken) =
        token.ExpiresAt <= DateTimeOffset.UtcNow.AddSeconds(30.0)

    /// Get authorization header value
    let getAuthHeader (credentials: Credentials) : string =
        match credentials with
        | ApiKey key -> $"Bearer {key}"
        | BearerToken token -> $"Bearer {token}"
        | OAuth2 _ -> "" // Requires token exchange
        | ServiceAccount _ -> "" // Requires token exchange

    /// Exchange OAuth2 credentials for token
    let exchangeOAuth2Token (client: HttpClient) (endpoint: string) (clientId: string) (clientSecret: string) (scopes: string list) : Async<Result<AuthToken, RpcError>> =
        async {
            try
                let scopeStr = String.Join(" ", scopes)
                let content = new FormUrlEncodedContent([
                    KeyValuePair("grant_type", "client_credentials")
                    KeyValuePair("client_id", clientId)
                    KeyValuePair("client_secret", clientSecret)
                    KeyValuePair("scope", scopeStr)
                ])

                let! response = client.PostAsync(endpoint, content) |> Async.AwaitTask

                if response.IsSuccessStatusCode then
                    let! body = response.Content.ReadAsStringAsync() |> Async.AwaitTask
                    let doc = JsonDocument.Parse(body)
                    let root = doc.RootElement

                    let accessToken = root.GetProperty("access_token").GetString()
                    let expiresIn = root.GetProperty("expires_in").GetInt32()
                    let tokenType =
                        if root.TryGetProperty("token_type", &Unchecked.defaultof<JsonElement>) then
                            root.GetProperty("token_type").GetString()
                        else
                            "Bearer"
                    let refreshToken =
                        if root.TryGetProperty("refresh_token", &Unchecked.defaultof<JsonElement>) then
                            Some (root.GetProperty("refresh_token").GetString())
                        else
                            None

                    let token = {
                        AccessToken = accessToken
                        RefreshToken = refreshToken
                        ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(float expiresIn)
                        TokenType = tokenType
                    }

                    return Ok token
                else
                    let! errorBody = response.Content.ReadAsStringAsync() |> Async.AwaitTask
                    return Error (Unauthorized $"OAuth2 token exchange failed: {errorBody}")
            with ex ->
                return Error (Unauthorized $"Token exchange error: {ex.Message}")
        }

    /// Refresh an expired token
    let refreshToken (client: HttpClient) (endpoint: string) (token: AuthToken) : Async<Result<AuthToken, RpcError>> =
        async {
            match token.RefreshToken with
            | Some refreshToken ->
                try
                    let content = new FormUrlEncodedContent([
                        KeyValuePair("grant_type", "refresh_token")
                        KeyValuePair("refresh_token", refreshToken)
                    ])

                    let! response = client.PostAsync(endpoint, content) |> Async.AwaitTask

                    if response.IsSuccessStatusCode then
                        let! body = response.Content.ReadAsStringAsync() |> Async.AwaitTask
                        let doc = JsonDocument.Parse(body)
                        let root = doc.RootElement

                        let accessToken = root.GetProperty("access_token").GetString()
                        let expiresIn = root.GetProperty("expires_in").GetInt32()
                        let newRefreshToken =
                            if root.TryGetProperty("refresh_token", &Unchecked.defaultof<JsonElement>) then
                                Some (root.GetProperty("refresh_token").GetString())
                            else
                                token.RefreshToken

                        let newToken = {
                            AccessToken = accessToken
                            RefreshToken = newRefreshToken
                            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(float expiresIn)
                            TokenType = token.TokenType
                        }

                        return Ok newToken
                    else
                        return Error (Unauthorized "Token refresh failed")
                with ex ->
                    return Error (Unauthorized $"Token refresh error: {ex.Message}")
            | None ->
                return Error (Unauthorized "No refresh token available")
        }

    /// Get or refresh authentication token
    let getToken (client: HttpClient) (config: AuthConfig) : Async<Result<string, RpcError>> =
        async {
            let cacheKey =
                match config.Credentials with
                | ApiKey key -> $"api:{key.Substring(0, min 8 key.Length)}"
                | BearerToken token -> $"bearer:{token.Substring(0, min 8 token.Length)}"
                | OAuth2 (clientId, _) -> $"oauth2:{clientId}"
                | ServiceAccount keyFile -> $"sa:{keyFile}"

            // Check cache first
            match tokenCache.TryGetValue(cacheKey) with
            | true, cached when not (isTokenExpired cached) ->
                return Ok cached.AccessToken
            | true, cached when config.AutoRefresh ->
                // Try to refresh
                match config.TokenEndpoint with
                | Some endpoint ->
                    let! refreshResult = refreshToken client endpoint cached
                    match refreshResult with
                    | Ok newToken ->
                        tokenCache.[cacheKey] <- newToken
                        return Ok newToken.AccessToken
                    | Error e ->
                        return Error e
                | None ->
                    return Error (Unauthorized "No token endpoint configured for refresh")
            | _ ->
                // Need to get new token
                match config.Credentials with
                | ApiKey key ->
                    return Ok key
                | BearerToken token ->
                    return Ok token
                | OAuth2 (clientId, clientSecret) ->
                    match config.TokenEndpoint with
                    | Some endpoint ->
                        let! tokenResult = exchangeOAuth2Token client endpoint clientId clientSecret config.Scopes
                        match tokenResult with
                        | Ok token ->
                            tokenCache.[cacheKey] <- token
                            return Ok token.AccessToken
                        | Error e ->
                            return Error e
                    | None ->
                        return Error (Unauthorized "No token endpoint configured for OAuth2")
                | ServiceAccount keyFile ->
                    // Service account authentication would require JWT signing
                    return Error (Unauthorized $"Service account auth not yet implemented: {keyFile}")
        }

// =============================================================================
// Connection Pool Module
// =============================================================================

module Pool =
    /// Create a new connection pool
    let create (config: PoolConfig) : ConnectionPool =
        {
            Config = config
            Connections = ConcurrentBag<PooledConnection>()
            ActiveCount = ref 0
            Semaphore = new SemaphoreSlim(config.MaxConnections, config.MaxConnections)
        }

    /// Create a new HTTP client with configuration
    let private createClient (timeout: TimeSpan) (userAgent: string) : HttpClient =
        let handler = new SocketsHttpHandler(
            PooledConnectionLifetime = TimeSpan.FromMinutes(5.0),
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(2.0),
            MaxConnectionsPerServer = 100
        )
        let client = new HttpClient(handler)
        client.Timeout <- timeout
        client.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent)
        client

    /// Acquire a connection from the pool
    let acquire (pool: ConnectionPool) (timeout: TimeSpan) (userAgent: string) : Async<Result<PooledConnection, RpcError>> =
        async {
            let! acquired = pool.Semaphore.WaitAsync(pool.Config.AcquireTimeout) |> Async.AwaitTask

            if not acquired then
                return Error (Timeout ("acquire_connection", pool.Config.AcquireTimeout))
            else
                // Try to get an existing connection
                let mutable connection = Unchecked.defaultof<PooledConnection>
                let now = DateTimeOffset.UtcNow

                while pool.Connections.TryTake(&connection) do
                    // Check if connection is still valid
                    let age = now - connection.CreatedAt
                    let idle = now - connection.LastUsedAt

                    if age < pool.Config.MaxLifetime && idle < pool.Config.IdleTimeout then
                        let updated = { connection with LastUsedAt = now }
                        return Ok updated
                    else
                        // Connection expired, dispose and try again
                        connection.Client.Dispose()

                // Create new connection
                let client = createClient timeout userAgent
                let newConnection = {
                    Client = client
                    CreatedAt = now
                    LastUsedAt = now
                    Id = Guid.NewGuid()
                }
                Interlocked.Increment(pool.ActiveCount) |> ignore
                return Ok newConnection
        }

    /// Release a connection back to the pool
    let release (pool: ConnectionPool) (connection: PooledConnection) : unit =
        let now = DateTimeOffset.UtcNow
        let age = now - connection.CreatedAt

        if age < pool.Config.MaxLifetime then
            let updated = { connection with LastUsedAt = now }
            pool.Connections.Add(updated)
        else
            connection.Client.Dispose()
            Interlocked.Decrement(pool.ActiveCount) |> ignore

        pool.Semaphore.Release() |> ignore

    /// Use a connection from the pool with automatic release
    let useConnection (pool: ConnectionPool) (timeout: TimeSpan) (userAgent: string) (f: HttpClient -> Async<'T>) : Async<Result<'T, RpcError>> =
        async {
            let! connResult = acquire pool timeout userAgent

            match connResult with
            | Error e -> return Error e
            | Ok connection ->
                try
                    let! result = f connection.Client
                    release pool connection
                    return Ok result
                with ex ->
                    release pool connection
                    return Error (ServerError (ex.Message, Some ex.StackTrace))
        }

// =============================================================================
// Retry Module
// =============================================================================

module Retry =
    /// Calculate delay for retry attempt
    let calculateDelay (strategy: RetryStrategy) (attempt: int) : TimeSpan option =
        match strategy with
        | NoRetry -> None
        | FixedDelay (delay, maxRetries) ->
            if attempt < maxRetries then Some delay else None
        | LinearBackoff (delay, maxRetries) ->
            if attempt < maxRetries then
                Some (TimeSpan.FromTicks(delay.Ticks * int64 (attempt + 1)))
            else
                None
        | ExponentialBackoff (baseDelay, maxDelay, maxRetries) ->
            if attempt < maxRetries then
                let delayMs = baseDelay.TotalMilliseconds * Math.Pow(2.0, float attempt)
                let cappedDelayMs = min delayMs maxDelay.TotalMilliseconds
                // Add jitter (0-25%)
                let jitter = Random().NextDouble() * 0.25
                let finalDelayMs = cappedDelayMs * (1.0 + jitter)
                Some (TimeSpan.FromMilliseconds(finalDelayMs))
            else
                None

    /// Execute with retry logic using F# Async
    let withRetry (config: RetryConfig) (operation: unit -> Async<Result<'T, RpcError>>) : Async<Result<'T, RpcError>> =
        let rec loop attempt =
            async {
                let! result = operation ()

                match result with
                | Ok value -> return Ok value
                | Error error ->
                    if config.RetryableErrors error then
                        match calculateDelay config.Strategy attempt with
                        | Some delay ->
                            config.OnRetry (attempt, error, delay)
                            do! Async.Sleep (int delay.TotalMilliseconds)
                            return! loop (attempt + 1)
                        | None ->
                            return Error error
                    else
                        return Error error
            }

        loop 0

// =============================================================================
// DotDo Client
// =============================================================================

/// DotDo platform client
type Client = {
    Config: ClientConfig
    Pool: ConnectionPool
    mutable Stub: RpcStub option
}

/// Create a new DotDo client
let createClient (config: ClientConfig) : Client =
    {
        Config = config
        Pool = Pool.create config.Pool
        Stub = None
    }

/// Create a client with default configuration
let connect (baseUrl: string) : Client =
    createClient (defaultClientConfig baseUrl)

/// Create a client with API key authentication
let connectWithApiKey (baseUrl: string) (apiKey: string) : Client =
    let config = {
        defaultClientConfig baseUrl with
            Auth = Some {
                Credentials = ApiKey apiKey
                TokenEndpoint = None
                Scopes = []
                AutoRefresh = false
            }
    }
    createClient config

/// Create a client with OAuth2 authentication
let connectWithOAuth2 (baseUrl: string) (clientId: string) (clientSecret: string) (tokenEndpoint: string) (scopes: string list) : Client =
    let config = {
        defaultClientConfig baseUrl with
            Auth = Some {
                Credentials = OAuth2 (clientId, clientSecret)
                TokenEndpoint = Some tokenEndpoint
                Scopes = scopes
                AutoRefresh = true
            }
    }
    createClient config

/// Apply authentication to HTTP client
let private applyAuth (client: HttpClient) (authConfig: AuthConfig option) : Async<Result<unit, RpcError>> =
    async {
        match authConfig with
        | None -> return Ok ()
        | Some config ->
            let! tokenResult = Auth.getToken client config
            match tokenResult with
            | Ok token ->
                client.DefaultRequestHeaders.Authorization <- AuthenticationHeaderValue("Bearer", token)
                return Ok ()
            | Error e ->
                return Error e
    }

/// Execute an RPC call with the client
let call (methodName: string) (args: obj list) (client: Client) : Async<RpcResult<RpcValue>> =
    let operation () =
        async {
            let! poolResult = Pool.useConnection client.Pool client.Config.Timeout client.Config.UserAgent (fun httpClient ->
                async {
                    // Apply authentication
                    let! authResult = applyAuth httpClient client.Config.Auth
                    match authResult with
                    | Error e -> return Error e
                    | Ok () ->
                        // Create stub and make call
                        let stub = {
                            BaseUrl = client.Config.BaseUrl
                            Client = httpClient
                            CapabilityId = None
                        }
                        return! Transport.call stub methodName args
                })

            match poolResult with
            | Ok (Ok value) -> return Ok value
            | Ok (Error e) -> return Error e
            | Error e -> return Error e
        }

    Retry.withRetry client.Config.Retry operation

/// Execute an RPC call using pipe operator
let callAsync (client: Client) (methodName: string) (args: obj list) : RpcPromise<RpcValue> =
    {
        Value = call methodName args client
        Transform = id
    }

/// Get a capability stub
let getCapability (capId: string) (client: Client) : RpcStub =
    {
        BaseUrl = client.Config.BaseUrl
        Client = new HttpClient()
        CapabilityId = Some capId
    }

// =============================================================================
// Convenience Operators
// =============================================================================

/// Pipe operator for chaining RPC calls
let (|>>) (client: Client) (methodCall: Client -> RpcPromise<'T>) : RpcPromise<'T> =
    methodCall client

/// Compose RPC operations
let (>=>) (f: 'A -> Async<RpcResult<'B>>) (g: 'B -> Async<RpcResult<'C>>) : 'A -> Async<RpcResult<'C>> =
    fun a ->
        async {
            let! resultB = f a
            match resultB with
            | Ok b -> return! g b
            | Error e -> return Error e
        }
