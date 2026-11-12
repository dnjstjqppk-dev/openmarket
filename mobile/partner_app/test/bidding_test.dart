// Bidding/negotiation parsing + rule mirror (routes/bidding-m2c.js,
// BiddingView.vue labels).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/bidding.dart';

void main() {
  test('campaign rows expose ceiling, MOQ, and bid stats', () {
    final c = BiddingCampaign.fromJson({
      'id': 'cmp_1',
      'title': '겨울 패딩 소싱',
      'category_name': '아우터',
      'ceiling_supply_price': 25000,
      'min_moq': 500,
      'status': 'OPEN',
      'ends_at': '2026-12-01T00:00:00Z',
      'bid_count': 3,
      'lowest_bid_price': 22000,
    });
    expect(c.statusLabel, '입찰 진행중');
    expect(c.open, isTrue);
    expect(c.lowestBidPrice, 22000);
  });

  test('campaign labels mirror the web console', () {
    String label(String s) =>
        BiddingCampaign.fromJson({'id': 'c', 'status': s}).statusLabel;
    expect(label('EVALUATING'), '심사중');
    expect(label('AWARDED'), '낙찰 완료');
    expect(label('CANCELLED'), '취소됨');
    expect(label('CLOSED'), '마감됨');
    expect(BiddingCampaign.fromJson({'id': 'c', 'status': 'OPEN'}).open, isTrue);
  });

  test('bid rows expose the campaign title and result', () {
    final b = SupplierBid.fromJson({
      'id': 'bid_1',
      'campaign_title': '겨울 패딩 소싱',
      'campaign_status': 'AWARDED',
      'bid_supply_price': 22000,
      'moq': 500,
      'production_lead_days': 7,
      'status': 'WON',
    });
    expect(b.campaignTitle, '겨울 패딩 소싱');
    expect(b.statusLabel, '★ 낙찰 확정');
  });

  test('negotiation rows expose current and target prices', () {
    final n = PriceNegotiation.fromJson({
      'id': 'ngo_1',
      'product_title': '테스트 상품',
      'current_sale_price': 19900,
      'suggested_target_price': 17900,
      'discount_rate_suggested': 10.1,
      'status': 'PROPOSED',
    });
    expect(n.statusLabel, 'MD 제안');
    expect(n.awaitingResponse, isTrue);
    expect(n.discountRateSuggested, 10.1);
  });

  test('bid validation mirrors the server (floor, ceiling, MOQ, lead)', () {
    expect(validateSupplierBid(priceRaw: '99', ceiling: 25000, moqRaw: '500', leadDaysRaw: '7'), isNotNull);
    expect(validateSupplierBid(priceRaw: '25001', ceiling: 25000, moqRaw: '500', leadDaysRaw: '7'), isNotNull);
    expect(validateSupplierBid(priceRaw: '25000', ceiling: 25000, moqRaw: '0', leadDaysRaw: '7'), isNotNull);
    expect(validateSupplierBid(priceRaw: '25000', ceiling: 25000, moqRaw: '500', leadDaysRaw: '0'), isNotNull);
    expect(validateSupplierBid(priceRaw: '25000', ceiling: 25000, moqRaw: '500', leadDaysRaw: '91'), isNotNull);
    expect(validateSupplierBid(priceRaw: 'abc', ceiling: 25000, moqRaw: '500', leadDaysRaw: '7'), isNotNull);
    expect(validateSupplierBid(priceRaw: '22,000', ceiling: 25000, moqRaw: '500', leadDaysRaw: '7'), isNull);
  });

  test('counter travels as a rejection carrying the counter price', () {
    expect(
      counterResponseNotes(counterPrice: 18500, notes: '원가상 18500원이 한계입니다.'),
      '[역제안 희망가 18500원] 원가상 18500원이 한계입니다.',
    );
    expect(counterResponseNotes(counterPrice: 18500, notes: '  '), '[역제안 희망가 18500원]');
  });
}
