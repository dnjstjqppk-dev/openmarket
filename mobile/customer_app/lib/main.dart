// mobile/customer_app/lib/main.dart
// OLMOA Customer Mobile App Main Entry Point
// Official Brand: OLMOA (올모아) | Slogan: 내가 찾는 모든 것, 여기.

import 'package:flutter/material.dart';
import 'models/cart_line.dart';
import 'models/product.dart';
import 'theme/app_theme.dart';
import 'views/home_view.dart';
import 'views/cart_view.dart';
import 'views/orders_view.dart';
import 'views/account_view.dart';
import 'views/search_view.dart';
import 'widgets/responsive.dart';

void main() {
  runApp(const OlmoaCustomerApp());
}

class OlmoaCustomerApp extends StatelessWidget {
  const OlmoaCustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OLMOA',
      debugShowCheckedModeBanner: false,
      theme: buildOlmoaLightTheme(),
      darkTheme: buildOlmoaDarkTheme(),
      home: const OlmoaMainScreen(),
    );
  }
}

class OlmoaMainScreen extends StatefulWidget {
  const OlmoaMainScreen({super.key});

  @override
  State<OlmoaMainScreen> createState() => _OlmoaMainScreenState();
}

class _OlmoaMainScreenState extends State<OlmoaMainScreen> {
  int _currentIndex = 0;
  final List<CartLine> _cartLines = [];

  int get _cartCount => _cartLines.fold(0, (sum, l) => sum + l.quantity);

  void _addToCart(Product p) {
    setState(() {
      // Same orderable variant adds up; lines without a server SKU id stay
      // separate so they can never merge into an orderable line by accident.
      final key = p.defaultSkuId.isNotEmpty ? p.defaultSkuId : 'noid:${p.id}';
      CartLine? hit;
      for (final l in _cartLines) {
        final lk = l.skuId.isNotEmpty ? l.skuId : 'noid:${l.product.id}';
        if (lk == key) {
          hit = l;
          break;
        }
      }
      if (hit == null) {
        _cartLines.add(CartLine(product: p));
      } else if (hit.quantity < 99) {
        hit.quantity += 1;
      }
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('[${p.title}] 장바구니에 담겼습니다.'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  void _updateQty(CartLine line, int delta) {
    setState(() {
      final i = _cartLines.indexWhere((l) => identical(l, line));
      if (i < 0) return;
      _cartLines[i].quantity += delta;
      if (_cartLines[i].quantity < 1) {
        _cartLines.removeAt(i);
      } else if (_cartLines[i].quantity > 99) {
        _cartLines[i].quantity = 99;
      }
    });
  }

  void _removeLine(CartLine line) {
    setState(() {
      _cartLines.removeWhere((l) => identical(l, line));
    });
  }

  /// P1-M05: adopt server cart lines that are not already local (local
  /// quantities win on overlap — the user just edited them here).
  void _mergeServerLines(List<CartLine> server) {
    setState(() {
      final local = _cartLines.map((l) => l.skuId).where((s) => s.isNotEmpty).toSet();
      for (final s in server) {
        if (s.skuId.isEmpty || local.contains(s.skuId)) continue;
        _cartLines.add(s);
      }
    });
  }

  void _clearCart() {
    setState(() {
      _cartLines.clear();
      _currentIndex = 2; // Jump to orders view
    });
  }

  void _openSearch() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SearchView(onAddToCart: _addToCart)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final views = [
      HomeView(onAddToCart: _addToCart),
      CartView(
        lines: _cartLines,
        onUpdateQty: _updateQty,
        onRemoveLine: _removeLine,
        onMergeServerLines: _mergeServerLines,
        onClearCart: _clearCart,
      ),
      const OrdersView(),
      AccountView(onAddToCart: _addToCart),
    ];

    return AdaptiveScaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.shopping_bag_outlined,
                  color: Colors.white, size: 20),
            ),
            const SizedBox(width: 8),
            const Text(
              'OLMOA',
              style: TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 20,
                  letterSpacing: -0.5),
            ),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: OlmoaColors.lagoon50,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                '올모아 글로벌',
                style: TextStyle(
                    color: OlmoaColors.lagoon700,
                    fontSize: 10,
                    fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            tooltip: '검색',
            onPressed: _openSearch,
          ),
        ],
      ),
      body: views[_currentIndex],
      currentIndex: _currentIndex,
      onDestinationSelected: (index) => setState(() => _currentIndex = index),
      destinations: [
        const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: '홈'),
        NavigationDestination(
          icon: Badge(
            isLabelVisible: _cartLines.isNotEmpty,
            label: Text(_cartCount.toString()),
            child: const Icon(Icons.shopping_cart_outlined),
          ),
          selectedIcon: Badge(
            isLabelVisible: _cartLines.isNotEmpty,
            label: Text(_cartCount.toString()),
            child: const Icon(Icons.shopping_cart),
          ),
          label: '장바구니',
        ),
        const NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: '주문내역'),
        const NavigationDestination(
            icon: Icon(Icons.person_outlined),
            selectedIcon: Icon(Icons.person),
            label: '내 정보'),
      ],
    );
  }
}
