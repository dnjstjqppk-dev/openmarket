// P2-MOB-P1: sign-up. Utilizes POST /api/v1/auth/register, whose success
// response carries a session token — registration signs the user in.
import 'package:flutter/material.dart';
import '../models/contact_input.dart';
import '../services/api_service.dart';
import '../services/push_service.dart';

class RegisterView extends StatefulWidget {
  final VoidCallback onSuccess;

  const RegisterView({super.key, required this.onSuccess});

  @override
  State<RegisterView> createState() => _RegisterViewState();
}

class _RegisterViewState extends State<RegisterView> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  bool _agreeMarketing = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim())) {
      setState(() => _error = '이메일 형식을 확인해 주세요.');
      return;
    }
    if (_password.text.length < 10) {
      setState(() => _error = '비밀번호는 10자 이상이어야 합니다.');
      return;
    }
    if (_name.text.trim().isEmpty) {
      setState(() => _error = '이름을 입력해 주세요.');
      return;
    }
    final phoneErr = validateKrPhone(_phone.text);
    if (phoneErr != null) {
      setState(() => _error = phoneErr);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final r = await AuthSession.register(
      email: _email.text,
      password: _password.text,
      fullName: _name.text,
      phone: _phone.text,
      agreeMarketing: _agreeMarketing,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (r['success'] == true) {
      widget.onSuccess();
      PushService.syncAfterLogin();
    } else {
      setState(
          () => _error = (r['error'] ?? '회원가입에 실패했습니다.').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text('회원가입',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
        const SizedBox(height: 16),
        TextField(
            controller: _email,
            decoration: const InputDecoration(labelText: '이메일'),
            keyboardType: TextInputType.emailAddress),
        const SizedBox(height: 8),
        TextField(
            controller: _password,
            decoration:
                const InputDecoration(labelText: '비밀번호 (10자 이상)'),
            obscureText: true),
        const SizedBox(height: 8),
        TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: '이름')),
        const SizedBox(height: 8),
        TextField(
            controller: _phone,
            decoration: const InputDecoration(
                labelText: '휴대폰', hintText: '010-1234-5678'),
            keyboardType: TextInputType.phone),
        const SizedBox(height: 8),
        Row(children: [
          Checkbox(
              value: _agreeMarketing,
              onChanged: (v) => setState(() => _agreeMarketing = v ?? false)),
          const Text('마케팅 수신 동의 (선택)', style: TextStyle(fontSize: 13)),
        ]),
        const Text('가입 시 이용약관·개인정보처리방침에 동의하게 됩니다.',
            style: TextStyle(fontSize: 11, color: Colors.grey)),
        const SizedBox(height: 8),
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
            child: Text(_busy ? '가입 중...' : '가입하기'),
          ),
        ),
      ],
    );
  }
}
