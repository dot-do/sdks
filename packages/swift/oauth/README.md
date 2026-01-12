# OAuth.do Swift SDK

Device flow OAuth SDK for the .do platform.

## Installation

### Swift Package Manager

Add the following to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/drivly/oauth.do", from: "0.1.0")
]
```

Or add via Xcode: File > Add Packages > Enter the repository URL.

## Usage

### Basic Authentication

```swift
import OAuthDo

let client = OAuthClient()

// Login with device flow
Task {
    do {
        try await client.login { auth in
            print("Visit: \(auth.verificationUri)")
            print("Enter code: \(auth.userCode)")
        }

        // Get user info
        let user = try await client.getUserInfo()
        print("Logged in as: \(user.email ?? "unknown")")
    } catch {
        print("Error: \(error)")
    }
}
```

### Custom Client ID

```swift
let client = OAuthClient(clientId: "your-client-id")
```

### Check Authentication Status

```swift
if client.isAuthenticated() {
    if let token = client.getAccessToken() {
        // Use token for API calls
    }
}
```

### Logout

```swift
client.logout()
```

### With Poll Progress

```swift
try await client.login(
    onPrompt: { auth in print(auth.description) },
    onPoll: { attempt in print("Polling... attempt \(attempt)") }
)
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```swift
import OAuthDo

let customPath = URL(fileURLWithPath: "/custom/path/token")
let storage = TokenStorage(tokenPath: customPath)
let client = OAuthClient(deviceFlow: DeviceFlow(), tokenStorage: storage)
```

## API Reference

### OAuthClient

- `func login(onPrompt:onPoll:) async throws -> TokenStorage.TokenData` - Perform device flow login
- `func logout() -> Bool` - Delete stored tokens
- `func isAuthenticated() -> Bool` - Check if valid token exists
- `func getAccessToken() -> String?` - Get current access token
- `func getUserInfo() async throws -> UserInfo` - Get authenticated user information

### DeviceFlow

- `func authorize() async throws -> DeviceAuthResponse` - Initiate device authorization
- `func pollForToken(deviceCode:interval:timeout:onPoll:) async throws -> TokenResponse` - Poll for token completion

### TokenStorage

- `func save(_ data: TokenData) throws` - Save token to disk
- `func load() -> TokenData?` - Load token from disk
- `func delete() -> Bool` - Delete stored token
- `func hasValidToken() -> Bool` - Check for valid non-expired token

## Requirements

- iOS 15.0+
- macOS 12.0+
- tvOS 15.0+
- watchOS 8.0+

## License

MIT
