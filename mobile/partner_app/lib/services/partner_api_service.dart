import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/bidding.dart';
import '../models/channel_listing.dart';
import '../models/partner_product.dart';
import '../models/partner_profile.dart';
import '../models/partner_qna.dart';
import '../models/return_claim.dart';
import '../models/sub_order.dart';
import 'token_store.dart';

/// Server-issued JWT session for an approved seller. The gateway derives
/// identity ONLY from the Bearer token (lib/auth.js) — X-Partner-Id headers
/// are ignored, and no demo seller is ever assumed.
class PartnerAuthSession {
  static const _kToken = 'olmoa_partner_token';
  static const _kRefresh = 'olmoa_partner_refresh_token';
  static const _kBusiness = 'olmoa_partner_business';

  static String? _token;
  // P2-SEC-07: single-use refresh token (keychain). Sent ONLY to /auth/refresh.
  static String? _refresh;
  static String? _businessName;
  static bool _restored = false;
  // NEW-22: JWTs live in the OS keychain. Tests inject MemoryTokenStore.
  static TokenStore tokenStore = SecureTokenStore();

  static bool get isAuthenticated => _token != null && _token!.isNotEmpty;
  static String? get businessName => _businessName;

  static Map<String, String> headers() => {
        'Content-Type': 'application/json',
        if (isAuthenticated) 'Authorization': 'Bearer $_token',
      };

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
      _businessName = prefs.getString(_kBusiness);
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> login({
    required String email,
    required String password,
  }) async {
    final uri = Uri.parse('${PartnerApiService.baseUrl}/api/v1/auth/login');
    try {
      final res = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim(), 'password': password, 'role': 'PARTNER'}),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(res.body);
      if (res.statusCode == 200 && body['success'] == true && body['token'] is String) {
        _token = body['token'] as String;
        _refresh = body['refresh_token'] is String ? body['refresh_token'] as String : null;
        final partner = body['partner'];
        _businessName = (partner is Map ? partner['business_name'] : null)?.toString() ?? '판매자';
        try {
          await tokenStore.write(_kToken, _token!);
          if (_refresh != null) await tokenStore.write(_kRefresh, _refresh!);
        } catch (_) {}
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove(_kToken); // never leave the JWT in plaintext
          await prefs.setString(_kBusiness, _businessName!);
        } catch (_) {}
        return {'success': true, 'business_name': _businessName};
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
    _refresh = null;
    _businessName = null;
    try {
      await tokenStore.delete(_kToken);
      await tokenStore.delete(_kRefresh);
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kToken);
      await prefs.remove(_kRefresh);
      await prefs.remove(_kBusiness);
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
      final uri = Uri.parse('${PartnerApiService.baseUrl}/api/v1/auth/refresh');
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

class PartnerApiService {
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
    if (res.statusCode == 401 && await PartnerAuthSession.tryRefresh()) {
      res = await req();
    }
    return res;
  }

  // Instance methods
  Future<Map<String, dynamic>> fetchDashboardMetrics() => PartnerApiService.getDashboardMetrics();

  /// 4-23: same action pipeline the web seller console renders.
  Future<Map<String, dynamic>> fetchPipeline() => PartnerApiService.getPipeline();

  /// 4-23: 발주확인 (PAYMENT_CONFIRMED → PREPARING), same as web.
  Future<Map<String, dynamic>> confirmOrder({required String subOrderId}) =>
      PartnerApiService.confirmShipment(orderId: subOrderId);

  Future<List<SubOrder>> fetchPartnerOrders() => PartnerApiService.getPartnerOrders();

  /// Returns {ok, error?} — the server answer, never an optimistic guess.
  Future<Map<String, dynamic>> updateTracking({
    required String subOrderId,
    required String carrier,
    required String trackingNo,
  }) =>
      PartnerApiService.registerShipment(
        orderId: subOrderId,
        carrier: carrier,
        trackingNumber: trackingNo,
      );

  Future<Map<String, dynamic>> fetchSettlements() => PartnerApiService.getSettlements();

  Future<List<Map<String, dynamic>>> fetchCategories() => PartnerApiService.getCategories();

  Future<List<PartnerProductRow>> fetchProducts() => PartnerApiService.getProducts();

