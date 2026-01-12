# Cap'n Web Dart Client: Syntax Exploration

This document explores four divergent syntax approaches for the Dart implementation of Cap'n Web (`capnweb` on pub.dev), a bidirectional capability-based RPC protocol over JSON.

## Background

Cap'n Web's core abstractions are:

- **Stubs (RpcStub)**: Proxies representing remote objects; any method call generates a network request
- **Promises with Pipelining (RpcPromise)**: Lazy promises that support chained calls without awaiting intermediate results
- **Targets (RpcTarget)**: Local objects exposed for remote invocation
- **Sessions**: WebSocket (persistent), HTTP Batch (stateless), or MessagePort transports

## Design Goals

A Dart/Flutter developer should say: "This feels native to Dart." That means:

1. **First-class async/await** with `Future<T>` and `Stream<T>`
2. **Sound null safety** throughout the API
3. **Extension methods** for ergonomic API additions
4. **Factory constructors** and named constructors for clarity
5. **Mixins** for composable behavior
6. **Flutter integration** patterns (Provider, Riverpod, BLoC compatibility)

---

## Reference: How Other Dart Libraries Do It

### gRPC-Dart
```dart
final channel = ClientChannel('api.example.com', port: 443);
final client = GreeterClient(channel);
final response = await client.sayHello(HelloRequest()..name = 'World');
```

### Dio (HTTP Client)
```dart
final dio = Dio();
final response = await dio.get('/users/123');
```

### Firebase Realtime Database
```dart
final ref = FirebaseDatabase.instance.ref('users/123');
final snapshot = await ref.get();
final name = snapshot.child('name').value;
```

### Riverpod
```dart
final userProvider = FutureProvider.family<User, int>((ref, id) async {
  return api.getUser(id);
});
```

---

## Approach 1: `noSuchMethod` with Fluent Chaining

This approach leverages Dart's `noSuchMethod` to create dynamic proxies where any method call or property access is forwarded to the remote server.

### Philosophy
- **Maximum fluency**: Chain calls naturally without ceremony
- **Pipelining is invisible**: Just write sequential code
- **Dynamic but typed results**: Use type annotations on await for IDE support

### Connection/Session Creation

```dart
import 'package:capnweb/capnweb.dart';

// WebSocket session (persistent connection)
final api = await CapnWeb.connect('wss://api.example.com');

// HTTP batch session (single request with multiple calls)
final results = await CapnWeb.batch('https://api.example.com/rpc', (api) async {
  final user = api.users.get(123);
  final profile = api.profiles.get(user.id);
  return (await user, await profile);
});

// With type annotation for IDE support
final RpcStub<MyApi> api = await CapnWeb.connect('wss://api.example.com');

// Builder pattern for complex configuration
final api = await CapnWeb.builder()
    .endpoint('wss://api.example.com')
    .transport(Transport.webSocket)
    .timeout(Duration(seconds: 30))
    .reconnectPolicy(ReconnectPolicy.exponentialBackoff())
    .build();
```

### Making RPC Calls

```dart
// The RpcStub class uses noSuchMethod to intercept all calls
@proxy
class RpcStub<T> {
  final StubHook _hook;
  final List<String> _path;

  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isMethod) {
      // Return RpcPromise for method calls
      final args = invocation.positionalArguments;
      return RpcPromise(_hook.call(_path, args));
    } else if (invocation.isGetter) {
      // Return nested RpcStub for property access
      return RpcStub(_hook, [..._path, invocation.memberName.toString()]);
    }
    throw UnsupportedError('Setters not supported on RPC stubs');
  }
}

// Usage - completely dynamic
final greeting = await api.greet('World');
final user = await api.users.get(123);
final name = await api.users.get(123).profile.name;

// With type hints for better IDE experience
final User user = await api.users.get(123);
```

### Pipelining Syntax

```dart
// Pipelining is just chaining - no special syntax needed!
// All calls are batched into a single round-trip
final userName = await api.authenticate(token).getUserName();

// Property access on unresolved promises
final profile = api.users.get(123);  // Returns RpcPromise, not awaited
final name = await profile.name;     // Pipelines through the promise

// Complex pipelining
final authedApi = api.authenticate(apiToken);  // RpcPromise
final userId = authedApi.getUserId();          // Pipelined call
final profile = api.getUserProfile(userId);    // Uses promise as parameter
final friends = authedApi.getFriendIds();      // Another pipelined call

// Await only what you need - one round trip!
final (profileResult, friendsResult) = await (profile, friends).wait;
```

