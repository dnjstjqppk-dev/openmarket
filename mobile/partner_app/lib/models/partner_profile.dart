// mobile/partner_app/lib/models/partner_profile.dart
// Seller profile (GET /api/v1/partner/profile) plus the edit rule mirror of
// routes/partner.js. Identity fields (business name, representative, mail
// order number) are locked server-side; only the contact/fee/cycle/bank
// fields travel on PUT.

class PartnerProfile {
  final String id;
  final String businessName;
  final String businessRegNumber;
  final String status;
  final String salesModel;
  final double commissionRate;
  final String bankCode;
  final String? bankAccountMasked;
  final String bankAccountHolder;
  final bool payoutAccountVerified;
  final bool payoutChangePending;
  final String settlementCycle;
  final String returnShippingAddress;
  final String customerServicePhone;
  final int baseShippingFee;
  final int freeShippingThreshold;
  final String representativeName;
  final String mailOrderRegNumber;
  final String businessAddress;
  final String csEmail;
  final int? returnShippingFee;

  const PartnerProfile({
    required this.id,
    required this.businessName,
    required this.businessRegNumber,
    required this.status,
    required this.salesModel,
    required this.commissionRate,
    required this.bankCode,
    required this.bankAccountMasked,
    required this.bankAccountHolder,
    required this.payoutAccountVerified,
    required this.payoutChangePending,
    required this.settlementCycle,
    required this.returnShippingAddress,
    required this.customerServicePhone,
    required this.baseShippingFee,
    required this.freeShippingThreshold,
    required this.representativeName,
    required this.mailOrderRegNumber,
    required this.businessAddress,
    required this.csEmail,
    required this.returnShippingFee,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory PartnerProfile.fromJson(Map<String, dynamic> json) {
    final retFee = json['return_shipping_fee'];
    return PartnerProfile(
      id: (json['id'] ?? '').toString(),
      businessName: (json['business_name'] ?? '').toString(),
      businessRegNumber: (json['business_reg_number'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      salesModel: (json['sales_model'] ?? '').toString(),
      commissionRate: (json['commission_rate'] is num)
          ? (json['commission_rate'] as num).toDouble()
          : double.tryParse(json['commission_rate']?.toString() ?? '') ?? 0,
      bankCode: (json['bank_code'] ?? '').toString(),
      bankAccountMasked: json['bank_account_number']?.toString(),
      bankAccountHolder: (json['bank_account_holder'] ?? '').toString(),
      payoutAccountVerified: json['payout_account_verified'] == true ||
          json['payout_account_verified'] == 1,
      payoutChangePending: json['payout_change_pending'] == true,
      settlementCycle: (json['settlement_cycle'] ?? '').toString(),
      returnShippingAddress: (json['return_shipping_address'] ?? '').toString(),
      customerServicePhone: (json['customer_service_phone'] ?? '').toString(),
      baseShippingFee: _asInt(json['base_shipping_fee']),
      freeShippingThreshold: _asInt(json['free_shipping_threshold']),
      representativeName: (json['representative_name'] ?? '').toString(),
      mailOrderRegNumber: (json['mail_order_reg_number'] ?? '').toString(),
      businessAddress: (json['business_address'] ?? '').toString(),
      csEmail: (json['cs_email'] ?? '').toString(),
      returnShippingFee: retFee == null ? null : _asInt(retFee),
    );
  }

  static const cycleLabels = {
    'WEEKLY': '매주 정산',
    'BIWEEKLY': '격주 정산',
    'MONTHLY': '월 정산',
  };

  static const salesModelLabels = {
    'MARKETPLACE': '마켓플레이스(중개)',
    'DIRECT': '직판',
  };

  String get cycleLabel => cycleLabels[settlementCycle] ?? settlementCycle;
  String get salesModelLabel => salesModelLabels[salesModel] ?? salesModel;
}

/// Server bound mirror (PUT /api/v1/partner/profile intParams).
String? validateProfileFees({
  required String baseFeeRaw,
  required String freeThresholdRaw,
  required String returnFeeRaw,
  required String csEmail,
}) {
  int? fee(String raw, String label, int max) {
    if (raw.trim().isEmpty) return null;
    final v = int.tryParse(raw.replaceAll(RegExp(r'[,\s]'), ''));
    if (v == null || v < 0 || v > max) return -1;
    return v;
  }

  if (fee(baseFeeRaw, '기본 배송비', 100000) == -1) {
    return '기본 배송비는 0~100,000원으로 입력해 주세요.';
  }
  if (fee(freeThresholdRaw, '무료배송 기준', 10000000) == -1) {
    return '무료배송 기준은 0~10,000,000원으로 입력해 주세요.';
  }
  if (returnFeeRaw.trim().isNotEmpty &&
      fee(returnFeeRaw, '반품 배송비', 100000) == -1) {
    return '반품 배송비(편도)는 0~100,000원으로 입력해 주세요.';
  }
  if (csEmail.trim().isNotEmpty &&
      !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(csEmail.trim())) {
    return '고객센터 이메일 형식이 올바르지 않습니다.';
  }
  return null;
}
