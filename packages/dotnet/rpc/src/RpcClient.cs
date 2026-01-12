// ============================================================================
// DotDo RPC Client for .NET
// LINQ-style pipelining with Select() for server-side mapping
// ============================================================================
//
// Usage:
//   var client = new RpcClient("wss://api.example.com");
//   await client.ConnectAsync();
//   var result = await client.Call<int>("square", 5);
//
// With LINQ Select() for server-side mapping (eliminates N+1):
//   var squares = await client.Call<int[]>("generateFibonacci", 10)
//       .Select(x => client.Call<int>("square", x));
//
// ============================================================================

using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace DotDo.Rpc;

// ============================================================================
// Error Types
// ============================================================================

/// <summary>
/// Base exception for all RPC errors.
/// </summary>
public class RpcException : Exception
{
    public string ErrorType { get; }
    public int? ErrorCode { get; }

    public RpcException(string message, string errorType = "Error", int? errorCode = null)
        : base(message)
    {
        ErrorType = errorType;
        ErrorCode = errorCode;
    }
}

/// <summary>
/// Thrown when a resource is not found.
/// </summary>
public class NotFoundException : RpcException
{
    public NotFoundException(string message) : base(message, "NotFound", 404) { }
}

/// <summary>
/// Thrown when authentication fails.
/// </summary>
public class UnauthorizedException : RpcException
{
    public UnauthorizedException(string message = "Unauthorized") : base(message, "Unauthorized", 401) { }
}

/// <summary>
/// Thrown when access is forbidden.
/// </summary>
public class ForbiddenException : RpcException
{
    public ForbiddenException(string message) : base(message, "Forbidden", 403) { }
}

/// <summary>
/// Thrown when a request times out.
/// </summary>
public class RpcTimeoutException : RpcException
{
    public RpcTimeoutException(string message = "Request timed out") : base(message, "Timeout", 408) { }
}

// ============================================================================
// RPC Promise - The core abstraction for lazy, pipelined RPC calls
// ============================================================================

/// <summary>
/// A lazy RPC result that supports pipelining and LINQ-style operations.
///
/// <para>
/// <c>RpcPromise&lt;T&gt;</c> allows building complex RPC pipelines without
/// immediately executing them. The pipeline is sent to the server in a
/// single round-trip when awaited.
/// </para>
///
/// <example>
/// <code>
/// // Build pipeline - no network calls yet
/// var promise = client.Call&lt;User&gt;("getUser", 42)
///     .Then(u => client.Call&lt;string&gt;("getProfileName", u.Id));
///
/// // Execute pipeline - one round trip
/// string name = await promise;
/// </code>
/// </example>
/// </summary>
/// <typeparam name="T">The expected result type</typeparam>
public class RpcPromise<T>
{
    private readonly RpcClient _client;
    private readonly List<PipelineStep> _pipeline;
    private readonly SelectExpression? _selectExpression;

    internal RpcPromise(RpcClient client, List<PipelineStep> pipeline, SelectExpression? selectExpression = null)
    {
        _client = client;
        _pipeline = pipeline;
        _selectExpression = selectExpression;
    }

    internal RpcPromise(RpcClient client, string method, params object?[] args)
        : this(client, [new PipelineStep(method, args.ToList())])
    {
    }

    /// <summary>
    /// Gets the pipeline expression as a string (for debugging/testing).
    /// </summary>
    public string ExpressionString
    {
        get
        {
            var steps = _pipeline.Select(step =>
            {
                var argsStr = string.Join(", ", step.Args.Select(FormatArg));
                return $"{step.Method}({argsStr})";
            });
            var expr = string.Join(".", steps);
            if (_selectExpression != null)
            {
                expr += $".Select({_selectExpression.Expression})";
            }
            return expr;
        }
    }

    private static string FormatArg(object? arg) => arg switch
    {
        null => "null",
        string s => $"\"{s}\"",
        _ => arg.ToString() ?? "null"
    };

