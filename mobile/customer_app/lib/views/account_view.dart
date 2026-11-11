// mobile/customer_app/lib/views/account_view.dart
// Shows the signed-in member and signs out, or the login form when logged out.

import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'address_book_view.dart';
import 'login_view.dart';
import 'notifications_view.dart';
import 'profile_edit_view.dart';
import 'support_view.dart';
import 'wishlist_view.dart';

class AccountView extends StatefulWidget {
  final void Function(Product) onAddToCart;

  const AccountView({super.key, required this.onAddToCart});

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
    if (mounted) {
      setState(() {
        _ready = true;
        _loggedIn = AuthSession.isAuthenticated;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) return const Center(child: CircularProgressIndicator());
    if (!_loggedIn) {
      return LoginView(onSuccess: _refresh, reason: 'OLMOA 계정으로 로그인해 주세요.');
    }
    // P2-MOB-P6: the account tab is a menu into the service screens.
    void go(String title, Widget body) => Navigator.of(context).push(
          MaterialPageRoute(
              builder: (_) =>
                  Scaffold(appBar: AppBar(title: Text(title)), body: body)),
        );
    Widget entry(IconData icon, String label, VoidCallback onTap) =>
        ListTile(
            leading: Icon(icon, color: OlmoaColors.lagoon700),
            title: Text(label, style: const TextStyle(fontSize: 14)),
            trailing: const Icon(Icons.chevron_right, size: 18),
            onTap: onTap);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const SizedBox(height: 8),
        const Icon(Icons.account_circle,
            size: 72, color: OlmoaColors.lagoon600),
        const SizedBox(height: 12),
        Text('${AuthSession.userName ?? '회원'}님',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
        const SizedBox(height: 4),
        Text('주문 내역과 배송 조회가 가능합니다.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
        const SizedBox(height: 16),
        entry(Icons.favorite_border, '찜 목록',
            () => go('찜 목록', WishlistView(onAddToCart: widget.onAddToCart))),
        entry(Icons.bookmarks_outlined, '배송지 관리',
            () => go('배송지 관리', const AddressBookView())),
        entry(Icons.notifications_outlined, '알림함',
            () => go('알림함', const NotificationsView())),
        entry(Icons.support_agent_outlined, '고객센터 (FAQ·1:1 문의)',
            () => go('고객센터', const SupportView())),
        entry(Icons.badge_outlined, '회원 정보 수정', () => go(
            '회원 정보 수정',
            ProfileEditView(onSaved: () {
              Navigator.of(context).pop();
              _refresh();
            }))),
        const SizedBox(height: 8),
        Center(
          child: OutlinedButton(
            onPressed: () async {
              await AuthSession.logout();
              if (mounted) setState(() => _loggedIn = false);
            },
            child: const Text('로그아웃'),
          ),
        ),
      ],
    );
  }
}
