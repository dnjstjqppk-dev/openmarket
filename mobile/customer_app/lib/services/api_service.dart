import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';

/// Server-issued JWT session. The gateway derives identity ONLY from the
/// Bearer token (lib/auth.js) — header identities such as X-Customer-Id are
/// ignored, and no demo identity is ever assumed.
class AuthSession {
  static const _kToken = 'olmoa_token';
  static const _kUserId = 'olmoa_customer_id';
  static const _kUserName = 'olmoa_customer_name';

  static String? _token;
  static String? _userId;
  static String? _userName;
  static bool _restored = false;

  static bool get isAuthenticated => _token != null && _token!.isNotEmpty;
  static String? get userName => _userName;

  static Map<String, String> headers() => {
        'Content-Type': 'application/json',
        if (isAuthenticated) 'Authorization': 'Bearer $_token',
      };

  /// Restores the persisted session once per app launch.
  static Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      _token = prefs.getString(_kToken);
      _userId = prefs.getString(_kUserId);
      _userName = prefs.getString(_kUserName);
    } catch (_) {
      // Storage unavailable: the session simply does not persist.
    }
  }

  static Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final uri = Uri.parse('${ApiService.baseUrl}/api/v1/auth/login');
    try {
      final res = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim(), 'password': password, 'role': 'CUSTOMER'}),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      if (res.statusCode == 200 && body['success'] == true && body['token'] is String) {
        _token = body['token'] as String;
        final user = body['user'];
        _userId = body['customer_id']?.toString() ?? (user is Map ? user['id']?.toString() : null);
        _userName = (user is Map ? (user['full_name'] ?? user['name']) : null)?.toString() ?? '회원';
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_kToken, _token!);
          if (_userId != null) await prefs.setString(_kUserId, _userId!);
          await prefs.setString(_kUserName, _userName ?? '회원');
        } catch (_) {}
        return {'success': true, 'user_name': _userName};
      }
      if (res.statusCode == 423) {
        return {'success': false, 'error': '로그인 시도가 너무 많아 계정이 잠겼습니다. 15분 후 다시 시도해 주세요.'};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '이메일 또는 비밀번호가 올바르지 않습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 로그인하지 못했습니다.'};
    }
  }

  static Future<void> logout() async {
    _token = null;
    _userId = null;
    _userName = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kToken);
      await prefs.remove(_kUserId);
      await prefs.remove(_kUserName);
    } catch (_) {}
  }

  /// Called on any 401 from our API: the token is expired or revoked.
  static Future<void> onUnauthorized() => logout();
}

Map<String, dynamic> _decode(String source) {
  try {
    final v = jsonDecode(source);
    return v is Map<String, dynamic> ? v : {};
  } catch (_) {
    return {};
  }
}

String _idemKey() {
  final r = Random.secure();
  final suffix = List.generate(8, (_) => 'abcdefghijklmnopqrstuvwxyz0123456789'[r.nextInt(36)]).join();
  return 'mob-${DateTime.now().millisecondsSinceEpoch}-$suffix';
}

class ApiService {
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';

  // Instance methods for views instantiating ApiService()
  Future<List<Product>> fetchProducts({String? categorySlug, String? query}) =>
      ApiService.getProducts(categorySlug: categorySlug, query: query);

  Future<List<Map<String, dynamic>>> getOrders() => ApiService.fetchOrders();

  /// Creates a READY (payment-pending) order via the real checkout contract.
  /// Never fabricates an order: failures return {success:false, error}.
  Future<Map<String, dynamic>> submitCheckout({
    required String recipientName,
    required String phone,
    required String addressLine1,
    String addressLine2 = '',
    required String postalCode,
    String memo = '',
    required List<Product> products,
  }) =>
      ApiService.createOrder(
        recipientName: recipientName,
        phone: phone,
        addressLine1: addressLine1,
        addressLine2: addressLine2,
        postalCode: postalCode,
        memo: memo,
        products: products,
      );

