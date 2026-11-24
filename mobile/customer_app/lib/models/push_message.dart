// mobile/customer_app/lib/models/push_message.dart
// Wave H-2: inbound push payload parsing (FCM RemoteMessage, server templates
// ORDER_SHIPPED / ORDER_DELIVERED / REFUND_COMPLETED / CLAIM_* / BROADCAST).
// Defensive: missing title/body fall back to generic copy, never null.

class OlmoaPushMessage {
  final String title;
  final String body;
  final String type;
  final String orderNo;
  final String productId;

  const OlmoaPushMessage({
    required this.title,
    required this.body,
    required this.type,
    required this.orderNo,
    this.productId = '',
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
      productId: (dataMap['product_id'] ?? '').toString(),
    );
  }

  bool get isOrderEvent => type.startsWith('ORDER_') || type == 'REFUND_COMPLETED';
}

/// GAP-02: notification-tap destination parsed from the FCM data payload.
/// Unknown or incomplete payloads resolve to the inbox (never null, never a
/// dead route). Claim events open the referenced order (compensation and
/// return actions live on the order detail).
class OlmoaPushRoute {
  final String kind; // 'order' | 'product' | 'inbox'
  final String orderNo;
  final String productId;

  const OlmoaPushRoute._({required this.kind, this.orderNo = '', this.productId = ''});

  static const inbox = OlmoaPushRoute._(kind: 'inbox');

  factory OlmoaPushRoute.fromData(Map<String, dynamic> data) {
    final type = (data['type'] ?? '').toString();
    final orderNo = (data['order_no'] ?? '').toString();
    final productId = (data['product_id'] ?? '').toString();
    if (productId.isNotEmpty && type == 'RESTOCK_AVAILABLE') {
      return OlmoaPushRoute._(kind: 'product', productId: productId);
    }
    if (orderNo.isNotEmpty &&
        (type.startsWith('ORDER_') ||
            type == 'REFUND_COMPLETED' ||
            type.startsWith('CLAIM_'))) {
      return OlmoaPushRoute._(kind: 'order', orderNo: orderNo);
    }
    return inbox;
  }
}
