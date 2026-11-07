// mobile/customer_app/lib/models/product_detail.dart
// Detail model for GET /api/v1/products/{id}: option attributes, SKU matrix,
// rating and volume discounts. Pure parsing + SKU resolution (no I/O).

import 'dart:convert';
import 'product.dart';

class OptionAttribute {
  final String name;
  final List<String> values;

  const OptionAttribute({required this.name, required this.values});

  factory OptionAttribute.fromJson(Map<String, dynamic> json) {
    final raw = json['values'];
    return OptionAttribute(
      name: (json['name'] ?? '').toString(),
      values: raw is List ? raw.map((e) => e.toString()).toList() : const [],
    );
  }
}

class VolumeDiscount {
  final int minQuantity;
  final int discountRatePct;
  final String label;

  const VolumeDiscount({required this.minQuantity, required this.discountRatePct, required this.label});

  factory VolumeDiscount.fromJson(Map<String, dynamic> json) {
    int asInt(dynamic v) => v is int ? v : int.tryParse(v?.toString() ?? '') ?? 0;
    return VolumeDiscount(
      minQuantity: asInt(json['min_quantity']),
      discountRatePct: asInt(json['discount_rate_pct']),
      label: (json['label'] ?? '').toString(),
    );
  }
}

Map<String, String> parseOptionMap(String combinationJson) {
  try {
    final decoded = jsonDecode(combinationJson);
    if (decoded is! Map) return const {};
    return decoded.map((k, v) => MapEntry(k.toString(), v.toString()));
  } catch (_) {
    return const {};
  }
}

class ProductDetail {
  final Product product;
  final List<ProductSku> skus;
  final List<OptionAttribute> attributes;
  final double? avgRating;
  final int reviewCount;
  final int qnaCount;
  final List<VolumeDiscount> volumeDiscounts;

  const ProductDetail({
    required this.product,
    required this.skus,
    required this.attributes,
    this.avgRating,
    required this.reviewCount,
    required this.qnaCount,
    required this.volumeDiscounts,
  });

  /// The SKU matching a complete option selection, or null when the selection
  /// is incomplete or matches nothing on sale.
  ProductSku? skuForSelection(Map<String, String> selection) {
    if (selection.length != attributes.length) return null;
    for (final sku in skus) {
      final opts = parseOptionMap(sku.optionCombinationJson);
      var match = true;
      for (final attr in attributes) {
        if (opts[attr.name] != selection[attr.name]) {
          match = false;
          break;
        }
      }
      if (match) return sku;
    }
    return null;
  }
}

ProductDetail parseProductDetail(Map<String, dynamic> data) {
  int asInt(dynamic v) => v is int ? v : int.tryParse(v?.toString() ?? '') ?? 0;
  final skuList = data['skus'];
  final attrList = data['attributes'];
  final discList = data['volume_discounts'];
  final rating = data['avg_rating'];
  return ProductDetail(
    product: Product.fromJson(data),
    skus: skuList is List
        ? skuList.whereType<Map>().map((e) => ProductSku.fromJson(Map<String, dynamic>.from(e))).toList()
        : const [],
    attributes: attrList is List
        ? attrList.whereType<Map>().map((e) => OptionAttribute.fromJson(Map<String, dynamic>.from(e))).toList()
        : const [],
    avgRating: rating is num ? rating.toDouble() : null,
    reviewCount: asInt(data['review_count']),
    qnaCount: asInt(data['qna_count']),
    volumeDiscounts: discList is List
        ? discList.whereType<Map>().map((e) => VolumeDiscount.fromJson(Map<String, dynamic>.from(e))).toList()
        : const [],
  );
}
