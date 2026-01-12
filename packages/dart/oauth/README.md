# oauth_do

Device flow OAuth SDK for the .do platform.

## Installation

Add this to your `pubspec.yaml`:

```yaml
dependencies:
  oauth_do: ^0.1.0
```

Then run:

```bash
dart pub get
```

## Usage

### Basic Authentication

```dart
import 'package:oauth_do/oauth_do.dart';

void main() async {
  final client = OAuthClient();

  // Login with device flow
  await client.login(
    onPrompt: (auth) {
      print('Visit: ${auth.verificationUri}');
      print('Enter code: ${auth.userCode}');
    },
  );

  // Get user info
  final user = await client.getUserInfo();
  print('Logged in as: ${user.email}');

  client.close();
}
```

### Custom Client ID

```dart
final client = OAuthClient.withClientId('your-client-id');
```

### Check Authentication Status

```dart
if (await client.isAuthenticated()) {
  final token = await client.getAccessToken();
  // Use token for API calls
}
```

### Logout

```dart
await client.logout();
```

### With Poll Progress

```dart
await client.login(
  onPrompt: (auth) => print(auth),
  onPoll: (attempt) => print('Polling... attempt $attempt'),
);
```

## Token Storage

Tokens are stored in `~/.oauth.do/token` by default. You can customize this:

```dart
import 'package:oauth_do/oauth_do.dart';

final storage = TokenStorage.custom('/custom/path/token');
final client = OAuthClient.custom(
  deviceFlow: DeviceFlow(),
  tokenStorage: storage,
);
```

## API Reference

### OAuthClient

- `Future<TokenData> login({onPrompt, onPoll?})` - Perform device flow login
- `Future<bool> logout()` - Delete stored tokens
- `Future<bool> isAuthenticated()` - Check if valid token exists
- `Future<String?> getAccessToken()` - Get current access token
- `Future<UserInfo> getUserInfo()` - Get authenticated user information
- `void close()` - Close HTTP clients

### DeviceFlow

- `Future<DeviceAuthResponse> authorize()` - Initiate device authorization
- `Future<TokenResponse> pollForToken({deviceCode, interval?, timeout?, onPoll?})` - Poll for token completion

### TokenStorage

- `Future<void> save(TokenData)` - Save token to disk
- `Future<TokenData?> load()` - Load token from disk
- `Future<bool> delete()` - Delete stored token
- `Future<bool> hasValidToken()` - Check for valid non-expired token

## Requirements

- Dart SDK >= 3.0.0

## License

MIT
