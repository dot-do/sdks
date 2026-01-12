// ============================================================================
// Cap'n Web SDK for .NET
// Zero-cost capability-based RPC with LINQ-style pipelining
// ============================================================================
//
// Usage:
//   var session = await CapnWeb.Connect("wss://api.example.com");
//   var user = await session.Api.Users().Get(42).Profile().Name;
//
// With LINQ Select() for server-side mapping (eliminates N+1):
//   var squares = await session.Api.GenerateFibonacci(10)
//       .Select(x => session.Api.Square(x));
//
// ============================================================================

using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CapnWeb;

// ============================================================================
// Error Types
// ============================================================================

/// <summary>
/// Base exception for all Cap'n Web RPC errors.
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
/// Thrown when an argument is invalid.
/// </summary>
public class InvalidArgumentException : RpcException
{
    public InvalidArgumentException(string message) : base(message, "InvalidArgument", 400) { }
}

/// <summary>
/// Thrown when a request times out.
/// </summary>
public class TimeoutException : RpcException
{
    public TimeoutException(string message = "Request timed out") : base(message, "Timeout", 408) { }
}

/// <summary>
/// Thrown when the SDK operation is not yet implemented.
/// </summary>
public class NotImplementedException : RpcException
{
    public NotImplementedException(string message) : base(message, "NotImplemented") { }
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
/// var promise = api.Users().Get(42).Profile().Name;
///
/// // Execute pipeline - one round trip
/// string name = await promise;
/// </code>
/// </example>
/// </summary>
/// <typeparam name="T">The expected result type</typeparam>
public class RpcPromise<T>
{
    private readonly Session _session;
    private readonly List<PipelineStep> _pipeline;
    private readonly MapExpression? _mapExpression;

    internal RpcPromise(Session session, List<PipelineStep> pipeline, MapExpression? mapExpression = null)
    {
        _session = session;
        _pipeline = pipeline;
        _mapExpression = mapExpression;
    }

