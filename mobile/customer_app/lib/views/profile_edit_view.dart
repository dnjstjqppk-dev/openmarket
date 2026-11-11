// P2-MOB-P6: profile edit (name + phone) via PUT /api/v1/auth/profile.
import 'package:flutter/material.dart';
import '../models/contact_input.dart';
import '../services/api_service.dart';

class ProfileEditView extends StatefulWidget {
  final VoidCallback onSaved;

  const ProfileEditView({super.key, required this.onSaved});

  @override
  State<ProfileEditView> createState() => _ProfileEditViewState();
}

class _ProfileEditViewState extends State<ProfileEditView> {
  final _name = TextEditingController(text: AuthSession.userName ?? '');
  final _phone = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = '이름을 입력해 주세요.');
      return;
    }
    if (_phone.text.trim().isNotEmpty) {
      final phoneErr = validateKrPhone(_phone.text);
      if (phoneErr != null) {
        setState(() => _error = phoneErr);
        return;
      }
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final r = await ApiService.updateProfile(
      fullName: _name.text.trim(),
      phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (r['success'] == true) {
      widget.onSaved();
    } else {
      setState(
          () => _error = (r['error'] ?? '회원 정보 수정에 실패했습니다.').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: '이름')),
        const SizedBox(height: 8),
        TextField(
            controller: _phone,
            decoration: const InputDecoration(
                labelText: '휴대폰 (변경 시만 입력)',
                hintText: '010-1234-5678'),
            keyboardType: TextInputType.phone),
        const SizedBox(height: 12),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_error!,
                style: const TextStyle(color: Colors.red, fontSize: 12)),
          ),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '저장 중...' : '저장'),
          ),
        ),
      ],
    );
  }
}
