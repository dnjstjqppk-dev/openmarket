// mobile/customer_app/lib/views/product_detail_view.dart
// Buyer product detail: gallery image, price, rating, option selection over the
// real SKU matrix, stock and volume discounts. The orderable SKU is resolved
// from the selected options — never invented, never defaulted silently.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/product_detail.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/product_grid_card.dart';

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
  // P2-MOB-P2: wishlist toggle state (server is the source of truth).
  bool _wished = false;
  bool _wishBusy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _toggleWish() async {
    if (_wishBusy) return;
    setState(() => _wishBusy = true);
    final r = await ApiService.toggleWishlist(widget.productId);
    if (!mounted) return;
    setState(() => _wishBusy = false);
    if (r['success'] == true) {
      setState(() => _wished = r['wished'] == true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(r['wished'] == true ? '찜 목록에 담았습니다.' : '찜을 해제했습니다.'),
            duration: const Duration(seconds: 1)),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((r['error'] ?? '찜하기에 실패했습니다.').toString())),
      );
    }
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
      // H-3: co-view signal (silent; the server dedups per user+product+day).
      ApiService.logProductView(widget.productId);
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
      appBar: AppBar(
        title: const Text('상품 상세'),
        actions: [
          IconButton(
            tooltip: _wished ? '찜 해제' : '찜하기',
            onPressed: _wishBusy ? null : _toggleWish,
            icon: Icon(_wished ? Icons.favorite : Icons.favorite_border,
                color: _wished ? OlmoaColors.ruby500 : null),
          ),
        ],
      ),
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
            child: p.thumbnailUrl.isEmpty
                ? Container(color: Colors.grey.shade100, child: const Icon(Icons.shopping_bag, size: 64, color: Colors.grey))
                : CachedNetworkImage(
                    imageUrl: p.thumbnailUrl,
                    fit: BoxFit.cover,
                    placeholder: (_, __) => Container(color: Colors.grey.shade100),
                    errorWidget: (_, __, ___) => Container(color: Colors.grey.shade100, child: const Icon(Icons.shopping_bag, size: 64, color: Colors.grey))),
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
        // P2-MOB-P2: reviews + Q&A live on the detail page, not just a count.
        _ReviewsSection(productId: widget.productId),
        _QnaSection(productId: widget.productId),
        // H-3: server-ranked related products (hidden while empty).
        _RelatedSection(
            productId: widget.productId, onAddToCart: widget.onAddToCart),
        const SizedBox(height: 24),
      ],
    );
  }
}

class _ReviewsSection extends StatefulWidget {
  final String productId;

  const _ReviewsSection({required this.productId});

  @override
  State<_ReviewsSection> createState() => _ReviewsSectionState();
}

class _ReviewsSectionState extends State<_ReviewsSection> {
  List<Map<String, dynamic>> _rows = [];
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
      final r = await ApiService.getReviews(widget.productId);
      final List<dynamic> list = (r['data'] is Map ? r['data']['reviews'] : r['data']) ?? [];
      if (mounted) {
        setState(() =>
            _rows = list.map((e) => Map<String, dynamic>.from(e as Map)).toList());
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _write() async {
    final content = TextEditingController();
    int rating = 5;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          title: const Text('리뷰 작성'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 1; i <= 5; i++)
                    IconButton(
                      onPressed: () => setDialog(() => rating = i),
                      icon: Icon(i <= rating ? Icons.star : Icons.star_border,
                          color: Colors.amber),
                    ),
                ],
              ),
              TextField(
                  controller: content,
                  decoration:
                      const InputDecoration(labelText: '리뷰 내용 (10자 이상)'),
                  maxLines: 3),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('취소')),
            TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('등록')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    if (content.text.trim().length < 10) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('리뷰는 10자 이상 입력해 주세요.')),
      );
      return;
    }
    final r = await ApiService.submitReview(
        productId: widget.productId,
        rating: rating,
        content: content.text.trim());
    if (!mounted) return;
    if (r['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('리뷰가 등록되었습니다.')),
      );
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content:
                Text((r['error'] ?? '리뷰 등록에 실패했습니다.').toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 32),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('리뷰 ${_rows.length}개',
                style:
                    const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
            TextButton(onPressed: _write, child: const Text('리뷰 쓰기')),
          ],
        ),
        if (_loading)
          const Center(
              child: Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator()))
        else if (_error != null)
          Text(_error!, style: const TextStyle(fontSize: 12, color: Colors.red))
        else if (_rows.isEmpty)
          const Text('아직 등록된 리뷰가 없습니다.',
              style: TextStyle(fontSize: 12, color: Colors.grey))
        else
          for (final r in _rows.take(5))
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: Colors.grey.shade200),
              ),
              child: ListTile(
                title: Text(
                    '${'★' * ((r['rating'] as num?)?.toInt() ?? 0)} ${(r['author_name'] ?? r['reviewer_name'] ?? '').toString()}',
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.bold)),
                subtitle: Text((r['content'] ?? '').toString(),
                    style: const TextStyle(fontSize: 13)),
              ),
            ),
      ],
    );
  }
}