### Error Handling

```dart
// Standard try/catch with typed exceptions
try {
  final result = await api.riskyOperation();
} on RpcException catch (e) {
  switch (e) {
    case RpcConnectionException(:final reason):
      print('Connection lost: $reason');
    case RpcRemoteException(:final type, :final message):
      print('Server error: $type - $message');
    case RpcTimeoutException():
      print('Request timed out');
  }
}

// Broken stub monitoring
api.onBroken.listen((error) {
  print('API connection broken: $error');
});

// Result pattern for explicit error handling (no exceptions)
final result = await api.getUser(123).asResult();
switch (result) {
  case Ok(:final value):
    print('User: ${value.name}');
  case Err(:final error):
    print('Error: $error');
}
```

### Exposing Local Objects as RPC Targets

```dart
// Extend RpcTarget and define methods
class UserService extends RpcTarget {
  final Database _db;
  UserService(this._db);

  Future<User> getUser(int id) async {
    return await _db.fetchUser(id);
  }

  Future<void> updateUser(User user) async {
    await _db.save(user);
  }

  // Nested capability - returns another target
  CommentService comments(int userId) {
    return CommentService(_db, userId);
  }
}

// Expose to remote callers
final session = await CapnWeb.connect(
  'wss://api.example.com',
  expose: {'users': UserService(db)},
);

// Or return as capability in RPC response
class ApiRoot extends RpcTarget {
  UserService authenticate(String token) {
    final user = validateToken(token);
    return UserService(db, user);
  }
}
```

### Full Example

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  // Connect
  final api = await CapnWeb.connect('wss://api.example.com');

  // Pipeline multiple calls
  final authedApi = api.authenticate(myToken);
  final userId = authedApi.getUserId();
  final profile = api.getUserProfile(userId);

  // Single round-trip for all calls
  final UserProfile result = await profile;
  print('Hello, ${result.name}!');

  // Clean up
  api.dispose();
}
```

### Pros
- Extremely fluid, JavaScript-like syntax
- Pipelining is completely invisible
- Minimal ceremony for simple cases

### Cons
- Limited compile-time type checking
- IDE autocomplete only works with explicit type annotations
- `@proxy` annotation required, which has some limitations
- Less discoverable API

---

## Approach 2: Code-Generated Typed Stubs

This approach uses `build_runner` and code generation to create fully typed stub classes from interface definitions, similar to how `json_serializable` or `freezed` work.

### Philosophy
- **Maximum type safety**: Full compile-time checking
- **Excellent IDE support**: Autocomplete, refactoring, go-to-definition
- **Explicit pipelining**: Type-safe pipeline composition

### Interface Definition

```dart
// Define your API using annotations
import 'package:capnweb/capnweb.dart';

part 'api.g.dart';  // Generated file

@RpcInterface()
abstract class UserApi {
  Future<List<User>> list(String category);

  Future<User> getById(int id);

  @RpcPipeline()  // Returns a capability, not a resolved value
  AuthedApi authenticate(String token);

  Future<UserProfile> getUserProfile(int userId);
}

@RpcInterface()
abstract class AuthedApi {
  Future<int> getUserId();
  Future<List<int>> getFriendIds();
}
```

### Generated Code (simplified)

```dart
// Generated by capnweb_generator
part of 'api.dart';

class UserApiStub implements UserApi {
  final RpcSession _session;
  final int _importId;

  UserApiStub._(this._session, this._importId);

  @override
  RpcPromise<List<User>> list(String category) {
    return _session.call<List<User>>(_importId, 'list', [category]);
  }

  @override
  RpcPromise<User> getById(int id) {
    return _session.call<User>(_importId, 'getById', [id]);
  }

  @override
  RpcPromise<AuthedApiStub> authenticate(String token) {
    return _session.call<AuthedApiStub>(_importId, 'authenticate', [token]);
  }

  @override
  RpcPromise<UserProfile> getUserProfile(int userId) {
    return _session.call<UserProfile>(_importId, 'getUserProfile', [userId]);
  }
}
```

### Connection/Session Creation

```dart
// Type-safe connection
final session = await RpcSession.connect<UserApi>('wss://api.example.com');
final UserApi api = session.stub;