    // ========================================================================
    // LINQ-style Select() for server-side mapping (KEY FEATURE!)
    // ========================================================================

    /// <summary>
    /// Maps each element using a server-side transformation.
    ///
    /// <para>
    /// This is the KEY feature of DotDo.Rpc - it executes the mapping on the
    /// server in a single round-trip, eliminating N+1 query problems.
    /// </para>
    ///
    /// <example>
    /// <code>
    /// // C# LINQ style - single round trip!
    /// var squares = await client.Call&lt;int[]&gt;("generateFibonacci", 10)
    ///     .Select(x => client.Call&lt;int&gt;("square", x));
    /// </code>
    /// </example>
    /// </summary>
    /// <typeparam name="TResult">The result type of the mapping</typeparam>
    /// <param name="selector">The mapping function (executed server-side)</param>
    /// <returns>A new promise for the mapped result</returns>
    public RpcPromise<TResult[]> Select<TResult>(Func<RpcPromise<T>, RpcPromise<TResult>> selector)
    {
        // Create a placeholder promise representing 'x' in the lambda
        var placeholder = new RpcPromise<T>(_client, [new PipelineStep("$element", [])]);

        // Invoke the selector to capture the expression tree
        var resultPromise = selector(placeholder);

        // Extract the expression from the result promise
        var selectExpr = new SelectExpression(
            Expression: $"x => {resultPromise.ExpressionString}",
            InnerPipeline: resultPromise._pipeline.Skip(1).ToList(),
            Captures: ["$self"]
        );

        return new RpcPromise<TResult[]>(_client, _pipeline, selectExpr);
    }

    /// <summary>
    /// Maps each element using a simple transformation function.
    /// </summary>
    public RpcPromise<TResult[]> Select<TResult>(Func<T, TResult> selector)
    {
        var selectExpr = new SelectExpression(
            Expression: "x => transform(x)",
            InnerPipeline: [],
            Captures: []
        );
        return new RpcPromise<TResult[]>(_client, _pipeline, selectExpr);
    }

    // ========================================================================
    // Pipelining - extend the call chain
    // ========================================================================

    /// <summary>
    /// Extends the pipeline with another method call.
    /// </summary>
    public RpcPromise<TResult> Then<TResult>(string method, params object?[] args)
    {
        var newPipeline = new List<PipelineStep>(_pipeline)
        {
            new(method, args.ToList())
        };
        return new RpcPromise<TResult>(_client, newPipeline);
    }

    /// <summary>
    /// Access a property on the result (creates a pipeline step).
    /// </summary>
    public RpcPromise<TResult> Property<TResult>(string propertyName)
    {
        return Then<TResult>(propertyName);
    }

    // ========================================================================
    // Awaiting - execute the pipeline
    // ========================================================================

    /// <summary>
    /// Gets an awaiter for async/await support.
    /// </summary>
    public TaskAwaiter<T> GetAwaiter() => ExecuteAsync().GetAwaiter();

    /// <summary>
    /// Executes the pipeline and returns the result.
    /// </summary>
    public async Task<T> ExecuteAsync(CancellationToken cancellationToken = default)
    {
        return await _client.ExecutePipelineAsync<T>(_pipeline, _selectExpression, cancellationToken);
    }

    /// <summary>
    /// Implicit conversion to Task for await support.
    /// </summary>
    public static implicit operator Task<T>(RpcPromise<T> promise) => promise.ExecuteAsync();
}

/// <summary>
/// A step in the RPC pipeline.
/// </summary>
/// <param name="Method">The method name to call</param>
/// <param name="Args">Arguments to pass to the method</param>
internal record PipelineStep(string Method, List<object?> Args);

/// <summary>
/// Represents a Select expression for server-side collection transformation.
/// </summary>
/// <param name="Expression">The lambda expression string</param>
/// <param name="InnerPipeline">The pipeline steps inside the Select</param>
/// <param name="Captures">Variables captured from outer scope</param>
internal record SelectExpression(string Expression, List<PipelineStep> InnerPipeline, List<string> Captures);

