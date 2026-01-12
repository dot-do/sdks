using System.Text.Json;
using System.Text.Json.Serialization;

namespace OAuthDo;

/// <summary>
/// File-based token storage for OAuth tokens.
/// Stores tokens in ~/.oauth.do/token
/// </summary>
public class TokenStorage
{
    private const string DefaultTokenDir = ".oauth.do";
    private const string DefaultTokenFile = "token";

    private readonly string _tokenPath;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    /// <summary>
    /// Creates a TokenStorage with default path (~/.oauth.do/token).
    /// </summary>
    public TokenStorage()
    {
        var homeDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        _tokenPath = Path.Combine(homeDir, DefaultTokenDir, DefaultTokenFile);
    }

    /// <summary>
    /// Creates a TokenStorage with a custom path.
    /// </summary>
    /// <param name="tokenPath">Path to the token file</param>
    public TokenStorage(string tokenPath)
    {
        _tokenPath = tokenPath;
    }

    /// <summary>
    /// Saves token data to disk.
    /// </summary>
    /// <param name="data">Token data to save</param>
    public async Task SaveAsync(TokenData data)
    {
        var directory = Path.GetDirectoryName(_tokenPath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var json = JsonSerializer.Serialize(data, JsonOptions);
        await File.WriteAllTextAsync(_tokenPath, json);

        // Set restrictive permissions on Unix systems
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(_tokenPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    /// <summary>
    /// Loads token data from disk.
    /// </summary>
    /// <returns>Token data, or null if not found</returns>
    public async Task<TokenData?> LoadAsync()
    {
        if (!File.Exists(_tokenPath))
        {
            return null;
        }

        try
        {
            var json = await File.ReadAllTextAsync(_tokenPath);
            return JsonSerializer.Deserialize<TokenData>(json, JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Deletes stored token data.
    /// </summary>
    /// <returns>true if deletion was successful</returns>
    public bool Delete()
    {
        try
        {
            if (File.Exists(_tokenPath))
            {
                File.Delete(_tokenPath);
                return true;
            }
            return false;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Checks if a valid (non-expired) token exists.
    /// </summary>
    /// <returns>true if a valid token is stored</returns>
    public async Task<bool> HasValidTokenAsync()
    {
        var data = await LoadAsync();
        return data is not null && !data.IsExpired;
    }

    /// <summary>
    /// Gets the token file path.
    /// </summary>
    /// <returns>Path to the token file</returns>
    public string GetTokenPath() => _tokenPath;
}

/// <summary>
/// Token data structure for serialization.
/// </summary>
public class TokenData
{
    [JsonPropertyName("accessToken")]
    public string AccessToken { get; set; } = string.Empty;

    [JsonPropertyName("refreshToken")]
    public string? RefreshToken { get; set; }

    [JsonPropertyName("tokenType")]
    public string TokenType { get; set; } = "Bearer";

    [JsonPropertyName("expiresAt")]
    public long ExpiresAt { get; set; }

    /// <summary>
    /// Checks if the token is expired.
    /// </summary>
    [JsonIgnore]
    public bool IsExpired => DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= ExpiresAt;
}
