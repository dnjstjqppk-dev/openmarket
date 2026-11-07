// mobile/customer_app/lib/views/product_detail_view.dart
// Buyer product detail: gallery image, price, rating, option selection over the
// real SKU matrix, stock and volume discounts. The orderable SKU is resolved
// from the selected options — never invented, never defaulted silently.

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/product_detail.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class ProductDetailView extends StatefulWidget {
  final String productId;
  final void Function(Product) onAddToCart;

  const ProductDetailView({super.key, required this.productId, required this.onAddToCart});

  @override
  State<ProductDetailView> createState() => _ProductDetailViewState();
}

class _ProductDetailViewState extends State<ProductDetailView> {
  ProductDetail? _detail;
  String? _error;
  final Map<String, String> _selection = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _detail = null;
      _error = null;
    });
    try {
      final d = await ApiService.getProductDetail(widget.productId);
      if (!mounted) return;
      setState(() {
        _detail = d;
        // A single possible combination is preselected so quick-add keeps working.
        if (d.attributes.length == 1 && d.attributes.single.values.length == 1) {
          _selection[d.attributes.single.name] = d.attributes.single.values.single;
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    }
  }

  String _won(int v) => '₩${v.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

  String _stripTags(String html) => html.replaceAll(RegExp(r'<[^>]*>'), '').replaceAll(RegExp(r'\s+'), ' ').trim();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('상품 상세')),
      body: _buildBody(),
      bottomNavigationBar: _DetailBottomBar(
        detail: _detail,
        selection: _selection,
        onAdd: (skuId) {
          final d = _detail;
          if (d == null) return;
          widget.onAddToCart(d.product.copyWith(defaultSkuId: skuId));
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('[${d.product.title}] 장바구니에 담겼습니다.'), duration: const Duration(seconds: 1)),
          );
        },
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(_error!, style: const TextStyle(fontSize: 13)),
          const SizedBox(height: 12),
          ElevatedButton(onPressed: _load, child: const Text('다시 시도')),
        ]),
      );
    }
    final d = _detail;
    if (d == null) return const Center(child: CircularProgressIndicator());
    final p = d.product;
    final matched = d.skuForSelection(_selection);
    final price = matched?.salePrice ?? p.lowestSalePrice;
    final original = matched?.originalPrice ?? p.lowestOriginalPrice;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: AspectRatio(
            aspectRatio: 1,
            child: Image.network(p.thumbnailUrl,
                fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: Colors.grey.shade100, child: const Icon(Icons.shopping_bag, size: 64, color: Colors.grey))),
          ),
        ),
        const SizedBox(height: 12),
        Text(p.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        if (p.businessName.isNotEmpty)
          Text(p.businessName, style: const TextStyle(color: OlmoaColors.stone500, fontSize: 12)),
        const SizedBox(height: 8),
        Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
          Text(_won(price), style: const TextStyle(color: OlmoaColors.ruby500, fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(width: 8),
          if (original > price)
            Text(_won(original), style: const TextStyle(color: OlmoaColors.stone500, fontSize: 13, decoration: TextDecoration.lineThrough)),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          if (d.avgRating != null) ...[
            const Icon(Icons.star, size: 16, color: Colors.amber),
            const SizedBox(width: 4),
            Text(d.avgRating!.toStringAsFixed(1), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(width: 4),
            Text('리뷰 ${d.reviewCount}개', style: const TextStyle(color: Colors.grey, fontSize: 12)),
            const SizedBox(width: 12),
          ],
          Text('누적 판매 ${p.totalSoldCount}개', style: const TextStyle(color: Colors.grey, fontSize: 12)),
        ]),
        if (d.volumeDiscounts.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: d.volumeDiscounts.map((v) => Chip(label: Text(v.label, style: const TextStyle(fontSize: 11)), visualDensity: VisualDensity.compact)).toList(),
          ),
        ],
        const Divider(height: 32),
        ...d.attributes.map((attr) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(attr.name, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: attr.values
                    .map((v) => ChoiceChip(
                          label: Text(v),
                          selected: _selection[attr.name] == v,
                          onSelected: (_) => setState(() => _selection[attr.name] = v),
                        ))
                    .toList(),
              ),
              const SizedBox(height: 16),
            ])),
        if (matched != null)
          Text(matched.stockQuantity > 0 ? '재고 ${matched.stockQuantity}개' : '선택한 옵션은 품절입니다.',
              style: TextStyle(color: matched.stockQuantity > 0 ? Colors.grey : OlmoaColors.ruby500, fontSize: 12)),
        if (p.descriptionHtml.isNotEmpty) ...[
          const Divider(height: 32),
          const Text('상품 설명', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
          const SizedBox(height: 8),
          Text(_stripTags(p.descriptionHtml), style: const TextStyle(fontSize: 13, height: 1.6)),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}

class _DetailBottomBar extends StatelessWidget {
  final ProductDetail? detail;
  final Map<String, String> selection;
  final void Function(String skuId) onAdd;

  const _DetailBottomBar({required this.detail, required this.selection, required this.onAdd});

  @override
  Widget build(BuildContext context) {
    final d = detail;
    final matched = d?.skuForSelection(selection);
    final canBuy = matched != null && matched.stockQuantity > 0 && matched.id.isNotEmpty;
    final label = d == null
        ? '불러오는 중...'
        : d.skus.isEmpty
            ? '판매 중인 옵션이 없습니다'
            : matched == null
                ? '옵션을 선택해 주세요'
                : matched.stockQuantity <= 0
                    ? '선택한 옵션은 품절입니다'
                    : '장바구니 담기';
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, -4))]),
        child: SizedBox(
          width: double.infinity,
          height: 48,
          child: ElevatedButton(
            onPressed: canBuy ? () => onAdd(matched.id) : null,
            style: ElevatedButton.styleFrom(elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
            child: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          ),
        ),
      ),
    );
  }
}
