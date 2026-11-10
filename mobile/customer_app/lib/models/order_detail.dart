// mobile/customer_app/lib/models/order_detail.dart
// Pure parsers for GET /api/v1/orders/:id plus the action rules shared with
// the storefront OrderDetailView (cancel/confirm/claim availability).

class OrderItem {
  final String id;
  final int quantity;
  final String title;
  final String skuId;

  const OrderItem({required this.id, required this.quantity, required this.title, required this.skuId});

  factory OrderItem.fromJson(Map<String, dynamic> j) => OrderItem(
        id: (j['id'] ?? '').toString(),
        quantity: (j['quantity'] is num) ? (j['quantity'] as num).toInt() : 0,
        title: (j['product_title'] ?? j['title'] ?? '').toString(),
        skuId: (j['sku_id'] ?? '').toString(),
      );
}

class OrderSub {
  final String id;
  final String subOrderNo;
  final String businessName;
  final String status;
  final int goodsAmount;
  final int shippingFee;
  final int totalAmount;
  final String? carrierCode;
  final String? trackingNumber;
  final List<OrderItem> items;

  const OrderSub({
    required this.id,
    required this.subOrderNo,
    required this.businessName,
    required this.status,
    required this.goodsAmount,
    required this.shippingFee,
    required this.totalAmount,
    this.carrierCode,
    this.trackingNumber,
    required this.items,
  });

  factory OrderSub.fromJson(Map<String, dynamic> j) {
    int asInt(dynamic v) => (v is num) ? v.toInt() : 0;
    final items = (j['items'] is List) ? (j['items'] as List) : const [];
    return OrderSub(
      id: (j['id'] ?? '').toString(),
      subOrderNo: (j['sub_order_no'] ?? '').toString(),
      businessName: (j['business_name'] ?? '').toString(),
      status: (j['status'] ?? '').toString(),
      goodsAmount: asInt(j['goods_amount']),
      shippingFee: asInt(j['shipping_fee']),
      totalAmount: asInt(j['total_amount']),
      carrierCode: j['carrier_code']?.toString(),
      trackingNumber: j['tracking_number']?.toString(),
      items: [for (final i in items) if (i is Map) OrderItem.fromJson(Map<String, dynamic>.from(i))],
    );
  }
}

class OrderDetail {
  final String id;
  final String orderNo;
  final String paymentStatus;
  final int totalPayAmount;
  final String? expiresAt;
  final List<OrderSub> subs;
  final List<Map<String, dynamic>> claims;
  final List<Map<String, dynamic>> refunds;

  const OrderDetail({
    required this.id,
    required this.orderNo,
    required this.paymentStatus,
    required this.totalPayAmount,
    this.expiresAt,
    required this.subs,
    required this.claims,
    required this.refunds,
  });
}

List<Map<String, dynamic>> _asMaps(dynamic v) {
  if (v is! List) return const [];
  return [for (final e in v) if (e is Map) Map<String, dynamic>.from(e)];
}

OrderDetail parseOrderDetail(Map<String, dynamic> data) {
  final subs = _asMaps(data['sub_orders']).map(OrderSub.fromJson).toList();
  final pay = data['total_pay_amount'];
  return OrderDetail(
    id: (data['id'] ?? '').toString(),
    orderNo: (data['order_no'] ?? '').toString(),
    paymentStatus: (data['payment_status'] ?? data['status'] ?? '').toString(),
    totalPayAmount: (pay is num) ? pay.toInt() : 0,
    expiresAt: data['payment_expires_at']?.toString(),
    subs: subs,
    claims: _asMaps(data['claims']),
    refunds: _asMaps(data['refunds']),
  );
}

/// Whole-order cancel: READY always; paid only while nothing has shipped.
bool canCancelWhole(OrderDetail d) {
  if (d.paymentStatus == 'READY') return true;
  if (d.paymentStatus != 'PAID' && d.paymentStatus != 'PARTIAL_REFUNDED') return false;
  const preShip = {'PAYMENT_CONFIRMED', 'PREPARING', 'CANCELLED'};
  return d.subs.every((s) => preShip.contains(s.status));
}

/// Subs awaiting purchase confirmation.
List<OrderSub> confirmableSubs(OrderDetail d) =>
    [for (final s in d.subs) if (s.status == 'DELIVERED') s];

/// Delivered subs with no open claim accept a return/exchange request.
List<OrderSub> claimableSubs(OrderDetail d) {
  final open = <String>{};
  for (final c in d.claims) {
    final st = (c['status'] ?? '').toString();
    if (st == 'REQUESTED' || st == 'APPROVED') open.add((c['sub_order_id'] ?? '').toString());
  }
  return [for (final s in d.subs) if (s.status == 'DELIVERED' && !open.contains(s.id)) s];
}

String orderStatusLabel(String status) => switch (status) {
      'READY' => '결제대기',
      'PAID' => '결제완료',
      'PARTIAL_REFUNDED' => '부분환불',
      'REFUNDED' => '환불완료',
      'CANCELLED' => '취소됨',
      'PURCHASE_CONFIRMED' => '구매확정',
      _ => status.isEmpty ? '-' : status,
    };

String subStatusLabel(String status) => switch (status) {
      'PAYMENT_CONFIRMED' => '결제확인',
      'PREPARING' => '상품준비중',
      'SHIPPED' => '배송중',
      'IN_TRANSIT' => '배송중',
      'DELIVERED' => '배송완료',
      'PURCHASE_CONFIRMED' => '구매확정',
      'CANCELLED' => '취소됨',
      'RETURN_REQUESTED' => '반품요청',
      'RETURNED' => '반품완료',
      'REFUNDED' => '환불완료',
      _ => status.isEmpty ? '-' : status,
    };
