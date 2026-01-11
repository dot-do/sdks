# Cap'n Web Dart API Design

A beautiful, idiomatic Dart API for capability-based RPC with promise pipelining.

---

## Design Principles

This API is designed to make Dart and Flutter developers feel at home:

1. **Async/await is first-class** - Every RPC call returns a proper `Future<T>`
2. **Extension methods for ergonomics** - Clean syntax without inheritance chains
3. **Sound null safety** - Complete null safety throughout
4. **Pattern matching** - Leverage Dart 3's exhaustive pattern matching
5. **Zero ceremony** - Simple things are simple; complex things are possible
6. **Flutter-ready** - Seamless integration with Riverpod, Provider, and BLoC

---

## Quick Start

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  // Connect to a Cap'n Web server
  final api = await CapnWeb.connect('wss://api.example.com');

  // Make RPC calls with natural async/await
  final user = await api.users.get(123);
  print('Hello, ${user['name']}!');

  // Pipeline multiple calls in a single round-trip
  final profile = await api
      .authenticate(token)
      .then((auth) => auth.getUserId())
      .then((id) => api.profiles.get(id));

  // Clean up
  await api.dispose();
}
```

---

## Core API

### Connecting to a Server

```dart
import 'package:capnweb/capnweb.dart';

// Simple WebSocket connection
final api = await CapnWeb.connect('wss://api.example.com');

// With configuration
final api = await CapnWeb.connect(
  'wss://api.example.com',
  timeout: Duration(seconds: 30),
  reconnect: ReconnectPolicy.exponentialBackoff(),
);

// Builder pattern for complex setups
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

### RpcClient

The root client returned by `CapnWeb.connect()`:

```dart
abstract class RpcClient {
  /// The current connection state.
  ConnectionState get state;

  /// Stream of connection state changes.
  Stream<ConnectionState> get onStateChange;

  /// Whether this client is still connected.
  bool get isConnected;

  /// Close the connection gracefully.
  Future<void> dispose();
}

enum ConnectionState {
  connecting,
  connected,
  reconnecting,
  disconnected,
}
```

---

## Making RPC Calls

### The Stub: Dynamic Property Access

Cap'n Web uses dynamic stubs that intercept property access and method calls:

```dart
final api = await CapnWeb.connect('wss://api.example.com');

// Property access navigates to nested capabilities
final users = api.users;           // RpcStub pointing to 'users'
final user = api.users.get(123);   // RpcPromise<dynamic>

// Method calls return promises
final greeting = await api.greet('World');

// Chain navigation naturally
final name = await api.users.get(123).profile.displayName;
```

### Type Annotations for IDE Support

Add type annotations to get full IDE autocomplete and type checking:

```dart
// Annotate the final result for type inference
final User user = await api.users.get(123);

// Or use inline type parameters
final user = await api.users.get<User>(123);
```

---

## Promise Pipelining

The killer feature of Cap'n Web: chain multiple calls without awaiting intermediate results.

### Basic Pipelining

```dart
// WITHOUT pipelining (3 round trips):
final auth = await api.authenticate(token);
final userId = await auth.getUserId();
final profile = await api.profiles.get(userId);

// WITH pipelining (1 round trip):
final profile = await api
    .authenticate(token)
    .then((auth) => auth.getUserId())
    .then((id) => api.profiles.get(id));
```

### RpcPromise<T>

The `RpcPromise<T>` type represents a pending RPC result that supports pipelining:

```dart
/// A promise that can be pipelined before resolution.
abstract class RpcPromise<T> implements Future<T> {
  /// Chain another call onto this promise.
  RpcPromise<R> then<R>(R Function(T) transform);

  /// Access a property on the eventual result.
  RpcPromise<R> operator [](String property);

  /// Convert to a Result for explicit error handling.
  Future<Result<T, RpcError>> toResult();

  /// Get the raw Future (triggers execution if needed).
  Future<T> get future;
}
```

### Parallel Pipelining with Records

Use Dart 3 records to pipeline multiple calls in parallel:

