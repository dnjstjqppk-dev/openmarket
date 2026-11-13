// mobile/partner_app/lib/views/login_view.dart
// Seller sign-in against POST /api/v1/auth/login (role PARTNER).

import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../services/partner_api_service.dart';
import '../services/partner_push_service.dart';
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
    // P2-MOB-09: resolve strings before the async gaps (no context after await).
    final t = AppLocalizations.of(context);
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
      PartnerPushService.syncAfterLogin();
    } else {
      setState(() =>
          _error = (r['error'] ?? t?.errorLoginFailed ?? '로그인하지 못했습니다.')
              .toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    // P2-MOB-09: nullable lookup with Korean fallback (bare-context safe).
    final t = AppLocalizations.of(context);
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
            Text(t?.loginTitleSeller ?? '판매자 로그인',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Text(widget.reason,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            const SizedBox(height: 20),
            TextField(
              controller: _email,
              decoration: InputDecoration(
                  labelText: t?.fieldEmail ?? '이메일',
                  border: const OutlineInputBorder()),
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              decoration: InputDecoration(
                  labelText: t?.fieldPassword ?? '비밀번호',
                  border: const OutlineInputBorder()),
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
                    : Text(t?.actionLogin ?? '로그인',
                        style: const TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
