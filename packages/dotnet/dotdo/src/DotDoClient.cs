// ============================================================================
// DotDo Platform Client for .NET
// Authentication, connection pooling, and retry logic using async/await
// ============================================================================
//
// Usage:
//   var client = new DotDoClient(new DotDoOptions
//   {
//       BaseUrl = "https://api.dotdo.io",
//       ApiKey = "your-api-key"
//   });
//
//   await client.ConnectAsync();
//   var result = await client.Call<int>("square", 5);
//
// With connection pooling and retry:
//   var client = new DotDoClient(new DotDoOptions
//   {
//       BaseUrl = "https://api.dotdo.io",
//       ApiKey = "your-api-key",
//       PoolSize = 4,
//       RetryPolicy = new RetryPolicy
//       {
//           MaxRetries = 3,
//           InitialDelayMs = 100,
//           MaxDelayMs = 5000,
//           BackoffMultiplier = 2.0
//       }
//   });
//
// ============================================================================

using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DotDo.Rpc;

namespace DotDo;

// ============================================================================
// Configuration Options
// ============================================================================

/// <summary>
/// Configuration options for DotDoClient.
/// </summary>
public class DotDoOptions
{
    /// <summary>
    /// The base URL of the DotDo server.
    /// </summary>
    public string BaseUrl { get; set; } = "https://api.dotdo.io";

    /// <summary>
    /// API key for authentication.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// OAuth access token for authentication.
    /// </summary>
    public string? AccessToken { get; set; }

    /// <summary>
    /// Custom authentication headers.
    /// </summary>
    public Dictionary<string, string>? CustomHeaders { get; set; }

    /// <summary>
    /// Number of connections to maintain in the pool.
    /// </summary>
    public int PoolSize { get; set; } = 1;

    /// <summary>
    /// Retry policy configuration.
    /// </summary>
    public RetryPolicy? RetryPolicy { get; set; }

    /// <summary>
    /// Connection timeout in milliseconds.
    /// </summary>
    public int ConnectionTimeoutMs { get; set; } = 30000;

    /// <summary>
    /// Request timeout in milliseconds.
    /// </summary>
    public int RequestTimeoutMs { get; set; } = 30000;

    /// <summary>
    /// Enable automatic reconnection on disconnect.
    /// </summary>
    public bool AutoReconnect { get; set; } = true;
}

/// <summary>
/// Retry policy configuration.
/// </summary>
public class RetryPolicy
{
    /// <summary>
    /// Maximum number of retry attempts.
    /// </summary>
    public int MaxRetries { get; set; } = 3;

    /// <summary>
    /// Initial delay between retries in milliseconds.
    /// </summary>
    public int InitialDelayMs { get; set; } = 100;

    /// <summary>
    /// Maximum delay between retries in milliseconds.
    /// </summary>
    public int MaxDelayMs { get; set; } = 5000;

    /// <summary>
    /// Backoff multiplier for exponential backoff.
    /// </summary>
    public double BackoffMultiplier { get; set; } = 2.0;

    /// <summary>
    /// Whether to retry on timeout errors.
    /// </summary>
    public bool RetryOnTimeout { get; set; } = true;

    /// <summary>
    /// Whether to retry on connection errors.
    /// </summary>
    public bool RetryOnConnectionError { get; set; } = true;
}

// ============================================================================
// Authentication Provider
// ============================================================================

/// <summary>
/// Provides authentication credentials for DotDo connections.
/// </summary>
public interface IAuthProvider
{
    /// <summary>
    /// Gets the authentication headers to include in requests.
    /// </summary>
    Task<Dictionary<string, string>> GetAuthHeadersAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Refreshes the authentication credentials if needed.
    /// </summary>
    Task RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// API key authentication provider.
/// </summary>
public class ApiKeyAuthProvider : IAuthProvider
{
    private readonly string _apiKey;

    public ApiKeyAuthProvider(string apiKey)
    {
        _apiKey = apiKey;
    }

    public Task<Dictionary<string, string>> GetAuthHeadersAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new Dictionary<string, string>
        {
            ["Authorization"] = $"Bearer {_apiKey}"
        });
    }

    public Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        return Task.CompletedTask;
    }
}

/// <summary>
/// OAuth access token authentication provider.
/// </summary>
public class OAuthAuthProvider : IAuthProvider
{
    private string _accessToken;
    private readonly Func<CancellationToken, Task<string>>? _refreshTokenFunc;

    public OAuthAuthProvider(string accessToken, Func<CancellationToken, Task<string>>? refreshTokenFunc = null)
    {
        _accessToken = accessToken;
        _refreshTokenFunc = refreshTokenFunc;
    }

