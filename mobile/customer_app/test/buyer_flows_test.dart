// Widget smoke tests for the new buyer flows. First-frame assertions only:
// parsers and guidance carry the logic coverage (search_models_test,
// payment_guidance_test) while these prove the views compose and mount.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_customer/models/product.dart';
import 'package:olmoa_customer/views/order_detail_view.dart';
import 'package:olmoa_customer/views/payment_view.dart';
import 'package:olmoa_customer/views/product_detail_view.dart';
import 'package:olmoa_customer/views/search_view.dart';

void main() {
  void addNoop(Product _) {}

  testWidgets('search view mounts with the query field', (t) async {
    await t.pumpWidget(MaterialApp(home: SearchView(onAddToCart: addNoop)));
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('상품, 카테고리 검색'), findsOneWidget);
  });

  testWidgets('payment view mounts in the loading state', (t) async {
    await t.pumpWidget(const MaterialApp(
        home: PaymentView(orderNo: 'ORD-1', amount: 1000, titles: ['t'])));
    expect(find.text('결제하기'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('order detail mounts in the loading state', (t) async {
    await t.pumpWidget(
        const MaterialApp(home: OrderDetailView(orderId: 'o1')));
    expect(find.text('주문 상세'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('product detail mounts in the loading state', (t) async {
    await t.pumpWidget(
        MaterialApp(home: ProductDetailView(productId: 'prod_001', onAddToCart: addNoop)));
    expect(find.text('상품 상세'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsWidgets);
  });
}
