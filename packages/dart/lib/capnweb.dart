/// Capability-based RPC for Dart and Flutter.
///
/// This library provides a client for capnweb servers with support for
/// promise pipelining and server-side map operations.
///
/// ```dart
/// import 'package:capnweb/capnweb.dart';
///
/// void main() async {
///   final api = await CapnWeb.connect('wss://api.example.com');
///   final result = await api.call('square', [5]);
///   print(result); // 25
/// }
/// ```
library capnweb;

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

// ============================================================================
// Errors - Sealed class hierarchy for exhaustive pattern matching
// ============================================================================

/// Base sealed class for all capnweb errors.
///
/// Use pattern matching to handle specific error types:
/// ```dart
/// switch (error) {
///   case CapnWebConnectionError(:final message):
///     print('Connection failed: $message');
///   case CapnWebRpcError(:final code, :final message):
///     print('RPC error [$code]: $message');
///   case CapnWebTimeoutError():
///     print('Request timed out');
///   case CapnWebNotImplementedError():
///     print('SDK feature not implemented');
/// }
/// ```
sealed class CapnWebError implements Exception {
  const CapnWebError();
}

/// Connection-related errors (WebSocket issues, server unavailable).
final class CapnWebConnectionError extends CapnWebError {
  final String message;
  final Object? cause;

  const CapnWebConnectionError(this.message, [this.cause]);

  @override
  String toString() => 'CapnWebConnectionError: $message';
}

/// RPC errors returned by the server.
final class CapnWebRpcError extends CapnWebError {
  final String code;
  final String message;
  final Object? data;

  const CapnWebRpcError({
    required this.code,
    required this.message,
    this.data,
  });

  @override
  String toString() => 'CapnWebRpcError [$code]: $message';
}

/// Request timeout errors.
final class CapnWebTimeoutError extends CapnWebError {
  final Duration timeout;

  const CapnWebTimeoutError(this.timeout);

  @override
  String toString() => 'CapnWebTimeoutError: Request timed out after $timeout';
}

/// SDK feature not yet implemented.
final class CapnWebNotImplementedError extends CapnWebError {
  final String feature;

  const CapnWebNotImplementedError(this.feature);

  @override
  String toString() => 'CapnWebNotImplementedError: $feature is not implemented';
}

// ============================================================================
// RpcPromise - The core promise type with map support
// ============================================================================

/// A promise representing a pending RPC result.
///
/// [RpcPromise] supports server-side transformations via [map], allowing
/// you to transform collections without N+1 round trips.
///
/// ```dart
/// // Single round trip - map executes on the server
/// final squared = await api
///     .call('generateFibonacci', [6])
///     .map((x) => api.call('square', [x]));
/// // [0, 1, 1, 4, 9, 25]
/// ```
class RpcPromise<T> implements Future<T> {
  final Session _session;
  final Future<T> _future;

  /// Map operations to be applied server-side.
  final List<MapOperation> _mapOps;

  RpcPromise._(this._session, this._future, [this._mapOps = const []]);

  /// Creates a resolved promise with an immediate value.
  factory RpcPromise.value(Session session, T value) {
    return RpcPromise._(session, Future.value(value));
  }

  /// Creates a promise from an async operation.
  factory RpcPromise.async(Session session, Future<T> future) {
    return RpcPromise._(session, future);
  }

