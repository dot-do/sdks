# rpc_do

[![pub package](https://img.shields.io/pub/v/rpc_do.svg)](https://pub.dev/packages/rpc_do)
[![flutter](https://img.shields.io/badge/flutter-3.0+-blue.svg)](https://flutter.dev)
[![dart](https://img.shields.io/badge/dart-3.0+-blue.svg)](https://dart.dev)

The magic proxy that makes any `.do` service feel like local Dart code.

```dart
import 'package:rpc_do/rpc_do.dart';

void main() async {
  final api = await RpcDo.connect('wss://mongo.do');

  // Call any method - no schema required
  final users = await api.$['users'].find({'active': true});
  final profile = await api.$['users'].findOne({'id': 123})['profile']['settings'];

  print('Found ${users.length} active users');
}
```

One import. One connection. Zero boilerplate.

---

## What is rpc_do?

`rpc_do` is the managed RPC layer for the `.do` ecosystem. It sits between raw [capnweb](https://pub.dev/packages/capnweb) (the protocol) and domain-specific SDKs like `mongo_do`, `kafka_do`, `database_do`, and hundreds more.

Think of it as the "magic glue" that lets you:

1. **Call any method without schemas** - `api.$['anything']['you']['want']()` just works
2. **Route automatically to `.do` services** - Connect once, call anywhere
3. **Pipeline promises** - Chain calls, pay one round trip
4. **Use Dart idioms** - `async`/`await`, `Stream`, pattern matching
5. **Integrate with Flutter** - Riverpod, Provider, BLoC support

```
Your Dart/Flutter Code
         |
         v
   +-----------+     +-----------+     +--------------+
   |  rpc_do   | --> |  capnweb  | --> | *.do Server  |
   +-----------+     +-----------+     +--------------+
         |
         +--- Magic proxy (api.$['method']())
         +--- Auto-routing (mongo.do, kafka.do, etc.)
         +--- Promise pipelining
         +--- Stream support
         +--- Flutter state management
```

---

## rpc_do vs capnweb

| Feature | capnweb | rpc_do |
|---------|---------|--------|
| Protocol implementation | Yes | Uses capnweb |
| Type-safe with interfaces | Yes | Yes |
| Schema-free dynamic calls | No | Yes (magic proxy) |
| Auto `.do` domain routing | No | Yes |
| Promise pipelining | Yes | Yes (inherited) |
| Server-side `.map()` | Yes | Yes (enhanced) |
| Stream support | Basic | Full Dart Stream API |
| Flutter integrations | No | Yes (Riverpod, Provider, BLoC) |

**Use capnweb** when you're building a custom RPC server with defined interfaces.

**Use rpc_do** when you're calling `.do` services and want maximum flexibility with Dart idioms.

---

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  rpc_do: ^1.0.0
```

Or install via command line:

```bash
dart pub add rpc_do
```

For Flutter projects with state management:

```yaml
dependencies:
  rpc_do: ^1.0.0

  # Choose your preferred state management
  rpc_do_riverpod: ^1.0.0  # For Riverpod
  rpc_do_provider: ^1.0.0  # For Provider
  rpc_do_bloc: ^1.0.0      # For BLoC
```

Requires Dart 3.0+ or Flutter 3.0+.

---

## Quick Start

### Basic Connection

```dart
import 'package:rpc_do/rpc_do.dart';

void main() async {
  // Connect to any .do service
  final client = await RpcDo.connect('wss://api.example.do');

  // Call methods via the $ proxy
  final result = await client.$['hello']('World');
  print(result);  // "Hello, World!"

  // Close when done
  await client.close();
}
```

### With Authentication

```dart
import 'package:rpc_do/rpc_do.dart';

void main() async {
  final client = await RpcDo.connect(
    'wss://api.example.do',
    token: 'your-api-key',
    headers: {
      'X-Custom-Header': 'value',
    },
  );

  // Authenticated calls
  final user = await client.$['users']['me']();
  print('Hello, ${user['name']}!');
}
```

### Type Annotations (Recommended)

```dart
import 'package:rpc_do/rpc_do.dart';

// Define your data types
class User {
  final int id;
  final String name;
  final String email;

  User.fromJson(Map<String, dynamic> json)
      : id = json['id'] as int,
        name = json['name'] as String,
        email = json['email'] as String;
}

void main() async {
  final client = await RpcDo.connect('wss://api.example.do');

  // Type-annotated calls
  final User user = User.fromJson(
    await client.$['users']['get'](123),
  );

  // Or use generic type parameters
  final Map<String, dynamic> raw = await client.$['users']['get']<Map<String, dynamic>>(123);

  print('User: ${user.name}');
}
```

---

## The Magic Proxy

The `$` property returns a magic proxy that intercepts all property access and method calls, sending them as RPC requests.

### How It Works

```dart
final client = await RpcDo.connect('wss://api.example.do');

// Every bracket access builds the path
client.$                         // RpcProxy
client.$['users']                // RpcProxy with path ["users"]
client.$['users']['get']         // RpcProxy with path ["users", "get"]
client.$['users']['get'](123)    // RPC call to "get" with args [123]
```

The proxy doesn't know what methods exist on the server. It just records the path and sends it when you invoke a function.

### Nested Access

Access deeply nested APIs naturally:

```dart
// All of these work
await client.$['users']['get'](123);
await client.$['users']['profiles']['settings']['theme']['get']();
await client.$['api']['v2']['admin']['users']['deactivate'](userId);
```

### Dynamic Keys

Use variables for dynamic property names:

```dart
final tableName = 'users';
final result = await client.$[tableName]['find']({'active': true});

// Equivalent to
final result = await client.$['users']['find']({'active': true});
```

### Method Chaining Syntax

For cleaner code, use the dot-method syntax:

```dart
// These are equivalent
await client.$['users']['get'](123);
await client.call(['users', 'get'], [123]);

// Build paths dynamically
final path = ['api', version, 'users', action];
await client.call(path, args);
```

---

## Promise Pipelining

The killer feature inherited from capnweb. Chain dependent calls without waiting for intermediate results.

### The Problem

Traditional RPC requires waiting for each response:

```dart
// BAD: Three round trips
final session = await api.$['authenticate'](token);     // Wait...
final userId = await session['getUserId']();            // Wait...
final profile = await api.$['getUserProfile'](userId);  // Wait...
```

### The Solution

With pipelining, dependent calls are batched:

```dart
// GOOD: One round trip
final session = api.$['authenticate'](token);           // RpcPromise
final userId = session['getUserId']();                  // RpcPromise (pipelined)
final profile = api.$['getUserProfile'](userId);        // RpcPromise (pipelined)

// Only awaiting triggers the network request
final result = await profile;
```

### How Pipelining Works

1. **Recording phase**: Method calls return `RpcPromise` objects without sending anything
2. **Batching**: When you `await`, rpc_do collects all recorded operations
3. **Single request**: Everything is sent as one batched request
4. **Server resolution**: The server evaluates dependencies and returns results

```dart
final client = await RpcDo.connect('wss://api.example.do');

// Build the pipeline (no network yet)
final auth = client.$['authenticate'](token);
final user = auth['getUser']();
final profile = user['profile'];
final settings = profile['settings'];

// Send and await (one round trip)
final result = await settings;
```

### Parallel Pipelines with Records

Dart 3 records enable parallel pipelines that share a common prefix:

```dart
final auth = client.$['authenticate'](token);

// Build parallel pipelines - nothing sent yet
final (profile, friends, notifications) = await (
  auth['getProfile'](),
  auth['getFriends'](),
  auth['getNotifications'](),
).wait;

// All three calls forked from `auth`, executed in one round-trip
print('${profile['name']} has ${friends.length} friends');
print('${notifications.length} new notifications');
```

### FutureGroup for Dynamic Parallelism

When you don't know the number of parallel calls at compile time:

```dart
import 'package:async/async.dart';

Future<List<dynamic>> fetchAllProfiles(List<int> userIds) async {
  final client = await RpcDo.connect('wss://api.example.do');

  // Create futures dynamically
  final futures = userIds.map(
    (id) => client.$['users']['get'](id)['profile'](),
  );

  // Execute all in parallel, one round trip
  return Future.wait(futures);
}
```

---

## Server-Side Map

Transform collections on the server to avoid N+1 round trips.

### The N+1 Problem

```dart
// BAD: N+1 round trips
final userIds = await client.$['listUserIds']();  // 1 round trip
final profiles = <Map<String, dynamic>>[];
for (final id in userIds) {
  profiles.add(await client.$['getProfile'](id));  // N round trips
}
```

### The Solution: serverMap

```dart
// GOOD: 1 round trip total
final userIds = await client.$['listUserIds']();

final profiles = await client.serverMap(
  userIds,
  (id) => client.$['getProfile'](id),
);
```

### How serverMap Works

1. **Expression capture**: Your lambda is analyzed and converted to a transferable expression
2. **Capability serialization**: Referenced capabilities are sent along
3. **Server execution**: The server applies the expression to each array element
4. **Single response**: All results return in one response

### Chained Maps

```dart
// Get users, extract IDs, fetch profiles, get names - all server-side
final names = await client
    .$['users']['list']()
    .map((user) => user['id'])
    .map((id) => client.$['profiles']['get'](id))
    .map((profile) => profile['displayName']);

print('Names: $names');
```

### Filter and Reduce

```dart
// Filter to active users
final activeUsers = await client
    .$['users']['list']()
    .filter((user) => user['status'] == 'active');

// Sum all balances
final total = await client
    .$['accounts']['list']()
    .map((account) => account['balance'])
    .reduce((a, b) => a + b, initial: 0);
```

### Map with Async Transforms

```dart
// Each transform can be async
final enrichedUsers = await client
    .$['users']['list']()
    .map((user) async {
      final profile = await client.$['profiles']['get'](user['id']);
      return {
        ...user,
        'profile': profile,
      };
    });
```

---

## Capabilities

Capabilities are references to remote objects. When a server returns a capability, you get a proxy that lets you call methods on that specific object.

### Creating Capabilities

```dart
// Server returns a capability reference
final counter = await client.$['makeCounter'](10);

// counter is now a proxy to the remote Counter object
print(counter.capabilityId);  // e.g., 1

// Call methods on the capability
final value = await counter['value']();        // 10
final newValue = await counter['increment'](5); // 15
```

### Passing Capabilities

Pass capabilities as arguments to other calls:

```dart
// Create two counters
final counter1 = await client.$['makeCounter'](10);
final counter2 = await client.$['makeCounter'](20);

// Pass counter1 to a method
final result = await client.$['addCounters'](counter1, counter2);
print(result);  // 30
```

### Capability-Based Security

Capabilities implement the principle of least authority:

```dart
// Authenticate and receive a scoped session capability
final session = await client.$['authenticate'](token);

// This session can only access the authenticated user's data
final profile = await session['getProfile']();    // Only your profile
final friends = await session['getFriends']();    // Only your friends

// Cannot access other users' data - the capability is scoped
```

### Capability Lifecycle

```dart
// Capabilities are automatically cleaned up when the session closes
final session = await client.$['authenticate'](token);
final fileHandle = await session['openFile']('/tmp/data.txt');

// Use the file handle
final contents = await fileHandle['read'](1024);

// When you close the session, all capabilities are released
await client.close();
// fileHandle is now invalid
```

---

## Streaming with Dart Streams

rpc_do provides first-class `Stream` support for real-time data.

### Subscribing to Events

```dart
// Subscribe to server-sent events
final Stream<Map<String, dynamic>> events =
    client.$['events']['subscribe']('user:123').asStream();

await for (final event in events) {
  print('Event: ${event['type']} - ${event['data']}');
}
```

### Bidirectional Streaming

```dart
// Connect to a chat room
final chat = await client.$['chat']['connect'](roomId);

// Send messages
chat.send({'type': 'message', 'text': 'Hello!'});

// Receive messages as a Stream
await for (final message in chat.messages) {
  print('${message['author']}: ${message['text']}');
}
```

### Stream Transformations

Use Dart's powerful stream transformations:

```dart
final events = client.$['events']['subscribe']('*').asStream();

// Transform, filter, and process
await events
    .where((e) => e['type'] == 'user.action')
    .map((e) => UserAction.fromJson(e))
    .where((action) => action.isImportant)
    .take(10)
    .forEach((action) => processAction(action));
```

### StreamController Integration

```dart
class EventManager {
  final RpcClient _client;
  final _controller = StreamController<Event>.broadcast();

  EventManager(this._client);

  Stream<Event> get events => _controller.stream;

  Future<void> start() async {
    final serverEvents = _client.$['events']['subscribe']('*').asStream();

    await for (final event in serverEvents) {
      _controller.add(Event.fromJson(event));
    }
  }

  Future<void> dispose() async {
    await _controller.close();
  }
}
```

### Backpressure Handling

```dart
// Handle slow consumers with buffering
final events = client.$['events']['subscribe']('high-volume')
    .asStream()
    .transform(StreamTransformer.fromHandlers(
      handleData: (data, sink) {
        // Process with backpressure awareness
        sink.add(data);
      },
    ));
```

---

## Error Handling

rpc_do provides sealed error classes for exhaustive pattern matching.

### Sealed Error Hierarchy

```dart
sealed class RpcError implements Exception {
  const RpcError();
}

final class RpcConnectionError extends RpcError {
  final String message;
  final Object? cause;
  const RpcConnectionError(this.message, [this.cause]);
}

final class RpcServerError extends RpcError {
  final String code;
  final String message;
  final Map<String, dynamic>? data;
  const RpcServerError({
    required this.code,
    required this.message,
    this.data,
  });
}

final class RpcTimeoutError extends RpcError {
  final Duration timeout;
  const RpcTimeoutError(this.timeout);
}

final class RpcCapabilityError extends RpcError {
  final int? capabilityId;
  final String message;
  const RpcCapabilityError(this.message, [this.capabilityId]);
}

final class RpcCancelledError extends RpcError {
  const RpcCancelledError();
}
```

### Pattern Matching

```dart
try {
  final user = await client.$['users']['get'](123);
  print('Found: ${user['name']}');
} on RpcError catch (e) {
  switch (e) {
    case RpcConnectionError(:final message):
      print('Connection failed: $message');
    case RpcServerError(code: 'NOT_FOUND'):
      print('User not found');
    case RpcServerError(code: 'UNAUTHORIZED'):
      print('Please log in');
    case RpcServerError(:final code, :final message):
      print('Server error [$code]: $message');
    case RpcTimeoutError(:final timeout):
      print('Timed out after $timeout');
    case RpcCapabilityError(:final capabilityId):
      print('Invalid capability: $capabilityId');
    case RpcCancelledError():
      print('Request was cancelled');
  }
}
```

### Result Type (Explicit Error Handling)

For those who prefer explicit error handling without exceptions:

```dart
final result = await client.$['users']['get'](123).toResult();

switch (result) {
  case Ok(:final value):
    print('Found: ${value['name']}');
  case Err(:final error):
    print('Error: $error');
}

// One-liner with pattern matching
final message = switch (await client.$['users']['get'](123).toResult()) {
  Ok(:final value) => 'Hello, ${value['name']}!',
  Err(error: RpcServerError(code: 'NOT_FOUND')) => 'User not found',
  Err(:final error) => 'Error: $error',
};
```

### Error Recovery Patterns

```dart
// Retry with exponential backoff
Future<T> withRetry<T>(
  Future<T> Function() operation, {
  int maxAttempts = 3,
  Duration baseDelay = const Duration(seconds: 1),
}) async {
  RpcError? lastError;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } on RpcError catch (e) {
      lastError = e;

      // Don't retry client errors
      if (e case RpcServerError(code: 'VALIDATION_ERROR' || 'UNAUTHORIZED')) {
        rethrow;
      }

      // Retry connection and timeout errors
      if (e case RpcConnectionError() || RpcTimeoutError()) {
        final delay = baseDelay * (1 << attempt);
        await Future.delayed(delay);
        continue;
      }

      rethrow;
    }
  }

  throw lastError!;
}

// Usage
final result = await withRetry(() => client.$['users']['get'](123));
```

### Circuit Breaker Pattern

```dart
class CircuitBreaker {
  final int failureThreshold;
  final Duration resetTimeout;

  int _failures = 0;
  DateTime? _lastFailure;
  bool _isOpen = false;

  CircuitBreaker({
    this.failureThreshold = 5,
    this.resetTimeout = const Duration(minutes: 1),
  });

  Future<T> execute<T>(Future<T> Function() operation) async {
    if (_isOpen) {
      if (_lastFailure != null &&
          DateTime.now().difference(_lastFailure!) > resetTimeout) {
        _isOpen = false;
        _failures = 0;
      } else {
        throw const RpcConnectionError('Circuit breaker is open');
      }
    }

    try {
      final result = await operation();
      _failures = 0;
      return result;
    } on RpcError catch (e) {
      _failures++;
      _lastFailure = DateTime.now();

      if (_failures >= failureThreshold) {
        _isOpen = true;
      }

      rethrow;
    }
  }
}
```

---

## Flutter Integration

### Riverpod (Recommended)

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:rpc_do/rpc_do.dart';
import 'package:rpc_do_riverpod/rpc_do_riverpod.dart';

// Session provider with automatic lifecycle
final rpcProvider = rpcSessionProvider(
  'wss://api.example.do',
  reconnect: ReconnectPolicy.exponentialBackoff(),
);

// Data providers
final userProvider = FutureProvider.family<User, int>((ref, userId) async {
  final client = ref.watch(rpcProvider);
  final data = await client.$['users']['get'](userId);
  return User.fromJson(data);
});

// Pipelined provider - single round-trip for dashboard data
final dashboardProvider = FutureProvider<DashboardData>((ref) async {
  final client = ref.watch(rpcProvider);
  final token = ref.watch(authTokenProvider);

  final auth = client.$['authenticate'](token);
  final (profile, notifications, friends) = await (
    auth['getProfile'](),
    auth['getNotifications'](),
    auth['getFriends'](),
  ).wait;

  return DashboardData(
    profile: Profile.fromJson(profile),
    notifications: (notifications as List).map(Notification.fromJson).toList(),
    friends: (friends as List).map(User.fromJson).toList(),
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
      error: (error, stack) => ErrorView(error: error),
    );
  }
}
```

#### Streaming with Riverpod

```dart
final eventsProvider = StreamProvider<Event>((ref) async* {
  final client = ref.watch(rpcProvider);
  final stream = client.$['events']['subscribe']('*').asStream();

  await for (final event in stream) {
    yield Event.fromJson(event);
  }
});

class EventsWidget extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final eventsAsync = ref.watch(eventsProvider);

    return eventsAsync.when(
      data: (event) => EventCard(event: event),
      loading: () => const Text('Connecting...'),
      error: (error, _) => Text('Error: $error'),
    );
  }
}
```

### Provider

```dart
import 'package:provider/provider.dart';
import 'package:rpc_do/rpc_do.dart';
import 'package:rpc_do_provider/rpc_do_provider.dart';

void main() {
  runApp(
    RpcProvider(
      endpoint: 'wss://api.example.do',
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
      query: (client) async {
        final data = await client.$['users']['get'](userId);
        return User.fromJson(data);
      },
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
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:rpc_do/rpc_do.dart';
import 'package:rpc_do_bloc/rpc_do_bloc.dart';

// Events
sealed class UserEvent {}
final class LoadUser extends UserEvent {
  final int id;
  LoadUser(this.id);
}
final class RefreshUser extends UserEvent {}

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
  int? _currentUserId;

  UserBloc(super.client) : super(UserInitial()) {
    on<LoadUser>(_onLoad);
    on<RefreshUser>(_onRefresh);
  }

  Future<void> _onLoad(LoadUser event, Emitter<UserState> emit) async {
    _currentUserId = event.id;
    emit(UserLoading());

    final result = await client.$['users']['get'](event.id).toResult();
    emit(switch (result) {
      Ok(:final value) => UserLoaded(User.fromJson(value)),
      Err(:final error) => UserError(error),
    });
  }

  Future<void> _onRefresh(RefreshUser event, Emitter<UserState> emit) async {
    if (_currentUserId != null) {
      add(LoadUser(_currentUserId!));
    }
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
        UserError(:final error) => ErrorCard(error: error),
      },
    );
  }
}
```

### GetX

```dart
import 'package:get/get.dart';
import 'package:rpc_do/rpc_do.dart';

class UserController extends GetxController {
  final RpcClient client;
  final user = Rxn<User>();
  final isLoading = false.obs;
  final error = Rxn<RpcError>();

  UserController(this.client);

  Future<void> loadUser(int id) async {
    isLoading.value = true;
    error.value = null;

    try {
      final data = await client.$['users']['get'](id);
      user.value = User.fromJson(data);
    } on RpcError catch (e) {
      error.value = e;
    } finally {
      isLoading.value = false;
    }
  }
}

class UserView extends GetView<UserController> {
  @override
  Widget build(BuildContext context) {
    return Obx(() {
      if (controller.isLoading.value) {
        return const CircularProgressIndicator();
      }
      if (controller.error.value != null) {
        return Text('Error: ${controller.error.value}');
      }
      final user = controller.user.value;
      if (user == null) {
        return const Text('No user loaded');
      }
      return UserCard(user: user);
    });
  }
}
```

---

## Connection Management

### Connection Options

```dart
final client = await RpcDo.builder()
    .endpoint('wss://api.example.do')
    .timeout(const Duration(seconds: 30))
    .reconnect(ReconnectPolicy.exponentialBackoff(
      initialDelay: const Duration(seconds: 1),
      maxDelay: const Duration(seconds: 30),
      maxAttempts: 10,
    ))
    .onStateChange((state) => print('Connection: $state'))
    .build();
```

### Connection Monitoring

```dart
client.onStateChange.listen((state) {
  switch (state) {
    case ConnectionState.connecting:
      print('Connecting...');
    case ConnectionState.connected:
      print('Connected!');
    case ConnectionState.reconnecting:
      print('Reconnecting...');
    case ConnectionState.disconnected:
      print('Disconnected');
  }
});
```

### Automatic Reconnection

```dart
final client = await RpcDo.connect(
  'wss://api.example.do',
  reconnect: ReconnectPolicy.exponentialBackoff(
    initialDelay: const Duration(seconds: 1),
    maxDelay: const Duration(seconds: 30),
    maxAttempts: null,  // Retry forever
    jitter: 0.1,        // Add 10% jitter to prevent thundering herd
  ),
);

// Connection automatically reconnects on failure
// Pending requests are retried after reconnection
```

### Multiple Connections

```dart
// Connect to different .do services
final mongo = await RpcDo.connect('wss://mongo.do');
final kafka = await RpcDo.connect('wss://kafka.do');
final cache = await RpcDo.connect('wss://cache.do');

// Use them together
final users = await mongo.$['users']['find']({'active': true});

for (final user in users) {
  await kafka.$['events']['publish']('user.sync', user);
  await cache.$['users']['set'](user['id'], user);
}

// Clean up all
await Future.wait([mongo.close(), kafka.close(), cache.close()]);
```

### Graceful Cleanup

```dart
// Always dispose when done
await client.close();

// Or use try/finally
final client = await RpcDo.connect('wss://api.example.do');
try {
  // ... use client
} finally {
  await client.close();
}

// In Flutter, dispose in StatefulWidget or use hooks
class MyWidget extends StatefulWidget {
  @override
  State<MyWidget> createState() => _MyWidgetState();
}

class _MyWidgetState extends State<MyWidget> {
  late final RpcClient _client;

  @override
  void initState() {
    super.initState();
    _initClient();
  }

  Future<void> _initClient() async {
    _client = await RpcDo.connect('wss://api.example.do');
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }
}
```

---

## Cancellation

### CancelToken

```dart
final cancelToken = CancelToken();

try {
  final result = await client
      .$['longRunningOperation']()
      .withCancelToken(cancelToken);
  print('Result: $result');
} on RpcCancelledError {
  print('Operation was cancelled');
}

// Cancel from elsewhere (e.g., user pressed back button)
cancelToken.cancel();
```

### Timeout with Cancellation

```dart
final cancelToken = CancelToken();

// Cancel after 10 seconds
Timer(const Duration(seconds: 10), cancelToken.cancel);

try {
  final result = await client
      .$['veryLongOperation']()
      .withCancelToken(cancelToken);
  print('Completed: $result');
} on RpcCancelledError {
  print('Timed out or cancelled');
}
```

### Cancellation in Flutter

```dart
class SearchWidget extends StatefulWidget {
  @override
  State<SearchWidget> createState() => _SearchWidgetState();
}

class _SearchWidgetState extends State<SearchWidget> {
  final _controller = TextEditingController();
  CancelToken? _cancelToken;
  List<SearchResult> _results = [];

  void _onSearchChanged(String query) {
    // Cancel previous search
    _cancelToken?.cancel();
    _cancelToken = CancelToken();

    _performSearch(query, _cancelToken!);
  }

  Future<void> _performSearch(String query, CancelToken token) async {
    try {
      final results = await widget.client
          .$['search'](query)
          .withCancelToken(token);

      if (mounted) {
        setState(() {
          _results = (results as List)
              .map((r) => SearchResult.fromJson(r))
              .toList();
        });
      }
    } on RpcCancelledError {
      // Ignore - search was cancelled
    }
  }

  @override
  void dispose() {
    _cancelToken?.cancel();
    _controller.dispose();
    super.dispose();
  }
}
```

---

## HTTP Batch Mode

For stateless HTTP backends, batch multiple calls into a single request:

```dart
final results = await RpcDo.batch(
  'https://api.example.do/rpc',
  (api) async {
    return (
      await api.$['users']['get'](123),
      await api.$['profiles']['get'](123),
      await api.$['settings']['get'](123),
    );
  },
);

final (user, profile, settings) = results;
```

### Batch with Error Handling

```dart
final results = await RpcDo.batch(
  'https://api.example.do/rpc',
  (api) async {
    final userResult = await api.$['users']['get'](123).toResult();
    final profileResult = await api.$['profiles']['get'](123).toResult();

    return (userResult, profileResult);
  },
);

final (userResult, profileResult) = results;

if (userResult case Ok(:final value)) {
  print('User: ${value['name']}');
}
```

---

## Interceptors

Add cross-cutting concerns like logging, metrics, and authentication.

### Request Interceptor

```dart
final client = await RpcDo.builder()
    .endpoint('wss://api.example.do')
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

### Multiple Interceptors

```dart
final client = await RpcDo.builder()
    .endpoint('wss://api.example.do')
    .interceptor(loggingInterceptor)
    .interceptor(authInterceptor)
    .interceptor(metricsInterceptor)
    .build();

// Interceptors are called in order:
// loggingInterceptor -> authInterceptor -> metricsInterceptor -> network
```

### Retry Interceptor

```dart
Interceptor retryInterceptor({
  int maxRetries = 3,
  Duration baseDelay = const Duration(seconds: 1),
}) {
  return (request, next) async {
    RpcError? lastError;

    for (var i = 0; i < maxRetries; i++) {
      try {
        return await next(request);
      } on RpcConnectionError catch (e) {
        lastError = e;
        await Future.delayed(baseDelay * (1 << i));
      } on RpcTimeoutError catch (e) {
        lastError = e;
        await Future.delayed(baseDelay * (1 << i));
      }
    }

    throw lastError!;
  };
}
```

### Caching Interceptor

```dart
Interceptor cachingInterceptor(Duration ttl) {
  final cache = <String, (DateTime, dynamic)>{};

  return (request, next) async {
    // Only cache GET-like operations
    if (!request.method.startsWith('get')) {
      return next(request);
    }

    final key = '${request.method}:${jsonEncode(request.args)}';
    final cached = cache[key];

    if (cached != null) {
      final (timestamp, value) = cached;
      if (DateTime.now().difference(timestamp) < ttl) {
        return value;
      }
    }

    final result = await next(request);
    cache[key] = (DateTime.now(), result);
    return result;
  };
}
```

---

## Testing

### Mock Client

```dart
import 'package:rpc_do/testing.dart';
import 'package:test/test.dart';

void main() {
  group('UserService', () {
    late MockRpcClient mockClient;

    setUp(() {
      mockClient = MockRpcClient();
    });

    test('should fetch user', () async {
      // Arrange
      mockClient.when(['users', 'get'], [123]).thenReturn({
        'id': 123,
        'name': 'John Doe',
        'email': 'john@example.com',
      });

      // Act
      final user = await mockClient.$['users']['get'](123);

      // Assert
      expect(user['name'], equals('John Doe'));
      mockClient.verify(['users', 'get'], [123]).called(1);
    });

    test('should handle errors', () async {
      // Arrange
      mockClient.when(['users', 'get'], [999]).thenThrow(
        const RpcServerError(code: 'NOT_FOUND', message: 'User not found'),
      );

      // Act & Assert
      expect(
        () => mockClient.$['users']['get'](999),
        throwsA(isA<RpcServerError>()),
      );
    });
  });
}
```

### Mock Server for Integration Tests

```dart
import 'package:rpc_do/testing.dart';
import 'package:test/test.dart';

void main() {
  group('Integration tests', () {
    late MockRpcServer server;
    late RpcClient client;

    setUp(() async {
      server = MockRpcServer();

      // Register handlers
      server.handle('square', (args) => args[0] * args[0]);
      server.handle('users.get', (args) => {
        'id': args[0],
        'name': 'Test User',
      });

      client = await RpcDo.connect(server.url);
    });

    tearDown(() async {
      await client.close();
      await server.close();
    });

    test('should call square', () async {
      final result = await client.$['square'](5);
      expect(result, equals(25));
    });

    test('should pipeline calls', () async {
      final user = client.$['users']['get'](123);
      final name = user['name'];

      final result = await name;
      expect(result, equals('Test User'));
    });
  });
}
```

### Testing with Flutter

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:rpc_do/testing.dart';

void main() {
  testWidgets('UserScreen displays user data', (tester) async {
    final mockClient = MockRpcClient();
    mockClient.when(['users', 'get'], [123]).thenReturn({
      'id': 123,
      'name': 'John Doe',
    });

    await tester.pumpWidget(
      MaterialApp(
        home: RpcProvider.value(
          client: mockClient,
          child: const UserScreen(userId: 123),
        ),
      ),
    );

    // Wait for async data
    await tester.pumpAndSettle();

    expect(find.text('John Doe'), findsOneWidget);
  });
}
```

### Conformance Tests

The package includes conformance tests that verify behavior against the capnweb specification:

```bash
dart test
```

---

## Advanced Patterns

### Singleton Client

```dart
class RpcClientSingleton {
  static RpcClient? _instance;

  static Future<RpcClient> getInstance() async {
    return _instance ??= await RpcDo.connect(
      const String.fromEnvironment('API_URL'),
    );
  }

  static Future<void> dispose() async {
    await _instance?.close();
    _instance = null;
  }
}

// Usage
final client = await RpcClientSingleton.getInstance();
final user = await client.$['users']['get'](123);
```

### Request Context

```dart
class RequestContext {
  final String userId;
  final String requestId;
  final String traceId;

  const RequestContext({
    required this.userId,
    required this.requestId,
    required this.traceId,
  });
}

extension RpcClientContext on RpcClient {
  Future<T> withContext<T>(
    RequestContext context,
    Future<T> Function(RpcClient) operation,
  ) async {
    // Add context headers to all requests in this scope
    final scopedClient = withHeaders({
      'X-User-ID': context.userId,
      'X-Request-ID': context.requestId,
      'X-Trace-ID': context.traceId,
    });

    return operation(scopedClient);
  }
}

// Usage
final result = await client.withContext(
  RequestContext(
    userId: 'user_abc',
    requestId: generateUuid(),
    traceId: generateTraceId(),
  ),
  (client) => client.$['users']['get'](123),
);
```

### Repository Pattern

```dart
abstract class UserRepository {
  Future<User> get(int id);
  Future<List<User>> list({String? filter, int limit = 50});
  Future<User> create(CreateUserInput input);
  Future<User> update(int id, UpdateUserInput input);
  Future<void> delete(int id);
}

class RpcUserRepository implements UserRepository {
  final RpcClient _client;

  RpcUserRepository(this._client);

  @override
  Future<User> get(int id) async {
    final data = await _client.$['users']['get'](id);
    return User.fromJson(data);
  }

  @override
  Future<List<User>> list({String? filter, int limit = 50}) async {
    final data = await _client.$['users']['list']({
      if (filter != null) 'filter': filter,
      'limit': limit,
    });
    return (data as List).map((u) => User.fromJson(u)).toList();
  }

  @override
  Future<User> create(CreateUserInput input) async {
    final data = await _client.$['users']['create'](input.toJson());
    return User.fromJson(data);
  }

  @override
  Future<User> update(int id, UpdateUserInput input) async {
    final data = await _client.$['users']['update'](id, input.toJson());
    return User.fromJson(data);
  }

  @override
  Future<void> delete(int id) async {
    await _client.$['users']['delete'](id);
  }
}
```

### Unit of Work Pattern

```dart
class UnitOfWork {
  final RpcClient _client;
  final List<Future<void>> _operations = [];

  UnitOfWork(this._client);

  void add<T>(Future<T> operation) {
    _operations.add(operation.then((_) {}));
  }

  Future<void> commit() async {
    await Future.wait(_operations);
    _operations.clear();
  }

  Future<void> rollback() async {
    _operations.clear();
    // Optionally call a rollback endpoint
    await _client.$['transaction']['rollback']();
  }
}

// Usage
final uow = UnitOfWork(client);

uow.add(client.$['users']['create']({'name': 'John'}));
uow.add(client.$['profiles']['create']({'userId': 1}));
uow.add(client.$['settings']['create']({'userId': 1}));

await uow.commit();
```

### Offline Support

```dart
class OfflineRpcClient {
  final RpcClient _client;
  final LocalStorage _storage;
  final Queue<PendingOperation> _pendingQueue;

  OfflineRpcClient(this._client, this._storage, this._pendingQueue);

  Future<T> call<T>(List<String> path, List<dynamic> args) async {
    if (await _client.isConnected) {
      // Online - execute and cache
      final result = await _client.call(path, args);
      await _storage.cache(path, args, result);
      return result as T;
    } else {
      // Offline - queue for later or return cached
      final cached = await _storage.getCached(path, args);
      if (cached != null) {
        return cached as T;
      }

      // Queue write operations for later
      if (_isWriteOperation(path)) {
        await _pendingQueue.add(PendingOperation(path, args));
        throw const RpcConnectionError('Queued for sync');
      }

      throw const RpcConnectionError('Offline and no cached data');
    }
  }

  Future<void> syncPending() async {
    while (_pendingQueue.isNotEmpty) {
      final op = _pendingQueue.peek();
      try {
        await _client.call(op.path, op.args);
        _pendingQueue.remove();
      } on RpcError {
        break; // Stop on first error
      }
    }
  }
}
```

---

## Dart 3 Features

### Records and Parallel Await

```dart
// Fetch multiple resources in parallel
final (user, profile, settings) = await (
  client.$['users']['get'](123),
  client.$['profiles']['get'](123),
  client.$['settings']['get'](123),
).wait;
```

### Pattern Matching

```dart
// Destructure results
final result = await client.$['users']['get'](123);
final {'name': String name, 'email': String email} = result;
print('User: $name <$email>');

// Guard patterns
Future<void> processResult(dynamic result) async {
  switch (result) {
    case {'status': 'success', 'data': final data}:
      print('Success: $data');
    case {'status': 'error', 'message': final message}:
      print('Error: $message');
    case {'status': 'pending'}:
      print('Still processing...');
    default:
      print('Unknown result format');
  }
}
```

### Sealed Classes for State

```dart
sealed class FetchState<T> {
  const FetchState();
}

final class FetchInitial<T> extends FetchState<T> {
  const FetchInitial();
}

final class FetchLoading<T> extends FetchState<T> {
  const FetchLoading();
}

final class FetchSuccess<T> extends FetchState<T> {
  final T data;
  const FetchSuccess(this.data);
}

final class FetchFailure<T> extends FetchState<T> {
  final RpcError error;
  const FetchFailure(this.error);
}

// Usage with exhaustive matching
Widget buildWidget(FetchState<User> state) {
  return switch (state) {
    FetchInitial() => const Text('Press to load'),
    FetchLoading() => const CircularProgressIndicator(),
    FetchSuccess(:final data) => UserCard(user: data),
    FetchFailure(:final error) => ErrorCard(error: error),
  };
}
```

### Extension Types

```dart
extension type UserId(int value) {
  factory UserId.fromJson(dynamic json) => UserId(json as int);
  int toJson() => value;
}

extension type const Email(String value) {
  bool get isValid => value.contains('@');
}

// Type-safe IDs without runtime overhead
Future<User> getUser(UserId id) async {
  final data = await client.$['users']['get'](id.value);
  return User.fromJson(data);
}
```

---

## API Reference

### RpcDo

```dart
abstract final class RpcDo {
  /// Connect via WebSocket
  static Future<RpcClient> connect(
    String url, {
    Duration? timeout,
    String? token,
    Map<String, String>? headers,
    ReconnectPolicy? reconnect,
  });

  /// Builder for advanced configuration
  static RpcClientBuilder builder();

  /// HTTP batch mode
  static Future<T> batch<T>(
    String url,
    Future<T> Function(RpcClient api) builder,
  );
}
```

### RpcClient

```dart
abstract class RpcClient {
  /// Access the magic proxy
  RpcProxy get $;

  /// Connection state stream
  Stream<ConnectionState> get onStateChange;

  /// Whether currently connected
  bool get isConnected;

  /// Make a raw RPC call
  RpcPromise<T> call<T>(List<String> path, List<dynamic> args);

  /// Server-side map operation
  Future<List<R>> serverMap<T, R>(
    List<T> items,
    Future<R> Function(T item) transform,
  );

  /// Close the connection
  Future<void> close();
}
```

### RpcProxy

```dart
abstract class RpcProxy {
  /// Access nested property
  RpcProxy operator [](String key);

  /// Invoke as method
  RpcPromise<T> call<T>(List<dynamic> args);
}
```

### RpcPromise

```dart
abstract class RpcPromise<T> implements Future<T> {
  /// Server-side map transformation
  RpcPromise<List<R>> map<R>(FutureOr<R> Function(dynamic x) transform);

  /// Filter elements
  RpcPromise<List<T>> filter(FutureOr<bool> Function(T x) predicate);

  /// Reduce to single value
  RpcPromise<R> reduce<R>(
    FutureOr<R> Function(R acc, T x) combine, {
    required R initial,
  });

  /// Convert to Result for explicit error handling
  Future<Result<T, RpcError>> toResult();

  /// Attach cancellation token
  RpcPromise<T> withCancelToken(CancelToken token);

  /// Access property on eventual result (pipelining)
  RpcProxy operator [](String key);
}
```

### Error Classes

```dart
sealed class RpcError implements Exception {}

final class RpcConnectionError extends RpcError {
  final String message;
  final Object? cause;
}

final class RpcServerError extends RpcError {
  final String code;
  final String message;
  final Map<String, dynamic>? data;
}

final class RpcTimeoutError extends RpcError {
  final Duration timeout;
}

final class RpcCapabilityError extends RpcError {
  final int? capabilityId;
  final String message;
}

final class RpcCancelledError extends RpcError {}
```

---

## Complete Example

A comprehensive example demonstrating all major features:

```dart
#!/usr/bin/env dart
/// Complete rpc_do example: A todo application with capabilities,
/// pipelining, server-side mapping, streaming, and error handling.

import 'dart:async';
import 'package:rpc_do/rpc_do.dart';

// ---- Type Definitions ----

class User {
  final int id;
  final String name;
  final String email;

  User({required this.id, required this.name, required this.email});

  factory User.fromJson(Map<String, dynamic> json) => User(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String,
      );
}

class Todo {
  final int id;
  final String title;
  final bool done;

  Todo({required this.id, required this.title, required this.done});

  factory Todo.fromJson(Map<String, dynamic> json) => Todo(
        id: json['id'] as int,
        title: json['title'] as String,
        done: json['done'] as bool,
      );
}

// ---- Main Application ----

Future<void> main() async {
  final token = const String.fromEnvironment('API_TOKEN', defaultValue: 'demo-token');

  print('Connecting to Todo API...\n');
  final client = await RpcDo.connect(
    'wss://todo.example.do',
    token: token,
    timeout: const Duration(seconds: 30),
    reconnect: ReconnectPolicy.exponentialBackoff(),
  );

  // Monitor connection state
  client.onStateChange.listen((state) {
    print('Connection state: $state');
  });

  try {
    // ---- 1. Pipelined Authentication (one round trip) ----
    print('1. Pipelined authentication');

    // These calls are pipelined - only one round trip!
    final session = client.$['authenticate'](token);
    final userPromise = session['getUser']();
    final todosPromise = session['getTodos']();

    final (userData, todosData) = await (userPromise, todosPromise).wait;
    final user = User.fromJson(userData);
    final todos = (todosData as List).map((t) => Todo.fromJson(t)).toList();

    print('   Welcome, ${user.name}!');
    print('   You have ${todos.length} todos\n');

    // ---- 2. Capability Usage ----
    print('2. Using capabilities');

    // Get a capability to the todo list
    final todoList = await session['todoList']();

    // Create a new todo using the capability
    final newTodoData = await todoList['add']('Learn rpc_do');
    final newTodo = Todo.fromJson(newTodoData);
    print('   Created: "${newTodo.title}" (id: ${newTodo.id})\n');

    // ---- 3. Server-Side Mapping (eliminates N+1) ----
    print('3. Server-side mapping');

    // Generate fibonacci numbers and square them - all server-side
    final fibs = await client.$['generateFibonacci'](8);
    print('   Fibonacci: $fibs');

    final squared = await client
        .$['generateFibonacci'](8)
        .map((x) => client.$['square'](x));
    print('   Squared:   $squared\n');

    // ---- 4. Parallel Pipelines with Records ----
    print('4. Parallel pipelines');

    final auth = client.$['authenticate'](token);
    final (profile, friends, notifications) = await (
      auth['getProfile'](),
      auth['getFriends'](),
      auth['getNotifications'](),
    ).wait;

    print('   Profile: ${profile['displayName']}');
    print('   Friends: ${(friends as List).length}');
    print('   Notifications: ${(notifications as List).length}\n');

    // ---- 5. Streaming ----
    print('5. Streaming events');

    final events = client.$['events']['subscribe']('todos').asStream();

    // Take first 3 events
    await for (final event in events.take(3)) {
      print('   Event: ${event['type']} - ${event['data']}');
    }
    print('');

    // ---- 6. Error Handling with Pattern Matching ----
    print('6. Error handling');

    try {
      await todoList['get'](99999);
    } on RpcError catch (e) {
      switch (e) {
        case RpcServerError(code: 'NOT_FOUND', :final message):
          print('   Expected error: NOT_FOUND - $message');
        case RpcServerError(:final code, :final message):
          print('   Unexpected server error [$code]: $message');
        case RpcConnectionError(:final message):
          print('   Connection error: $message');
        case RpcTimeoutError(:final timeout):
          print('   Timeout after $timeout');
        case RpcCapabilityError(:final message):
          print('   Capability error: $message');
        case RpcCancelledError():
          print('   Cancelled');
      }
    }

    // ---- 7. Result Type ----
    print('\n7. Explicit error handling with Result');

    final result = await todoList['get'](newTodo.id).toResult();
    final message = switch (result) {
      Ok(:final value) => 'Found todo: ${value['title']}',
      Err(error: RpcServerError(code: 'NOT_FOUND')) => 'Todo not found',
      Err(:final error) => 'Error: $error',
    };
    print('   $message');

    // ---- 8. Cleanup ----
    print('\n8. Cleanup');

    await todoList['delete'](newTodo.id);
    print('   Deleted todo ${newTodo.id}');

    print('\nDone!');
  } on RpcError catch (e) {
    print('Fatal error: $e');
  } finally {
    await client.close();
  }
}
```

---

## Related Packages

| Package | Description |
|---------|-------------|
| [capnweb](https://pub.dev/packages/capnweb) | The underlying RPC protocol |
| [rpc_do_riverpod](https://pub.dev/packages/rpc_do_riverpod) | Riverpod integration |
| [rpc_do_provider](https://pub.dev/packages/rpc_do_provider) | Provider integration |
| [rpc_do_bloc](https://pub.dev/packages/rpc_do_bloc) | BLoC integration |
| [mongo_do](https://pub.dev/packages/mongo_do) | MongoDB client built on rpc_do |
| [kafka_do](https://pub.dev/packages/kafka_do) | Kafka client built on rpc_do |
| [database_do](https://pub.dev/packages/database_do) | Generic database client |

---

## Design Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Zero boilerplate** | No schemas, no codegen, no build step |
| **Magic when you want it** | `api.$['anything']()` just works |
| **Types when you need them** | Full type annotations optional |
| **Dart-native** | async/await, Streams, sealed classes |
| **One round trip** | Pipelining by default |
| **Flutter-first** | State management integrations built-in |

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Contributing

Contributions are welcome! Please see the main [dot-do/sdks](https://github.com/dot-do/sdks) repository for contribution guidelines.
