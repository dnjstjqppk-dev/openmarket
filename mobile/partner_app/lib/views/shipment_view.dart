// mobile/partner_app/lib/views/shipment_view.dart
// Partner Mobile Shipment Management View

import 'package:flutter/material.dart';
import '../models/sub_order.dart';
import '../services/partner_api_service.dart';

class PartnerShipmentView extends StatefulWidget {
  const PartnerShipmentView({super.key});

  @override
  State<PartnerShipmentView> createState() => _PartnerShipmentViewState();
}

class _PartnerShipmentViewState extends State<PartnerShipmentView> {
  final PartnerApiService _apiService = PartnerApiService();
  List<SubOrder> _orders = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    final list = await _apiService.fetchPartnerOrders();
    if (mounted) {
      setState(() {
        _orders = list;
        _isLoading = false;
      });
    }
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
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
            ElevatedButton(
              onPressed: () async {
                final tracking = controller.text.trim();
                if (tracking.isNotEmpty) {
                  await _apiService.updateTracking(
                    subOrderId: order.id,
                    carrier: 'CJ대한통운',
                    trackingNo: tracking,
                  );
                  setState(() {
                    order.status = 'SHIPPED';
                    order.trackingNumber = tracking;
                  });
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('[${order.subOrderNo}] 출고 및 송장 등록 완료')),
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
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFF4F46E5)));
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
                    Text(order.subOrderNo, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.blueGrey)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: isShipped ? Colors.blue.shade50 : Colors.amber.shade50,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        isShipped ? '배송중' : '결제확인(미출고)',
                        style: TextStyle(
                          color: isShipped ? Colors.blue.shade700 : Colors.amber.shade800,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(order.productTitle, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 4),
                Text('수량: ${order.quantity}개 / 결제액: ₩${order.totalAmount.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                const Divider(height: 20),
                Align(
                  alignment: Alignment.centerRight,
                  child: isShipped
                      ? Text('운송장: ${order.trackingNumber}', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo, fontSize: 12))
                      : ElevatedButton(
                          onPressed: () => _dispatchOrder(order),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF4F46E5),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                          ),
                          child: const Text('운송장 입력 및 출고', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
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
