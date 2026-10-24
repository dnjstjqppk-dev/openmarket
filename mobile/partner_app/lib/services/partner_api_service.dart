import 'dart:convert';
import 'package:http/http.dart' as http;

class PartnerApiService {
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';
  static const String defaultPartnerId = 'pt_001';

  static Map<String, String> _headers([String partnerId = defaultPartnerId]) => {
    'Content-Type': 'application/json',
    'X-Partner-Id': partnerId,
  };

  static Future<Map<String, dynamic>> fetchDashboardMetrics({String partnerId = defaultPartnerId}) async {
    final uri = Uri.parse('$baseUrl/api/v1/partner/metrics');
    final res = await http.get(uri, headers: _headers(partnerId)).timeout(const Duration(seconds: 8));
    if (res.statusCode == 200) {
      final body = jsonDecode(res.body);
      return body['data'] ?? {};
    }
    return {};
  }

  static Future<List<Map<String, dynamic>>> fetchPartnerOrders({String partnerId = defaultPartnerId}) async {
    final uri = Uri.parse('$baseUrl/api/v1/partner/orders');
    final res = await http.get(uri, headers: _headers(partnerId)).timeout(const Duration(seconds: 8));
    if (res.statusCode == 200) {
      final body = jsonDecode(res.body);
      final List<dynamic> list = body['data'] ?? [];
      return list.cast<Map<String, dynamic>>();
    }
    return [];
  }

  static Future<bool> registerShipment({
    required String orderId,
    required String carrier,
    required String trackingNumber,
    String partnerId = defaultPartnerId,
  }) async {
    final uri = Uri.parse('$baseUrl/api/v1/partner/orders/$orderId/shipment');
    final res = await http.put(
      uri,
      headers: _headers(partnerId),
      body: jsonEncode({
        'carrier': carrier,
        'tracking_number': trackingNumber,
      }),
    ).timeout(const Duration(seconds: 8));
    return res.statusCode == 200;
  }

  static Future<Map<String, dynamic>> fetchSettlements({String partnerId = defaultPartnerId}) async {
    final uri = Uri.parse('$baseUrl/api/v1/partner/settlements');
    final res = await http.get(uri, headers: _headers(partnerId)).timeout(const Duration(seconds: 8));
    if (res.statusCode == 200) {
      final body = jsonDecode(res.body);
      return body['data'] ?? {};
    }
    return {};
  }
}
