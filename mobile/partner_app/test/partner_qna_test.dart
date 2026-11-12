// Seller Q&A parsing + answer rule mirror (routes/partner.js).
import 'package:flutter_test/flutter_test.dart';
import 'package:olmoa_partner/models/partner_qna.dart';

void main() {
  test('fromJson reads a Q&A row with the product title', () {
    final q = PartnerQna.fromJson({
      'id': 'qna_1',
      'product_id': 'prod_1',
      'product_title': '테스트 상품',
      'questioner_name': '김*수',
      'question': '연결되나요?',
      'answer': null,
      'is_secret': 0,
      'status': 'WAITING',
      'created_at': '2026-11-01 10:00:00',
    });
    expect(q.productTitle, '테스트 상품');
    expect(q.answered, isFalse);
    expect(q.statusLabel, '미답변');
    expect(q.isSecret, isFalse);
  });

  test('answered rows expose the stored answer', () {
    final q = PartnerQna.fromJson({
      'id': 'qna_2',
      'status': 'ANSWERED',
      'answer': '네, 지원합니다.',
      'is_secret': 1,
    });
    expect(q.answered, isTrue);
    expect(q.statusLabel, '답변 완료');
    expect(q.answer, '네, 지원합니다.');
    expect(q.isSecret, isTrue);
  });

  test('answer validation mirrors the server (required, <=2000)', () {
    expect(validateQnaAnswer('  '), isNotNull);
    expect(validateQnaAnswer('네, 지원합니다.'), isNull);
    expect(validateQnaAnswer('x' * 2001), isNotNull);
    expect(validateQnaAnswer('x' * 2000), isNull);
  });
}
