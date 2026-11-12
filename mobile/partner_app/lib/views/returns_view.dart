// mobile/partner_app/lib/views/returns_view.dart
// Wave G2: seller claim inbox — status tabs, search, approve/reject with the
// same guards as the web console (reject needs a note; customer-fault blame
// needs a written ground), and exchange re-shipment registration.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/return_claim.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';
import 'shipment_view.dart' show shipmentCarrierOptions;

String _won(num v) => '₩${NumberFormat('#,###').format(v)}';

String _shortDate(String iso) {
  if (iso.length >= 16) return iso.substring(0, 16).replaceAll('T', ' ');
  return iso;
}

class PartnerReturnsView extends StatefulWidget {
  const PartnerReturnsView({super.key});

  @override
  State<PartnerReturnsView> createState() => _PartnerReturnsViewState();
}

class _PartnerReturnsViewState extends State<PartnerReturnsView> {
  final PartnerApiService _api = PartnerApiService();
  List<ReturnClaim> _claims = [];
  bool _loading = true;
  bool _authReady = false;
  String? _error;
  String _tab = 'ALL';
  String _query = '';

  static const _tabs = [
    ['ALL', '전체'],
    ['REQUESTED', '검토 요청'],
    ['APPROVED', '승인됨'],
    ['REFUNDED', '환불 완료'],
    ['REJECTED', '반려됨'],
  ];

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
      final claims = await _api.fetchReturns();
      if (mounted) setState(() => _claims = claims);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  List<ReturnClaim> get _filtered {
    final q = _query.trim().toLowerCase();
    return _claims.where((c) {
      if (_tab != 'ALL' && c.status != _tab) return false;
      if (q.isEmpty) return true;
      return c.orderNo.toLowerCase().contains(q) ||
          c.subOrderNo.toLowerCase().contains(q) ||
          c.customerName.toLowerCase().contains(q) ||
          c.customerEmail.toLowerCase().contains(q) ||
          c.reason.toLowerCase().contains(q);
    }).toList();
  }