// Builder pattern for complex configuration
final session = await RpcSession.builder<UserApi>()
    .endpoint('wss://api.example.com')
    .transport(Transport.webSocket)
    .timeout(Duration(seconds: 30))
    .retryPolicy(RetryPolicy.exponential(maxAttempts: 3))
    .build();
```

### Pipelining with RpcPromise Extensions

```dart
// RpcPromise<T> extends Future<T> but adds pipelining methods
extension RpcPromiseExtensions<T> on RpcPromise<T> {
  /// Call a method on the eventual result without awaiting
  RpcPromise<R> pipe<R>(RpcPromise<R> Function(T) method);

  /// Access a property on the eventual result
  RpcPromise<R> prop<R>(R Function(T) getter);

  /// Transform the result (executed remotely via map)
  RpcPromise<R> map<R>(R Function(T) transform);
}

// Usage - all calls batched into single round-trip
final RpcPromise<AuthedApiStub> authedApi = api.authenticate(token);
final RpcPromise<int> userId = authedApi.pipe((a) => a.getUserId());
final RpcPromise<UserProfile> profile = api.getUserProfile(userId);

// Single await executes entire pipeline
final UserProfile result = await profile;

// Fluent chaining
final result = await api
    .authenticate(token)
    .pipe((auth) => auth.getUserId())
    .pipe((id) => api.getUserProfile(id));
```

### Collection Mapping

```dart
// Remote .map() - transforms data without pulling it locally
final RpcPromise<List<int>> friendIds = authedApi.getFriendIds();

// The lambda is serialized and executed remotely
final RpcPromise<List<UserProfile>> profiles = friendIds.mapEach(
  (id) => api.getUserProfile(id),
);

// All in one round-trip!
final List<UserProfile> results = await profiles;
```

### Error Handling with Sealed Classes

```dart
// Sealed class hierarchy for exhaustive pattern matching
sealed class RpcResult<T> {
  const RpcResult();
}

final class RpcSuccess<T> extends RpcResult<T> {
  final T value;
  const RpcSuccess(this.value);
}

final class RpcFailure<T> extends RpcResult<T> {
  final RpcError error;
  const RpcFailure(this.error);
}

sealed class RpcError {
  const RpcError();
}

final class RpcNotFoundError extends RpcError {
  final String resource;
  const RpcNotFoundError(this.resource);
}

final class RpcPermissionDeniedError extends RpcError {
  final String reason;
  const RpcPermissionDeniedError(this.reason);
}

final class RpcNetworkError extends RpcError {
  final Object? cause;
  const RpcNetworkError([this.cause]);
}

// Usage with pattern matching
final result = await api.getById(123).toResult();
final message = switch (result) {
  RpcSuccess(:final value) => 'Found: ${value.name}',
  RpcFailure(error: RpcNotFoundError(:final resource)) => 'Not found: $resource',
  RpcFailure(error: RpcPermissionDeniedError(:final reason)) => 'Denied: $reason',
  RpcFailure(:final error) => 'Error: $error',
};
```

### Exposing Local Objects as RPC Targets

```dart
// Implement the generated interface
@RpcTarget()
class UserServiceImpl implements UserApi {
  final Database _db;
  UserServiceImpl(this._db);

  @override
  Future<List<User>> list(String category) async {
    return await _db.queryUsers(category);
  }

  @override
  Future<User> getById(int id) async {
    return await _db.getUser(id);
  }

  @override
  AuthedApiImpl authenticate(String token) {
    final user = validateToken(token);
    return AuthedApiImpl(_db, user);
  }

  @override
  Future<UserProfile> getUserProfile(int userId) async {
    return await _db.getProfile(userId);
  }
}

// Register with session
final session = await RpcSession.accept(
  webSocket,
  target: UserServiceImpl(db),
);
```

### Full Example

```dart
import 'package:capnweb/capnweb.dart';
import 'api.dart';

