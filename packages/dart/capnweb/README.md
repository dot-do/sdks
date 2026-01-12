# capnweb

[![pub package](https://img.shields.io/pub/v/capnweb.svg)](https://pub.dev/packages/capnweb)
[![flutter](https://img.shields.io/badge/flutter-3.0+-blue.svg)](https://flutter.dev)
[![dart](https://img.shields.io/badge/dart-3.0+-blue.svg)](https://dart.dev)

Capability-based RPC for Dart and Flutter. One round-trip, infinite possibilities.

```dart
final api = await CapnWeb.connect('wss://api.example.com');

// Chain calls naturally - they pipeline into a single round-trip
final profile = await api.authenticate(token).getUser().profile;

print('Welcome back, ${profile.name}!');
```

---

## Why capnweb?

Traditional RPC forces you to choose: **simple code** or **fast performance**. With capnweb, you get both.

```dart
// This looks like 3 sequential calls...
final auth = api.authenticate(token);
final user = auth.getUser();
final profile = user.profile;

// ...but executes as 1 round-trip.
final result = await profile;
```

The magic is **promise pipelining**: you can call methods on promises *before* they resolve. capnweb batches everything into a single network request automatically.

### Dart 3 Native

Built for modern Dart with first-class support for:

- **Records** - Parallel pipelines with `(a, b, c).wait`
- **Sealed classes** - Exhaustive error handling
- **Pattern matching** - Destructure results elegantly
- **Extension types** - Zero-cost type wrappers

---

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  capnweb: ^1.0.0

  # Optional: Flutter state management integrations
  capnweb_riverpod: ^1.0.0  # For Riverpod
  capnweb_provider: ^1.0.0  # For Provider
  capnweb_bloc: ^1.0.0      # For BLoC
```

---

## Quick Start

### Connect to a Server

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  // Simple connection
  final api = await CapnWeb.connect('wss://api.example.com');

  // With options
  final api = await CapnWeb.connect(
    'wss://api.example.com',
    timeout: Duration(seconds: 30),
    reconnect: ReconnectPolicy.exponentialBackoff(),
  );
}
```

### Make RPC Calls

```dart
// Property access navigates to nested capabilities
final users = api.users;              // RpcStub
final user = api.users.get(123);      // RpcPromise<dynamic>

// Await when you need the value
final User user = await api.users.get(123);
print('Hello, ${user.name}!');

// Chain naturally - it just works
final name = await api.users.get(123).profile.displayName;
```

---

## Promise Pipelining

The killer feature. Chain calls without awaiting - capnweb handles the rest.

### Before: 3 Round-Trips

```dart
final auth = await api.authenticate(token);
final user = await auth.getUser();
final profile = await user.profile;
```

### After: 1 Round-Trip

```dart
// Property chaining - the pipelining promise kept
final profile = await api.authenticate(token).getUser().profile;
```

The entire chain resolves in a single network request. No intermediate awaits, no wasted latency.

### Parallel Pipelines with Records

Dart 3 records enable parallel pipelines that share a common prefix:

```dart
final auth = api.authenticate(token);

// Build parallel pipelines - nothing sent yet
final (profile, friends, notifications) = await (
  auth.getProfile(),
  auth.getFriends(),
  auth.getNotifications(),
).wait;

// All three calls forked from `auth`, executed in one round-trip
print('${profile.name} has ${friends.length} friends');
print('${notifications.length} new notifications');
```

### How Pipelining Works

When you write:

```dart
final profile = await api.authenticate(token).getUser().profile;
```

Capnweb doesn't wait for `authenticate()` to complete before calling `getUser()`. Instead, it builds an **expression tree**:

```
api.authenticate(token)  -> Promise A
       |
       v
     .getUser()          -> Promise B (references A)
       |
       v
     .profile            -> Promise C (references B)
```

All three operations are sent in a single message. The server evaluates them sequentially and returns just the final result.

---

## Type Safety

Capnweb provides flexibility across the static-to-dynamic spectrum.

### Dynamic (Quick Prototyping)

Use `dynamic` for rapid iteration when the schema is evolving:

```dart
// Everything is inferred - quick but no compile-time checks
final user = await api.users.get(123);
print(user['name']); // Runtime access
```

**When to use**: Exploratory coding, testing new endpoints, one-off scripts.

### Annotated (Recommended)

Add type annotations for IDE support and compile-time checks:

```dart
// Annotate variables
final User user = await api.users.get(123);
print(user.name); // Compile-time checked

// Or annotate method calls
final user = await api.users.get<User>(123);

// Complex types work too
final List<User> friends = await api.users.get(123).friends.list();
```

**When to use**: Production code, team projects, any code that will be maintained.

### Generated (Maximum Safety)

Use code generation for full compile-time guarantees:

```dart
@RpcInterface()
abstract class UserApi {
  Future<User> get(int id);
  Future<List<User>> list({String? filter, int limit = 50});
}

// Full autocomplete, compile errors for typos
final user = await api.get(123);       // Type-safe
final user = await api.gett(123);      // Compile error!
```

**When to use**: Large codebases, public APIs, anywhere type errors are costly.

---

## Error Handling

### Sealed Error Hierarchy

Capnweb uses sealed classes for exhaustive error handling:

```dart
sealed class RpcError implements Exception {
  const RpcError();
}

final class RpcConnectionError extends RpcError {
  final String reason;
  final Object? cause;
  const RpcConnectionError(this.reason, [this.cause]);
}

final class RpcRemoteError extends RpcError {
  final String type;     // e.g., "NOT_FOUND", "UNAUTHORIZED"
  final String message;
  final Map<String, dynamic>? data;
  const RpcRemoteError(this.type, this.message, [this.data]);
}

final class RpcTimeoutError extends RpcError {
  final Duration duration;
  const RpcTimeoutError(this.duration);
}

final class RpcCancelledError extends RpcError {
  const RpcCancelledError();
}
```

### Pattern Matching

```dart
try {
  final user = await api.users.get(123);
  print('Found: ${user.name}');
} on RpcError catch (e) {
  switch (e) {
    case RpcConnectionError(:final reason):
      print('Connection failed: $reason');
    case RpcRemoteError(type: 'NOT_FOUND'):
      print('User not found');
    case RpcRemoteError(type: 'UNAUTHORIZED'):
      print('Please log in');
    case RpcRemoteError(:final type, :final message):
      print('Server error [$type]: $message');
    case RpcTimeoutError(:final duration):
      print('Timed out after $duration');
    case RpcCancelledError():
      print('Request was cancelled');
  }
}
```

### Result Type (Explicit Error Handling)

For those who prefer explicit error handling without exceptions:

```dart
final result = await api.users.get(123).toResult();

switch (result) {
  case Ok(:final value):
    print('Found: ${value.name}');
  case Err(:final error):
    print('Error: $error');
}

// One-liner with pattern matching
final message = switch (await api.users.get(123).toResult()) {
  Ok(:final value) => 'Hello, ${value.name}!',
  Err(error: RpcRemoteError(type: 'NOT_FOUND')) => 'User not found',
  Err(:final error) => 'Error: $error',
};
```

---

## Protocol Concepts

Understanding the underlying protocol helps you write efficient code.

### Push and Pull

Every RPC call involves two phases:

1. **Push**: Send an expression to evaluate (e.g., `api.users.get(123)`)
2. **Pull**: Request the result when you actually need it

```dart
// Push happens here - expression sent to server
final promise = api.users.get(123);

// Pull happens here - result requested and awaited
final user = await promise;
```

Pipelining works because you can push multiple expressions that reference each other before pulling any results.

### Import/Export Tables

Capnweb maintains bidirectional capability tables:

- **Imports**: Remote objects you can call (stubs)
- **Exports**: Local objects others can call (targets)

```dart
// Import: call remote capabilities
final user = await api.users.get(123);

// Export: expose local capabilities
session.expose('calculator', MyCalculator());
```

### Remap (Collection Operations)

The `remap` operation transforms collections without pulling all data locally:

```dart
// Get profiles for all friend IDs - executes on the server
final friendProfiles = await api
    .authenticate(token)
    .getFriendIds()
    .remap((id) => api.profiles.get(id));
```

This sends the mapping function to the server, which applies it to each element and returns the transformed collection. One round-trip, regardless of collection size.

---

## Implementing RPC Targets

Expose your Dart objects to remote callers.

### Define a Target

```dart
class UserService extends RpcTarget {
  final Database _db;
  UserService(this._db);

  Future<User> get(int id) async {
    return await _db.fetchUser(id);
  }

  Future<List<User>> list({String? category, int limit = 50}) async {
    return await _db.queryUsers(category: category, limit: limit);
  }

  // Return nested capabilities
  ProfileService profile(int userId) {
    return ProfileService(_db, userId);
  }
}
```

### Expose Targets

```dart
// Expose when connecting
final session = await CapnWeb.connect(
  'wss://api.example.com',
  expose: {
    'users': UserService(db),
    'notifications': NotificationService(db),
  },
);

// Or expose dynamically
session.expose('comments', CommentService(db, currentUser));
```

### Capability-Based Security

Return capabilities scoped to the authenticated user:

```dart
class AuthService extends RpcTarget {
  AuthenticatedSession authenticate(String token) {
    final user = validateToken(token);
    // Return a capability scoped to this user's permissions
    return AuthenticatedSession(db, user);
  }
}

class AuthenticatedSession extends RpcTarget {
  final Database _db;
  final User _user;
  AuthenticatedSession(this._db, this._user);

  Future<UserProfile> getProfile() async {
    // Can only access this user's profile
    return await _db.getProfile(_user.id);
  }

  Future<List<User>> getFriends() async {
    return await _db.getFriends(_user.id);
  }
}
```

### Target Lifecycle

```dart
class FileHandle extends RpcTarget {
  final RandomAccessFile _file;
  FileHandle(this._file);

  Future<Uint8List> read(int bytes) async {
    return await _file.read(bytes);
  }

  // Called when the remote releases this capability
  @override
  Future<void> onDispose() async {
    await _file.close();
  }
}
```

---

## Connection Management

### Connection Options

```dart
final api = await CapnWeb.builder()
    .endpoint('wss://api.example.com')
    .timeout(Duration(seconds: 30))
    .reconnect(ReconnectPolicy.exponentialBackoff(
      initialDelay: Duration(seconds: 1),
      maxDelay: Duration(seconds: 30),
      maxAttempts: 10,
    ))
    .onStateChange((state) => print('Connection: $state'))
    .build();
```

### Connection Monitoring

```dart
api.onStateChange.listen((state) {
  switch (state) {
    case ConnectionState.connected:
      print('Connected!');
    case ConnectionState.reconnecting:
      print('Reconnecting...');
    case ConnectionState.disconnected:
      print('Disconnected');
  }
});
```

### Graceful Cleanup

```dart
// Always dispose when done
await api.dispose();

// Or use try/finally
final api = await CapnWeb.connect('wss://api.example.com');
try {
  // ... use api
} finally {
  await api.dispose();
}
```

---

## Flutter Integration

### Riverpod (Recommended)

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_riverpod/capnweb_riverpod.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Session provider with automatic lifecycle
final rpcProvider = rpcSessionProvider(
  'wss://api.example.com',
  reconnect: ReconnectPolicy.exponentialBackoff(),
);

// Data providers
final userProvider = FutureProvider.family<User, int>((ref, userId) async {
  final api = ref.watch(rpcProvider);
  return await api.users.get(userId);
});

// Pipelined provider - single round-trip for dashboard data
final dashboardProvider = FutureProvider<DashboardData>((ref) async {
  final api = ref.watch(rpcProvider);
  final token = ref.watch(authTokenProvider);

  final auth = api.authenticate(token);
  final (profile, notifications, friends) = await (
    auth.getProfile(),
    auth.getNotifications(),
    auth.getFriends(),
  ).wait;

  return DashboardData(
    profile: profile,
    notifications: notifications,
    friends: friends,
  );
});
```

#### Using in Widgets

```dart
class UserProfileScreen extends ConsumerWidget {
  final int userId;
  const UserProfileScreen({required this.userId, super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider(userId));

    return userAsync.when(
      data: (user) => UserProfileView(user: user),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => ErrorView(error: error),
    );
  }
}
```

### Provider

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_provider/capnweb_provider.dart';

void main() {
  runApp(
    RpcProvider(
      endpoint: 'wss://api.example.com',
      child: const MyApp(),
    ),
  );
}

class UserScreen extends StatelessWidget {
  final int userId;
  const UserScreen({required this.userId, super.key});

  @override
  Widget build(BuildContext context) {
    return RpcQuery<User>(
      query: (api) => api.users.get(userId),
      builder: (context, snapshot) => switch (snapshot) {
        AsyncData(:final data) => UserCard(user: data),
        AsyncLoading() => const CircularProgressIndicator(),
        AsyncError(:final error) => Text('Error: $error'),
      },
    );
  }
}
```

### BLoC

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_bloc/capnweb_bloc.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

// Events
sealed class UserEvent {}
final class LoadUser extends UserEvent {
  final int id;
  LoadUser(this.id);
}

// States
sealed class UserState {}
final class UserInitial extends UserState {}
final class UserLoading extends UserState {}
final class UserLoaded extends UserState {
  final User user;
  UserLoaded(this.user);
}
final class UserError extends UserState {
  final RpcError error;
  UserError(this.error);
}

// BLoC
class UserBloc extends RpcBloc<UserEvent, UserState> {
  UserBloc(super.api) : super(UserInitial()) {
    on<LoadUser>(_onLoad);
  }

  Future<void> _onLoad(LoadUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    final result = await api.users.get(event.id).toResult();
    emit(switch (result) {
      Ok(:final value) => UserLoaded(value),
      Err(:final error) => UserError(error),
    });
  }
}

// Widget
class UserWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return BlocBuilder<UserBloc, UserState>(
      builder: (context, state) => switch (state) {
        UserInitial() => const Text('Enter a user ID'),
        UserLoading() => const CircularProgressIndicator(),
        UserLoaded(:final user) => UserCard(user: user),
        UserError(:final error) => Text('Error: $error'),
      },
    );
  }
}
```

---

## Advanced Patterns

### Streaming Data

```dart
// Subscribe to server-sent events
final stream = api.events.subscribe('user:123');
await for (final event in stream) {
  print('Event: ${event.type}');
}

// Bidirectional streaming
final chat = api.chat.connect(roomId);
chat.send('Hello!');
await for (final message in chat.messages) {
  print('${message.author}: ${message.text}');
}
```

### Cancellation

```dart
final controller = RpcCancelController();

try {
  final result = await api
      .longRunningOperation()
      .withCancellation(controller);
  print('Result: $result');
} on RpcCancelledError {
  print('Cancelled');
}

// Cancel from elsewhere (e.g., user pressed back button)
controller.cancel();
```

### HTTP Batch Mode

For stateless HTTP backends, batch multiple calls into a single request:

```dart
final (user, profile, settings) = await CapnWeb.batch(
  'https://api.example.com/rpc',
  (api) => (
    api.users.get(123),
    api.profiles.get(123),
    api.settings.get(123),
  ),
);
```

The callback builds pipelines; `.batch()` executes them all in one HTTP POST. No intermediate awaits needed.

### Request Interceptors

```dart
final api = await CapnWeb.builder()
    .endpoint('wss://api.example.com')
    .interceptor((request, next) async {
      // Add authentication
      request.metadata['auth'] = await getAuthToken();

      // Log timing
      final stopwatch = Stopwatch()..start();
      try {
        return await next(request);
      } finally {
        print('${request.method} took ${stopwatch.elapsedMilliseconds}ms');
      }
    })
    .build();
```

---

## Code Generation (Optional)

For maximum type safety, use the optional code generator.

### Define Interfaces

```dart
// lib/api.dart
import 'package:capnweb/capnweb.dart';

part 'api.g.dart';

@RpcInterface()
abstract class UserApi {
  Future<User> get(int id);
  Future<List<User>> list({String? category, int limit = 50});

  @RpcCapability()  // Returns a capability, not a value
  AuthenticatedApi authenticate(String token);
}

@RpcInterface()
abstract class AuthenticatedApi {
  Future<int> getUserId();
  Future<UserProfile> getProfile();
  Future<List<int>> getFriendIds();
}
```

### Generate Stubs

```bash
dart run build_runner build
```

### Use Generated Stubs

```dart
import 'api.dart';

void main() async {
  final session = await RpcSession.connect<UserApi>('wss://api.example.com');
  final api = session.stub;

  // Full autocomplete and type checking
  final user = await api.get(123);  // Returns Future<User>

  await session.close();
}
```

---

## Platform Setup

### Flutter (iOS/Android)

No additional setup required. WebSocket works out of the box.

```yaml
# pubspec.yaml
dependencies:
  capnweb: ^1.0.0
```

### Flutter Web

WebSocket is supported natively. For HTTP batch mode:

```dart
// Use the web-compatible HTTP client
final api = await CapnWeb.batch(
  'https://api.example.com/rpc',
  (api) => (api.users.get(123), api.profiles.get(123)),
);
```

### Dart CLI / Server

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  final api = await CapnWeb.connect('wss://api.example.com');

  try {
    final user = await api.users.get(123);
    print('User: ${user.name}');
  } finally {
    await api.dispose();
  }
}
```

---

## Security Considerations

### Token Handling

Never hardcode tokens. Use secure storage:

```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final storage = FlutterSecureStorage();
final token = await storage.read(key: 'api_token');

final api = await CapnWeb.builder()
    .endpoint('wss://api.example.com')
    .interceptor((request, next) async {
      request.metadata['authorization'] = 'Bearer $token';
      return await next(request);
    })
    .build();
```

### Capability Security

Capabilities are unforgeable references. When you call `api.authenticate(token)`, the returned session capability is scoped to that user's permissions. You cannot fabricate a session for another user.

```dart
// This session can only access user 123's data
final session = api.authenticate(validTokenForUser123);

// Any data access is automatically scoped
final profile = await session.getProfile(); // User 123's profile
final friends = await session.getFriends(); // User 123's friends
```

### TLS

Always use `wss://` (WebSocket Secure) in production:

```dart
// Development
final api = await CapnWeb.connect('ws://localhost:8080');

// Production - always use TLS
final api = await CapnWeb.connect('wss://api.example.com');
```

---

## API Reference

### CapnWeb

```dart
abstract class CapnWeb {
  /// Connect via WebSocket
  static Future<RpcClient> connect(
    String url, {
    Duration? timeout,
    ReconnectPolicy? reconnect,
    Map<String, RpcTarget>? expose,
  });

  /// Builder for advanced configuration
  static CapnWebBuilder builder();

  /// HTTP batch mode
  static Future<T> batch<T>(
    String url,
    T Function(RpcStub api) builder,
  );
}
```

### RpcClient

```dart
abstract class RpcClient {
  ConnectionState get state;
  Stream<ConnectionState> get onStateChange;
  Stream<RpcConnectionError> get onDisconnect;
  bool get isConnected;

  void expose(String name, RpcTarget target);
  Future<void> dispose();
}
```

### RpcPromise<T>

```dart
abstract class RpcPromise<T> implements Future<T> {
  /// Access a property on the eventual result
  RpcPromise<R> operator [](String property);

  /// Convert to Result for explicit error handling
  Future<Result<T, RpcError>> toResult();

  /// Map over a collection result
  RpcPromise<List<R>> remap<R>(RpcPromise<R> Function(T) mapper);

  /// Attach a cancellation controller
  RpcPromise<T> withCancellation(RpcCancelController controller);
}
```

### RpcTarget

```dart
abstract class RpcTarget {
  /// Called when disposed by remote
  Future<void> onDispose() async {}
}
```

---

## Complete Example

```dart
import 'package:capnweb/capnweb.dart';

Future<void> main() async {
  // Connect with automatic reconnection
  final api = await CapnWeb.connect(
    'wss://api.example.com',
    reconnect: ReconnectPolicy.exponentialBackoff(),
  );

  // Monitor connection
  api.onStateChange.listen((state) {
    print('Connection state: $state');
  });

  try {
    // Authenticate and pipeline multiple calls
    final auth = api.authenticate(myToken);

    // These all execute in a single round-trip
    final (profile, friends, settings) = await (
      auth.getProfile(),
      auth.getFriends(),
      auth.getSettings(),
    ).wait;

    print('Welcome back, ${profile.name}!');
    print('You have ${friends.length} friends online.');

    // Handle errors explicitly when needed
    final result = await api.riskyOperation().toResult();
    switch (result) {
      case Ok(:final value):
        print('Success: $value');
      case Err(error: RpcRemoteError(type: 'RATE_LIMITED')):
        print('Please slow down!');
      case Err(:final error):
        print('Operation failed: $error');
    }

  } finally {
    await api.dispose();
  }
}
```

---

## Why This Design?

| Pattern | Inspiration | Benefit |
|---------|-------------|---------|
| `await api.users.get(123)` | Firebase, Dio | Instantly familiar |
| `(a, b, c).wait` parallel | Dart 3 records | Parallel pipelines in one line |
| `sealed class` errors | Dart 3 | Exhaustive pattern matching |
| `toResult()` | Rust, fpdart | Explicit error control |
| `remap()` | Cap'n Proto | Server-side collection transforms |
| Riverpod integration | Flutter ecosystem | Reactive caching built-in |

The result: an API that is **simple by default** and **powerful when needed**.

---

## Package Ecosystem

| Package | Description |
|---------|-------------|
| `capnweb` | Core RPC client |
| `capnweb_generator` | Optional code generation for type safety |
| `capnweb_riverpod` | Riverpod integration |
| `capnweb_provider` | Provider integration |
| `capnweb_bloc` | BLoC integration |

---

## License

MIT License. See [LICENSE](LICENSE) for details.
