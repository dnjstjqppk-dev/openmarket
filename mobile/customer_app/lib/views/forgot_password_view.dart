// P2-MOB-P1: password-reset request. Reports the server's honest answer:
// with no mail provider integrated, no mail goes out and the user is told
// to contact support instead of waiting for a mail that never comes.
import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ForgotPasswordView extends StatefulWidget {
  const ForgotPasswordView({super.key});

  @override
  State<ForgotPasswordView> createState() => _ForgotPasswordViewState();
}

class _ForgotPasswordViewState extends State<ForgotPasswordView> {
  final _email = TextEditingController();
  bool _busy = false;
  String? _result;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim())) {
      setState(() => _result = '이메일 형식을 확인해 주세요.');
      return;
    }
    setState(() {
      _busy = true;
      _result = null;
    });
    final r = await AuthSession.forgotPassword(_email.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _sent = r['success'] == true && r['email_delivery'] == 'SENT';
      _result = (r['message'] ?? '요청을 처리하지 못했습니다.').toString();
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text('비밀번호 찾기',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
        const SizedBox(height: 8),
        const Text('가입한 이메일로 재설정 안내를 보내드립니다.',
            style: TextStyle(fontSize: 13, color: Colors.grey)),
        const SizedBox(height: 16),
        TextField(
            controller: _email,
            decoration: const InputDecoration(labelText: '이메일'),
            keyboardType: TextInputType.emailAddress),
        const SizedBox(height: 12),
        if (_result != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(_result!,
                style: TextStyle(
                    fontSize: 12,
                    color: _sent ? Colors.green.shade700 : Colors.red)),
          ),
        SizedBox(
          width: double.infinity,
          height: 48,
          child: ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: Text(_busy ? '요청 중...' : '안내 메일 받기'),
          ),
        ),
      ],
    );
  }
}
