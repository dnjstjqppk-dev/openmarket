// mobile/partner_app/lib/main.dart
// OLMOA Partner Operations Mobile App Entry Point
// Official Brand: OLMOA Partner (올모아 판매자 센터)

import 'package:flutter/material.dart';
import 'theme/app_theme.dart';
import 'views/dashboard_view.dart';
import 'views/shipment_view.dart';
import 'views/account_view.dart';
import 'widgets/responsive.dart';

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
      theme: buildOlmoaLightTheme(),
      darkTheme: buildOlmoaDarkTheme(),
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
      PartnerDashboardView(
          onNavigateToShipments: () => setState(() => _currentIndex = 1)),
      const PartnerShipmentView(),
      const PartnerAccountView(),
    ];

    return AdaptiveScaffold(
      appBar: AppBar(
        backgroundColor: OlmoaColors.lagoon900,
        foregroundColor: Colors.white,
        title: const Row(
          children: [
            Icon(Icons.storefront, color: OlmoaColors.amber400),
            SizedBox(width: 8),
            Text(
              'OLMOA Partner',
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                  color: Colors.white),
            ),
          ],
        ),
      ),
      body: views[_currentIndex],
      currentIndex: _currentIndex,
      onDestinationSelected: (index) => setState(() => _currentIndex = index),
      destinations: const [
        NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: '대시보드'),
        NavigationDestination(
            icon: Icon(Icons.local_shipping_outlined),
            selectedIcon: Icon(Icons.local_shipping),
            label: '출고·배송'),
        NavigationDestination(
            icon: Icon(Icons.person_outlined),
            selectedIcon: Icon(Icons.person),
            label: '내 정보'),
      ],
    );
  }
}
