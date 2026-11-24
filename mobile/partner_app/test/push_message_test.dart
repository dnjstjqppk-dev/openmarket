// Inbound push payload parsing (models/push_message.dart).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/push_message.dart';

void main() {
  test('new-order payloads parse title, body, and routing data', () {
    final m = PartnerPushMessage.fromMap({
      'title': '새 주문이 들어왔습니다',
      'body': 'O-9 2개 상품 결제가 완료되었습니다.',
      'data': {'type': 'SELLER_NEW_ORDER', 'order_no': 'O-9'},
    });
    expect(m.title, '새 주문이 들어왔습니다');
    expect(m.type, 'SELLER_NEW_ORDER');
    expect(m.orderNo, 'O-9');
  });

  test('missing copy falls back instead of going null', () {
    final m = PartnerPushMessage.fromMap({'data': {}});
    expect(m.title, '올모아 파트너 알림');
    expect(m.body, '새로운 알림이 도착했습니다.');
    expect(m.orderNo, '');
  });

  test('new-order taps route to the filtered shipment list', () {
    final r = PartnerPushRoute.fromData(
        {'type': 'SELLER_NEW_ORDER', 'order_no': 'O-9'});
    expect(r.kind, 'shipment');
    expect(r.orderNo, 'O-9');
  });

  test('unknown and empty payloads fall back to dispatch', () {
    expect(PartnerPushRoute.fromData({'type': 'BROADCAST'}).kind, 'dispatch');
    expect(PartnerPushRoute.fromData({'type': 'SELLER_NEW_ORDER'}).kind, 'dispatch');
    expect(PartnerPushRoute.fromData({}).kind, 'dispatch');
    expect(PartnerPushRoute.dispatch.kind, 'dispatch');
  });
}
