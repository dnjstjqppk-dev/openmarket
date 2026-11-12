// Paginated envelope parsing (models/paged_result.dart).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/paged_result.dart';

Map<String, dynamic> _row(Map<String, dynamic> m) => m;

void main() {
  test('pages parse items and the has-more flag', () {
    final p = PagedResult<Map<String, dynamic>>.fromJson({
      'data': [
        {'id': 'a'},
        {'id': 'b'}
      ],
      'pagination': {'page': 1, 'per_page': 2, 'total': 5, 'total_pages': 3},
    }, _row);
    expect(p.items.length, 2);
    expect(p.page, 1);
    expect(p.totalPages, 3);
    expect(p.total, 5);
    expect(p.hasMore, isTrue);
    final last = PagedResult<Map<String, dynamic>>.fromJson({
      'data': [
        {'id': 'e'}
      ],
      'pagination': {'page': 3, 'per_page': 2, 'total': 5, 'total_pages': 3},
    }, _row);
    expect(last.hasMore, isFalse);
  });

  test('missing pagination degrades to one finished page', () {
    final p = PagedResult<Map<String, dynamic>>.fromJson({
      'data': [
        {'id': 'a'}
      ],
    }, _row);
    expect(p.items.length, 1);
    expect(p.hasMore, isFalse);
    expect(p.total, 1);
  });

  test('string numbers and zeroes are normalized', () {
    final p = PagedResult<Map<String, dynamic>>.fromJson({
      'data': [],
      'pagination': {'page': '2', 'total_pages': '0', 'total': '0'},
    }, _row);
    expect(p.page, 2);
    expect(p.totalPages, 1);
    expect(p.hasMore, isFalse);
  });
}
