import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Device flow authorization for OAuth.
/// Implements the device authorization grant flow.
class DeviceFlow {
  static const String _authUrl = 'https://auth.apis.do/user_management/authorize_device';
  static const String _tokenUrl = 'https://auth.apis.do/user_management/authenticate';
  static const String defaultClientId = 'client_01JQYTRXK9ZPD8JPJTKDCRB656';

  final String clientId;
  final http.Client _client;

  /// Creates a DeviceFlow with the default client ID.
  DeviceFlow() : this.custom(defaultClientId);

  /// Creates a DeviceFlow with a custom client ID.
  DeviceFlow.custom(this.clientId) : _client = http.Client();

  /// Initiates device authorization.
  Future<DeviceAuthResponse> authorize() async {
    final response = await _client.post(
      Uri.parse(_authUrl),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'client_id=$clientId',
    );

    if (response.statusCode != 200) {
      throw DeviceFlowException('Authorization failed: ${response.body}');
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return DeviceAuthResponse(
      deviceCode: json['device_code'] as String,
      userCode: json['user_code'] as String,
      verificationUri: json['verification_uri'] as String,
      verificationUriComplete: json['verification_uri_complete'] as String?,
      expiresIn: json['expires_in'] as int? ?? 900,
      interval: json['interval'] as int? ?? 5,
    );
  }

  /// Polls for token after user authorization.
  Future<TokenResponse> pollForToken({
    required String deviceCode,
    int interval = 5,
    int timeout = 900,
    void Function(int)? onPoll,
  }) async {
    final startTime = DateTime.now();
    var pollInterval = interval;
    var attempts = 0;

    while (DateTime.now().difference(startTime).inSeconds < timeout) {
      attempts++;
      onPoll?.call(attempts);

      final body = 'client_id=$clientId'
          '&device_code=$deviceCode'
          '&grant_type=urn:ietf:params:oauth:grant-type:device_code';

      final response = await _client.post(
        Uri.parse(_tokenUrl),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body,
      );

      final json = jsonDecode(response.body) as Map<String, dynamic>;

      if (json.containsKey('error')) {
        final error = json['error'] as String;
        final errorDescription = json['error_description'] as String?;

        if (error == 'slow_down') {
          pollInterval += 5;
        }

        if (error != 'authorization_pending' && error != 'slow_down') {
          return TokenResponse(
            error: error,
            errorDescription: errorDescription,
          );
        }
      } else {
        return TokenResponse(
          accessToken: json['access_token'] as String?,
          refreshToken: json['refresh_token'] as String?,
          tokenType: json['token_type'] as String? ?? 'Bearer',
          expiresIn: json['expires_in'] as int? ?? 3600,
        );
      }

      await Future.delayed(Duration(seconds: pollInterval));
    }

    throw TimeoutException('Authorization timed out after $timeout seconds');
  }

  /// Closes the HTTP client.
  void close() {
    _client.close();
  }

  /// Gets the client ID.
  String getClientId() => clientId;
}

/// Device authorization response.
class DeviceAuthResponse {
  final String deviceCode;
  final String userCode;
  final String verificationUri;
  final String? verificationUriComplete;
  final int expiresIn;
  final int interval;

  DeviceAuthResponse({
    required this.deviceCode,
    required this.userCode,
    required this.verificationUri,
    this.verificationUriComplete,
    this.expiresIn = 900,
    this.interval = 5,
  });

  @override
  String toString() => 'Visit $verificationUri and enter code: $userCode';
}

/// Token response from authentication.
class TokenResponse {
  final String? accessToken;
  final String? refreshToken;
  final String tokenType;
  final int expiresIn;
  final String? error;
  final String? errorDescription;

  TokenResponse({
    this.accessToken,
    this.refreshToken,
    this.tokenType = 'Bearer',
    this.expiresIn = 3600,
    this.error,
    this.errorDescription,
  });

  bool get isError => error != null;
  bool get isPending => error == 'authorization_pending' || error == 'slow_down';
}

/// Device flow exception.
class DeviceFlowException implements Exception {
  final String message;
  DeviceFlowException(this.message);

  @override
  String toString() => message;
}
