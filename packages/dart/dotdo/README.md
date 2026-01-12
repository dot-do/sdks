# platform_do

The official Dart SDK for the DotDo platform. This package provides a fully managed client for connecting to `.do` services with built-in authentication, connection pooling, automatic retries, and comprehensive error handling. Works great with both Dart and Flutter.

## Overview

`platform_do` is the highest-level SDK in the DotDo stack, built on top of:

- **rpc_do** - Type-safe RPC client
- **capnweb_do** - Low-level Cap'n Proto over WebSocket transport

This layered architecture provides Cap'n Proto's efficient binary serialization with an idiomatic Dart API.

```
+------------------+
|   platform_do    |  <-- You are here (auth, pooling, retries)
+------------------+
|     rpc_do       |  <-- RPC client layer
+------------------+
|   capnweb_do     |  <-- Transport layer
+------------------+
```

## Features

- **Authentication Management**: API keys, OAuth tokens, and custom headers
- **Connection Pooling**: Efficient reuse of WebSocket connections
- **Automatic Retries**: Exponential backoff with configurable policies
- **Async/Await**: Native Dart futures and streams
- **Type Safety**: Full Dart type system support with generics
- **Flutter Ready**: Works on iOS, Android, Web, and Desktop

## Requirements

- Dart SDK 3.0+
- Flutter 3.0+ (for Flutter projects)

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  platform_do: ^0.1.0
```

Then run:

```bash
# Dart
dart pub get

# Flutter
flutter pub get
```

## Quick Start

### Basic Usage

```dart
import 'package:platform_do/platform_do.dart';

void main() async {
  // Create a client
  final client = DotDo(
    apiKey: Platform.environment['DOTDO_API_KEY']!,
  );

  try {
    // Make an RPC call
    final result = await client.call('ai.generate', {
      'prompt': 'Hello, world!',
      'model': 'claude-3',
    });

    print(result);
  } finally {
    await client.close();
  }
}
```

### Flutter Usage

```dart
import 'package:flutter/material.dart';
import 'package:platform_do/platform_do.dart';

class AIService {
  static final _client = DotDo(
    apiKey: const String.fromEnvironment('DOTDO_API_KEY'),
  );

  static Future<String> generate(String prompt) async {
    final result = await _client.call('ai.generate', {
      'prompt': prompt,
    });
    return result['text'] as String;
  }
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        body: FutureBuilder<String>(
          future: AIService.generate('Hello!'),
          builder: (context, snapshot) {
            if (snapshot.hasData) {
              return Text(snapshot.data!);
            }
            return CircularProgressIndicator();
          },
        ),
      ),
    );
  }
}
```

## Configuration

### DotDo Constructor

```dart
final client = DotDo(
  // Authentication
  apiKey: 'your-api-key',
  accessToken: 'oauth-token',
  headers: {'X-Custom': 'value'},

  // Endpoint
  endpoint: 'wss://api.dotdo.dev/rpc',

  // Connection Pool
  poolSize: 10,
  poolTimeout: Duration(seconds: 30),

  // Retry Policy
  maxRetries: 3,
  retryDelay: Duration(milliseconds: 100),
  retryMaxDelay: Duration(seconds: 30),
  retryMultiplier: 2.0,

  // Request Settings
  timeout: Duration(seconds: 30),

  // Debug
  debug: false,
);
```

### DotDoConfig Class

```dart
final config = DotDoConfig(
  apiKey: 'your-api-key',
  endpoint: 'wss://api.dotdo.dev/rpc',
  poolSize: 10,
  timeout: Duration(seconds: 30),
);

final client = DotDo.fromConfig(config);
```

### Environment Configuration

```dart
// In Flutter, use --dart-define
// flutter run --dart-define=DOTDO_API_KEY=your-key

final client = DotDo(
  apiKey: const String.fromEnvironment('DOTDO_API_KEY'),
);
```

## Authentication

### API Key

```dart
final client = DotDo(apiKey: 'your-api-key');
```

### OAuth Token

```dart
final client = DotDo(accessToken: 'oauth-access-token');
```

### Custom Headers

```dart
final client = DotDo(
  apiKey: 'your-api-key',
  headers: {
    'X-Tenant-ID': 'tenant-123',
    'X-Request-ID': Uuid().v4(),
  },
);
```

### Dynamic Authentication

```dart
final client = DotDo(
  authProvider: () async {
    final token = await fetchToken(); // Your token refresh logic
    return {'Authorization': 'Bearer $token'};
  },
);
```

## Connection Pooling

The SDK maintains a pool of connections for efficiency:

```dart
final client = DotDo(
  poolSize: 20,                      // Maximum concurrent connections
  poolTimeout: Duration(seconds: 60), // Wait up to 60s for available connection
);
```

### Pool Behavior

1. Connections are created on-demand up to `poolSize`
2. Idle connections are reused for subsequent requests
3. If all connections are busy, futures wait up to `poolTimeout`
4. Unhealthy connections are automatically removed

### Pool Statistics

```dart
final stats = client.poolStats();
print('Available: ${stats.available}');
print('In use: ${stats.inUse}');
print('Total: ${stats.total}');
```

## Retry Logic

The SDK automatically retries failed requests with exponential backoff:

```dart
final client = DotDo(
  maxRetries: 5,
  retryDelay: Duration(milliseconds: 200),    // Start with 200ms
  retryMaxDelay: Duration(seconds: 60),        // Cap at 60 seconds
  retryMultiplier: 2.0,                         // Double each time
);
```

### Retry Timing Example

| Attempt | Delay (approx) |
|---------|----------------|
| 1       | 0ms            |
| 2       | 200ms          |
| 3       | 400ms          |
| 4       | 800ms          |
| 5       | 1600ms         |

### Custom Retry Policy

```dart
final client = DotDo(
  retryPolicy: (error, attempt) {
    if (error is RateLimitException) {
      return Future.delayed(error.retryAfter, () => true);
    }
    return Future.value(attempt < 5);
  },
);
```

## Making RPC Calls

### Basic Call

```dart
final result = await client.call('method.name', {
  'param': 'value',
});
```

### With Timeout Override

```dart
final result = await client.call(
  'ai.generate',
  {'prompt': 'Long task...'},
  timeout: Duration(minutes: 2),
);
```

### Typed Responses

```dart
class GenerateResponse {
  final String text;
  final Usage usage;

