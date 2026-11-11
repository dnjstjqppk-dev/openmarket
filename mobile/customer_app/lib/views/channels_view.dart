// P2-MOB-P3: curated channels — category browser, best sellers and deals.
// Reuses ProductGridCard so channel rows render exactly like the home grid.
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../widgets/product_grid_card.dart';
import '../widgets/responsive.dart';

class ChannelsView extends StatefulWidget {
  final void Function(Product) onAddToCart;

  const ChannelsView({super.key, required this.onAddToCart});

  @override
  State<ChannelsView> createState() => _ChannelsViewState();
}

class _ChannelsViewState extends State<ChannelsView>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TabBar(controller: _tabs, tabs: const [
          Tab(text: '카테고리'),
          Tab(text: '베스트'),
          Tab(text: '특가'),
        ]),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _CategoryBrowser(onAddToCart: widget.onAddToCart),
              _ProductChannel(
                  title: '베스트',
                  emptyText: '베스트 상품을 불러오지 못했습니다.',
                  load: () => ApiService.getProducts(sort: 'popular'),
                  onAddToCart: widget.onAddToCart),
              _ProductChannel(
                  title: '특가',
                  emptyText: '특가 상품이 없습니다.',
                  load: () async {
                    final all =
                        await ApiService.getProducts(sort: 'popular');
                    // No server discount sort exists — deals are the popular
                    // rows carrying a real price gap, filtered client-side.
                    final deals = all
                        .where((p) => p.discountPercent > 0)
                        .toList()
                      ..sort((a, b) =>
                          b.discountPercent.compareTo(a.discountPercent));
                    return deals;
                  },
                  onAddToCart: widget.onAddToCart),
            ],
          ),
        ),
      ],
    );
  }
}

class _CategoryBrowser extends StatefulWidget {
  final void Function(Product) onAddToCart;

  const _CategoryBrowser({required this.onAddToCart});

  @override
  State<_CategoryBrowser> createState() => _CategoryBrowserState();
}

class _CategoryBrowserState extends State<_CategoryBrowser> {
  List<Map<String, dynamic>> _cats = [];
  bool _loading = true;
  String? _error;
  String? _slug;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cats = await ApiService.getCategories();
      if (mounted) setState(() => _cats = cats);
    } catch (_) {
      if (mounted) setState(() => _error = '카테고리를 불러오지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    final roots = _cats.where((c) => c['parent_id'] == null).toList();
    if (_slug == null) {
      if (roots.isEmpty) return const Center(child: Text('카테고리가 없습니다.'));
      return ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: roots.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, i) => Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: Colors.grey.shade200),
          ),
          child: ListTile(
            title: Text((roots[i]['name'] ?? '').toString(),
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            trailing: const Icon(Icons.chevron_right, size: 18),
            onTap: () => setState(() => _slug = (roots[i]['slug'] ?? '').toString()),
          ),
        ),
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(children: [
            TextButton.icon(
              onPressed: () => setState(() => _slug = null),
              icon: const Icon(Icons.arrow_back, size: 16),
              label: const Text('카테고리 목록'),
            ),
          ]),
        ),
        Expanded(
          child: _ProductChannel(
            title: '',
            emptyText: '이 카테고리에 상품이 없습니다.',
            load: () => ApiService.getProducts(categorySlug: _slug),
            onAddToCart: widget.onAddToCart,
          ),
        ),
      ],
    );
  }
}

class _ProductChannel extends StatefulWidget {
  final String title;
  final String emptyText;
  final Future<List<Product>> Function() load;
  final void Function(Product) onAddToCart;

  const _ProductChannel(
      {required this.title,
      required this.emptyText,
      required this.load,
      required this.onAddToCart});

  @override
  State<_ProductChannel> createState() => _ProductChannelState();
}

class _ProductChannelState extends State<_ProductChannel> {
  List<Product> _rows = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.load();
      if (mounted) setState(() => _rows = rows);
    } catch (_) {
      if (mounted) setState(() => _error = '상품을 불러오지 못했습니다.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
          ],
        ),
      );
    }
    if (_rows.isEmpty) return Center(child: Text(widget.emptyText));
    return LayoutBuilder(
      builder: (context, constraints) => GridView.builder(
        key: PageStorageKey('channel-${widget.title}'),
        padding: const EdgeInsets.all(12),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: gridColumnsForWidth(constraints.maxWidth),
          childAspectRatio: 0.68,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemCount: _rows.length,
        itemBuilder: (context, i) => ProductGridCard(
            product: _rows[i], onAddToCart: widget.onAddToCart),
      ),
    );
  }
}