  int _count(String tab) =>
      tab == 'ALL' ? _claims.length : _claims.where((c) => c.status == tab).length;

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '반품을 처리하려면 판매자 계정으로 로그인해 주세요.');
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
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            itemCount: _tabs.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (context, i) {
              final tab = _tabs[i];
              final selected = _tab == tab[0];
              return ChoiceChip(
                label: Text('${tab[1]} ${_count(tab[0])}'),
                selected: selected,
                onSelected: (_) => setState(() => _tab = tab[0]),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            decoration: const InputDecoration(
              hintText: '주문번호·고객·사유 검색',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text('해당 클레임이 없습니다.',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 13)),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _claimCard(context, rows[i]),
                  ),
                ),
        ),
      ],
    );
  }

  Widget _claimCard(BuildContext context, ReturnClaim c) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _chip(c.typeLabel, OlmoaColors.lagoon700,
                    OlmoaColors.lagoon700.withValues(alpha: 0.1)),
                const SizedBox(width: 6),
                _chip(c.statusLabel, _statusFg(c.status), _statusBg(c.status)),
                const Spacer(),
                Text(_shortDate(c.createdAt),
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 11)),
              ],
            ),
            const SizedBox(height: 8),
            Text('${c.orderNo} · ${c.subOrderNo}',
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 2),
            Text(c.customerLabel,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            const SizedBox(height: 4),
            Text('사유: ${c.reasonLabel}',
                style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 4),
            Row(
              children: [
                Text('결제 ${c.totalAmount == 0 ? '-' : _won(c.totalAmount)}',
                    style: TextStyle(
                        color: Colors.grey.shade700, fontSize: 12)),
                if (c.status == 'REFUNDED' && c.returnFeeAmount > 0)
                  Text(' · 반품배송비 ${_won(c.returnFeeAmount)} 차감',
                      style: TextStyle(
                          color: Colors.grey.shade700, fontSize: 12)),
              ],
            ),
            if (c.fault != null && c.fault!.isNotEmpty)
              Text('귀책: ${c.fault == 'CUSTOMER' ? '고객' : '판매자'}',
                  style:
                      TextStyle(color: Colors.grey.shade700, fontSize: 12)),
            if (c.awaitingReship)
              const Text('교환 승인됨 — 교환품 송장을 등록해 주세요.',
                  style: TextStyle(
                      color: OlmoaColors.lagoon700,
                      fontSize: 12,
                      fontWeight: FontWeight.bold)),
            if (c.exchangeTrackingNumber != null &&
                c.exchangeTrackingNumber!.isNotEmpty)
              Text('교환 송장: ${c.exchangeTrackingNumber}',
                  style:
                      TextStyle(color: Colors.grey.shade700, fontSize: 12)),
            if (c.status == 'REQUESTED' || c.awaitingReship) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  if (c.status == 'REQUESTED') ...[
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () =>
                            _openDecisionSheet(context, c, false),
                        child: const Text('반려'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () =>
                            _openDecisionSheet(context, c, true),
                        child: const Text('승인'),
                      ),
                    ),
                  ],
                  if (c.awaitingReship)
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => _openReshipSheet(context, c),
                        icon: const Icon(Icons.local_shipping, size: 18),
                        label: const Text('교환품 출고 등록'),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Color _statusBg(String s) {
    switch (s) {
      case 'REFUNDED':
        return const Color(0xFFE6F4EA);
      case 'REJECTED':
        return const Color(0xFFFCE8E6);
      default:
        return const Color(0xFFFFF3DC);
    }
  }

  Color _statusFg(String s) {
    switch (s) {
      case 'REFUNDED':
        return const Color(0xFF1E7E34);
      case 'REJECTED':
        return const Color(0xFFC5221F);
      default:
        return const Color(0xFF8A5A00);
    }
  }

  Widget _chip(String label, Color fg, Color bg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child:
          Text(label, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  Future<void> _openDecisionSheet(
      BuildContext context, ReturnClaim c, bool approve) async {
    final notes = TextEditingController();
    String? fault;
    var returnless = false;
    String? formError;
    var busy = false;
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
                Text('${c.orderNo} ${approve ? '승인' : '반려'}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                Text('${c.typeLabel} · ${c.reasonLabel}',
                    style: TextStyle(
                        color: Colors.grey.shade600, fontSize: 12)),
                const SizedBox(height: 12),
                TextField(
                  controller: notes,
                  maxLines: 3,
                  maxLength: 500,
                  decoration: InputDecoration(
                    labelText: approve ? '메모(선택)' : '거절 사유 *',
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: fault,
                  decoration: const InputDecoration(
                      labelText: '귀책 변경(선택)',
                      border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(
                        value: 'SELLER', child: Text('판매자 귀책')),
                    DropdownMenuItem(
                        value: 'CUSTOMER', child: Text('고객 귀책')),
                  ],
                  onChanged: (v) => setSheet(() => fault = v),
                ),
                if (fault == 'CUSTOMER' && c.fault != 'CUSTOMER')
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text('고객 귀책 판단은 근거 메모가 필요하며, 고객이 이의를 제기할 수 있습니다.',
                        style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ),
                if (approve && c.claimType == 'RETURN')
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('회수 생략(반품 없이 환불)',
                        style: TextStyle(fontSize: 13)),
                    value: returnless,
                    onChanged: (v) =>
                        setSheet(() => returnless = v ?? false),
                  ),
                if (formError != null)
                  Text(formError!,
                      style:
                          const TextStyle(color: Colors.red, fontSize: 12)),
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateClaimDecision(
                              approve: approve,
                              notes: notes.text,
                              fault: fault,
                              existingFault: c.fault,
                            );
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.decideClaim(
                              claimId: c.id,
                              approve: approve,
                              notes: notes.text.trim(),
                              fault: fault,
                              returnless: returnless,
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              final data = res['data']
                                      is Map<String, dynamic>
                                  ? res['data'] as Map<String, dynamic>
                                  : <String, dynamic>{};
                              final status =
                                  (data['status'] ?? '').toString();
                              final fee = data['return_fee'];
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(!approve
                                        ? '클레임을 반려했습니다.'
                                        : status == 'REFUNDED'
                                            ? '환불 완료${fee is num && fee > 0 ? ' (반품 배송비 ${_won(fee)} 차감)' : ''}'
                                            : '교환을 승인했습니다. 교환품 송장을 등록해 주세요.')),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '처리 실패')
                                    .toString();
                              });
                            }
                          },
                    style: approve
                        ? null
                        : ElevatedButton.styleFrom(
                            backgroundColor: Colors.red.shade700),
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : Text(approve ? '승인하기' : '반려하기',
                            style: const TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    notes.dispose();
  }

  Future<void> _openReshipSheet(BuildContext context, ReturnClaim c) async {
    final tracking = TextEditingController();
    var carrier = shipmentCarrierOptions.first;
    var returnReceived = true;
    String? formError;
    var busy = false;
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
                Text('${c.orderNo} 교환품 출고',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                const Text('교환 상품 운송장을 등록하면 주문이 배송 흐름으로 복귀합니다.',
                    style: TextStyle(color: Colors.grey, fontSize: 12)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: carrier,
                  decoration: const InputDecoration(
                      labelText: '택배사 *', border: OutlineInputBorder()),
                  items: shipmentCarrierOptions
                      .map((o) =>
                          DropdownMenuItem(value: o, child: Text(o)))
                      .toList(),
                  onChanged: (v) =>
                      setSheet(() => carrier = v ?? carrier),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: tracking,
                  decoration: const InputDecoration(
                      labelText: '송장번호 *', border: OutlineInputBorder()),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('반품 상품 회수 완료',
                      style: TextStyle(fontSize: 13)),
                  subtitle: const Text('끄면 회수 없이 교환품만 출고됩니다.',
                      style: TextStyle(fontSize: 11)),
                  value: returnReceived,
                  onChanged: (v) =>
                      setSheet(() => returnReceived = v),
                ),
                if (formError != null)
                  Text(formError!,
                      style:
                          const TextStyle(color: Colors.red, fontSize: 12)),
                const SizedBox(height: 12),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: busy
                        ? null
                        : () async {
                            final err = validateReshipTracking(tracking.text);
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.reshipClaim(
                              claimId: c.id,
                              carrier: carrier,
                              trackingNumber: tracking.text.trim(),
                              returnReceived: returnReceived,
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content:
                                        Text('교환품 출고가 등록되었습니다.')),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '등록 실패')
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
                        : const Text('출고 등록',
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
    tracking.dispose();
  }
}
