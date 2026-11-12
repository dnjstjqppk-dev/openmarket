// H-4: cached thumbnails resolve to a visible state when the URL is empty.
// The loader error path (errorWidget) is plugin behavior and is not
// deterministically reachable here: the widget-test binding answers every
// HTTP request with 400 without hitting the network, so the error branch
// cannot be forced to settle. It is covered by build + review instead.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/product.dart';
import 'package:olmoa_customer/widgets/product_grid_card.dart';

Product _card(String thumb) => Product(
      id: 'p1',
      title: '테스트 상품',
      thumbnailUrl: thumb,
      descriptionHtml: '',
      lowestOriginalPrice: 10000,
      lowestSalePrice: 9000,
      totalSoldCount: 3,
    );

Widget _host(Product p) => MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 300,
          width: 200,
          child: ProductGridCard(product: p, onAddToCart: (_) {}),
        ),
      ),
    );

void main() {
  testWidgets('empty thumbnails render the fallback icon', (tester) async {
    await tester.pumpWidget(_host(_card('')));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.shopping_bag), findsOneWidget);
    expect(find.text('테스트 상품'), findsOneWidget);
  });
}