    internal RpcPromise(Session session, string method, params object?[] args)
        : this(session, [new PipelineStep(method, args.ToList())])
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
            if (_mapExpression != null)
            {
                expr += $".Select({_mapExpression.Expression})";
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
    /// This is the KEY feature of Cap'n Web - it executes the mapping on the
    /// server in a single round-trip, eliminating N+1 query problems.
    /// </para>
    ///
    /// <example>
    /// <code>
    /// // C# LINQ style - single round trip!
    /// var squares = await api.GenerateFibonacci(10)
    ///     .Select(x => api.Square(x));
    /// </code>
    /// </example>
    /// </summary>
    /// <typeparam name="TResult">The result type of the mapping</typeparam>
    /// <param name="selector">The mapping function (executed server-side)</param>
    /// <returns>A new promise for the mapped result</returns>
    public RpcPromise<TResult[]> Select<TResult>(Func<RpcPromise<T>, RpcPromise<TResult>> selector)
    {
        // Create a placeholder promise representing 'x' in the lambda
        var placeholder = new RpcPromise<T>(_session, [new PipelineStep("$element", [])]);

        // Invoke the selector to capture the expression tree
        var resultPromise = selector(placeholder);

        // Extract the expression from the result promise
        var mapExpr = new MapExpression(
            expression: $"x => {resultPromise.ExpressionString}",
            innerPipeline: resultPromise._pipeline.Skip(1).ToList(), // Skip the $element placeholder
            captures: ["$self"]
        );

        return new RpcPromise<TResult[]>(_session, _pipeline, mapExpr);
    }

    /// <summary>
    /// Maps each element using a simple transformation function.
    /// </summary>
    public RpcPromise<TResult[]> Select<TResult>(Func<T, TResult> selector)
    {
        // For simple lambda expressions, we serialize them as expressions
        var mapExpr = new MapExpression(
            expression: "x => transform(x)",
            innerPipeline: [],
            captures: []
        );
        return new RpcPromise<TResult[]>(_session, _pipeline, mapExpr);
    }

    // ========================================================================
    // Pipelining - extend the call chain
    // ========================================================================

    /// <summary>
    /// Extends the pipeline with another method call.
    /// </summary>
    public RpcPromise<TResult> Call<TResult>(string method, params object?[] args)
    {
        var newPipeline = new List<PipelineStep>(_pipeline)
        {
            new(method, args.ToList())
        };
        return new RpcPromise<TResult>(_session, newPipeline);
    }

    /// <summary>
    /// Access a property on the result (creates a pipeline step).
    /// </summary>
    public RpcPromise<TResult> Property<TResult>(string propertyName)
    {
        return Call<TResult>(propertyName);
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
        // Stub implementation - returns NotImplemented
        // Real implementation would send pipeline to server via WebSocket
        throw new NotImplementedException(
            $"Pipeline execution not yet implemented. Expression: {ExpressionString}"
        );
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
/// Represents a map/remap expression for server-side collection transformation.
/// </summary>
/// <param name="Expression">The lambda expression string</param>
/// <param name="InnerPipeline">The pipeline steps inside the map</param>
/// <param name="Captures">Variables captured from outer scope (e.g., $self)</param>
internal record MapExpression(string Expression, List<PipelineStep> InnerPipeline, List<string> Captures);

// ============================================================================
// Session - Connection to a Cap'n Web server
// ============================================================================

/// <summary>
/// A session connected to a Cap'n Web server.
/// </summary>
public class Session : IAsyncDisposable
{
    private readonly string _url;
    private ClientWebSocket? _webSocket;
    private bool _isConnected;

    internal Session(string url)
    {
        _url = url;
        _isConnected = false;
    }

    /// <summary>
    /// Gets the URL of this session.
    /// </summary>
    public string Url => _url;

    /// <summary>
    /// Gets whether the session is connected.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Gets the dynamic API for making RPC calls.
    /// </summary>
    public DynamicApi Api => new(this);

    /// <summary>
    /// Connects to the server.
    /// </summary>
    internal async Task ConnectAsync(CancellationToken cancellationToken = default)
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
        }
        catch (Exception ex)
        {
            throw new RpcException($"Failed to connect to {wsUrl}: {ex.Message}", "ConnectionFailed");
        }
    }

    /// <summary>
    /// Closes the session.
    /// </summary>
    public async Task CloseAsync(CancellationToken cancellationToken = default)
    {
        if (_webSocket is { State: WebSocketState.Open })
        {
            await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Session closed", cancellationToken);
        }
        _isConnected = false;
    }

    /// <summary>
    /// Disposes the session.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        _webSocket?.Dispose();
        GC.SuppressFinalize(this);
    }

    // ========================================================================
    // Dynamic method invocation (for conformance testing)
    // ========================================================================

    /// <summary>
    /// Calls a method dynamically (for conformance testing).
    /// </summary>
    public async Task<JsonNode?> CallMethodAsync(string method, List<JsonNode?> args, CancellationToken cancellationToken = default)
    {
        // Stub implementation
        throw new NotImplementedException($"Method call not implemented: {method}({string.Join(", ", args)})");
    }

    /// <summary>
    /// Executes a pipeline dynamically (for conformance testing).
    /// </summary>
    public async Task<JsonNode?> CallPipelineAsync(List<DynamicPipelineStep> steps, CancellationToken cancellationToken = default)
    {
        // Stub implementation
        var expr = string.Join(".", steps.Select(s => $"{s.Call}({string.Join(", ", s.Args)})"));
        throw new NotImplementedException($"Pipeline not implemented: {expr}");
    }

    /// <summary>
    /// Calls a method with a map expression (for conformance testing).
    /// </summary>
    public async Task<JsonNode?> CallWithMapAsync(
        string method,
        List<JsonNode?> args,
        DynamicMapExpression? map,
        CancellationToken cancellationToken = default)
    {
        // Stub implementation
        var expr = $"{method}({string.Join(", ", args)})";
        if (map != null)
        {
            expr += $".Select({map.Expression})";
        }
        throw new NotImplementedException($"Map call not implemented: {expr}");
    }
}

/// <summary>
/// A dynamic pipeline step for conformance testing.
/// </summary>
/// <param name="Call">The method to call</param>
/// <param name="Args">Arguments to pass</param>
/// <param name="Alias">Optional alias for the result</param>
public record DynamicPipelineStep(string Call, List<JsonNode?> Args, string? Alias = null);

/// <summary>
/// A dynamic map expression for conformance testing.
/// </summary>
/// <param name="Expression">The lambda expression string</param>
/// <param name="Captures">Variables captured from outer scope</param>
public record DynamicMapExpression(string Expression, List<string> Captures);

// ============================================================================
// Dynamic API - Untyped access to RPC methods
// ============================================================================

/// <summary>
/// Dynamic API for making untyped RPC calls.
/// </summary>
public class DynamicApi
{
    private readonly Session _session;

