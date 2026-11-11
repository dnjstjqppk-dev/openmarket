// mobile/customer_app/lib/views/home_view.dart
// Temu-style Global E-Commerce Product Feed for Flutter Mobile App

import 'package:flutter/material.dart';
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
  String? _categorySlug;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadProducts();
  }

  Future<void> _loadProducts() async {
    final results = await Future.wait([
      _apiService.fetchProducts(categorySlug: _categorySlug),
      _apiService.fetchBanners(),
      // P1-M01: the server's recommended_categories drive the filter chips.
      ApiService.getAutocomplete(''),
    ]);
    if (mounted) {
      setState(() {
        _products = results[0] as List<Product>;
        _banners = results[1] as List<Map<String, dynamic>>;
        _categories = (results[2] as AutocompleteResult).categories;
        _isLoading = false;
      });
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
            const Text('상품 목록을 불러오지 못했습니다.',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () {
                setState(() => _isLoading = true);
                _loadProducts();
              },
              child: const Text('다시 시도'),
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
                              : '오늘의 추천 상품',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _banners.isNotEmpty && _banners[0]['subtitle'] != null
                              ? _banners[0]['subtitle']
                              : '기획전 소식을 준비하고 있습니다',
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
                          appBar: AppBar(title: const Text('쇼핑 채널')),
                          body: ChannelsView(
                              onAddToCart: widget.onAddToCart)))),
                icon: const Icon(Icons.grid_view_outlined, size: 18),
                label: const Text('카테고리 · 베스트 · 특가',
                    style: TextStyle(fontWeight: FontWeight.bold)),
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
                      label: const Text('전체'),
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
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
        ],
      ),
    );
  }
}
