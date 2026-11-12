// Sentry configuration resolution (models/sentry_options.dart).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/sentry_options.dart';

void main() {
  test('empty DSN disables reporting', () {
    final c = resolveSentryConfig(dsn: '', environment: 'production');
    expect(c.enabled, isFalse);
    expect(c.dsn, '');
  });

  test('malformed DSNs never enable the SDK', () {
    expect(resolveSentryConfig(dsn: 'not-a-url', environment: '').enabled,
        isFalse);
    expect(
        resolveSentryConfig(dsn: 'ftp://x.example.com/1', environment: '')
            .enabled,
        isFalse);
  });

  test('https DSNs enable with a trimmed environment', () {
    final c = resolveSentryConfig(
        dsn: 'https://abc@o1.ingest.sentry.io/2', environment: '  ');
    expect(c.enabled, isTrue);
    expect(c.environment, 'production');
  });
}
