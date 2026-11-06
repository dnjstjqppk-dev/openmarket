// mobile/customer_app/lib/views/account_view.dart
// Shows the signed-in member and signs out, or the login form when logged out.

import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'login_view.dart';

class AccountView extends StatefulWidget {
  const AccountView({super.key});

  @override
  State<AccountView> createState() => _AccountViewState();
}

class _AccountViewState extends State<AccountView> {
  bool _ready = false;
  bool _loggedIn = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    await AuthSession.restore();
    if (mounted) setState(() {
      _ready = true;
      _loggedIn = AuthSession.isAuthenticated;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Center(child: CircularProgressIndicator(color: Color(0xFFFA541C)));
    if (!_loggedIn) return LoginView(onSuccess: _refresh, reason: 'OLMOA 계정으로 로그인해 주세요.');
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.account_circle, size: 72, color: Color(0xFFFA541C)),
          const SizedBox(height: 12),
          Text('${AuthSession.userName ?? '회원'}님', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('주문 내역과 배송 조회가 가능합니다.', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
          const SizedBox(height: 24),
          OutlinedButton(
            onPressed: () async {
              await AuthSession.logout();
              if (mounted) setState(() => _loggedIn = false);
            },
            child: const Text('로그아웃'),
          ),
        ],
      ),
    );
  }
}
