// mobile/partner_app/lib/main.dart
// OLMOA Partner Operations Mobile App Entry Point
// Official Brand: OLMOA Partner (올모아 판매자 센터)

import 'package:flutter/material.dart';
import 'views/dashboard_view.dart';
import 'views/shipment_view.dart';

void main() {
  runApp(const OlmoaPartnerApp());
}

class OlmoaPartnerApp extends StatelessWidget {
  const OlmoaPartnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OLMOA Partner',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4F46E5)),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF8F9FA),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1E1B4B),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
      ),
      home: const OlmoaPartnerMainScreen(),
    );
  }
}

class OlmoaPartnerMainScreen extends StatefulWidget {
  const OlmoaPartnerMainScreen({super.key});

  @override
  State<OlmoaPartnerMainScreen> createState() => _OlmoaPartnerMainScreenState();
}

class _OlmoaPartnerMainScreenState extends State<OlmoaPartnerMainScreen> {
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
            Icon(Icons.storefront, color: Color(0xFFFA541C)),
            SizedBox(width: 8),
            Text(
              'OLMOA Partner',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Colors.white),
            ),
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
