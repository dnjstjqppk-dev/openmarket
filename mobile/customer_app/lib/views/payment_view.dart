// mobile/customer_app/lib/views/payment_view.dart
// In-app payment for a READY order. The server decides the route via
// GET /api/v1/payments/config: the Toss payment widget when a client key is
// offered, the sandbox simulator confirm flow in development, and an honest
// disabled state otherwise. Approval is always confirmed server-side.
import 'package:flutter/material.dart';
import 'package:tosspayments_widget_sdk_flutter/model/payment_info.dart';
import 'package:tosspayments_widget_sdk_flutter/model/payment_widget_options.dart';
import 'package:tosspayments_widget_sdk_flutter/payment_widget.dart';
import 'package:tosspayments_widget_sdk_flutter/widgets/agreement.dart';
import 'package:tosspayments_widget_sdk_flutter/widgets/payment_method.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_guidance.dart';
import '../utils/payment_route.dart';

class PaymentView extends StatefulWidget {
  final String orderNo;
  final int amount;
  final List<String> titles;
  final String? expiresAt;
  final VoidCallback? onPaid;

  const PaymentView({
    super.key,
    required this.orderNo,
    required this.amount,
    required this.titles,
    this.expiresAt,
    this.onPaid,
  });

  @override
  State<PaymentView> createState() => _PaymentViewState();
}

class _PaymentViewState extends State<PaymentView> {
  PaymentRoute? _route;
  bool _isTestKey = false;
  String? _disabledMessage;
  bool _busy = false;
  String? _error;
  Map<String, dynamic>? _receipt;
  PaymentWidget? _toss;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final cfg = await ApiService.getPaymentConfig();
    if (!mounted) return;
    final mode = cfg['mode']?.toString();
    // NEW-08: the widget SDK needs the widget-issued key, never the v1 API key.
    final key = (cfg['widget_client_key'] ?? cfg['client_key'])?.toString();
    final route = paymentRouteFor(mode, (key == null || key.isEmpty) ? null : key);
    setState(() {
      _route = route;
      _isTestKey = cfg['is_test_key'] == true;
      _disabledMessage = cfg['message']?.toString();
      if (route == PaymentRoute.tossWidget) {
        _toss = PaymentWidget(
          clientKey: key!,
          customerKey: AuthSession.userId ?? PaymentWidget.anonymous,
        );
      }
    });
    if (route == PaymentRoute.tossWidget) {
      try {
        await _toss!.renderPaymentMethods(
          selector: 'payment-method',
          amount: Amount(value: widget.amount),
        );
        await _toss!.renderAgreement(selector: 'agreement');
      } catch (e) {
        if (mounted) setState(() => _error = '결제 위젯을 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    }
  }

  Future<void> _confirm(String paymentKey) async {
    setState(() => _busy = true);
    final res = await ApiService.confirmPayment(
      orderRef: widget.orderNo,
      paymentKey: paymentKey,
      amount: widget.amount,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (res['success'] == true) {
      setState(() {
        _receipt = Map<String, dynamic>.from(res['data'] as Map? ?? {});
        _error = null;
      });
    } else if (res['code'] == 'UNAUTHENTICATED') {
      setState(() => _error = '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    } else {
      setState(() => _error = (res['error'] ?? '결제 승인에 실패했습니다.').toString());
    }
  }

  Future<void> _payWithSimulator() async {
    await _confirm(simulatorKey());
  }

  Future<void> _payWithToss() async {
    if (_toss == null || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _toss!.requestPayment(
        paymentInfo: PaymentInfo(
          orderId: widget.orderNo,
          orderName: buildOrderName(widget.titles),
        ),
      );
      if (!mounted) return;
      if (result.success != null) {
        await _confirm(result.success!.paymentKey);
        return;
      }
      setState(() {
        _busy = false;
        _error = result.fail != null
            ? '결제에 실패했습니다 (${result.fail!.errorCode}: ${result.fail!.errorMessage})'
            : '결제가 완료되지 않았습니다. 다시 시도해 주세요.';
      });
    } catch (_) {
      if (mounted) setState(() => _busy = false);
      if (mounted) setState(() => _error = '결제창을 열지 못했습니다. 다시 시도해 주세요.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final guidance = computePaymentGuidance(expiresAt: widget.expiresAt);
    return Scaffold(
      appBar: AppBar(title: const Text('결제하기')),
      body: _receipt != null
          ? _buildReceipt()
          : _route == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    _summaryCard(guidance),
                    const SizedBox(height: 16),
                    if (_route == PaymentRoute.disabled) _disabledCard(),
                    if (_route == PaymentRoute.simulator) _simulatorCard(),
                    if (_route == PaymentRoute.tossWidget && _toss != null) ...[
                      if (_isTestKey)
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 12),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.amber.shade50,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.amber.shade200),
                          ),
                          child: const Text('테스트 키 · 실제 청구 없음',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
                        ),
                      PaymentMethodWidget(paymentWidget: _toss!, selector: 'payment-method'),
                      AgreementWidget(paymentWidget: _toss!, selector: 'agreement'),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton(
                          onPressed: _busy ? null : _payWithToss,
                          child: _busy
                              ? const CircularProgressIndicator(color: Colors.white)
                              : Text('₩${widget.amount} 결제하기',
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        ),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: OlmoaColors.ruby500, fontSize: 13)),
                    ],
                  ],
                ),
    );
  }

  Widget _summaryCard(PaymentGuidance guidance) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('주문번호 ${widget.orderNo}', style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('₩${widget.amount}',
                  style: const TextStyle(
                      color: OlmoaColors.ruby500, fontWeight: FontWeight.w900, fontSize: 22)),
              const SizedBox(height: 4),
              Text(guidance.deadlineText, style: const TextStyle(color: Colors.grey, fontSize: 12)),
            ],
          ),
        ),
      );

  Widget _disabledCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
              _disabledMessage ?? '결제 수단이 아직 연동되지 않았습니다. 잠시 후 다시 시도해 주세요.',
              style: const TextStyle(fontSize: 13)),
        ),
      );

  Widget _simulatorCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('개발용 결제 시뮬레이터 — 실제 결제가 발생하지 않습니다.',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _busy ? null : _payWithSimulator,
                  child: _busy
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('시뮬레이터로 결제 승인',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _buildReceipt() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.check_circle, color: Colors.green, size: 64),
              const SizedBox(height: 12),
              const Text('결제가 완료되었습니다.',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              Text('주문번호 ${widget.orderNo}', style: const TextStyle(fontSize: 13)),
              Text('결제액 ₩${widget.amount}',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () {
                    widget.onPaid?.call();
                    Navigator.of(context).pop();
                  },
                  child: const Text('주문내역 보기',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
              ),
            ],
          ),
        ),
      );
}
