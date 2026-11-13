// P2-MOB-09 pilot pins: ARB ko/en resolve and placeholders work.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/l10n/app_localizations.dart';

void main() {
  test('ko bundle resolves pilot keys', () async {
    final t = await AppLocalizations.delegate.load(const Locale('ko'));
    expect(t.commonRetry, '다시 시도');
    expect(t.navDashboard, '대시보드');
    expect(t.navShipments, '출고·배송');
    expect(t.navSettlements, '정산');
    expect(t.navAccount, '내 정보');
    expect(t.loginTitleSeller, '판매자 로그인');
    expect(t.dashTitle, '판매자 운영 현황');
    expect(t.countOrders(5), '5건');
    expect(t.countPieces(3), '3개');
    expect(t.quickTracking, '운송장 등록');
    expect(t.quickSettlements, '정산 내역');
  });

  test('en bundle translates pilot keys (no ko passthrough)', () async {
    final t = await AppLocalizations.delegate.load(const Locale('en'));
    expect(t.commonRetry, 'Try again');
    expect(t.navDashboard, 'Dashboard');
    expect(t.navShipments, 'Shipments');
    expect(t.navSettlements, 'Settlements');
    expect(t.navAccount, 'My Account');
    expect(t.loginTitleSeller, 'Seller sign in');
    expect(t.dashTitle, 'Seller overview');
    expect(t.countOrders(5), '5');
    expect(t.countPieces(3), '3');
    expect(t.quickTracking, 'Register tracking');
    expect(t.quickSettlements, 'Settlement history');
    // Every checked key must differ from ko: catches untranslated keys,
    // since gen-l10n silently falls back to the template value.
    final ko = await AppLocalizations.delegate.load(const Locale('ko'));
    final pairs = [
      [ko.commonRetry, t.commonRetry],
      [ko.navDashboard, t.navDashboard],
      [ko.navShipments, t.navShipments],
      [ko.navSettlements, t.navSettlements],
      [ko.navAccount, t.navAccount],
      [ko.loginTitleSeller, t.loginTitleSeller],
      [ko.dashTitle, t.dashTitle],
      [ko.countOrders(5), t.countOrders(5)],
      [ko.countPieces(3), t.countPieces(3)],
      [ko.quickTracking, t.quickTracking],
      [ko.quickSettlements, t.quickSettlements],
    ];
    for (final p in pairs) {
      expect(p[1], isNot(p[0]), reason: '${p[0]} must be translated');
    }
  });

  test('app shell registers the delegate', () {
    // Without this, EN devices silently render the Korean fallback.
    final main = File('lib/main.dart').readAsStringSync();
    expect(main, contains('AppLocalizations.delegate'));
  });
}
