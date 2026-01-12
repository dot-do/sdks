/// Device flow OAuth SDK for the .do platform.
library oauth_do;

import 'dart:convert';
import 'package:http/http.dart' as http;

import 'src/device_flow.dart';
import 'src/token_storage.dart';

export 'src/device_flow.dart';
export 'src/token_storage.dart';

/// OAuth client for .do platform authentication.
/// Provides device flow authentication and token management.
class OAuthClient {
  static const String _userInfoUrl = 'https://apis.do/me';

  final DeviceFlow deviceFlow;
  final TokenStorage tokenStorage;
  final http.Client _client;

  /// Creates an OAuthClient with default configuration.
  OAuthClient()
      : deviceFlow = DeviceFlow(),
        tokenStorage = TokenStorage(),
        _client = http.Client();

  /// Creates an OAuthClient with a custom client ID.
  OAuthClient.withClientId(String clientId)
      : deviceFlow = DeviceFlow.custom(clientId),
        tokenStorage = TokenStorage(),
        _client = http.Client();

  /// Creates an OAuthClient with custom components.
  OAuthClient.custom({
    required this.deviceFlow,
    required this.tokenStorage,
  }) : _client = http.Client();

  /// Performs device flow login.
  Future<TokenData> login({
    required void Function(DeviceAuthResponse auth) onPrompt,
    void Function(int attempt)? onPoll,
  }) async {
    // Initiate device authorization
    final auth = await deviceFlow.authorize();

    // Show prompt to user
    onPrompt(auth);

    // Poll for token
    final token = await deviceFlow.pollForToken(
      deviceCode: auth.deviceCode,
      interval: auth.interval,
      timeout: auth.expiresIn,
      onPoll: onPoll,
    );

    if (token.isError) {
      throw OAuthException(
        'Authentication failed: ${token.error}'
            '${token.errorDescription != null ? " - ${token.errorDescription}" : ""}',
      );
    }

    if (token.accessToken == null) {
      throw OAuthException('No access token received');
    }

    // Save token
    final expiresAt = DateTime.now().millisecondsSinceEpoch ~/ 1000 + token.expiresIn;
    final tokenData = TokenData(
      accessToken: token.accessToken!,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAt: expiresAt,
    );
    await tokenStorage.save(tokenData);

    return tokenData;
  }

  /// Logs out by deleting stored tokens.
  Future<bool> logout() async {
    return tokenStorage.delete();
  }

  /// Gets the current access token if valid.
  Future<String?> getAccessToken() async {
    final data = await tokenStorage.load();
    if (data != null && !data.isExpired) {
      return data.accessToken;
    }
    return null;
  }

  /// Checks if user is authenticated with a valid token.
  Future<bool> isAuthenticated() async {
    return tokenStorage.hasValidToken();
  }

  /// Gets user information for the authenticated user.
  Future<UserInfo> getUserInfo() async {
    final accessToken = await getAccessToken();
    if (accessToken == null) {
      throw OAuthException('Not authenticated');
    }

    final response = await _client.get(
      Uri.parse(_userInfoUrl),
      headers: {'Authorization': 'Bearer $accessToken'},
    );

    if (response.statusCode != 200) {
      throw OAuthException('Failed to get user info: ${response.body}');
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;

    // Handle nested user object if present
    final userData = (json['user'] as Map<String, dynamic>?) ?? json;

    return UserInfo(
      id: userData['id'] as String?,
      email: userData['email'] as String?,
      name: userData['name'] as String?,
      picture: userData['picture'] as String?,
    );
  }

  /// Closes HTTP clients.
  void close() {
    _client.close();
    deviceFlow.close();
  }

  /// Gets the device flow handler.
  DeviceFlow getDeviceFlow() => deviceFlow;

  /// Gets the token storage handler.
  TokenStorage getTokenStorage() => tokenStorage;
}

/// User information response.
class UserInfo {
  final String? id;
  final String? email;
  final String? name;
  final String? picture;

  UserInfo({
    this.id,
    this.email,
    this.name,
    this.picture,
  });

  @override
  String toString() => "User(id='$id', email='$email', name='$name')";
}

/// OAuth exception.
class OAuthException implements Exception {
  final String message;
  OAuthException(this.message);

  @override
  String toString() => message;
}
