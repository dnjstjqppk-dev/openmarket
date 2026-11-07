// mobile/customer_app/lib/main.dart
// OLMOA Customer Mobile App Main Entry Point
// Official Brand: OLMOA (올모아) | Slogan: 내가 찾는 모든 것, 여기.

import 'package:flutter/material.dart';
import 'models/product.dart';
import 'theme/app_theme.dart';
import 'views/home_view.dart';
import 'views/cart_view.dart';
import 'views/orders_view.dart';
import 'views/account_view.dart';
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
  final List<Product> _cartItems = [];

  void _addToCart(Product p) {
    setState(() {
      _cartItems.add(p);
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('[${p.title}] 장바구니에 담겼습니다.'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  void _clearCart() {
    setState(() {
      _cartItems.clear();
      _currentIndex = 2; // Jump to orders view
    });
  }

  @override
  Widget build(BuildContext context) {
    final views = [
      HomeView(onAddToCart: _addToCart),
      CartView(items: _cartItems, onClearCart: _clearCart),
      const OrdersView(),
      const AccountView(),
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
            isLabelVisible: _cartItems.isNotEmpty,
            label: Text(_cartItems.length.toString()),
            child: const Icon(Icons.shopping_cart_outlined),
          ),
          selectedIcon: Badge(
            isLabelVisible: _cartItems.isNotEmpty,
            label: Text(_cartItems.length.toString()),
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
