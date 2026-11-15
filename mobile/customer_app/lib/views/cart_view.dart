// mobile/customer_app/lib/views/cart_view.dart
// Shopping cart + checkout. Lines carry quantities and sync to the server
// cart (PUT /api/v1/cart); checkout goes through the real quote contract
// (coupon, credit with the Phase-1 policy, PCCC) before POST /checkout.
// The cart only clears when the server confirms the order.

import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../models/cart_line.dart';
import '../models/contact_input.dart';
import '../models/coupon_selection.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_guidance.dart';
import '../widgets/product_grid_card.dart';
import 'address_book_view.dart';
import 'login_view.dart';
import 'payment_view.dart';

class CartView extends StatefulWidget {
  final List<CartLine> lines;
  final void Function(CartLine line, int delta) onUpdateQty;
  final void Function(CartLine line) onRemoveLine;
  final void Function(List<CartLine> server) onMergeServerLines;
  final VoidCallback onClearCart;
  final void Function(Product) onAddToCart;

  const CartView({
    super.key,
    required this.lines,
    required this.onUpdateQty,
    required this.onRemoveLine,
    required this.onMergeServerLines,
    required this.onClearCart,
    required this.onAddToCart,
  });

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
  // P1-M04 checkout options.
  final _credit = TextEditingController();
  final _pccc = TextEditingController();
  List<Map<String, dynamic>> _coupons = [];
  // 3-12: two-level picks like the web order sheet — one platform coupon
  // plus one store coupon per seller in the cart.
  String? _platformCouponId;
  Map<String, String> _storePicks = {};
  int _creditBalance = 0;
  bool _optionsLoading = false;
  String? _optionsError;
  // P1-M04 server quote (dry run).
  Map<String, dynamic>? _quote;
  bool _quoteLoading = false;
  String? _quoteError;
  Timer? _quoteDebounce;
  // P1-M05 server sync status.
  String? _syncError;
  bool _syncing = false;
  bool _pulled = false;
  // P1-M06: a dead session mid-flow returns to login with an expiry notice.
  bool _sessionExpired = false;

  @override
  void initState() {
    super.initState();
    _refreshAuth();
  }

  @override
  void dispose() {
    _quoteDebounce?.cancel();
    _name.dispose();
    _phone.dispose();
    _zip.dispose();
    _addr1.dispose();
    _addr2.dispose();
    _memo.dispose();
    _credit.dispose();
    _pccc.dispose();
    super.dispose();
  }

  Future<void> _refreshAuth() async {
    await AuthSession.restore();
    if (!mounted) return;
    setState(() {
      _authReady = true;
      _sessionExpired = false;
    });
    if (AuthSession.isAuthenticated) {
      _pullServerCart();
      _loadOptions();
    }
  }

