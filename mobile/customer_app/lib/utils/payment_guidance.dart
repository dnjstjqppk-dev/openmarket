// mobile/customer_app/lib/utils/payment_guidance.dart
// Pure payment-deadline guidance for a READY (payment-pending) order.
// The server holds stock for 30 minutes (PAYMENT_WINDOW_MS) and reports the
// deadline as payment_expires_at in UTC 'YYYY-MM-DD HH:MM:SS'. Mobile cannot pay
// in-app yet, so the guidance points at the PC web order history.

class PaymentGuidance {
  /// Short deadline line, e.g. '오늘 14:32까지 결제해 주세요 (29분 남음)'.
  final String deadlineText;
  final bool expired;
  final bool deadlineKnown;

  const PaymentGuidance({
    required this.deadlineText,
    required this.expired,
    required this.deadlineKnown,
  });
}

DateTime? parseServerTime(String? value) {
  if (value == null || value.isEmpty) return null;
  try {
    var normalized = value.trim();
    // 'YYYY-MM-DD HH:MM:SS' (UTC, no marker) -> ISO UTC so local conversion is right.
    if (RegExp(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$').hasMatch(normalized)) {
      normalized = '${normalized.replaceAll(' ', 'T')}Z';
    }
    return DateTime.parse(normalized).toLocal();
  } catch (_) {
    return null;
  }
}

String _two(int n) => n.toString().padLeft(2, '0');

PaymentGuidance computePaymentGuidance({String? expiresAt, DateTime? now}) {
  final current = (now ?? DateTime.now()).toLocal();
  final deadline = parseServerTime(expiresAt);
  if (deadline == null) {
    return const PaymentGuidance(
      deadlineText: '주문 후 30분 이내에 PC 웹에서 결제를 완료해 주세요.',
      expired: false,
      deadlineKnown: false,
    );
  }
  final left = deadline.difference(current);
  if (left.isNegative) {
    return const PaymentGuidance(
      deadlineText: '결제 가능 시간이 지났습니다. 다시 주문해 주세요.',
      expired: true,
      deadlineKnown: true,
    );
  }
  final minutes = left.inMinutes;
  final timeText = '${_two(deadline.hour)}:${_two(deadline.minute)}';
  final dayText = deadline.year == current.year && deadline.month == current.month && deadline.day == current.day
      ? '오늘'
      : '${deadline.month}/${deadline.day}';
  return PaymentGuidance(
    deadlineText: '$dayText $timeText까지 결제해 주세요 ($minutes분 남음)',
    expired: false,
    deadlineKnown: true,
  );
}
