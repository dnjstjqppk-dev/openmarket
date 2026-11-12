// Seller sub-order status labels, dispatch gating, and filter buckets
// (P1-M07, T-N07).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/sub_order.dart';

SubOrder _sub(String status) => SubOrder(
      id: 's',
      subOrderNo: 'S-1',
      productTitle: 't',
      quantity: 1,
      totalAmount: 100,
      status: status,
    );

void main() {
  test('delivered and terminal rows never read as awaiting shipment', () {
    expect(_sub('DELIVERED').statusLabel, '배송완료');
    expect(_sub('PURCHASE_CONFIRMED').statusLabel, '구매확정');
    expect(_sub('CANCELLED').statusLabel, '취소됨');
    expect(_sub('RETURNED').statusLabel, '반품됨');
    expect(_sub('SHIPPED').statusLabel, '배송중');
    expect(_sub('PREPARING').statusLabel, '출고 준비중');
  });

  test('dispatch is offered only before shipment', () {
    expect(_sub('PAYMENT_CONFIRMED').shippable, isTrue);
    expect(_sub('PREPARING').shippable, isTrue);
    for (final s in ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED']) {
      expect(_sub(s).shippable, isFalse, reason: s);
    }
  });

  test('filter buckets mirror the web console groups', () {
    expect(_sub('PAYMENT_CONFIRMED').filterBucket, 'PENDING');
    expect(_sub('PREPARING').filterBucket, 'PENDING');
    expect(_sub('SHIPPED').filterBucket, 'TRANSIT');
    expect(_sub('IN_TRANSIT').filterBucket, 'TRANSIT');
    expect(_sub('DELIVERED').filterBucket, 'DONE');
    expect(_sub('CANCELLED').filterBucket, 'OTHER');
    expect(_sub('RETURN_REQUESTED').filterBucket, 'OTHER');
  });
}
