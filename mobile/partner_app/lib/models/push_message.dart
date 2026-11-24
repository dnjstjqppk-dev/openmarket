// mobile/partner_app/lib/models/push_message.dart
// Wave J-2: inbound push payload parsing (FCM RemoteMessage, server template
// SELLER_NEW_ORDER). Defensive: missing title/body fall back, never null.

class PartnerPushMessage {
  final String title;
  final String body;
  final String type;
  final String orderNo;

  const PartnerPushMessage({
    required this.title,
    required this.body,
    required this.type,
    required this.orderNo,
  });

  factory PartnerPushMessage.fromMap(Map<String, dynamic> map) {
    final data = map['data'];
    final dataMap = data is Map ? data : const {};
    return PartnerPushMessage(
      title: (map['title'] ?? '').toString().trim().isNotEmpty
          ? (map['title'] ?? '').toString().trim()
          : '올모아 파트너 알림',
      body: (map['body'] ?? '').toString().trim().isNotEmpty
          ? (map['body'] ?? '').toString().trim()
          : '새로운 알림이 도착했습니다.',
      type: (dataMap['type'] ?? '').toString(),
      orderNo: (dataMap['order_no'] ?? '').toString(),
    );
  }
}

/// GAP-02: notification-tap destination. A new-order tap opens the shipment
/// list pre-filtered to that order; anything else opens plain dispatch.
class PartnerPushRoute {
  final String kind; // 'shipment' | 'dispatch'
  final String orderNo;

  const PartnerPushRoute._({required this.kind, this.orderNo = ''});

  static const dispatch = PartnerPushRoute._(kind: 'dispatch');

  factory PartnerPushRoute.fromData(Map<String, dynamic> data) {
    final type = (data['type'] ?? '').toString();
    final orderNo = (data['order_no'] ?? '').toString();
    if (type == 'SELLER_NEW_ORDER' && orderNo.isNotEmpty) {
      return PartnerPushRoute._(kind: 'shipment', orderNo: orderNo);
    }
    return dispatch;
  }
}
