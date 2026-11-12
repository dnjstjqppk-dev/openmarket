// Multichannel parsing + publish/credential rule mirror.
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/channel_listing.dart';

void main() {
  test('listing rows expose channel, product, and sync status', () {
    final l = ChannelListing.fromJson({
      'id': 'lst_1',
      'sales_channel_id': 'sc_1',
      'channel_name': '네이버 스마트스토어',
      'product_id': 'prod_1',
      'product_title': '테스트 상품',
      'channel_sale_price': 19900,
      'stock_allocated': 12,
      'status': 'PENDING_REVIEW',
    });
    expect(l.channelName, '네이버 스마트스토어');
    expect(l.statusLabel, '채널 심사중');
    expect(ChannelListing.fromJson({'status': 'SYNC_FAILED'}).statusLabel, '동기화 실패');
    expect(ChannelListing.fromJson({'status': 'DRAFT'}).statusLabel, '임시 저장');
  });

  test('sales channels expose the commission rate', () {
    final c = SalesChannel.fromJson({
      'id': 'sc_1',
      'channel_name': '네이버 스마트스토어',
      'platform_id': 'naver',
      'platform_name': '네이버',
      'commission_bps': 550,
      'currency': 'KRW',
    });
    expect(c.commissionLabel, '5.5%');
    expect(SalesChannel.fromJson({'commission_bps': 1000}).commissionLabel, '10%');
  });

  test('credential rows expose masked keys and verify status', () {
    final c = ChannelCredential.fromJson({
      'id': 'cred_1',
      'platform_name': '네이버',
      'credential_name': '기본 계정',
      'api_key_masked': 'abcd...1234',
      'status': 'CONFIGURED',
      'is_sandbox': 0,
    });
    expect(c.apiKeyMasked, 'abcd...1234');
    expect(c.statusLabel, '등록됨(미검증)');
    expect(c.isSandbox, isFalse);
  });

  test('publish requires product, channel, brand, courier, category', () {
    String? valid = validateChannelPublish(
      productId: 'prod_1',
      salesChannelId: 'sc_1',
      brand: 'OLMOA',
      deliveryCompany: 'CJ대한통운',
      externalCategoryId: '50001',
      salePriceRaw: '',
    );
    expect(valid, isNull);
    expect(
        validateChannelPublish(
          productId: null,
          salesChannelId: 'sc_1',
          brand: 'OLMOA',
          deliveryCompany: 'CJ대한통운',
          externalCategoryId: '50001',
          salePriceRaw: '',
        ),
        isNotNull);
    expect(
        validateChannelPublish(
          productId: 'prod_1',
          salesChannelId: 'sc_1',
          brand: '',
          deliveryCompany: 'CJ대한통운',
          externalCategoryId: '50001',
          salePriceRaw: '',
        ),
        isNotNull);
    expect(
        validateChannelPublish(
          productId: 'prod_1',
          salesChannelId: 'sc_1',
          brand: 'OLMOA',
          deliveryCompany: 'CJ대한통운',
          externalCategoryId: '50001',
          salePriceRaw: '0',
        ),
        isNotNull);
  });

  test('credential registration requires a platform and an API key', () {
    expect(validateChannelCredential(platformId: null, apiKey: 'k'), isNotNull);
    expect(validateChannelCredential(platformId: 'naver', apiKey: '  '), isNotNull);
    expect(validateChannelCredential(platformId: 'naver', apiKey: 'key-1'), isNull);
  });
}
