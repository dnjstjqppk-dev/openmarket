// Staged option-sheet rules (3-12): later stages unlock in order, values
// without a compatible in-stock SKU stay disabled, completed combos land as
// rows, and re-adding the same SKU bumps quantity capped at stock.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/product.dart';
import 'package:olmoa_customer/models/product_detail.dart';
import 'package:olmoa_customer/widgets/option_sheet.dart';

ProductSku sku(String id, String color, String size, int stock) => ProductSku(
      id: id,
      productId: 'p1',
      skuCode: id,
      optionCombinationJson: '{"색상":"$color","사이즈":"$size"}',
      originalPrice: 20000,
      salePrice: 15000,
      stockQuantity: stock,
    );

ProductDetail detail() => ProductDetail(
      product: Product(
          id: 'p1',
          title: 't',
          thumbnailUrl: '',
          descriptionHtml: '',
          lowestOriginalPrice: 20000,
          lowestSalePrice: 15000,
          totalSoldCount: 0),
      skus: [
        sku('s1', '빨강', 'M', 5),
        sku('s2', '빨강', 'L', 0),
        sku('s3', '파랑', 'M', 3),
      ],
      attributes: const [
        OptionAttribute(name: '색상', values: ['빨강', '파랑']),
        OptionAttribute(name: '사이즈', values: ['M', 'L']),
      ],
      avgRating: null,
      reviewCount: 0,
      qnaCount: 0,
      volumeDiscounts: const [],
    );

void main() {
  test('first stage lists values with in-stock availability', () {
    final avail = stageAvailability(detail(), 0, {});
    expect(avail, {'빨강': true, '파랑': true});
  });

  test('second stage narrows to the prior pick and gates stockouts', () {
    final avail = stageAvailability(detail(), 1, {'색상': '빨강'});
    expect(avail, {'M': true, 'L': false});
  });

  test('summary joins values in attribute order', () {
    expect(skuSummary(detail().skus.first, detail().attributes), '빨강 / M');
  });

  test('addRow appends, bumps and caps at stock', () {
    final skus = detail().skus;
    var rows = addRow([], skus[0]);
    expect(rows.length, 1);
    expect(rows.single.qty, 1);
    rows = addRow(rows, skus[0]);
    expect(rows.single.qty, 2);
    rows = addRow(rows, skus[2]);
    expect(rows.length, 2);
    var capped = [SheetRow(sku: skus[0], qty: 5)];
    capped = addRow(capped, skus[0]);
    expect(capped.single.qty, 5);
  });
}
