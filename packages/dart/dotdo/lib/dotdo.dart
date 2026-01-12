/// Official DotDo platform SDK for Dart and Flutter.
///
/// This library provides a complete client for the DotDo platform with
/// authentication, connection pooling, and automatic retry logic.
///
/// ```dart
/// import 'package:dotdo/dotdo.dart';
///
/// void main() async {
///   final client = await DotDo.connect(
///     apiKey: 'your-api-key',
///     options: DotDoOptions(
///       maxRetries: 3,
///       poolSize: 5,
///     ),
///   );
///
///   final result = await client.execute('action', {'input': 'data'});
///   print(result);
///
///   await client.close();
/// }
/// ```
library dotdo;

import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

// ============================================================================
// Configuration
// ============================================================================

/// Configuration options for the DotDo client.
class DotDoOptions {
  /// Base URL for the DotDo API.
  final String baseUrl;

  /// Maximum number of retry attempts for failed requests.
  final int maxRetries;

  /// Initial delay before first retry (doubles with each attempt).
  final Duration retryDelay;

  /// Maximum delay between retries.
  final Duration maxRetryDelay;

  /// Request timeout.
  final Duration timeout;

  /// Number of connections in the pool.
  final int poolSize;

  /// Whether to use exponential backoff for retries.
  final bool exponentialBackoff;

  /// Jitter factor for retry delays (0.0 - 1.0).
  final double jitterFactor;

  const DotDoOptions({
    this.baseUrl = 'https://api.do.md',
    this.maxRetries = 3,
    this.retryDelay = const Duration(milliseconds: 100),
    this.maxRetryDelay = const Duration(seconds: 30),
    this.timeout = const Duration(seconds: 30),
    this.poolSize = 5,
    this.exponentialBackoff = true,
    this.jitterFactor = 0.1,
  });

  /// Creates options for development/testing.
  factory DotDoOptions.development() => const DotDoOptions(
        baseUrl: 'http://localhost:3000',
        maxRetries: 1,
        timeout: Duration(seconds: 5),
        poolSize: 2,
      );
}

// ============================================================================
// Errors
// ============================================================================

/// Base class for all DotDo errors.
sealed class DotDoError implements Exception {
  const DotDoError();
}

/// Authentication error.
final class DotDoAuthError extends DotDoError {
  final String message;

  const DotDoAuthError(this.message);

  @override
  String toString() => 'DotDoAuthError: $message';
}

/// Network or connection error.
final class DotDoNetworkError extends DotDoError {
  final String message;
  final Object? cause;

  const DotDoNetworkError(this.message, [this.cause]);

  @override
  String toString() => 'DotDoNetworkError: $message';
}

/// Server-side error.
final class DotDoServerError extends DotDoError {
  final int code;
  final String message;
  final Object? data;

  const DotDoServerError({
    required this.code,
    required this.message,
    this.data,
  });

  @override
  String toString() => 'DotDoServerError [$code]: $message';
}

/// Request timeout error.
final class DotDoTimeoutError extends DotDoError {
  final Duration timeout;
  final int attempts;

  const DotDoTimeoutError(this.timeout, this.attempts);

  @override
  String toString() =>
      'DotDoTimeoutError: Request timed out after $attempts attempts';
}

/// Rate limit exceeded.
final class DotDoRateLimitError extends DotDoError {
  final Duration retryAfter;

  const DotDoRateLimitError(this.retryAfter);

  @override
  String toString() =>
      'DotDoRateLimitError: Rate limit exceeded, retry after $retryAfter';
}

// ============================================================================
// Authentication
// ============================================================================

/// Authentication credentials for DotDo.
sealed class DotDoAuth {
  const DotDoAuth();

  /// Creates API key authentication.
  factory DotDoAuth.apiKey(String key) = ApiKeyAuth;

  /// Creates bearer token authentication.
  factory DotDoAuth.bearer(String token) = BearerAuth;

  /// Creates OAuth2 authentication with refresh capability.
  factory DotDoAuth.oauth2({
    required String accessToken,
    String? refreshToken,
    DateTime? expiresAt,
    Future<OAuthTokens> Function()? onRefresh,
  }) = OAuth2Auth;

