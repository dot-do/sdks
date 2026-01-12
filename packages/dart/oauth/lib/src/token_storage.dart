import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as path;

/// File-based token storage for OAuth tokens.
/// Stores tokens in ~/.oauth.do/token
class TokenStorage {
  static const String _defaultTokenDir = '.oauth.do';
  static const String _defaultTokenFile = 'token';

  final String tokenPath;

  /// Creates a TokenStorage with default path (~/.oauth.do/token).
  TokenStorage()
      : tokenPath = path.join(
          Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? '.',
          _defaultTokenDir,
          _defaultTokenFile,
        );

  /// Creates a TokenStorage with a custom path.
  TokenStorage.custom(this.tokenPath);

  /// Saves token data to disk.
  Future<void> save(TokenData data) async {
    final file = File(tokenPath);
    await file.parent.create(recursive: true);

    final json = jsonEncode(data.toJson());
    await file.writeAsString(json);

    // Set restrictive permissions on Unix systems
    if (!Platform.isWindows) {
      await Process.run('chmod', ['600', tokenPath]);
    }
  }

  /// Loads token data from disk.
  Future<TokenData?> load() async {
    final file = File(tokenPath);
    if (!await file.exists()) {
      return null;
    }

    try {
      final content = await file.readAsString();
      final json = jsonDecode(content) as Map<String, dynamic>;
      return TokenData.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  /// Deletes stored token data.
  Future<bool> delete() async {
    final file = File(tokenPath);
    try {
      if (await file.exists()) {
        await file.delete();
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Checks if a valid (non-expired) token exists.
  Future<bool> hasValidToken() async {
    final data = await load();
    return data != null && !data.isExpired;
  }

  /// Gets the token file path.
  String getTokenPath() => tokenPath;
}

/// Token data structure for serialization.
class TokenData {
  final String accessToken;
  final String? refreshToken;
  final String tokenType;
  final int expiresAt;

  TokenData({
    required this.accessToken,
    this.refreshToken,
    this.tokenType = 'Bearer',
    required this.expiresAt,
  });

  /// Creates TokenData from JSON.
  factory TokenData.fromJson(Map<String, dynamic> json) {
    return TokenData(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String?,
      tokenType: json['tokenType'] as String? ?? 'Bearer',
      expiresAt: json['expiresAt'] as int,
    );
  }

  /// Converts TokenData to JSON.
  Map<String, dynamic> toJson() {
    return {
      'accessToken': accessToken,
      'refreshToken': refreshToken,
      'tokenType': tokenType,
      'expiresAt': expiresAt,
    };
  }

  /// Checks if the token is expired.
  bool get isExpired {
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return now >= expiresAt;
  }
}
