// mobile/customer_app/lib/views/orders_view.dart
// Signed-in order history from GET /api/v1/orders (JWT). Logged-out users
// see the login form; failures show an error with retry instead of an
// empty list pretending there are no orders.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/api_service.dart';
import '../models/order_detail.dart' show orderStatusLabel;
import '../theme/app_theme.dart';
import 'login_view.dart';
import 'order_detail_view.dart';

String _won(num v) => '₩${NumberFormat('#,###').format(v)}';

String _localDateTime(String iso) {
  final dt = DateTime.tryParse(iso)?.toLocal();
  if (dt == null) return iso.isEmpty ? '-' : iso;
  return DateFormat('yyyy-MM-dd HH:mm').format(dt);
}

class OrdersView extends StatefulWidget {
  const OrdersView({super.key});

  @override
  State<OrdersView> createState() => _OrdersViewState();
}

class _OrdersViewState extends State<OrdersView> {
  bool _authReady = false;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<Map<String, dynamic>> _orders = [];
  int _page = 1;
  bool _hasMore = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await AuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (AuthSession.isAuthenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final first = await ApiService.fetchOrdersPage();
      if (mounted) {
        setState(() {
          _orders = first.items;
          _page = first.page;
          _hasMore = first.hasMore;
        });
      }
    } on AuthRequiredException {
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final next = await ApiService.fetchOrdersPage(page: _page + 1);
      if (mounted) {
        setState(() {
          _orders = [..._orders, ...next.items];
          _page = next.page;
          _hasMore = next.hasMore;
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('다음 페이지를 불러오지 못했습니다.')),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _init, reason: '주문 내역을 보려면 로그인해 주세요.');
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
    if (_orders.isEmpty) {
      return const Center(
        child: Text('주문 내역이 없습니다.',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _orders.length + (_hasMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          if (index >= _orders.length) {
            return Center(
              child: _loadingMore
                  ? const Padding(
                      padding: EdgeInsets.all(12),
                      child: CircularProgressIndicator())
                  : OutlinedButton(
                      onPressed: _loadMore,
                      child: const Text('주문 더 보기'),
                    ),
            );
          }
          return _orderCard(context, _orders[index]);
        },
      ),
    );
  }

  Widget _orderCard(BuildContext context, Map<String, dynamic> order) {
    return _OrderCard(order: order);
  }
}

class _OrderCard extends StatelessWidget {
  final Map<String, dynamic> order;

  const _OrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
            final orderNo = (order['order_no'] ?? order['id'] ?? '').toString();
            final status =
                (order['payment_status'] ?? order['status'] ?? '').toString();
            final amount =
                order['total_pay_amount'] ?? order['total_amount'] ?? 0;
            final createdAt = (order['created_at'] ?? '').toString();
            final cancelled = status == 'CANCELLED' || status == 'REFUNDED';

            return Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(color: Colors.grey.shade200),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => OrderDetailView(
                          orderId: (order['id'] ?? '').toString())),
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
                            child: Text(orderNo,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: Colors.blueGrey))),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: cancelled
                                ? OlmoaColors.dangerSoft
                                : OlmoaColors.lagoon50,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            // P2-MOB-07: Korean labels, formatted won, local dates.
                            orderStatusLabel(status),
                            style: TextStyle(
                              color: cancelled
                                  ? OlmoaColors.danger
                                  : OlmoaColors.lagoon700,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text('결제금액: ${_won(amount is num ? amount : num.tryParse(amount.toString()) ?? 0)}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 15)),
                    const Divider(height: 20),
                    Text('주문일시: ${_localDateTime(createdAt)}',
                        style: const TextStyle(
                            color: OlmoaColors.stone500, fontSize: 11)),
                    ],
                  ),
                ),
              ),
            );
  }
}
