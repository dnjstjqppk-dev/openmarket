// mobile/partner_app/lib/views/settlements_view.dart
// N-04: seller settlement ledger from GET /api/v1/partner/settlements —
// summary cards, per-order settlement rows and payout history. Previously the
// service method existed with zero view call sites, so sellers could never
// check payouts in the app.

import 'package:flutter/material.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

String settlementStatusLabel(String s) => switch (s) {
      'PENDING' => '정산 대기',
      'ELIGIBLE_FOR_PAYOUT' => '지급 가능',
      'PAID_OUT' => '지급 완료',
      'CANCELLED' => '취소됨',
      'HOLD' => '보류중',
      _ => s.isEmpty ? '-' : s,
    };

String _won(num v) =>
    '₩${v.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';

String _date(String? iso) {
  if (iso == null || iso.isEmpty) return '-';
  return iso.length >= 10 ? iso.substring(0, 10) : iso;
}

class PartnerSettlementsView extends StatefulWidget {
  const PartnerSettlementsView({super.key});

  @override
  State<PartnerSettlementsView> createState() => _PartnerSettlementsViewState();
}

class _PartnerSettlementsViewState extends State<PartnerSettlementsView> {
  final PartnerApiService _apiService = PartnerApiService();
  Map<String, dynamic>? _summary;
  List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _payouts = [];
  bool _authReady = false;
  bool _isLoading = true;
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
    if (PartnerAuthSession.isAuthenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final r = await _apiService.fetchSettlements();
      if (!mounted) return;
      final data = (r['data'] as Map?) ?? r;
      setState(() {
        _summary = Map<String, dynamic>.from(data['summary'] as Map? ?? {});
        _rows = ((data['settlements'] ?? r['settlements']) as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
        _payouts = ((data['payouts'] ?? r['payouts'] ?? []) as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      });
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  num _num(Object? v) => v is num ? v : num.tryParse(v?.toString() ?? '') ?? 0;

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '정산 내역을 보려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_isLoading) return const Center(child: CircularProgressIndicator());
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
    final s = _summary ?? {};
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
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
                const Text('정산 요약',
                    style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                const SizedBox(height: 12),
                _sumRow('누적 순지급액', _won(_num(s['net_payout'])), bold: true),
                _sumRow('매출 합계', _won(_num(s['gross_sales']))),
                _sumRow('수수료 합계', _won(_num(s['total_commission']))),
                _sumRow('지급 대기', _won(_num(s['eligible_amount']))),
                _sumRow('미확정', _won(_num(s['pending_amount']))),
                if (_num(s['reserve_outstanding']) > 0)
                  _sumRow('리저브 유보', _won(_num(s['reserve_outstanding']))),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        const Text('주문별 정산',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        if (_rows.isEmpty)
          const Card(
              child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('정산 내역이 없습니다.')))),
        for (final r in _rows)
          Card(
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
                      Expanded(
                        child: Text(
                          (r['sub_order_no'] ?? r['order_no'] ?? '').toString(),
                          style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                              color: Colors.blueGrey),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: OlmoaColors.lagoon50,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          settlementStatusLabel(
                              (r['settlement_status'] ?? r['status'] ?? '')
                                  .toString()),
                          style: const TextStyle(
                              color: OlmoaColors.lagoon700,
                              fontSize: 11,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('순지급액: ${_won(_num(r['effective_net_payout'] ?? r['net_payout_amount']))}',
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 15)),
                  const SizedBox(height: 4),
                  Text(
                    '매출 ${_won(_num(r['gross_amount']))} · 수수료 ${_won(_num(r['commission_amount']))} · ${_date((r['order_date'] ?? r['created_at'])?.toString())}',
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 11),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        const Text('지급 내역',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        if (_payouts.isEmpty)
          const Card(
              child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('지급 내역이 없습니다.')))),
        for (final p in _payouts)
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Colors.grey.shade200),
            ),
            child: ListTile(
              title: Text(_won(_num(p['amount']))),
              subtitle: Text(_date(p['created_at']?.toString())),
              trailing: Text((p['status'] ?? '').toString(),
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.bold)),
            ),
          ),
      ],
    );
  }

  Widget _sumRow(String k, String v, {bool bold = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(k, style: const TextStyle(fontSize: 13)),
            Text(v,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: bold ? FontWeight.w900 : FontWeight.bold)),
          ],
        ),
      );
}
