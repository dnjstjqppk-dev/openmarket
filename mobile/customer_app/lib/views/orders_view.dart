// mobile/customer_app/lib/views/orders_view.dart
// Signed-in order history from GET /api/v1/orders (JWT). Logged-out users
// see the login form; failures show an error with retry instead of an
// empty list pretending there are no orders.

import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

class OrdersView extends StatefulWidget {
  const OrdersView({super.key});

  @override
  State<OrdersView> createState() => _OrdersViewState();
}

class _OrdersViewState extends State<OrdersView> {
  Future<List<Map<String, dynamic>>>? _ordersFuture;
  bool _authReady = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await AuthSession.restore();
    if (!mounted) return;
    setState(() {
      _authReady = true;
      if (AuthSession.isAuthenticated) _ordersFuture = ApiService.fetchOrders();
    });
  }

  void _reload() => setState(() => _ordersFuture = ApiService.fetchOrders());

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _init, reason: '주문 내역을 보려면 로그인해 주세요.');
    }
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _ordersFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final err = snapshot.error;
          if (err is AuthRequiredException) {
            return LoginView(
                onSuccess: _init, reason: '로그인이 만료되었습니다. 다시 로그인해 주세요.');
          }
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                    '${err is ApiException ? err.message : '주문 내역을 불러오지 못했습니다.'}',
                    style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 12),
                ElevatedButton(onPressed: _reload, child: const Text('다시 시도')),
              ],
            ),
          );
        }
        final orders = snapshot.data ?? [];
        if (orders.isEmpty) {
          return const Center(
            child: Text('주문 내역이 없습니다.',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: orders.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final order = orders[index];
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
                            status,
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
                    Text('결제금액: ₩$amount',
                        style: const TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 15)),
                    const Divider(height: 20),
                    Text('주문일시: $createdAt',
                        style: const TextStyle(
                            color: OlmoaColors.stone500, fontSize: 11)),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}