  /// Returns the authorization header value.
  Future<String> getAuthHeader();

  /// Whether the credentials need refreshing.
  bool get needsRefresh => false;

  /// Refreshes the credentials if needed.
  Future<void> refresh() async {}
}

/// API key authentication.
final class ApiKeyAuth extends DotDoAuth {
  final String key;

  const ApiKeyAuth(this.key);

  @override
  Future<String> getAuthHeader() async => 'Bearer $key';
}

/// Bearer token authentication.
final class BearerAuth extends DotDoAuth {
  final String token;

  const BearerAuth(this.token);

  @override
  Future<String> getAuthHeader() async => 'Bearer $token';
}

/// OAuth2 tokens.
class OAuthTokens {
  final String accessToken;
  final String? refreshToken;
  final DateTime? expiresAt;

  const OAuthTokens({
    required this.accessToken,
    this.refreshToken,
    this.expiresAt,
  });
}

/// OAuth2 authentication with automatic refresh.
final class OAuth2Auth extends DotDoAuth {
  String _accessToken;
  String? _refreshToken;
  DateTime? _expiresAt;
  final Future<OAuthTokens> Function()? _onRefresh;

  OAuth2Auth({
    required String accessToken,
    String? refreshToken,
    DateTime? expiresAt,
    Future<OAuthTokens> Function()? onRefresh,
  })  : _accessToken = accessToken,
        _refreshToken = refreshToken,
        _expiresAt = expiresAt,
        _onRefresh = onRefresh;

  @override
  Future<String> getAuthHeader() async {
    if (needsRefresh) {
      await refresh();
    }
    return 'Bearer $_accessToken';
  }

  @override
  bool get needsRefresh {
    if (_expiresAt == null) return false;
    // Refresh 5 minutes before expiry
    return DateTime.now().isAfter(_expiresAt!.subtract(const Duration(minutes: 5)));
  }

  @override
  Future<void> refresh() async {
    if (_onRefresh == null) {
      throw const DotDoAuthError('Token expired and no refresh handler provided');
    }

    final tokens = await _onRefresh!();
    _accessToken = tokens.accessToken;
    _refreshToken = tokens.refreshToken ?? _refreshToken;
    _expiresAt = tokens.expiresAt;
  }
}

// ============================================================================
// Connection Pool
// ============================================================================

/// A pooled HTTP connection.
class _PooledConnection {
  final http.Client client;
  bool inUse = false;
  DateTime lastUsed = DateTime.now();

  _PooledConnection(this.client);
}

/// Connection pool for efficient HTTP connections.
class _ConnectionPool {
  final int _maxSize;
  final Queue<_PooledConnection> _available = Queue();
  final List<_PooledConnection> _all = [];
  final _waiters = <Completer<_PooledConnection>>[];

  _ConnectionPool(this._maxSize);

  /// Acquires a connection from the pool.
  Future<_PooledConnection> acquire() async {
    // Try to get an available connection
    while (_available.isNotEmpty) {
      final conn = _available.removeFirst();
      if (!conn.inUse) {
        conn.inUse = true;
        conn.lastUsed = DateTime.now();
        return conn;
      }
    }

    // Create new connection if pool not full
    if (_all.length < _maxSize) {
      final conn = _PooledConnection(http.Client());
      conn.inUse = true;
      _all.add(conn);
      return conn;
    }

    // Wait for a connection to be released
    final completer = Completer<_PooledConnection>();
    _waiters.add(completer);
    return completer.future;
  }

  /// Releases a connection back to the pool.
  void release(_PooledConnection conn) {
    conn.inUse = false;
    conn.lastUsed = DateTime.now();

    // Give to waiting request if any
    if (_waiters.isNotEmpty) {
      final waiter = _waiters.removeAt(0);
      conn.inUse = true;
      waiter.complete(conn);
      return;
    }

    _available.addLast(conn);
  }

