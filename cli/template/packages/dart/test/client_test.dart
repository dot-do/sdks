import 'package:test/test.dart';
import 'package:{{name}}_do/{{name}}_do.dart';

void main() {
  group('{{Name}}Client', () {
    test('creates with default options', () {
      final client = {{Name}}Client();
      expect(client.options.baseUrl, equals('https://{{name}}.do'));
      expect(client.options.apiKey, isNull);
      expect(client.isConnected, isFalse);
    });

    test('creates with custom options', () {
      final client = {{Name}}Client(
        apiKey: 'test-key',
        baseUrl: 'https://test.{{name}}.do',
      );
      expect(client.options.baseUrl, equals('https://test.{{name}}.do'));
      expect(client.options.apiKey, equals('test-key'));
    });

    test('throws when accessing rpc before connect', () {
      final client = {{Name}}Client();
      expect(() => client.rpc, throwsStateError);
    });
  });

  group('{{Name}}Exception', () {
    test('formats without code', () {
      final ex = {{Name}}Exception('Test error');
      expect(ex.toString(), equals('{{Name}}Exception: Test error'));
    });

    test('formats with code', () {
      final ex = {{Name}}Exception('Test error', code: 'ERR001');
      expect(ex.toString(), equals('{{Name}}Exception [ERR001]: Test error'));
    });
  });
}
