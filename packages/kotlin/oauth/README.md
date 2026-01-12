# OAuth.do Kotlin SDK

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

```kotlin
import do_.oauth.OAuthClient
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val client = OAuthClient()

    // Login with device flow
    client.login { auth ->
        println("Visit: ${auth.verificationUri}")
        println("Enter code: ${auth.userCode}")
    }

    // Get user info
    val user = client.getUserInfo()
    println("Logged in as: ${user.email}")

    client.close()
}
```

### Custom Client ID

```kotlin
val client = OAuthClient("your-client-id")
```

### Check Authentication Status

```kotlin
if (client.isAuthenticated()) {
    val token = client.getAccessToken()
    // Use token for API calls
}
```

### Logout

```kotlin
client.logout()
```

### With Poll Progress

```kotlin
client.login(
    onPrompt = { auth -> println(auth) },
    onPoll = { attempt -> println("Polling... attempt $attempt") }
)
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```kotlin
import do_.oauth.TokenStorage
import java.nio.file.Paths

val storage = TokenStorage(Paths.get("/custom/path/token"))
val client = OAuthClient(DeviceFlow(), storage)
```

## API Reference

### OAuthClient

- `suspend fun login(onPrompt, onPoll?)` - Perform device flow login
- `fun logout(): Boolean` - Delete stored tokens
- `fun isAuthenticated(): Boolean` - Check if valid token exists
- `fun getAccessToken(): String?` - Get current access token
- `suspend fun getUserInfo(): UserInfo` - Get authenticated user information
- `fun close()` - Close HTTP clients

### DeviceFlow

- `suspend fun authorize(): DeviceAuthResponse` - Initiate device authorization
- `suspend fun pollForToken(deviceCode, interval, timeout, onPoll?)` - Poll for token completion

### TokenStorage

- `fun save(TokenData)` - Save token to disk
- `fun load(): TokenData?` - Load token from disk
- `fun delete(): Boolean` - Delete stored token
- `fun hasValidToken(): Boolean` - Check for valid non-expired token

## License

MIT
