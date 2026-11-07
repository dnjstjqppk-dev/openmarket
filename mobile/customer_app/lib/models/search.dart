// mobile/customer_app/lib/models/search.dart
// Autocomplete result model for GET /api/v1/search/autocomplete.
// Pure parsing (no I/O) so it is unit-testable; see test/search_models_test.dart.

class AutocompleteSuggestion {
  final String keyword;
  final String? categoryName;
  final String? categorySlug;
  final int productHitCount;
  final int searchCount;

  const AutocompleteSuggestion({
    required this.keyword,
    this.categoryName,
    this.categorySlug,
    this.productHitCount = 0,
    this.searchCount = 0,
  });

  factory AutocompleteSuggestion.fromJson(Map<String, dynamic> json) {
    int asInt(dynamic v) => v is int ? v : int.tryParse(v?.toString() ?? '') ?? 0;
    return AutocompleteSuggestion(
      keyword: (json['keyword'] ?? '').toString(),
      categoryName: json['category_name']?.toString(),
      categorySlug: json['category_slug']?.toString(),
      productHitCount: asInt(json['product_hit_count']),
      searchCount: asInt(json['search_count']),
    );
  }
}

class AutocompleteCategory {
  final String id;
  final String name;
  final String slug;

  const AutocompleteCategory({required this.id, required this.name, required this.slug});

  factory AutocompleteCategory.fromJson(Map<String, dynamic> json) => AutocompleteCategory(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        slug: (json['slug'] ?? '').toString(),
      );
}

class AutocompleteProduct {
  final String id;
  final String title;
  final String thumbnailUrl;
  final int lowestSalePrice;

  const AutocompleteProduct({
    required this.id,
    required this.title,
    required this.thumbnailUrl,
    required this.lowestSalePrice,
  });

  factory AutocompleteProduct.fromJson(Map<String, dynamic> json) {
    final price = json['lowest_sale_price'];
    return AutocompleteProduct(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      thumbnailUrl: (json['thumbnail_url'] ?? '').toString(),
      lowestSalePrice: price is int ? price : int.tryParse(price?.toString() ?? '') ?? 0,
    );
  }
}

class AutocompleteResult {
  final String query;
  final String? resolvedSynonym;
  final List<AutocompleteSuggestion> suggestions;
  final List<AutocompleteCategory> categories;
  final List<AutocompleteProduct> products;
  final List<String> trendingKeywords;

  const AutocompleteResult({
    required this.query,
    this.resolvedSynonym,
    this.suggestions = const [],
    this.categories = const [],
    this.products = const [],
    this.trendingKeywords = const [],
  });

  bool get isEmpty =>
      suggestions.isEmpty && categories.isEmpty && products.isEmpty && trendingKeywords.isEmpty;
}

/// Parses the raw gateway payload. Unknown shapes degrade to empty sections —
/// the view shows an empty state, never a crash nor invented suggestions.
AutocompleteResult parseAutocompleteResponse(Map<String, dynamic> body, {String query = ''}) {
  List<T> section<T>(String key, T Function(Map<String, dynamic>) from) {
    final raw = body[key];
    if (raw is! List) return <T>[];
    return raw.whereType<Map>().map((e) => from(Map<String, dynamic>.from(e))).toList();
  }

  final trending = <String>[];
  final rawTrending = body['trending_keywords'];
  if (rawTrending is List) {
    for (final e in rawTrending) {
      final kw = e is Map ? e['keyword']?.toString() : e?.toString();
      if (kw != null && kw.isNotEmpty) trending.add(kw);
    }
  }

  return AutocompleteResult(
    query: (body['query'] ?? query).toString(),
    resolvedSynonym: body['resolved_synonym']?.toString(),
    suggestions: section('suggestions', AutocompleteSuggestion.fromJson),
    categories: section('categories', AutocompleteCategory.fromJson),
    products: section('products', AutocompleteProduct.fromJson),
    trendingKeywords: trending,
  );
}
