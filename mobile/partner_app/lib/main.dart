// mobile/partner_app/lib/main.dart
// OpenMarket Partner Seller Operations Mobile App Entry Point

import 'package:flutter/material.dart';
import 'views/dashboard_view.dart';
import 'views/shipment_view.dart';

void main() {
  runApp(const OpenMarketPartnerApp());
}

class OpenMarketPartnerApp extends StatelessWidget {
  const OpenMarketPartnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenMarket Partner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4F46E5)),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF8F9FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF312E81),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
      ),
      home: const PartnerMainNavigation(),
    );
  }
}

class PartnerMainNavigation extends StatefulWidget {
  const PartnerMainNavigation({super.key});

  @override
  State<PartnerMainNavigation> createState() => _PartnerMainNavigationState();
}

class _PartnerMainNavigationState extends State<PartnerMainNavigation> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final views = [
      PartnerDashboardView(onNavigateToShipments: () => setState(() => _currentIndex = 1)),
      const PartnerShipmentView(),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.store, color: Color(0xFF818CF8)),
            SizedBox(width: 8),
            Text('OpenMarket Seller', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          ],
        ),
      ),
      body: views[_currentIndex],
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        selectedItemColor: const Color(0xFF4F46E5),
        items: const [
          BottomNavigationBarItem(icon: Icon(Icons.dashboard), label: '대시보드'),
          BottomNavigationBarItem(icon: Icon(Icons.local_shipping), label: '출고·배송'),
        ],
      ),
    );
  }
}
