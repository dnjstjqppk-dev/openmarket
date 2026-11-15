// mobile/partner_app/lib/views/dashboard_view.dart
// Seller dashboard bound to GET /api/v1/partner/dashboard/pipeline.
// 4-23: the same 8 action cards the web seller console renders.
// Every figure is a live server aggregate; failures show a retry state.

import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
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
  Map<String, dynamic>? _pipe;
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
      final m = await _api.fetchPipeline();
      if (mounted) setState(() => _pipe = m);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    // P2-MOB-09: nullable lookup with Korean fallback (bare-context safe).
    final t = AppLocalizations.of(context);
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
              child: Text(t?.commonRetry ?? '다시 시도'),
            ),
          ],
        ),
      );
    }
    final m = _pipe ?? {};
    final settlement =
        m['settlement'] is Map ? Map<String, dynamic>.from(m['settlement'] as Map) : <String, dynamic>{};
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(t?.dashTitle ?? '판매자 운영 현황',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        const Text('처리해야 할 일부터 보여줍니다.',
            style: TextStyle(fontSize: 12, color: Colors.black54)),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 2.1,
          children: [
            _kpiCard('신규 주문', _countText(_asCount(m['new_orders']), '건')),
            _kpiCard('발송 대기', _countText(_asCount(m['preparing']), '건')),
            _kpiCard('배송 중', _countText(_asCount(m['in_transit']), '건')),
            _kpiCard('취소 요청', _countText(_asCount(m['cancel_requests']), '건')),
            _kpiCard('반품 요청', _countText(_asCount(m['return_requests']), '건')),
            _kpiCard('교환 요청', _countText(_asCount(m['exchange_requests']), '건')),
            _kpiCard('미답변 문의', _countText(_asCount(m['unanswered_qna']), '건')),
            _kpiCard('정산 예정금', _wonText(settlement['expected_amount'])),
          ],
        ),
        const SizedBox(height: 20),
        Text(t?.sectionManage ?? '판매 관리',
            style: const TextStyle(
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
            _manageTile(context, Icons.inventory_2_outlined,
                t?.tileProducts ?? '상품 관리', t?.tileProducts ?? '상품 관리', const PartnerProductsView()),
            _manageTile(context, Icons.assignment_return_outlined,
                t?.tileReturns ?? '반품·교환', t?.tileReturns ?? '반품·교환', const PartnerReturnsView()),
            _manageTile(context, Icons.question_answer_outlined, t?.tileQna ?? 'Q&A',
                t?.tileQnaTitle ?? '상품 Q&A', const PartnerQnaView()),
            _manageTile(context, Icons.gavel_outlined, t?.tileBidding ?? '입찰·네고',
                t?.tileBidding ?? '입찰·네고', const PartnerBiddingView()),
            _manageTile(context, Icons.hub_outlined, t?.tileChannels ?? '멀티채널',
                t?.tileChannels ?? '멀티채널', const PartnerChannelsView()),
            _manageTile(context, Icons.badge_outlined, t?.tileProfile ?? '프로필',
                t?.tileProfileTitle ?? '판매자 프로필', const PartnerProfileView()),
          ],
        ),
        const SizedBox(height: 20),
        Text(t?.sectionQuick ?? '빠른 작업',
            style: const TextStyle(
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
                label: Text(t?.quickTracking ?? '운송장 등록',
                    style: const TextStyle(color: OlmoaColors.lagoon700)),
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
                label: Text(t?.quickSettlements ?? '정산 내역'),
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

  /// P2-MOB-09: server counts arrive dynamic; the ARB plural takes int.
  static int _asCount(dynamic v) => (v as num?)?.toInt() ?? 0;

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

  static String _countText(int v, String unit) => '$v$unit';

  static String _wonText(dynamic v) {
    final n = (v as num?)?.toInt() ?? 0;
    return '₩${n.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';
  }

  Widget _kpiCard(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label,
              style: const TextStyle(color: Colors.black54, fontSize: 11)),
          const SizedBox(height: 4),
          Text(value,
              style: const TextStyle(
                  fontSize: 17, fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}
