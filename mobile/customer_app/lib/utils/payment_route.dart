// mobile/customer_app/lib/utils/payment_route.dart
// Pure in-app payment routing from GET /api/v1/payments/config.
// Mirrors the storefront CheckoutView branches: the Toss widget when the
// server offers a client key, the sandbox simulator confirm flow in
// development, and an honest disabled state otherwise.

import 'dart:math';

enum PaymentRoute { tossWidget, simulator, disabled }

PaymentRoute paymentRouteFor(String? mode, String? clientKey) {
  if (mode == 'SANDBOX_SIMULATOR') return PaymentRoute.simulator;
  if (mode == 'TOSS' && clientKey != null && clientKey.isNotEmpty) {
    return PaymentRoute.tossWidget;
  }
  return PaymentRoute.disabled;
}

/// '무선 이어폰 외 2건' style order name for the PG payment window.
String buildOrderName(List<String> titles) {
  if (titles.isEmpty) return '올모아 주문';
  if (titles.length == 1) return titles.first;
  return '${titles.first} 외 ${titles.length - 1}건';
}

/// Simulator payment key accepted by pgConfirm (sandbox_ + 8 or more).
String simulatorKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  final rnd = Random.secure();
  final tail = List.generate(16, (_) => alphabet[rnd.nextInt(alphabet.length)]).join();
  return 'sandbox_$tail';
}