  GenerateResponse.fromJson(Map<String, dynamic> json)
      : text = json['text'],
        usage = Usage.fromJson(json['usage']);
}

class Usage {
  final int promptTokens;
  final int completionTokens;

  Usage.fromJson(Map<String, dynamic> json)
      : promptTokens = json['prompt_tokens'],
        completionTokens = json['completion_tokens'];
}

final response = await client.call<GenerateResponse>(
  'ai.generate',
  {'prompt': 'Hello!'},
  fromJson: GenerateResponse.fromJson,
);

print('Generated: ${response.text}');
print('Tokens: ${response.usage.completionTokens}');
```

### Streaming Responses

```dart
final stream = client.stream('ai.generate', {
  'prompt': 'Hello',
});

await for (final chunk in stream) {
  print(chunk);
}
```

## Error Handling

### Exception Hierarchy

```dart
abstract class DotDoException implements Exception {}
class AuthException extends DotDoException {}
class ConnectionException extends DotDoException {}
class TimeoutException extends DotDoException {}
class RateLimitException extends DotDoException {
  Duration get retryAfter;
}
class RpcException extends DotDoException {
  int get code;
  String get message;
}
class PoolExhaustedException extends DotDoException {}
```

### Error Handling Example

```dart
try {
  final result = await client.call('ai.generate', {'prompt': 'Hello'});
} on AuthException catch (e) {
  print('Authentication failed: ${e.message}');
  // Re-authenticate
} on RateLimitException catch (e) {
  print('Rate limited. Retry after: ${e.retryAfter}');
  await Future.delayed(e.retryAfter);
  // Retry
} on TimeoutException {
  print('Request timed out');
} on RpcException catch (e) {
  print('RPC error (${e.code}): ${e.message}');
} on DotDoException catch (e) {
  print('DotDo error: ${e.message}');
}
```

### Using Result Type

```dart
final result = await client.callResult('ai.generate', {
  'prompt': 'Hello',
});

result.when(
  success: (response) => print('Success: $response'),
  failure: (error) => print('Error: ${error.message}'),
);
```

## Collections API

### Working with Collections

```dart
final users = client.collection('users');

// Create a document
await users.set('user-123', {
  'name': 'Alice',
  'email': 'alice@example.com',
});

// Read a document
final user = await users.get('user-123');
print(user);

// Update a document
await users.update('user-123', {'name': 'Alice Smith'});

// Delete a document
await users.delete('user-123');
```

### Typed Collections

```dart
class User {
  final String name;
  final String email;
  final int age;

  User({required this.name, required this.email, required this.age});

  factory User.fromJson(Map<String, dynamic> json) => User(
    name: json['name'],
    email: json['email'],
    age: json['age'],
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    'email': email,
    'age': age,
  };
}

final users = client.collection<User>(
  'users',
  fromJson: User.fromJson,
  toJson: (user) => user.toJson(),
);

// Create with type safety
await users.set('user-123', User(
  name: 'Alice',
  email: 'alice@example.com',
  age: 25,
));

// Read with type safety
final user = await users.get('user-123');
print(user.name); // Type-safe access
```

### Querying Collections

```dart
final users = client.collection('users');

// Build a query
final results = await users.query()
    .where('status', isEqualTo: 'active')
    .where('age', isGreaterThanOrEqualTo: 18)
    .orderBy('createdAt', descending: true)
    .limit(10)
    .get();

for (final user in results) {
  print(user);
}
```

### Query Operators

| Method | Description |
|--------|-------------|
| `isEqualTo` | Equal to |
| `isNotEqualTo` | Not equal to |
| `isLessThan` | Less than |
| `isLessThanOrEqualTo` | Less than or equal |
| `isGreaterThan` | Greater than |
| `isGreaterThanOrEqualTo` | Greater than or equal |
| `whereIn` | In list |
| `whereNotIn` | Not in list |

## Flutter Integration

### Provider Pattern

```dart
class DotDoProvider extends InheritedWidget {
  final DotDo client;

