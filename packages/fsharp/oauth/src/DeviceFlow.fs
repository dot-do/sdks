namespace OAuthDo

open System
open System.Net.Http
open System.Text.Json
open System.Threading

/// Device authorization response.
type DeviceAuthResponse = {
    DeviceCode: string
    UserCode: string
    VerificationUri: string
    VerificationUriComplete: string option
    ExpiresIn: int
    Interval: int
}

module DeviceAuthResponse =
    /// Creates a string representation of the response.
    let toString (response: DeviceAuthResponse) =
        sprintf "Visit %s and enter code: %s" response.VerificationUri response.UserCode

/// Token response from authentication.
type TokenResponse = {
    AccessToken: string option
    RefreshToken: string option
    TokenType: string
    ExpiresIn: int
    Error: string option
    ErrorDescription: string option
}

module TokenResponse =
    /// Checks if the response is an error.
    let isError (response: TokenResponse) = response.Error.IsSome

    /// Checks if the response is a pending authorization.
    let isPending (response: TokenResponse) =
        match response.Error with
        | Some "authorization_pending" | Some "slow_down" -> true
        | _ -> false

/// Device flow exception.
exception DeviceFlowException of string

/// Device flow authorization for OAuth.
/// Implements the device authorization grant flow.
type DeviceFlow(?clientId: string) =
    let authUrl = "https://auth.apis.do/user_management/authorize_device"
    let tokenUrl = "https://auth.apis.do/user_management/authenticate"
    let defaultClientId = "client_01JQYTRXK9ZPD8JPJTKDCRB656"

    let clientId = defaultArg clientId defaultClientId
    let httpClient = new HttpClient(Timeout = TimeSpan.FromSeconds(30.0))

    /// Gets the client ID.
    member _.ClientId = clientId

    /// Initiates device authorization.
    member _.AuthorizeAsync() = async {
        let content = new FormUrlEncodedContent([
            KeyValuePair("client_id", clientId)
        ])

        let! response = httpClient.PostAsync(authUrl, content) |> Async.AwaitTask
        let! body = response.Content.ReadAsStringAsync() |> Async.AwaitTask

        if not response.IsSuccessStatusCode then
            raise (DeviceFlowException(sprintf "Authorization failed: %s" body))

        use json = JsonDocument.Parse(body)
        let root = json.RootElement

        let getOptionalString (name: string) =
            match root.TryGetProperty(name) with
            | true, prop -> prop.GetString() |> Option.ofObj
            | false, _ -> None

        let getOptionalInt (name: string) (defaultValue: int) =
            match root.TryGetProperty(name) with
            | true, prop -> prop.GetInt32()
            | false, _ -> defaultValue

        return {
            DeviceCode = root.GetProperty("device_code").GetString()
            UserCode = root.GetProperty("user_code").GetString()
            VerificationUri = root.GetProperty("verification_uri").GetString()
            VerificationUriComplete = getOptionalString "verification_uri_complete"
            ExpiresIn = getOptionalInt "expires_in" 900
            Interval = getOptionalInt "interval" 5
        }
    }

    /// Polls for token after user authorization.
    member _.PollForTokenAsync(deviceCode: string, ?interval: int, ?timeout: int, ?onPoll: int -> unit, ?cancellationToken: CancellationToken) = async {
        let interval = defaultArg interval 5
        let timeout = defaultArg timeout 900
        let cancellationToken = defaultArg cancellationToken CancellationToken.None

        let startTime = DateTime.UtcNow
        let mutable pollInterval = interval
        let mutable attempts = 0
        let mutable result: TokenResponse option = None

        while result.IsNone && (DateTime.UtcNow - startTime).TotalSeconds < float timeout do
            cancellationToken.ThrowIfCancellationRequested()

            attempts <- attempts + 1
            onPoll |> Option.iter (fun f -> f attempts)

            let content = new FormUrlEncodedContent([
                KeyValuePair("client_id", clientId)
                KeyValuePair("device_code", deviceCode)
                KeyValuePair("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
            ])

            let! response = httpClient.PostAsync(tokenUrl, content, cancellationToken) |> Async.AwaitTask
            let! body = response.Content.ReadAsStringAsync(cancellationToken) |> Async.AwaitTask

            use json = JsonDocument.Parse(body)
            let root = json.RootElement

            let getOptionalString (name: string) =
                match root.TryGetProperty(name) with
                | true, prop -> prop.GetString() |> Option.ofObj
                | false, _ -> None

            let getOptionalInt (name: string) (defaultValue: int) =
                match root.TryGetProperty(name) with
                | true, prop -> prop.GetInt32()
                | false, _ -> defaultValue

            match root.TryGetProperty("error") with
            | true, errorProp ->
                let error = errorProp.GetString()
                let errorDescription = getOptionalString "error_description"

                if error = "slow_down" then
                    pollInterval <- pollInterval + 5

                if error <> "authorization_pending" && error <> "slow_down" then
                    result <- Some {
                        AccessToken = None
                        RefreshToken = None
                        TokenType = "Bearer"
                        ExpiresIn = 0
                        Error = Some error
                        ErrorDescription = errorDescription
                    }
            | false, _ ->
                result <- Some {
                    AccessToken = getOptionalString "access_token"
                    RefreshToken = getOptionalString "refresh_token"
                    TokenType = getOptionalString "token_type" |> Option.defaultValue "Bearer"
                    ExpiresIn = getOptionalInt "expires_in" 3600
                    Error = None
                    ErrorDescription = None
                }

            if result.IsNone then
                do! Async.Sleep(pollInterval * 1000)

        match result with
        | Some r -> return r
        | None -> return raise (TimeoutException(sprintf "Authorization timed out after %d seconds" timeout))
    }

    interface IDisposable with
        member _.Dispose() = httpClient.Dispose()