```dart
// Build parallel pipelines
final auth = api.authenticate(token);

// These all share the same auth capability
final (profile, friends, notifications) = await (
  auth.then((a) => a.getProfile()),
  auth.then((a) => a.getFriends()),
  auth.then((a) => a.getNotifications()),
).wait;

// Single round-trip for all three calls!
print('${profile.name} has ${friends.length} friends');
```

### Pipeline Extensions

Ergonomic extensions for common patterns:

```dart
extension RpcPromiseExtensions<T> on RpcPromise<T> {
  /// Map over a list result, calling an RPC for each item.
  RpcPromise<List<R>> mapEach<R>(RpcPromise<R> Function(T) transform);

  /// Filter results remotely.
  RpcPromise<List<T>> where(bool Function(T) predicate);

  /// Get the first item or null.
  RpcPromise<T?> get firstOrNull;
}

// Example: Get profiles for all friends
final friendProfiles = await api
    .authenticate(token)
    .then((auth) => auth.getFriendIds())
    .mapEach((id) => api.profiles.get(id));
```

---

## Error Handling

### Exception-Based (Default)

```dart
try {
  final user = await api.users.get(123);
  print('Found: ${user.name}');
} on RpcError catch (e) {
  switch (e) {
    case RpcConnectionError(:final reason):
      print('Connection failed: $reason');
    case RpcRemoteError(:final type, :final message):
      print('Server error [$type]: $message');
    case RpcTimeoutError(:final duration):
      print('Timed out after $duration');
    case RpcCancelledError():
      print('Request was cancelled');
  }
}
```

### Result-Based (Explicit)

For more explicit control, convert to a `Result`:

```dart
final result = await api.users.get(123).toResult();

switch (result) {
  case Ok(:final value):
    print('Found: ${value.name}');
  case Err(:final error):
    print('Error: $error');
}

// Or use pattern matching in expressions
final message = switch (await api.users.get(123).toResult()) {
  Ok(:final value) => 'Hello, ${value.name}!',
  Err(error: RpcRemoteError(type: 'NOT_FOUND')) => 'User not found',
  Err(:final error) => 'Error: $error',
};
```

### Error Types (Sealed Hierarchy)

```dart
/// Base class for all RPC errors.
sealed class RpcError implements Exception {
  const RpcError();
}

/// Connection-level errors.
final class RpcConnectionError extends RpcError {
  final String reason;
  final Object? cause;
  const RpcConnectionError(this.reason, [this.cause]);
}

/// Errors returned by the remote server.
final class RpcRemoteError extends RpcError {
  final String type;
  final String message;
  final Map<String, dynamic>? data;
  const RpcRemoteError(this.type, this.message, [this.data]);
}

/// Request timed out.
final class RpcTimeoutError extends RpcError {
  final Duration duration;
  const RpcTimeoutError(this.duration);
}

/// Request was cancelled.
final class RpcCancelledError extends RpcError {
  const RpcCancelledError();
}
```

### Connection Monitoring

```dart
// Monitor connection state
api.onStateChange.listen((state) {
  switch (state) {
    case ConnectionState.connected:
      print('Connected!');
    case ConnectionState.reconnecting:
      print('Reconnecting...');
    case ConnectionState.disconnected:
      print('Disconnected');
    case ConnectionState.connecting:
      print('Connecting...');
  }
});

// React to disconnection
api.onDisconnect.listen((error) {
  showSnackBar('Lost connection: ${error.reason}');
});
```

---

## Exposing Local Objects (RPC Targets)

Make local Dart objects callable from remote clients.

### Defining a Target

```dart
import 'package:capnweb/capnweb.dart';

class UserService extends RpcTarget {
  final Database _db;
  UserService(this._db);

  /// Get a user by ID.
  Future<User> get(int id) async {
    return await _db.fetchUser(id);
  }

  /// List users by category.
  Future<List<User>> list({String? category, int limit = 50}) async {
    return await _db.queryUsers(category: category, limit: limit);
  }

  /// Update a user. Returns the updated user.
  Future<User> update(int id, Map<String, dynamic> changes) async {
    return await _db.updateUser(id, changes);
  }

  /// Get the profile service for a user (nested capability).
  ProfileService profile(int userId) {
    return ProfileService(_db, userId);
  }
}
```

