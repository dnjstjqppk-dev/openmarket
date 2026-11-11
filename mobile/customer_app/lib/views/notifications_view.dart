// P2-MOB-P6: notification inbox from GET /api/v1/notifications with
// per-item and mark-all-read. Pure announce-only items stay read-only.
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'login_view.dart';

class NotificationsView extends StatefulWidget {
  const NotificationsView({super.key});

  @override
  State<NotificationsView> createState() => _NotificationsViewState();
}

class _NotificationsViewState extends State<NotificationsView> {
  bool _authReady = false;
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _items = [];
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _init();
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
      final r = await ApiService.getNotifications();
      if (!mounted) return;
      setState(() {
        _items = (r['items'] as List).cast<Map<String, dynamic>>();
        _unread = (r['unread'] as num?)?.toInt() ?? 0;
      });
    } on AuthRequiredException {
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _readAll() async {
    await ApiService.readAllNotifications();
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _init, reason: '알림함은 로그인이 필요합니다.');
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(_unread > 0 ? '읽지 않음 $_unread건' : '모두 읽음',
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.bold)),
              if (_unread > 0)
                TextButton(
                    onPressed: _readAll, child: const Text('모두 읽음 처리')),
            ],
          ),
        ),
        Expanded(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
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
    if (_items.isEmpty) {
      return const Center(child: Text('알림이 없습니다.'));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _items.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final n = _items[index];
        final read = n['is_read'] == 1 || n['is_read'] == true;
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: Colors.grey.shade200),
          ),
          child: ListTile(
            title: Text((n['title'] ?? '').toString(),
                style: TextStyle(
                    fontWeight: read ? FontWeight.normal : FontWeight.bold,
                    fontSize: 13)),
            subtitle: Text((n['message'] ?? n['body'] ?? '').toString(),
                style: const TextStyle(fontSize: 12)),
            trailing: read
                ? null
                : TextButton(
                    onPressed: () async {
                      await ApiService.readNotification(n['id'].toString());
                      if (mounted) _load();
                    },
                    child: const Text('읽음'),
                  ),
          ),
        );
      },
    );
  }
}