void main() async {
  // Type-safe session
  final session = await RpcSession.connect<UserApi>('wss://api.example.com');
  final api = session.stub;

  // Type-safe pipelining
  final result = await api
      .authenticate(myToken)
      .pipe((auth) => auth.getUserId())
      .pipe((userId) => api.getUserProfile(userId));

  print('Hello, ${result.name}!');

  // Map over collections remotely
  final friendProfiles = await api
      .authenticate(myToken)
      .pipe((auth) => auth.getFriendIds())
      .mapEach((id) => api.getUserProfile(id));

  for (final friend in friendProfiles) {
    print('  Friend: ${friend.name}');
  }

  await session.close();
}
```

### Pros
- Full compile-time type safety
- Excellent IDE support (autocomplete, refactoring)
- Pattern matching on errors
- Clear separation of interface and implementation

### Cons
- Requires `build_runner` and code generation
- More setup overhead
- Generated code can be verbose
- Pipelining syntax more explicit than Approach 1

---

## Approach 3: Extension Types with Records

This approach leverages Dart 3's extension types and records for a zero-cost abstraction that feels native while maintaining type safety.

### Philosophy
- **Zero-cost abstractions**: Extension types compile away
- **Record-based pipelining**: Use records for multi-value returns
- **Pattern matching**: Leverage Dart 3's enhanced patterns

### Core Types Using Extension Types

```dart
/// Extension type wrapping a remote capability reference
extension type RpcRef<T>._(int _id) {
  /// Get a property from the remote object
  RpcPromise<R> operator [](String property) =>
      RpcPromise._(_id, [property]);

  /// Call a method on the remote object
  RpcPromise<R> call<R>(String method, [List<Object?> args = const []]) =>
      RpcPromise._(_id, [], method, args);
}

/// Extension type for promise pipelining
extension type RpcPromise<T>._(({int id, List<String> path, String? method, List<Object?>? args}) _data) {
  /// Chain another call onto this promise
  RpcPromise<R> then<R>(String method, [List<Object?> args = const []]) =>
      RpcPromise._((_data.id, [..._data.path], method, args));

  /// Access a property on the eventual result
  RpcPromise<R> operator [](String property) =>
      RpcPromise._((_data.id, [..._data.path, property], null, null));

  /// Resolve the promise (triggers network request)
  Future<T> get value async {
    // Implementation
  }
}
```

### Connection/Session Creation

```dart
import 'package:capnweb/capnweb.dart';

// Factory function returns typed reference
final api = await CapnWeb.connect<Api>('wss://api.example.com');

// Extension type ensures type safety
final RpcRef<UserApi> users = api['users'];
final RpcRef<AuthApi> auth = api['auth'];

// Or use record destructuring for multiple capabilities
final (users: RpcRef<UserApi> users, auth: RpcRef<AuthApi> auth) =
    await CapnWeb.connect('wss://api.example.com');
```

### Making RPC Calls

```dart
// Call methods with type-safe results
final RpcPromise<User> userPromise = users.call<User>('getById', [123]);

// Resolve when needed
final User user = await userPromise.value;

// Or use extension methods for cleaner syntax
extension UserApiCalls on RpcRef<UserApi> {
  RpcPromise<User> getById(int id) => call('getById', [id]);
  RpcPromise<List<User>> list(String category) => call('list', [category]);
}

// Now you get nice syntax
final user = await users.getById(123).value;
```

### Pipelining with Records

```dart
// Records make multi-value pipelining elegant
final pipeline = (
  user: api.authenticate(token).then('getCurrentUser'),
  friends: api.authenticate(token).then('getFriendIds'),
  notifications: api.authenticate(token).then('getNotifications'),
);

// Await all at once - single round trip!
final (
  user: User user,
  friends: List<int> friends,
  notifications: List<Notification> notifications,
) = await (
  user: pipeline.user.value,
  friends: pipeline.friends.value,
  notifications: pipeline.notifications.value,
).wait;

// Or use the await extension on records
final result = await pipeline.awaitAll;
```

### Pipeline Builders

```dart
/// A composable pipeline builder using records
typedef Pipeline<T> = ({
  RpcPromise<T> promise,
  List<String> path,
});

extension PipelineExtensions<T> on Pipeline<T> {
  /// Chain a method call
  Pipeline<R> call<R>(String method, [List<Object?> args = const []]) => (
    promise: promise.then<R>(method, args),
    path: [...path, method],
  );

  /// Access a property
  Pipeline<R> prop<R>(String name) => (
    promise: promise[name] as RpcPromise<R>,
    path: [...path, name],
  );

  /// Execute the pipeline
  Future<T> execute() => promise.value;
}

// Usage
final profile = await api
    .authenticate(token)
    .toPipeline()
    .call<int>('getUserId')
    .call<UserProfile>('getUserProfile')
    .execute();
