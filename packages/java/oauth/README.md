# OAuth.do Java SDK

Device flow OAuth SDK for the .do platform.

## Installation

### Gradle

```kotlin
dependencies {
    implementation("do.oauth:oauth:0.1.0")
}
```

### Maven

```xml
<dependency>
    <groupId>do.oauth</groupId>
    <artifactId>oauth</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Usage

### Basic Authentication

```java
import do_.oauth.OAuthClient;

public class Example {
    public static void main(String[] args) throws Exception {
        OAuthClient client = new OAuthClient();

        // Login with device flow
        client.login(auth -> {
            System.out.println("Visit: " + auth.verificationUri);
            System.out.println("Enter code: " + auth.userCode);
        });

        // Get user info
        var user = client.getUserInfo();
        System.out.println("Logged in as: " + user.email);
    }
}
```

### Custom Client ID

```java
OAuthClient client = new OAuthClient("your-client-id");
```

### Check Authentication Status

```java
if (client.isAuthenticated()) {
    String token = client.getAccessToken();
    // Use token for API calls
}
```

### Logout

```java
client.logout();
```

### With Poll Progress

```java
client.login(
    auth -> System.out.println(auth),
    attempt -> System.out.println("Polling... attempt " + attempt)
);
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```java
import do_.oauth.TokenStorage;
import java.nio.file.Paths;

TokenStorage storage = new TokenStorage(Paths.get("/custom/path/token"));
OAuthClient client = new OAuthClient(new DeviceFlow(), storage);
```

## API Reference

### OAuthClient

- `login(Consumer<DeviceAuthResponse> onPrompt)` - Perform device flow login
- `logout()` - Delete stored tokens
- `isAuthenticated()` - Check if valid token exists
- `getAccessToken()` - Get current access token
- `getUserInfo()` - Get authenticated user information

### DeviceFlow

- `authorize()` - Initiate device authorization
- `pollForToken(deviceCode, interval, timeout)` - Poll for token completion

### TokenStorage

- `save(TokenData)` - Save token to disk
- `load()` - Load token from disk
- `delete()` - Delete stored token
- `hasValidToken()` - Check for valid non-expired token

## License

MIT
