// mobile/partner_app/lib/models/partner_qna.dart
// Seller product Q&A rows (GET /api/v1/partner/qna) plus the answer rule
// mirror of routes/partner.js (answer required, max 2000).

class PartnerQna {
  final String id;
  final String productId;
  final String productTitle;
  final String questionerName;
  final String question;
  final String? answer;
  final bool isSecret;
  final String status;
  final String createdAt;

  const PartnerQna({
    required this.id,
    required this.productId,
    required this.productTitle,
    required this.questionerName,
    required this.question,
    required this.answer,
    required this.isSecret,
    required this.status,
    required this.createdAt,
  });

  factory PartnerQna.fromJson(Map<String, dynamic> json) {
    return PartnerQna(
      id: (json['id'] ?? '').toString(),
      productId: (json['product_id'] ?? '').toString(),
      productTitle: (json['product_title'] ?? '').toString(),
      questionerName: (json['questioner_name'] ?? '').toString(),
      question: (json['question'] ?? '').toString(),
      answer: json['answer']?.toString(),
      isSecret: json['is_secret'] == 1 || json['is_secret'] == true,
      status: (json['status'] ?? 'WAITING').toString(),
      createdAt: (json['created_at'] ?? '').toString(),
    );
  }

  bool get answered => status == 'ANSWERED';

  String get statusLabel => answered ? '답변 완료' : '미답변';
}

/// Server rule mirror (POST /api/v1/partner/qna/:id/answer).
/// null = valid, otherwise the message to show.
String? validateQnaAnswer(String raw) {
  if (raw.trim().isEmpty) return '답변을 입력해 주세요.';
  if (raw.trim().length > 2000) return '답변은 2,000자 이내로 입력해 주세요.';
  return null;
}
