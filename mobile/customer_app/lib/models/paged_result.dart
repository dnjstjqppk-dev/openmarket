// mobile/customer_app/lib/models/paged_result.dart
// Wave J-3 (P2-MOB-08): one page of a server-paginated list. Views append
// pages behind a "load more" control instead of one capped fetch.

class PagedResult<T> {
  final List<T> items;
  final int page;
  final int totalPages;
  final int total;

  const PagedResult({
    required this.items,
    required this.page,
    required this.totalPages,
    required this.total,
  });

  bool get hasMore => page < totalPages;

  /// Parses the gateway envelope ({data, pagination:{page,total_pages,total}}).
  /// Missing pagination degrades to a single finished page, never a guess.
  factory PagedResult.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) parseItem,
  ) {
    final List<dynamic> list = json['data'] ?? [];
    final pg = json['pagination'];
    final page = pg is Map ? (pg['page'] is int ? pg['page'] as int : int.tryParse('${pg['page']}') ?? 1) : 1;
    final totalPages = pg is Map
        ? (pg['total_pages'] is int
            ? pg['total_pages'] as int
            : int.tryParse('${pg['total_pages']}') ?? 1)
        : 1;
    final total = pg is Map
        ? (pg['total'] is int ? pg['total'] as int : int.tryParse('${pg['total']}') ?? list.length)
        : list.length;
    return PagedResult(
      items: list.map((e) => parseItem(Map<String, dynamic>.from(e as Map))).toList(),
      page: page < 1 ? 1 : page,
      totalPages: totalPages < 1 ? 1 : totalPages,
      total: total,
    );
  }
}