    public Task<Dictionary<string, string>> GetAuthHeadersAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new Dictionary<string, string>
        {
            ["Authorization"] = $"Bearer {_accessToken}"
        });
    }

    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_refreshTokenFunc != null)
        {
            _accessToken = await _refreshTokenFunc(cancellationToken);
        }
    }
}

// ============================================================================
// Connection Pool
// ============================================================================

/// <summary>
/// A pooled WebSocket connection.
/// </summary>
internal class PooledConnection : IAsyncDisposable
{
    public ClientWebSocket WebSocket { get; }
    public DateTime LastUsed { get; set; }
    public bool IsHealthy => WebSocket.State == WebSocketState.Open;
    public SemaphoreSlim SendLock { get; } = new(1, 1);

    private readonly Dictionary<int, TaskCompletionSource<JsonNode?>> _pendingRequests = new();
    private CancellationTokenSource? _receiveLoopCts;
    private Task? _receiveLoopTask;
    private int _messageId;

    public PooledConnection(ClientWebSocket webSocket)
    {
        WebSocket = webSocket;
        LastUsed = DateTime.UtcNow;
    }

    public void StartReceiveLoop()
    {
        _receiveLoopCts = new CancellationTokenSource();
        _receiveLoopTask = ReceiveLoopAsync(_receiveLoopCts.Token);
    }

    public async Task<JsonNode?> SendAndReceiveAsync(JsonObject request, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var messageId = Interlocked.Increment(ref _messageId);
        request["id"] = messageId;

        var tcs = new TaskCompletionSource<JsonNode?>();
        _pendingRequests[messageId] = tcs;

        try
        {
            var json = request.ToJsonString();
            var bytes = Encoding.UTF8.GetBytes(json);

            await SendLock.WaitAsync(cancellationToken);
            try
            {
                await WebSocket.SendAsync(
                    new ArraySegment<byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken);
            }
            finally
            {
                SendLock.Release();
            }

            LastUsed = DateTime.UtcNow;

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(timeout);

            return await tcs.Task.WaitAsync(cts.Token);
        }
        finally
        {
            _pendingRequests.Remove(messageId);
        }
    }

    private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[8192];

