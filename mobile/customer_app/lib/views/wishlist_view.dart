// P2-MOB-P2: wishlist list from GET /api/v1/wishlist. Tap opens the
// product detail; the heart removes the row (server toggle).
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import 'login_view.dart';
import 'product_detail_view.dart';

class WishlistView extends StatefulWidget {
  final void Function(Product) onAddToCart;

  const WishlistView({super.key, required this.onAddToCart});

  @override
  State<WishlistView> createState() => _WishlistViewState();
}

class _WishlistViewState extends State<WishlistView> {
  bool _authReady = false;
  bool _isLoading = true;
  String? _error;
  List<Map<String, dynamic>> _rows = [];

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
      final rows = await ApiService.getWishlist();
      if (mounted) setState(() => _rows = rows);
    } on AuthRequiredException {
      if (mounted) setState(() {});
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _remove(String productId) async {
    final r = await ApiService.toggleWishlist(productId);
    if (!mounted) return;
    if (r['success'] == true) {
      await _load();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((r['error'] ?? '찜 해제에 실패했습니다.').toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_authReady) return const Center(child: CircularProgressIndicator());
    if (!AuthSession.isAuthenticated) {
      return LoginView(onSuccess: _init, reason: '찜 목록은 로그인이 필요합니다.');
    }
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
    if (_rows.isEmpty) {
      return const Center(
        child: Text('찜한 상품이 없습니다.',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _rows.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final p = _rows[index];
        final id = (p['product_id'] ?? p['id'] ?? '').toString();
        return Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: Colors.grey.shade200),
          ),
          child: ListTile(
            leading: (p['thumbnail_url'] ?? '').toString().isNotEmpty
                ? ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network((p['thumbnail_url'] ?? '').toString(),
                        width: 48, height: 48, fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) =>
                            const Icon(Icons.image_not_supported)),
                  )
                : const Icon(Icons.image_not_supported),
            title: Text((p['title'] ?? '').toString(),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            subtitle: Text((p['brand'] ?? '').toString(),
                style: const TextStyle(fontSize: 11, color: Colors.grey)),
            trailing: IconButton(
              tooltip: '찜 해제',
              icon: const Icon(Icons.favorite, color: Colors.pink),
              onPressed: () => _remove(id),
            ),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                  builder: (_) => ProductDetailView(
                      productId: id, onAddToCart: widget.onAddToCart)),
            ),
          ),
        );
      },
    );
  }
}
