// P2-MOB-P4: saved address book — list, select into checkout, set default,
// delete, and add. Previously getAddresses() had zero view call sites, so
// buyers retyped the address on every order.
import 'package:flutter/material.dart';
import '../models/contact_input.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'login_view.dart';

class AddressBookView extends StatefulWidget {
  /// When set, tapping an address returns it to the caller (checkout picker).
  final ValueChanged<Map<String, dynamic>>? onSelect;

  const AddressBookView({super.key, this.onSelect});

  @override
  State<AddressBookView> createState() => _AddressBookViewState();
}

class _AddressBookViewState extends State<AddressBookView> {
  bool _authReady = false;
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _rows = [];
  bool _showForm = false;
  bool _saving = false;
  String? _formError;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _zip = TextEditingController();
  final _addr1 = TextEditingController();
  final _addr2 = TextEditingController();
  bool _asDefault = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _zip.dispose();
    _addr1.dispose();
    _addr2.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    await AuthSession.restore();
    if (!mounted) return;
    setState(() => _authReady = true);
    if (AuthSession.isAuthenticated) _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final rows = await ApiService.getAddresses();
      if (mounted) setState(() => _rows = rows);
    } on AuthRequiredException {
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _addr1.text.trim().isEmpty) {
      setState(() => _formError = '수령인과 주소는 필수입니다.');
      return;
    }
    final phoneErr = validateKrPhone(_phone.text);
    if (phoneErr != null) {
      setState(() => _formError = phoneErr);
      return;
    }
    final zipErr = validateKrPostal(_zip.text);
    if (zipErr != null) {
      setState(() => _formError = zipErr);
      return;
    }
    setState(() {
      _saving = true;
      _formError = null;
    });
    final r = await ApiService.createAddress(
      recipientName: _name.text.trim(),
      phone: _phone.text.trim(),
      postalCode: _zip.text.trim(),
      addressLine1: _addr1.text.trim(),
      addressLine2: _addr2.text.trim(),
      isDefault: _asDefault,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (r['success'] == true) {
      setState(() {
        _showForm = false;
        _asDefault = false;
      });
      _name.clear();
      _phone.clear();
      _zip.clear();
      _addr1.clear();
      _addr2.clear();
      await _load();
    } else if (r['code'] == 'UNAUTHENTICATED') {
      await AuthSession.logout();
      if (mounted) setState(() {});
    } else {
      setState(() => _formError = (r['error'] ?? '배송지 등록에 실패했습니다.').toString());
    }
  }

  Future<void> _setDefault(String id) async {
    final r = await ApiService.setDefaultAddress(id);
    if (!mounted) return;
    if (r['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((r['error'] ?? '기본 배송지 변경에 실패했습니다.').toString())),
      );
    }
  }

  Future<void> _delete(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('배송지 삭제'),
        content: const Text('이 배송지를 삭제할까요?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('삭제')),
        ],
      ),
    );
    if (ok != true) return;
    final r = await ApiService.deleteAddress(id);
    if (!mounted) return;
    if (r['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((r['error'] ?? '배송지 삭제에 실패했습니다.').toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _init, reason: '배송지 관리는 로그인이 필요합니다.');
    }
    if (_isLoading) return const Center(child: CircularProgressIndicator());
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
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (widget.onSelect != null)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('주문에 사용할 배송지를 고르세요.',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
          ),
        if (_rows.isEmpty && !_showForm)
          const Card(
              child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('등록된 배송지가 없습니다.')))),
        for (final a in _rows)
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Colors.grey.shade200),
            ),
            child: ListTile(
              title: Text(
                  '${a['recipient_name'] ?? ''} · ${(a['phone'] ?? '').toString()}',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              subtitle: Text(
                  '${a['address_line1'] ?? ''} ${(a['address_line2'] ?? '').toString()}${(a['is_default'] == 1) ? ' · 기본' : ''}',
                  style: const TextStyle(fontSize: 12)),
              trailing: widget.onSelect != null
                  ? ElevatedButton(
                      onPressed: () => widget.onSelect!(a),
                      child: const Text('선택'),
                    )
                  : PopupMenuButton<String>(
                      onSelected: (v) {
                        if (v == 'default') _setDefault(a['id'].toString());
                        if (v == 'delete') _delete(a['id'].toString());
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'default', child: Text('기본으로 설정')),
                        PopupMenuItem(value: 'delete', child: Text('삭제')),
                      ],
                    ),
            ),
          ),
        const SizedBox(height: 12),
        if (!_showForm)
          OutlinedButton.icon(
            onPressed: () => setState(() => _showForm = true),
            icon: const Icon(Icons.add),
            label: const Text('새 배송지 등록'),
          ),
        if (_showForm) ...[
          TextField(controller: _name, decoration: const InputDecoration(labelText: '수령인')),
          const SizedBox(height: 8),
          TextField(
              controller: _phone,
              decoration: const InputDecoration(labelText: '연락처', hintText: '010-1234-5678'),
              keyboardType: TextInputType.phone),
          const SizedBox(height: 8),
          TextField(
              controller: _zip,
              decoration: const InputDecoration(labelText: '우편번호', hintText: '5자리'),
              keyboardType: TextInputType.number,
              maxLength: 5),
          const SizedBox(height: 8),
          TextField(controller: _addr1, decoration: const InputDecoration(labelText: '주소')),
          const SizedBox(height: 8),
          TextField(controller: _addr2, decoration: const InputDecoration(labelText: '상세주소 (선택)')),
          const SizedBox(height: 8),
          Row(children: [
            Checkbox(value: _asDefault, onChanged: (v) => setState(() => _asDefault = v ?? false)),
            const Text('기본 배송지로 저장', style: TextStyle(fontSize: 13)),
          ]),
          if (_formError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child:
                  Text(_formError!, style: const TextStyle(color: OlmoaColors.danger, fontSize: 12)),
            ),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? '저장 중...' : '저장'),
            ),
          ),
        ],
      ],
    );
  }
}
