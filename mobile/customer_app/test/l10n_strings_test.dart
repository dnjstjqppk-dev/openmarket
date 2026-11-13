// P2-MOB-09 pilot pins: ARB ko/en resolve, placeholders work, and the
// social error maps stay complete per locale. Bare-context fallback is
// covered by the golden login tests (bare MaterialApp, pixel-identical).
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/l10n/app_localizations.dart';
import 'package:olmoa_customer/models/social_login.dart';

void main() {
  test('ko bundle resolves pilot keys', () async {
    final t = await AppLocalizations.delegate.load(const Locale('ko'));
    expect(t.commonRetry, '다시 시도');
    expect(t.navHome, '홈');
    expect(t.navCart, '장바구니');
    expect(t.navOrders, '주문내역');
    expect(t.navAccount, '내 정보');
    expect(t.homeAll, '전체');
    expect(t.homeForYou, '맞춤 추천');
    expect(t.cartAdded('무선 이어폰'), '[무선 이어폰] 장바구니에 담겼습니다.');
    expect(t.loginKakao, '카카오로 시작하기');
  });

  test('en bundle translates pilot keys (no ko passthrough)', () async {
    final t = await AppLocalizations.delegate.load(const Locale('en'));
    expect(t.commonRetry, 'Try again');
    expect(t.navHome, 'Home');
    expect(t.navCart, 'Cart');
    expect(t.navOrders, 'Orders');
    expect(t.navAccount, 'My Account');
    expect(t.homeAll, 'All');
    expect(t.homeForYou, 'For you');
    expect(t.cartAdded('Buds'), '[Buds] added to your cart.');
    expect(t.loginKakao, 'Continue with Kakao');
    // Every checked key must differ from ko: catches untranslated keys,
    // since gen-l10n silently falls back to the template value.
    final ko = await AppLocalizations.delegate.load(const Locale('ko'));
    final pairs = [
      [ko.commonRetry, t.commonRetry],
      [ko.navHome, t.navHome],
      [ko.navCart, t.navCart],
      [ko.navOrders, t.navOrders],
      [ko.navAccount, t.navAccount],
      [ko.homeAll, t.homeAll],
      [ko.homeForYou, t.homeForYou],
      [ko.loginKakao, t.loginKakao],
      [ko.cartAdded('x'), t.cartAdded('x')],
    ];
    for (final p in pairs) {
      expect(p[1], isNot(p[0]), reason: '${p[0]} must be translated');
    }
  });

  test('social error maps agree per locale', () {
    expect(socialErrors.keys, unorderedEquals(socialErrorsEn.keys));
    expect(socialErrorMessage('OAUTH_DENIED'), socialErrors['OAUTH_DENIED']);
    expect(socialErrorMessage('OAUTH_DENIED', locale: 'en'),
        socialErrorsEn['OAUTH_DENIED']);
    expect(socialErrorMessage('OAUTH_DENIED', locale: 'en-US'),
        socialErrorsEn['OAUTH_DENIED']);
    expect(socialErrorMessage('NOPE'), '소셜 로그인에 실패했습니다.');
    expect(socialErrorMessage('NOPE', locale: 'en'), 'Social sign-in failed.');
    expect(socialErrorMessage('NOPE', locale: 'en'),
        isNot(socialErrorMessage('NOPE')));
  });

  test('app shell registers the delegate', () {
    // Without this, EN devices silently render the Korean fallback.
    final main = File('lib/main.dart').readAsStringSync();
    expect(main, contains('AppLocalizations.delegate'));
  });
}
