// mobile/partner_app/lib/views/dashboard_view.dart
// Partner Mobile Executive Dashboard View

import 'package:flutter/material.dart';

class PartnerDashboardView extends StatelessWidget {
  final VoidCallback onNavigateToShipments;

  const PartnerDashboardView({super.key, required this.onNavigateToShipments});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Welcome Card
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(colors: [Color(0xFF312E81), Color(0xFF4F46E5)]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Global Direct Logistics Ltd.', style: TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 6),
              const Text('판매자 운영 현황', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _statItem('오늘 매출', '₩14,250,000'),
                  _statItem('신규 주문', '18건'),
                  _statItem('출고 대기', '42건'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Quick Actions
        const Text('빠른 작업', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.black87)),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: onNavigateToShipments,
                icon: const Icon(Icons.local_shipping, color: Color(0xFF4F46E5)),
                label: const Text('운송장 등록', style: TextStyle(color: Color(0xFF4F46E5))),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(color: Color(0xFF4F46E5)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('정산 명세서가 다운로드되었습니다.')),
                  );
                },
                icon: const Icon(Icons.account_balance_wallet),
                label: const Text('정산 조회'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF4F46E5),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _statItem(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white60, fontSize: 11)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900)),
      ],
    );
  }
}