        try
        {
            while (!cancellationToken.IsCancellationRequested && WebSocket.State == WebSocketState.Open)
            {
                var result = await WebSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var json = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    var response = JsonNode.Parse(json);

                    if (response?["id"]?.GetValue<int>() is int id && _pendingRequests.TryGetValue(id, out var tcs))
                    {
                        if (response["error"] != null)
                        {
                            var errorType = response["error"]?["type"]?.GetValue<string>() ?? "Error";
                            var errorMessage = response["error"]?["message"]?.GetValue<string>() ?? "Unknown error";
                            tcs.SetException(new RpcException(errorMessage, errorType));
                        }
                        else
                        {
                            tcs.SetResult(response["result"]);
                        }
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal cancellation
        }
        catch (Exception)
        {
            // Connection error - fail all pending requests
            foreach (var (_, tcs) in _pendingRequests)
            {
                tcs.TrySetException(new RpcException("Connection lost", "ConnectionLost"));
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        _receiveLoopCts?.Cancel();

        if (WebSocket.State == WebSocketState.Open)
        {
            try
            {
                await WebSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Pool cleanup", CancellationToken.None);
            }
            catch
            {
                // Ignore close errors
            }
        }

        if (_receiveLoopTask != null)
        {
            try
            {
                await _receiveLoopTask;
            }
            catch
            {
                // Ignore
            }
        }

        WebSocket.Dispose();
        _receiveLoopCts?.Dispose();
        SendLock.Dispose();
    }
}

/// <summary>
/// Manages a pool of WebSocket connections.
/// </summary>
internal class ConnectionPool : IAsyncDisposable
{
    private readonly DotDoOptions _options;
    private readonly IAuthProvider? _authProvider;
    private readonly List<PooledConnection> _connections = new();
    private readonly SemaphoreSlim _poolLock = new(1, 1);
    private int _roundRobinIndex;
    private bool _disposed;

    public ConnectionPool(DotDoOptions options, IAuthProvider? authProvider)
    {
        _options = options;
        _authProvider = authProvider;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await _poolLock.WaitAsync(cancellationToken);
        try
        {
            for (int i = 0; i < _options.PoolSize; i++)
            {
                var connection = await CreateConnectionAsync(cancellationToken);
                _connections.Add(connection);
            }
        }
        finally
        {
            _poolLock.Release();
        }
    }

    private async Task<PooledConnection> CreateConnectionAsync(CancellationToken cancellationToken)
    {
        var webSocket = new ClientWebSocket();

        // Add authentication headers
        if (_authProvider != null)
        {
            var headers = await _authProvider.GetAuthHeadersAsync(cancellationToken);
            foreach (var (key, value) in headers)
            {
                webSocket.Options.SetRequestHeader(key, value);
            }
        }

        // Add custom headers
        if (_options.CustomHeaders != null)
        {
            foreach (var (key, value) in _options.CustomHeaders)
            {
                webSocket.Options.SetRequestHeader(key, value);
            }
        }

        // Convert HTTP URL to WebSocket URL
        var wsUrl = _options.BaseUrl
            .Replace("http://", "ws://")
            .Replace("https://", "wss://");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(_options.ConnectionTimeoutMs);

        await webSocket.ConnectAsync(new Uri(wsUrl), cts.Token);

        var connection = new PooledConnection(webSocket);
        connection.StartReceiveLoop();
        return connection;
    }

    public async Task<PooledConnection> GetConnectionAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ConnectionPool));

        await _poolLock.WaitAsync(cancellationToken);
        try
        {
            // Find a healthy connection using round-robin
            for (int i = 0; i < _connections.Count; i++)
            {
                var index = (_roundRobinIndex + i) % _connections.Count;
                var connection = _connections[index];

                if (connection.IsHealthy)
                {
                    _roundRobinIndex = (index + 1) % _connections.Count;
                    return connection;
                }
            }

            // All connections unhealthy - try to recreate one
            if (_options.AutoReconnect)
            {
                for (int i = 0; i < _connections.Count; i++)
                {
                    if (!_connections[i].IsHealthy)
                    {
                        await _connections[i].DisposeAsync();
                        _connections[i] = await CreateConnectionAsync(cancellationToken);
                        return _connections[i];
                    }
                }
            }

            throw new RpcException("No healthy connections available", "NoConnection");
        }
        finally
        {
            _poolLock.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        await _poolLock.WaitAsync();
        try
        {
            foreach (var connection in _connections)
            {
                await connection.DisposeAsync();
            }
            _connections.Clear();
        }
        finally
        {
            _poolLock.Release();
            _poolLock.Dispose();
        }
    }
}

// ============================================================================
// DotDo Client
// ============================================================================

/// <summary>
/// Main client for connecting to the DotDo platform.
/// Includes authentication, connection pooling, and retry logic.
/// </summary>
public class DotDoClient : IAsyncDisposable
{
    private readonly DotDoOptions _options;
    private readonly IAuthProvider? _authProvider;
    private ConnectionPool? _connectionPool;
    private bool _isConnected;

    /// <summary>
    /// Creates a new DotDoClient with the specified options.
    /// </summary>
    public DotDoClient(DotDoOptions options)
    {
        _options = options;

        // Set up authentication provider
        if (!string.IsNullOrEmpty(options.ApiKey))
        {
            _authProvider = new ApiKeyAuthProvider(options.ApiKey);
        }
        else if (!string.IsNullOrEmpty(options.AccessToken))
        {
            _authProvider = new OAuthAuthProvider(options.AccessToken);
        }
    }

    /// <summary>
    /// Creates a new DotDoClient with a custom authentication provider.
    /// </summary>
    public DotDoClient(DotDoOptions options, IAuthProvider authProvider)
    {
        _options = options;
        _authProvider = authProvider;
    }

    /// <summary>
    /// Gets whether the client is connected.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Connects to the DotDo platform.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        _connectionPool = new ConnectionPool(_options, _authProvider);
        await _connectionPool.InitializeAsync(cancellationToken);
        _isConnected = true;
    }

    /// <summary>
    /// Creates a promise for an RPC call.
    /// </summary>
    public DotDoPromise<T> Call<T>(string method, params object?[] args)
    {
        return new DotDoPromise<T>(this, method, args);
    }

