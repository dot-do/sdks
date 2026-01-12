/// Lightweight RPC client for DotDo services.
///
/// This library provides a simple RPC client with functional transformations
/// using Dart's arrow functions and async/await patterns.
///
/// ```dart
/// import 'package:dotdo_rpc/dotdo_rpc.dart';
///
/// void main() async {
///   final client = RpcClient('https://api.do.md');
///
///   // Simple call
///   final result = await client.call('multiply', [3, 4]);
///
///   // With map transformation using arrow functions
///   final squares = await client
///       .call('range', [1, 5])
///       .map((x) => x * x);
/// }
/// ```
library dotdo_rpc;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

// ============================================================================
// Errors
// ============================================================================

/// Base class for all RPC errors.
sealed class RpcError implements Exception {
  const RpcError();
}

/// Network or connection error.
final class RpcNetworkError extends RpcError {
  final String message;
  final Object? cause;

  const RpcNetworkError(this.message, [this.cause]);

  @override
  String toString() => 'RpcNetworkError: $message';
}

/// Server returned an error response.
final class RpcServerError extends RpcError {
  final int code;
  final String message;
  final Object? data;

  const RpcServerError({
    required this.code,
    required this.message,
    this.data,
  });

  @override
  String toString() => 'RpcServerError [$code]: $message';
}

/// Request timed out.
final class RpcTimeoutError extends RpcError {
  final Duration timeout;

  const RpcTimeoutError(this.timeout);

  @override
  String toString() => 'RpcTimeoutError: Request timed out after $timeout';
}

// ============================================================================
// RpcResponse - Chainable response with map support
// ============================================================================

/// A chainable RPC response that supports functional transformations.
///
/// Use [map] to transform results using Dart's arrow functions:
/// ```dart
/// final doubled = await client
///     .call('getNumbers', [])
///     .map((x) => x * 2);
/// ```
class RpcResponse<T> implements Future<T> {
  final Future<T> _future;

  RpcResponse._(this._future);

  /// Creates a resolved response with an immediate value.
  factory RpcResponse.value(T value) => RpcResponse._(Future.value(value));

  /// Creates a response from an async operation.
  factory RpcResponse.async(Future<T> future) => RpcResponse._(future);

  /// Transforms each element in the response using the provided function.
  ///
  /// If the response is a list, applies [transform] to each element.
  /// Uses Dart's arrow function syntax for concise transformations:
  ///
  /// ```dart
  /// // Square each number
  /// final squares = await client
  ///     .call('range', [1, 10])
  ///     .map((x) => x * x);
  ///
  /// // Chain multiple transformations
  /// final result = await client
  ///     .call('getUsers', [])
  ///     .map((user) => user['name'])
  ///     .map((name) => name.toUpperCase());
  /// ```
  RpcResponse<List<R>> map<R>(FutureOr<R> Function(dynamic x) transform) {
    final mappedFuture = _future.then((value) async {
      if (value == null) {
        return <R>[];
      }

      if (value is List) {
        final results = <R>[];
        for (final element in value) {
          results.add(await transform(element));
        }
        return results;
      }

      // Single value - wrap in list
      return [await transform(value)];
    });

    return RpcResponse._(mappedFuture);
  }

  /// Filters elements in the response using a predicate.
  ///
  /// ```dart
  /// final evens = await client
  ///     .call('range', [1, 10])
  ///     .filter((x) => x % 2 == 0);
  /// ```
  RpcResponse<List<T>> filter(FutureOr<bool> Function(T x) predicate) {
    final filteredFuture = _future.then((value) async {
      if (value == null) {
        return <T>[];
      }

      if (value is List) {
        final results = <T>[];
        for (final element in value) {
          if (await predicate(element as T)) {
            results.add(element);
          }
        }
        return results;
      }

      // Single value - keep if matches predicate
      if (await predicate(value)) {
        return [value];
      }
      return <T>[];
    });

    return RpcResponse._(filteredFuture);
  }

  /// Reduces the response to a single value.
  ///
  /// ```dart
  /// final sum = await client
  ///     .call('range', [1, 10])
  ///     .reduce((acc, x) => acc + x, initial: 0);
  /// ```
  RpcResponse<R> reduce<R>(
    FutureOr<R> Function(R acc, dynamic x) combine, {
    required R initial,
  }) {
    final reducedFuture = _future.then((value) async {
      if (value == null) {
        return initial;
      }

      var acc = initial;
      if (value is List) {
        for (final element in value) {
          acc = await combine(acc, element);
        }
      } else {
        acc = await combine(acc, value);
      }
      return acc;
    });

    return RpcResponse._(reducedFuture);
  }

  // Future interface implementation
  @override
  Future<T> timeout(Duration timeLimit, {FutureOr<T> Function()? onTimeout}) =>
      _future.timeout(timeLimit, onTimeout: onTimeout);

  @override
  Stream<T> asStream() => _future.asStream();

