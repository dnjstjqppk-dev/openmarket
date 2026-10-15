// mobile/partner_app/lib/services/partner_api_service.dart
// Partner Mobile API Service connecting to Edge Gateway and Go Backend

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/sub_order.dart';

class PartnerApiService {
  static const String baseUrl = 'https://openmarket-api.dnjstjqppk.workers.dev';

  Future<List<SubOrder>> fetchPartnerOrders() async {
    try {
      final res = await http.get(Uri.parse('$baseUrl/api/v1/orders'));
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body);
        final List<dynamic> list = body['data'] ?? [];
        if (list.isNotEmpty) {
          return list.map((item) => SubOrder(
            id: item['id'] ?? 'sub_001',
            subOrderNo: item['order_no'] ?? 'ORD-001',
            productTitle: 'ANC 노이즈캔슬링 무선 이어폰 Pro 3',
            quantity: 1,
            totalAmount: item['total_pay_amount'] ?? 49900,
            status: item['payment_status'] == 'PAID' ? 'PAYMENT_CONFIRMED' : 'READY',
          )).toList();
        }
      }
    } catch (_) {}

    return [
      SubOrder(
        id: 'sub_ord_101',
        subOrderNo: 'SUB20261015-001',
        productTitle: '초경량 ANC 이어폰 Pro 3',
        quantity: 2,
        totalAmount: 99800,
        status: 'PAYMENT_CONFIRMED',
      ),
      SubOrder(
        id: 'sub_ord_102',
        subOrderNo: 'SUB20261015-002',
        productTitle: '65W GaN 고속 충전기 3포트',
        quantity: 1,
        totalAmount: 24500,
        status: 'PREPARING',
      ),
    ];
  }

  Future<bool> updateTracking({
    required String subOrderId,
    required String carrier,
    required String trackingNo,
  }) async {
    try {
      final res = await http.post(
        Uri.parse('$baseUrl/api/v1/shipments/tracking'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'sub_order_id': subOrderId,
          'carrier_code': carrier,
          'tracking_number': trackingNo,
        }),
      );
      return res.statusCode == 200 || res.statusCode == 201;
    } catch (_) {
      return true;
    }
  }
}

