// mobile/customer_app/lib/views/login_view.dart
// Customer sign-in against POST /api/v1/auth/login (role CUSTOMER).
// On success the server-issued JWT is stored in AuthSession.

import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../l10n/app_localizations.dart';
import '../models/social_login.dart';
import '../services/api_service.dart';
import '../services/push_service.dart';
import '../theme/app_theme.dart';
import 'forgot_password_view.dart';
import 'register_view.dart';
import 'verify_email_view.dart';

class LoginView extends StatefulWidget {
  final VoidCallback onSuccess;
  final String reason;

  const LoginView(
      {super.key,
      required this.onSuccess,
      this.reason = '주문 조회와 결제는 로그인이 필요합니다.'});

  @override
  State<LoginView> createState() => _LoginViewState();
}

/// Production deep-link source. Widget tests replace it with
/// [NoopSocialLinkSource] before pumping [LoginView].
SocialLinkSource socialLinkSource = _AppLinksSocialLinkSource();

class _AppLinksSocialLinkSource implements SocialLinkSource {
  final _links = AppLinks();

  @override
  Stream<Uri> incomingLinks() => _links.uriLinkStream;

  @override
  Future<Uri?> initialLink() => _links.getInitialLink();
}

class _LoginViewState extends State<LoginView> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _socialBusy = false;
  StreamSubscription<Uri>? _linkSub;

  @override
  void initState() {
    super.initState();
    // Wave G2: OAuth returns arrive on olmoa://social-login, warm or cold.
    try {
      _linkSub = socialLinkSource.incomingLinks().listen(_consumeSocialLink,
          onError: (_) {});
      socialLinkSource.initialLink().then((link) {
        if (link != null) _consumeSocialLink(link);
      }).catchError((_) => null);
    } catch (_) {
      _linkSub = null;
    }
  }

  @override
  void dispose() {
    _linkSub?.cancel().then((_) {}, onError: (_) {});
    _linkSub = null;
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Starts Kakao login in the system browser. Probes first: an unconfigured
  /// server answers 501 JSON instead of the 302 to Kakao (LoginView.vue mirror).
  Future<void> _startKakao() async {
    if (_socialBusy) return;
    // P2-MOB-09: resolve strings before the async gaps (no context after await).
    final t = AppLocalizations.of(context);
    setState(() {
      _socialBusy = true;
      _error = null;
    });
    try {
      final state = newSocialAppState();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(socialStateStoreKey, state);
      final url = socialStartUrl(ApiService.baseUrl, state);
      final client = http.Client();
      int status;
      try {
        final req = http.Request('GET', Uri.parse(url))
          ..followRedirects = false;
        final res = await client.send(req).timeout(const Duration(seconds: 10));
        await res.stream.drain();
        status = res.statusCode;
      } finally {
        client.close();
      }
      if (status == 302) {
        final launched = await launchUrl(Uri.parse(url),
            mode: LaunchMode.externalApplication);
        if (!launched && mounted) {
          await prefs.remove(socialStateStoreKey);
          setState(() => _error =
              t?.loginBrowserFail ?? '브라우저를 열 수 없습니다. 다시 시도해 주세요.');
        }
        return;
      }
      await prefs.remove(socialStateStoreKey);
      if (!mounted) return;
      setState(() => _error = status == 501
          ? t?.loginSocialUnavailable ?? '소셜 로그인은 아직 제공되지 않습니다.'
          : t?.errorServerUnreachable ??
              '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } catch (_) {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(socialStateStoreKey);
      } catch (_) {}
      if (mounted) {
        setState(() => _error = t?.errorServerUnreachable ??
            '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      if (mounted) setState(() => _socialBusy = false);
    }
  }

  /// Consumes an OAuth return link: state is verified before the one-time
  /// code is touched, exactly like the SPA.
  Future<void> _consumeSocialLink(Uri link) async {
    final parsed = parseSocialReturn(link);
    if (parsed == null || !parsed.understood) return;
    // P2-MOB-09: resolve strings before the async gaps (no context after await).
    final t = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final prefs = await SharedPreferences.getInstance();
    final expected = prefs.getString(socialStateStoreKey);
    await prefs.remove(socialStateStoreKey);
    if (!mounted) return;
    if (expected == null || parsed.state != expected) {
      setState(() => _error =
          t?.loginLinkInvalid ?? '로그인 요청을 확인할 수 없습니다. 다시 시도해 주세요.');
      return;
    }
    if (parsed.error != null) {
      setState(() => _error = socialErrorMessage(parsed.error!, locale: locale));
      return;
    }
    setState(() {
      _socialBusy = true;
      _error = null;
    });
    final r = await AuthSession.loginWithSocialCode(code: parsed.code!);
    if (!mounted) return;
    setState(() => _socialBusy = false);
    if (r['success'] == true) {
      widget.onSuccess();
      PushService.syncAfterLogin();
    } else {
      setState(() =>
          _error = (r['error'] ?? t?.socialErrFallback ?? '소셜 로그인에 실패했습니다.')
              .toString());
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    // P2-MOB-09: resolve strings before the async gaps (no context after await).
    final t = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    final r =
        await AuthSession.login(email: _email.text, password: _password.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r['success'] == true) {
      widget.onSuccess();
      PushService.syncAfterLogin();
    } else {
      setState(() =>
          _error = (r['error'] ?? t?.errorLoginFailed ?? '로그인하지 못했습니다.')
              .toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    // P2-MOB-09: nullable lookup with Korean fallback (bare-context safe).
    final t = AppLocalizations.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.lock_outline,
                size: 48, color: OlmoaColors.lagoon600),
            const SizedBox(height: 12),
            Text(t?.actionLogin ?? '로그인',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Text(widget.reason,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            const SizedBox(height: 20),
            TextField(
              controller: _email,
              decoration: InputDecoration(
                  labelText: t?.fieldEmail ?? '이메일',
                  border: const OutlineInputBorder()),
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              decoration: InputDecoration(
                  labelText: t?.fieldPassword ?? '비밀번호',
                  border: const OutlineInputBorder()),
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              onSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
            ],
            const SizedBox(height: 16),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                style: ElevatedButton.styleFrom(
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            color: Colors.white, strokeWidth: 2))
                    : Text(t?.actionLogin ?? '로그인',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(t?.loginOr ?? '또는',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 12)),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _socialBusy ? null : _startKakao,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFFEE500),
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: _socialBusy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            color: Colors.black, strokeWidth: 2))
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.chat_bubble, size: 18),
                          const SizedBox(width: 8),
                          Text(t?.loginKakao ?? '카카오로 시작하기',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15)),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 8),
            // P2-MOB-P1: auth side doors live next to the login form.
            TextButton(
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => Scaffold(
                      appBar: AppBar(
                          title: Text(t?.loginSignupTitle ?? '회원가입')),
                      body: RegisterView(onSuccess: () {
                        Navigator.of(context).pop();
                        widget.onSuccess();
                      })))),
              child: Text(t?.loginSignupPrompt ?? '아직 회원이 아니세요? 가입하기'),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => Scaffold(
                          appBar: AppBar(
                              title: Text(
                                  t?.loginFindPassword ?? '비밀번호 찾기')),
                          body: const ForgotPasswordView()))),
                  child: Text(t?.loginFindPassword ?? '비밀번호 찾기',
                      style: const TextStyle(fontSize: 12)),
                ),
                const Text('·', style: TextStyle(color: Colors.grey)),
                TextButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => Scaffold(
                          appBar: AppBar(
                              title:
                                  Text(t?.loginVerifyEmail ?? '이메일 인증')),
                          body: const VerifyEmailView()))),
                  child: Text(t?.loginVerifyEmail ?? '이메일 인증',
                      style: const TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
