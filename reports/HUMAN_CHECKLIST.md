# 인간 검수 체크리스트 (에이전트 불가 항목)

- 작성: 2026-11-07 · 대상: 상용화 100% 잔여 인간 항목
- 에이전트는 이미지 판독·실기기·사업자등록을 할 수 없어 아래는 직접 수행 필요.

## 1. 스크린샷 육안 검수 (필수, 출시 전)

- 폴더: `reports/v4/phase3/smoke/{storefront,admin,partner}/*.png` (336장)
  + `reports/v4/phase3/smoke-payments/*.png` (12장)
- 파일명: `[View]_[viewport]_[width].png` (예: `HomeView_tablet_portrait_768.png`)
- 판정표: `reports/v4/phase3/matrix.csv` (342셀: 57라우트 × 6구간)
- 셀별 확인: 가로 스크롤 없음 · 텍스트 잘림 없음 · 버튼 겹침 없음 ·
  44px 터치 영역 · Safe Area 침범 없음 · 깨진 이미지 없음 · 회색 빈 박스 없음
- WARN 2행은 의도된 에러 상태 표출인지 확인:
  `storefront /orders/:id`(API 404) · `/payments/success`(파라미터 없음 400)
- 부록 D 변경 뷰는 기존 PNG가 구버전이므로 출시 전 재캡처 후 검수
  (스토어 주문·주문상세·지갑·고객센터, 관리자 주문·원장·입점사, 파트너 URL임포트·출고)
- 결과 기록: `reports/COMMERCIALIZATION_100_FINAL.md` §2 표에 일자·서명 추가

## 2. Flutter 실기기 캡처 (디바이스랩)

- 골든 4종은 `reports/v4/phase3/flutter/`에 있음 (로그인 폰/태블릿, 스캐폴드 폰/레일)
- 실기기에서 캡처 후 대조: 홈 · 검색(자동완성·결과) · 상품상세(옵션선택) ·
  장바구니 · 주문 · 결제안내시트 · 태블릿 레일 내비 ·
  파트너앱 출고 다이얼로그(택배사 선택 6종)
- 기종: Android 폰 1 + iOS 폰 1 + 태블릿 1 권장 (다크모드 각 1장 포함)

## 3. 운영 계정·사업자 (사업자등록 후)

1. 사업자등록 완료 후 실제 정보로 Admin `/business` 등록 → 활성화
2. `/health`에서 `operator_entity_active:true` 확인
3. 테스트 주문 1건으로 체크아웃 정상 확인 (현재 OPERATOR_NOT_CONFIGURED로 차단 중)
4. 관리자 `dnjstjqp@naver.com` 2FA 등록 완료 확인 (OTP 앱 필요)

## 4. 계약 10종 (최종보고서 §10 순서대로, P0 통과 후)

- Cloudflare Paid · Toss 실가맹 · Resend · Kakao 정식 · SMS ·
  캐리어/UNI-PASS · olmoa.com · 스토어 계정 · 법무검토 · 검색클라우드
- 메일 연동 시 P2R-01 재검토: forgot-password가 자동으로 메일 발송으로 전환됨
  (코드 변경 불필요, `emailConfigured` 분기)

---

- [ ] 1. 스크린샷 검수 (일자/서명: ______)
- [ ] 2. 실기기 캡처 (일자/서명: ______)
- [ ] 3. 사업자 등록·활성화·테스트주문 (일자: ______)
- [ ] 4. 계약 진행 (별도 일정)
