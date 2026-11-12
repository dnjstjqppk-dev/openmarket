// mobile/partner_app/lib/views/profile_view.dart
// Wave G2: seller profile — read-only identity (locked server-side),
// editable contact/fee/cycle settings, and the payout-account change
// request (operator verification, never applied directly).

import 'package:flutter/material.dart';
import '../models/partner_profile.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

class PartnerProfileView extends StatefulWidget {
  const PartnerProfileView({super.key});

  @override
  State<PartnerProfileView> createState() => _PartnerProfileViewState();
}

class _PartnerProfileViewState extends State<PartnerProfileView> {
  final PartnerApiService _api = PartnerApiService();
  PartnerProfile? _profile;
  bool _loading = true;
  bool _authReady = false;
  String? _error;
  bool _saving = false;
  String? _formError;

  final _cycle = ValueNotifier<String?>(null);
  final _baseFee = TextEditingController();
  final _freeThreshold = TextEditingController();
  final _returnFee = TextEditingController();
  final _csPhone = TextEditingController();
  final _returnAddr = TextEditingController();
  final _bizAddr = TextEditingController();
  final _csEmail = TextEditingController();
  final _bankCode = TextEditingController();
  final _bankAccount = TextEditingController();
  final _bankHolder = TextEditingController();

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _cycle.dispose();
    _baseFee.dispose();
    _freeThreshold.dispose();
    _returnFee.dispose();
    _csPhone.dispose();
    _returnAddr.dispose();
    _bizAddr.dispose();
    _csEmail.dispose();
    _bankCode.dispose();
    _bankAccount.dispose();
    _bankHolder.dispose();
    super.dispose();
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
      _formError = null;
    });
    try {
      final p = await _api.fetchPartnerProfile();
      if (!mounted) return;
      _cycle.value = p.settlementCycle;
      _baseFee.text = p.baseShippingFee.toString();
      _freeThreshold.text = p.freeShippingThreshold.toString();
      _returnFee.text = (p.returnShippingFee ?? p.baseShippingFee).toString();
      _csPhone.text = p.customerServicePhone;
      _returnAddr.text = p.returnShippingAddress;
      _bizAddr.text = p.businessAddress;
      _csEmail.text = p.csEmail;
      _bankCode.text = p.bankCode;
      _bankAccount.text = '';
      _bankHolder.text = p.bankAccountHolder;
      setState(() => _profile = p);
    } on PartnerAuthRequiredException {
      if (mounted) setState(() {});
    } on PartnerApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _save() async {
    final p = _profile;
    if (p == null || _saving) return;
    final err = validateProfileFees(
      baseFeeRaw: _baseFee.text,
      freeThresholdRaw: _freeThreshold.text,
      returnFeeRaw: _returnFee.text,
      csEmail: _csEmail.text,
    );
    if (err != null) {
      setState(() => _formError = err);
      return;
    }
    int parse(String raw) => int.parse(raw.replaceAll(RegExp(r'[,\s]'), ''));
    final fields = <String, dynamic>{};
    if (_cycle.value != null && _cycle.value != p.settlementCycle) {
      fields['settlement_cycle'] = _cycle.value;
    }
    if (_baseFee.text.trim().isNotEmpty &&
        parse(_baseFee.text) != p.baseShippingFee) {
      fields['base_shipping_fee'] = parse(_baseFee.text);
    }
    if (_freeThreshold.text.trim().isNotEmpty &&
        parse(_freeThreshold.text) != p.freeShippingThreshold) {
      fields['free_shipping_threshold'] = parse(_freeThreshold.text);
    }
    if (_returnFee.text.trim().isNotEmpty &&
        parse(_returnFee.text) != (p.returnShippingFee ?? p.baseShippingFee)) {
      fields['return_shipping_fee'] = parse(_returnFee.text);
    }
    if (_csPhone.text.trim() != p.customerServicePhone) {
      fields['customer_service_phone'] = _csPhone.text.trim();
    }
    if (_returnAddr.text.trim() != p.returnShippingAddress) {
      fields['return_shipping_address'] = _returnAddr.text.trim();
    }
    if (_bizAddr.text.trim() != p.businessAddress) {
      fields['business_address'] = _bizAddr.text.trim();
    }
    if (_csEmail.text.trim().toLowerCase() != p.csEmail) {
      fields['cs_email'] = _csEmail.text.trim();
    }
    // A new account number (or holder/code change) queues an operator
    // verification request; the masked value is never echoed back.
    if (_bankAccount.text.trim().isNotEmpty ||
        _bankHolder.text.trim() != p.bankAccountHolder ||
        _bankCode.text.trim() != p.bankCode) {
      if (_bankCode.text.trim().isNotEmpty) {
        fields['bank_code'] = _bankCode.text.trim();
      }
      if (_bankAccount.text.trim().isNotEmpty) {
        fields['bank_account_number'] = _bankAccount.text.trim();
      }
      if (_bankHolder.text.trim().isNotEmpty) {
        fields['bank_account_holder'] = _bankHolder.text.trim();
      }
    }
    if (fields.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('변경된 내용이 없습니다.')),
      );
      return;
    }
    setState(() {
      _saving = true;
      _formError = null;
    });
    final res = await _api.savePartnerProfile(fields);
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['ok'] == true) {
      final data = res['data'] is Map<String, dynamic>
          ? res['data'] as Map<String, dynamic>
          : <String, dynamic>{};
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(
                (data['message'] ?? '설정이 저장되었습니다.').toString())),
      );
      _load();
    } else {
      setState(() => _formError = (res['error'] ?? '저장 실패').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!PartnerAuthSession.isAuthenticated) {
      return PartnerLoginView(
          onSuccess: _init, reason: '프로필을 보려면 판매자 계정으로 로그인해 주세요.');
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
    final p = _profile!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _sectionTitle('사업자 정보'),
          _identityCard(p),
          const SizedBox(height: 8),
          const Text('상호·대표자명·통신판매업 신고번호 변경은 사업자등록증 재심사가 필요합니다. 고객센터로 요청해 주세요.',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),
          _sectionTitle('정산·배송 설정'),
          const SizedBox(height: 8),
          ValueListenableBuilder<String?>(
            valueListenable: _cycle,
            builder: (context, value, _) => DropdownButtonFormField<String>(
              initialValue: value,
              decoration: const InputDecoration(
                  labelText: '정산 주기', border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: 'WEEKLY', child: Text('매주 정산')),
                DropdownMenuItem(value: 'BIWEEKLY', child: Text('격주 정산')),
                DropdownMenuItem(value: 'MONTHLY', child: Text('월 정산')),
              ],
              onChanged: (v) => _cycle.value = v,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                  child: TextField(
                      controller: _baseFee,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                          labelText: '기본 배송비(원)',
                          border: OutlineInputBorder()))),
              const SizedBox(width: 10),
              Expanded(
                  child: TextField(
                      controller: _freeThreshold,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                          labelText: '무료배송 기준(원)',
                          border: OutlineInputBorder()))),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
              controller: _returnFee,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                  labelText: '반품 배송비(원, 편도)',
                  border: OutlineInputBorder())),
          const SizedBox(height: 16),
          _sectionTitle('고객 응대 정보'),
          const SizedBox(height: 8),
          TextField(
              controller: _csPhone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                  labelText: '고객센터 전화', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(
              controller: _csEmail,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                  labelText: '고객센터 이메일', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(
              controller: _bizAddr,
              decoration: const InputDecoration(
                  labelText: '사업장 주소', border: OutlineInputBorder())),
          const SizedBox(height: 10),
          TextField(
              controller: _returnAddr,
              decoration: const InputDecoration(
                  labelText: '반품 수령 주소', border: OutlineInputBorder())),
          const SizedBox(height: 16),
          _sectionTitle('정산 계좌'),
          const SizedBox(height: 8),
          _bankCard(p),
          const SizedBox(height: 10),
          Row(
            children: [
              SizedBox(
                  width: 110,
                  child: TextField(
                      controller: _bankCode,
                      decoration: const InputDecoration(
                          labelText: '은행코드',
                          border: OutlineInputBorder()))),
              const SizedBox(width: 10),
              Expanded(
                  child: TextField(
                      controller: _bankAccount,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                          labelText: '새 계좌번호(변경 시만)',
                          border: OutlineInputBorder()))),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
              controller: _bankHolder,
              decoration: const InputDecoration(
                  labelText: '예금주', border: OutlineInputBorder())),
          const SizedBox(height: 4),
          const Text('계좌 변경은 운영자 실명 확인 후 반영됩니다.',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          if (_formError != null) ...[
            const SizedBox(height: 8),
            Text(_formError!,
                style: const TextStyle(color: Colors.red, fontSize: 12)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          color: Colors.white, strokeWidth: 2))
                  : const Text('저장',
                      style:
                          TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Text(title,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900));
  }

  Widget _identityCard(PartnerProfile p) {
    return Card(
      margin: const EdgeInsets.only(top: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            _kv('상호', p.businessName),
            _kv('사업자등록번호', p.businessRegNumber),
            _kv('대표자명',
                p.representativeName.isEmpty ? '-' : p.representativeName),
            _kv('통신판매업 신고번호',
                p.mailOrderRegNumber.isEmpty ? '-' : p.mailOrderRegNumber),
            _kv('판매 모델', p.salesModelLabel),
            _kv('수수료율', '${p.commissionRate}%',
                last: true),
          ],
        ),
      ),
    );
  }

  Widget _bankCard(PartnerProfile p) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                      '${p.bankCode} ${p.bankAccountMasked ?? '-'} (${p.bankAccountHolder})',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 14)),
                ),
                _chip(
                    p.payoutAccountVerified ? '실명 확인됨' : '실명 미확인',
                    p.payoutAccountVerified
                        ? const Color(0xFF1E7E34)
                        : const Color(0xFF8A5A00),
                    p.payoutAccountVerified
                        ? const Color(0xFFE6F4EA)
                        : const Color(0xFFFFF3DC)),
              ],
            ),
            if (p.payoutChangePending)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text('계좌 변경 요청이 운영자 확인 대기중입니다.',
                    style: TextStyle(
                        color: OlmoaColors.lagoon700,
                        fontSize: 12,
                        fontWeight: FontWeight.bold)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String key, String value, {bool last = false}) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 120,
              child: Text(key,
                  style:
                      TextStyle(color: Colors.grey.shade600, fontSize: 13))),
          Expanded(
              child: Text(value,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13))),
        ],
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
}
