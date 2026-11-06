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

