-- d1_76_faqs.sql
-- Work order 6-13 (decision-21): admin-managed FAQ. The four previously
-- hardcoded wordings move here unchanged (categories remapped per the 6-13
-- report), new rows are operator content. Additive only. Rerun-safe
-- (IF NOT EXISTS + INSERT OR IGNORE per repo convention).

CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_faqs_published ON faqs(is_published, category, sort_order);

INSERT OR IGNORE INTO faqs (id, category, question, answer, sort_order, is_published) VALUES
  ('faq_ship_001', '배송', '배송비와 배송 기간은 어떻게 되나요?',
   '배송비와 무료배송 기준은 판매자(직영/입점)별로 다르며 주문서에서 판매자별로 확인할 수 있습니다. 배송 예정일을 넘긴 경우 주문 상세에서 지연 보상을 신청할 수 있습니다.',
   10, 1),
  ('faq_return_001', '반품/교환', '반품은 어떻게 하나요?',
   '상품 수령 후 7일 이내 주문 상세에서 반품을 신청할 수 있습니다. 판매자가 회수·확인하면 결제 금액은 원결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 단순 변심 반품은 반품 배송비가 부과될 수 있습니다.',
   20, 1),
  ('faq_pay_001', '주문/결제', '결제 대금은 언제 판매자에게 지급되나요?',
   '입점 판매자의 판매대금은 구매확정(또는 배송완료 후 7일 자동 확정) 이후 정산되며, 정산 후 환불이 발생하면 다음 정산에서 차감됩니다.',
   30, 1),
  ('faq_seller_001', '판매자 입점', '올모아 글로벌 셀러로 입점하려면 어떻게 해야 하나요?',
   '상단 [셀러 입점] 메뉴를 통해 사업자등록증 및 정산 계좌를 제출하시면 운영 관리자 심사 완료 후 전용 파트너 센터에서 상품 등록 및 대량 CSV 업로드가 가능합니다.',
   40, 1);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_76_faqs.sql', CURRENT_TIMESTAMP);