### Exposing Targets

```dart
// Expose when connecting (bidirectional)
final session = await CapnWeb.connect(
  'wss://api.example.com',
  expose: {
    'users': UserService(db),
    'notifications': NotificationService(db),
  },
);

// Or expose dynamically
session.expose('comments', CommentService(db, currentUser));

// Return capabilities from RPC methods
class AuthService extends RpcTarget {
  UserSession authenticate(String token) {
    final user = validateToken(token);
    // Return a new capability scoped to this user
    return UserSession(db, user);
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

  Future<void> write(Uint8List data) async {
    await _file.writeFrom(data);
  }

  // Called when the remote releases this capability
  @override
  Future<void> onDispose() async {
    await _file.close();
  }
}
```

---

## HTTP Batch Mode

For stateless HTTP transports, batch multiple calls into a single request:

```dart
// Execute multiple calls in one HTTP request
final (user, profile, settings) = await CapnWeb.batch(
  'https://api.example.com/rpc',
  (api) async {
    return (
      await api.users.get(123),
      await api.profiles.get(123),
      await api.settings.get(123),
    );
  },
);

// With pipelining
final profile = await CapnWeb.batch(
  'https://api.example.com/rpc',
  (api) async {
    return await api
        .authenticate(token)
        .then((auth) => auth.getUserId())
        .then((id) => api.profiles.get(id));
  },
);
```

---

## Flutter Integration

### Riverpod (Recommended)

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_riverpod/capnweb_riverpod.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Session provider with automatic lifecycle management
final rpcProvider = rpcSessionProvider(
  'wss://api.example.com',
  reconnect: ReconnectPolicy.exponentialBackoff(),
);

// Data providers
final userProvider = FutureProvider.family<User, int>((ref, userId) async {
  final api = ref.watch(rpcProvider);
  return await api.users.get(userId);
});

// Pipelined provider
final dashboardProvider = FutureProvider<DashboardData>((ref) async {
  final api = ref.watch(rpcProvider);
  final token = ref.watch(authTokenProvider);

  // Single round-trip for all dashboard data
  final auth = api.authenticate(token);
  final (profile, notifications, friends) = await (
    auth.then((a) => a.getProfile()),
    auth.then((a) => a.getNotifications()),
    auth.then((a) => a.getFriends()),
  ).wait;

  return DashboardData(
    profile: profile,
    notifications: notifications,
    friends: friends,
  );
});

// Widget usage
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
import 'package:provider/provider.dart';

// Setup in main.dart
void main() {
  runApp(
    RpcProvider(
      endpoint: 'wss://api.example.com',
      child: const MyApp(),
    ),
  );
}

// Widget usage with RpcBuilder
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