  Future<Map<String, dynamic>> saveProductPrice({
    required String productId,
    String? skuId,
    required int salePrice,
    required int originalPrice,
  }) =>
      PartnerApiService.updateProductPrice(
        productId: productId,
        skuId: skuId,
        salePrice: salePrice,
        originalPrice: originalPrice,
      );

  Future<Map<String, dynamic>> saveProductStock({
    required String productId,
    String? skuId,
    required int stock,
  }) =>
      PartnerApiService.updateProductStock(
        productId: productId,
        skuId: skuId,
        stock: stock,
      );

  Future<Map<String, dynamic>> saveProductDetail({
    required String productId,
    required Map<String, dynamic> fields,
  }) =>
      PartnerApiService.updateProduct(productId: productId, fields: fields);

  Future<Map<String, dynamic>> addProduct(Map<String, dynamic> payload) =>
      PartnerApiService.createProduct(payload);

  Future<List<ReturnClaim>> fetchReturns() => PartnerApiService.getReturns();

  Future<Map<String, dynamic>> decideClaim({
    required String claimId,
    required bool approve,
    required String notes,
    String? fault,
    bool returnless = false,
  }) =>
      PartnerApiService.decideReturn(
        claimId: claimId,
        approve: approve,
        notes: notes,
        fault: fault,
        returnless: returnless,
      );

  Future<Map<String, dynamic>> reshipClaim({
    required String claimId,
    required String carrier,
    required String trackingNumber,
    required bool returnReceived,
  }) =>
      PartnerApiService.reshipExchange(
        claimId: claimId,
        carrier: carrier,
        trackingNumber: trackingNumber,
        returnReceived: returnReceived,
      );

  Future<List<PartnerQna>> fetchQna() => PartnerApiService.getQna();

  Future<Map<String, dynamic>> postQnaAnswer({
    required String qnaId,
    required String answer,
  }) =>
      PartnerApiService.answerQna(qnaId: qnaId, answer: answer);

  Future<List<BiddingCampaign>> fetchCampaigns({String status = 'OPEN'}) =>
      PartnerApiService.getCampaigns(status: status);

  Future<List<SupplierBid>> fetchMyBids() => PartnerApiService.getMyBids();

  Future<Map<String, dynamic>> submitCampaignBid({
    required String campaignId,
    required int price,
    required int moq,
    required int leadDays,
    required String notes,
  }) =>
      PartnerApiService.submitBid(
        campaignId: campaignId,
        price: price,
        moq: moq,
        leadDays: leadDays,
        notes: notes,
      );

  Future<List<PriceNegotiation>> fetchNegotiations() =>
      PartnerApiService.getNegotiations();

  Future<Map<String, dynamic>> respondOffer({
    required String negotiationId,
    required bool accept,
    required String notes,
  }) =>
      PartnerApiService.respondNegotiation(
        negotiationId: negotiationId,
        accept: accept,
        notes: notes,
      );

  Future<List<ChannelListing>> fetchChannelListings() =>
      PartnerApiService.getChannelListings();

  Future<List<SalesChannel>> fetchSalesChannels() =>
      PartnerApiService.getSalesChannels();

  Future<List<CommercePlatform>> fetchPlatforms() =>
      PartnerApiService.getPlatforms();

  Future<List<ChannelCredential>> fetchChannelCredentials() =>
      PartnerApiService.getChannelCredentials();

  Future<Map<String, dynamic>> saveCredential({
    required String platformId,
    required String credentialName,
    required String apiKey,
    String secretKey = '',
    String sellerAccountId = '',
  }) =>
      PartnerApiService.saveChannelCredential(
        platformId: platformId,
        credentialName: credentialName,
        apiKey: apiKey,
        secretKey: secretKey,
        sellerAccountId: sellerAccountId,
      );

  Future<Map<String, dynamic>> verifyCredential(String credentialId) =>
      PartnerApiService.verifyChannelCredential(credentialId);

  Future<Map<String, dynamic>> publishToChannel(
          Map<String, dynamic> payload) =>
      PartnerApiService.publishListing(payload);

  Future<Map<String, dynamic>> syncChannelOrders(String salesChannelId) =>
      PartnerApiService.syncOrders(salesChannelId);

