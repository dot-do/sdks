# OAuthDo F#

Device flow OAuth SDK for the .do platform (F#).

## Installation

### NuGet

```bash
dotnet add package OAuthDo.FSharp
```

Or via Package Manager:

```powershell
Install-Package OAuthDo.FSharp
```

## Usage

### Basic Authentication

```fsharp
open OAuthDo

let main() = async {
    use client = new OAuthClient()

    // Login with device flow
    let! _ = client.LoginAsync(fun auth ->
        printfn "Visit: %s" auth.VerificationUri
        printfn "Enter code: %s" auth.UserCode
    )

    // Get user info
    let! user = client.GetUserInfoAsync()
    printfn "Logged in as: %s" (user.Email |> Option.defaultValue "unknown")
}

main() |> Async.RunSynchronously
```

### Custom Client ID

```fsharp
use client = new OAuthClient("your-client-id")
```

### Check Authentication Status

```fsharp
async {
    let! isAuth = client.IsAuthenticatedAsync()
    if isAuth then
        let! token = client.GetAccessTokenAsync()
        match token with
        | Some t -> printfn "Token: %s" t
        | None -> ()
}
```

### Logout

```fsharp
client.Logout() |> ignore
```

### With Poll Progress

```fsharp
client.LoginAsync(
    (fun auth -> printfn "%s" (DeviceAuthResponse.toString auth)),
    onPoll = (fun attempt -> printfn "Polling... attempt %d" attempt)
)
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```fsharp
open OAuthDo

let storage = TokenStorage("/custom/path/token")
use client = new OAuthClient(new DeviceFlow(), storage)
```

## API Reference

### OAuthClient

- `LoginAsync(onPrompt, ?onPoll, ?cancellationToken) : Async<TokenData>` - Perform device flow login
- `Logout() : bool` - Delete stored tokens
- `IsAuthenticatedAsync() : Async<bool>` - Check if valid token exists
- `GetAccessTokenAsync() : Async<string option>` - Get current access token
- `GetUserInfoAsync() : Async<UserInfo>` - Get authenticated user information

### DeviceFlow

- `AuthorizeAsync() : Async<DeviceAuthResponse>` - Initiate device authorization
- `PollForTokenAsync(deviceCode, ?interval, ?timeout, ?onPoll, ?cancellationToken) : Async<TokenResponse>` - Poll for token completion

### TokenStorage

- `SaveAsync(TokenData) : Async<unit>` - Save token to disk
- `LoadAsync() : Async<TokenData option>` - Load token from disk
- `Delete() : bool` - Delete stored token
- `HasValidTokenAsync() : Async<bool>` - Check for valid non-expired token

### Types

```fsharp
type TokenData = {
    AccessToken: string
    RefreshToken: string option
    TokenType: string
    ExpiresAt: int64
}

type UserInfo = {
    Id: string option
    Email: string option
    Name: string option
    Picture: string option
}

type DeviceAuthResponse = {
    DeviceCode: string
    UserCode: string
    VerificationUri: string
    VerificationUriComplete: string option
    ExpiresIn: int
    Interval: int
}
```

## Requirements

- .NET 8.0+
- F# 8.0+

## License

MIT
