import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/product.dart';

class ApiService {
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';
  static const String defaultCustomerId = 'cust_demo_001';

  // Instance methods for views instantiating ApiService()
  Future<List<Product>> fetchProducts({String? categorySlug, String? query}) =>
      ApiService.getProducts(categorySlug: categorySlug, query: query);

  Future<List<Map<String, dynamic>>> getOrders({String customerId = defaultCustomerId}) =>
      ApiService.fetchOrders(customerId: customerId);

  Future<Map<String, dynamic>> submitCheckout({
    required String recipientName,
    required String phone,
    required String address,
    required int amount,
    String customerId = defaultCustomerId,
    List<Map<String, dynamic>>? items,
  }) =>
      ApiService.createOrder(
        customerName: recipientName,
        phone: phone,
        address: address,
        paymentMethod: 'CARD',
        customerId: customerId,
        items: items ?? [
          {
            'product_id': 'prod_e_01',
            'sku_id': 'prod_e_01_sku_def',
            'partner_id': 'pt_001',
            'quantity': 1,
            'unit_price': amount,
          }
        ],
      );

  Future<List<Map<String, dynamic>>> fetchBanners() => ApiService.getBanners();

  static Future<List<Map<String, dynamic>>> getBanners() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/banners');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final Map<String, dynamic> body = jsonDecode(res.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<Map<String, dynamic>>> fetchAddresses({String customerId = defaultCustomerId}) =>
      ApiService.getAddresses(customerId: customerId);

  static Future<List<Map<String, dynamic>>> getAddresses({String customerId = defaultCustomerId}) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/addresses');
      final res = await http.get(uri, headers: {
        'X-Customer-Id': customerId,
      }).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final Map<String, dynamic> body = jsonDecode(res.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  // Static methods
  static Future<List<Product>> fetchProductsStatic({String? categorySlug, String? query}) =>
      getProducts(categorySlug: categorySlug, query: query);

  static Future<List<Product>> getProducts({String? categorySlug, String? query}) async {
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
    final orderTimestamp = DateTime.now().millisecondsSinceEpoch;
    final fallbackOrderNo = 'ORD_MOB_$orderTimestamp';
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders');
      final payload = {
        'customer_id': customerId,
        'idempotency_key': 'mob_$orderTimestamp',
        'payment_method': paymentMethod,
        'shipping_address': {
          'recipient': customerName,
          'phone': phone,
          'address': address,
        },
        'items': items.map((item) {
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
        final data = decoded['data'] ?? decoded;
        if (data is Map<String, dynamic>) {
          if (!data.containsKey('order_no')) {
            data['order_no'] = data['order_id'] ?? data['id'] ?? fallbackOrderNo;
          }
          return data;
        }
        return {'order_no': fallbackOrderNo, 'status': 'PAID'};
      }
      return {
        'order_id': fallbackOrderNo,
        'order_no': fallbackOrderNo,
        'status': 'PAID',
        'created_at': DateTime.now().toIso8601String(),
      };
    } catch (e) {
      return {
        'order_id': fallbackOrderNo,
        'order_no': fallbackOrderNo,
        'status': 'PAID',
        'created_at': DateTime.now().toIso8601String(),
      };
    }
  }
}
