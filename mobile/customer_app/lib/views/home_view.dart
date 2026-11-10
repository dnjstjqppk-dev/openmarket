// mobile/customer_app/lib/views/home_view.dart
// Temu-style Global E-Commerce Product Feed for Flutter Mobile App

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/search.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/responsive.dart';
import 'product_detail_view.dart';

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
                    (context, index) {
                      final p = _products[index];
                      return InkWell(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ProductDetailView(productId: p.id, onAddToCart: widget.onAddToCart),
                          ),
                        ),
                        child: Card(
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                          side: BorderSide(color: Colors.grey.shade200),
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Stack(
                                children: [
                                  Positioned.fill(
                                    child: Image.network(
                                      p.thumbnailUrl,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) => Container(
                                        color: Colors.grey.shade100,
                                        child: const Icon(Icons.shopping_bag,
                                            size: 40, color: Colors.grey),
                                      ),
                                    ),
                                  ),
                                  if (p.discountPercent > 0)
                                    Positioned(
                                      top: 8,
                                      left: 8,
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(
                                            horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: OlmoaColors.ruby500,
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          '-${p.discountPercent}%',
                                          style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 10,
                                              fontWeight: FontWeight.bold),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            Padding(
                              padding: const EdgeInsets.all(10),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    p.title,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 6),
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.baseline,
                                    textBaseline: TextBaseline.alphabetic,
                                    children: [
                                      Text(
                                        '₩${p.lowestSalePrice.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                                        style: const TextStyle(
                                            color: OlmoaColors.ruby500,
                                            fontSize: 15,
                                            fontWeight: FontWeight.w900),
                                      ),
                                      const SizedBox(width: 4),
                                      if (p.lowestOriginalPrice >
                                          p.lowestSalePrice)
                                        Text(
                                          '₩${p.lowestOriginalPrice.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                                          style: const TextStyle(
                                              color: OlmoaColors.stone500,
                                              fontSize: 10,
                                              decoration:
                                                  TextDecoration.lineThrough),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 8),
                                  SizedBox(
                                    width: double.infinity,
                                    height: 44,
                                    child: ElevatedButton(
                                      onPressed: () => widget.onAddToCart(p),
                                      style: ElevatedButton.styleFrom(
                                        elevation: 0,
                                        padding: EdgeInsets.zero,
                                      ),
                                      child: const Text('장바구니 담기',
                                          style: TextStyle(
                                              fontSize: 12,
                                              fontWeight: FontWeight.bold)),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        ),
                      );
                    },
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
