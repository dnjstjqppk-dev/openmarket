// mobile/customer_app/lib/views/search_view.dart
// Buyer search: debounced autocomplete (keywords, categories, products),
// trending keywords on empty query, and a results list. Suggestions come only
// from GET /api/v1/search/autocomplete; submitted keywords are logged via
// POST /api/v1/search/log like the web search bar.

import 'dart:async';
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/search.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'product_detail_view.dart';

class SearchView extends StatefulWidget {
  final void Function(Product) onAddToCart;

  const SearchView({super.key, required this.onAddToCart});

  @override
  State<SearchView> createState() => _SearchViewState();
}

class _SearchViewState extends State<SearchView> {
  final _controller = TextEditingController();
  Timer? _debounce;
  int _seq = 0;
  AutocompleteResult? _suggest;
  bool _suggestLoading = false;
  List<Product>? _results;
  bool _resultsLoading = false;
  String? _resultsError;
  String _submittedQuery = '';

  @override
  void initState() {
    super.initState();
    _fetchSuggest('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _fetchSuggest(String q) async {
    final mySeq = ++_seq;
    setState(() => _suggestLoading = true);
    final r = await ApiService.getAutocomplete(q);
    if (!mounted || mySeq != _seq) return;
    setState(() {
      _suggest = r;
      _suggestLoading = false;
    });
  }

  void _onQueryChanged(String q) {
    _debounce?.cancel();
    // A new keystroke invalidates the previous result list.
    _results = null;
    _submittedQuery = '';
    _debounce = Timer(const Duration(milliseconds: 300), () => _fetchSuggest(q.trim()));
  }

  Future<void> _submit(String raw) async {
    final q = raw.trim();
    if (q.isEmpty) return;
    _debounce?.cancel();
    setState(() {
      _resultsLoading = true;
      _resultsError = null;
      _submittedQuery = q;
    });
    unawaited(ApiService.logSearch(q));
    try {
      final list = await ApiService.getProducts(query: q);
      if (!mounted) return;
      setState(() {
        _results = list;
        _resultsLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _results = null;
        _resultsLoading = false;
        _resultsError = '검색 결과를 불러오지 못했습니다.';
      });
    }
  }

  void _openDetail(String productId) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ProductDetailView(productId: productId, onAddToCart: widget.onAddToCart)),
    );
  }

  String _won(int v) => '₩${v.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

  @override
  Widget build(BuildContext context) {
    final showingResults = _submittedQuery.isNotEmpty;
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          onChanged: _onQueryChanged,
          onSubmitted: _submit,
          decoration: const InputDecoration(
            hintText: '상품, 카테고리 검색',
            border: InputBorder.none,
            prefixIcon: Icon(Icons.search),
          ),
        ),
      ),
      body: showingResults ? _buildResults() : _buildSuggest(),
    );
  }

  Widget _buildSuggest() {
    if (_suggestLoading && _suggest == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final s = _suggest;
    if (s == null || s.isEmpty) {
      return const Center(child: Text('추천 검색어가 없습니다.', style: TextStyle(color: Colors.grey)));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (s.trendingKeywords.isNotEmpty) ...[
          const _SectionTitle('인기 검색어'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: s.trendingKeywords
                .map((k) => ActionChip(label: Text(k), onPressed: () {
                      _controller.text = k;
                      _submit(k);
                    }))
                .toList(),
          ),
          const SizedBox(height: 16),
        ],
        if (s.suggestions.isNotEmpty) ...[
          const _SectionTitle('추천 키워드'),
          ...s.suggestions.map((e) => ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.trending_up, size: 20),
                title: Text(e.keyword),
                subtitle: e.categoryName != null ? Text(e.categoryName!) : null,
                trailing: e.productHitCount > 0 ? Text('${e.productHitCount}개', style: const TextStyle(color: Colors.grey, fontSize: 12)) : null,
                onTap: () {
                  _controller.text = e.keyword;
                  _submit(e.keyword);
                },
              )),
          const SizedBox(height: 8),
        ],
        if (s.categories.isNotEmpty) ...[
          const _SectionTitle('카테고리'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: s.categories
                .map((c) => OutlinedButton(
                      onPressed: () {
                        _controller.text = c.name;
                        _submit(c.name);
                      },
                      child: Text(c.name),
                    ))
                .toList(),
          ),
          const SizedBox(height: 16),
        ],
        if (s.products.isNotEmpty) ...[
          const _SectionTitle('연관 상품'),
          ...s.products.map((p) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(p.thumbnailUrl,
                      width: 48, height: 48, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(width: 48, height: 48, color: Colors.grey.shade100, child: const Icon(Icons.shopping_bag, color: Colors.grey))),
                ),
                title: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(_won(p.lowestSalePrice), style: const TextStyle(color: OlmoaColors.ruby500, fontWeight: FontWeight.bold)),
                onTap: () => _openDetail(p.id),
              )),
        ],
      ],
    );
  }

  Widget _buildResults() {
    if (_resultsLoading) return const Center(child: CircularProgressIndicator());
    if (_resultsError != null) {
      return Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(_resultsError!, style: const TextStyle(fontSize: 13)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: () => _submit(_submittedQuery), child: const Text('다시 시도')),
        ]),
      );
    }
    final list = _results ?? [];
    if (list.isEmpty) {
      return Center(child: Text('‘$_submittedQuery’ 검색 결과가 없습니다.', style: const TextStyle(color: Colors.grey)));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: list.length,
      separatorBuilder: (_, __) => const Divider(height: 24),
      itemBuilder: (context, i) {
        final p = list[i];
        return InkWell(
          onTap: () => _openDetail(p.id),
          child: Row(children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(p.thumbnailUrl,
                  width: 72, height: 72, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(width: 72, height: 72, color: Colors.grey.shade100, child: const Icon(Icons.shopping_bag, color: Colors.grey))),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                const SizedBox(height: 4),
                Text(_won(p.lowestSalePrice), style: const TextStyle(color: OlmoaColors.ruby500, fontWeight: FontWeight.w900, fontSize: 15)),
              ]),
            ),
            IconButton(
              icon: const Icon(Icons.add_shopping_cart_outlined),
              onPressed: () => widget.onAddToCart(p),
              tooltip: '장바구니 담기',
            ),
          ]),
        );
      },
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
    );
  }
}
