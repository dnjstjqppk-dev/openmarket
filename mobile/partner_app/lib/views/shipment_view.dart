// mobile/partner_app/lib/views/shipment_view.dart
// Partner Mobile Shipment Management View

import 'package:flutter/material.dart';
import '../models/sub_order.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

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
        return AlertDialog(
          title: const Text('운송장 번호 입력'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: 'CJ대한통운 운송장 번호',
              hintText: '숫자 11자리 입력',
            ),
            keyboardType: TextInputType.number,
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
            ElevatedButton(
              onPressed: () async {
                final tracking = controller.text.trim();
                if (tracking.isEmpty) return;
                final r = await _apiService.updateTracking(
                  subOrderId: order.id,
                  carrier: 'CJ대한통운',
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
    if (_orders.isEmpty) {
      return const Center(
        child: Text('출고할 주문이 없습니다.',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _orders.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final order = _orders[index];
        final isShipped = order.status == 'SHIPPED';
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
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: isShipped
                            ? OlmoaColors.infoSoft
                            : OlmoaColors.warningSoft,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isShipped ? '배송중' : '결제확인(미출고)',
                        style: TextStyle(
                          color: isShipped
                              ? OlmoaColors.info
                              : OlmoaColors.warning,
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
                const Divider(height: 20),
                Align(
                  alignment: Alignment.centerRight,
                  child: isShipped
                      ? Text('운송장: ${order.trackingNumber}',
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: OlmoaColors.lagoon700,
                              fontSize: 12))
                      : ElevatedButton(
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
            ),
          ),
        );
      },
    );
  }
}
