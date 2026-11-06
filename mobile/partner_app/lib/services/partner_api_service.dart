import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/sub_order.dart';

/// Server-issued JWT session for an approved seller. The gateway derives
/// identity ONLY from the Bearer token (lib/auth.js) — X-Partner-Id headers
/// are ignored, and no demo seller is ever assumed.
class PartnerAuthSession {
  static const _kToken = 'olmoa_partner_token';
  static const _kBusiness = 'olmoa_partner_business';

  static String? _token;
  static String? _businessName;
  static bool _restored = false;

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
      final prefs = await SharedPreferences.getInstance();
      _token = prefs.getString(_kToken);
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
        final partner = body['partner'];
        _businessName = (partner is Map ? partner['business_name'] : null)?.toString() ?? '판매자';
        try {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_kToken, _token!);
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
    _businessName = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_kToken);
      await prefs.remove(_kBusiness);
    } catch (_) {}
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
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';

  // Instance methods
  Future<Map<String, dynamic>> fetchDashboardMetrics() => PartnerApiService.getDashboardMetrics();

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

  // Static methods
  static Future<Map<String, dynamic>> getDashboardMetrics() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/metrics');
      final res = await http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 8));
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

  static Future<List<SubOrder>> getPartnerOrders() async {
    await PartnerAuthSession.restore();
    if (!PartnerAuthSession.isAuthenticated) throw const PartnerAuthRequiredException();
    try {
      final uri = Uri.parse('$baseUrl/api/v1/partner/orders');
      final res = await http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 10));
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
      final res = await http
          .put(
            uri,
            headers: PartnerAuthSession.headers(),
            body: jsonEncode({'carrier': carrier, 'tracking_number': trackingNumber}),
          )
          .timeout(const Duration(seconds: 10));
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
      final res = await http.get(uri, headers: PartnerAuthSession.headers()).timeout(const Duration(seconds: 8));
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
