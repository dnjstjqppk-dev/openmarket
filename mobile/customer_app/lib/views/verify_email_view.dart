// P2-MOB-P1: email verification redemption. Accepts a pasted token (the
// mailed link opens the web flow; the same token works here).
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class VerifyEmailView extends StatefulWidget {
  const VerifyEmailView({super.key});

  @override
  State<VerifyEmailView> createState() => _VerifyEmailViewState();
}

class _VerifyEmailViewState extends State<VerifyEmailView> {
  final _token = TextEditingController();
  bool _busy = false;
  String? _result;
  bool _ok = false;

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_token.text.trim().isEmpty) {
      setState(() => _result = '인증 코드를 입력해 주세요.');
      return;
    }
    setState(() {
      _busy = true;
      _result = null;
    });
    final r = await AuthSession.verifyEmail(_token.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _ok = r['success'] == true;
      _result = ((r['message'] ?? r['error']) ?? '인증하지 못했습니다.').toString();
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text('이메일 인증',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        const Text('메일로 받은 인증 코드를 붙여넣으세요. 코드는 24시간 동안 한 번만 사용할 수 있습니다.',
            style: TextStyle(fontSize: 13, color: Colors.grey)),
        const SizedBox(height: 16),
        TextField(
            controller: _token,
            decoration: const InputDecoration(labelText: '인증 코드')),
        const SizedBox(height: 12),
        if (_result != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_result!,
                style: TextStyle(
                    fontSize: 12,
                    color: _ok ? Colors.green.shade700 : Colors.red)),
          ),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '인증 중...' : '인증하기'),
          ),
        ),
      ],
    );
  }
}