```

### Error Handling with Pattern Matching

```dart
// Use sealed classes with pattern matching
sealed class ApiResult<T> {
  const ApiResult();

  factory ApiResult.success(T value) = ApiSuccess<T>;
  factory ApiResult.failure(ApiError error) = ApiFailure<T>;
}

final class ApiSuccess<T> extends ApiResult<T> {
  final T value;
  const ApiSuccess(this.value);
}

final class ApiFailure<T> extends ApiResult<T> {
  final ApiError error;
  const ApiFailure(this.error);
}

// Pattern match on results
final result = await users.getById(123).toResult();
final widget = switch (result) {
  ApiSuccess(:final value) => UserCard(user: value),
  ApiFailure(error: NotFoundError()) => const NotFoundWidget(),
  ApiFailure(error: NetworkError(:final message)) => ErrorWidget(message),
  ApiFailure() => const GenericErrorWidget(),
};
```

### Exposing Local Objects as RPC Targets

```dart
// Use a mixin for target functionality
mixin RpcTargetMixin {
  @protected
  Map<String, Function> get rpcMethods;

  Future<Object?> handleRpcCall(String method, List<Object?> args) async {
    final handler = rpcMethods[method];
    if (handler == null) {
      throw RpcMethodNotFoundError(method);
    }
    return Function.apply(handler, args);
  }
}

// Implement targets with the mixin
class UserServiceTarget with RpcTargetMixin {
  final Database _db;
  UserServiceTarget(this._db);

  @override
  Map<String, Function> get rpcMethods => {
    'getById': getById,
    'list': list,
    'update': update,
  };

  Future<User> getById(int id) async => await _db.getUser(id);
  Future<List<User>> list(String category) async => await _db.queryUsers(category);
  Future<void> update(User user) async => await _db.save(user);
}

// Or use a base class with reflection (development only)
@RpcTarget()
class UserServiceTarget extends RpcTargetBase {
  final Database _db;
  UserServiceTarget(this._db);

  Future<User> getById(int id) async => await _db.getUser(id);
  // Methods are discovered via reflection
}
```

### Full Example

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  // Connect and get typed references
  final api = await CapnWeb.connect<Api>('wss://api.example.com');

  // Build a pipeline using records
  final pipeline = (
    profile: api.authenticate(token)
        .then<int>('getUserId')
        .then<UserProfile>('getUserProfile'),
    friends: api.authenticate(token)
        .then<List<int>>('getFriendIds'),
  );

  // Execute in a single round-trip
  final (profile: profile, friends: friendIds) = await (
    profile: pipeline.profile.value,
    friends: pipeline.friends.value,
  ).wait;

  print('Hello, ${profile.name}!');
  print('You have ${friendIds.length} friends');
}
```

### Pros
- Zero-cost abstractions (extension types)
- Records provide elegant multi-value handling
- Pattern matching for exhaustive error handling
- Very "Dart 3 native" feel

### Cons
- Extension types have some limitations
- More verbose than dynamic approach
- Requires understanding of Dart 3 features
- IDE support for extension types still maturing

---

## Approach 4: Flutter-Integrated with Provider/Riverpod

This approach is designed specifically for Flutter apps, integrating deeply with state management solutions like Provider or Riverpod.

### Philosophy
- **Flutter-first**: Designed for Flutter's reactive paradigm
- **State management integration**: Works with Provider, Riverpod, BLoC
- **Widget-friendly**: RPC calls feel like any other async operation in Flutter

### Riverpod Integration

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_riverpod/capnweb_riverpod.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Session provider
final rpcSessionProvider = Provider<RpcSession>((ref) {
  final session = RpcSession.connect('wss://api.example.com');
  ref.onDispose(() => session.close());
  return session;
});

// API stub provider
final apiProvider = Provider<ApiStub>((ref) {
  return ref.watch(rpcSessionProvider).stub<ApiStub>();
});

// Data providers with automatic caching and refresh
final userProvider = FutureProvider.family<User, int>((ref, userId) async {
  final api = ref.watch(apiProvider);
  return await api.users.getById(userId);
});

// Pipelined provider
final userProfileProvider = FutureProvider.family<UserProfile, String>((ref, token) async {
  final api = ref.watch(apiProvider);

  // Build pipeline
  final authedApi = api.authenticate(token);
  final userId = authedApi.getUserId();
  final profile = api.getUserProfile(userId);

  // Execute pipeline
  return await profile;
});