  /// P1-M06: the refresh already failed inside the service — the token is
  /// dead, so drop it, tell the user, and show the login form with context.
  Future<void> _handleSessionExpired() async {
    if (!mounted) return;
    await AuthSession.logout();
    if (!mounted) return;
    setState(() => _sessionExpired = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('로그인이 만료되었습니다. 다시 로그인해 주세요.')),
    );
  }

  List<Map<String, Object>> get _orderItems => cartLinesToOrderItems(widget.lines);

  int get _localTotal => widget.lines.fold(0, (sum, l) => sum + l.product.lowestSalePrice * l.quantity);

  int get _creditWant => int.tryParse(_credit.text.trim()) ?? 0;

  /// P1-M05: adopt server lines once per view mount, then push the merged set.
  Future<void> _pullServerCart() async {
    if (_pulled) return;
    _pulled = true;
    setState(() {
      _syncing = true;
      _syncError = null;
    });
    try {
      final rows = await ApiService.getCart();
      if (!mounted) return;
      final server = rows.map(CartLine.fromServer).where((l) => l.skuId.isNotEmpty).toList();
      final before = widget.lines.length;
      widget.onMergeServerLines(server);
      final added = widget.lines.length - before;
      if (added > 0 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('서버 장바구니에서 $added개 상품을 불러왔습니다.')),
        );
      }
      await _pushCart();
    } on AuthRequiredException {
      await _handleSessionExpired();
    } on ApiException catch (e) {
      if (mounted) setState(() => _syncError = e.message);
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
    _scheduleQuote();
  }

  Future<void> _pushCart() async {
    if (!AuthSession.isAuthenticated) return;
    setState(() {
      _syncing = true;
      _syncError = null;
    });
    final r = await ApiService.syncCart(_orderItems);
    if (!mounted) return;
    setState(() {
      _syncing = false;
      if (r['success'] != true) {
        _syncError = (r['error'] ?? '서버 장바구니 저장에 실패했습니다. (로컬 변경은 유지됩니다)').toString();
      }
    });
  }

  Future<void> _mutate(FutureOr<void> Function() change) async {
    await change();
    if (!mounted) return;
    setState(() {
      _storePicks =
          pruneStorePicks(_storePicks, _cartSellers.toSet(), _coupons);
    });
    _scheduleQuote();
    await _pushCart();
  }

  Future<void> _loadOptions() async {
    setState(() {
      _optionsLoading = true;
      _optionsError = null;
    });
    try {
      final results = await Future.wait([
        ApiService.getUsableCoupons(),
        ApiService.getCreditBalance(),
      ]);
      if (!mounted) return;
      setState(() {
        _coupons = (results[0] as List<Map<String, dynamic>>);
        _creditBalance = (results[1] as int);
        _storePicks = pruneStorePicks(_storePicks, _cartSellers.toSet(), _coupons);
        if (_platformCouponId != null &&
            !platformCoupons(_coupons).any((c) => (c['user_coupon_id'] ?? '').toString() == _platformCouponId)) {
          _platformCouponId = null;
        }
      });
    } on AuthRequiredException {
      await _handleSessionExpired();
    } on ApiException catch (e) {
      if (mounted) setState(() => _optionsError = e.message);
    } finally {
      if (mounted) setState(() => _optionsLoading = false);
    }
    _scheduleQuote();
  }

  void _scheduleQuote() {
    _quoteDebounce?.cancel();
    if (widget.lines.isEmpty) {
      setState(() {
        _quote = null;
        _quoteError = null;
      });
      return;
    }
    _quoteDebounce = Timer(const Duration(milliseconds: 600), _loadQuote);
  }

  Future<void> _loadQuote() async {
    if (widget.lines.isEmpty || !AuthSession.isAuthenticated) return;
    setState(() {
      _quoteLoading = true;
      _quoteError = null;
    });
    final r = await ApiService.getQuote(
      items: _orderItems,
      userCouponId: _platformCouponId,
      storeCouponIds: _storePicks.values.toList(),
      useCreditAmount: _creditWant,
      pccc: _pccc.text.trim().isEmpty ? null : _pccc.text.trim().toUpperCase(),
      postalCode: _zip.text.trim().isEmpty ? null : _zip.text.trim(),
    );
    if (!mounted) return;
    if (r['code'] == 'UNAUTHENTICATED') {
      setState(() => _quoteLoading = false);
      await _handleSessionExpired();
      return;
    }
    setState(() {
      _quoteLoading = false;
      if (r['success'] == true) {
        _quote = Map<String, dynamic>.from(r['data'] as Map);
      } else {
        _quote = null;
        _quoteError = (r['error'] ?? '견적 조회에 실패했습니다.').toString();
      }
    });
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

  void _showPaymentGuide(Map<String, dynamic> result) {
    final guidance = computePaymentGuidance(expiresAt: result['payment_expires_at']?.toString());
    final orderNo = (result['order_no'] ?? '').toString();
    final amount = result['total_pay_amount'];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Icon(
                    guidance.expired ? Icons.error_outline : Icons.check_circle_outline,
                    color: guidance.expired ? OlmoaColors.ruby500 : Colors.green),
                const SizedBox(width: 8),
                Text(guidance.expired ? '결제 시간 만료' : '주문 접수 완료',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              ]),
              const SizedBox(height: 16),
              _guideRow('주문번호', orderNo.isEmpty ? '-' : orderNo),
              _guideRow('결제 예정액', amount == null ? '-' : '₩$amount'),
              _guideRow('결제 기한', guidance.deadlineText),
              const SizedBox(height: 8),
              const Text('기한 내 미결제 시 주문이 자동 취소됩니다.',
                  style: TextStyle(fontSize: 13, color: Colors.grey)),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: guidance.expired
                      ? null
                      : () {
                          Navigator.pop(context);
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => PaymentView(
                                orderNo: orderNo,
                                amount: amount is int
                                    ? amount
                                    : int.tryParse(amount.toString()) ?? 0,
                                titles: widget.lines.map((l) => l.product.title).toList(),
                                expiresAt: result['payment_expires_at']?.toString(),
                                onPaid: () {
                                  widget.onClearCart();
                                  _pushCart();
                                },
                              ),
                            ),
                          );
                        },
                  style: ElevatedButton.styleFrom(
                    elevation: 0,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('앱에서 결제하기',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.pop(context);
                    widget.onClearCart();
                    _pushCart();
                  },
                  child: const Text('나중에 결제',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _guideRow(String k, String v) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(
              width: 90,
              child: Text(k, style: const TextStyle(color: Colors.grey, fontSize: 13))),
          Expanded(
              child: Text(v,
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13))),
        ]),
      );

  /// P2-MOB-P4: fill the form from a saved address instead of retyping.
  Future<void> _pickAddress() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('배송지 선택')),
          body: AddressBookView(
            onSelect: (a) {
              setState(() {
                _name.text = (a['recipient_name'] ?? '').toString();
                _phone.text = (a['phone'] ?? '').toString();
                _zip.text = (a['postal_code'] ?? '').toString();
                _addr1.text = (a['address_line1'] ?? '').toString();
                _addr2.text = (a['address_line2'] ?? '').toString();
              });
              Navigator.of(context).pop();
              _scheduleQuote();
            },
          ),
        ),
      ),
    );
  }

  Future<void> _handleCheckout() async {
    if (widget.lines.isEmpty || _isCheckingOut) return;
    if (_name.text.trim().isEmpty ||
        _phone.text.trim().isEmpty ||
        _zip.text.trim().isEmpty ||
        _addr1.text.trim().isEmpty) {
      _showResult(
          ok: false,
          title: '배송지 입력 필요',
          message: '수령인, 연락처, 우편번호, 주소는 필수 입력 항목입니다.');
      return;
    }
    // N-05: shape-check before submit so a typo fails here, not at the server.
    final phoneErr = validateKrPhone(_phone.text);
    if (phoneErr != null) {
      _showResult(ok: false, title: '연락처 확인', message: phoneErr);
      return;
    }
    final zipErr = validateKrPostal(_zip.text);
    if (zipErr != null) {
      _showResult(ok: false, title: '우편번호 확인', message: zipErr);
      return;
    }
    // Expand lines back to per-unit products for the existing checkout merge.
    final units = <Product>[];
    for (final l in widget.lines) {
      for (var i = 0; i < l.quantity; i++) {
        units.add(l.product);
      }
    }

    setState(() => _isCheckingOut = true);
    final result = await _apiService.submitCheckout(
      recipientName: _name.text.trim(),
      phone: _phone.text.trim(),
      addressLine1: _addr1.text.trim(),
      addressLine2: _addr2.text.trim(),
      postalCode: _zip.text.trim(),
      memo: _memo.text.trim(),
      products: units,
      userCouponId: _platformCouponId,
      storeCouponIds: _storePicks.values.toList(),
      useCreditAmount: _creditWant,
      pccc: _pccc.text.trim().isEmpty ? null : _pccc.text.trim().toUpperCase(),
    );
    if (!mounted) return;
    setState(() => _isCheckingOut = false);

    if (result['success'] == true) {
      _showPaymentGuide(result);
    } else if (result['code'] == 'UNAUTHENTICATED') {
      setState(() {});
    } else {
      _showResult(
          ok: false,
          title: '주문 실패',
          message: (result['error'] ?? '주문을 생성하지 못했습니다.').toString());
    }
  }

  List<String> get _cartSellers =>
      cartSellerIds(widget.lines.map((l) => l.product.partnerId).toList());

  String _sellerLabel(String sellerId, List<Map<String, dynamic>> rows) {
    for (final l in widget.lines) {
      if (l.product.partnerId == sellerId && l.product.businessName.isNotEmpty) {
        return l.product.businessName;
      }
    }
    for (final c in rows) {
      final name = (c['seller_name'] ?? '').toString();
      if (name.isNotEmpty) return name;
    }
    return '스토어';
  }

  String _couponLabel(Map<String, dynamic> c) {
    final name = (c['name'] ?? c['title'] ?? c['code'] ?? '쿠폰').toString();
    final type = (c['discount_type'] ?? '').toString();
    final value = c['discount_value'];
    final min = c['min_order_amount'];
    final discount = type == 'PERCENT'
        ? '$value%${c['max_discount_amount'] != null ? ' (최대 ₩${c['max_discount_amount']})' : ''}'
        : '₩$value 할인';
    final cond = (min is num && min > 0) ? ' · ₩$min 이상' : '';
    return '$name — $discount$cond';
  }

  String _won(dynamic v) {
    final n = v is int ? v : int.tryParse(v?.toString() ?? '') ?? 0;
    return '₩${n.toString().replaceAllMapped(RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')}';
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!AuthSession.isAuthenticated) {
      return LoginView(
          onSuccess: () => setState(() {
                _sessionExpired = false;
                _refreshAuth();
              }),
          reason: _sessionExpired
              ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
              : '주문하기 전에 로그인해 주세요.');
    }
    if (widget.lines.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shopping_cart_outlined,
                size: 64, color: Colors.grey.shade300),
            const SizedBox(height: 16),
            const Text('장바구니가 비어 있습니다.',
                style: TextStyle(color: Colors.grey, fontSize: 14)),
          ],
        ),
      );
    }

    return Column(
      children: [
        if (_syncError != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.amber.shade50,
            child: Row(children: [
              Icon(Icons.cloud_off_outlined, size: 16, color: Colors.amber.shade800),
              const SizedBox(width: 8),
              Expanded(
                child: Text(_syncError!,
                    style: TextStyle(fontSize: 12, color: Colors.amber.shade900)),
              ),
              TextButton(
                onPressed: _pushCart,
                child: const Text('다시 저장'),
              ),
            ]),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ...widget.lines.map((l) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: l.product.thumbnailUrl.isEmpty
                              ? Container(
                                  width: 70,
                                  height: 70,
                                  color: Colors.grey.shade100,
                                  child: const Icon(Icons.shopping_bag,
                                      color: Colors.grey),
                                )
                              : CachedNetworkImage(
                                  imageUrl: l.product.thumbnailUrl,
                                  width: 70,
                                  height: 70,
                                  fit: BoxFit.cover,
                                  placeholder: (_, __) => Container(
                                    width: 70,
                                    height: 70,
                                    color: Colors.grey.shade100,
                                  ),
                                  errorWidget: (_, __, ___) => Container(
                                    width: 70,
                                    height: 70,
                                    color: Colors.grey.shade100,
                                    child: const Icon(Icons.shopping_bag,
                                        color: Colors.grey),
                                  ),
                                ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(l.product.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold)),
                              const SizedBox(height: 6),
                              Text(
                                _won(l.product.lowestSalePrice * l.quantity),
                                style: const TextStyle(
                                    color: OlmoaColors.ruby500,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14),
                              ),
                              if (l.skuId.isEmpty)
                                const Text('주문 불가: 판매 옵션 정보 없음',
                                    style: TextStyle(
                                        color: OlmoaColors.ruby500,
                                        fontSize: 11)),
                            ],
                          ),
                        ),
                        Column(
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.remove_circle_outline,
                                      size: 22),
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(),
                                  onPressed: () => _mutate(() async =>
                                      widget.onUpdateQty(l, -1)),
                                  tooltip: '수량 감소',
                                ),
                                SizedBox(
                                  width: 28,
                                  child: Text('${l.quantity}',
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14)),
                                ),
                                IconButton(
                                  icon: const Icon(Icons.add_circle_outline,
                                      size: 22),
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(),
                                  onPressed: () => _mutate(() async =>
                                      widget.onUpdateQty(l, 1)),
                                  tooltip: '수량 증가',
                                ),
                              ],
                            ),
                            TextButton(
                              onPressed: () => _mutate(() async =>
                                  widget.onRemoveLine(l)),
                              child: const Text('삭제',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.grey)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  )),
              _CartBundleStrip(
                  ids: widget.lines
                      .map((l) => l.product.id)
                      .where((id) => id.isNotEmpty)
                      .toSet()
                      .toList(),
                  onAddToCart: widget.onAddToCart),
              const Divider(height: 24),
              const Text('쿠폰 · 적립금 · 통관번호',
                  style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
              const SizedBox(height: 12),
              if (_optionsLoading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: LinearProgressIndicator(),
                ),
              if (_optionsError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(children: [
                    Expanded(
                      child: Text(_optionsError!,
                          style: const TextStyle(
                              fontSize: 12, color: OlmoaColors.ruby500)),
                    ),
                    TextButton(
                      onPressed: _loadOptions,
                      child: const Text('다시 불러오기'),
                    ),
                  ]),
                ),
              Builder(builder: (context) {
                final platform = platformCoupons(_coupons);
                final bySeller = storeCouponsBySeller(_coupons);
                final sellers = _cartSellers.where(bySeller.containsKey).toList();
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final seller in sellers) ...[
                      DropdownButtonFormField<String>(
                        initialValue: _storePicks[seller],
                        decoration: InputDecoration(
                            labelText:
                                '${_sellerLabel(seller, bySeller[seller]!)} 쿠폰',
                            border: const OutlineInputBorder()),
                        items: [
                          const DropdownMenuItem<String>(
                              value: null, child: Text('스토어 쿠폰 사용 안 함')),
                          for (final c in bySeller[seller]!)
                            DropdownMenuItem<String>(
                              value: (c['user_coupon_id'] ?? '').toString(),
                              child: Text(_couponLabel(c),
                                  overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) {
                          setState(() {
                            if (v == null) {
                              _storePicks.remove(seller);
                            } else {
                              _storePicks[seller] = v;
                            }
                          });
                          _scheduleQuote();
                        },
                      ),
                      const SizedBox(height: 10),
                    ],
                    DropdownButtonFormField<String>(
                      initialValue: _platformCouponId,
                      decoration: const InputDecoration(
                          labelText: '플랫폼 쿠폰 선택',
                          border: OutlineInputBorder()),
                      items: [
                        const DropdownMenuItem<String>(
                            value: null, child: Text('플랫폼 쿠폰 사용 안 함')),
                        for (final c in platform)
                          DropdownMenuItem<String>(
                            value: (c['user_coupon_id'] ?? '').toString(),
                            child: Text(_couponLabel(c),
                                overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) {
                        setState(() => _platformCouponId = v);
                        _scheduleQuote();
                      },
                    ),
                    const SizedBox(height: 10),
                  ],
                );
              }),
              TextField(
                controller: _credit,
                decoration: InputDecoration(
                  labelText: '적립금 사용 (보유 ${_won(_creditBalance)})',
                  hintText: '0',
                  border: const OutlineInputBorder(),
                  helperText: '3만원 이상 주문 시 상품결제액의 20%까지 · 미인증 계정 사용 불가 (서버에서 최종 검증)',
                  helperMaxLines: 2,
                ),
                keyboardType: TextInputType.number,
                onChanged: (_) => _scheduleQuote(),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _pccc,
                decoration: const InputDecoration(
                  labelText: '개인통관고유부호 (해외직구 상품 포함 시 필수)',
                  hintText: 'P로 시작하는 13자리 (예: P123456789012)',
                  border: OutlineInputBorder(),
                ),
                textCapitalization: TextCapitalization.characters,
                onChanged: (_) => _scheduleQuote(),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.grey.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.grey.shade200),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Text('서버 견적',
                          style: TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 13)),
                      const Spacer(),
                      if (_quoteLoading)
                        const SizedBox(
                          width: 16,
                          height: 16,
                          child:
                              CircularProgressIndicator(strokeWidth: 2),
                        )
                      else
                        TextButton(
                          onPressed: _loadQuote,
                          child: const Text('견적 새로고침'),
                        ),
                    ]),
                    if (_quoteError != null)
                      Text(_quoteError!,
                          style: const TextStyle(
                              fontSize: 12,
                              color: OlmoaColors.ruby500)),
                    if (_quoteError == null && _quote != null) ...[
                      _guideRow('상품 합계', _won(_quote!['total_goods_amount'])),
                      if (((_quote!['volume_discount_amount'] as num?) ?? 0) > 0)
                        _guideRow('수량 할인',
                            '-${_won(_quote!['volume_discount_amount'])}'),
                      if (((_quote!['coupon_discount_amount'] as num?) ?? 0) > 0)
                        _guideRow('쿠폰 할인',
                            '-${_won(_quote!['coupon_discount_amount'])}'),
                      if (((_quote!['credit_used_amount'] as num?) ?? 0) > 0)
                        _guideRow('적립금 사용',
                            '-${_won(_quote!['credit_used_amount'])}'),
                      _guideRow('배송비', _won(_quote!['total_shipping_amount'])),
                      if ((_quote!['remote_zone'] ?? '').toString().isNotEmpty)
                        Text(
                            '${_quote!['remote_zone']} 추가배송비가 판매자별로 포함되어 있습니다.',
                            style: const TextStyle(
                                fontSize: 12, color: Colors.grey)),
                      if (_quote!['requires_pccc'] == true)
                        const Text('해외직구 상품 포함 — 개인통관고유부호가 필요합니다.',
                            style: TextStyle(
                                fontSize: 12,
                                color: OlmoaColors.ruby500,
                                fontWeight: FontWeight.bold)),
                    ],
                    if (_quoteError == null && _quote == null && !_quoteLoading)
                      const Text('쿠폰·적립금·통관번호를 입력하면 서버 견적이 표시됩니다.',
                          style:
                              TextStyle(fontSize: 12, color: Colors.grey)),
                  ],
                ),
              ),
              const Divider(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('배송지',
                      style:
                          TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
                  TextButton.icon(
                    onPressed: _pickAddress,
                    icon: const Icon(Icons.bookmarks_outlined, size: 16),
                    label: const Text('주소록', style: TextStyle(fontSize: 13)),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                  controller: _name,
                  decoration: const InputDecoration(
                      labelText: '수령인 *', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(
                  controller: _phone,
                  decoration: const InputDecoration(
                      labelText: '연락처 *',
                      hintText: '010-0000-0000',
                      border: OutlineInputBorder()),
                  keyboardType: TextInputType.phone),
              const SizedBox(height: 10),
              TextField(
                  controller: _zip,
                  decoration: const InputDecoration(
                      labelText: '우편번호 *', border: OutlineInputBorder()),
                  keyboardType: TextInputType.number,
                  onChanged: (_) => _scheduleQuote()),
              const SizedBox(height: 10),
              TextField(
                  controller: _addr1,
                  decoration: const InputDecoration(
                      labelText: '주소 *', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(
                  controller: _addr2,
                  decoration: const InputDecoration(
                      labelText: '상세주소', border: OutlineInputBorder())),
              const SizedBox(height: 10),
              TextField(
                  controller: _memo,
                  decoration: const InputDecoration(
                      labelText: '배송 메모', border: OutlineInputBorder())),
              const SizedBox(height: 8),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 10,
                  offset: const Offset(0, -4))
            ],
          ),
          child: SafeArea(
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                        _quote != null ? '서버 견적 결제액' : '총 결제 예정 금액 (견적 전)',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 13)),
                    Text(
                      _quote != null
                          ? _won(_quote!['total_pay_amount'])
                          : _won(_localTotal),
                      style: const TextStyle(
                          color: OlmoaColors.ruby500,
                          fontWeight: FontWeight.w900,
                          fontSize: 18),
                    ),
                  ],
                ),
                if (_syncing)
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('서버 장바구니 저장 중…',
                        style: TextStyle(fontSize: 11, color: Colors.grey)),
                  ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isCheckingOut ? null : _handleCheckout,
                    style: ElevatedButton.styleFrom(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _isCheckingOut
                        ? const CircularProgressIndicator(color: Colors.white)
                        : const Text('주문하기',
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 15)),
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