  Future<PartnerProfile> fetchPartnerProfile() =>
      PartnerApiService.getPartnerProfile();

  Future<Map<String, dynamic>> savePartnerProfile(
          Map<String, dynamic> fields) =>
      PartnerApiService.updatePartnerProfile(fields);

  // Static methods
  static Future<Map<String, dynamic>> getDashboardMetrics() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/metrics');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 8)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '지표를 불러오지 못했습니다.');
      }
      // The endpoint answers a flat object (routes/partner.js), not {data}.
      return _decode(res.body);
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 지표를 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> getPipeline() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/dashboard/pipeline');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 8)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '지표를 불러오지 못했습니다.');
      }
      final body = _decode(res.body);
      final data = body['data'];
      return data is Map ? Map<String, dynamic>.from(data) : body;
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 지표를 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> confirmShipment({required String orderId}) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/orders/$orderId/prepare');
      final res = await _authed(() => http
          .post(uri, headers: PartnerAuthSession.headers())
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) {
        return {'ok': true, 'status': body['status'] ?? 'PREPARING'};
      }
      return {'ok': false, 'error': body['error']?.toString() ?? '발주 확인에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 발주 확인에 실패했습니다.'};
    }
  }

  static Future<List<SubOrder>> getPartnerOrders() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/orders');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '주문 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => SubOrder.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 주문 목록을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> registerShipment({
    required String orderId,
    required String carrier,
    required String trackingNumber,
  }) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/orders/$orderId/shipment');
      final res = await _authed(() => http
          .put(
            uri,
            headers: PartnerAuthSession.headers(),
            body: jsonEncode({'carrier': carrier, 'tracking_number': trackingNumber}),
          )
          .timeout(const Duration(seconds: 10)));
      final body = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && body['success'] == true) {
        return {'ok': true, 'tracking_number': body['tracking_number'] ?? trackingNumber};
      }
      return {'ok': false, 'error': body['error']?.toString() ?? '출고 처리에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 출고 처리에 실패했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> getSettlements() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/settlements');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 8)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '정산 내역을 불러오지 못했습니다.');
      }
      return _decode(res.body);
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 정산 내역을 불러오지 못했습니다.');
    }
  }

  /// Public category directory (also feeds the product registration form).
  static Future<List<Map<String, dynamic>>> getCategories() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/categories');
      final res = await http.get(uri, headers: const {'Content-Type': 'application/json'}).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '카테고리를 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 카테고리를 불러오지 못했습니다.');
    }
  }

  static Future<List<PartnerProductRow>> getProducts() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/products');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '상품 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => PartnerProductRow.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 상품 목록을 불러오지 못했습니다.');
    }
  }

  /// Returns {ok, error?} — the server answer, never an optimistic guess.
  static Future<Map<String, dynamic>> _putMutation(String path, Map<String, dynamic> body) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl$path');
      final res = await _authed(() => http
          .put(uri, headers: PartnerAuthSession.headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 10)));
      final decoded = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((res.statusCode == 200 || res.statusCode == 201) && decoded['success'] == true) {
        return {'ok': true, 'data': decoded};
      }
      // The HTTP status travels so callers can tell 501-not-integrated apart
      // from a validation failure (multichannel publish).
      return {'ok': false, 'status': res.statusCode, 'code': decoded['code']?.toString(), 'error': decoded['error']?.toString() ?? '요청 처리에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 요청 처리에 실패했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> _postMutation(String path, Map<String, dynamic> body) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl$path');
      final res = await _authed(() => http
          .post(uri, headers: PartnerAuthSession.headers(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 10)));
      final decoded = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((res.statusCode == 200 || res.statusCode == 201) && decoded['success'] == true) {
        return {'ok': true, 'data': decoded};
      }
      return {'ok': false, 'status': res.statusCode, 'code': decoded['code']?.toString(), 'error': decoded['error']?.toString() ?? '요청 처리에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 요청 처리에 실패했습니다.'};
    }
  }

  /// T06: the row sku_id always travels so only that SKU moves.
  static Future<Map<String, dynamic>> updateProductPrice({
    required String productId,
    String? skuId,
    required int salePrice,
    required int originalPrice,
  }) =>
      _putMutation('/api/v1/partner/products/$productId/price', {
        if (skuId != null) 'sku_id': skuId,
        'sale_price': salePrice,
        'original_price': originalPrice,
      });

  static Future<Map<String, dynamic>> updateProductStock({
    required String productId,
    String? skuId,
    required int stock,
  }) =>
      _putMutation('/api/v1/partner/products/$productId/stock', {
        if (skuId != null) 'sku_id': skuId,
        'stock_quantity': stock,
      });

  static Future<Map<String, dynamic>> updateProduct({
    required String productId,
    required Map<String, dynamic> fields,
  }) =>
      _putMutation('/api/v1/partner/products/$productId', fields);

  static Future<Map<String, dynamic>> createProduct(Map<String, dynamic> payload) =>
      _postMutation('/api/v1/partner/products', payload);

  static Future<List<ReturnClaim>> getReturns() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/returns');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '반품 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => ReturnClaim.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 반품 목록을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> decideReturn({
    required String claimId,
    required bool approve,
    required String notes,
    String? fault,
    bool returnless = false,
  }) =>
      _putMutation('/api/v1/partner/returns/$claimId', {
        'decision': approve ? 'APPROVE' : 'REJECT',
        'notes': notes,
        if (fault != null && fault.isNotEmpty) 'fault': fault,
        if (returnless) 'returnless': true,
      });

  static Future<Map<String, dynamic>> reshipExchange({
    required String claimId,
    required String carrier,
    required String trackingNumber,
    required bool returnReceived,
  }) =>
      _postMutation('/api/v1/partner/returns/$claimId/reship', {
        'carrier': carrier,
        'tracking_number': trackingNumber,
        'return_received': returnReceived,
      });

  static Future<List<PartnerQna>> getQna() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/qna');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? 'Q&A 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => PartnerQna.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 Q&A 목록을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> answerQna({
    required String qnaId,
    required String answer,
  }) =>
      _postMutation('/api/v1/partner/qna/$qnaId/answer', {'answer': answer});

  /// Campaign directory is public; bids and negotiations need the seller session.
  static Future<List<BiddingCampaign>> getCampaigns({String status = 'OPEN'}) async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/bidding/campaigns?status=$status');
      final res = await http.get(uri, headers: const {'Content-Type': 'application/json'}).timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '캠페인 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => BiddingCampaign.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 캠페인 목록을 불러오지 못했습니다.');
    }
  }

  static Future<List<SupplierBid>> getMyBids() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/bidding/my-bids');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '입찰 내역을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => SupplierBid.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 입찰 내역을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> submitBid({
    required String campaignId,
    required int price,
    required int moq,
    required int leadDays,
    required String notes,
  }) =>
      _postMutation('/api/v1/bidding/campaigns/$campaignId/bids', {
        'bid_supply_price': price,
        'moq': moq,
        'production_lead_days': leadDays,
        'bid_notes': notes,
      });

  static Future<List<PriceNegotiation>> getNegotiations() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/pricing/negotiations');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '네고 목록을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => PriceNegotiation.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 네고 목록을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> respondNegotiation({
    required String negotiationId,
    required bool accept,
    required String notes,
  }) =>
      _postMutation('/api/v1/partner/pricing/negotiations/$negotiationId/respond', {
        'accept': accept,
        'partner_response_notes': notes,
      });

  static Future<List<ChannelListing>> getChannelListings() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/channels/listings');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '리스팅을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => ChannelListing.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 리스팅을 불러오지 못했습니다.');
    }
  }

  /// Static reference directories (no seller session needed).
  static Future<List<SalesChannel>> getSalesChannels() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/channels/sales-channels');
      final res = await http.get(uri, headers: const {'Content-Type': 'application/json'}).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '판매채널을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => SalesChannel.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 판매채널을 불러오지 못했습니다.');
    }
  }

  static Future<List<CommercePlatform>> getPlatforms() async {
    try {
      final uri = Uri.parse('$baseUrl/api/v1/channels/platforms');
      final res = await http.get(uri, headers: const {'Content-Type': 'application/json'}).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '플랫폼을 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => CommercePlatform.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 플랫폼을 불러오지 못했습니다.');
    }
  }

  static Future<List<ChannelCredential>> getChannelCredentials() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/channels/credentials');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '인증정보를 불러오지 못했습니다.');
      }
      final List<dynamic> list = _decode(res.body)['data'] ?? [];
      return list.map((e) => ChannelCredential.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 인증정보를 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> saveChannelCredential({
    required String platformId,
    required String credentialName,
    required String apiKey,
    String secretKey = '',
    String sellerAccountId = '',
  }) =>
      _postMutation('/api/v1/channels/credentials', {
        'platform_id': platformId,
        'credential_name': credentialName,
        'api_key': apiKey,
        if (secretKey.isNotEmpty) 'secret_key': secretKey,
        if (sellerAccountId.isNotEmpty) 'seller_account_id': sellerAccountId,
      });

  static Future<Map<String, dynamic>> verifyChannelCredential(String credentialId) =>
      _postMutation('/api/v1/channels/credentials/$credentialId/verify', {});

  static Future<Map<String, dynamic>> publishListing(Map<String, dynamic> payload) =>
      _postMutation('/api/v1/channels/listings/publish', payload);

  static Future<Map<String, dynamic>> syncOrders(String salesChannelId) =>
      _postMutation('/api/v1/channels/orders/sync', {'sales_channel_id': salesChannelId});

  static Future<PartnerProfile> getPartnerProfile() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/profile');
      final res = await _authed(() => http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        throw const PartnerAuthRequiredException();
      }
      if (res.statusCode != 200) {
        throw PartnerApiException(_decode(res.body)['error']?.toString() ?? '프로필을 불러오지 못했습니다.');
      }
      final data = _decode(res.body)['data'];
      if (data is! Map) throw PartnerApiException('프로필을 불러오지 못했습니다.');
      return PartnerProfile.fromJson(Map<String, dynamic>.from(data));
    } on PartnerAuthRequiredException {
      rethrow;
    } on PartnerApiException {
      rethrow;
    } catch (_) {
      throw PartnerApiException('네트워크 오류로 프로필을 불러오지 못했습니다.');
    }
  }

  static Future<Map<String, dynamic>> updatePartnerProfile(Map<String, dynamic> fields) =>
      _putMutation('/api/v1/partner/profile', fields);

  /// Wave J-2: registers / drops the FCM device token (server seals it).
  static Future<Map<String, dynamic>> registerPushToken({
    required String token,
    required String platform,
  }) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/push/tokens');
      final res = await _authed(() => http
          .post(uri, headers: PartnerAuthSession.headers(), body: jsonEncode({'token': token, 'platform': platform, 'app': 'PARTNER'}))
          .timeout(const Duration(seconds: 10)));
      final decoded = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if ((res.statusCode == 200 || res.statusCode == 201) && decoded['success'] == true) {
        return {'ok': true, 'created': decoded['created'] == true};
      }
      return {'ok': false, 'error': decoded['error']?.toString() ?? '푸시 등록에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 푸시 등록에 실패했습니다.'};
    }
  }

  static Future<Map<String, dynamic>> unregisterPushToken({required String token}) async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) {
      return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 필요합니다.'};
    }
    try {
      final uri = Uri.parse('$baseUrl/api/v1/push/tokens');
      final res = await _authed(() => http
          .delete(uri, headers: PartnerAuthSession.headers(), body: jsonEncode({'token': token}))
          .timeout(const Duration(seconds: 10)));
      final decoded = _decode(res.body);
      if (res.statusCode == 401) {
        await PartnerAuthSession.onUnauthorized();
        return {'ok': false, 'code': 'UNAUTHENTICATED', 'error': '로그인이 만료되었습니다. 다시 로그인해 주세요.'};
      }
      if (res.statusCode == 200 && decoded['success'] == true) {
        return {'ok': true, 'deleted': decoded['deleted']};
      }
      return {'ok': false, 'error': decoded['error']?.toString() ?? '푸시 해제에 실패했습니다.'};
    } catch (_) {
      return {'ok': false, 'error': '네트워크 오류로 푸시 해제에 실패했습니다.'};
    }
  }
}

class PartnerApiException implements Exception {
  final String message;
  PartnerApiException(this.message);
  @override
  String toString() => message;
}

class PartnerAuthRequiredException implements Exception {
  const PartnerAuthRequiredException();
}