// Auto-refreshing provider
final notificationsProvider = StreamProvider<List<Notification>>((ref) async* {
  final api = ref.watch(apiProvider);
  final authed = await api.authenticate(ref.watch(tokenProvider));

  // Initial fetch
  yield await authed.getNotifications();

  // Refresh every 30 seconds
  await for (final _ in Stream.periodic(Duration(seconds: 30))) {
    yield await authed.getNotifications();
  }
});
```

### Using in Widgets

```dart
class UserProfileScreen extends ConsumerWidget {
  final int userId;
  const UserProfileScreen({required this.userId, super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(userProvider(userId));

    return userAsync.when(
      data: (user) => UserProfileView(user: user),
      loading: () => const CircularProgressIndicator(),
      error: (error, stack) => ErrorWidget(error: error),
    );
  }
}

// With pipelined data
class DashboardScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final token = ref.watch(authTokenProvider);
    final profileAsync = ref.watch(userProfileProvider(token));
    final notificationsAsync = ref.watch(notificationsProvider);

    return Column(
      children: [
        profileAsync.when(
          data: (profile) => Text('Hello, ${profile.name}!'),
          loading: () => const CircularProgressIndicator(),
          error: (e, _) => Text('Error: $e'),
        ),
        notificationsAsync.when(
          data: (notifications) => NotificationList(items: notifications),
          loading: () => const CircularProgressIndicator(),
          error: (e, _) => Text('Error: $e'),
        ),
      ],
    );
  }
}
```

### RPC Actions with Riverpod

```dart
// Action provider for mutations
final createUserProvider = Provider<Future<User> Function(CreateUserRequest)>((ref) {
  final api = ref.watch(apiProvider);
  return (request) async {
    final user = await api.users.create(request);
    // Invalidate cache after mutation
    ref.invalidate(userListProvider);
    return user;
  };
});

// Usage in widget
class CreateUserForm extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final createUser = ref.watch(createUserProvider);

    return ElevatedButton(
      onPressed: () async {
        try {
          final user = await createUser(CreateUserRequest(
            name: nameController.text,
            email: emailController.text,
          ));
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Created user ${user.id}')),
          );
        } on RpcException catch (e) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Error: ${e.message}')),
          );
        }
      },
      child: Text('Create User'),
    );
  }
}
```

### Provider Integration (Alternative)

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_provider/capnweb_provider.dart';
import 'package:provider/provider.dart';

// Setup in main.dart
void main() {
  runApp(
    RpcProvider(
      endpoint: 'wss://api.example.com',
      child: MyApp(),
    ),
  );
}

// Access in widgets
class UserScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RpcBuilder<User>(
      call: (api) => api.users.getById(123),
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          return Text('Hello, ${snapshot.data!.name}!');
        } else if (snapshot.hasError) {
          return Text('Error: ${snapshot.error}');
        }
        return CircularProgressIndicator();
      },
    );
  }
}

// Pipelined calls
class ProfileScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RpcPipelineBuilder(
      pipeline: (api) {
        final authed = api.authenticate(context.read<AuthProvider>().token);
        return api.getUserProfile(authed.getUserId());
      },
      builder: (context, AsyncSnapshot<UserProfile> snapshot) {
        return snapshot.when(
          data: (profile) => ProfileView(profile: profile),
          loading: () => LoadingSpinner(),
          error: (e) => ErrorView(error: e),
        );
      },
    );
  }
}
```

### BLoC Integration