/// H-3: cross-sell strip fed by the cart-bundle endpoint. Hidden while the
/// cart ids are empty or the fetch answers nothing.
class _CartBundleStrip extends StatefulWidget {
  final List<String> ids;
  final void Function(Product) onAddToCart;

  const _CartBundleStrip({required this.ids, required this.onAddToCart});

  @override
  State<_CartBundleStrip> createState() => _CartBundleStripState();
}

class _CartBundleStripState extends State<_CartBundleStrip> {
  List<Product> _rows = [];
  String _loadedKey = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant _CartBundleStrip oldWidget) {
    super.didUpdateWidget(oldWidget);
    _load();
  }

  Future<void> _load() async {
    final key = widget.ids.join(',');
    if (key == _loadedKey) return;
    _loadedKey = key;
    if (widget.ids.isEmpty) {
      if (mounted) setState(() => _rows = []);
      return;
    }
    final rows = await ApiService.getCartBundle(widget.ids, limit: 5);
    if (mounted && _loadedKey == key) setState(() => _rows = rows);
  }

  @override
  Widget build(BuildContext context) {
    if (_rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        const Text('함께 구매하면 좋은 상품',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 15)),
        const SizedBox(height: 8),
        SizedBox(
          height: 240,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _rows.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (context, i) => SizedBox(
              width: 160,
              child: ProductGridCard(
                  product: _rows[i], onAddToCart: widget.onAddToCart),
            ),
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }
}
