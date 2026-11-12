// mobile/partner_app/lib/models/bidding.dart
// M2C reverse-bidding rows (GET /api/v1/bidding/campaigns, /my-bids) and MD
// price negotiations (GET /api/v1/pricing/negotiations), plus the bid/response
// rule mirror of routes/bidding-m2c.js. Labels mirror BiddingView.vue.

class BiddingCampaign {
  final String id;
  final String title;
  final String categoryName;
  final String referenceTitle;
  final int ceilingSupplyPrice;
  final int minMoq;
  final String status;
  final String endsAt;
  final int bidCount;
  final int? lowestBidPrice;

  const BiddingCampaign({
    required this.id,
    required this.title,
    required this.categoryName,
    required this.referenceTitle,
    required this.ceilingSupplyPrice,
    required this.minMoq,
    required this.status,
    required this.endsAt,
    required this.bidCount,
    required this.lowestBidPrice,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory BiddingCampaign.fromJson(Map<String, dynamic> json) {
    final lowest = json['lowest_bid_price'];
    return BiddingCampaign(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      categoryName: (json['category_name'] ?? '').toString(),
      referenceTitle: (json['reference_title'] ?? '').toString(),
      ceilingSupplyPrice: _asInt(json['ceiling_supply_price']),
      minMoq: _asInt(json['min_moq']),
      status: (json['status'] ?? '').toString(),
      endsAt: (json['ends_at'] ?? '').toString(),
      bidCount: _asInt(json['bid_count']),
      lowestBidPrice: lowest == null ? null : _asInt(lowest),
    );
  }

  static const statusLabels = {
    'OPEN': '입찰 진행중',
    'EVALUATING': '심사중',
    'AWARDED': '낙찰 완료',
    'CANCELLED': '취소됨',
    'CLOSED': '마감됨',
  };

  String get statusLabel => statusLabels[status] ?? status;
  bool get open => status == 'OPEN';
}

class SupplierBid {
  final String id;
  final String campaignId;
  final String campaignTitle;
  final String campaignStatus;
  final int bidSupplyPrice;
  final int moq;
  final int productionLeadDays;
  final String status;
  final String bidNotes;
  final String createdAt;

  const SupplierBid({
    required this.id,
    required this.campaignId,
    required this.campaignTitle,
    required this.campaignStatus,
    required this.bidSupplyPrice,
    required this.moq,
    required this.productionLeadDays,
    required this.status,
    required this.bidNotes,
    required this.createdAt,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory SupplierBid.fromJson(Map<String, dynamic> json) {
    return SupplierBid(
      id: (json['id'] ?? '').toString(),
      campaignId: (json['campaign_id'] ?? '').toString(),
      campaignTitle: (json['campaign_title'] ?? '').toString(),
      campaignStatus: (json['campaign_status'] ?? '').toString(),
      bidSupplyPrice: _asInt(json['bid_supply_price']),
      moq: _asInt(json['moq']),
      productionLeadDays: _asInt(json['production_lead_days']),
      status: (json['status'] ?? '').toString(),
      bidNotes: (json['bid_notes'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }

  static const statusLabels = {
    'SUBMITTED': '제출됨',
    'SHORTLISTED': '후보 선정',
    'WON': '★ 낙찰 확정',
    'LOST': '미선정',
    'RETRACTED': '철회됨',
  };

  String get statusLabel => statusLabels[status] ?? status;
}

class PriceNegotiation {
  final String id;
  final String productId;
  final String productTitle;
  final int currentSalePrice;
  final int suggestedTargetPrice;
  final double discountRateSuggested;
  final String externalMarketBenchmark;
  final String mdProposalNotes;
  final String status;
  final String partnerResponseNotes;
  final String createdAt;

  const PriceNegotiation({
    required this.id,
    required this.productId,
    required this.productTitle,
    required this.currentSalePrice,
    required this.suggestedTargetPrice,
    required this.discountRateSuggested,
    required this.externalMarketBenchmark,
    required this.mdProposalNotes,
    required this.status,
    required this.partnerResponseNotes,
    required this.createdAt,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory PriceNegotiation.fromJson(Map<String, dynamic> json) {
    final rate = json['discount_rate_suggested'];
    return PriceNegotiation(
      id: (json['id'] ?? '').toString(),
      productId: (json['product_id'] ?? '').toString(),
      productTitle: (json['product_title'] ?? '').toString(),
      currentSalePrice: _asInt(json['current_sale_price']),
      suggestedTargetPrice: _asInt(json['suggested_target_price']),
      discountRateSuggested:
          rate is num ? rate.toDouble() : double.tryParse(rate?.toString() ?? '') ?? 0,
      externalMarketBenchmark:
          (json['external_market_benchmark'] ?? '').toString(),
      mdProposalNotes: (json['md_proposal_notes'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      partnerResponseNotes: (json['partner_response_notes'] ?? '').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }

  static const statusLabels = {
    'PROPOSED': 'MD 제안',
    'ACCEPTED': '수락됨',
    'REJECTED': '거절됨',
    'SUPERSEDED': '대체됨',
  };

  String get statusLabel => statusLabels[status] ?? status;
  bool get awaitingResponse => status == 'PROPOSED';
}

/// Server rule mirror (POST /api/v1/bidding/campaigns/:id/bids).
String? validateSupplierBid({
  required String priceRaw,
  required int ceiling,
  required String moqRaw,
  required String leadDaysRaw,
}) {
  final price = int.tryParse(priceRaw.replaceAll(RegExp(r'[,\s]'), ''));
  if (price == null) return '입찰 공급가를 숫자로 입력해 주세요.';
  if (price < 100) return '입찰 공급가는 100원 이상이어야 합니다.';
  if (price > ceiling) return '상한 공급가($ceiling원) 이하로만 입찰 가능합니다.';
  final moq = int.tryParse(moqRaw.replaceAll(RegExp(r'[,\s]'), ''));
  if (moq == null || moq < 1) return 'MOQ는 1 이상으로 입력해 주세요.';
  final lead = int.tryParse(leadDaysRaw.trim());
  if (lead == null || lead < 1 || lead > 90) {
    return '생산 리드타임은 1~90일로 입력해 주세요.';
  }
  return null;
}

/// The server contract is accept/reject; a counter travels as a rejection
/// carrying the counter price in the notes (BiddingView.vue mirror).
String counterResponseNotes({required int counterPrice, required String notes}) {
  return '[역제안 희망가 $counterPrice원] ${notes.trim()}'.trim();
}
