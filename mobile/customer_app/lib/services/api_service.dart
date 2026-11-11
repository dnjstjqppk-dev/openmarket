import 'dart:convert';
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/product.dart';
import 'token_store.dart';
import '../models/product_detail.dart';
import '../models/search.dart';

/// Server-issued JWT session. The gateway derives identity ONLY from the
/// Bearer token (lib/auth.js) — header identities such as X-Customer-Id are
/// ignored, and no demo identity is ever assumed.
class AuthSession {
  static const _kToken = 'olmoa_token';
  static const _kRefresh = 'olmoa_refresh_token';
  static const _kUserId = 'olmoa_customer_id';
  static const _kUserName = 'olmoa_customer_name';

  static String? _token;
  // P2-SEC-07: single-use refresh token (keychain). Sent ONLY to /auth/refresh.
  static String? _refresh;
  static String? _userId;
  static String? _userName;
  static bool _restored = false;
  // NEW-22: JWTs live in the OS keychain. Tests inject MemoryTokenStore.
  static TokenStore tokenStore = SecureTokenStore();

  static bool get isAuthenticated => _token != null && _token!.isNotEmpty;
  static String? get userName => _userName;
  static String? get userId => _userId;

  static Map<String, String> headers() => {
        'Content-Type': 'application/json',
        if (isAuthenticated) 'Authorization': 'Bearer $_token',
      };

  /// Restores the persisted session once per app launch.
  static Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      _token = await tokenStore.read(_kToken);
      _refresh = await tokenStore.read(_kRefresh);
      final prefs = await SharedPreferences.getInstance();
      // One-way migration: a token left in plaintext prefs by an older
      // build moves into the keychain and is wiped from prefs.
      final legacy = prefs.getString(_kToken);
      if (_token == null && legacy != null && legacy.isNotEmpty) {
        _token = legacy;
        try {
          await tokenStore.write(_kToken, legacy);
          await prefs.remove(_kToken);
        } catch (_) {}
      } else if (legacy != null) {
        try { await prefs.remove(_kToken); } catch (_) {}
      }
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
        _refresh = body['refresh_token'] is String ? body['refresh_token'] as String : null;
        final user = body['user'];
        _userId = body['customer_id']?.toString() ?? (user is Map ? user['id']?.toString() : null);
        _userName = (user is Map ? (user['full_name'] ?? user['name']) : null)?.toString() ?? '회원';
        try {
          await tokenStore.write(_kToken, _token!);
          if (_refresh != null) await tokenStore.write(_kRefresh, _refresh!);
        } catch (_) {}
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove(_kToken); // never leave the JWT in plaintext
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

