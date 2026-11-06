// mobile/partner_app/lib/views/account_view.dart
// Signed-in seller identity and sign-out, or the login form when logged out.

import 'package:flutter/material.dart';
import '../services/partner_api_service.dart';
import 'login_view.dart';

class PartnerAccountView extends StatefulWidget {
  const PartnerAccountView({super.key});

  @override
  State<PartnerAccountView> createState() => _PartnerAccountViewState();
}

class _PartnerAccountViewState extends State<PartnerAccountView> {
  bool _ready = false;
  bool _loggedIn = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    await PartnerAuthSession.restore();
    if (mounted) setState(() {
      _ready = true;
      _loggedIn = PartnerAuthSession.isAuthenticated;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Center(child: CircularProgressIndicator(color: Color(0xFF4F46E5)));
    if (!_loggedIn) return PartnerLoginView(onSuccess: _refresh);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.store, size: 72, color: Color(0xFF4F46E5)),
          const SizedBox(height: 12),
          Text('${PartnerAuthSession.businessName ?? '판매자'}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('출고·배송 관리가 가능합니다.', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () async {
              await PartnerAuthSession.logout();
              if (mounted) setState(() => _loggedIn = false);
            },
            child: const Text('로그아웃'),
          ),
        ],
      ),
    );
  }
}
