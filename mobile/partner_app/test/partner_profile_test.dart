// Seller profile parsing + edit rule mirror (routes/partner.js).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/partner_profile.dart';

void main() {
  test('fromJson reads identity, fees, and bank state', () {
    final p = PartnerProfile.fromJson({
      'id': 'pt_1',
      'business_name': '테스트상회',
      'business_reg_number': '123-45-67890',
      'status': 'APPROVED',
      'sales_model': 'MARKETPLACE',
      'commission_rate': 10,
      'bank_code': '004',
      'bank_account_number': '****8920',
      'bank_account_holder': '홍길동',
      'payout_account_verified': 1,
      'payout_change_pending': false,
      'settlement_cycle': 'BIWEEKLY',
      'base_shipping_fee': 3000,
      'free_shipping_threshold': 30000,
      'representative_name': '홍길동',
      'mail_order_reg_number': '2026-서울-0001',
      'cs_email': 'cs@example.com',
    });
    expect(p.businessName, '테스트상회');
    expect(p.bankAccountMasked, '****8920');
    expect(p.payoutAccountVerified, isTrue);
    expect(p.cycleLabel, '격주 정산');
    expect(p.salesModelLabel, '마켓플레이스(중개)');
    expect(p.returnShippingFee, isNull);
  });

  test('fee validation mirrors the server bounds', () {
    String? valid = validateProfileFees(
      baseFeeRaw: '3000',
      freeThresholdRaw: '30000',
      returnFeeRaw: '',
      csEmail: '',
    );
    expect(valid, isNull);
    expect(
        validateProfileFees(
          baseFeeRaw: '100001',
          freeThresholdRaw: '30000',
          returnFeeRaw: '',
          csEmail: '',
        ),
        isNotNull);
    expect(
        validateProfileFees(
          baseFeeRaw: '3000',
          freeThresholdRaw: '10000001',
          returnFeeRaw: '',
          csEmail: '',
        ),
        isNotNull);
    expect(
        validateProfileFees(
          baseFeeRaw: '-1',
          freeThresholdRaw: '30000',
          returnFeeRaw: '',
          csEmail: '',
        ),
        isNotNull);
    expect(
        validateProfileFees(
          baseFeeRaw: '3000',
          freeThresholdRaw: '30000',
          returnFeeRaw: '',
          csEmail: 'not-an-email',
        ),
        isNotNull);
    expect(
        validateProfileFees(
          baseFeeRaw: '3,000',
          freeThresholdRaw: '30000',
          returnFeeRaw: '2500',
          csEmail: 'cs@example.com',
        ),
        isNull);
  });
}
