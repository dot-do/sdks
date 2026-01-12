using System.Net.Http.Headers;
using System.Text.Json;

namespace OAuthDo;

/// <summary>
/// Device flow authorization for OAuth.
/// Implements the device authorization grant flow.
/// </summary>
public class DeviceFlow : IDisposable
{
    private const string AuthUrl = "https://auth.apis.do/user_management/authorize_device";
    private const string TokenUrl = "https://auth.apis.do/user_management/authenticate";
    public const string DefaultClientId = "client_01JQYTRXK9ZPD8JPJTKDCRB656";

    private readonly string _clientId;
    private readonly HttpClient _httpClient;
    private bool _disposed;

    /// <summary>
    /// Creates a DeviceFlow with the default client ID.
    /// </summary>
    public DeviceFlow() : this(DefaultClientId) { }

    /// <summary>
    /// Creates a DeviceFlow with a custom client ID.
    /// </summary>
    /// <param name="clientId">OAuth client ID</param>
    public DeviceFlow(string clientId)
    {
        _clientId = clientId;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    /// <summary>
    /// Initiates device authorization.
    /// </summary>
    /// <returns>Device authorization response</returns>
    public async Task<DeviceAuthResponse> AuthorizeAsync()
    {
        var content = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("client_id", _clientId)
        });

        var response = await _httpClient.PostAsync(AuthUrl, content);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new DeviceFlowException($"Authorization failed: {body}");
        }

        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        return new DeviceAuthResponse
        {
            DeviceCode = root.GetProperty("device_code").GetString() ?? "",
            UserCode = root.GetProperty("user_code").GetString() ?? "",
            VerificationUri = root.GetProperty("verification_uri").GetString() ?? "",
            VerificationUriComplete = root.TryGetProperty("verification_uri_complete", out var complete)
                ? complete.GetString()
                : null,
            ExpiresIn = root.TryGetProperty("expires_in", out var expires)
                ? expires.GetInt32()
                : 900,
            Interval = root.TryGetProperty("interval", out var interval)
                ? interval.GetInt32()
                : 5
        };
    }

    /// <summary>
    /// Polls for token after user authorization.
    /// </summary>
    /// <param name="deviceCode">Device code from authorization response</param>
    /// <param name="interval">Polling interval in seconds</param>
    /// <param name="timeout">Maximum time to wait in seconds</param>
    /// <param name="onPoll">Callback for each poll attempt (optional)</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Token response</returns>
    public async Task<TokenResponse> PollForTokenAsync(
        string deviceCode,
        int interval = 5,
        int timeout = 900,
        Action<int>? onPoll = null,
        CancellationToken cancellationToken = default)
    {
        var startTime = DateTime.UtcNow;
        var pollInterval = interval;
        var attempts = 0;

        while ((DateTime.UtcNow - startTime).TotalSeconds < timeout)
        {
            cancellationToken.ThrowIfCancellationRequested();

            attempts++;
            onPoll?.Invoke(attempts);

            var content = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("client_id", _clientId),
                new KeyValuePair<string, string>("device_code", deviceCode),
                new KeyValuePair<string, string>("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
            });

            var response = await _httpClient.PostAsync(TokenUrl, content, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;

            if (root.TryGetProperty("error", out var errorProp))
            {
                var error = errorProp.GetString();
                var errorDescription = root.TryGetProperty("error_description", out var descProp)
                    ? descProp.GetString()
                    : null;

                if (error == "slow_down")
                {
                    pollInterval += 5;
                }

                if (error != "authorization_pending" && error != "slow_down")
                {
                    return new TokenResponse
                    {
                        Error = error,
                        ErrorDescription = errorDescription
                    };
                }
            }
            else
            {
                return new TokenResponse
                {
                    AccessToken = root.GetProperty("access_token").GetString(),
                    RefreshToken = root.TryGetProperty("refresh_token", out var refreshProp)
                        ? refreshProp.GetString()
                        : null,
                    TokenType = root.TryGetProperty("token_type", out var typeProp)
                        ? typeProp.GetString() ?? "Bearer"
                        : "Bearer",
                    ExpiresIn = root.TryGetProperty("expires_in", out var expiresProp)
                        ? expiresProp.GetInt32()
                        : 3600
                };
            }

            await Task.Delay(TimeSpan.FromSeconds(pollInterval), cancellationToken);
        }

        throw new TimeoutException($"Authorization timed out after {timeout} seconds");
    }

    /// <summary>
    /// Gets the client ID.
    /// </summary>
    /// <returns>OAuth client ID</returns>
    public string GetClientId() => _clientId;

    public void Dispose()
    {
        if (!_disposed)
        {
            _httpClient.Dispose();
            _disposed = true;
        }
    }
}

/// <summary>
/// Device authorization response.
/// </summary>
public class DeviceAuthResponse
{
    public string DeviceCode { get; set; } = string.Empty;
    public string UserCode { get; set; } = string.Empty;
    public string VerificationUri { get; set; } = string.Empty;
    public string? VerificationUriComplete { get; set; }
    public int ExpiresIn { get; set; } = 900;
    public int Interval { get; set; } = 5;

    public override string ToString() =>
        $"Visit {VerificationUri} and enter code: {UserCode}";
}

/// <summary>
/// Token response from authentication.
/// </summary>
public class TokenResponse
{
    public string? AccessToken { get; set; }
    public string? RefreshToken { get; set; }
    public string TokenType { get; set; } = "Bearer";
    public int ExpiresIn { get; set; } = 3600;
    public string? Error { get; set; }
    public string? ErrorDescription { get; set; }

    public bool IsError => Error is not null;
    public bool IsPending => Error is "authorization_pending" or "slow_down";
}

/// <summary>
/// Device flow exception.
/// </summary>
public class DeviceFlowException : Exception
{
    public DeviceFlowException(string message) : base(message) { }
}
