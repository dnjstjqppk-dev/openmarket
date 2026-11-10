// Unit tests for order-detail parsers and action rules (pure, no I/O).
// Rules mirror the storefront OrderDetailView and the orders.js contract.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/order_detail.dart';

Map<String, dynamic> _order(String pay, List<Map<String, dynamic>> subs) => {
      'id': 'o1',
      'order_no': 'ORD-1',
      'payment_status': pay,
      'total_pay_amount': 10000,
      'sub_orders': subs,
      'claims': [],
      'refunds': [],
    };

Map<String, dynamic> _sub(String id, String status) => {
      'id': id,
      'sub_order_no': 'SUB-$id',
      'business_name': '셀러',
      'status': status,
      'goods_amount': 8000,
      'shipping_fee': 2000,
      'total_amount': 10000,
      'carrier_code': null,
      'tracking_number': null,
      'items': [
        {'id': 'i-$id', 'quantity': 1, 'product_title': '상품', 'sku_id': 'sku-1'}
      ],
    };

void main() {
  test('parseOrderDetail keeps order, subs, claims and refunds', () {
    final d = parseOrderDetail(_order('PAID', [_sub('s1', 'DELIVERED')]));
    expect(d.orderNo, 'ORD-1');
    expect(d.subs.length, 1);
    expect(d.subs.first.items.length, 1);
  });

  test('READY orders are wholly cancellable', () {
    final d = parseOrderDetail(_order('READY', [_sub('s1', 'PAYMENT_CONFIRMED')]));
    expect(canCancelWhole(d), isTrue);
  });

  test('paid orders are wholly cancellable before any shipment', () {
    final d = parseOrderDetail(
        _order('PAID', [_sub('s1', 'PREPARING'), _sub('s2', 'CANCELLED')]));
    expect(canCancelWhole(d), isTrue);
  });

  test('partially shipped orders are not wholly cancellable', () {
    final d = parseOrderDetail(
        _order('PAID', [_sub('s1', 'PREPARING'), _sub('s2', 'SHIPPED')]));
    expect(canCancelWhole(d), isFalse);
  });

  test('delivered subs are confirmable', () {
    final d = parseOrderDetail(
        _order('PAID', [_sub('s1', 'DELIVERED'), _sub('s2', 'SHIPPED')]));
    expect(confirmableSubs(d).map((s) => s.id), ['s1']);
  });

  test('delivered subs without open claims accept return claims', () {
    final d = parseOrderDetail({
      ..._order('PAID', [_sub('s1', 'DELIVERED'), _sub('s2', 'DELIVERED')]),
      'claims': [
        {'id': 'c1', 'sub_order_id': 's1', 'status': 'REQUESTED'}
      ],
    });
    expect(claimableSubs(d).map((s) => s.id), ['s2']);
  });

  test('status labels stay Korean', () {
    expect(orderStatusLabel('PAID'), '결제완료');
    expect(orderStatusLabel('READY'), '결제대기');
    expect(subStatusLabel('DELIVERED'), '배송완료');
    expect(subStatusLabel('SHIPPED'), '배송중');
  });
}
