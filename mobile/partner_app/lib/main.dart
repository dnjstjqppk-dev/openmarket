// mobile/partner_app/lib/main.dart
// OLMOA Partner Operations Mobile App Entry Point
// Official Brand: OLMOA Partner (올모아 판매자 센터)

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:sentry/sentry.dart';
import 'models/sentry_options.dart';
import 'services/partner_push_service.dart';
import 'theme/app_theme.dart';
import 'views/dashboard_view.dart';
import 'views/shipment_view.dart';
import 'views/settlements_view.dart';
import 'views/account_view.dart';
import 'widgets/responsive.dart';

/// Wave J-2: new-order notification taps land on dispatch.
final GlobalKey<NavigatorState> partnerNavigatorKey =
    GlobalKey<NavigatorState>();

Future<void> _boot() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Wave J-2: dormant without Firebase console files (human step).
  await PartnerPushService.init();
  PartnerPushService.onNotificationTap = () {
    partnerNavigatorKey.currentState?.push(MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: const Text('출고·배송')),
        body: const PartnerShipmentView(),
      ),
    ));
  };
  runApp(const OlmoaPartnerApp());
}

void main() async {
  // Wave H-4: Dart crash reporting only when a DSN was injected at build
  // time (pure-Dart SDK; native crashes stay out of scope).
  final sentry = resolveSentryConfig(
    dsn: const String.fromEnvironment('SENTRY_DSN'),
    environment: const String.fromEnvironment('SENTRY_ENVIRONMENT',
        defaultValue: 'production'),
  );
  if (!sentry.enabled) return _boot();
  await Sentry.init((options) {
    options.dsn = sentry.dsn;
    options.environment = sentry.environment;
  });
  FlutterError.onError = (details) {
    Sentry.captureException(details.exception, stackTrace: details.stack);
  };
  return runZonedGuarded(
    _boot,
    (error, stack) => Sentry.captureException(error, stackTrace: stack),
  );
}

class OlmoaPartnerApp extends StatelessWidget {
  const OlmoaPartnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OLMOA Partner',
      debugShowCheckedModeBanner: false,
      navigatorKey: partnerNavigatorKey,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('ko'), Locale('en')],
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
          onNavigateToShipments: () => setState(() => _currentIndex = 1),
          onNavigateToSettlements: () => setState(() => _currentIndex = 2)),
      const PartnerShipmentView(),
      const PartnerSettlementsView(),
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
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: '정산'),
        NavigationDestination(
            icon: Icon(Icons.person_outlined),
            selectedIcon: Icon(Icons.person),
            label: '내 정보'),
      ],
    );
  }
}
