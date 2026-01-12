# OAuthDo

Device flow OAuth SDK for the .do platform.

## Installation

### NuGet

```bash
dotnet add package OAuthDo
```

Or via Package Manager:

```powershell
Install-Package OAuthDo
```

## Usage

### Basic Authentication

```csharp
using OAuthDo;

var client = new OAuthClient();

// Login with device flow
await client.LoginAsync(auth =>
{
    Console.WriteLine($"Visit: {auth.VerificationUri}");
    Console.WriteLine($"Enter code: {auth.UserCode}");
});

// Get user info
var user = await client.GetUserInfoAsync();
Console.WriteLine($"Logged in as: {user.Email}");

client.Dispose();
```

### Custom Client ID

```csharp
using var client = new OAuthClient("your-client-id");
```

### Check Authentication Status

```csharp
if (await client.IsAuthenticatedAsync())
{
    var token = await client.GetAccessTokenAsync();
    // Use token for API calls
}
```

### Logout

```csharp
client.Logout();
```

### With Poll Progress

```csharp
await client.LoginAsync(
    onPrompt: auth => Console.WriteLine(auth),
    onPoll: attempt => Console.WriteLine($"Polling... attempt {attempt}")
);
```

### With Cancellation

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
await client.LoginAsync(
    onPrompt: auth => Console.WriteLine(auth),
    cancellationToken: cts.Token
);
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```csharp
using OAuthDo;

var storage = new TokenStorage("/custom/path/token");
using var client = new OAuthClient(new DeviceFlow(), storage);
```

## API Reference

### OAuthClient

- `Task<TokenData> LoginAsync(onPrompt, onPoll?, cancellationToken?)` - Perform device flow login
- `bool Logout()` - Delete stored tokens
- `Task<bool> IsAuthenticatedAsync()` - Check if valid token exists
- `Task<string?> GetAccessTokenAsync()` - Get current access token
- `Task<UserInfo> GetUserInfoAsync()` - Get authenticated user information

### DeviceFlow

- `Task<DeviceAuthResponse> AuthorizeAsync()` - Initiate device authorization
- `Task<TokenResponse> PollForTokenAsync(deviceCode, interval?, timeout?, onPoll?, cancellationToken?)` - Poll for token completion

### TokenStorage

- `Task SaveAsync(TokenData)` - Save token to disk
- `Task<TokenData?> LoadAsync()` - Load token from disk
- `bool Delete()` - Delete stored token
- `Task<bool> HasValidTokenAsync()` - Check for valid non-expired token

## Requirements

- .NET 8.0+

## License

MIT