class _QnaSection extends StatefulWidget {
  final String productId;

  const _QnaSection({required this.productId});

  @override
  State<_QnaSection> createState() => _QnaSectionState();
}

class _QnaSectionState extends State<_QnaSection> {
  List<Map<String, dynamic>> _rows = [];
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
      final rows = await ApiService.getQna(widget.productId);
      if (mounted) setState(() => _rows = rows);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _ask() async {
    final question = TextEditingController();
    bool secret = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          title: const Text('상품 문의'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                  controller: question,
                  decoration: const InputDecoration(labelText: '궁금한 점을 입력해 주세요'),
                  maxLines: 3),
              Row(children: [
                Checkbox(
                    value: secret,
                    onChanged: (v) => setDialog(() => secret = v ?? false)),
                const Text('비밀글', style: TextStyle(fontSize: 13)),
              ]),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('취소')),
            TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('등록')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    if (question.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('문의 내용을 입력해 주세요.')),
      );
      return;
    }
    final r = await ApiService.askQuestion(
        productId: widget.productId,
        question: question.text.trim(),
        isSecret: secret);
    if (!mounted) return;
    if (r['success'] == true) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('문의가 등록되었습니다.')),
      );
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content:
                Text((r['error'] ?? '문의 등록에 실패했습니다.').toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 32),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('상품 문의 ${_rows.length}개',
                style:
                    const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
            TextButton(onPressed: _ask, child: const Text('문의하기')),
          ],
        ),
        if (_loading)
          const Center(
              child: Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator()))
        else if (_error != null)
          Text(_error!, style: const TextStyle(fontSize: 12, color: Colors.red))
        else if (_rows.isEmpty)
          const Text('등록된 문의가 없습니다.',
              style: TextStyle(fontSize: 12, color: Colors.grey))
        else
          for (final q in _rows.take(5))
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: Colors.grey.shade200),
              ),
              child: ExpansionTile(
                title: Text((q['question'] ?? '').toString(),
                    style: const TextStyle(fontSize: 13)),
                subtitle: Text(
                    (q['answer'] ?? '').toString().isNotEmpty
                        ? '답변 완료'
                        : '답변 대기',
                    style: const TextStyle(fontSize: 11)),
                children: [
                  if ((q['answer'] ?? '').toString().isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text((q['answer'] ?? '').toString(),
                            style: const TextStyle(fontSize: 13)),
                      ),
                    ),
                ],
              ),
            ),
      ],
    );
  }
}

class _RelatedSection extends StatefulWidget {
  final String productId;
  final void Function(Product) onAddToCart;

  const _RelatedSection({required this.productId, required this.onAddToCart});

  @override
  State<_RelatedSection> createState() => _RelatedSectionState();
}

class _RelatedSectionState extends State<_RelatedSection> {
  List<Product> _rows = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final rows =
        await ApiService.getRelatedProducts(widget.productId, limit: 6);
    if (mounted) setState(() => _rows = rows);
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 32),
        const Text('연관 상품',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
        const SizedBox(height: 8),
        SizedBox(
          height: 240,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _rows.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (context, i) => SizedBox(
              width: 160,
              child: ProductGridCard(
                  product: _rows[i], onAddToCart: widget.onAddToCart),
            ),
          ),
        ),
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