  const DotDoProvider({
    required this.client,
    required Widget child,
  }) : super(child: child);

  static DotDo of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<DotDoProvider>()!.client;
  }

  @override
  bool updateShouldNotify(DotDoProvider oldWidget) => client != oldWidget.client;
}

// Usage
void main() {
  final client = DotDo(apiKey: const String.fromEnvironment('DOTDO_API_KEY'));

  runApp(DotDoProvider(
    client: client,
    child: MyApp(),
  ));
}

// In widgets
class MyWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final client = DotDoProvider.of(context);
    // Use client...
  }
}
```

### With Riverpod

```dart
final dotDoProvider = Provider<DotDo>((ref) {
  final client = DotDo(apiKey: const String.fromEnvironment('DOTDO_API_KEY'));
  ref.onDispose(() => client.close());
  return client;
});

final generateProvider = FutureProvider.family<String, String>((ref, prompt) async {
  final client = ref.watch(dotDoProvider);
  final result = await client.call('ai.generate', {'prompt': prompt});
  return result['text'];
});
```

## Platform Features

When connected to the DotDo platform:

### Managed Authentication

```dart
// Auth is handled automatically
final client = DotDo(
  apiKey: Platform.environment['DOTDO_API_KEY']!,
);
```

### Usage Metrics

```dart
// Platform tracks usage automatically
// View in dashboard at https://platform.do/dashboard
```

### Billing Integration

```dart
// Usage is metered and billed through the platform
// Configure billing at https://platform.do/billing
```

### Centralized Logging

```dart
// Enable debug mode for verbose logging
final client = DotDo(debug: true);
```

## Best Practices

### 1. Use Lifecycle Management

```dart
// Good - proper cleanup
class MyService {
  final DotDo _client;

  MyService() : _client = DotDo(apiKey: 'key');

  Future<void> dispose() async {
    await _client.close();
  }
}

// In Flutter StatefulWidget
@override
void dispose() {
  _client.close();
  super.dispose();
}
```

### 2. Reuse Client Instance

```dart
// Good - single client instance
class ApiService {
  static final _client = DotDo(
    apiKey: const String.fromEnvironment('DOTDO_API_KEY'),
  );

  static Future<Map<String, dynamic>> generate(String prompt) {
    return _client.call('ai.generate', {'prompt': prompt});
  }
}

// Bad - new client per request
Future<Map<String, dynamic>> badGenerate(String prompt) async {
  final client = DotDo(apiKey: 'key'); // Creates new pool!
  return client.call('ai.generate', {'prompt': prompt});
  // Missing close()!
}
```

### 3. Use Typed Responses

```dart
// Good - type safety
final response = await client.call<GenerateResponse>(
  'ai.generate',
  params,
  fromJson: GenerateResponse.fromJson,
);
print(response.text);

// Works but no type safety
final response = await client.call('ai.generate', params);
print(response['text']);
```

### 4. Handle All Exceptions

```dart
// Good - specific exception handling
try {
  await client.call('method', params);
} on RateLimitException catch (e) {
  await Future.delayed(e.retryAfter);
  // Retry
} on AuthException {
  await refreshCredentials();
  // Retry
} on DotDoException catch (e) {
  log.error('DotDo error', e);
  rethrow;
}

// Bad - catch-all
try {
  await client.call('method', params);
} catch (e) {
  // Swallowing all exceptions
}
```

## API Reference

### DotDo Class

```dart
class DotDo {
  // Constructors
  DotDo({...});
  factory DotDo.fromConfig(DotDoConfig config);

  // RPC Calls
  Future<Map<String, dynamic>> call(String method, Map<String, dynamic> params);
  Future<T> call<T>(String method, Map<String, dynamic> params, {T Function(Map<String, dynamic>) fromJson});
  Future<Result<T>> callResult<T>(String method, Map<String, dynamic> params);

  // Streaming
  Stream<Map<String, dynamic>> stream(String method, Map<String, dynamic> params);

  // Collections
  Collection collection(String name);
  TypedCollection<T> collection<T>(String name, {...});

  // Pool Statistics
  PoolStats poolStats();

  // Lifecycle
  Future<void> close();
}
```

### Collection Class

```dart
class Collection {
  Future<Map<String, dynamic>> get(String id);
  Future<void> set(String id, Map<String, dynamic> data);
  Future<void> update(String id, Map<String, dynamic> data);
  Future<void> delete(String id);
  Query query();
}
```

### Query Class

```dart
class Query {
  Query where(String field, {...});
  Query orderBy(String field, {bool descending = false});
  Query limit(int count);
  Query offset(int count);
  Future<List<Map<String, dynamic>>> get();
  Future<Map<String, dynamic>?> first();
}
```

## License

MIT

## Links

- [Documentation](https://do.md/docs/dart)
- [pub.dev](https://pub.dev/packages/platform_do)
- [GitHub Repository](https://github.com/dotdo-dev/capnweb)
- [Platform Dashboard](https://platform.do)
- [API Reference](https://pub.dev/documentation/platform_do/latest/)
