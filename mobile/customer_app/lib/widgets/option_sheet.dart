// mobile/customer_app/lib/widgets/option_sheet.dart
// Staged option bottom sheet (3-12): pick each attribute in order, completed
// combos land as rows with quantities, and the total feeds one add-to-cart.
// Mirrors the web mobile purchase sheet; the server re-checks stock/prices.

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../models/product_detail.dart';
import '../theme/app_theme.dart';

/// One selected combination with its quantity.
class SheetRow {
  final ProductSku sku;
  int qty;

  SheetRow({required this.sku, this.qty = 1});
}

/// Values of attribute [stage] mapped to in-stock availability, narrowed by
/// the earlier picks in [selection]. Stages unlock in order on the sheet.
Map<String, bool> stageAvailability(
    ProductDetail detail, int stage, Map<String, String> selection) {
  final attr = detail.attributes[stage];
  final prior = {
    for (var i = 0; i < stage; i++)
      detail.attributes[i].name: selection[detail.attributes[i].name]
  };
  final out = <String, bool>{};
  for (final value in attr.values) {
    var any = false;
    var stocked = false;
    for (final sku in detail.skus) {
      final opts = parseOptionMap(sku.optionCombinationJson);
      if (opts[attr.name] != value) continue;
      var ok = true;
      for (final e in prior.entries) {
        if (e.value == null || opts[e.key] != e.value) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      any = true;
      if (sku.stockQuantity > 0) stocked = true;
    }
    if (any) out[value] = stocked;
  }
  return out;
}

/// '빨강 / M' in attribute order for row labels.
String skuSummary(ProductSku sku, List<OptionAttribute> attrs) {
  final opts = parseOptionMap(sku.optionCombinationJson);
  final parts = [
    for (final a in attrs)
      if ((opts[a.name] ?? '').isNotEmpty) opts[a.name]!
  ];
  return parts.join(' / ');
}

/// Appends [sku] as a row, or bumps the existing row capped at stock.
List<SheetRow> addRow(List<SheetRow> rows, ProductSku sku) {
  final next = [...rows];
  for (final r in next) {
    if (r.sku.id == sku.id) {
      if (r.qty < sku.stockQuantity) r.qty += 1;
      return next;
    }
  }
  next.add(SheetRow(sku: sku));
  return next;
}

class OptionSheet extends StatefulWidget {
  final ProductDetail detail;
  final void Function(List<SheetRow> rows) onSubmit;

  const OptionSheet({super.key, required this.detail, required this.onSubmit});

  @override
  State<OptionSheet> createState() => _OptionSheetState();
}

class _OptionSheetState extends State<OptionSheet> {
  final Map<String, String> _selection = {};
  List<SheetRow> _rows = [];

  @override
  void initState() {
    super.initState();
    // Option-less goods (one SKU) start with their single row, like the web.
    if (widget.detail.attributes.isEmpty && widget.detail.skus.length == 1) {
      final only = widget.detail.skus.single;
      if (only.stockQuantity > 0) _rows = [SheetRow(sku: only)];
    }
  }

  void _pick(int stage, String value) {
    setState(() {
      // Changing an earlier stage clears everything chosen after it.
      for (var i = stage; i < widget.detail.attributes.length; i++) {
        _selection.remove(widget.detail.attributes[i].name);
      }
      _selection[widget.detail.attributes[stage].name] = value;
      final matched = widget.detail.skuForSelection(_selection);
      if (matched != null && matched.stockQuantity > 0) {
        _rows = addRow(_rows, matched);
        _selection.clear();
      }
    });
  }

  String _won(int v) => '₩${v.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

  @override
  Widget build(BuildContext context) {
    final d = widget.detail;
    final total = _rows.fold(0, (sum, r) => sum + r.sku.salePrice * r.qty);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
            left: 20, right: 20, top: 12, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: OlmoaColors.stone300,
                      borderRadius: BorderRadius.circular(2))),
            ),
            const SizedBox(height: 12),
            const Text('옵션 선택',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            const SizedBox(height: 12),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (var i = 0; i < d.attributes.length; i++) ...[
                    Text(d.attributes[i].name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 8),
                    Builder(builder: (context) {
                      final unlocked = i == 0 ||
                          d.attributes
                              .take(i)
                              .every((a) => _selection[a.name] != null);
                      if (!unlocked) {
                        return const Text('이전 옵션을 먼저 선택해 주세요.',
                            style: TextStyle(
                                fontSize: 12, color: OlmoaColors.soldout));
                      }
                      final avail = stageAvailability(d, i, _selection);
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final entry in avail.entries)
                            ChoiceChip(
                              label: Text(entry.key),
                              selected:
                                  _selection[d.attributes[i].name] == entry.key,
                              onSelected: entry.value
                                  ? (_) => _pick(i, entry.key)
                                  : null,
                            ),
                        ],
                      );
                    }),
                    const SizedBox(height: 12),
                  ],
                  for (final r in _rows)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: OlmoaColors.stone50,
                        borderRadius:
                            BorderRadius.circular(OlmoaRadii.md),
                        border: Border.all(color: OlmoaColors.stone200),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(skuSummary(r.sku, d.attributes),
                                    style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700)),
                                const SizedBox(height: 4),
                                Text(_won(r.sku.salePrice * r.qty),
                                    style: const TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w900,
                                        color: OlmoaColors.price)),
                              ],
                            ),
                          ),
                          IconButton(
                            tooltip: '수량 감소',
                            onPressed: r.qty > 1
                                ? () => setState(() => r.qty -= 1)
                                : null,
                            icon: const Icon(Icons.remove_circle_outline,
                                size: 22),
                          ),
                          Text('${r.qty}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 14)),
                          IconButton(
                            tooltip: '수량 증가',
                            onPressed: r.qty < r.sku.stockQuantity
                                ? () => setState(() => r.qty += 1)
                                : null,
                            icon: const Icon(Icons.add_circle_outline,
                                size: 22),
                          ),
                          IconButton(
                            tooltip: '행 삭제',
                            onPressed: () => setState(() =>
                                _rows = _rows.where((x) => x != r).toList()),
                            icon: const Icon(Icons.close, size: 18),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('총 상품금액',
                    style:
                        TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                Text(_won(total),
                    style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 18,
                        color: OlmoaColors.price)),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _rows.isEmpty
                    ? null
                    : () {
                        Navigator.pop(context);
                        widget.onSubmit(_rows);
                      },
                child: Text(
                    _rows.isEmpty ? '옵션을 선택해 주세요' : '장바구니 담기',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
