// mobile/partner_app/lib/models/channel_listing.dart
// Multichannel rows (GET /api/v1/channels/listings, /sales-channels,
// /platforms, /credentials) plus the publish/credential rule mirror of
// routes/multichannel.js and MultiChannelListingView.vue.

class ChannelListing {
  final String id;
  final String salesChannelId;
  final String channelName;
  final String productId;
  final String productTitle;
  final String thumbnailUrl;
  final int channelSalePrice;
  final int channelOriginalPrice;
  final String currency;
  final int stockAllocated;
  final String status;
  final String? externalProductId;
  final String? externalUrl;
  final String lastSyncedAt;

  const ChannelListing({
    required this.id,
    required this.salesChannelId,
    required this.channelName,
    required this.productId,
    required this.productTitle,
    required this.thumbnailUrl,
    required this.channelSalePrice,
    required this.channelOriginalPrice,
    required this.currency,
    required this.stockAllocated,
    required this.status,
    required this.externalProductId,
    required this.externalUrl,
    required this.lastSyncedAt,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory ChannelListing.fromJson(Map<String, dynamic> json) {
    return ChannelListing(
      id: (json['id'] ?? '').toString(),
      salesChannelId: (json['sales_channel_id'] ?? '').toString(),
      channelName: (json['channel_name'] ?? '').toString(),
      productId: (json['product_id'] ?? '').toString(),
      productTitle: (json['product_title'] ?? '').toString(),
      thumbnailUrl: (json['thumbnail_url'] ?? '').toString(),
      channelSalePrice: _asInt(json['channel_sale_price']),
      channelOriginalPrice: _asInt(json['channel_original_price']),
      currency: (json['currency'] ?? 'KRW').toString(),
      stockAllocated: _asInt(json['stock_allocated']),
      status: (json['status'] ?? '').toString(),
      externalProductId: json['external_product_id']?.toString(),
      externalUrl: json['external_url']?.toString(),
      lastSyncedAt: (json['last_synced_at'] ?? '').toString(),
    );
  }

  static const statusLabels = {
    'DRAFT': '임시 저장',
    'PENDING_REVIEW': '채널 심사중',
    'ACTIVE': '판매중',
    'LIVE': '판매중',
    'SYNC_FAILED': '동기화 실패',
    'SUSPENDED': '중지됨',
  };

  String get statusLabel => statusLabels[status] ?? status;
}

class SalesChannel {
  final String id;
  final String channelName;
  final String platformId;
  final String platformName;
  final int commissionBps;
  final String currency;

  const SalesChannel({
    required this.id,
    required this.channelName,
    required this.platformId,
    required this.platformName,
    required this.commissionBps,
    required this.currency,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory SalesChannel.fromJson(Map<String, dynamic> json) {
    return SalesChannel(
      id: (json['id'] ?? '').toString(),
      channelName: (json['channel_name'] ?? '').toString(),
      platformId: (json['platform_id'] ?? '').toString(),
      platformName: (json['platform_name'] ?? '').toString(),
      commissionBps: _asInt(json['commission_bps']),
      currency: (json['currency'] ?? 'KRW').toString(),
    );
  }

  String get commissionLabel =>
      '${(commissionBps / 100).toStringAsFixed(commissionBps % 100 == 0 ? 0 : 1)}%';
}

class CommercePlatform {
  final String id;
  final String name;
  final bool apiIntegrated;

  const CommercePlatform(
      {required this.id, required this.name, required this.apiIntegrated});

  factory CommercePlatform.fromJson(Map<String, dynamic> json) {
    return CommercePlatform(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      apiIntegrated: json['api_integrated'] == true,
    );
  }
}

class ChannelCredential {
  final String id;
  final String platformId;
  final String platformName;
  final String credentialName;
  final String apiKeyMasked;
  final String sellerAccountId;
  final bool isSandbox;
  final String status;
  final String lastVerifiedAt;

  const ChannelCredential({
    required this.id,
    required this.platformId,
    required this.platformName,
    required this.credentialName,
    required this.apiKeyMasked,
    required this.sellerAccountId,
    required this.isSandbox,
    required this.status,
    required this.lastVerifiedAt,
  });

  factory ChannelCredential.fromJson(Map<String, dynamic> json) {
    return ChannelCredential(
      id: (json['id'] ?? '').toString(),
      platformId: (json['platform_id'] ?? '').toString(),
      platformName: (json['platform_name'] ?? '').toString(),
      credentialName: (json['credential_name'] ?? '').toString(),
      apiKeyMasked: (json['api_key_masked'] ?? '').toString(),
      sellerAccountId: (json['seller_account_id'] ?? '').toString(),
      isSandbox: json['is_sandbox'] == 1 || json['is_sandbox'] == true,
      status: (json['status'] ?? '').toString(),
      lastVerifiedAt: (json['last_verified_at'] ?? '').toString(),
    );
  }

  static const statusLabels = {
    'CONFIGURED': '등록됨(미검증)',
    'VERIFIED': '검증됨',
    'BLOCKED_INVALID': '검증 실패',
  };

  String get statusLabel => statusLabels[status] ?? status;
}

/// Web deploy-modal mirror: brand, delivery company, and the channel
/// category are required; the channel price defaults to the OLMOA price.
String? validateChannelPublish({
  required String? productId,
  required String? salesChannelId,
  required String brand,
  required String deliveryCompany,
  required String externalCategoryId,
  required String salePriceRaw,
}) {
  if (productId == null || productId.isEmpty) return '배포할 상품을 선택해 주세요.';
  if (salesChannelId == null || salesChannelId.isEmpty) {
    return '배포할 판매채널을 선택해 주세요.';
  }
  if (brand.trim().isEmpty ||
      deliveryCompany.trim().isEmpty ||
      externalCategoryId.trim().isEmpty) {
    return '브랜드, 배송 택배사, 채널 카테고리는 필수 입력입니다.';
  }
  if (salePriceRaw.trim().isNotEmpty) {
    final v = int.tryParse(salePriceRaw.replaceAll(RegExp(r'[,\s]'), ''));
    if (v == null || v <= 0) return '채널 판매가는 1 이상의 숫자로 입력해 주세요.';
  }
  return null;
}

/// Server rule mirror (POST /api/v1/channels/credentials).
String? validateChannelCredential({
  required String? platformId,
  required String apiKey,
}) {
  if (platformId == null || platformId.isEmpty) return '플랫폼을 선택해 주세요.';
  if (apiKey.trim().isEmpty) return 'API 키를 입력해 주세요.';
  if (apiKey.trim().length > 500) return 'API 키는 500자 이내로 입력해 주세요.';
  return null;
}
