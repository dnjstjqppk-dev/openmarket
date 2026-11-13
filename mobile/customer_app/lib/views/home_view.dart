// mobile/customer_app/lib/views/home_view.dart
// Temu-style Global E-Commerce Product Feed for Flutter Mobile App

import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../models/paged_result.dart';
import '../models/product.dart';
import '../models/search.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/product_grid_card.dart';
import '../widgets/responsive.dart';
import 'channels_view.dart';

class HomeView extends StatefulWidget {
  final Function(Product) onAddToCart;

  const HomeView({super.key, required this.onAddToCart});

  @override
  State<HomeView> createState() => _HomeViewState();
}

class _HomeViewState extends State<HomeView> {
  final ApiService _apiService = ApiService();
  List<Product> _products = [];
  List<Map<String, dynamic>> _banners = [];
  List<AutocompleteCategory> _categories = [];
  List<Product> _forYou = [];
  String? _categorySlug;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  int _page = 1;
  bool _hasMore = false;
  bool _loadingMore = false;

  Future<void> _loadProducts() async {
    final results = await Future.wait([
      ApiService.getProductsPage(categorySlug: _categorySlug, page: 1),
      _apiService.fetchBanners(),
      // P1-M01: the server's recommended_categories drive the filter chips.
      ApiService.getAutocomplete(''),
      // H-3: personalized strip (guests get global popular).
      ApiService.getForYou(limit: 8),
    ]);
    if (mounted) {
      final first = results[0] as PagedResult<Product>;
      setState(() {
        _products = first.items;
        _page = first.page;
        _hasMore = first.hasMore;
        _banners = results[1] as List<Map<String, dynamic>>;
        _categories = (results[2] as AutocompleteResult).categories;
        _forYou = results[3] as List<Product>;
        _isLoading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ApiService.getProductsPage(
          categorySlug: _categorySlug, page: _page + 1);
      if (mounted) {
        setState(() {
          _products = [..._products, ...next.items];
          _page = next.page;
          _hasMore = next.hasMore;
        });
      }
    } catch (_) {
      if (mounted) {
        // P2-MOB-09: nullable lookup with Korean fallback.
        final t = AppLocalizations.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(
                  t?.homeNextPageFail ?? '다음 페이지를 불러오지 못했습니다.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _selectCategory(String? slug) async {
    setState(() {
      _categorySlug = slug;
      _isLoading = true;
    });
    await _loadProducts();
  }

  @override
  Widget build(BuildContext context) {
    // P2-MOB-09: nullable lookup with Korean fallback (bare-context safe).
    final t = AppLocalizations.of(context);
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    // The catalog comes only from the server: an empty list means the load
    // failed or nothing is on sale, so offer a retry instead of fake items.
    if (_products.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.cloud_off_outlined,
                size: 56, color: Colors.grey.shade300),
            const SizedBox(height: 12),
            Text(t?.homeLoadFail ?? '상품 목록을 불러오지 못했습니다.',
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () {
                setState(() => _isLoading = true);
                _loadProducts();
              },
              child: Text(t?.commonRetry ?? '다시 시도'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadProducts,
      child: CustomScrollView(
        slivers: [
          // Banner Section
          SliverToBoxAdapter(
            child: Container(
              margin: const EdgeInsets.all(12),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [OlmoaColors.lagoon700, OlmoaColors.lagoon400],
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _banners.isNotEmpty &&
                                  _banners[0]['badge_text'] != null
                              ? _banners[0]['badge_text']
                              : 'OLMOA',
                          style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 11,
                              fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _banners.isNotEmpty && _banners[0]['title'] != null
                              ? _banners[0]['title']
                              : t?.homeTodayPick ?? '오늘의 추천 상품',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _banners.isNotEmpty && _banners[0]['subtitle'] != null
                              ? _banners[0]['subtitle']
                              : t?.homeExhibitionEmpty ?? '기획전 소식을 준비하고 있습니다',
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.bolt, color: Colors.amberAccent, size: 48),
                ],
              ),
            ),
          ),

          // P2-MOB-P3: curated channels entry (category browser, best, deals).
          SliverToBoxAdapter(
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: OutlinedButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => Scaffold(
                          appBar: AppBar(
                              title: Text(t?.homeChannels ?? '쇼핑 채널')),
                          body: ChannelsView(
                              onAddToCart: widget.onAddToCart)))),
                icon: const Icon(Icons.grid_view_outlined, size: 18),
                label: Text(t?.homeChannelsLabel ?? '카테고리 · 베스트 · 특가',
                    style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ),

          // P1-M01: server-driven category filter chips.
          if (_categories.isNotEmpty)
            SliverToBoxAdapter(
              child: SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    ChoiceChip(
                      label: Text(t?.homeAll ?? '전체'),
                      selected: _categorySlug == null,
                      onSelected: (_) {
                        if (_categorySlug != null) _selectCategory(null);
                      },
                    ),
                    const SizedBox(width: 8),
                    for (final c in _categories) ...[
                      ChoiceChip(
                        label: Text(c.name),
                        selected: _categorySlug == c.slug,
                        onSelected: (_) {
                          if (_categorySlug != c.slug) _selectCategory(c.slug);
                        },
                      ),
                      const SizedBox(width: 8),
                    ],
                  ],
                ),
              ),
            ),
          if (_categories.isNotEmpty)
            const SliverToBoxAdapter(child: SizedBox(height: 8)),

          // H-3: personalized strip on the unfiltered feed.
          if (_categorySlug == null && _forYou.isNotEmpty)
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                    child: Text(t?.homeForYou ?? '맞춤 추천',
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w900)),
                  ),
                  SizedBox(
                    height: 240,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      itemCount: _forYou.length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(width: 10),
                      itemBuilder: (context, i) => SizedBox(
                        width: 160,
                        child: ProductGridCard(
                            product: _forYou[i],
                            onAddToCart: widget.onAddToCart),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
              ),
            ),

          // Product Grid: 2 columns on phones, 3 on tablets, 4 on desktop widths.
          SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            sliver: SliverLayoutBuilder(
              builder: (context, constraints) {
                return SliverGrid(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount:
                        gridColumnsForWidth(constraints.crossAxisExtent),
                    childAspectRatio: 0.68,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => ProductGridCard(
                        product: _products[index],
                        onAddToCart: widget.onAddToCart),
                    childCount: _products.length,
                  ),
                );
              },
            ),
          ),
          if (_hasMore)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Center(
                  child: _loadingMore
                      ? const CircularProgressIndicator()
                      : OutlinedButton(
                          onPressed: _loadMore,
                          child: Text(t?.homeMore ?? '상품 더 보기'),
                        ),
                ),
              ),
            ),
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
        ],
      ),
    );
  }
}