// Mutations
class CreateUserButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RpcMutation<User>(
      mutation: (api, name) => api.users.create({'name': name}),
      onSuccess: (user) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Created ${user.name}')),
        );
      },
      builder: (context, mutate, state) => ElevatedButton(
        onPressed: state.isLoading ? null : () => mutate('New User'),
        child: state.isLoading
            ? const CircularProgressIndicator()
            : const Text('Create User'),
      ),
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
final class UpdateUser extends UserEvent {
  final int id;
  final Map<String, dynamic> changes;
  UpdateUser(this.id, this.changes);
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
    on<UpdateUser>(_onUpdate);
  }

  Future<void> _onLoad(LoadUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    final result = await api.users.get(event.id).toResult();
    emit(switch (result) {
      Ok(:final value) => UserLoaded(value),
      Err(:final error) => UserError(error),
    });
  }

  Future<void> _onUpdate(UpdateUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    final result = await api.users.update(event.id, event.changes).toResult();
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

## Code Generation (Optional)

For maximum type safety, use the optional code generator:

### Define Interfaces

```dart
// lib/api.dart
import 'package:capnweb/capnweb.dart';

part 'api.g.dart';

@RpcInterface()
abstract class UserApi {
  Future<User> get(int id);
  Future<List<User>> list({String? category, int limit = 50});
  Future<User> update(int id, Map<String, dynamic> changes);

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

### Use Generated Stubs

```dart
import 'package:capnweb/capnweb.dart';
import 'api.dart';

void main() async {
  // Type-safe session
  final session = await RpcSession.connect<UserApi>('wss://api.example.com');
  final api = session.stub;

  // Full autocomplete and type checking
  final user = await api.get(123);  // Returns Future<User>

  // Type-safe pipelining
  final profile = await api
      .authenticate(token)  // Returns RpcPromise<AuthenticatedApi>
      .pipe((auth) => auth.getUserId())  // Returns RpcPromise<int>
      .pipe((id) => api.getProfile(id)); // Returns RpcPromise<UserProfile>

  await session.close();
}
```

### Implement Targets

```dart
@RpcTarget()
class UserApiImpl implements UserApi {
  final Database _db;
  UserApiImpl(this._db);

  @override
  Future<User> get(int id) async => await _db.fetchUser(id);

  @override
  Future<List<User>> list({String? category, int limit = 50}) async {
    return await _db.queryUsers(category: category, limit: limit);
  }

  @override
  Future<User> update(int id, Map<String, dynamic> changes) async {
    return await _db.updateUser(id, changes);
  }

  @override
  AuthenticatedApiImpl authenticate(String token) {
    final user = validateToken(token);
    return AuthenticatedApiImpl(_db, user);
  }
}
```

---

## Advanced Patterns

### Streaming Data

```dart
// Server-side streaming
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
// Create a cancellable request
final controller = RpcCancelController();

try {
  final result = await api.longRunningOperation()
      .withCancellation(controller);
  print('Result: $result');
} on RpcCancelledError {
  print('Cancelled');
}

// Cancel from elsewhere
controller.cancel();
```

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

### Connection Pooling

```dart
// Share a connection pool across your app
final pool = RpcConnectionPool(
  endpoint: 'wss://api.example.com',
  maxConnections: 5,
);

// Get a connection from the pool
final api = await pool.acquire();
try {
  final user = await api.users.get(123);
} finally {
  pool.release(api);
}

// Or use the convenience method
final user = await pool.withConnection((api) async {
  return await api.users.get(123);
});
```

---

## Package Structure

```
capnweb/                     # Core package (pub.dev: capnweb)
  lib/
    capnweb.dart             # Public API exports
    src/
      client/
        rpc_client.dart
        connection.dart
        reconnect.dart
      stub/
        rpc_stub.dart
        rpc_promise.dart
      target/
        rpc_target.dart
      error/
        rpc_error.dart
        result.dart
      transport/
        transport.dart
        websocket.dart
        http_batch.dart

capnweb_generator/           # Code generation (pub.dev: capnweb_generator)
  lib/
    builder.dart
    src/
      analyzer.dart
      stub_generator.dart
      target_generator.dart

capnweb_riverpod/            # Riverpod integration (pub.dev: capnweb_riverpod)
  lib/
    capnweb_riverpod.dart
    src/
      providers.dart
      hooks.dart

capnweb_provider/            # Provider integration (pub.dev: capnweb_provider)
  lib/
    capnweb_provider.dart
    src/
      rpc_provider.dart
      rpc_query.dart
      rpc_mutation.dart

capnweb_bloc/                # BLoC integration (pub.dev: capnweb_bloc)
  lib/
    capnweb_bloc.dart
    src/
      rpc_bloc.dart
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
      auth.then((a) => a.getProfile()),
      auth.then((a) => a.getFriends()),
      auth.then((a) => a.getSettings()),
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

## Why This API?

This design synthesizes the best patterns from the Dart ecosystem:

| Pattern | Inspiration | Benefit |
|---------|-------------|---------|
| `await api.users.get(123)` | Firebase, Dio | Instantly familiar |
| `.then((x) => ...)` pipelining | Dart Futures | Natural chaining |
| Record destructuring | Dart 3 | Parallel operations |
| `sealed class` errors | Dart 3 | Exhaustive handling |
| `toResult()` | Rust, fpdart | Explicit error control |
| Riverpod integration | Flutter ecosystem | Reactive caching |
| Code generation | freezed, json_serializable | Type safety when needed |

The result: an API that's **simple by default** and **powerful when needed**.
