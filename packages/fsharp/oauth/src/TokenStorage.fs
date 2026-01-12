namespace OAuthDo

open System
open System.IO
open System.Text.Json
open System.Text.Json.Serialization

/// Token data structure for serialization.
[<CLIMutable>]
type TokenData = {
    [<JsonPropertyName("accessToken")>]
    AccessToken: string
    [<JsonPropertyName("refreshToken")>]
    RefreshToken: string option
    [<JsonPropertyName("tokenType")>]
    TokenType: string
    [<JsonPropertyName("expiresAt")>]
    ExpiresAt: int64
}

module TokenData =
    /// Checks if the token is expired.
    let isExpired (data: TokenData) =
        DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= data.ExpiresAt

    /// Creates a new TokenData instance.
    let create accessToken refreshToken tokenType expiresAt =
        { AccessToken = accessToken
          RefreshToken = refreshToken
          TokenType = tokenType
          ExpiresAt = expiresAt }

/// File-based token storage for OAuth tokens.
/// Stores tokens in ~/.oauth.do/token
type TokenStorage(?tokenPath: string) =
    let defaultTokenDir = ".oauth.do"
    let defaultTokenFile = "token"

    let path =
        match tokenPath with
        | Some p -> p
        | None ->
            let homeDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            Path.Combine(homeDir, defaultTokenDir, defaultTokenFile)

    let jsonOptions =
        JsonSerializerOptions(
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        )

    /// Gets the token file path.
    member _.TokenPath = path

    /// Saves token data to disk.
    member _.SaveAsync(data: TokenData) = async {
        let directory = Path.GetDirectoryName(path)
        if not (String.IsNullOrEmpty(directory)) && not (Directory.Exists(directory)) then
            Directory.CreateDirectory(directory) |> ignore

        let json = JsonSerializer.Serialize(data, jsonOptions)
        do! File.WriteAllTextAsync(path, json) |> Async.AwaitTask

        // Set restrictive permissions on Unix systems
        if not (OperatingSystem.IsWindows()) then
            File.SetUnixFileMode(path, UnixFileMode.UserRead ||| UnixFileMode.UserWrite)
    }

    /// Loads token data from disk.
    member _.LoadAsync() = async {
        if not (File.Exists(path)) then
            return None
        else
            try
                let! json = File.ReadAllTextAsync(path) |> Async.AwaitTask
                let data = JsonSerializer.Deserialize<TokenData>(json, jsonOptions)
                return Some data
            with _ ->
                return None
    }

    /// Deletes stored token data.
    member _.Delete() =
        try
            if File.Exists(path) then
                File.Delete(path)
                true
            else
                false
        with _ ->
            false

    /// Checks if a valid (non-expired) token exists.
    member this.HasValidTokenAsync() = async {
        let! data = this.LoadAsync()
        return
            match data with
            | Some d -> not (TokenData.isExpired d)
            | None -> false
    }
