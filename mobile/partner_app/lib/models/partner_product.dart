// mobile/partner_app/lib/models/partner_product.dart
// Seller product rows (GET /api/v1/partner/products) plus the client-side
// validation mirror of routes/partner.js (priceFields, stock bounds, create
// requirements). The server re-validates everything; these checks only fail
// fast with Korean messages before a request is sent.

/// One product/SKU row. The endpoint joins products x product_skus, so a
/// multi-option product arrives as several rows sharing the product [id].
class PartnerProductRow {
  final String id;
  final String? skuId;
  final String title;
  final String categoryName;
  final String thumbnailUrl;
  final String descriptionHtml;
  final String status;
  final String reviewStatus;
  final int salePrice;
  final int originalPrice;
  final int stockQuantity;
  final String skuCode;
  final String optionSummary;
  final String skuStatus;
  final int lowestSalePrice;
  final int lowestOriginalPrice;
  final String custodyType;
  final String brand;

  const PartnerProductRow({
    required this.id,
    required this.skuId,
    required this.title,
    required this.categoryName,
    required this.thumbnailUrl,
    required this.descriptionHtml,
    required this.status,
    required this.reviewStatus,
    required this.salePrice,
    required this.originalPrice,
    required this.stockQuantity,
    required this.skuCode,
    required this.optionSummary,
    required this.skuStatus,
    required this.lowestSalePrice,
    required this.lowestOriginalPrice,
    required this.custodyType,
    required this.brand,
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse((v ?? '').toString().replaceAll(',', '').trim()) ?? 0;
  }

  factory PartnerProductRow.fromJson(Map<String, dynamic> json) {
    return PartnerProductRow(
      id: (json['id'] ?? '').toString(),
      skuId: json['sku_id']?.toString(),
      title: (json['title'] ?? '').toString(),
      categoryName: (json['category_name'] ?? '').toString(),
      thumbnailUrl: (json['thumbnail_url'] ?? '').toString(),
      descriptionHtml: (json['description_html'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      reviewStatus: (json['review_status'] ?? '').toString(),
      salePrice: _asInt(json['sale_price']),
      originalPrice: _asInt(json['sku_original_price'] ?? json['original_price']),
      stockQuantity: _asInt(json['stock_quantity']),
      skuCode: (json['sku_code'] ?? '').toString(),
      optionSummary: (json['option_summary'] ?? '기본').toString(),
      skuStatus: (json['sku_status'] ?? '').toString(),
      lowestSalePrice: _asInt(json['lowest_sale_price']),
      lowestOriginalPrice: _asInt(json['lowest_original_price']),
      custodyType: (json['custody_type'] ?? '').toString(),
      brand: (json['brand'] ?? '').toString(),
    );
  }

  /// Never a raw code: review state decides the label a seller acts on.
  String get displayStatus {
    switch (reviewStatus) {
      case 'PENDING':
        return status == 'ACTIVE' ? '재심사 대기' : '심사 대기';
      case 'REJECTED':
        return '반려됨';
      case 'APPROVED':
        return status == 'ACTIVE' ? '판매중' : '판매중지';
      default:
        return reviewStatus.isNotEmpty ? reviewStatus : status;
    }
  }
}

/// Server bounds (routes/partner.js priceFields + stock intParam).
const productSaleMin = 100;
const productSaleMax = 100000000;
const productStockMax = 1000000;

/// Digits with optional commas/whitespace. Null when unparseable.
int? parseProductInt(String raw) {
  final digits = raw.replaceAll(RegExp(r'[,\s]'), '');
  if (!RegExp(r'^\d+$').hasMatch(digits)) return null;
  return int.tryParse(digits);
}

/// null = valid, otherwise the Korean message to show. Mirrors priceFields.
String? validateSalePrice(String raw) {
  final v = parseProductInt(raw);
  if (v == null) return '판매가를 숫자로 입력해 주세요.';
  if (v < productSaleMin || v > productSaleMax) {
    return '판매가는 100원 이상 1억원 이하로 입력해 주세요.';
  }
  return null;
}

/// original_price must be >= sale (server: min = sale).
String? validateOriginalPrice(String raw, int sale) {
  final v = parseProductInt(raw);
  if (v == null) return '정상가를 숫자로 입력해 주세요.';
  if (v < sale) return '정상가는 판매가보다 낮을 수 없습니다.';
  if (v > productSaleMax) return '정상가는 1억원 이하로 입력해 주세요.';
  return null;
}

String? validateStock(String raw) {
  final v = parseProductInt(raw);
  if (v == null) return '재고를 숫자로 입력해 주세요.';
  if (v > productStockMax) return '재고는 100만 개 이하로 입력해 주세요.';
  return null;
}

/// Mirrors POST /api/v1/partner/products required fields.
String? validateCreateProduct({
  required String title,
  required String? categoryId,
  required String saleRaw,
  required String originalRaw,
  required String stockRaw,
  required String thumbnailUrl,
}) {
  if (title.trim().isEmpty) return '상품명을 입력해 주세요.';
  if (title.trim().length > 200) return '상품명은 200자 이내로 입력해 주세요.';
  if (categoryId == null || categoryId.isEmpty) return '카테고리를 선택해 주세요.';
  final saleErr = validateSalePrice(saleRaw);
  if (saleErr != null) return saleErr;
  final sale = parseProductInt(saleRaw)!;
  final origErr = validateOriginalPrice(originalRaw.isEmpty ? saleRaw : originalRaw, sale);
  if (origErr != null) return origErr;
  final stockErr = validateStock(stockRaw);
  if (stockErr != null) return stockErr;
  final thumb = thumbnailUrl.trim();
  if (thumb.isEmpty) return '대표 이미지 URL을 입력해 주세요.';
  if (!thumb.startsWith('https://') && !thumb.startsWith('/api/v1/storage/file/')) {
    return '이미지는 https URL 또는 업로드 파일이어야 합니다.';
  }
  return null;
}

/// POST body. Assumes [validateCreateProduct] passed.
Map<String, dynamic> createProductPayload({
  required String title,
  required String categoryId,
  required int salePrice,
  required int originalPrice,
  required int stockQuantity,
  required String thumbnailUrl,
  String brand = '',
  String descriptionHtml = '',
}) {
  return {
    'title': title.trim(),
    'category_id': categoryId,
    'sale_price': salePrice,
    'original_price': originalPrice,
    'stock_quantity': stockQuantity,
    'thumbnail_url': thumbnailUrl.trim(),
    if (brand.trim().isNotEmpty) 'brand': brand.trim(),
    if (descriptionHtml.trim().isNotEmpty) 'description_html': descriptionHtml.trim(),
  };
}
