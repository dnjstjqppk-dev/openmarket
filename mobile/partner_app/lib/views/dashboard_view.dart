// mobile/partner_app/lib/views/dashboard_view.dart
// Seller dashboard bound to GET /api/v1/partner/metrics (flat response).
// Every figure is a live server aggregate; failures show a retry state.

import 'package:flutter/material.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'bidding_view.dart';
import 'channels_view.dart';
import 'login_view.dart';
import 'products_view.dart';
import 'profile_view.dart';
import 'qna_view.dart';
import 'returns_view.dart';

class PartnerDashboardView extends StatefulWidget {
  final VoidCallback onNavigateToShipments;
  final VoidCallback onNavigateToSettlements;

  const PartnerDashboardView(
      {super.key,
      required this.onNavigateToShipments,
      required this.onNavigateToSettlements});

  @override
  State<PartnerDashboardView> createState() => _PartnerDashboardViewState();
}

class _PartnerDashboardViewState extends State<PartnerDashboardView> {
  final PartnerApiService _api = PartnerApiService();
  Map<String, dynamic>? _metrics;
  String? _error;
  bool _loading = true;
  bool _authReady = false;

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
      final m = await _api.fetchDashboardMetrics();
      if (mounted) setState(() => _metrics = m);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '운영 현황을 보려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_error!, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _load,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      );
    }
    final m = _metrics ?? {};
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
                colors: [OlmoaColors.lagoon900, OlmoaColors.lagoon500]),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                  (m['business_name'] ?? PartnerAuthSession.businessName ?? '')
                      .toString(),
                  style: const TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 6),
              const Text('판매자 운영 현황',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _statItem('누적 매출', '₩${m['total_sales_amount'] ?? 0}'),
                  _statItem('주문', '${m['orders_count'] ?? 0}건'),
                  _statItem('출고 대기', '${m['to_ship_count'] ?? 0}건'),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _statItem('등록 상품', '${m['products_count'] ?? 0}개'),
                  _statItem(
                      '정산 예정', '₩${m['settlement_expected_amount'] ?? 0}'),
                  _statItem('미답변 Q&A', '${m['waiting_qna_count'] ?? 0}건'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const Text('판매 관리',
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Colors.black87)),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.05,
          children: [
            _manageTile(context, Icons.inventory_2_outlined, '상품 관리',
                '상품 관리', const PartnerProductsView()),
            _manageTile(context, Icons.assignment_return_outlined, '반품·교환',
                '반품·교환', const PartnerReturnsView()),
            _manageTile(context, Icons.question_answer_outlined, 'Q&A',
                '상품 Q&A', const PartnerQnaView()),
            _manageTile(context, Icons.gavel_outlined, '입찰·네고',
                '입찰·네고', const PartnerBiddingView()),
            _manageTile(context, Icons.hub_outlined, '멀티채널',
                '멀티채널', const PartnerChannelsView()),
            _manageTile(context, Icons.badge_outlined, '프로필',
                '판매자 프로필', const PartnerProfileView()),
          ],
        ),
        const SizedBox(height: 20),
        const Text('빠른 작업',
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Colors.black87)),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: widget.onNavigateToShipments,
                icon: const Icon(Icons.local_shipping,
                    color: OlmoaColors.lagoon600),
                label: const Text('운송장 등록',
                    style: TextStyle(color: OlmoaColors.lagoon700)),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(color: OlmoaColors.lagoon600),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: () => widget.onNavigateToSettlements(),
                icon: const Icon(Icons.account_balance_wallet),
                label: const Text('정산 내역'),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  /// Pushed screens are Scaffold-less bodies; the push site wraps them
  /// (customer-app convention).
  void _go(BuildContext context, String title, Widget view) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: view,
      ),
    ));
  }

  Widget _manageTile(BuildContext context, IconData icon, String label,
      String title, Widget view) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => _go(context, title, view),
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(color: Colors.grey.shade300),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: OlmoaColors.lagoon600, size: 26),
            const SizedBox(height: 6),
            Text(label,
                style: const TextStyle(
                    fontSize: 12, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }

  Widget _statItem(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: const TextStyle(color: Colors.white60, fontSize: 11)),
        const SizedBox(height: 4),
        Text(value,
            style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w900)),
      ],
    );
  }
}
