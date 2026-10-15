// mobile/customer_app/lib/views/cart_view.dart
// Shopping Cart and Instant Checkout Screen for Flutter App

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';

class CartView extends StatefulWidget {
  final List<Product> items;
  final VoidCallback onClearCart;

  const CartView({super.key, required this.items, required this.onClearCart});

  @override
  State<CartView> createState() => _CartViewState();
}

class _CartViewState extends State<CartView> {
  final ApiService _apiService = ApiService();
  bool _isCheckingOut = false;

  int get totalAmount {
    return widget.items.fold(0, (sum, item) => sum + item.lowestSalePrice);
  }

  Future<void> _handleCheckout() async {
    if (widget.items.isEmpty) return;

    setState(() => _isCheckingOut = true);
    final result = await _apiService.submitCheckout(
      recipientName: '홍길동',
      phone: '010-1234-5678',
      address: '서울특별시 강남구 테헤란로 152',
      amount: totalAmount,
    );

    setState(() => _isCheckingOut = false);
    if (!mounted) return;

    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('주문 결제 완료'),
        content: Text('주문번호 [${result['order_no']}]가 정상 승인되었습니다.\nCloudflare D1 데이터베이스에 안전하게 기록되었습니다.'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              widget.onClearCart();
            },
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shopping_cart_outlined, size: 64, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            const Text('장바구니가 비어 있습니다.', style: TextStyle(color: Colors.grey, fontSize: 14)),
          ],
        ),
      );
    }

    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: widget.items.length,
            separatorBuilder: (_, __) => const Divider(height: 24),
            itemBuilder: (context, index) {
              final p = widget.items[index];
              return Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(p.thumbnailUrl, width: 70, height: 70, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 6),
                        Text(
                          '₩${p.lowestSalePrice.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                          style: const TextStyle(color: Color(0xFFFA541C), fontWeight: FontWeight.bold, fontSize: 14),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 10, offset: const Offset(0, -4))],
          ),
          child: SafeArea(
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('총 결제 예정 금액', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    Text(
                      '₩${totalAmount.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}',
                      style: const TextStyle(color: Color(0xFFFA541C), fontWeight: FontWeight.w900, fontSize: 18),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isCheckingOut ? null : _handleCheckout,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFFA541C),
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _isCheckingOut
                        ? const CircularProgressIndicator(color: Colors.white)
                        : const Text('주문 및 즉시 결제하기', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

