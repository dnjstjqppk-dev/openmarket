// Return claim parsing + decision/reship rule mirror (routes/partner.js,
// ReturnsManageView labels).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/return_claim.dart';

void main() {
  test('fromJson reads a claim row with joined order/customer fields', () {
    final c = ReturnClaim.fromJson({
      'id': 'clm_1',
      'order_id': 'ord_1',
      'sub_order_id': 'sub_1',
      'order_no': 'O-001',
      'sub_order_no': 'S-001',
      'claim_type': 'EXCHANGE',
      'reason': '사이즈 교환',
      'reason_code': 'SIZE_COLOR',
      'status': 'APPROVED',
      'refund_amount': 0,
      'customer_email': 'buyer@example.com',
      'customer_name': '홍길동',
      'exchange_status': 'AWAITING_RESHIPMENT',
      'goods_amount': 9900,
      'shipping_fee': 3000,
      'total_amount': 12900,
    });
    expect(c.typeLabel, '교환');
    expect(c.statusLabel, '승인됨');
    expect(c.reasonLabel, '사이즈·색상');
    expect(c.awaitingReship, isTrue);
    expect(c.customerLabel, '홍길동 (buyer@example.com)');
  });

  test('labels never leak raw codes', () {
    final c = ReturnClaim.fromJson({
      'id': 'c',
      'claim_type': 'RETURN',
      'reason': '단순 변심',
      'status': 'REQUESTED',
    });
    expect(c.typeLabel, '반품');
    expect(c.statusLabel, '검토 요청');
    expect(c.reasonLabel, '단순 변심');
    expect(c.awaitingReship, isFalse);
    final adj = ReturnClaim.fromJson({'id': 'c2', 'claim_type': 'PRICE_ADJUSTMENT', 'status': 'REFUNDED'});
    expect(adj.typeLabel, '최저가 보상');
    expect(adj.statusLabel, '환불 완료');
  });

  test('rejection without a note is refused (REASON_REQUIRED mirror)', () {
    expect(validateClaimDecision(approve: false, notes: '  ', fault: null, existingFault: null), isNotNull);
    expect(validateClaimDecision(approve: false, notes: '이미 사용한 상품', fault: null, existingFault: null), isNull);
    expect(validateClaimDecision(approve: true, notes: '', fault: null, existingFault: null), isNull);
  });

  test('newly blaming the customer needs a written ground', () {
    expect(
        validateClaimDecision(approve: true, notes: '', fault: 'CUSTOMER', existingFault: null),
        isNotNull);
    expect(
        validateClaimDecision(approve: true, notes: '개봉 흔적 확인', fault: 'CUSTOMER', existingFault: null),
        isNull);
    expect(
        validateClaimDecision(approve: true, notes: '', fault: 'CUSTOMER', existingFault: 'CUSTOMER'),
        isNull);
  });

  test('decision payload uses the server contract', () {
    final p = claimDecisionPayload(approve: true, notes: ' 확인 ', fault: 'SELLER', returnless: true);
    expect(p['decision'], 'APPROVE');
    expect(p['notes'], '확인');
    expect(p['fault'], 'SELLER');
    expect(p['returnless'], isTrue);
    final r = claimDecisionPayload(approve: false, notes: 'x');
    expect(r['decision'], 'REJECT');
    expect(r.containsKey('fault'), isFalse);
    expect(r.containsKey('returnless'), isFalse);
  });

  test('reship tracking mirrors the server pattern', () {
    expect(validateReshipTracking('123456'), isNull);
    expect(validateReshipTracking('AB-1234-XYZ'), isNull);
    expect(validateReshipTracking('12345'), isNotNull);
    expect(validateReshipTracking('한글송장123456'), isNotNull);
    expect(validateReshipTracking('x' * 41), isNotNull);
  });
}