  /// Closes all connections in the pool.
  void close() {
    for (final conn in _all) {
      conn.client.close();
    }
    _all.clear();
    _available.clear();

    // Cancel all waiters
    for (final waiter in _waiters) {
      waiter.completeError(const DotDoNetworkError('Connection pool closed'));
    }
    _waiters.clear();
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/// Determines if an error should trigger a retry.
bool _shouldRetry(Object error) {
  if (error is DotDoNetworkError) return true;
  if (error is DotDoTimeoutError) return true;
  if (error is DotDoServerError && error.code >= 500) return true;
  if (error is DotDoRateLimitError) return true;
  return false;
}

/// Calculates retry delay with exponential backoff and jitter.
Duration _calculateRetryDelay(
  int attempt,
  Duration baseDelay,
  Duration maxDelay,
  bool exponentialBackoff,
  double jitterFactor,
) {
  var delay = baseDelay;

  if (exponentialBackoff) {
    delay = baseDelay * pow(2, attempt);
  }

  if (delay > maxDelay) {
    delay = maxDelay;
  }

  // Add jitter
  if (jitterFactor > 0) {
    final jitter = delay.inMilliseconds * jitterFactor * (Random().nextDouble() * 2 - 1);
    delay = Duration(milliseconds: delay.inMilliseconds + jitter.round());
  }

  return delay;
}

// ============================================================================
// DotDo Client
// ============================================================================

/// Main DotDo platform client.
///
/// Use [DotDo.connect] to create a new client instance:
/// ```dart
/// final client = await DotDo.connect(
///   apiKey: 'your-api-key',
///   options: DotDoOptions(maxRetries: 3),
/// );
/// ```
class DotDo {
  final DotDoAuth _auth;
  final DotDoOptions _options;
  final _ConnectionPool _pool;

  bool _closed = false;

  DotDo._({
    required DotDoAuth auth,
    required DotDoOptions options,
    required _ConnectionPool pool,
  })  : _auth = auth,
        _options = options,
        _pool = pool;

  /// Connects to the DotDo platform with API key authentication.
  ///
  /// ```dart
  /// final client = await DotDo.connect(
  ///   apiKey: 'your-api-key',
  ///   options: DotDoOptions(
  ///     maxRetries: 3,
  ///     poolSize: 5,
  ///   ),
  /// );
  /// ```
  static Future<DotDo> connect({
    required String apiKey,
    DotDoOptions options = const DotDoOptions(),
  }) async {
    final auth = DotDoAuth.apiKey(apiKey);
    return _connect(auth: auth, options: options);
  }

  /// Connects to the DotDo platform with custom authentication.
  ///
  /// ```dart
  /// final client = await DotDo.connectWithAuth(
  ///   auth: DotDoAuth.oauth2(
  ///     accessToken: token,
  ///     refreshToken: refreshToken,
  ///     onRefresh: () async => refreshOAuthTokens(),
  ///   ),
  /// );
  /// ```
  static Future<DotDo> connectWithAuth({
    required DotDoAuth auth,
    DotDoOptions options = const DotDoOptions(),
  }) async {
    return _connect(auth: auth, options: options);
  }

  static Future<DotDo> _connect({
    required DotDoAuth auth,
    required DotDoOptions options,
  }) async {
    final pool = _ConnectionPool(options.poolSize);

    final client = DotDo._(
      auth: auth,
      options: options,
      pool: pool,
    );

    // Verify connection by making a health check
    try {
      await client._request('GET', '/health');
    } catch (e) {
      pool.close();
      rethrow;
    }

    return client;
  }

  /// Executes an action on the DotDo platform.
  ///
  /// ```dart
  /// final result = await client.execute('processData', {
  ///   'input': [1, 2, 3],
  ///   'transform': 'square',
  /// });
  /// ```
  Future<T> execute<T>(String action, [Map<String, dynamic>? params]) async {
    final body = {
      'action': action,
      if (params != null) 'params': params,
    };

    final response = await _request('POST', '/execute', body: body);
    return response['result'] as T;
  }

  /// Executes a workflow with multiple steps.
  ///
  /// ```dart
  /// final result = await client.workflow([
  ///   ('fetch', {'url': 'https://api.example.com/data'}),
  ///   ('transform', {'type': 'filter', 'condition': 'x > 10'}),
  ///   ('aggregate', {'method': 'sum'}),
  /// ]);
  /// ```
  Future<T> workflow<T>(List<(String action, Map<String, dynamic>? params)> steps) async {
    final stepsData = steps.map((step) {
      final (action, params) = step;
      return {
        'action': action,
        if (params != null) 'params': params,
      };
    }).toList();

    final response = await _request('POST', '/workflow', body: {'steps': stepsData});
    return response['result'] as T;
  }

  /// Streams results from a long-running operation.
  ///
  /// ```dart
  /// await for (final chunk in client.stream('generateReport', {'type': 'monthly'})) {
  ///   print('Received: $chunk');
  /// }
  /// ```
  Stream<T> stream<T>(String action, [Map<String, dynamic>? params]) async* {
    final body = {
      'action': action,
      if (params != null) 'params': params,
    };

    final conn = await _pool.acquire();
    try {
      final authHeader = await _auth.getAuthHeader();
      final request = http.Request('POST', Uri.parse('${_options.baseUrl}/stream'));
      request.headers['Authorization'] = authHeader;
      request.headers['Content-Type'] = 'application/json';
      request.headers['Accept'] = 'text/event-stream';
      request.body = jsonEncode(body);

      final response = await conn.client.send(request).timeout(_options.timeout);

      if (response.statusCode != 200) {
        throw DotDoNetworkError('HTTP ${response.statusCode}');
      }

      await for (final bytes in response.stream) {
        final line = utf8.decode(bytes).trim();
        if (line.startsWith('data: ')) {
          final data = jsonDecode(line.substring(6));
          yield data as T;
        }
      }
    } finally {
      _pool.release(conn);
    }
  }

  /// Makes an HTTP request with retry logic and connection pooling.
  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    if (_closed) {
      throw const DotDoNetworkError('Client is closed');
    }

    Object? lastError;
    var attempts = 0;

    while (attempts <= _options.maxRetries) {
      attempts++;

      final conn = await _pool.acquire();
      try {
        final authHeader = await _auth.getAuthHeader();
        final uri = Uri.parse('${_options.baseUrl}$path');

        http.Response response;
        switch (method) {
          case 'GET':
            response = await conn.client
                .get(uri, headers: {'Authorization': authHeader})
                .timeout(_options.timeout);
          case 'POST':
            response = await conn.client
                .post(
                  uri,
                  headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json',
                  },
                  body: body != null ? jsonEncode(body) : null,
                )
                .timeout(_options.timeout);
          default:
            throw UnsupportedError('Unsupported HTTP method: $method');
        }

        _pool.release(conn);

        // Handle response
        if (response.statusCode == 401) {
          throw const DotDoAuthError('Invalid or expired credentials');
        }

        if (response.statusCode == 429) {
          final retryAfter = response.headers['retry-after'];
          final delay = retryAfter != null
              ? Duration(seconds: int.tryParse(retryAfter) ?? 60)
              : const Duration(seconds: 60);
          throw DotDoRateLimitError(delay);
        }

        if (response.statusCode >= 500) {
          throw DotDoServerError(
            code: response.statusCode,
            message: 'Server error',
          );
        }

        if (response.statusCode != 200) {
          throw DotDoNetworkError('HTTP ${response.statusCode}: ${response.reasonPhrase}');
        }

        return jsonDecode(response.body) as Map<String, dynamic>;
      } on TimeoutException {
        _pool.release(conn);
        lastError = DotDoTimeoutError(_options.timeout, attempts);
      } on DotDoAuthError {
        _pool.release(conn);
        rethrow; // Don't retry auth errors
      } catch (e) {
        _pool.release(conn);
        lastError = e is DotDoError ? e : DotDoNetworkError('Request failed', e);
      }

      // Retry logic
      if (attempts <= _options.maxRetries && _shouldRetry(lastError!)) {
        Duration delay;

        if (lastError is DotDoRateLimitError) {
          delay = lastError.retryAfter;
        } else {
          delay = _calculateRetryDelay(
            attempts - 1,
            _options.retryDelay,
            _options.maxRetryDelay,
            _options.exponentialBackoff,
            _options.jitterFactor,
          );
        }

        await Future<void>.delayed(delay);
        continue;
      }

      break;
    }

    throw lastError ?? const DotDoNetworkError('Request failed after retries');
  }

  /// Closes the client and releases all resources.
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _pool.close();
  }
}
