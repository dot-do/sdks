import 'package:rpc_do/rpc_do.dart';

/// Configuration options for {{Name}}Client
class {{Name}}ClientOptions {
  /// API key for authentication
  final String? apiKey;

  /// Base URL for the service (defaults to https://{{name}}.do)
  final String baseUrl;

  /// Connection timeout in milliseconds
  final int timeoutMs;

  const {{Name}}ClientOptions({
    this.apiKey,
    this.baseUrl = 'https://{{name}}.do',
    this.timeoutMs = 30000,
  });
}

/// {{Name}}.do client for interacting with the {{name}} service
///
/// Example:
/// ```dart
/// final client = {{Name}}Client(apiKey: 'your-api-key');
/// await client.connect();
/// try {
///   // Make RPC calls
/// } finally {
///   await client.disconnect();
/// }
/// ```
class {{Name}}Client {
  final {{Name}}ClientOptions options;
  RpcClient? _rpc;

  /// Creates a new {{Name}}Client with the given options
  {{Name}}Client({
    String? apiKey,
    String baseUrl = 'https://{{name}}.do',
    int timeoutMs = 30000,
  }) : options = {{Name}}ClientOptions(
          apiKey: apiKey,
          baseUrl: baseUrl,
          timeoutMs: timeoutMs,
        );

  /// Creates a new {{Name}}Client from options
  {{Name}}Client.fromOptions(this.options);

  /// Whether the client is currently connected
  bool get isConnected => _rpc != null;

  /// Connect to the {{name}}.do service
  Future<RpcClient> connect() async {
    if (_rpc == null) {
      final headers = <String, String>{};
      if (options.apiKey != null) {
        headers['Authorization'] = 'Bearer ${options.apiKey}';
      }

      _rpc = await RpcClient.connect(
        options.baseUrl,
        headers: headers.isEmpty ? null : headers,
      );
    }
    return _rpc!;
  }

  /// Disconnect from the service
  Future<void> disconnect() async {
    if (_rpc != null) {
      await _rpc!.close();
      _rpc = null;
    }
  }

  /// Get the underlying RPC client (must be connected first)
  RpcClient get rpc {
    if (_rpc == null) {
      throw StateError(
        '{{Name}}Client is not connected. Call connect() first.',
      );
    }
    return _rpc!;
  }
}
