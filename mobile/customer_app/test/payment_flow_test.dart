// Unit tests for in-app payment routing (pure, no I/O).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/utils/payment_route.dart';

void main() {
  group('paymentRouteFor', () {
    test('simulator mode routes to the sandbox confirm flow', () {
      expect(paymentRouteFor('SANDBOX_SIMULATOR', null), PaymentRoute.simulator);
    });

    test('toss mode with a client key routes to the widget', () {
      expect(paymentRouteFor('TOSS', 'test_ck_123'), PaymentRoute.tossWidget);
    });

    test('toss mode without a client key is disabled', () {
      expect(paymentRouteFor('TOSS', null), PaymentRoute.disabled);
      expect(paymentRouteFor('TOSS', ''), PaymentRoute.disabled);
    });

    test('unknown modes are disabled', () {
      expect(paymentRouteFor('DISABLED', null), PaymentRoute.disabled);
      expect(paymentRouteFor('BOGUS', 'x'), PaymentRoute.disabled);
    });
  });

  group('buildOrderName', () {
    test('single line uses its title', () {
      expect(buildOrderName(['무선 이어폰']), '무선 이어폰');
    });

    test('multi-line appends the remainder count', () {
      expect(buildOrderName(['무선 이어폰', '충전기', '케이스']), '무선 이어폰 외 2건');
    });

    test('empty lines fall back to a generic name', () {
      expect(buildOrderName([]), '올모아 주문');
    });
  });

  group('simulatorKey', () {
    test('matches the server sandbox key format', () {
      expect(simulatorKey(), matches(RegExp(r'^sandbox_[A-Za-z0-9_-]{8,}$')));
    });
  });
}
