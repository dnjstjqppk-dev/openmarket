// Widget smoke tests for the new buyer flows. First-frame assertions only:
// parsers and guidance carry the logic coverage (search_models_test,
// payment_guidance_test) while these prove the views compose and mount.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/product.dart';
import 'package:olmoa_customer/views/product_detail_view.dart';
import 'package:olmoa_customer/views/search_view.dart';

void main() {
  void addNoop(Product _) {}

  testWidgets('search view mounts with the query field', (t) async {
    await t.pumpWidget(MaterialApp(home: SearchView(onAddToCart: addNoop)));
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('상품, 카테고리 검색'), findsOneWidget);
  });

  testWidgets('product detail mounts in the loading state', (t) async {
    await t.pumpWidget(
        MaterialApp(home: ProductDetailView(productId: 'prod_001', onAddToCart: addNoop)));
    expect(find.text('상품 상세'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsWidgets);
  });
}
