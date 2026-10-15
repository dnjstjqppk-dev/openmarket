// mobile/customer_app/lib/main.dart
// OLMOA Customer Mobile App Main Entry Point
// Official Brand: OLMOA (올모아) | Slogan: 내가 찾는 모든 것, 여기.

import 'package:flutter/material.dart';
import 'models/product.dart';
import 'views/home_view.dart';
import 'views/cart_view.dart';
import 'views/orders_view.dart';

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
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: const Color(0xFFFA541C),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.shopping_bag_outlined, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 8),
            const Text(
              'OLMOA',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20, letterSpacing: -0.5, color: Color(0xFF1E293B)),
            ),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: Colors.orange.shade50, borderRadius: BorderRadius.circular(12)),
              child: const Text('올모아 글로벌', style: TextStyle(color: Color(0xFFFA541C), fontSize: 10, fontWeight: FontWeight.bold)),
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
