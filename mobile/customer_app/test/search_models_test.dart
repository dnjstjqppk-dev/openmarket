// Unit tests for the search + detail parsers (pure, no I/O).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/search.dart';
import 'package:olmoa_customer/models/product_detail.dart';

void main() {
  group('parseAutocompleteResponse', () {
    test('parses suggestions, categories and products', () {
      final r = parseAutocompleteResponse({
        'query': '가방',
        'resolved_synonym': null,
        'suggestions': [
          {'keyword': '가방', 'category_name': '패션', 'category_slug': 'fashion', 'product_hit_count': 42, 'search_count': 7},
        ],
        'categories': [
          {'id': 'cat1', 'name': '가방·잡화', 'slug': 'bags'},
        ],
        'products': [
          {'id': 'prod_001', 'title': '가죽 가방', 'thumbnail_url': 'https://x/y.png', 'lowest_sale_price': 19900},
        ],
      });
      expect(r.query, '가방');
      expect(r.resolvedSynonym, isNull);
      expect(r.suggestions.single.keyword, '가방');
      expect(r.suggestions.single.productHitCount, 42);
      expect(r.categories.single.slug, 'bags');
      expect(r.products.single.lowestSalePrice, 19900);
      expect(r.isEmpty, isFalse);
    });

    test('empty query surfaces trending keywords', () {
      final r = parseAutocompleteResponse({
        'query': '',
        'trending_keywords': [
          {'keyword': '롱패딩'},
          {'keyword': '에어프라이어'},
        ],
      });
      expect(r.trendingKeywords, ['롱패딩', '에어프라이어']);
      expect(r.isEmpty, isFalse);
    });

    test('unknown shapes degrade to empty sections, never throw', () {
      final r = parseAutocompleteResponse({'suggestions': 'nope', 'products': null});
      expect(r.isEmpty, isTrue);
      expect(parseAutocompleteResponse({}).isEmpty, isTrue);
    });
  });

  group('parseProductDetail', () {
    Map<String, dynamic> fixture() => {
          'id': 'prod_001',
          'title': '테스트 상품',
          'thumbnail_url': '',
          'lowest_original_price': 30000,
          'lowest_sale_price': 19900,
          'total_sold_count': 5,
          'avg_rating': 4.5,
          'review_count': 2,
          'qna_count': 1,
          'skus': [
            {
              'id': 'sku_a',
              'product_id': 'prod_001',
              'sku_code': 'A',
              'option_combination_json': '{"색상":"블랙"}',
              'original_price': 30000,
              'sale_price': 19900,
              'stock_quantity': 3
            },
            {
              'id': 'sku_b',
              'product_id': 'prod_001',
              'sku_code': 'B',
              'option_combination_json': '{"색상":"화이트"}',
              'original_price': 30000,
              'sale_price': 19900,
              'stock_quantity': 0
            },
          ],
          'attributes': [
            {
              'name': '색상',
              'values': ['블랙', '화이트']
            }
          ],
          'volume_discounts': [
            {'min_quantity': 3, 'discount_rate_pct': 5, 'label': '3개 이상 5% 추가 할인'},
          ],
        };

    test('parses detail envelope and resolves SKUs by option selection', () {
      final d = parseProductDetail(fixture());
      expect(d.product.id, 'prod_001');
      expect(d.attributes.single.values, ['블랙', '화이트']);
      expect(d.avgRating, 4.5);
      expect(d.reviewCount, 2);
      expect(d.volumeDiscounts.single.minQuantity, 3);
      expect(d.skuForSelection({'색상': '블랙'})?.id, 'sku_a');
      expect(d.skuForSelection({'색상': '화이트'})?.stockQuantity, 0);
    });

    test('incomplete or unknown selections resolve to nothing', () {
      final d = parseProductDetail(fixture());
      expect(d.skuForSelection({}), isNull);
      expect(d.skuForSelection({'색상': '레드'}), isNull);
    });

    test('malformed option json never throws', () {
      expect(parseOptionMap('not-json'), isEmpty);
      expect(parseOptionMap(''), isEmpty);
    });
  });
}