  Future<List<Map<String, dynamic>>> fetchBanners() => ApiService.getBanners();

  Future<List<Map<String, dynamic>>> fetchAddresses() => ApiService.getAddresses();

  static Future<List<Map<String, dynamic>>> getBanners() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/banners');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final body = _decode(res.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  static Future<List<Map<String, dynamic>>> getAddresses() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/addresses');
    final res = await http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) throw ApiException(_decode(res.body)['error']?.toString() ?? '배송지 목록을 불러오지 못했습니다.');
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<List<Product>> fetchProductsStatic({String? categorySlug, String? query}) =>
      getProducts(categorySlug: categorySlug, query: query);

  /// Server catalog only. On failure returns [] so the view shows a retry
  /// state — a local fake catalog is never presented as real products.
  static Future<List<Product>> getProducts({String? categorySlug, String? query}) async {
    try {
      var uri = Uri.parse('$baseUrl/api/v1/products');
      final params = <String, String>{'limit': '60'};
      if (categorySlug != null && categorySlug.isNotEmpty) params['category'] = categorySlug;
      if (query != null && query.isNotEmpty) params['q'] = query;
      uri = uri.replace(queryParameters: params);

      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        final body = _decode(response.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.map((e) => Product.fromJson(Map<String, dynamic>.from(e as Map))).toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  static Future<List<Map<String, dynamic>>> fetchOrders() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders?limit=30');
      final response = await http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 10));
      if (response.statusCode == 401) {
        await AuthSession.onUnauthorized();
        throw const AuthRequiredException();
      }
      if (response.statusCode != 200) {
        throw ApiException(_decode(response.body)['error']?.toString() ?? '주문 내역을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(response.body)['data'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on AuthRequiredException {
      rethrow;
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 주문 내역을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> createOrder({
    required String recipientName,
    required String phone,
    required String addressLine1,
    String addressLine2 = '',
    required String postalCode,
    String memo = '',
    required List<Product> products,
  }) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    // One line per product; the server re-prices and re-checks stock.
    final byId = <String, int>{};
    final skuOf = <String, String>{};
    for (final p in products) {
      if (p.defaultSkuId.isEmpty) continue;
      byId[p.id] = (byId[p.id] ?? 0) + 1;
      skuOf[p.id] = p.defaultSkuId;
    }
    if (byId.isEmpty) {
      return {'success': false, 'error': '주문 가능한 상품 옵션(SKU)이 없습니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders/checkout');
      final response = await http
          .post(
            uri,
            headers: {...AuthSession.headers(), 'X-Idempotency-Key': _idemKey()},
            body: jsonEncode({
              'items': byId.entries.map((e) => {'sku_id': skuOf[e.key], 'quantity': e.value}).toList(),
              'recipient_name': recipientName,
              'recipient_phone': phone,
              'shipping_address_line1': addressLine1,
              'shipping_address_line2': addressLine2,
              'shipping_postal_code': postalCode,
              'shipping_memo': memo,
            }),
          )
          .timeout(const Duration(seconds: 12));
      final body = _decode(response.body);
      if (response.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((response.statusCode == 200 || response.statusCode == 201) && body['success'] == true) {
        final data = body['data'] is Map ? Map<String, dynamic>.from(body['data'] as Map) : <String, dynamic>{};
        return {
          'success': true,
          'order_id': data['order_id'],
          'order_no': data['order_no'],
          'total_pay_amount': data['total_pay_amount'],
          'payment_status': data['payment_status'],
          'payment_expires_at': data['payment_expires_at'],
        };
      }
      return {'success': false, 'code': body['code']?.toString(), 'error': body['error']?.toString() ?? '주문 생성에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 주문을 생성하지 못했습니다.'};
    }
  }
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

class AuthRequiredException implements Exception {
  const AuthRequiredException();
}
