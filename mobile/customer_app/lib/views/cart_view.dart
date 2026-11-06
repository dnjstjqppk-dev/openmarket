// mobile/customer_app/lib/views/cart_view.dart
// Shopping cart + checkout. Checkout calls the real POST /api/v1/orders/checkout
// with the signed-in JWT and only clears the cart when the server confirms.

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import 'login_view.dart';

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
  bool _authReady = false;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _zip = TextEditingController();
  final _addr1 = TextEditingController();
  final _addr2 = TextEditingController();
  final _memo = TextEditingController();

  @override
  void initState() {
    super.initState();
    _refreshAuth();
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _zip.dispose();
    _addr1.dispose();
    _addr2.dispose();
    _memo.dispose();
    super.dispose();
  }

  Future<void> _refreshAuth() async {
    await AuthSession.restore();
    if (mounted) setState(() => _authReady = true);
  }

  int get totalAmount {
    return widget.items.fold(0, (sum, item) => sum + item.lowestSalePrice);
  }

  void _showResult({required bool ok, required String title, required String message}) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              if (ok) widget.onClearCart();
            },
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleCheckout() async {
    if (widget.items.isEmpty || _isCheckingOut) return;
    if (_name.text.trim().isEmpty || _phone.text.trim().isEmpty || _zip.text.trim().isEmpty || _addr1.text.trim().isEmpty) {
      _showResult(ok: false, title: '배송지 입력 필요', message: '수령인, 연락처, 우편번호, 주소는 필수 입력 항목입니다.');
      return;
    }

    setState(() => _isCheckingOut = true);
    final result = await _apiService.submitCheckout(
      recipientName: _name.text.trim(),
      phone: _phone.text.trim(),
      addressLine1: _addr1.text.trim(),
      addressLine2: _addr2.text.trim(),
      postalCode: _zip.text.trim(),
      memo: _memo.text.trim(),
      products: widget.items,
    );
    if (!mounted) return;
    setState(() => _isCheckingOut = false);

    if (result['success'] == true) {
      final status = (result['payment_status'] ?? 'READY').toString();
      final paid = status == 'PAID';
      _showResult(
        ok: true,
        title: paid ? '주문 결제 완료' : '주문 접수 완료',
        message: paid
            ? '주문번호 [${result['order_no']}] 결제가 완료되었습니다.'
            : '주문번호 [${result['order_no']}]가 접수되었습니다.\n결제 예정액: ₩${result['total_pay_amount']}\n모바일 결제는 준비 중이므로 PC 웹에서 결제를 완료해 주세요.',
      );
    } else if (result['code'] == 'UNAUTHENTICATED') {
      setState(() {});
    } else {
      _showResult(ok: false, title: '주문 실패', message: (result['error'] ?? '주문을 생성하지 못했습니다.').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFFA541C)));
    }
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: () => setState(() {}), reason: '주문하기 전에 로그인해 주세요.');
    }
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
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ...widget.items.map((p) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.network(
                            p.thumbnailUrl,
                            width: 70,
                            height: 70,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              width: 70,
                              height: 70,
                              color: Colors.grey.shade100,
                              child: const Icon(Icons.shopping_bag, color: Colors.grey),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
                              const SizedBox(height: 6),
                              Text(
                                '₩${p.lowestSalePrice}',
                                style: const TextStyle(color: Color(0xFFFA541C), fontWeight: FontWeight.bold, fontSize: 14),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  )),
              const Divider(height: 24),
              const Text('배송지', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              const SizedBox(height: 12),
              TextField(controller: _name, decoration: const InputDecoration(labelText: '수령인 *', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(controller: _phone, decoration: const InputDecoration(labelText: '연락처 *', hintText: '010-0000-0000', border: OutlineInputBorder()), keyboardType: TextInputType.phone),
              const SizedBox(height: 10),
              TextField(controller: _zip, decoration: const InputDecoration(labelText: '우편번호 *', border: OutlineInputBorder()), keyboardType: TextInputType.number),
              const SizedBox(height: 10),
              TextField(controller: _addr1, decoration: const InputDecoration(labelText: '주소 *', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(controller: _addr2, decoration: const InputDecoration(labelText: '상세주소', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(controller: _memo, decoration: const InputDecoration(labelText: '배송 메모', border: OutlineInputBorder())),
              const SizedBox(height: 8),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, -4))],
          ),
          child: SafeArea(
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('총 결제 예정 금액', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    Text(
                      '₩$totalAmount',
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
                        : const Text('주문하기', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
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
