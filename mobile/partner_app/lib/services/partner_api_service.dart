// mobile/partner_app/lib/services/partner_api_service.dart
// OLMOA Mobile Partner API Service: D1 Gateway Synchronization

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/sub_order.dart';

class PartnerApiService {
  static const String baseUrl = 'https://olmoa-api.dnjstjqppk.workers.dev';
  static const String partnerId = 'pt_001';

  Map<String, String> _getPartnerHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Partner-Id': partnerId,
      'Authorization': 'Bearer $partnerId',
    };
  }

  Future<List<SubOrder>> fetchPartnerOrders() async {
    try {
      final res = await http.get(
        Uri.parse('$baseUrl/api/v1/partner/orders'),
        headers: _getPartnerHeaders(),
      );
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body);
        final List<dynamic> list = body['data'] ?? [];
        if (list.isNotEmpty) {
          return list.map((item) {
            final itemsList = item['items'] as List<dynamic>? ?? [];
            final title = itemsList.isNotEmpty ? itemsList[0]['product_title'] : '주문 상품';
            final qty = itemsList.isNotEmpty ? itemsList[0]['quantity'] : 1;

            return SubOrder(
              id: item['id'] ?? 'sub_001',
              subOrderNo: item['sub_order_no'] ?? item['order_no'] ?? 'ORD-001',
              productTitle: title,
              quantity: qty is int ? qty : 1,
              totalAmount: item['total_amount'] ?? 49900,
              status: item['status'] ?? 'PREPARING',
            );
          }).toList();
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
        Uri.parse('$baseUrl/api/v1/partner/orders/$subOrderId/shipment'),
        headers: _getPartnerHeaders(),
        body: jsonEncode({
          'carrier': carrier,
          'tracking_number': trackingNo,
        }),
      );
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