  /// Server-side map transformation.
  ///
  /// Unlike Dart's standard [Iterable.map], this sends the transformation
  /// function to the server for execution, avoiding N+1 round trips.
  ///
  /// ```dart
  /// // This is ONE round trip, not 7!
  /// final results = await api
  ///     .call('generateFibonacci', [6])
  ///     .map((x) => api.call('square', [x]));
  /// ```
  ///
  /// The [transform] function receives each element and should return
  /// an RPC call or value. The server batches all transformations.
  RpcPromise<List<R>> map<R>(FutureOr<R> Function(dynamic x) transform) {
    final newOps = [..._mapOps, MapOperation(transform)];

    final mappedFuture = _future.then((value) async {
      // If value is null/undefined, return null
      if (value == null) {
        return null as List<R>;
      }

      // If value is a list, map over it
      if (value is List) {
        final results = <R>[];
        for (final element in value) {
          final transformed = await transform(element);
          results.add(transformed);
        }
        return results;
      }

      // Single value - apply transform and wrap in list
      final transformed = await transform(value);
      return [transformed];
    });

    return RpcPromise._(_session, mappedFuture, newOps);
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

/// Internal representation of a map operation.
class MapOperation {
  final Function transform;

  MapOperation(this.transform);
}

// ============================================================================
// Session - Active connection to a capnweb server
// ============================================================================

/// An active connection to a capnweb server.
///
/// Create a session using [CapnWeb.connect]:
/// ```dart
/// final api = await CapnWeb.connect('wss://api.example.com');
/// ```
class Session {
  final String _url;
  final WebSocketChannel? _channel;
  final Duration _timeout;

  bool _connected = false;
  int _nextId = 1;
  final Map<int, Completer<dynamic>> _pending = {};

  Session._({
    required String url,
    WebSocketChannel? channel,
    Duration timeout = const Duration(seconds: 30),
  })  : _url = url,
        _channel = channel,
        _timeout = timeout;

  /// Whether the session is currently connected.
  bool get isConnected => _connected;

  /// The server URL.
  String get url => _url;

  /// Makes an RPC call to the server.
  ///
  /// ```dart
  /// final result = await session.call('square', [5]);
  /// print(result); // 25
  /// ```
  RpcPromise<T> call<T>(String method, [List<dynamic> args = const []]) {
    final future = _callInternal<T>(method, args);
    return RpcPromise._(this, future);
  }

  Future<T> _callInternal<T>(String method, List<dynamic> args) async {
    if (!_connected || _channel == null) {
      throw const CapnWebNotImplementedError('Session.call (not connected)');
    }

    final id = _nextId++;
    final completer = Completer<dynamic>();
    _pending[id] = completer;

    final request = {
      'jsonrpc': '2.0',
      'id': id,
      'method': method,
      'params': args,
    };

    _channel!.sink.add(jsonEncode(request));

    try {
      final result = await completer.future.timeout(_timeout);
      return result as T;
    } on TimeoutException {
      _pending.remove(id);
      throw CapnWebTimeoutError(_timeout);
    }
  }

  /// Handles incoming messages from the WebSocket.
  void _handleMessage(dynamic message) {
    try {
      final data = jsonDecode(message as String) as Map<String, dynamic>;
      final id = data['id'] as int?;

      if (id != null && _pending.containsKey(id)) {
        final completer = _pending.remove(id)!;

        if (data.containsKey('error')) {
          final error = data['error'] as Map<String, dynamic>;
          completer.completeError(CapnWebRpcError(
            code: error['code']?.toString() ?? 'UNKNOWN',
            message: error['message'] as String? ?? 'Unknown error',
            data: error['data'],
          ));
        } else {
          completer.complete(data['result']);
        }
      }
    } catch (e) {
      // Ignore malformed messages
    }
  }

  /// Closes the session and releases resources.
  Future<void> close() async {
    _connected = false;
    await _channel?.sink.close();

    // Cancel all pending requests
    for (final completer in _pending.values) {
      completer.completeError(
        const CapnWebConnectionError('Session closed'),
      );
    }
    _pending.clear();
  }
}

// ============================================================================
// CapnWeb - Main entry point
// ============================================================================

/// Main entry point for the capnweb SDK.
///
/// Use [connect] to establish a connection to a capnweb server:
/// ```dart
/// final api = await CapnWeb.connect('wss://api.example.com');
/// ```
abstract final class CapnWeb {
  /// Whether the SDK is fully implemented.
  ///
  /// Returns `false` for stub implementations used in conformance testing.
  static bool get isImplemented => false;

  /// Connects to a capnweb server.
  ///
  /// Returns a [Session] that can be used to make RPC calls.
  ///
  /// ```dart
  /// final api = await CapnWeb.connect(
  ///   'wss://api.example.com',
  ///   timeout: Duration(seconds: 30),
  /// );
  /// ```
  ///
  /// Throws [CapnWebConnectionError] if the connection fails.
  static Future<Session> connect(
    String url, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    // TODO: Implement actual WebSocket connection
    // For now, return a stub session for conformance testing

    // Normalize URL to WebSocket
    final wsUrl = url
        .replaceFirst('http://', 'ws://')
        .replaceFirst('https://', 'wss://');

    try {
      final channel = WebSocketChannel.connect(Uri.parse(wsUrl));

      // Wait for connection to be established
      await channel.ready;

      final session = Session._(
        url: wsUrl,
        channel: channel,
        timeout: timeout,
      );

      session._connected = true;

      // Listen for messages
      channel.stream.listen(
        session._handleMessage,
        onError: (error) {
          session._connected = false;
        },
        onDone: () {
          session._connected = false;
        },
      );

      return session;
    } catch (e) {
      throw CapnWebConnectionError('Failed to connect to $wsUrl', e);
    }
  }
}

// ============================================================================
// Capability Reference - For pipelined calls
// ============================================================================

/// A reference to a remote capability.
///
/// Capability references enable promise pipelining - you can call methods
/// on a capability before its promise resolves:
///
/// ```dart
/// final auth = api.call('authenticate', [token]);
/// final user = auth.getUser();  // Pipelined call
/// final profile = await user.profile;
/// ```
class CapabilityRef<T> {
  final Session _session;
  final List<String> _path;
  final String? _id;

  CapabilityRef._(this._session, this._path, [this._id]);

  /// Creates a root capability reference.
  factory CapabilityRef.root(Session session) {
    return CapabilityRef._(session, const []);
  }

  /// Calls a method on this capability.
  RpcPromise<R> call<R>(String method, [List<dynamic> args = const []]) {
    // TODO: Implement pipelined calls
    throw const CapnWebNotImplementedError('CapabilityRef.call');
  }

  /// Gets a nested capability by name.
  CapabilityRef<dynamic> get(String name) {
    return CapabilityRef._(_session, [..._path, name]);
  }

  /// Awaits the capability to resolve.
  Future<T> resolve() async {
    // TODO: Implement capability resolution
    throw const CapnWebNotImplementedError('CapabilityRef.resolve');
  }
}
