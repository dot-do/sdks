# oauth-do

OAuth device flow SDK for .do APIs in Scala.

## Installation

Add to your `build.sbt`:

```scala
libraryDependencies += "do.oauth" %% "oauth-do" % "0.1.0"
```

## Usage

### Interactive Login

```scala
import `do`.oauth.OAuthClient

val client = OAuthClient()

// Start device flow login
client.login() match {
  case Success(tokens) => println(s"Logged in! Token: ${tokens.accessToken}")
  case Failure(e) => println(s"Login failed: ${e.getMessage}")
}

// Get current user info
client.getUser() match {
  case Success(user) => println(s"User: $user")
  case Failure(e) => println(s"Failed: ${e.getMessage}")
}

// Logout
client.logout()
```

### Manual Device Flow

```scala
import `do`.oauth.OAuthClient

val client = OAuthClient()

// Step 1: Initiate device authorization
val deviceInfo = client.authorizeDevice().get

// Display to user
println(s"Visit: ${deviceInfo.verificationUri}")
println(s"Enter code: ${deviceInfo.userCode}")

// Step 2: Poll for tokens
val tokens = client.pollForTokens(
  deviceInfo.deviceCode,
  deviceInfo.interval,
  deviceInfo.expiresIn
).get
```

### Custom Client ID

```scala
val client = OAuthClient("your_client_id")
```

## Token Storage

Tokens are stored at `~/.oauth.do/token`.

## API

- `authorizeDevice(scope)` - Initiate device authorization
- `pollForTokens(deviceCode, interval, expiresIn)` - Poll for tokens
- `getUser(accessToken)` - Get current user info
- `login(scope)` - Interactive login flow
- `logout()` - Remove stored tokens

## License

MIT
