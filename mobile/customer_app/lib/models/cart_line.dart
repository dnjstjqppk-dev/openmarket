// mobile/customer_app/lib/models/cart_line.dart
// One cart line: an orderable SKU (never an invented id) plus a quantity.
// Lines built from catalog taps carry the full Product; lines pulled from
// GET /api/v1/cart are rebuilt from the server's live price/stock join.
import 'product.dart';

class CartLine {
  final Product product;
  int quantity;

  CartLine({required this.product, this.quantity = 1});

  String get skuId => product.defaultSkuId;

  /// Rebuilds a line from the enriched GET /api/v1/cart row. The sale price
  /// shown is the server's live SKU price, not a stored snapshot.
  factory CartLine.fromServer(Map<String, dynamic> row) {
    final price = row['sale_price'];
    final orig = row['original_price'];
    return CartLine(
      product: Product(
        id: (row['product_id'] ?? '').toString(),
        title: (row['title'] ?? '').toString(),
        thumbnailUrl: (row['thumbnail_url'] ?? '').toString(),
        descriptionHtml: '',
        lowestOriginalPrice: orig is int ? orig : int.tryParse(orig?.toString() ?? '') ?? 0,
        lowestSalePrice: price is int ? price : int.tryParse(price?.toString() ?? '') ?? 0,
        totalSoldCount: 0,
        defaultSkuId: (row['sku_id'] ?? '').toString(),
      ),
      quantity: (row['quantity'] is int)
          ? row['quantity'] as int
          : int.tryParse(row['quantity']?.toString() ?? '') ?? 1,
    );
  }

  Map<String, Object> toSyncItem() => {'sku_id': skuId, 'quantity': quantity};
}

/// Collapses lines into checkout/quote items. Lines without a server-issued
/// SKU id are skipped — the app never invents one (same rule as
/// ApiService.mergeItemsBySku).
List<Map<String, Object>> cartLinesToOrderItems(List<CartLine> lines) {
  final bySku = <String, int>{};
  for (final l in lines) {
    if (l.skuId.isEmpty || l.quantity < 1) continue;
    bySku[l.skuId] = (bySku[l.skuId] ?? 0) + l.quantity;
  }
  return [for (final e in bySku.entries) {'sku_id': e.key, 'quantity': e.value}];
}
