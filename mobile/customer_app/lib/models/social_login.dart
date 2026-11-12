// mobile/customer_app/lib/models/social_login.dart
// Wave G2: Kakao app-login helpers. The app starts the same server flow as
// the SPA (GET .../kakao/start?state=...) with an `app-`-prefixed state, the
// system browser completes the provider leg, and the server bounces back to
// the olmoa://social-login deep link. State is verified before the one-time
// code is exchanged (login CSRF protection, LoginView.vue mirror).

import 'dart:math';

/// Server bounce target (routes/social-auth.js APP_CALLBACK_URL).
const socialAppScheme = 'olmoa';
const socialAppHost = 'social-login';

/// STATE_RE-safe prefix (`^[A-Za-z0-9_-]{8,256}$`) marking app logins.
const socialAppStatePrefix = 'app-';

const socialStateStoreKey = 'olmoa_social_state';

/// A STATE_RE-safe app state: `app-` + 32 lowercase hex chars.
String newSocialAppState([Random? random]) {
  final rng = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  return '$socialAppStatePrefix${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
}

bool isSocialAppState(String state) =>
    state.startsWith(socialAppStatePrefix) &&
    RegExp(r'^[A-Za-z0-9_-]{8,256}$').hasMatch(state);

String socialStartUrl(String baseUrl, String state) =>
    '$baseUrl/api/v1/auth/social/kakao/start?state=${Uri.encodeQueryComponent(state)}';

/// Parsed deep-link return. Exactly one of [code]/[error] is set on a link
/// the app understands; [state] echoes for verification.
class SocialLoginReturn {
  final String? code;
  final String? error;
  final String state;

  const SocialLoginReturn({this.code, this.error, required this.state});

  bool get understood => code != null || error != null;
}

/// Null when the link is not an OAuth return for this app.
SocialLoginReturn? parseSocialReturn(Uri link) {
  if (link.scheme != socialAppScheme || link.host != socialAppHost) {
    return null;
  }
  final code = link.queryParameters['social_code'];
  final error = link.queryParameters['social_error'];
  final state = link.queryParameters['state'] ?? '';
  if ((code == null || code.isEmpty) && (error == null || error.isEmpty)) {
    return null;
  }
  return SocialLoginReturn(
    code: (code != null && code.isNotEmpty) ? code : null,
    error: (error != null && error.isNotEmpty) ? error : null,
    state: state,
  );
}

/// LoginView.vue SOCIAL_ERRORS mirror (same Korean copy).
const socialErrors = {
  'OAUTH_DENIED': '카카오 로그인이 취소되었습니다.',
  'OAUTH_EXCHANGE_FAILED': '카카오 인증에 실패했습니다. 다시 시도해 주세요.',
  'OAUTH_PROFILE_FAILED': '카카오 회원 정보를 가져오지 못했습니다.',
  'OAUTH_PROVIDER_ERROR': '카카오 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  'OAUTH_EMAIL_REQUIRED': '카카오 계정의 이메일 제공에 동의해야 가입할 수 있습니다.',
  'EMAIL_TAKEN': '이미 이메일로 가입된 계정입니다. 이메일과 비밀번호로 로그인해 주세요.',
  'ACCOUNT_DISABLED': '비활성화된 계정입니다.',
};

String socialErrorMessage(String code) =>
    socialErrors[code] ?? '소셜 로그인에 실패했습니다.';

/// Deep-link source seam. Production code uses the AppLinks-backed
/// implementation; widget tests install [NoopSocialLinkSource] so no widget
/// test ever touches the host platform channel (its async handshake error
/// would otherwise leak into neighboring tests).
abstract class SocialLinkSource {
  Stream<Uri> incomingLinks();
  Future<Uri?> initialLink();
}

class NoopSocialLinkSource implements SocialLinkSource {
  const NoopSocialLinkSource();

  @override
  Stream<Uri> incomingLinks() => const Stream.empty();

  @override
  Future<Uri?> initialLink() async => null;
}
