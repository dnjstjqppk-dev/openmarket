// Pure checkout merge tests (P0-07): cart lines merge per SKU, never per
// product — two variants of one product must stay two order lines.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/cart_line.dart';
import 'package:olmoa_customer/models/product.dart';
import 'package:olmoa_customer/services/api_service.dart';

Product _p(String id, String sku) => Product(
      id: id,
      title: 't',
      thumbnailUrl: '',
      descriptionHtml: '',
      lowestOriginalPrice: 100,
      lowestSalePrice: 90,
      totalSoldCount: 1,
      defaultSkuId: sku,
    );

void main() {
  test('different SKUs of one product stay separate lines', () {
    final items = ApiService.mergeItemsBySku([_p('prod_1', 'sku_a'), _p('prod_1', 'sku_b')]);
    expect(items.length, 2);
    expect(items, containsAll([
      {'sku_id': 'sku_a', 'quantity': 1},
      {'sku_id': 'sku_b', 'quantity': 1},
    ]));
  });

  test('same SKU quantities add up', () {
    final items = ApiService.mergeItemsBySku([_p('prod_1', 'sku_a'), _p('prod_1', 'sku_a')]);
    expect(items, [
      {'sku_id': 'sku_a', 'quantity': 2}
    ]);
  });

  test('lines without a SKU are skipped', () {
    final items = ApiService.mergeItemsBySku([_p('prod_1', ''), _p('prod_2', 'sku_c')]);
    expect(items, [
      {'sku_id': 'sku_c', 'quantity': 1}
    ]);
  });

  test('P1-M05 cart lines collapse to checkout items with quantities', () {
    final lines = [
      CartLine(product: _p('prod_1', 'sku_a'), quantity: 2),
      CartLine(product: _p('prod_1', 'sku_b'), quantity: 1),
      CartLine(product: _p('prod_2', ''), quantity: 3),
    ];
    expect(cartLinesToOrderItems(lines), [
      {'sku_id': 'sku_a', 'quantity': 2},
      {'sku_id': 'sku_b', 'quantity': 1},
    ]);
  });

  test('P1-M05 server cart rows rebuild lines with live prices', () {
    final l = CartLine.fromServer({
      'sku_id': 'sku_a',
      'quantity': 2,
      'product_id': 'prod_1',
      'sale_price': 45000,
      'original_price': 50000,
      'stock_quantity': 7,
      'title': 'Server Mug',
      'thumbnail_url': 'https://x/m.png',
    });
    expect(l.skuId, 'sku_a');
    expect(l.quantity, 2);
    expect(l.product.title, 'Server Mug');
    expect(l.product.lowestSalePrice, 45000);
    expect(l.toSyncItem(), {'sku_id': 'sku_a', 'quantity': 2});
  });
}
