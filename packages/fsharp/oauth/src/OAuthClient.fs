namespace OAuthDo

open System
open System.Net.Http
open System.Net.Http.Headers
open System.Text.Json
open System.Threading

/// User information response.
type UserInfo = {
    Id: string option
    Email: string option
    Name: string option
    Picture: string option
}

module UserInfo =
    /// Creates a string representation of the user info.
    let toString (info: UserInfo) =
        sprintf "User(id='%s', email='%s', name='%s')"
            (info.Id |> Option.defaultValue "")
            (info.Email |> Option.defaultValue "")
            (info.Name |> Option.defaultValue "")

/// OAuth exception.
exception OAuthException of string

/// OAuth client for .do platform authentication.
/// Provides device flow authentication and token management.
type OAuthClient(?deviceFlow: DeviceFlow, ?tokenStorage: TokenStorage) =
    let userInfoUrl = "https://apis.do/me"

    let deviceFlow = defaultArg deviceFlow (new DeviceFlow())
    let tokenStorage = defaultArg tokenStorage (TokenStorage())
    let httpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(30.0))

    /// Creates an OAuthClient with a custom client ID.
    new(clientId: string) = new OAuthClient(new DeviceFlow(clientId), TokenStorage())

    /// Gets the device flow handler.
    member _.DeviceFlow = deviceFlow

    /// Gets the token storage handler.
    member _.TokenStorage = tokenStorage

    /// Performs device flow login.
    member _.LoginAsync(onPrompt: DeviceAuthResponse -> unit, ?onPoll: int -> unit, ?cancellationToken: CancellationToken) = async {
        let cancellationToken = defaultArg cancellationToken CancellationToken.None

        // Initiate device authorization
        let! auth = deviceFlow.AuthorizeAsync()

        // Show prompt to user
        onPrompt auth

        // Poll for token
        let! token = deviceFlow.PollForTokenAsync(
            auth.DeviceCode,
            auth.Interval,
            auth.ExpiresIn,
            ?onPoll = onPoll,
            cancellationToken = cancellationToken
        )

        if TokenResponse.isError token then
            let message =
                match token.Error, token.ErrorDescription with
                | Some e, Some d -> sprintf "Authentication failed: %s - %s" e d
                | Some e, None -> sprintf "Authentication failed: %s" e
                | _ -> "Authentication failed"
            raise (OAuthException message)

        match token.AccessToken with
        | None -> raise (OAuthException "No access token received")
        | Some accessToken ->
            // Save token
            let expiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + int64 token.ExpiresIn
            let tokenData = TokenData.create accessToken token.RefreshToken token.TokenType expiresAt
            do! tokenStorage.SaveAsync(tokenData)
            return tokenData
    }

    /// Logs out by deleting stored tokens.
    member _.Logout() = tokenStorage.Delete()

    /// Gets the current access token if valid.
    member _.GetAccessTokenAsync() = async {
        let! data = tokenStorage.LoadAsync()
        return
            match data with
            | Some d when not (TokenData.isExpired d) -> Some d.AccessToken
            | _ -> None
    }

    /// Checks if user is authenticated with a valid token.
    member _.IsAuthenticatedAsync() = tokenStorage.HasValidTokenAsync()

    /// Gets user information for the authenticated user.
    member this.GetUserInfoAsync() = async {
        let! accessToken = this.GetAccessTokenAsync()

        match accessToken with
        | None -> return raise (OAuthException "Not authenticated")
        | Some token ->
            let request = new HttpRequestMessage(HttpMethod.Get, userInfoUrl)
            request.Headers.Authorization <- AuthenticationHeaderValue("Bearer", token)

            let! response = httpClient.SendAsync(request) |> Async.AwaitTask
            let! body = response.Content.ReadAsStringAsync() |> Async.AwaitTask

            if not response.IsSuccessStatusCode then
                return raise (OAuthException(sprintf "Failed to get user info: %s" body))

            use json = JsonDocument.Parse(body)
            let root = json.RootElement

            // Handle nested user object if present
            let userData =
                match root.TryGetProperty("user") with
                | true, userProp -> userProp
                | false, _ -> root

            let getOptionalString (name: string) (element: JsonElement) =
                match element.TryGetProperty(name) with
                | true, prop -> prop.GetString() |> Option.ofObj
                | false, _ -> None

            return {
                Id = getOptionalString "id" userData
                Email = getOptionalString "email" userData
                Name = getOptionalString "name" userData
                Picture = getOptionalString "picture" userData
            }
    }

    interface IDisposable with
        member _.Dispose() =
            httpClient.Dispose()
            (deviceFlow :> IDisposable).Dispose()
