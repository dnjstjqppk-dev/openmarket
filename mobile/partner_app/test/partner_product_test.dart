// Partner product row parsing + server-rule mirror (routes/partner.js).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/partner_product.dart';

void main() {
  test('fromJson reads a product/SKU row', () {
    final row = PartnerProductRow.fromJson({
      'id': 'prod_1',
      'sku_id': 'sku_1',
      'title': '테스트 상품',
      'category_name': '여성의류',
      'status': 'ACTIVE',
      'review_status': 'APPROVED',
      'sale_price': 9900,
      'sku_original_price': 19900,
      'stock_quantity': 12,
      'sku_code': 'SKU-A',
      'option_summary': '색상:블랙',
      'lowest_sale_price': 9900,
      'lowest_original_price': 19900,
    });
    expect(row.id, 'prod_1');
    expect(row.skuId, 'sku_1');
    expect(row.salePrice, 9900);
    expect(row.originalPrice, 19900);
    expect(row.stockQuantity, 12);
    expect(row.displayStatus, '판매중');
  });

  test('displayStatus never leaks a raw code', () {
    PartnerProductRow status(String s, String r) => PartnerProductRow.fromJson(
        {'id': 'p', 'title': 't', 'status': s, 'review_status': r});
    expect(status('DRAFT', 'PENDING').displayStatus, '심사 대기');
    expect(status('ACTIVE', 'PENDING').displayStatus, '재심사 대기');
    expect(status('ACTIVE', 'APPROVED').displayStatus, '판매중');
    expect(status('DRAFT', 'APPROVED').displayStatus, '판매중지');
    expect(status('ACTIVE', 'REJECTED').displayStatus, '반려됨');
  });

  test('sale price bounds mirror priceFields (100..100M)', () {
    expect(validateSalePrice('99'), isNotNull);
    expect(validateSalePrice('100'), isNull);
    expect(validateSalePrice('100,000,000'), isNull);
    expect(validateSalePrice('100000001'), isNotNull);
    expect(validateSalePrice('abc'), isNotNull);
    expect(validateSalePrice(''), isNotNull);
  });

  test('original price must cover the sale price', () {
    expect(validateOriginalPrice('9900', 9900), isNull);
    expect(validateOriginalPrice('19900', 9900), isNull);
    expect(validateOriginalPrice('9899', 9900), isNotNull);
  });

  test('stock bounds mirror the server (0..1M)', () {
    expect(validateStock('0'), isNull);
    expect(validateStock('1000000'), isNull);
    expect(validateStock('1000001'), isNotNull);
    expect(validateStock('-1'), isNotNull);
    expect(validateStock('1.5'), isNotNull);
  });

  test('create validation requires title, category, prices, stock, image', () {
    String? valid = validateCreateProduct(
      title: '신상품',
      categoryId: 'cat_1',
      saleRaw: '9900',
      originalRaw: '',
      stockRaw: '10',
      thumbnailUrl: 'https://img.example.com/a.jpg',
    );
    expect(valid, isNull);
    expect(
        validateCreateProduct(
          title: ' ',
          categoryId: 'cat_1',
          saleRaw: '9900',
          originalRaw: '',
          stockRaw: '10',
          thumbnailUrl: 'https://img.example.com/a.jpg',
        ),
        isNotNull);
    expect(
        validateCreateProduct(
          title: '신상품',
          categoryId: null,
          saleRaw: '9900',
          originalRaw: '',
          stockRaw: '10',
          thumbnailUrl: 'https://img.example.com/a.jpg',
        ),
        isNotNull);
    expect(
        validateCreateProduct(
          title: '신상품',
          categoryId: 'cat_1',
          saleRaw: '9900',
          originalRaw: '',
          stockRaw: '10',
          thumbnailUrl: 'http://img.example.com/a.jpg',
        ),
        isNotNull);
    expect(
        validateCreateProduct(
          title: '신상품',
          categoryId: 'cat_1',
          saleRaw: '9900',
          originalRaw: '',
          stockRaw: '10',
          thumbnailUrl: '/api/v1/storage/file/abc',
        ),
        isNull);
  });

  test('create payload carries the server field names', () {
    final p = createProductPayload(
      title: ' 신상품 ',
      categoryId: 'cat_1',
      salePrice: 9900,
      originalPrice: 9900,
      stockQuantity: 10,
      thumbnailUrl: 'https://img.example.com/a.jpg',
      brand: 'OLMOA',
    );
    expect(p['title'], '신상품');
    expect(p['category_id'], 'cat_1');
    expect(p['sale_price'], 9900);
    expect(p['brand'], 'OLMOA');
    expect(p.containsKey('description_html'), isFalse);
  });
}