// ============================================================================
// RPC Client - Connection to a DotDo server
// ============================================================================

/// <summary>
/// RPC client for connecting to DotDo servers.
/// </summary>
public class RpcClient : IAsyncDisposable
{
    private readonly string _url;
    private ClientWebSocket? _webSocket;
    private bool _isConnected;
    private int _messageId;
    private readonly Dictionary<int, TaskCompletionSource<JsonNode?>> _pendingRequests = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private CancellationTokenSource? _receiveLoopCts;
    private Task? _receiveLoopTask;

    /// <summary>
    /// Creates a new RPC client.
    /// </summary>
    /// <param name="url">The URL to connect to (HTTP or WebSocket)</param>
    public RpcClient(string url)
    {
        _url = url;
        _isConnected = false;
    }

    /// <summary>
    /// Gets the URL of this client.
    /// </summary>
    public string Url => _url;

    /// <summary>
    /// Gets whether the client is connected.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Connects to the server.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        _webSocket = new ClientWebSocket();

        // Convert HTTP URL to WebSocket URL
        var wsUrl = _url
            .Replace("http://", "ws://")
            .Replace("https://", "wss://");

        try
        {
            await _webSocket.ConnectAsync(new Uri(wsUrl), cancellationToken);
            _isConnected = true;

            // Start receive loop
            _receiveLoopCts = new CancellationTokenSource();
            _receiveLoopTask = ReceiveLoopAsync(_receiveLoopCts.Token);
        }
        catch (Exception ex)
        {
            throw new RpcException($"Failed to connect to {wsUrl}: {ex.Message}", "ConnectionFailed");
        }
    }

    /// <summary>
    /// Creates a promise for an RPC call.
    /// </summary>
    public RpcPromise<T> Call<T>(string method, params object?[] args)
    {
        return new RpcPromise<T>(this, method, args);
    }

    /// <summary>
    /// Executes a pipeline and returns the result.
    /// </summary>
    internal async Task<T> ExecutePipelineAsync<T>(
        List<PipelineStep> pipeline,
        SelectExpression? selectExpression,
        CancellationToken cancellationToken = default)
    {
        if (!_isConnected || _webSocket == null)
        {
            throw new RpcException("Not connected to server", "NotConnected");
        }

        var messageId = Interlocked.Increment(ref _messageId);

        // Build the request
        var request = new JsonObject
        {
            ["id"] = messageId,
            ["pipeline"] = JsonSerializer.SerializeToNode(pipeline.Select(s => new
            {
                method = s.Method,
                args = s.Args
            }))
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

        var tcs = new TaskCompletionSource<JsonNode?>();
        _pendingRequests[messageId] = tcs;

        try
        {
            // Send request
            var json = request.ToJsonString();
            var bytes = Encoding.UTF8.GetBytes(json);

            await _sendLock.WaitAsync(cancellationToken);
            try
            {
                await _webSocket.SendAsync(
                    new ArraySegment<byte>(bytes),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken);
            }
            finally
            {
                _sendLock.Release();
            }

            // Wait for response
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(30));

            var result = await tcs.Task.WaitAsync(cts.Token);

            if (result == null)
            {
                return default!;
            }

            return result.Deserialize<T>()!;
        }
        catch (OperationCanceledException)
        {
            throw new RpcTimeoutException("Request timed out");
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
            while (!cancellationToken.IsCancellationRequested && _webSocket?.State == WebSocketState.Open)
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

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

    /// <summary>
    /// Closes the connection.
    /// </summary>
    public async Task CloseAsync(CancellationToken cancellationToken = default)
    {
        _receiveLoopCts?.Cancel();

        if (_webSocket is { State: WebSocketState.Open })
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client closed", cancellationToken);
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

        _isConnected = false;
    }

    /// <summary>
    /// Disposes the client.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        _webSocket?.Dispose();
        _receiveLoopCts?.Dispose();
        _sendLock.Dispose();
        GC.SuppressFinalize(this);
    }
}
