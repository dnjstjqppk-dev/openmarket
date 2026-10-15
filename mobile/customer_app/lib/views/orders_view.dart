// mobile/customer_app/lib/views/orders_view.dart
// Customer Order History and Tracking Screen for Flutter App

import 'package:flutter/material.dart';

class OrdersView extends StatelessWidget {
  const OrdersView({super.key});

  @override
  Widget build(BuildContext context) {
    final mockOrders = [
      {
        'no': 'ORD20261015-8841',
        'date': '2026-10-15 16:42',
        'product': '초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3',
        'amount': 49900,
        'status': '배송준비중',
        'carrier': 'CJ대한통운 68910294821',
      },
      {
        'no': 'ORD20261014-1120',
        'date': '2026-10-14 11:20',
        'product': '울트라 슬림 65W GaN 고속 충전기 3포트',
        'amount': 24500,
        'status': '배송완료',
        'carrier': '우체국택배 44810293810',
      },
    ];

    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: mockOrders.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final order = mockOrders[index];
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
                    Text(order['no'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.blueGrey)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: order['status'] == '배송완료' ? Colors.grey.shade100 : Colors.orange.shade50,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        order['status'] as String,
                        style: TextStyle(
                          color: order['status'] == '배송완료' ? Colors.grey.shade700 : const Color(0xFFFA541C),
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(order['product'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 6),
                Text('₩${(order['amount'] as int).toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}', style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                const Divider(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(order['carrier'] as String, style: TextStyle(color: Colors.grey.shade600, fontSize: 11)),
                    Text(order['date'] as String, style: TextStyle(color: Colors.grey.shade400, fontSize: 11)),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

