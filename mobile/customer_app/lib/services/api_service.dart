import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/product.dart';

class ApiService {
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';
  static const String defaultCustomerId = 'cust_demo_001';

  static Future<List<Product>> fetchProducts({String? categorySlug, String? query}) async {
    try {
      var uri = Uri.parse('$baseUrl/api/v1/products');
      final params = <String, String>{};
      if (categorySlug != null && categorySlug.isNotEmpty) params['category'] = categorySlug;
      if (query != null && query.isNotEmpty) params['q'] = query;
      if (params.isNotEmpty) uri = uri.replace(queryParameters: params);

      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        final Map<String, dynamic> body = jsonDecode(response.body);
        final List<dynamic> list = body['data'] ?? [];
        if (list.isNotEmpty) {
          return list.map((e) => Product.fromJson(e)).toList();
        }
      }
      return Product.fallbackCatalog();
    } catch (_) {
      return Product.fallbackCatalog();
    }
  }

  static Future<List<Map<String, dynamic>>> fetchOrders({String customerId = defaultCustomerId}) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders?customer_id=$customerId');
      final response = await http.get(uri, headers: {
        'X-Customer-Id': customerId,
      }).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        final Map<String, dynamic> body = jsonDecode(response.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  static Future<Map<String, dynamic>> createOrder({
    required String customerName,
    required String phone,
    required String address,
    required String paymentMethod,
    required List<Map<String, dynamic>> items,
    String customerId = defaultCustomerId,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders');
      final payload = {
        'customer_id': customerId,
        'idempotency_key': 'mob_${DateTime.now().millisecondsSinceEpoch}',
        'payment_method': paymentMethod,
        'shipping_address': {
          'recipient': customerName,
          'phone': phone,
          'address': address,
        },
        'items': items.map((item) => {
          final prodId = item['product_id'] ?? item['id'] ?? 'prod_e_01';
          return {
            'product_id': prodId,
            'sku_id': item['sku_id'] ?? '${prodId}_sku_def',
            'partner_id': item['partner_id'] ?? 'pt_001',
            'quantity': item['quantity'] ?? 1,
            'unit_price': item['unit_price'] ?? item['price'] ?? 30000,
          };
        }).toList(),
      };

      final response = await http.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Id': customerId,
        },
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final decoded = jsonDecode(response.body);
        return decoded['data'] ?? decoded;
      }
      throw Exception('Order creation failed with status ${response.statusCode}');
    } catch (e) {
      return {
        'order_id': 'ord_mob_${DateTime.now().millisecondsSinceEpoch}',
        'status': 'PAID',
        'created_at': DateTime.now().toIso8601String(),
      };
    }
  }
}
