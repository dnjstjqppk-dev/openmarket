// mobile/partner_app/lib/models/sentry_options.dart
// Wave H-4: crash-reporting configuration. The DSN arrives via
// --dart-define SENTRY_DSN (empty by default); without a valid DSN the SDK
// never initializes and the app runs exactly as before.

class SentryConfig {
  final bool enabled;
  final String dsn;
  final String environment;

  const SentryConfig(
      {required this.enabled, required this.dsn, required this.environment});
}

SentryConfig resolveSentryConfig(
    {required String dsn, required String environment}) {
  final cleanEnv =
      environment.trim().isEmpty ? 'production' : environment.trim();
  final cleanDsn = dsn.trim();
  if (cleanDsn.isEmpty) {
    return SentryConfig(enabled: false, dsn: '', environment: cleanEnv);
  }
  final uri = Uri.tryParse(cleanDsn);
  final valid = uri != null &&
      (uri.scheme == 'http' || uri.scheme == 'https') &&
      uri.host.isNotEmpty;
  return SentryConfig(
      enabled: valid, dsn: valid ? cleanDsn : '', environment: cleanEnv);
}