    /// <summary>
    /// Executes an RPC call with retry logic.
    /// </summary>
    internal async Task<T> ExecuteAsync<T>(
        string method,
        object?[] args,
        SelectExpression? selectExpression,
        CancellationToken cancellationToken = default)
    {
        if (!_isConnected || _connectionPool == null)
        {
            throw new RpcException("Not connected to server", "NotConnected");
        }

        var retryPolicy = _options.RetryPolicy;
        var attempt = 0;
        var delay = retryPolicy?.InitialDelayMs ?? 100;

        while (true)
        {
            try
            {
                var connection = await _connectionPool.GetConnectionAsync(cancellationToken);

                var request = new JsonObject
                {
                    ["method"] = method,
                    ["args"] = JsonSerializer.SerializeToNode(args)
                };

                if (selectExpression != null)
                {
                    request["select"] = new JsonObject
                    {
                        ["expression"] = selectExpression.Expression,
                        ["innerPipeline"] = JsonSerializer.SerializeToNode(selectExpression.InnerPipeline.Select(s => new
                        {
                            method = s.Method,
                            args = s.Args
                        })),
                        ["captures"] = JsonSerializer.SerializeToNode(selectExpression.Captures)
                    };
                }

                var timeout = TimeSpan.FromMilliseconds(_options.RequestTimeoutMs);
                var result = await connection.SendAndReceiveAsync(request, timeout, cancellationToken);

                if (result == null)
                {
                    return default!;
                }

                return result.Deserialize<T>()!;
            }
            catch (RpcException ex) when (ShouldRetry(ex, attempt, retryPolicy))
            {
                attempt++;
                await Task.Delay(delay, cancellationToken);
                delay = Math.Min((int)(delay * (retryPolicy?.BackoffMultiplier ?? 2.0)), retryPolicy?.MaxDelayMs ?? 5000);

                // Try to refresh auth if unauthorized
                if (ex.ErrorType == "Unauthorized" && _authProvider != null)
                {
                    await _authProvider.RefreshAsync(cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                throw new RpcTimeoutException("Request timed out");
            }
        }
    }

    private static bool ShouldRetry(RpcException ex, int attempt, RetryPolicy? policy)
    {
        if (policy == null) return false;
        if (attempt >= policy.MaxRetries) return false;

        return ex.ErrorType switch
        {
            "Timeout" => policy.RetryOnTimeout,
            "ConnectionLost" or "NoConnection" => policy.RetryOnConnectionError,
            "Unauthorized" => true, // Retry after token refresh
            _ => false
        };
    }

    /// <summary>
    /// Closes the connection.
    /// </summary>
    public async Task CloseAsync()
    {
        if (_connectionPool != null)
        {
            await _connectionPool.DisposeAsync();
            _connectionPool = null;
        }
        _isConnected = false;
    }

    /// <summary>
    /// Disposes the client.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        GC.SuppressFinalize(this);
    }
}

// ============================================================================
// DotDo Promise - Wraps RpcPromise with DotDoClient-specific features
// ============================================================================

/// <summary>
/// A promise for a DotDo RPC call with retry support.
/// </summary>
public class DotDoPromise<T>
{
    private readonly DotDoClient _client;
    private readonly string _method;
    private readonly object?[] _args;
    private readonly SelectExpression? _selectExpression;

    internal DotDoPromise(DotDoClient client, string method, object?[] args, SelectExpression? selectExpression = null)
    {
        _client = client;
        _method = method;
        _args = args;
        _selectExpression = selectExpression;
    }

    /// <summary>
    /// Maps each element using a server-side transformation.
    /// </summary>
    public DotDoPromise<TResult[]> Select<TResult>(Func<DotDoPromise<T>, DotDoPromise<TResult>> selector)
    {
        var placeholder = new DotDoPromise<T>(_client, "$element", []);
        var resultPromise = selector(placeholder);

        var selectExpr = new SelectExpression(
            Expression: $"x => {resultPromise._method}({string.Join(", ", resultPromise._args)})",
            InnerPipeline: [new PipelineStep(resultPromise._method, resultPromise._args.ToList())],
            Captures: ["$self"]
        );

        return new DotDoPromise<TResult[]>(_client, _method, _args, selectExpr);
    }

    /// <summary>
    /// Gets an awaiter for async/await support.
    /// </summary>
    public TaskAwaiter<T> GetAwaiter() => ExecuteAsync().GetAwaiter();

    /// <summary>
    /// Executes the call and returns the result.
    /// </summary>
    public async Task<T> ExecuteAsync(CancellationToken cancellationToken = default)
    {
        return await _client.ExecuteAsync<T>(_method, _args, _selectExpression, cancellationToken);
    }

    /// <summary>
    /// Implicit conversion to Task for await support.
    /// </summary>
    public static implicit operator Task<T>(DotDoPromise<T> promise) => promise.ExecuteAsync();
}

// ============================================================================
// Type Aliases for SelectExpression and PipelineStep (from DotDo.Rpc)
// ============================================================================

// Note: These are internal copies to avoid making RpcClient's internal types public
internal record SelectExpression(string Expression, List<PipelineStep> InnerPipeline, List<string> Captures);
internal record PipelineStep(string Method, List<object?> Args);
