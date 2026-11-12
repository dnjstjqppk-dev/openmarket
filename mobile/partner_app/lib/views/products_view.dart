// mobile/partner_app/lib/views/products_view.dart
// Wave G2: seller product management — list (one card per product/SKU row,
// mirroring the web console), price/stock quick edit, full detail edit, and
// registration. Pushed inside a Scaffold by the caller (dashboard quick
// actions), following the customer-app pushed-screen convention.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/partner_product.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

String _won(num v) => '₩${NumberFormat('#,###').format(v)}';

class PartnerProductsView extends StatefulWidget {
  const PartnerProductsView({super.key});

  @override
  State<PartnerProductsView> createState() => _PartnerProductsViewState();
}

class _PartnerProductsViewState extends State<PartnerProductsView> {
  final PartnerApiService _api = PartnerApiService();
  List<PartnerProductRow> _rows = [];
  List<Map<String, dynamic>> _categories = [];
  bool _loading = true;
  bool _authReady = false;
  String? _error;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await PartnerAuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (PartnerAuthSession.isAuthenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _api.fetchProducts();
      List<Map<String, dynamic>> cats = _categories;
      try {
        cats = await _api.fetchCategories();
      } catch (_) {
        // Categories only feed the pickers; a failure must not hide products.
      }
      if (mounted) {
        setState(() {
          _rows = rows;
          _categories = cats;
        });
      }
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  List<PartnerProductRow> get _filtered {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _rows;
    return _rows.where((r) {
      return r.title.toLowerCase().contains(q) ||
          r.skuCode.toLowerCase().contains(q) ||
          r.optionSummary.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '상품을 관리하려면 판매자 계정으로 로그인해 주세요.');
    }
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
    final rows = _filtered;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(
              hintText: '상품명·SKU·옵션 검색',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              Text('내 상품 ${rows.length}건',
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
              const Spacer(),
              TextButton.icon(
                onPressed: () => _openCreateSheet(context),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('상품 등록'),
              ),
            ],
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text(
                    _query.trim().isEmpty ? '등록된 상품이 없습니다.' : '검색 결과가 없습니다.',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _rowCard(context, rows[i]),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _rowCard(BuildContext context, PartnerProductRow r) {
    final thumb = r.thumbnailUrl;
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openEditSheet(context, r),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 56,
                  height: 56,
                  child: thumb.isEmpty
                      ? Container(
                          color: Colors.grey.shade200,
                          child: const Icon(Icons.image_not_supported_outlined,
                              color: Colors.grey))
                      : CachedNetworkImage(
                          imageUrl: thumb,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: Colors.grey.shade200),
                          errorWidget: (_, __, ___) => Container(
                              color: Colors.grey.shade200,
                              child: const Icon(Icons.broken_image_outlined,
                                  color: Colors.grey))),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 2),
                    Text('${r.optionSummary} · ${r.skuCode}',
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 11)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text(_won(r.salePrice),
                            style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 15,
                                color: OlmoaColors.lagoon700)),
                        const SizedBox(width: 8),
                        Text('재고 ${NumberFormat('#,###').format(r.stockQuantity)}',
                            style: TextStyle(
                                color: Colors.grey.shade700, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _statusChip(r.displayStatus),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusChip(String label) {
    final Color bg;
    final Color fg;
    switch (label) {
      case '판매중':
        bg = const Color(0xFFE6F4EA);
        fg = const Color(0xFF1E7E34);
        break;
      case '반려됨':
        bg = const Color(0xFFFCE8E6);
        fg = const Color(0xFFC5221F);
        break;
      default:
        bg = const Color(0xFFFFF3DC);
        fg = const Color(0xFF8A5A00);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: TextStyle(
              color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Future<void> _openEditSheet(BuildContext context, PartnerProductRow r) async {
    final title = TextEditingController(text: r.title);
    final sale = TextEditingController(text: r.salePrice.toString());
    final orig = TextEditingController(text: r.originalPrice.toString());
    final stock = TextEditingController(text: r.stockQuantity.toString());
    final thumb = TextEditingController(text: r.thumbnailUrl);
    String? pickedCategoryId;
    for (final c in _categories) {
      if ((c['name'] ?? '').toString() == r.categoryName) {
        pickedCategoryId = (c['id'] ?? '').toString();
        break;
      }
    }
    String? categoryId = pickedCategoryId;
    String? formError;
    bool busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 16,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('${r.title} 수정',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                Text('${r.optionSummary} · ${r.skuCode}',
                    style: TextStyle(
                        color: Colors.grey.shade600, fontSize: 12)),
                const SizedBox(height: 12),
                TextField(
                    controller: title,
                    decoration: const InputDecoration(
                        labelText: '상품명', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: categoryId,
                  decoration: const InputDecoration(
                      labelText: '카테고리', border: OutlineInputBorder()),
                  items: _categories
                      .map((c) => DropdownMenuItem(
                          value: (c['id'] ?? '').toString(),
                          child: Text((c['name'] ?? '').toString())))
                      .toList(),
                  onChanged: (v) => setSheet(() => categoryId = v),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                        child: TextField(
                            controller: sale,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: '판매가(원)',
                                border: OutlineInputBorder()))),
                    const SizedBox(width: 10),
                    Expanded(
                        child: TextField(
                            controller: orig,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: '정상가(원)',
                                border: OutlineInputBorder()))),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                    controller: stock,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: '재고(개)', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: thumb,
                    decoration: const InputDecoration(
                        labelText: '대표 이미지 URL',
                        border: OutlineInputBorder())),
                if (formError != null) ...[
                  const SizedBox(height: 8),
                  Text(formError!,
                      style: const TextStyle(color: Colors.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final saleErr = validateSalePrice(sale.text);
                            final saleV = parseProductInt(sale.text);
                            final origErr = saleV == null
                                ? null
                                : validateOriginalPrice(
                                    orig.text.isEmpty ? sale.text : orig.text,
                                    saleV);
                            final stockErr = validateStock(stock.text);
                            final err = saleErr ??
                                origErr ??
                                stockErr ??
                                (title.text.trim().isEmpty
                                    ? '상품명을 입력해 주세요.'
                                    : null);
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            // Changed fields only; each call is reported like
                            // the web console (never "수정 완료" for a reject).
                            final failures = <String>[];
                            var anyOk = false;
                            final origV = parseProductInt(orig.text.isEmpty
                                ? sale.text
                                : orig.text)!;
                            if (saleV != r.salePrice ||
                                origV != r.originalPrice) {
                              final res = await _api.saveProductPrice(
                                productId: r.id,
                                skuId: r.skuId,
                                salePrice: saleV!,
                                originalPrice: origV,
                              );
                              if (res['ok'] == true) {
                                anyOk = true;
                              } else {
                                failures.add(
                                    '가격: ${res['error'] ?? '저장 실패'}');
                              }
                            }
                            final stockV = parseProductInt(stock.text)!;
                            if (stockV != r.stockQuantity) {
                              final res = await _api.saveProductStock(
                                productId: r.id,
                                skuId: r.skuId,
                                stock: stockV,
                              );
                              if (res['ok'] == true) {
                                anyOk = true;
                              } else {
                                failures.add(
                                    '재고: ${res['error'] ?? '저장 실패'}');
                              }
                            }
                            final detailFields = <String, dynamic>{};
                            if (title.text.trim() != r.title) {
                              detailFields['title'] = title.text.trim();
                            }
                            if (categoryId != null &&
                                categoryId != pickedCategoryId) {
                              detailFields['category_id'] = categoryId;
                            }
                            if (thumb.text.trim() != r.thumbnailUrl) {
                              detailFields['thumbnail_url'] =
                                  thumb.text.trim();
                            }
                            if (detailFields.isNotEmpty) {
                              final res = await _api.saveProductDetail(
                                productId: r.id,
                                fields: detailFields,
                              );
                              if (res['ok'] == true) {
                                anyOk = true;
                              } else {
                                failures.add(
                                    '상세: ${res['error'] ?? '저장 실패'}');
                              }
                            }
                            if (!sheetContext.mounted) return;
                            if (failures.isEmpty) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(anyOk
                                        ? '저장되었습니다.'
                                        : '변경된 내용이 없습니다.')),
                              );
                              if (anyOk) _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError =
                                    '저장 실패 — ${failures.join(' / ')}';
                              });
                              if (anyOk) _load();
                            }
                          },
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : const Text('저장',
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    title.dispose();
    sale.dispose();
    orig.dispose();
    stock.dispose();
    thumb.dispose();
  }

  Future<void> _openCreateSheet(BuildContext context) async {
    final title = TextEditingController();
    final sale = TextEditingController();
    final orig = TextEditingController();
    final stock = TextEditingController(text: '0');
    final thumb = TextEditingController();
    final brand = TextEditingController();
    String? categoryId;
    String? formError;
    bool busy = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 16,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('상품 등록',
                    style:
                        TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const Text('등록된 상품은 운영자 심사 승인 후 판매가 시작됩니다.',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
                const SizedBox(height: 12),
                TextField(
                    controller: title,
                    decoration: const InputDecoration(
                        labelText: '상품명 *', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: categoryId,
                  decoration: const InputDecoration(
                      labelText: '카테고리 *', border: OutlineInputBorder()),
                  items: _categories
                      .map((c) => DropdownMenuItem(
                          value: (c['id'] ?? '').toString(),
                          child: Text((c['name'] ?? '').toString())))
                      .toList(),
                  onChanged: (v) => setSheet(() => categoryId = v),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                        child: TextField(
                            controller: sale,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: '판매가(원) *',
                                border: OutlineInputBorder()))),
                    const SizedBox(width: 10),
                    Expanded(
                        child: TextField(
                            controller: orig,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: '정상가(원)',
                                border: OutlineInputBorder()))),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                    controller: stock,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: '재고(개)', border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: thumb,
                    decoration: const InputDecoration(
                        labelText: '대표 이미지 URL *',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                TextField(
                    controller: brand,
                    decoration: const InputDecoration(
                        labelText: '브랜드(선택)',
                        border: OutlineInputBorder())),
                if (formError != null) ...[
                  const SizedBox(height: 8),
                  Text(formError!,
                      style: const TextStyle(color: Colors.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateCreateProduct(
                              title: title.text,
                              categoryId: categoryId,
                              saleRaw: sale.text,
                              originalRaw: orig.text,
                              stockRaw: stock.text,
                              thumbnailUrl: thumb.text,
                            );
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final saleV = parseProductInt(sale.text)!;
                            final res = await _api.addProduct(
                              createProductPayload(
                                title: title.text,
                                categoryId: categoryId!,
                                salePrice: saleV,
                                originalPrice: orig.text.trim().isEmpty
                                    ? saleV
                                    : parseProductInt(orig.text)!,
                                stockQuantity: parseProductInt(stock.text)!,
                                thumbnailUrl: thumb.text,
                                brand: brand.text,
                              ),
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text(
                                        '상품이 심사 대기 상태로 등록되었습니다.')),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '상품 등록 실패')
                                    .toString();
                              });
                            }
                          },
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : const Text('등록',
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    title.dispose();
    sale.dispose();
    orig.dispose();
    stock.dispose();
    thumb.dispose();
    brand.dispose();
  }
}