  @override
  Future<T> catchError(Function onError, {bool Function(Object)? test}) =>
      _future.catchError(onError, test: test);

  @override
  Future<R> then<R>(FutureOr<R> Function(T) onValue, {Function? onError}) =>
      _future.then(onValue, onError: onError);

  @override
  Future<T> whenComplete(FutureOr<void> Function() action) =>
      _future.whenComplete(action);
}

// ============================================================================
// RpcClient - Main RPC client
// ============================================================================

/// A lightweight RPC client for DotDo services.
///
/// ```dart
/// final client = RpcClient(
///   'https://api.do.md',
///   timeout: Duration(seconds: 30),
/// );
///
/// // Make RPC calls
/// final result = await client.call('method', [arg1, arg2]);
///
/// // With functional transformations
/// final processed = await client
///     .call('getData', [])
///     .map((item) => item['value'])
///     .filter((v) => v > 10);
/// ```
class RpcClient {
  final String _baseUrl;
  final Duration _timeout;
  final Map<String, String> _headers;
  final http.Client _httpClient;

  int _requestId = 0;

  /// Creates a new RPC client.
  ///
  /// [baseUrl] - The base URL of the RPC server
  /// [timeout] - Request timeout (default: 30 seconds)
  /// [headers] - Additional HTTP headers to include
  RpcClient(
    String baseUrl, {
    Duration timeout = const Duration(seconds: 30),
    Map<String, String>? headers,
    http.Client? httpClient,
  })  : _baseUrl = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl,
        _timeout = timeout,
        _headers = {
          'Content-Type': 'application/json',
          ...?headers,
        },
        _httpClient = httpClient ?? http.Client();

  /// The base URL of the RPC server.
  String get baseUrl => _baseUrl;

  /// Makes an RPC call to the server.
  ///
  /// ```dart
  /// // Simple call
  /// final result = await client.call('add', [1, 2]);
  ///
  /// // With map transformation
  /// final squares = await client
  ///     .call('range', [1, 5])
  ///     .map((x) => x * x);
  /// ```
  RpcResponse<T> call<T>(String method, [List<dynamic> args = const []]) {
    final future = _callInternal<T>(method, args);
    return RpcResponse._(future);
  }

  Future<T> _callInternal<T>(String method, List<dynamic> args) async {
    final id = ++_requestId;

    final request = {
      'jsonrpc': '2.0',
      'id': id,
      'method': method,
      'params': args,
    };

    try {
      final response = await _httpClient
          .post(
            Uri.parse('$_baseUrl/rpc'),
            headers: _headers,
            body: jsonEncode(request),
          )
          .timeout(_timeout);

      if (response.statusCode != 200) {
        throw RpcNetworkError(
          'HTTP ${response.statusCode}: ${response.reasonPhrase}',
        );
      }

      final data = jsonDecode(response.body) as Map<String, dynamic>;

      if (data.containsKey('error')) {
        final error = data['error'] as Map<String, dynamic>;
        throw RpcServerError(
          code: error['code'] as int? ?? -1,
          message: error['message'] as String? ?? 'Unknown error',
          data: error['data'],
        );
      }

      return data['result'] as T;
    } on TimeoutException {
      throw RpcTimeoutError(_timeout);
    } on http.ClientException catch (e) {
      throw RpcNetworkError('Network error', e);
    }
  }

  /// Makes a batch of RPC calls in a single request.
  ///
  /// ```dart
  /// final results = await client.batch([
  ///   ('add', [1, 2]),
  ///   ('multiply', [3, 4]),
  ///   ('divide', [10, 2]),
  /// ]);
  /// // [3, 12, 5]
  /// ```
  Future<List<dynamic>> batch(List<(String method, List<dynamic> args)> calls) async {
    if (calls.isEmpty) return [];

    final requests = calls.map((call) {
      final (method, args) = call;
      return {
        'jsonrpc': '2.0',
        'id': ++_requestId,
        'method': method,
        'params': args,
      };
    }).toList();

    try {
      final response = await _httpClient
          .post(
            Uri.parse('$_baseUrl/rpc'),
            headers: _headers,
            body: jsonEncode(requests),
          )
          .timeout(_timeout);

      if (response.statusCode != 200) {
        throw RpcNetworkError(
          'HTTP ${response.statusCode}: ${response.reasonPhrase}',
        );
      }

      final results = jsonDecode(response.body) as List<dynamic>;
      return results.map((r) {
        final data = r as Map<String, dynamic>;
        if (data.containsKey('error')) {
          final error = data['error'] as Map<String, dynamic>;
          throw RpcServerError(
            code: error['code'] as int? ?? -1,
            message: error['message'] as String? ?? 'Unknown error',
            data: error['data'],
          );
        }
        return data['result'];
      }).toList();
    } on TimeoutException {
      throw RpcTimeoutError(_timeout);
    } on http.ClientException catch (e) {
      throw RpcNetworkError('Network error', e);
    }
  }

  /// Closes the client and releases resources.
  void close() {
    _httpClient.close();
  }
}
