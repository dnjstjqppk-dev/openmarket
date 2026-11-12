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
