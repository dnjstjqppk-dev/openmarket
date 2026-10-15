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
      id: json['id'] ?? '',
      productId: json['product_id'] ?? '',
      skuCode: json['sku_code'] ?? '',
      optionCombinationJson: json['option_combination_json'] ?? '{}',
      originalPrice: json['original_price'] ?? 0,
      salePrice: json['sale_price'] ?? 0,
      stockQuantity: json['stock_quantity'] ?? 0,
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
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      thumbnailUrl: json['thumbnail_url'] ?? '',
      descriptionHtml: json['description_html'] ?? '',
      lowestOriginalPrice: json['lowest_original_price'] ?? 0,
      lowestSalePrice: json['lowest_sale_price'] ?? 0,
      totalSoldCount: json['total_sold_count'] ?? 0,
      categoryName: json['category_name'] ?? '',
      businessName: json['business_name'] ?? '',
    );
  }

  int get discountPercent {
    if (lowestOriginalPrice <= 0) return 0;
    return (((lowestOriginalPrice - lowestSalePrice) / lowestOriginalPrice) * 100).round();
  }
}