```dart
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_bloc/capnweb_bloc.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

// Events
sealed class UserEvent {}
class LoadUser extends UserEvent {
  final int id;
  LoadUser(this.id);
}
class UpdateUser extends UserEvent {
  final User user;
  UpdateUser(this.user);
}

// States
sealed class UserState {}
class UserInitial extends UserState {}
class UserLoading extends UserState {}
class UserLoaded extends UserState {
  final User user;
  UserLoaded(this.user);
}
class UserError extends UserState {
  final String message;
  UserError(this.message);
}

// BLoC with RPC integration
class UserBloc extends RpcBloc<UserEvent, UserState> {
  UserBloc(super.api) : super(UserInitial()) {
    on<LoadUser>(_onLoadUser);
    on<UpdateUser>(_onUpdateUser);
  }

  Future<void> _onLoadUser(LoadUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    try {
      final user = await api.users.getById(event.id);
      emit(UserLoaded(user));
    } on RpcException catch (e) {
      emit(UserError(e.message));
    }
  }

  Future<void> _onUpdateUser(UpdateUser event, Emitter<UserState> emit) async {
    emit(UserLoading());
    try {
      await api.users.update(event.user);
      emit(UserLoaded(event.user));
    } on RpcException catch (e) {
      emit(UserError(e.message));
    }
  }
}

// Widget usage
class UserWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return BlocBuilder<UserBloc, UserState>(
      builder: (context, state) => switch (state) {
        UserInitial() => const Text('Enter a user ID'),
        UserLoading() => const CircularProgressIndicator(),
        UserLoaded(:final user) => UserCard(user: user),
        UserError(:final message) => Text('Error: $message'),
      },
    );
  }
}
```

### Exposing Local Objects as RPC Targets

```dart
// For bidirectional communication (e.g., callbacks)
class NotificationHandler extends RpcTarget {
  final void Function(Notification) onNotification;
  NotificationHandler(this.onNotification);

  void handleNotification(Notification notification) {
    onNotification(notification);
  }
}

// Register callback with remote
final handler = NotificationHandler((notification) {
  // Update local state
  ref.read(notificationsProvider.notifier).add(notification);
});

await api.subscribeToNotifications(RpcStub.wrap(handler));
```

### Full Example

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:capnweb/capnweb.dart';
import 'package:capnweb_riverpod/capnweb_riverpod.dart';

// Providers
final rpcProvider = rpcSessionProvider('wss://api.example.com');

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(rpcProvider));
});

final dashboardProvider = FutureProvider<DashboardData>((ref) async {
  final api = ref.watch(rpcProvider).stub;
  final token = ref.watch(authProvider).token;

  // Pipeline all dashboard data
  final authed = api.authenticate(token);
  final (profile, friends, notifications) = await (
    authed.getUserProfile(),
    authed.getFriends(),
    authed.getNotifications(),
  ).wait;

  return DashboardData(
    profile: profile,
    friends: friends,
    notifications: notifications,
  );
});

// Main app
void main() {
  runApp(ProviderScope(child: MyApp()));
}

class MyApp extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      home: DashboardScreen(),
    );
  }
}

class DashboardScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashboardAsync = ref.watch(dashboardProvider);

    return Scaffold(
      appBar: AppBar(title: Text('Dashboard')),
      body: dashboardAsync.when(
        data: (data) => DashboardView(data: data),
        loading: () => Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('Error: $error')),
      ),
    );
  }
}
```

### Pros
- Deep Flutter integration
- Works with existing state management patterns
- Reactive updates and caching built-in
- Familiar to Flutter developers

### Cons
- Tightly coupled to Flutter/specific packages
- Less suitable for non-Flutter Dart (CLI, servers)
- More dependencies
- Pipelining less explicit

---

## Comparison Matrix

| Feature | Approach 1: noSuchMethod | Approach 2: Code Gen | Approach 3: Extension Types | Approach 4: Flutter |
|---------|--------------------------|----------------------|----------------------------|---------------------|
| **Type Safety** | Low (runtime) | High (compile-time) | Medium-High | High |
| **IDE Support** | Limited | Excellent | Good | Excellent |
| **Pipelining** | Invisible | Explicit `.pipe()` | Records | Provider-based |
| **Setup Complexity** | Minimal | `build_runner` | Minimal | Package dependent |
| **Flutter Integration** | Manual | Manual | Manual | Native |
| **Code Generation** | None | Required | None | Optional |
| **Learning Curve** | Low | Medium | Medium | Medium (if familiar w/ Flutter) |
| **Dart Version** | 2.x+ | 2.x+ | 3.0+ | 3.0+ |
| **Non-Flutter Use** | Excellent | Excellent | Excellent | Poor |
| **Debugging** | Challenging | Easy | Medium | Easy |

---

## Recommendation

For a general-purpose Dart package on pub.dev, I recommend a **layered approach** combining elements from multiple approaches:

### Core Layer (Approach 3 + Approach 1)

```dart
// Low-level API using extension types (zero-cost)
extension type RpcRef<T>._(int _id) { /* ... */ }
extension type RpcPromise<T>._(/* ... */) { /* ... */ }

