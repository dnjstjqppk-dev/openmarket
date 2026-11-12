// mobile/customer_app/lib/models/push_message.dart
// Wave H-2: inbound push payload parsing (FCM RemoteMessage, server templates
// ORDER_SHIPPED / ORDER_DELIVERED / REFUND_COMPLETED / CLAIM_* / BROADCAST).
// Defensive: missing title/body fall back to generic copy, never null.

class OlmoaPushMessage {
  final String title;
  final String body;
  final String type;
  final String orderNo;

  const OlmoaPushMessage({
    required this.title,
    required this.body,
    required this.type,
    required this.orderNo,
  });

  static const knownTypes = {
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
    'REFUND_COMPLETED',
    'CLAIM_CREDIT_GRANTED',
    'CLAIM_REJECTED',
    'BROADCAST',
  };

  factory OlmoaPushMessage.fromMap(Map<String, dynamic> map) {
    final data = map['data'];
    final dataMap = data is Map ? data : const {};
    return OlmoaPushMessage(
      title: (map['title'] ?? '').toString().trim().isNotEmpty
          ? (map['title'] ?? '').toString().trim()
          : 'OLMOA 알림',
      body: (map['body'] ?? '').toString().trim().isNotEmpty
          ? (map['body'] ?? '').toString().trim()
          : '새로운 알림이 도착했습니다.',
      type: (dataMap['type'] ?? '').toString(),
      orderNo: (dataMap['order_no'] ?? '').toString(),
    );
  }

  bool get isOrderEvent => type.startsWith('ORDER_') || type == 'REFUND_COMPLETED';
}
