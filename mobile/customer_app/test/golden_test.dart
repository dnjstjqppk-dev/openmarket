// Rendered captures (goldens) of deterministic screens: login form and the
// adaptive scaffold branch (bottom nav on phones, side rail on tablets).
// Network-fed screens (home feed) are captured on a real device (device lab).
// Regenerate: flutter test --update-goldens test/golden_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/theme/app_theme.dart';
import 'package:olmoa_customer/views/login_view.dart';
import 'package:olmoa_customer/widgets/responsive.dart';

void setSurface(WidgetTester tester, double width, double height) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

Widget themed(Widget child) => MaterialApp(theme: buildOlmoaLightTheme(), home: Scaffold(body: child));

void main() {
  testWidgets('login form on a 390 phone', (tester) async {
    setSurface(tester, 390, 844);
    await tester.pumpWidget(themed(LoginView(onSuccess: () {}, reason: '골든 캡처용')));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/login_phone_390.png'));
  });

  testWidgets('login form on a 768 tablet', (tester) async {
    setSurface(tester, 768, 1024);
    await tester.pumpWidget(themed(LoginView(onSuccess: () {}, reason: '골든 캡처용')));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/login_tablet_768.png'));
  });

  Widget scaffold() => MaterialApp(
        theme: buildOlmoaLightTheme(),
        home: AdaptiveScaffold(
          appBar: AppBar(title: const Text('OLMOA')),
          body: const Center(child: Text('본문 영역')),
          currentIndex: 0,
          onDestinationSelected: (_) {},
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), label: '홈'),
            NavigationDestination(icon: Icon(Icons.shopping_cart_outlined), label: '장바구니'),
            NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: '주문내역'),
            NavigationDestination(icon: Icon(Icons.person_outlined), label: '내 정보'),
          ],
        ),
      );

  testWidgets('scaffold uses bottom nav on a 390 phone', (tester) async {
    setSurface(tester, 390, 844);
    await tester.pumpWidget(scaffold());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/scaffold_phone_390.png'));
  });

  testWidgets('scaffold uses a side rail on a 1024 tablet', (tester) async {
    setSurface(tester, 1024, 768);
    await tester.pumpWidget(scaffold());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('goldens/scaffold_tablet_1024.png'));
  });
}
