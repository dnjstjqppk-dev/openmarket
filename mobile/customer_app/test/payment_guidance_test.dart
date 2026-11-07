// Unit tests for payment-deadline guidance (pure, no I/O).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/utils/payment_guidance.dart';

void main() {
  group('parseServerTime', () {
    test('parses UTC sql timestamps to local time', () {
      final t = parseServerTime('2026-11-07 05:00:00');
      expect(t, isNotNull);
      expect(t!.isUtc, isFalse);
      expect(t.toUtc().toIso8601String(), '2026-11-07T05:00:00.000Z');
    });

    test('unparsable input yields null', () {
      expect(parseServerTime(null), isNull);
      expect(parseServerTime(''), isNull);
      expect(parseServerTime('어제쯤'), isNull);
    });
  });

  group('computePaymentGuidance', () {
    test('shows remaining minutes before the deadline', () {
      final now = DateTime.utc(2026, 11, 7, 5, 0);
      final g = computePaymentGuidance(expiresAt: '2026-11-07 05:29:00', now: now);
      expect(g.expired, isFalse);
      expect(g.deadlineKnown, isTrue);
      expect(g.deadlineText, contains('29분 남음'));
    });

    test('past deadline is expired', () {
      final g = computePaymentGuidance(
        expiresAt: '2026-11-07 05:00:00',
        now: DateTime.utc(2026, 11, 7, 6, 0),
      );
      expect(g.expired, isTrue);
    });

    test('unknown deadline falls back to the generic 30-minute guidance', () {
      final g = computePaymentGuidance(now: DateTime.utc(2026, 11, 7, 5, 0));
      expect(g.expired, isFalse);
      expect(g.deadlineKnown, isFalse);
      expect(g.deadlineText, contains('30분 이내'));
    });
  });
}
