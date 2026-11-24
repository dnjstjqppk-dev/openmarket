// Inbound push payload parsing (models/push_message.dart).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/push_message.dart';

void main() {
  test('full payloads parse title, body, and routing data', () {
    final m = OlmoaPushMessage.fromMap({
      'title': '주문이 출고되었습니다',
      'body': 'O-123 운송장이 등록되었습니다.',
      'data': {'type': 'ORDER_SHIPPED', 'order_no': 'O-123'},
    });
    expect(m.title, '주문이 출고되었습니다');
    expect(m.type, 'ORDER_SHIPPED');
    expect(m.orderNo, 'O-123');
    expect(m.isOrderEvent, isTrue);
  });

  test('missing copy falls back instead of going null', () {
    final m = OlmoaPushMessage.fromMap({'data': {'type': 'BROADCAST'}});
    expect(m.title, 'OLMOA 알림');
    expect(m.body, '새로운 알림이 도착했습니다.');
    expect(m.isOrderEvent, isFalse);
  });

  test('blank strings and missing data map are tolerated', () {
    final m = OlmoaPushMessage.fromMap({'title': '  ', 'body': ''});
    expect(m.title, 'OLMOA 알림');
    expect(m.orderNo, '');
    expect(OlmoaPushMessage.fromMap({}).type, '');
  });

  test('claim templates are known but not order events', () {
    expect(OlmoaPushMessage.knownTypes.contains('CLAIM_CREDIT_GRANTED'), isTrue);
    final m = OlmoaPushMessage.fromMap({
      'title': 't',
      'body': 'b',
      'data': {'type': 'CLAIM_REJECTED', 'order_no': 'O-1'},
    });
    expect(m.isOrderEvent, isFalse);
  });

  test('restock payloads keep the product id', () {
    final m = OlmoaPushMessage.fromMap({
      'title': 't',
      'body': 'b',
      'data': {'type': 'RESTOCK_AVAILABLE', 'product_id': 'prod_001'},
    });
    expect(m.productId, 'prod_001');
    expect(OlmoaPushMessage.fromMap({'data': {'type': 'BROADCAST'}}).productId, '');
  });

  test('order events with an order number route to the order detail', () {
    for (final type in [
      'ORDER_SHIPPED',
      'ORDER_DELIVERED',
      'REFUND_COMPLETED',
      'CLAIM_CREDIT_GRANTED',
      'CLAIM_REJECTED'
    ]) {
      final r = OlmoaPushRoute.fromData({'type': type, 'order_no': 'O-9'});
      expect(r.kind, 'order', reason: type);
      expect(r.orderNo, 'O-9');
    }
  });

  test('restock with a product id routes to the product detail', () {
    final r = OlmoaPushRoute.fromData(
        {'type': 'RESTOCK_AVAILABLE', 'product_id': 'prod_001'});
    expect(r.kind, 'product');
    expect(r.productId, 'prod_001');
  });

  test('broadcast, unknown, and empty payloads fall back to the inbox', () {
    expect(OlmoaPushRoute.fromData({'type': 'BROADCAST'}).kind, 'inbox');
    expect(OlmoaPushRoute.fromData({'type': 'NOPE', 'order_no': 'O-1'}).kind, 'inbox');
    expect(OlmoaPushRoute.fromData({'type': 'ORDER_SHIPPED'}).kind, 'inbox');
    expect(OlmoaPushRoute.fromData({'type': 'RESTOCK_AVAILABLE'}).kind, 'inbox');
    expect(OlmoaPushRoute.fromData({}).kind, 'inbox');
    expect(OlmoaPushRoute.inbox.kind, 'inbox');
  });
}
