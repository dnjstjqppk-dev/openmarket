// mobile/customer_app/lib/main.dart
// OpenMarket Customer Mobile App Main Entry Point

import 'package:flutter/material.dart';
import 'models/product.dart';
import 'views/home_view.dart';
import 'views/cart_view.dart';
import 'views/orders_view.dart';

void main() {
  runApp(const OpenMarketCustomerApp());
}

class OpenMarketCustomerApp extends StatelessWidget {
  const OpenMarketCustomerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenMarket',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFFA541C)),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF8F9FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Colors.black87,
          elevation: 0,
        ),
      ),
      home: const MainNavigationScreen(),
    );
  }
}

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
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
        backgroundColor: const Color(0xFFFA541C),
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
    ];

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Icon(Icons.bolt, color: Color(0xFFFA541C)),
            const SizedBox(width: 6),
            const Text('OpenMarket', style: TextStyle(fontWeight: FontWeight.w900, letterSpacing: -0.5)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: Colors.orange.shade50, borderRadius: BorderRadius.circular(12)),
              child: const Text('Temu Benchmark', style: TextStyle(color: Color(0xFFFA541C), fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
      body: views[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        selectedItemColor: const Color(0xFFFA541C),
        unselectedItemColor: Colors.grey.shade400,
        items: [
          const BottomNavigationBarItem(icon: Icon(Icons.home), label: '홈'),
          BottomNavigationBarItem(
            icon: Badge(
              isLabelVisible: _cartItems.isNotEmpty,
              label: Text(_cartItems.length.toString()),
              child: const Icon(Icons.shopping_cart),
            ),
            label: '장바구니',
          ),
          const BottomNavigationBarItem(icon: Icon(Icons.receipt_long), label: '주문내역'),
        ],
      ),
    );
  }
}
