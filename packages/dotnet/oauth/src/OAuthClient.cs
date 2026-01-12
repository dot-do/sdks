using System.Net.Http.Headers;
using System.Text.Json;

namespace OAuthDo;

/// <summary>
/// OAuth client for .do platform authentication.
/// Provides device flow authentication and token management.
/// </summary>
public class OAuthClient : IDisposable
{
    private const string UserInfoUrl = "https://apis.do/me";

    private readonly DeviceFlow _deviceFlow;
    private readonly TokenStorage _tokenStorage;
    private readonly HttpClient _httpClient;
    private bool _disposed;

    /// <summary>
    /// Creates an OAuthClient with default configuration.
    /// </summary>
    public OAuthClient() : this(new DeviceFlow(), new TokenStorage()) { }

    /// <summary>
    /// Creates an OAuthClient with a custom client ID.
    /// </summary>
    /// <param name="clientId">OAuth client ID</param>
    public OAuthClient(string clientId) : this(new DeviceFlow(clientId), new TokenStorage()) { }

    /// <summary>
    /// Creates an OAuthClient with custom components.
    /// </summary>
    /// <param name="deviceFlow">Device flow handler</param>
    /// <param name="tokenStorage">Token storage handler</param>
    public OAuthClient(DeviceFlow deviceFlow, TokenStorage tokenStorage)
    {
        _deviceFlow = deviceFlow;
        _tokenStorage = tokenStorage;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
    }

    /// <summary>
    /// Performs device flow login.
    /// </summary>
    /// <param name="onPrompt">Callback to display authorization URL and code to user</param>
    /// <param name="onPoll">Callback for each poll attempt (optional)</param>
    /// <param name="cancellationToken">Cancellation token</param>
    /// <returns>Token data after successful authentication</returns>
    public async Task<TokenData> LoginAsync(
        Action<DeviceAuthResponse> onPrompt,
        Action<int>? onPoll = null,
        CancellationToken cancellationToken = default)
    {
        // Initiate device authorization
        var auth = await _deviceFlow.AuthorizeAsync();

        // Show prompt to user
        onPrompt(auth);

        // Poll for token
        var token = await _deviceFlow.PollForTokenAsync(
            auth.DeviceCode,
            auth.Interval,
            auth.ExpiresIn,
            onPoll,
            cancellationToken
        );

        if (token.IsError)
        {
            var message = $"Authentication failed: {token.Error}";
            if (token.ErrorDescription is not null)
            {
                message += $" - {token.ErrorDescription}";
            }
            throw new OAuthException(message);
        }

        if (token.AccessToken is null)
        {
            throw new OAuthException("No access token received");
        }

        // Save token
        var expiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + token.ExpiresIn;
        var tokenData = new TokenData
        {
            AccessToken = token.AccessToken,
            RefreshToken = token.RefreshToken,
            TokenType = token.TokenType,
            ExpiresAt = expiresAt
        };
        await _tokenStorage.SaveAsync(tokenData);

        return tokenData;
    }

    /// <summary>
    /// Logs out by deleting stored tokens.
    /// </summary>
    /// <returns>true if logout was successful</returns>
    public bool Logout() => _tokenStorage.Delete();

    /// <summary>
    /// Gets the current access token if valid.
    /// </summary>
    /// <returns>Access token, or null if not authenticated</returns>
    public async Task<string?> GetAccessTokenAsync()
    {
        var data = await _tokenStorage.LoadAsync();
        if (data is not null && !data.IsExpired)
        {
            return data.AccessToken;
        }
        return null;
    }

    /// <summary>
    /// Checks if user is authenticated with a valid token.
    /// </summary>
    /// <returns>true if authenticated</returns>
    public Task<bool> IsAuthenticatedAsync() => _tokenStorage.HasValidTokenAsync();

    /// <summary>
    /// Gets user information for the authenticated user.
    /// </summary>
    /// <returns>User information</returns>
    public async Task<UserInfo> GetUserInfoAsync()
    {
        var accessToken = await GetAccessTokenAsync();
        if (accessToken is null)
        {
            throw new OAuthException("Not authenticated");
        }

        var request = new HttpRequestMessage(HttpMethod.Get, UserInfoUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var response = await _httpClient.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new OAuthException($"Failed to get user info: {body}");
        }

        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        // Handle nested user object if present
        var userData = root.TryGetProperty("user", out var userProp) ? userProp : root;

        return new UserInfo
        {
            Id = userData.TryGetProperty("id", out var idProp) ? idProp.GetString() : null,
            Email = userData.TryGetProperty("email", out var emailProp) ? emailProp.GetString() : null,
            Name = userData.TryGetProperty("name", out var nameProp) ? nameProp.GetString() : null,
            Picture = userData.TryGetProperty("picture", out var pictureProp) ? pictureProp.GetString() : null
        };
    }

    /// <summary>
    /// Gets the device flow handler.
    /// </summary>
    /// <returns>DeviceFlow instance</returns>
    public DeviceFlow GetDeviceFlow() => _deviceFlow;

    /// <summary>
    /// Gets the token storage handler.
    /// </summary>
    /// <returns>TokenStorage instance</returns>
    public TokenStorage GetTokenStorage() => _tokenStorage;

    public void Dispose()
    {
        if (!_disposed)
        {
            _httpClient.Dispose();
            _deviceFlow.Dispose();
            _disposed = true;
        }
    }
}

/// <summary>
/// User information response.
/// </summary>
public class UserInfo
{
    public string? Id { get; set; }
    public string? Email { get; set; }
    public string? Name { get; set; }
    public string? Picture { get; set; }

    public override string ToString() =>
        $"User(id='{Id}', email='{Email}', name='{Name}')";
}

/// <summary>
/// OAuth exception.
/// </summary>
public class OAuthException : Exception
{
    public OAuthException(string message) : base(message) { }
}
