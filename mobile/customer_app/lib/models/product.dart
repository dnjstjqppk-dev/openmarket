// mobile/customer_app/lib/models/product.dart
// Product and SKU entity models for OpenMarket Flutter App

class ProductSku {
  final String id;
  final String productId;
  final String skuCode;
  final String optionCombinationJson;
  final int originalPrice;
  final int salePrice;
  final int stockQuantity;

  ProductSku({
    required this.id,
    required this.productId,
    required this.skuCode,
    required this.optionCombinationJson,
    required this.originalPrice,
    required this.salePrice,
    required this.stockQuantity,
  });

  factory ProductSku.fromJson(Map<String, dynamic> json) {
    return ProductSku(
      id: (json['id'] ?? '').toString(),
      productId: (json['product_id'] ?? '').toString(),
      skuCode: (json['sku_code'] ?? '').toString(),
      optionCombinationJson: (json['option_combination_json'] ?? '{}').toString(),
      originalPrice: Product._asInt(json['original_price']),
      salePrice: Product._asInt(json['sale_price']),
      stockQuantity: Product._asInt(json['stock_quantity']),
    );
  }
}

class Product {
  final String id;
  final String title;
  final String thumbnailUrl;
  final String descriptionHtml;
  final int lowestOriginalPrice;
  final int lowestSalePrice;
  final int totalSoldCount;
  final String categoryName;
  final String businessName;
  // Cheapest in-stock variant from GET /api/v1/products (routes/catalog.js).
  // The app never invents a SKU id: without this, the line cannot be ordered.
  final String defaultSkuId;

  Product({
    required this.id,
    required this.title,
    required this.thumbnailUrl,
    required this.descriptionHtml,
    required this.lowestOriginalPrice,
    required this.lowestSalePrice,
    required this.totalSoldCount,
    this.categoryName = '',
    this.businessName = '',
    this.defaultSkuId = '',
  });

  static int _asInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      thumbnailUrl: (json['thumbnail_url'] ?? '').toString(),
      descriptionHtml: (json['description_html'] ?? '').toString(),
      lowestOriginalPrice: _asInt(json['lowest_original_price']),
      lowestSalePrice: _asInt(json['lowest_sale_price']),
      totalSoldCount: _asInt(json['total_sold_count']),
      categoryName: (json['category_name'] ?? '').toString(),
      businessName: (json['business_name'] ?? '').toString(),
      defaultSkuId: (json['default_sku_id'] ?? '').toString(),
    );
  }

  int get discountPercent {
    if (lowestOriginalPrice <= 0) return 0;
    return (((lowestOriginalPrice - lowestSalePrice) / lowestOriginalPrice) * 100).round();
  }

  /// Rebinds the orderable variant (e.g. the SKU chosen on the detail screen).
  Product copyWith({String? defaultSkuId}) => Product(
        id: id,
        title: title,
        thumbnailUrl: thumbnailUrl,
        descriptionHtml: descriptionHtml,
        lowestOriginalPrice: lowestOriginalPrice,
        lowestSalePrice: lowestSalePrice,
        totalSoldCount: totalSoldCount,
        categoryName: categoryName,
        businessName: businessName,
        defaultSkuId: defaultSkuId ?? this.defaultSkuId,
      );
}
