// mobile/partner_app/lib/models/sub_order.dart
// Partner Sub-order and Shipping Model for Mobile

class SubOrder {
  final String id;
  final String subOrderNo;
  final String productTitle;
  final int quantity;
  final int totalAmount;
  String status;
  String carrierCode;
  String trackingNumber;

  SubOrder({
    required this.id,
    required this.subOrderNo,
    required this.productTitle,
    required this.quantity,
    required this.totalAmount,
    required this.status,
    this.carrierCode = '',
    this.trackingNumber = '',
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  /// Real rows nest lines in `items` (order_items.product_title). The title
  /// and quantity are derived from those lines, never invented.
  /// P1-M07: seller-facing status. Only pre-shipment rows take dispatch;
  /// everything else names its terminal state instead of 결제확인(미출고).
  static const shippableStatuses = {'PAYMENT_CONFIRMED', 'PREPARING'};

  static const statusLabels = {
    'PAYMENT_CONFIRMED': '결제확인(미출고)',
    'PREPARING': '출고 준비중',
    'SHIPPED': '배송중',
    'IN_TRANSIT': '배송중',
    'DELIVERED': '배송완료',
    'PURCHASE_CONFIRMED': '구매확정',
    'CANCELLED': '취소됨',
    'EXPIRED': '만료됨',
    'RETURN_REQUESTED': '반품 요청중',
    'RETURNED': '반품됨',
    'REFUNDED': '환불됨',
  };

  String get statusLabel => statusLabels[status] ?? status;
  bool get shippable => shippableStatuses.contains(status);
  bool get inTransit => status == 'SHIPPED' || status == 'IN_TRANSIT';

  /// T-N07 filter buckets mirroring the web seller console.
  static const filterBuckets = {
    'ALL': '전체',
    'PENDING': '출고대기',
    'TRANSIT': '배송중',
    'DONE': '배송완료',
    'OTHER': '취소·반품',
  };

  String get filterBucket {
    if (shippableStatuses.contains(status)) return 'PENDING';
    if (status == 'SHIPPED' || status == 'IN_TRANSIT') return 'TRANSIT';
    if (status == 'DELIVERED' || status == 'PURCHASE_CONFIRMED') return 'DONE';
    return 'OTHER';
  }

  factory SubOrder.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    final items = rawItems is List ? rawItems : const [];
    var title = (json['product_title'] ?? '').toString();
    if (title.isEmpty && items.isNotEmpty) {
      final first = items.first;
      title = (first is Map ? first['product_title'] : null)?.toString() ?? '';
      if (title.isNotEmpty && items.length > 1) title = '$title 외 ${items.length - 1}건';
    }
    var qty = _asInt(json['quantity']);
    if (qty == 0 && items.isNotEmpty) {
      qty = items.fold<int>(0, (sum, e) => sum + (e is Map ? _asInt(e['quantity']) : 0));
    }
    return SubOrder(
      id: (json['id'] ?? '').toString(),
      subOrderNo: (json['sub_order_no'] ?? '').toString(),
      productTitle: title,
      quantity: qty,
      totalAmount: _asInt(json['total_amount']),
      status: (json['status'] ?? 'PAYMENT_CONFIRMED').toString(),
      carrierCode: (json['carrier_code'] ?? '').toString(),
      trackingNumber: (json['tracking_number'] ?? '').toString(),
    );
  }
}

