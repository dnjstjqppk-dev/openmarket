// mobile/partner_app/lib/views/shipment_view.dart
// Partner Mobile Shipment Management View

import 'package:flutter/material.dart';
import '../models/sub_order.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

/// Carrier list mirrors the web seller console (ShipmentView carrierOptions).
/// Kept in sync by test/carrier_options_test.dart.
const shipmentCarrierOptions = [
  'CJ대한통운 국제특송',
  'DHL Express',
  'FedEx International',
  '우체국 국제특송 (EMS)',
  '차이냐오 글로벌 (Cainiao)',
  '순풍 익스프레스 (SF Express)',
  '한진 국제특송',
  'CJ대한통운',
  '우체국택배',
  '한진택배',
  '롯데택배',
  '로젠택배',
  '경동택배',
];

class PartnerShipmentView extends StatefulWidget {
  const PartnerShipmentView({super.key});

  @override
  State<PartnerShipmentView> createState() => _PartnerShipmentViewState();
}

class _PartnerShipmentViewState extends State<PartnerShipmentView> {
  final PartnerApiService _apiService = PartnerApiService();
  List<SubOrder> _orders = [];
  bool _isLoading = true;
  bool _authReady = false;
  String? _error;
  String _filter = 'ALL';
  String _query = '';

  List<SubOrder> get _filtered {
    final q = _query.trim().toLowerCase();
    return _orders.where((o) {
      if (_filter != 'ALL' && o.filterBucket != _filter) return false;
      if (q.isEmpty) return true;
      return o.subOrderNo.toLowerCase().contains(q) ||
          o.productTitle.toLowerCase().contains(q) ||
          o.trackingNumber.toLowerCase().contains(q);
    }).toList();
  }

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await PartnerAuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (PartnerAuthSession.isAuthenticated) _loadOrders();
  }

  Future<void> _loadOrders() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final list = await _apiService.fetchPartnerOrders();
      if (mounted) setState(() => _orders = list);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _isLoading = false);
  }

  void _dispatchOrder(SubOrder order) {
    showDialog(
      context: context,
      builder: (ctx) {
        final controller = TextEditingController();
        String carrier = shipmentCarrierOptions.first;
        return StatefulBuilder(
          builder: (ctx, setDialogState) => AlertDialog(
            title: const Text('운송장 번호 입력'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: carrier,
                  items: shipmentCarrierOptions
                      .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) setDialogState(() => carrier = v);
                  },
                  decoration: const InputDecoration(labelText: '택배사'),
                ),
                TextField(
                  controller: controller,
                  decoration: const InputDecoration(
                    labelText: '운송장 번호',
                    hintText: '예: 123456789012 또는 9723810465',
                    helperText: '영문·숫자·하이픈 6-40자 (DHL·FedEx 포함)',
                  ),
                  // P2-MOB-02: alphanumerics allowed (was number-only).
                  keyboardType: TextInputType.text,
                ),
              ],
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
              ElevatedButton(
                onPressed: () async {
                  final tracking = controller.text.trim();
                  if (tracking.isEmpty) return;
                  // Server rule (partner.js ship): alphanumerics + hyphen, 6-40.
                  if (!RegExp(r'^[A-Za-z0-9-]{6,40}$').hasMatch(tracking)) {
                    if (!ctx.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text(
                              '송장번호 형식이 올바르지 않습니다 (영문·숫자·하이픈 6-40자).')),
                    );
                    return;
                  }
                  final r = await _apiService.updateTracking(
                    subOrderId: order.id,
                    carrier: carrier,
                    trackingNo: tracking,
                  );
                if (!ctx.mounted) return;
                Navigator.pop(ctx);
                if (!mounted) return;
                if (r['ok'] == true) {
                  setState(() {
                    order.status = 'SHIPPED';
                    order.trackingNumber =
                        (r['tracking_number'] ?? tracking).toString();
                  });
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text('[${order.subOrderNo}] 출고 및 송장 등록 완료')),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content:
                            Text((r['error'] ?? '출고 처리에 실패했습니다.').toString())),
                  );
                }
              },
              child: const Text('출고 완료'),
            ),
          ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '출고 관리를 하려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _loadOrders,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      );
    }
    final rows = _filtered;
    return Column(
      children: [
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            itemCount: SubOrder.filterBuckets.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final key = SubOrder.filterBuckets.keys.elementAt(i);
              return ChoiceChip(
                label: Text(SubOrder.filterBuckets[key]!),
                selected: _filter == key,
                onSelected: (_) => setState(() => _filter = key),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(
              hintText: '주문번호·상품·송장 검색',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? const Center(
                  child: Text('해당 주문이 없습니다.',
                      style: TextStyle(
                          fontSize: 14, fontWeight: FontWeight.bold)),
                )
              : RefreshIndicator(
                  onRefresh: _loadOrders,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) =>
                        _orderCard(context, rows[index]),
                  ),
                ),
        ),
      ],
    );
  }

  Color _badgeBg(SubOrder order) {
    if (order.shippable) return OlmoaColors.warningSoft;
    if (order.inTransit) return OlmoaColors.infoSoft;
    if (order.status == 'DELIVERED' || order.status == 'PURCHASE_CONFIRMED') {
      return const Color(0xFFE6F4EA);
    }
    return Colors.grey.shade200;
  }

  Color _badgeFg(SubOrder order) {
    if (order.shippable) return OlmoaColors.warning;
    if (order.inTransit) return OlmoaColors.info;
    if (order.status == 'DELIVERED' || order.status == 'PURCHASE_CONFIRMED') {
      return const Color(0xFF1E7E34);
    }
    return Colors.grey.shade700;
  }

  Widget _orderCard(BuildContext context, SubOrder order) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(order.subOrderNo,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: Colors.blueGrey)),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: _badgeBg(order),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    order.statusLabel,
                    style: TextStyle(
                      color: _badgeFg(order),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(order.productTitle,
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 14)),
            const SizedBox(height: 4),
            Text(
                '수량: ${order.quantity}개 / 결제액: ₩${order.totalAmount.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                style:
                    TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            if (order.trackingNumber.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text('운송장: ${order.trackingNumber}',
                  style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      color: OlmoaColors.lagoon700,
                      fontSize: 12)),
            ],
            // P1-M07: dispatch only before shipment; terminal rows show no button.
            if (order.shippable) ...[
              const Divider(height: 20),
              Align(
                alignment: Alignment.centerRight,
                child: ElevatedButton(
                  onPressed: () => _dispatchOrder(order),
                  style: ElevatedButton.styleFrom(
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text('운송장 입력 및 출고',
                      style: TextStyle(
                          fontSize: 12, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
