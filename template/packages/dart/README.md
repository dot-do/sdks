# {{name}}_do

[![pub package](https://img.shields.io/pub/v/{{name}}_do.svg)](https://pub.dev/packages/{{name}}_do)

{{Name}}.do SDK for Dart - {{description}}

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  {{name}}_do: ^0.1.0
```

## Quick Start

```dart
import 'package:{{name}}_do/{{name}}_do.dart';
import 'dart:io';

void main() async {
  // Create client with API key
  final client = {{Name}}Client(
    apiKey: Platform.environment['DOTDO_KEY'],
  );

  // Connect to the service
  await client.connect();

  try {
    // Make RPC calls through the client
    final rpc = client.rpc;
    // ...
  } finally {
    await client.disconnect();
  }
}
```

## Configuration

```dart
final client = {{Name}}Client(
  apiKey: 'your-api-key',
  baseUrl: 'https://{{name}}.do',  // Custom endpoint
  timeoutMs: 30000,                 // Connection timeout
);
```

## Error Handling

```dart
try {
  await client.connect();
  // ...
} on {{Name}}AuthException catch (e) {
  print('Authentication failed: $e');
} on {{Name}}ConnectionException catch (e) {
  print('Connection failed: $e');
} on {{Name}}Exception catch (e) {
  print('Error: $e');
}
```

## License

MIT
