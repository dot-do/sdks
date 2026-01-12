using System.Net.WebSockets;
using Rpc.Do;

namespace {{Name}}.Do;

/// <summary>
/// Configuration options for {{Name}}Client
/// </summary>
public class {{Name}}ClientOptions
{
    /// <summary>
    /// API key for authentication
    /// </summary>
    public string? ApiKey { get; init; }

    /// <summary>
    /// Base URL for the service (defaults to https://{{name}}.do)
    /// </summary>
    public string BaseUrl { get; init; } = "https://{{name}}.do";

    /// <summary>
    /// Connection timeout
    /// </summary>
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
}

/// <summary>
/// {{Name}}.do client for interacting with the {{name}} service
/// </summary>
/// <example>
/// <code>
/// await using var client = new {{Name}}Client(new {{Name}}ClientOptions
/// {
///     ApiKey = Environment.GetEnvironmentVariable("DOTDO_KEY")
/// });
///
/// await client.ConnectAsync();
/// // Use the client...
/// </code>
/// </example>
public class {{Name}}Client : IAsyncDisposable
{
    private readonly {{Name}}ClientOptions _options;
    private RpcClient? _rpc;

    /// <summary>
    /// Creates a new {{Name}}Client with the given options
    /// </summary>
    public {{Name}}Client({{Name}}ClientOptions? options = null)
    {
        _options = options ?? new {{Name}}ClientOptions();
    }

    /// <summary>
    /// Creates a new {{Name}}Client with an API key
    /// </summary>
    public {{Name}}Client(string apiKey) : this(new {{Name}}ClientOptions { ApiKey = apiKey })
    {
    }

    /// <summary>
    /// Whether the client is currently connected
    /// </summary>
    public bool IsConnected => _rpc != null;

    /// <summary>
    /// Connect to the {{name}}.do service
    /// </summary>
    public async Task<RpcClient> ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_rpc == null)
        {
            var headers = new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(_options.ApiKey))
            {
                headers["Authorization"] = $"Bearer {_options.ApiKey}";
            }

            _rpc = await RpcClient.ConnectAsync(
                _options.BaseUrl,
                headers: headers.Count > 0 ? headers : null,
                cancellationToken: cancellationToken
            );
        }
        return _rpc;
    }

    /// <summary>
    /// Disconnect from the service
    /// </summary>
    public async Task DisconnectAsync()
    {
        if (_rpc != null)
        {
            await _rpc.CloseAsync();
            _rpc = null;
        }
    }

    /// <summary>
    /// Get the underlying RPC client (must be connected first)
    /// </summary>
    public RpcClient Rpc => _rpc ?? throw new InvalidOperationException(
        "{{Name}}Client is not connected. Call ConnectAsync() first."
    );

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}
