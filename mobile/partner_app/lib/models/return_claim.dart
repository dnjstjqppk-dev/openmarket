// mobile/partner_app/lib/models/return_claim.dart
// Seller claim rows (GET /api/v1/partner/returns) plus the decision/reship
// validation mirror of routes/partner.js. Labels mirror the web seller
// console (ReturnsManageView STATUS_LABEL/REASON_LABEL).

class ReturnClaim {
  final String id;
  final String orderId;
  final String subOrderId;
  final String orderNo;
  final String subOrderNo;
  final String claimType;
  final String reason;
  final String? reasonCode;
  final String status;
  final int refundAmount;
  final String notes;
  final String createdAt;
  final String customerEmail;
  final String customerName;
  final String? fault;
  final int returnFeeAmount;
  final String? exchangeStatus;
  final String? exchangeTrackingNumber;
  final int goodsAmount;
  final int shippingFee;
  final int totalAmount;

  const ReturnClaim({
    required this.id,
    required this.orderId,
    required this.subOrderId,
    required this.orderNo,
    required this.subOrderNo,
    required this.claimType,
    required this.reason,
    required this.reasonCode,
    required this.status,
    required this.refundAmount,
    required this.notes,
    required this.createdAt,
    required this.customerEmail,
    required this.customerName,
    required this.fault,
    required this.returnFeeAmount,
    required this.exchangeStatus,
    required this.exchangeTrackingNumber,
    required this.goodsAmount,
    required this.shippingFee,
    required this.totalAmount,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory ReturnClaim.fromJson(Map<String, dynamic> json) {
    return ReturnClaim(
      id: (json['id'] ?? '').toString(),
      orderId: (json['order_id'] ?? '').toString(),
      subOrderId: (json['sub_order_id'] ?? '').toString(),
      orderNo: (json['order_no'] ?? '').toString(),
      subOrderNo: (json['sub_order_no'] ?? '').toString(),
      claimType: (json['claim_type'] ?? '').toString(),
      reason: (json['reason'] ?? '').toString(),
      reasonCode: json['reason_code']?.toString(),
      status: (json['status'] ?? '').toString(),
      refundAmount: _asInt(json['refund_amount']),
      notes: (json['notes'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
      customerEmail: (json['customer_email'] ?? '').toString(),
      customerName: (json['customer_name'] ?? '').toString(),
      fault: json['fault']?.toString(),
      returnFeeAmount: _asInt(json['return_fee_amount']),
      exchangeStatus: json['exchange_status']?.toString(),
      exchangeTrackingNumber: json['exchange_tracking_number']?.toString(),
      goodsAmount: _asInt(json['goods_amount']),
      shippingFee: _asInt(json['shipping_fee']),
      totalAmount: _asInt(json['total_amount']),
    );
  }

  static const statusLabels = {
    'REQUESTED': '검토 요청',
    'APPROVED': '승인됨',
    'REJECTED': '반려됨',
    'REFUNDED': '환불 완료',
  };

  static const typeLabels = {
    'RETURN': '반품',
    'EXCHANGE': '교환',
    // 5-5: scheme retired; stored rows stay readable as a terminated scheme.
    'PRICE_ADJUSTMENT': '가격 보상(종료된 제도)',
  };

  static const reasonLabels = {
    'CHANGE_OF_MIND': '단순 변심',
    'SIZE_COLOR': '사이즈·색상',
    'DEFECTIVE': '불량·고장',
    'DAMAGED': '배송 중 파손',
    'WRONG_ITEM': '오배송',
    'NOT_AS_DESCRIBED': '상품 설명과 다름',
    'OTHER': '기타',
  };

  String get statusLabel => statusLabels[status] ?? status;
  String get typeLabel => typeLabels[claimType] ?? claimType;

  String get reasonLabel {
    final code = reasonCode;
    if (code != null && reasonLabels.containsKey(code)) return reasonLabels[code]!;
    return reason.isNotEmpty ? reason : '사유 미기재';
  }

  bool get awaitingReship =>
      claimType == 'EXCHANGE' && status == 'APPROVED' && exchangeStatus == 'AWAITING_RESHIPMENT';

  String get customerLabel {
    if (customerName.isNotEmpty && customerEmail.isNotEmpty) return '$customerName ($customerEmail)';
    if (customerName.isNotEmpty) return customerName;
    if (customerEmail.isNotEmpty) return customerEmail;
    return '고객 정보 없음';
  }
}

/// Server rule mirror (PUT /api/v1/partner/returns/:id): a rejection needs a
/// written reason, and newly blaming the customer needs one too (disputable).
/// null = valid, otherwise the message to show.
String? validateClaimDecision({
  required bool approve,
  required String notes,
  required String? fault,
  required String? existingFault,
}) {
  if (!approve && notes.trim().isEmpty) return '거절 사유를 입력해 주세요.';
  if (fault == 'CUSTOMER' && existingFault != 'CUSTOMER' && notes.trim().isEmpty) {
    return '고객 귀책으로 판단한 근거를 적어 주세요. 고객이 이의를 제기할 수 있습니다.';
  }
  if (notes.length > 500) return '메모는 500자 이내로 입력해 주세요.';
  return null;
}

Map<String, dynamic> claimDecisionPayload({
  required bool approve,
  required String notes,
  String? fault,
  bool returnless = false,
}) {
  return {
    'decision': approve ? 'APPROVE' : 'REJECT',
    'notes': notes.trim(),
    if (fault != null && fault.isNotEmpty) 'fault': fault,
    if (returnless) 'returnless': true,
  };
}

/// Server rule mirror (POST .../reship INVALID_TRACKING + shipment dialog).
String? validateReshipTracking(String raw) {
  if (!RegExp(r'^[A-Za-z0-9-]{6,40}$').hasMatch(raw.trim())) {
    return '송장번호 형식이 올바르지 않습니다. (영문·숫자·하이픈 6~40자)';
  }
  return null;
}