  /// Wave G: adopt a profile change locally (name only; id never changes).
  static Future<void> adoptProfile({String? fullName}) async {
    if (fullName == null || fullName.isEmpty) return;
    _userName = fullName;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kUserName, fullName);
    } catch (_) {}
  }

  /// Wave G (P2-MOB-P1): sign-up. The server returns a session token, so a
  /// successful registration signs the user in immediately.
  static Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    required String fullName,
    required String phone,
    bool agreeMarketing = false,
  }) async {
    final uri = Uri.parse('${ApiService.baseUrl}/api/v1/auth/register');
    try {
      final res = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({
              'email': email.trim(),
              'password': password,
              'full_name': fullName.trim(),
              'phone': phone.trim(),
              'agree_terms': true,
              'agree_privacy': true,
              'agree_marketing': agreeMarketing,
            }),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      if ((res.statusCode == 200 || res.statusCode == 201) &&
          body['success'] == true &&
          body['token'] is String) {
        _token = body['token'] as String;
        _refresh = body['refresh_token'] is String ? body['refresh_token'] as String : null;
        final user = body['user'];
        _userId = body['customer_id']?.toString() ?? (user is Map ? user['id']?.toString() : null);
        _userName = (user is Map ? (user['full_name'] ?? user['name']) : null)?.toString() ?? fullName.trim();
        try {
          await tokenStore.write(_kToken, _token!);
          if (_refresh != null) await tokenStore.write(_kRefresh, _refresh!);
        } catch (_) {}
        try {
          final prefs = await SharedPreferences.getInstance();
          if (_userId != null) await prefs.setString(_kUserId, _userId!);
          await prefs.setString(_kUserName, _userName ?? '회원');
        } catch (_) {}
        return {'success': true, 'user_name': _userName};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '회원가입에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 회원가입하지 못했습니다.'};
    }
  }

  /// Wave G (P2-MOB-P1): password-reset guidance. Without a mail provider the
  /// server answers honestly that no mail was sent.
  static Future<Map<String, dynamic>> forgotPassword(String email) async {
    final uri = Uri.parse('${ApiService.baseUrl}/api/v1/auth/forgot-password');
    try {
      final res = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim()}),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      return {
        'success': body['success'] == true,
        'message': body['message']?.toString() ?? '요청을 처리하지 못했습니다.',
        'email_delivery': body['email_delivery']?.toString(),
      };
    } catch (_) {
      return {'success': false, 'message': '네트워크 오류로 요청하지 못했습니다.'};
    }
  }

  /// Wave G (P2-MOB-P1): redeem an email-verification token (link or paste).
  static Future<Map<String, dynamic>> verifyEmail(String token) async {
    final uri = Uri.parse('${ApiService.baseUrl}/api/v1/auth/verify-email');
    try {
      final res = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'token': token.trim()}),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      if (res.statusCode == 200 && body['success'] == true) {
        return {'success': true, 'message': body['message']?.toString() ?? '이메일이 인증되었습니다.'};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '인증에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 인증하지 못했습니다.'};
    }
  }

  static Future<void> logout() async {
    _token = null;
    _refresh = null;
    _userId = null;
    _userName = null;
    try {
      await tokenStore.delete(_kToken);
      await tokenStore.delete(_kRefresh);
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kToken);
      await prefs.remove(_kRefresh);
      await prefs.remove(_kUserId);
      await prefs.remove(_kUserName);
    } catch (_) {}
  }

  static Future<bool>? _refreshInflight;

  /// Single-flight access refresh. Returns true when a rotated pair was stored.
  static Future<bool> tryRefresh() => _refreshInflight ??= _doRefresh().whenComplete(() => _refreshInflight = null);

  static Future<bool> _doRefresh() async {
    await restore();
    final rt = _refresh;
    if (rt == null || rt.isEmpty) return false;
    try {
      final uri = Uri.parse('${ApiService.baseUrl}/api/v1/auth/refresh');
      final res = await http
          .post(uri, headers: const {'Content-Type': 'application/json'}, body: jsonEncode({'refresh_token': rt}))
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      if (res.statusCode == 200 && body['success'] == true && body['token'] is String && body['refresh_token'] is String) {
        _token = body['token'] as String;
        _refresh = body['refresh_token'] as String;
        try {
          await tokenStore.write(_kToken, _token!);
          await tokenStore.write(_kRefresh, _refresh!);
        } catch (_) {}
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
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
  // P2-MOB-04: staging/QA builds point elsewhere via
  //   flutter run --dart-define API_BASE_URL=https://staging-api.example.com
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://olmoa-api.dnjstjqppk.workers.dev',
  );

  /// P2-SEC-07: runs an authenticated request, refreshing once on 401 and
  /// retrying with the rotated token (headers are rebuilt inside [req]).
  /// A second 401 falls through to the caller's onUnauthorized path.
  static Future<http.Response> _authed(Future<http.Response> Function() req) async {
    var res = await req();
    if (res.statusCode == 401 && await AuthSession.tryRefresh()) {
      res = await req();
    }
    return res;
  }

  // Instance methods for views instantiating ApiService()
  Future<List<Product>> fetchProducts(
          {String? categorySlug, String? query, String? sort}) =>
      ApiService.getProducts(
          categorySlug: categorySlug, query: query, sort: sort);

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
    String? userCouponId,
    int useCreditAmount = 0,
    String? pccc,
  }) =>
      ApiService.createOrder(
        recipientName: recipientName,
        phone: phone,
        addressLine1: addressLine1,
        addressLine2: addressLine2,
        postalCode: postalCode,
        memo: memo,
        products: products,
        userCouponId: userCouponId,
        useCreditAmount: useCreditAmount,
        pccc: pccc,
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
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
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

  /// Keyword/category/product suggestions (chosung + synonyms, server-side).
  /// Empty query returns trending keywords + recommended categories.
  static Future<AutocompleteResult> getAutocomplete(String query) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/search/autocomplete').replace(queryParameters: {'q': query});
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) return parseAutocompleteResponse(_decode(res.body), query: query);
      return parseAutocompleteResponse(const {}, query: query);
    } catch (_) {
      return parseAutocompleteResponse(const {}, query: query);
    }
  }

  /// Fire-and-forget trending input, same as the web search bar.
  static Future<void> logSearch(String keyword) async {
    final kw = keyword.trim();
    if (kw.isEmpty) return;
    try {
      final uri = Uri.parse('$baseUrl/api/v1/search/log');
      await http
          .post(uri, headers: const {'Content-Type': 'application/json'}, body: jsonEncode({'keyword': kw}))
          .timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  /// P1-M03: strict catalog read — throws instead of returning [] so data
  /// views can tell "no results" apart from "load failed" and offer a retry.
  static Future<List<Product>> getProductsStrict({String? categorySlug, String? query}) async {
    var uri = Uri.parse('$baseUrl/api/v1/products');
    final params = <String, String>{'limit': '60'};
    if (categorySlug != null && categorySlug.isNotEmpty) params['category'] = categorySlug;
    if (query != null && query.isNotEmpty) params['q'] = query;
    uri = uri.replace(queryParameters: params);
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 8));
      if (response.statusCode == 200) {
        final body = _decode(response.body);
        final List<dynamic> list = body['data'] ?? [];
        return list.map((e) => Product.fromJson(Map<String, dynamic>.from(e as Map))).toList();
      }
      throw ApiException(_decode(response.body)['error']?.toString() ?? '상품 목록을 불러오지 못했습니다.');
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 상품 목록을 불러오지 못했습니다.');
    }
  }

  /// P1-M03: strict autocomplete — throws on transport failure so the search
  /// screen can show a retry instead of a fake-empty suggestion list.
  static Future<AutocompleteResult> getAutocompleteStrict(String query) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/search/autocomplete').replace(queryParameters: {'q': query});
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) return parseAutocompleteResponse(_decode(res.body), query: query);
      throw ApiException('추천 검색어를 불러오지 못했습니다.');
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 추천 검색어를 불러오지 못했습니다.');
    }
  }

  static Future<ProductDetail> getProductDetail(String productId) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/products/$productId');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final data = _decode(res.body)['data'];
        if (data is Map) return parseProductDetail(Map<String, dynamic>.from(data));
      }
      if (res.statusCode == 404) throw ApiException('상품을 찾을 수 없습니다.');
      throw ApiException(_decode(res.body)['error']?.toString() ?? '상품 정보를 불러오지 못했습니다.');
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 상품 정보를 불러오지 못했습니다.');
    }
  }

  /// Server catalog only. On failure returns [] so the view shows a retry
  /// state — a local fake catalog is never presented as real products.
  static Future<List<Product>> getProducts(
      {String? categorySlug, String? query, String? sort}) async {
    try {
      var uri = Uri.parse('$baseUrl/api/v1/products');
      final params = <String, String>{'limit': '60'};
      if (categorySlug != null && categorySlug.isNotEmpty) {
        params['category'] = categorySlug;
      }
      if (query != null && query.isNotEmpty) params['q'] = query;
      // P2-MOB-P3: best/deals channels (server sorts: popular/newest/rating/price_*).
      if (sort != null && sort.isNotEmpty) params['sort'] = sort;
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

  /// P2-MOB-P3: full category tree for the channel screen.
  static Future<List<Map<String, dynamic>>> getCategories() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/categories');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return [];
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<List<Map<String, dynamic>>> fetchOrders() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders?limit=30');
      final response = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 10)));
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

  /// PG availability from the server (Toss client key or sandbox simulator).
  static Future<Map<String, dynamic>> getPaymentConfig() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/payments/config');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) return _decode(res.body);
      return {'success': false, 'mode': 'DISABLED'};
    } catch (_) {
      return {'success': false, 'mode': 'DISABLED'};
    }
  }

  /// Confirms a PG-approved (or simulator) payment with the server.
  static Future<Map<String, dynamic>> confirmPayment({
    required String orderRef,
    required String paymentKey,
    required int amount,
  }) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/payments/confirm');
      final idemKey = _idemKey();
      final response = await _authed(() => http
          .post(
            uri,
            headers: {...AuthSession.headers(), 'X-Idempotency-Key': idemKey},
            body: jsonEncode({'order_id': orderRef, 'payment_key': paymentKey, 'amount': amount}),
          )
          .timeout(const Duration(seconds: 15)));
      final body = _decode(response.body);
      if (response.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((response.statusCode == 200 || response.statusCode == 201) && body['success'] == true) {
        return {'success': true, 'data': body['data']};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '결제 승인에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 결제 승인에 실패했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> _postAction(String path, {Map<String, dynamic>? body, bool idem = false}) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl$path');
      final idemKey = idem ? _idemKey() : null;
      final response = await _authed(() => http
          .post(
            uri,
            headers: {
              ...AuthSession.headers(),
              if (idemKey != null) 'X-Idempotency-Key': idemKey,
            },
            body: body == null ? null : jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12)));
      final decoded = _decode(response.body);
      if (response.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((response.statusCode == 200 || response.statusCode == 201) && decoded['success'] == true) {
        return {'success': true, 'data': decoded['data'], 'message': decoded['message']};
      }
      return {'success': false, 'error': decoded['error']?.toString() ?? '요청을 처리하지 못했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 요청을 처리하지 못했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> getOrderDetail(String orderId) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders/$orderId');
      final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        throw const AuthRequiredException();
      }
      final body = _decode(res.body);
      if (res.statusCode == 404) throw ApiException('주문을 찾을 수 없습니다.');
      if (res.statusCode != 200 || body['success'] != true) {
        throw ApiException(body['error']?.toString() ?? '주문 상세를 불러오지 못했습니다.');
      }
      return Map<String, dynamic>.from(body['data'] as Map);
    } on AuthRequiredException {
      rethrow;
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 주문 상세를 불러오지 못했습니다.');
    }
  }

  static Future<List<Map<String, dynamic>>> getTracking(String orderId) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders/$orderId/tracking');
      final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        throw const AuthRequiredException();
      }
      final body = _decode(res.body);
      if (res.statusCode != 200 || body['success'] != true) {
        throw ApiException(body['error']?.toString() ?? '배송 조회에 실패했습니다.');
      }
      final List<dynamic> list = body['tracking'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on AuthRequiredException {
      rethrow;
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('네트워크 오류로 배송 조회에 실패했습니다.');
    }
  }

  static Future<Map<String, dynamic>> cancelOrder(String orderId) =>
      _postAction('/api/v1/orders/$orderId/cancel');

  static Future<Map<String, dynamic>> cancelSubOrder(String orderId, String subOrderId) =>
      _postAction('/api/v1/orders/$orderId/sub-orders/$subOrderId/cancel', idem: true);

  static Future<Map<String, dynamic>> confirmPurchase(String orderId) =>
      _postAction('/api/v1/orders/$orderId/confirm');

  static Future<Map<String, dynamic>> fileClaim({
    required String orderId,
    required String claimType,
    String? subOrderId,
    required String reason,
    String? reasonCode,
  }) =>
      _postAction(
        '/api/v1/orders/$orderId/claims',
        body: {
          'claim_type': claimType,
          if (subOrderId != null) 'sub_order_id': subOrderId,
          'reason': reason,
          if (reasonCode != null) 'reason_code': reasonCode,
        },
      );

  /// P1-M04: server-side quote (dry run, no writes). Returns
  /// {success, data} or {success:false, error, code} - 403/409 policy codes
  /// (CREDIT_UNVERIFIED, CREDIT_MIN_ORDER, PCCC_REQUIRED, ...) surface as-is.
  static Future<Map<String, dynamic>> getQuote({
    required List<Map<String, Object>> items,
    String? userCouponId,
    int useCreditAmount = 0,
    String? pccc,
  }) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders/quote');
      final res = await _authed(() => http
          .post(
            uri,
            headers: AuthSession.headers(),
            body: jsonEncode({
              'items': items,
              if (userCouponId != null && userCouponId.isNotEmpty) 'user_coupon_id': userCouponId,
              if (useCreditAmount > 0) 'use_credit_amount': useCreditAmount,
              if (pccc != null && pccc.isNotEmpty) 'pccc': pccc,
            }),
          )
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) {
        return {'success': true, 'data': Map<String, dynamic>.from(body['data'] as Map)};
      }
      return {'success': false, 'code': body['code']?.toString(), 'error': body['error']?.toString() ?? '견적 조회에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 견적을 조회하지 못했습니다.'};
    }
  }

  /// P1-M04: coupons the signed-in user owns and has not used yet.
  static Future<List<Map<String, dynamic>>> getUsableCoupons() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/coupons');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '쿠폰 목록을 불러오지 못했습니다.');
    }
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list
        .map((e) => Map<String, dynamic>.from(e as Map))
        .where((c) => c['is_claimed'] == true && c['is_used'] != true)
        .toList();
  }

  /// P1-M04: current credit balance (0 when the ledger is empty).
  static Future<int> getCreditBalance() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/credits');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '적립금 잔액을 불러오지 못했습니다.');
    }
    final data = _decode(res.body)['data'];
    final bal = data is Map ? data['balance'] : null;
    return bal is int ? bal : int.tryParse(bal?.toString() ?? '') ?? 0;
  }

  /// Merges cart lines per SKU (same variant adds up, other variants stay separate).
  static List<Map<String, Object>> mergeItemsBySku(List<Product> products) {
    final bySku = <String, int>{};
    for (final p in products) {
      if (p.defaultSkuId.isEmpty) continue;
      bySku[p.defaultSkuId] = (bySku[p.defaultSkuId] ?? 0) + 1;
    }
    return [for (final e in bySku.entries) {'sku_id': e.key, 'quantity': e.value}];
  }

  static Future<Map<String, dynamic>> createOrder({
    required String recipientName,
    required String phone,
    required String addressLine1,
    String addressLine2 = '',
    required String postalCode,
    String memo = '',
    required List<Product> products,
    String? userCouponId,
    int useCreditAmount = 0,
    String? pccc,
  }) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    // One line per SKU; the server re-prices and re-checks stock.
    final items = mergeItemsBySku(products);
    if (items.isEmpty) {
      return {'success': false, 'error': '주문 가능한 상품 옵션(SKU)이 없습니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/orders/checkout');
      final idemKey = _idemKey();
      final response = await _authed(() => http
          .post(
            uri,
            headers: {...AuthSession.headers(), 'X-Idempotency-Key': idemKey},
            body: jsonEncode({
              'items': items,
              'recipient_name': recipientName,
              'recipient_phone': phone,
              'shipping_address_line1': addressLine1,
              'shipping_address_line2': addressLine2,
              'shipping_memo': memo,
              if (userCouponId != null && userCouponId.isNotEmpty) 'user_coupon_id': userCouponId,
              if (useCreditAmount > 0) 'use_credit_amount': useCreditAmount,
              if (pccc != null && pccc.isNotEmpty) 'pccc': pccc,
            }),
          )
          .timeout(const Duration(seconds: 12)));
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

  /// P1-M05: pull the server cart (live prices/stock joined per line).
  static Future<List<Map<String, dynamic>>> getCart() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/cart');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '서버 장바구니를 불러오지 못했습니다.');
    }
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  // ---- Wave G: wishlist / addresses / notifications / support / reviews ----

  static Future<List<Map<String, dynamic>>> getWishlist() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/wishlist');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '찜 목록을 불러오지 못했습니다.');
    }
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<Map<String, dynamic>> toggleWishlist(String productId) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/wishlist');
      final res = await _authed(() => http
          .post(uri, headers: AuthSession.headers(), body: jsonEncode({'product_id': productId}))
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) {
        return {'success': true, 'wished': body['wished'] == true, 'action': body['action']?.toString()};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '찜하기에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 찜하기에 실패했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> createAddress({
    required String recipientName,
    required String phone,
    required String postalCode,
    required String addressLine1,
    String addressLine2 = '',
    String memo = '',
    bool isDefault = false,
  }) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/addresses');
      final res = await _authed(() => http
          .post(uri,
              headers: AuthSession.headers(),
              body: jsonEncode({
                'recipient_name': recipientName,
                'phone': phone,
                'postal_code': postalCode,
                'address_line1': addressLine1,
                'address_line2': addressLine2,
                'delivery_note': memo,
                'is_default': isDefault ? 1 : 0,
              }))
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((res.statusCode == 200 || res.statusCode == 201) && body['success'] == true) {
        return {'success': true, 'data': body['data']};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '배송지 등록에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 배송지를 등록하지 못했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> setDefaultAddress(String addressId) async {
    final r = await _addressAction('/api/v1/addresses/$addressId/default', 'PUT', null);
    if (r['success'] != true && r['error'] == null) r['error'] = '기본 배송지 변경에 실패했습니다.';
    return r;
  }

  static Future<Map<String, dynamic>> deleteAddress(String addressId) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/addresses/$addressId');
      final res = await _authed(() => http.delete(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) return {'success': true};
      return {'success': false, 'error': body['error']?.toString() ?? '배송지 삭제에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 배송지를 삭제하지 못했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> _addressAction(String path, String method, Map<String, dynamic>? body) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl$path');
      final req = method == 'PUT'
          ? http.put(uri, headers: AuthSession.headers(), body: body == null ? null : jsonEncode(body))
          : http.post(uri, headers: AuthSession.headers(), body: body == null ? null : jsonEncode(body));
      final res = await _authed(() => req.timeout(const Duration(seconds: 10)));
      final decoded = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && decoded['success'] == true) return {'success': true, 'data': decoded['data']};
      return {'success': false, 'error': decoded['error']?.toString()};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 요청을 처리하지 못했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> getNotifications() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/notifications?limit=50');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '알림을 불러오지 못했습니다.');
    }
    final body = _decode(res.body);
    return {
      'unread': body['unread_count'] ?? 0,
      'items': ((body['data'] ?? []) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList(),
    };
  }

  static Future<void> readNotification(String id) async {
    await _addressAction('/api/v1/notifications/$id/read', 'POST', null);
  }

  static Future<void> readAllNotifications() async {
    await _addressAction('/api/v1/notifications/read-all', 'PUT', null);
  }

  static Future<List<Map<String, dynamic>>> getFaq() async {
    final uri = Uri.parse('$baseUrl/api/v1/support/faq');
    final res = await http.get(uri).timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) throw ApiException('FAQ를 불러오지 못했습니다.');
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<List<Map<String, dynamic>>> getMyInquiries() async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) throw const AuthRequiredException();
    final uri = Uri.parse('$baseUrl/api/v1/support/inquiries');
    final res = await _authed(() => http.get(uri, headers: AuthSession.headers()).timeout(const Duration(seconds: 8)));
    if (res.statusCode == 401) {
      await AuthSession.onUnauthorized();
      throw const AuthRequiredException();
    }
    if (res.statusCode != 200) {
      throw ApiException(_decode(res.body)['error']?.toString() ?? '문의 내역을 불러오지 못했습니다.');
    }
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<Map<String, dynamic>> submitInquiry({
    required String category,
    required String subject,
    required String message,
  }) async {
    final r = await _postAction('/api/v1/support/inquiries',
        body: {'category': category, 'subject': subject, 'message': message});
    if (r['success'] != true && r['error'] == null) r['error'] = '문의 등록에 실패했습니다.';
    return r;
  }

  static Future<Map<String, dynamic>> getReviews(String productId) async {
    final uri = Uri.parse('$baseUrl/api/v1/products/$productId/reviews');
    final res = await http.get(uri).timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) throw ApiException('리뷰를 불러오지 못했습니다.');
    return _decode(res.body);
  }

  static Future<Map<String, dynamic>> submitReview({
    required String productId,
    required int rating,
    required String content,
  }) async {
    final r = await _postAction('/api/v1/products/$productId/reviews',
        body: {'rating': rating, 'content': content});
    if (r['success'] != true && r['error'] == null) r['error'] = '리뷰 등록에 실패했습니다.';
    return r;
  }

  static Future<List<Map<String, dynamic>>> getQna(String productId) async {
    final uri = Uri.parse('$baseUrl/api/v1/products/$productId/qna');
    final res = await http.get(uri).timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) throw ApiException('상품 문의를 불러오지 못했습니다.');
    final List<dynamic> list = _decode(res.body)['data'] ?? [];
    return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<Map<String, dynamic>> askQuestion({
    required String productId,
    required String question,
    bool isSecret = false,
  }) async {
    final r = await _postAction('/api/v1/products/$productId/qna',
        body: {'question': question, 'is_secret': isSecret});
    if (r['success'] != true && r['error'] == null) r['error'] = '문의 등록에 실패했습니다.';
    return r;
  }

  static Future<Map<String, dynamic>> updateProfile({String? fullName, String? phone}) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/auth/profile');
      final res = await _authed(() => http
          .put(uri,
              headers: AuthSession.headers(),
              body: jsonEncode({
                if (fullName != null) 'full_name': fullName,
                if (phone != null) 'phone': phone,
              }))
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) {
        final u = body['data'] is Map ? (body['data'] as Map)['user'] : null;
        if (u is Map) AuthSession.adoptProfile(fullName: u['full_name']?.toString());
        return {'success': true};
      }
      return {'success': false, 'error': body['error']?.toString() ?? '회원 정보 수정에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 회원 정보를 수정하지 못했습니다.'};
    }
  }

  /// P1-M05: push the full local line set (replace semantics). Returns
  /// {success} or {success:false, error} - INVALID_SKU names the bad line.
  static Future<Map<String, dynamic>> syncCart(List<Map<String, Object>> items) async {
    await AuthSession.restore();
    if (!AuthSession.isAuthenticated) {
      return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/cart');
      final res = await _authed(() => http
          .put(uri, headers: AuthSession.headers(), body: jsonEncode({'items': items}))
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await AuthSession.onUnauthorized();
        return {'success': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) return {'success': true};
      return {'success': false, 'code': body['code']?.toString(), 'error': body['error']?.toString() ?? '서버 장바구니 저장에 실패했습니다.'};
    } catch (_) {
      return {'success': false, 'error': '네트워크 오류로 서버 장바구니를 저장하지 못했습니다.'};
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
