// Kakao app-login helpers (models/social_login.dart).
import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/social_login.dart';

void main() {
  test('app states are STATE_RE-safe and app-marked', () {
    final state = newSocialAppState(Random(7));
    expect(state.startsWith('app-'), isTrue);
    expect(RegExp(r'^[A-Za-z0-9_-]{8,256}$').hasMatch(state), isTrue);
    expect(isSocialAppState(state), isTrue);
    expect(isSocialAppState('a1b2c3d4e5f60718293a4b5c6d7e8f90'), isFalse);
    expect(isSocialAppState('app-abc'), isFalse);
  });

  test('start URL carries the encoded state', () {
    final url = socialStartUrl('https://api.example.com', 'app-deadbeef01');
    expect(
      url,
      'https://api.example.com/api/v1/auth/social/kakao/start?state=app-deadbeef01',
    );
  });

  test('success returns parse the code and echo the state', () {
    final r = parseSocialReturn(Uri.parse(
        'olmoa://social-login?social_code=once123&state=app-deadbeef01'));
    expect(r, isNotNull);
    expect(r!.understood, isTrue);
    expect(r.code, 'once123');
    expect(r.error, isNull);
    expect(r.state, 'app-deadbeef01');
  });

  test('denial returns parse the error code', () {
    final r = parseSocialReturn(Uri.parse(
        'olmoa://social-login?social_error=OAUTH_DENIED&state=app-deadbeef01'));
    expect(r, isNotNull);
    expect(r!.code, isNull);
    expect(r.error, 'OAUTH_DENIED');
  });

  test('foreign links and bare links are ignored', () {
    expect(parseSocialReturn(Uri.parse('olmoa://social-login')), isNull);
    expect(parseSocialReturn(Uri.parse('olmoa://other?social_code=x')), isNull);
    expect(parseSocialReturn(Uri.parse('https://x.example.com/login?social_code=x')), isNull);
    expect(parseSocialReturn(Uri.parse('olmoa://social-login?state=app-1')), isNull);
  });

  test('error copy matches the storefront', () {
    expect(socialErrorMessage('OAUTH_DENIED'), '카카오 로그인이 취소되었습니다.');
    expect(socialErrorMessage('EMAIL_TAKEN'),
        '이미 이메일로 가입된 계정입니다. 이메일과 비밀번호로 로그인해 주세요.');
    expect(socialErrorMessage('SOMETHING_NEW'), '소셜 로그인에 실패했습니다.');
  });
}
