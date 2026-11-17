-- d1_68_legal_documents.sql
-- Work order 5-6: operator-managed versioned legal documents.
-- kind: TERMS (이용약관) | PRIVACY (개인정보처리방침) | REFUND (취소·반품·환불 안내).
-- effective_date is a KST calendar day (YYYY-MM-DD). The registration API refuses
-- dates before today (KST); there is deliberately NO backdate trigger here because
-- the seed rows below are past-dated by design (they are the current versions).
--
-- Body format (parsed by the storefront, previewed in the admin console):
--   '# ' line  -> section heading (ids a1..an in order)
--   '- ' line  -> bullet item
--   other line -> paragraph; '{{OPERATOR}}' is replaced with business-info legal_name
--   '**x**'    -> inline emphasis
CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('TERMS', 'PRIVACY', 'REFUND')),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 20),
  effective_date TEXT NOT NULL CHECK (effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  author_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, version)
);
CREATE INDEX IF NOT EXISTS idx_legal_documents_kind_effective ON legal_documents(kind, effective_date DESC);

-- Seed: the 5-5-cleaned texts (terms v1.1 without the retired article 5).
INSERT OR IGNORE INTO legal_documents (id, kind, version, effective_date, body, author_user_id) VALUES
('ld_terms_v11', 'TERMS', 'v1.1', '2026-11-17',
'# 제1조 (목적)
본 약관은 {{OPERATOR}}(이하 "회사")가 운영하는 OLMOA 글로벌 전자상거래 플랫폼(이하 "몰")에서 제공하는 전자상거래 관련 서비스(이하 "서비스")를 이용함에 있어 몰과 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
# 제2조 (정의)
1. "몰"이란 회사가 재화 또는 용역을 이용자에게 제공하기 위하여 컴퓨터 등 정보통신설비를 이용하여 재화 등을 거래할 수 있도록 설정한 가상의 영업장을 말합니다.
2. "이용자"란 "몰"에 접속하여 본 약관에 따라 "몰"이 제공하는 서비스를 받는 회원 및 비회원을 말합니다.
3. "판매 파트너"란 회사와 입점 계약을 체결하고 몰을 통하여 상품을 판매하는 자를 말합니다.
# 제3조 (약관의 명시와 개정)
"몰"은 본 약관의 내용과 상호, 영업소 소재지, 대표자 성명, 사업자등록번호, 통신판매업신고번호, 고객센터 연락처 등을 이용자가 쉽게 알 수 있도록 초기 서비스 화면에 게시합니다.
# 제4조 (계약의 성립 및 결제)
이용자가 구매 신청을 완료하고 대금 결제를 이행함으로써 주문 계약이 성립합니다.', NULL),
('ld_privacy_v10', 'PRIVACY', 'v1.0', '2026-01-01',
'# 1. 수집하는 개인정보 항목 및 수집방법
회사는 회원가입, 원활한 고객상담, 각종 서비스의 제공을 위해 최초 회원가입 또는 주문서 작성 당시 아래와 같은 최소한의 개인정보를 수집하고 있습니다.
- **주문 및 배송:** 수령인 성명, 휴대전화번호, 배송지 주소, 통관고유부호(해외직구 시)
- **결제:** 신용카드 정보, 계좌번호, 결제 수단 승인 식별값
- **서비스 이용과정 자동수집:** IP주소, 쿠키, 접속로그, 기기정보
# 2. 개인정보의 수집 및 이용목적
수집된 개인정보는 계약의 이행, 물품배송 및 대금결제, 고객상담 및 불만처리, 맞춤형 서비스 제공 및 통계 분석에 한하여 이용됩니다.
# 3. 개인정보의 보유 및 이용기간
전자상거래 등에서의 소비자보호에 관한 법률 등 관련 법령에 의하여 보존할 필요가 있는 경우 다음과 같이 법정 기간 동안 보관합니다.
- 계약 또는 청약철회 등에 관한 기록: 5년
- 대금결제 및 재화 등의 공급에 관한 기록: 5년
- 소비자의 불만 또는 분쟁처리에 관한 기록: 3년', NULL),
('ld_refund_v10', 'REFUND', 'v1.0', '2026-01-01',
'# 1. 결제 전 주문
결제가 완료되지 않은 주문은 언제든 취소할 수 있으며, 주문 후 30분 내 결제가 이루어지지 않으면 자동 취소됩니다. 이때 사용한 쿠폰과 적립금은 즉시 복원됩니다.
# 2. 출고 전 취소
판매자가 상품을 출고하기 전에는 주문 전체 또는 판매자별로 취소할 수 있습니다. 결제 금액은 원래의 결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 주문 전체 취소 시 사용한 쿠폰도 복원됩니다.
# 3. 반품(청약철회)
상품을 받은 날부터 7일 이내에 반품을 신청할 수 있습니다(전자상거래 등에서의 소비자보호에 관한 법률 제17조). 반품 신청 후 판매자가 상품 회수·확인을 마치면 환불이 진행됩니다. 단순 변심에 의한 반품의 경우 반품 배송비가 부과될 수 있으며, 구체적인 금액은 판매자별로 상이합니다.
환불 금액은 해당 상품에 실제로 결제된 금액(쿠폰 할인·적립금 사용분을 상품별로 배분한 금액)을 기준으로 계산됩니다.
# 4. 환불 시기
환불 사유 확정 후 3영업일 이내에 결제 취소를 요청합니다. 카드사·결제사 사정에 따라 실제 반영까지 추가 기간이 소요될 수 있습니다.
# 5. 판매 주체
''올모아 직영'' 상품은 운영 사업자가 판매자이며, 입점 판매자 상품은 각 판매자가 반품·환불의 당사자입니다. 판매자 정보는 상품 상세 및 주문 상세에서 확인할 수 있습니다.', NULL);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_68_legal_documents.sql', CURRENT_TIMESTAMP);