    internal DynamicApi(Session session)
    {
        _session = session;
    }

    /// <summary>
    /// Creates a promise for a method call.
    /// </summary>
    public RpcPromise<T> Call<T>(string method, params object?[] args)
    {
        return new RpcPromise<T>(_session, method, args);
    }

    /// <summary>
    /// Creates a promise for Square(n).
    /// </summary>
    public RpcPromise<int> Square(int n) => Call<int>("square", n);

    /// <summary>
    /// Creates a promise for Square(n) with dynamic argument.
    /// </summary>
    public RpcPromise<int> Square(RpcPromise<int> n) => Call<int>("square", n);

    /// <summary>
    /// Creates a promise for ReturnNumber(n).
    /// </summary>
    public RpcPromise<double> ReturnNumber(double n) => Call<double>("returnNumber", n);

    /// <summary>
    /// Creates a promise for ReturnNull().
    /// </summary>
    public RpcPromise<object?> ReturnNull() => Call<object?>("returnNull");

    /// <summary>
    /// Creates a promise for ReturnUndefined().
    /// </summary>
    public RpcPromise<object?> ReturnUndefined() => Call<object?>("returnUndefined");

    /// <summary>
    /// Creates a promise for GenerateFibonacci(count).
    /// </summary>
    public RpcPromise<int[]> GenerateFibonacci(int count) => Call<int[]>("generateFibonacci", count);

    /// <summary>
    /// Creates a promise for MakeCounter(initial).
    /// </summary>
    public RpcPromise<Counter> MakeCounter(int initial) => Call<Counter>("makeCounter", initial);

    /// <summary>
    /// Creates a promise for ThrowError().
    /// </summary>
    public RpcPromise<object> ThrowError() => Call<object>("throwError");
}

/// <summary>
/// Represents a Counter capability.
/// </summary>
public class Counter
{
    private readonly Session _session;
    private readonly List<PipelineStep> _pipeline;

    internal Counter(Session session, List<PipelineStep> pipeline)
    {
        _session = session;
        _pipeline = pipeline;
    }

    /// <summary>
    /// Gets the current value of the counter.
    /// </summary>
    public RpcPromise<int> Value()
    {
        var newPipeline = new List<PipelineStep>(_pipeline)
        {
            new("value", [])
        };
        return new RpcPromise<int>(_session, newPipeline);
    }

    /// <summary>
    /// Increments the counter by the specified amount.
    /// </summary>
    public RpcPromise<int> Increment(int amount)
    {
        var newPipeline = new List<PipelineStep>(_pipeline)
        {
            new("increment", [amount])
        };
        return new RpcPromise<int>(_session, newPipeline);
    }
}

// ============================================================================
// Static Entry Point
// ============================================================================

/// <summary>
/// Static entry point for connecting to Cap'n Web servers.
/// </summary>
public static class CapnWebClient
{
    /// <summary>
    /// Connects to a Cap'n Web server.
    /// </summary>
    /// <param name="url">The URL to connect to (HTTP or WebSocket)</param>
    /// <param name="cancellationToken">Optional cancellation token</param>
    /// <returns>A connected session</returns>
    /// <example>
    /// <code>
    /// await using var session = await CapnWebClient.Connect("wss://api.example.com");
    /// var result = await session.Api.Square(5);
    /// </code>
    /// </example>
    public static async Task<Session> Connect(string url, CancellationToken cancellationToken = default)
    {
        var session = new Session(url);
        await session.ConnectAsync(cancellationToken);
        return session;
    }

    /// <summary>
    /// Gets whether the SDK is fully implemented.
    /// </summary>
    public static bool IsImplemented => false;

    /// <summary>
    /// Gets the SDK version.
    /// </summary>
    public static string Version => "0.1.0";
}
