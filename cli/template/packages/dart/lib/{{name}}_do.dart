/// {{Name}}.do SDK for Dart
///
/// {{description}}
///
/// Example:
/// ```dart
/// import 'package:{{name}}_do/{{name}}_do.dart';
///
/// void main() async {
///   final client = {{Name}}Client(apiKey: Platform.environment['DOTDO_KEY']);
///   await client.connect();
///   // Use the client...
///   await client.disconnect();
/// }
/// ```
library {{name}}_do;

export 'src/client.dart';
export 'src/exceptions.dart';
