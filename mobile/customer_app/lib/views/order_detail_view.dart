// mobile/customer_app/lib/views/order_detail_view.dart
// Order detail: summary, seller sub-orders with items and tracking, and the
// buyer actions the server offers — pay, whole/sub cancel, purchase confirm,
// return/exchange/price-adjustment claims. Rules mirror the storefront view.
import 'package:flutter/material.dart';
import '../models/order_detail.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'payment_view.dart';

const _reasonLabels = {
  'CHANGE_OF_MIND': '단순변심',
  'SIZE_COLOR': '사이즈·색상',
  'DEFECTIVE': '불량·고장',
  'WRONG_ITEM': '오배송',
  'DAMAGED': '배송 중 파손',
  'NOT_AS_DESCRIBED': '상품정보와 상이',
  'OTHER': '기타',
};

class OrderDetailView extends StatefulWidget {
  final String orderId;

  const OrderDetailView({super.key, required this.orderId});

  @override
  State<OrderDetailView> createState() => _OrderDetailViewState();
}

class _OrderDetailViewState extends State<OrderDetailView> {
  Future<Map<String, dynamic>>? _detailFuture;
  List<Map<String, dynamic>>? _tracking;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _detailFuture = ApiService.getOrderDetail(widget.orderId);
  }

  void _reload() => setState(() {
        _detailFuture = ApiService.getOrderDetail(widget.orderId);
        _tracking = null;
      });

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<bool> _ask(String title, String message) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('확인')),
        ],
      ),
    );
    return ok == true;
  }

  Future<void> _runAction(Future<Map<String, dynamic>> Function() call, String okText) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final res = await call();
      if (!mounted) return;
      if (res['success'] == true) {
        _toast((res['message'] ?? okText).toString());
        _reload();
      } else {
        _toast((res['error'] ?? '요청을 처리하지 못했습니다.').toString());
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _loadTracking() async {
    try {
      final t = await ApiService.getTracking(widget.orderId);
      if (mounted) setState(() => _tracking = t);
    } catch (e) {
      _toast(e is ApiException ? e.message : '배송 조회에 실패했습니다.');
    }
  }

  void _openClaimSheet(OrderDetail d, OrderSub sub) {
    var type = 'RETURN';
    var reasonCode = 'CHANGE_OF_MIND';
    final reason = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: Padding(
            padding: EdgeInsets.only(
                left: 24, right: 24, top: 24, bottom: 24 + MediaQuery.of(ctx).viewInsets.bottom),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('반품·교환 신청 (${sub.subOrderNo})',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: '신청 유형', border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(value: 'RETURN', child: Text('반품 (환불)')),
                    DropdownMenuItem(value: 'EXCHANGE', child: Text('교환')),
                  ],
                  onChanged: (v) => setSheet(() => type = v ?? 'RETURN'),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: reasonCode,
                  decoration: const InputDecoration(labelText: '사유', border: OutlineInputBorder()),
                  items: [for (final e in _reasonLabels.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
                  onChanged: (v) => setSheet(() => reasonCode = v ?? 'OTHER'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: reason,
                  maxLines: 3,
                  decoration: const InputDecoration(
                      labelText: '상세 사유', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _busy
                        ? null
                        : () {
                            Navigator.pop(ctx);
                            _runAction(
                              () => ApiService.fileClaim(
                                orderId: d.id,
                                claimType: type,
                                subOrderId: sub.id,
                                reason: reason.text.trim().isEmpty ? '고객 요청' : reason.text.trim(),
                                reasonCode: reasonCode,
                              ),
                              '신청이 접수되었습니다.',
                            );
                          },
                    child: const Text('신청하기', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('주문 상세')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _detailFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(snapshot.error is ApiException
                      ? (snapshot.error as ApiException).message
                      : '주문 상세를 불러오지 못했습니다.'),
                  const SizedBox(height: 12),
                  ElevatedButton(onPressed: _reload, child: const Text('다시 시도')),
                ],
              ),
            );
          }
          final d = parseOrderDetail(snapshot.data ?? {});
          return _buildBody(d);
        },
      ),
    );
  }

  Widget _buildBody(OrderDetail d) {
    final confirmables = confirmableSubs(d);
    final claimables = {for (final s in claimableSubs(d)) s.id};
    final titles = [for (final s in d.subs) for (final i in s.items) i.title];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                        child: Text(d.orderNo,
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey))),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                          color: OlmoaColors.lagoon50, borderRadius: BorderRadius.circular(6)),
                      child: Text(orderStatusLabel(d.paymentStatus),
                          style: const TextStyle(
                              color: OlmoaColors.lagoon700, fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text('₩${d.totalPayAmount}',
                    style: const TextStyle(
                        color: OlmoaColors.ruby500, fontWeight: FontWeight.w900, fontSize: 20)),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (d.paymentStatus == 'READY')
              ElevatedButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => PaymentView(
                        orderNo: d.orderNo,
                        amount: d.totalPayAmount,
                        titles: titles,
                        expiresAt: d.expiresAt,
                        onPaid: _reload))),
                child: const Text('결제하기'),
              ),
            if (canCancelWhole(d))
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () async {
                        if (await _ask('주문 취소',
                            '주문 전체를 취소합니다. 결제된 금액은 환불됩니다. 계속할까요?')) {
                          _runAction(() => ApiService.cancelOrder(d.id), '주문이 취소되었습니다.');
                        }
                      },
                child: Text(d.paymentStatus == 'READY' ? '주문 취소' : '전체 취소·환불'),
              ),
            if (confirmables.isNotEmpty)
              ElevatedButton(
                onPressed: _busy
                    ? null
                    : () async {
                        if (await _ask('구매확정',
                            '배송 완료된 ${confirmables.length}건을 확정합니다. 계속할까요?')) {
                          _runAction(() => ApiService.confirmPurchase(d.id), '구매확정이 완료되었습니다.');
                        }
                      },
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
                child: Text('구매확정 (${confirmables.length}건)'),
              ),
            // 5-5 (decision-15): the price-adjustment claim is retired.
          ],
        ),
        const SizedBox(height: 16),
        const Text('판매자별 주문', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        for (final s in d.subs) _subCard(d, s, claimables.contains(s.id)),
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('배송 조회', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
            TextButton(onPressed: _loadTracking, child: const Text('새로고침')),
          ],
        ),
        if (_tracking == null)
          OutlinedButton(onPressed: _loadTracking, child: const Text('배송 현황 불러오기'))
        else if (_tracking!.isEmpty)
          const Text('배송 기록이 없습니다.', style: TextStyle(color: Colors.grey, fontSize: 13))
        else
          for (final t in _tracking!) _trackingCard(t),
        if (d.claims.isNotEmpty) ...[
          const SizedBox(height: 16),
          const Text('클레임', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
          for (final c in d.claims)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('${c['claim_type'] ?? ''} · ${c['status'] ?? ''}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
              subtitle: Text((c['reason'] ?? '').toString(),
                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ),
        ],
        if (d.refunds.isNotEmpty) ...[
          const SizedBox(height: 8),
          const Text('환불', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
          for (final r in d.refunds)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text('${r['status'] ?? ''} · ₩${r['pg_amount'] ?? 0}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
            ),
        ],
      ],
    );
  }

  Widget _subCard(OrderDetail d, OrderSub s, bool claimable) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                      child:
                          Text(s.businessName.isEmpty ? s.subOrderNo : s.businessName,
                              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13))),
                  Text(subStatusLabel(s.status),
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                ],
              ),
              for (final i in s.items)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('${i.title} × ${i.quantity}',
                      style: const TextStyle(fontSize: 12, color: Colors.black87)),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('상품 ₩${s.goodsAmount} + 배송비 ₩${s.shippingFee} = ₩${s.totalAmount}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ),
              if ((s.trackingNumber ?? '').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('${s.carrierCode ?? ''} ${s.trackingNumber}',
                      style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
                ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  if (s.status == 'PAYMENT_CONFIRMED' || s.status == 'PREPARING')
                    OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () async {
                              if (await _ask('부분 취소',
                                  '${s.businessName} 주문을 취소합니다. 계속할까요?')) {
                                _runAction(() => ApiService.cancelSubOrder(d.id, s.id),
                                    '부분 취소되었습니다.');
                              }
                            },
                      child: const Text('이 판매자 취소'),
                    ),
                  if (claimable)
                    OutlinedButton(
                      onPressed: () => _openClaimSheet(d, s),
                      child: const Text('반품·교환 신청'),
                    ),
                ],
              ),
            ],
          ),
        ),
      );

  Widget _trackingCard(Map<String, dynamic> t) {
    final events = (t['events'] is List) ? (t['events'] as List) : const [];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text((t['partner_name'] ?? '').toString(),
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            if (((t['tracking_number'] ?? '') as String).isNotEmpty)
              Text('${t['carrier_code'] ?? ''} ${(t['tracking_number'] ?? '')}',
                  style: const TextStyle(fontSize: 12, fontFamily: 'monospace')),
            if (events.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('아직 배송 이벤트가 없습니다.', style: TextStyle(fontSize: 12, color: Colors.grey)),
              )
            else
              for (final e in events)
                if (e is Map)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                        '${e['stage_name'] ?? e['stage_code'] ?? ''} · ${(e['occurred_at'] ?? '').toString()}${e['location'] != null && (e['location'] as String).isNotEmpty ? ' · ${e['location']}' : ''}',
                        style: const TextStyle(fontSize: 12)),
                  ),
          ],
        ),
      ),
    );
  }
}
