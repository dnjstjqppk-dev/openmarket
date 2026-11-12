// mobile/partner_app/lib/views/bidding_view.dart
// Wave G2: M2C reverse-bidding workbench — open campaigns with bid submit,
// my bids with results, and MD price negotiations with accept/reject/counter
// (a counter travels as a rejection carrying the counter price, mirroring
// the web console).

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/bidding.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

String _won(num v) => '₩${NumberFormat('#,###').format(v)}';
String _num(num v) => NumberFormat('#,###').format(v);

String _shortDate(String iso) {
  if (iso.length >= 16) return iso.substring(0, 16).replaceAll('T', ' ');
  if (iso.length >= 10) return iso.substring(0, 10);
  return iso;
}

class PartnerBiddingView extends StatefulWidget {
  const PartnerBiddingView({super.key});

  @override
  State<PartnerBiddingView> createState() => _PartnerBiddingViewState();
}

class _PartnerBiddingViewState extends State<PartnerBiddingView>
    with SingleTickerProviderStateMixin {
  final PartnerApiService _api = PartnerApiService();
  late final TabController _tabs;
  List<BiddingCampaign> _campaigns = [];
  List<SupplierBid> _bids = [];
  List<PriceNegotiation> _negos = [];
  bool _loading = true;
  bool _authReady = false;
  List<String> _loadErrors = [];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _init();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    await PartnerAuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (PartnerAuthSession.isAuthenticated) _load();
  }

  /// Per-source failures (web T13 mirror): one failing tab never hides the
  /// other two.
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadErrors = [];
    });
    final failures = <String>[];
    try {
      final c = await _api.fetchCampaigns();
      if (mounted) setState(() => _campaigns = c);
    } on PartnerApiException catch (e) {
      failures.add('캠페인: ${e.message}');
    }
    try {
      final b = await _api.fetchMyBids();
      if (mounted) setState(() => _bids = b);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
      return;
    } on PartnerApiException catch (e) {
      failures.add('내 입찰: ${e.message}');
    }
    try {
      final n = await _api.fetchNegotiations();
      if (mounted) setState(() => _negos = n);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
      return;
    } on PartnerApiException catch (e) {
      failures.add('MD 네고: ${e.message}');
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _loadErrors = failures;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '입찰에 참여하려면 판매자 계정으로 로그인해 주세요.');
    }
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Column(
      children: [
        if (_loadErrors.isNotEmpty)
          Container(
            width: double.infinity,
            margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFFCE8E6),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(_loadErrors.join('\n'),
                      style: const TextStyle(
                          color: Color(0xFFC5221F), fontSize: 12)),
                ),
                TextButton(
                    onPressed: _load, child: const Text('다시 시도')),
              ],
            ),
          ),
        TabBar(
          controller: _tabs,
          labelColor: OlmoaColors.lagoon700,
          tabs: [
            Tab(text: '캠페인 ${_campaigns.length}'),
            Tab(text: '내 입찰 ${_bids.length}'),
            Tab(text: 'MD 네고 ${_negos.where((n) => n.awaitingResponse).length}'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _campaignTab(),
              _bidsTab(),
              _negoTab(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _campaignTab() {
    if (_campaigns.isEmpty) {
      return const Center(child: Text('진행중인 캠페인이 없습니다.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _campaigns.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final c = _campaigns[i];
          return Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _chip(c.statusLabel, OlmoaColors.lagoon700,
                          OlmoaColors.lagoon700.withValues(alpha: 0.1)),
                      const Spacer(),
                      Text('마감 ${_shortDate(c.endsAt)}',
                          style: TextStyle(
                              color: Colors.grey.shade600, fontSize: 11)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(c.title,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 14)),
                  Text('${c.categoryName}${c.referenceTitle.isNotEmpty ? ' · 참고: ${c.referenceTitle}' : ''}',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 12)),
                  const SizedBox(height: 6),
                  Text('상한 공급가 ${_won(c.ceilingSupplyPrice)} · 최소 MOQ ${_num(c.minMoq)}',
                      style: const TextStyle(fontSize: 13)),
                  Text('참여 ${c.bidCount}건${c.lowestBidPrice != null ? ' · 최저가 ${_won(c.lowestBidPrice!)}' : ''}',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 12)),
                  if (c.open) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => _openBidSheet(context, c),
                        child: const Text('입찰하기'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _bidsTab() {
    if (_bids.isEmpty) {
      return const Center(child: Text('제출한 입찰이 없습니다.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _bids.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final b = _bids[i];
          return Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _chip(b.statusLabel,
                          b.status == 'WON'
                              ? const Color(0xFF1E7E34)
                              : OlmoaColors.lagoon700,
                          b.status == 'WON'
                              ? const Color(0xFFE6F4EA)
                              : OlmoaColors.lagoon700
                                  .withValues(alpha: 0.1)),
                      const Spacer(),
                      Text(_shortDate(b.createdAt),
                          style: TextStyle(
                              color: Colors.grey.shade600, fontSize: 11)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(b.campaignTitle,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 4),
                  Text(
                      '제안 공급가 ${_won(b.bidSupplyPrice)} · MOQ ${_num(b.moq)} · 리드타임 ${b.productionLeadDays}일',
                      style: const TextStyle(fontSize: 13)),
                  if (b.bidNotes.isNotEmpty)
                    Text(b.bidNotes,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 12)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _negoTab() {
    if (_negos.isEmpty) {
      return const Center(child: Text('MD 네고 제안이 없습니다.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _negos.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final n = _negos[i];
          return Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      _chip(n.statusLabel,
                          n.awaitingResponse
                              ? const Color(0xFF8A5A00)
                              : OlmoaColors.lagoon700,
                          n.awaitingResponse
                              ? const Color(0xFFFFF3DC)
                              : OlmoaColors.lagoon700
                                  .withValues(alpha: 0.1)),
                      const Spacer(),
                      Text(_shortDate(n.createdAt),
                          style: TextStyle(
                              color: Colors.grey.shade600, fontSize: 11)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(n.productTitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 14)),
                  const SizedBox(height: 4),
                  Text(
                      '기존 판매가 ${_won(n.currentSalePrice)} → MD 제안가 ${_won(n.suggestedTargetPrice)}',
                      style: const TextStyle(fontSize: 13)),
                  Text(
                      '제안 인하율 ${n.discountRateSuggested.toStringAsFixed(1)}% · ${n.externalMarketBenchmark}',
                      style: TextStyle(
                          color: Colors.grey.shade600, fontSize: 12)),
                  if (n.mdProposalNotes.isNotEmpty)
                    Text('MD 메모: ${n.mdProposalNotes}',
                        style: const TextStyle(fontSize: 12)),
                  if (!n.awaitingResponse && n.partnerResponseNotes.isNotEmpty)
                    Text('내 응답: ${n.partnerResponseNotes}',
                        style: TextStyle(
                            color: Colors.grey.shade600, fontSize: 12)),
                  if (n.awaitingResponse) ...[
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () =>
                                _openNegoSheet(context, n, 'REJECT'),
                            child: const Text('거절'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () =>
                                _openNegoSheet(context, n, 'COUNTER'),
                            child: const Text('역제안'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ElevatedButton(
                            onPressed: () =>
                                _openNegoSheet(context, n, 'ACCEPT'),
                            child: const Text('수락'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
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

  Future<void> _openBidSheet(BuildContext context, BiddingCampaign c) async {
    final price =
        TextEditingController(text: c.ceilingSupplyPrice.toString());
    final moq = TextEditingController(text: c.minMoq.toString());
    final lead = TextEditingController(text: '7');
    final notes = TextEditingController();
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
                Text('${c.title} 입찰',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                Text(
                    '상한 공급가 ${_won(c.ceilingSupplyPrice)} 이하로만 입찰 가능합니다.',
                    style: TextStyle(
                        color: Colors.grey.shade600, fontSize: 12)),
                const SizedBox(height: 12),
                TextField(
                    controller: price,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: '입찰 공급가(원) *',
                        border: OutlineInputBorder())),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                        child: TextField(
                            controller: moq,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: 'MOQ *',
                                border: OutlineInputBorder()))),
                    const SizedBox(width: 10),
                    Expanded(
                        child: TextField(
                            controller: lead,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                                labelText: '리드타임(일) *',
                                border: OutlineInputBorder()))),
                  ],
                ),
                const SizedBox(height: 10),
                TextField(
                    controller: notes,
                    maxLines: 2,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                        labelText: '제안 메모(선택)',
                        border: OutlineInputBorder())),
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
                            final err = validateSupplierBid(
                              priceRaw: price.text,
                              ceiling: c.ceilingSupplyPrice,
                              moqRaw: moq.text,
                              leadDaysRaw: lead.text,
                            );
                            if (err != null) {
                              setSheet(() => formError = err);
                              return;
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.submitCampaignBid(
                              campaignId: c.id,
                              price: int.parse(price.text
                                  .replaceAll(RegExp(r'[,\s]'), '')),
                              moq: int.parse(moq.text
                                  .replaceAll(RegExp(r'[,\s]'), '')),
                              leadDays: int.parse(lead.text.trim()),
                              notes: notes.text.trim(),
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content:
                                        Text('역경매 입찰 제안서가 등록되었습니다.')),
                              );
                              _load();
                            } else {
                              setSheet(() {
                                busy = false;
                                formError = (res['error'] ?? '입찰 실패')
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
                        : const Text('입찰 제출',
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
    price.dispose();
    moq.dispose();
    lead.dispose();
    notes.dispose();
  }

  Future<void> _openNegoSheet(
      BuildContext context, PriceNegotiation n, String action) async {
    final notes = TextEditingController();
    final counter = TextEditingController(
        text: action == 'COUNTER' ? n.suggestedTargetPrice.toString() : '');
    String? formError;
    var busy = false;
    final isAccept = action == 'ACCEPT';
    final isCounter = action == 'COUNTER';
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
                Text(
                    isAccept
                        ? 'MD 제안 수락'
                        : isCounter
                            ? '역제안 보내기'
                            : 'MD 제안 거절',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w900)),
                Text(n.productTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        color: Colors.grey.shade600, fontSize: 12)),
                const SizedBox(height: 8),
                Text(
                    '기존 ${_won(n.currentSalePrice)} → 제안 ${_won(n.suggestedTargetPrice)}',
                    style: const TextStyle(fontSize: 13)),
                if (isAccept)
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text('수락하면 판매가가 제안가로 즉시 인하됩니다.',
                        style: TextStyle(
                            color: Colors.red,
                            fontSize: 12,
                            fontWeight: FontWeight.bold)),
                  ),
                if (isCounter)
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text(
                        '역제안은 제안을 거절하고 희망가를 메모로 전달합니다.',
                        style:
                            TextStyle(color: Colors.grey, fontSize: 12)),
                  ),
                const SizedBox(height: 12),
                if (isCounter)
                  TextField(
                      controller: counter,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                          labelText: '역제안 희망가(원) *',
                          border: OutlineInputBorder())),
                if (isCounter) const SizedBox(height: 10),
                TextField(
                    controller: notes,
                    maxLines: 3,
                    maxLength: 500,
                    decoration: const InputDecoration(
                        labelText: '응답 메모', border: OutlineInputBorder())),
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
                            var body = notes.text.trim();
                            if (isCounter) {
                              final cp = int.tryParse(counter.text
                                  .replaceAll(RegExp(r'[,\s]'), ''));
                              if (cp == null || cp < 100) {
                                setSheet(() => formError =
                                    '역제안 희망가를 100원 이상 숫자로 입력해 주세요.');
                                return;
                              }
                              body = counterResponseNotes(
                                  counterPrice: cp, notes: body);
                            }
                            setSheet(() {
                              busy = true;
                              formError = null;
                            });
                            final res = await _api.respondOffer(
                              negotiationId: n.id,
                              accept: isAccept,
                              notes: body,
                            );
                            if (!sheetContext.mounted) return;
                            if (res['ok'] == true) {
                              Navigator.of(sheetContext).pop();
                              if (!mounted) return;
                              final data = res['data']
                                      is Map<String, dynamic>
                                  ? res['data'] as Map<String, dynamic>
                                  : <String, dynamic>{};
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content: Text(isAccept
                                        ? (data['message'] ??
                                                'MD 제안을 수락했습니다.')
                                            .toString()
                                        : isCounter
                                            ? '제안을 거절하고 역제안 메모를 전달했습니다.'
                                            : (data['message'] ??
                                                    'MD 제안을 거절했습니다.')
                                                .toString())),
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
                    child: busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                color: Colors.white, strokeWidth: 2))
                        : Text(isAccept
                            ? '수락하기'
                            : isCounter
                                ? '역제안 보내기'
                                : '거절하기'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    notes.dispose();
    counter.dispose();
  }
}
