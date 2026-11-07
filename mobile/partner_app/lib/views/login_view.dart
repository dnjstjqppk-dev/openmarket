// mobile/partner_app/lib/views/login_view.dart
// Seller sign-in against POST /api/v1/auth/login (role PARTNER).

import 'package:flutter/material.dart';
import '../services/partner_api_service.dart';
import '../theme/app_theme.dart';

class PartnerLoginView extends StatefulWidget {
  final VoidCallback onSuccess;
  final String reason;

  const PartnerLoginView(
      {super.key, required this.onSuccess, this.reason = '판매자 계정으로 로그인해 주세요.'});

  @override
  State<PartnerLoginView> createState() => _PartnerLoginViewState();
}

class _PartnerLoginViewState extends State<PartnerLoginView> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final r = await PartnerAuthSession.login(
        email: _email.text, password: _password.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (r['success'] == true) {
      widget.onSuccess();
    } else {
      setState(() => _error = (r['error'] ?? '로그인하지 못했습니다.').toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.storefront,
                size: 48, color: OlmoaColors.lagoon600),
            const SizedBox(height: 12),
            const Text('판매자 로그인',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Text(widget.reason,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            const SizedBox(height: 20),
            TextField(
              controller: _email,
              decoration: const InputDecoration(
                  labelText: '이메일', border: OutlineInputBorder()),
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              decoration: const InputDecoration(
                  labelText: '비밀번호', border: OutlineInputBorder()),
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              onSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
            ],
            const SizedBox(height: 16),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: _busy ? null : _submit,
                style: ElevatedButton.styleFrom(
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            color: Colors.white, strokeWidth: 2))
                    : const Text('로그인',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
