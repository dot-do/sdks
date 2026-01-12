/// Base exception for {{Name}}.do errors
class {{Name}}Exception implements Exception {
  final String message;
  final String? code;
  final dynamic cause;

  {{Name}}Exception(this.message, {this.code, this.cause});

  @override
  String toString() {
    if (code != null) {
      return '{{Name}}Exception [$code]: $message';
    }
    return '{{Name}}Exception: $message';
  }
}

/// Exception thrown when authentication fails
class {{Name}}AuthException extends {{Name}}Exception {
  {{Name}}AuthException(super.message, {super.code, super.cause});
}

/// Exception thrown when a resource is not found
class {{Name}}NotFoundException extends {{Name}}Exception {
  {{Name}}NotFoundException(super.message, {super.code, super.cause});
}

/// Exception thrown when the connection fails
class {{Name}}ConnectionException extends {{Name}}Exception {
  {{Name}}ConnectionException(super.message, {super.code, super.cause});
}
