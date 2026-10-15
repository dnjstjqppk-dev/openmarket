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

  factory SubOrder.fromJson(Map<String, dynamic> json) {
    return SubOrder(
      id: json['id'] ?? '',
      subOrderNo: json['sub_order_no'] ?? '',
      productTitle: json['product_title'] ?? '',
      quantity: json['quantity'] ?? 1,
      totalAmount: json['total_amount'] ?? 0,
      status: json['status'] ?? 'PAYMENT_CONFIRMED',
      carrierCode: json['carrier_code'] ?? '',
      trackingNumber: json['tracking_number'] ?? '',
    );
  }
}