// High-level dynamic API for convenience
@proxy
class RpcStub<T> { /* noSuchMethod implementation */ }
```

### Type-Safe Layer (Approach 2)

```dart
// Optional code generation for type safety
@RpcInterface()
abstract class UserApi {
  Future<User> getById(int id);
}

// Generated stubs with full type safety
class UserApiStub implements UserApi { /* ... */ }
```

### Flutter Layer (Approach 4)

```dart
// Separate package: capnweb_riverpod
final userProvider = FutureProvider.family<User, int>((ref, id) async {
  return await ref.watch(apiProvider).users.getById(id);
});

// Separate package: capnweb_provider
class RpcBuilder<T> extends StatelessWidget { /* ... */ }
```

### Package Structure

```
capnweb/                     # Core package
  lib/
    src/
      core/
        session.dart
        transport.dart
        stub_hook.dart
      stub/
        rpc_ref.dart         # Extension types
        rpc_promise.dart
        rpc_stub.dart        # noSuchMethod proxy
      target/
        rpc_target.dart
      serialization/
        expression.dart
        codec.dart
    capnweb.dart             # Public API

capnweb_generator/           # Code generation (optional)
  lib/
    builder.dart
    src/
      interface_analyzer.dart
      stub_generator.dart

capnweb_riverpod/            # Riverpod integration
  lib/
    src/
      providers.dart
      builders.dart
    capnweb_riverpod.dart

capnweb_provider/            # Provider integration
  lib/
    src/
      rpc_provider.dart
      rpc_builder.dart
    capnweb_provider.dart

capnweb_bloc/                # BLoC integration
  lib/
    src/
      rpc_bloc.dart
    capnweb_bloc.dart
```

### Suggested Default API

```dart
import 'package:capnweb/capnweb.dart';

void main() async {
  // Simple dynamic usage (Approach 1)
  final api = await CapnWeb.connect('wss://api.example.com');
  final User user = await api.users.getById(123);

  // Type-safe with code gen (Approach 2)
  final session = await RpcSession.connect<UserApi>('wss://api.example.com');
  final User user = await session.stub.getById(123);

  // Pipelining (combines all approaches)
  final profile = await api
      .authenticate(token)
      .pipe((auth) => auth.getUserId())
      .pipe((id) => api.getUserProfile(id));

  // Flutter (Approach 4)
  // Use capnweb_riverpod or capnweb_provider packages
}
```

This layered approach allows:
1. **Quick prototyping** with the dynamic API
2. **Production use** with generated stubs
3. **Flutter integration** via separate packages
4. **Server-side Dart** without Flutter dependencies

---

## Implementation Notes

### Sound Null Safety

All public APIs must use proper null safety:

```dart
abstract class RpcSession {
  /// The root stub for this session.
  RpcStub get stub;

  /// Close the session. Returns when fully closed.
  Future<void> close();

  /// Stream of connection state changes.
  Stream<ConnectionState> get onStateChange;
}

enum ConnectionState {
  connecting,
  connected,
  reconnecting,
  disconnected,
}
```

### Disposal

Follow Dart conventions for resource cleanup:

```dart
// Implements `dispose()` pattern
class RpcSession {
  bool _disposed = false;

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _transport.close();
    _controller.close();
  }
}

// Or use package:disposable for standardization
class RpcSession with Disposable {
  @override
  Future<void> onDispose() async {
    await _transport.close();
  }
}
```

### Transport Abstraction

```dart
abstract class RpcTransport {
  Future<void> send(List<dynamic> message);
  Stream<List<dynamic>> get messages;
  Future<void> close();
}

class WebSocketTransport implements RpcTransport {
  final WebSocketChannel _channel;
  // ...
}

class HttpBatchTransport implements RpcTransport {
  final Uri _endpoint;
  // ...
}

class MessagePortTransport implements RpcTransport {
  final MessagePort _port;
  // ...
}
```

### pubspec.yaml

```yaml
name: capnweb
description: Cap'n Web RPC client for Dart - bidirectional capability-based RPC over JSON
version: 1.0.0
repository: https://github.com/dot-do/capnweb
homepage: https://capnweb.dev

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  web_socket_channel: ^2.4.0
  http: ^1.1.0
  meta: ^1.9.0

dev_dependencies:
  test: ^1.24.0
  lints: ^2.1.0
  build_runner: ^2.4.0  # For code gen package
```
