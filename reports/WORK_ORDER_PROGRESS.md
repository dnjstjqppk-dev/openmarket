# WORK_ORDER 진행 기록

작업 번호 | 판정 | 커밋 해시 | 테스트 이름 | 메모
---|---|---|---|---
1-1 | 통과 | 81d56cc | tests/ui/docs_notice.test.mjs (2/2) | 3문서 안내문 + 상태 정정, test:ui 연결
1-2 | 실패 | ab9e468 | tests/ui/theme.test.mjs (5/5) | 토큰·프리셋은 명시값대로 구현, 4쌍이 4.5 미달이라 완료 기준 미충족 → Q-1-2
1-3 | 통과 | f514645 | tests/ui/type_scale.test.mjs (5/5) | 활자·그리드·행높이 CSS + 직접호출 동결(83), 전환은 3~4단계 → Q-1-3
1-4 | 통과 | 6352022 | tests/ui/components_commerce.test.mjs (9/9) | 25종 신규+표 확장+카드 이동, vue-tsc(ui·스토어) 무결함
1-5 | 통과 | 240536e | tests/ui/design_lint.test.mjs (1/1) | 상한 고정(스토어265·어드민294·셀러358·ui21), 신규코드 0건
1-6 | 통과 | 4c80978 | design_lint D02 + vue-tsc 3앱 | fa- 159건→lucide 전환, CDN 3종 제거, 참조 0건
1-7 | 통과 | 06d8319 | console_shell 11/11 + p1_admin 17/17 + wavef 33/33 | 양 콘솔 OmConsoleShell 전환, 기존주소 유지 → Q-1-7
1-8 | 통과 | 1a7d558 | storefront_shell 8/8 + typecheck | 메가메뉴·검색패널·하단4탭·레일·스크롤바, 3건 분리 → Q-1-8
1-9 | 실패 | 040ca81 | confirm_dialogs 5/5 + test:ui + typecheck 4종 | 47곳 전환, 테스트 고정 5곳 보류 → Q-1-9
1-10 | 통과 | a061dfd | error_states 18/18 + test:ui + typecheck 4종 + 육안 5종 | 문구통일·401 3앱·빈 24곳·스켈레톤 detail·기술문구 88곳 차단, 해석 7건 → Q-1-10
1-11 | 통과 | 10c64d4 | copy_honesty 11/11 + image_policy 3/3 + test:ui + typecheck 4종 | 표 10행 중 3행 적용·2행 현행적합·3행 부재·2행 제외, 예시 0건 → Q-1-11
2-1 | 통과 | 40c9026 | catalog_media_notice 8/8 + migrations + p1 + openapi 3/3 + e2e 26/26 | 이미지 갤러리·고시 템플릿·상세 확장, URL 강제 연기 → Q-2-1
2-2 | 통과 | a9324f1 | shipping_policy 9/9 + migrations + p1 + openapi 3/3 + e2e 26/26 | 배송 템플릿·묶음 그룹·내역 저장, 경계값 해석 → Q-2-2
2-3 | 통과 | 155aa37 | coupon_engine 12/12 + migrations + p1 + openapi 3/3 + e2e 26/26 | 플랫폼/스토어 분리·분담·환불·발급, 해석 → Q-2-3
2-4 | 통과 | b1919fc | settlement_policy 10/10 + migrations + p1 + payouts + openapi 3/3 + e2e 26/26 | 정책 정산식·출금 신청·승인 지급, 해석 → Q-2-4
2-5 | 통과 | 1e64bbe | reviews_social 8/8 + migrations + products + p1 + openapi 3/3 + e2e 26/26 | 리뷰 집계 트리거·정렬·소셜 테이블, 해석 → Q-2-5
2-6 | 통과 | f675bf1 | flash_sale 8/8 + migrations + p1 + commercial + products + openapi 3/3 + e2e 26/26 | 딜 단가·배정 경합·복원·기획전, 핀 갱신 → Q-2-6
2-7 | 통과 | 20f2289 | penalty_grade 4/4 + migrations + p1 + openapi 3/3 + e2e 26/26 | 페널티·등급표·월간 집계, 정의 → Q-2-7
2-8 | 통과 | bca064e | trending_search 8/8 + migrations + p1 + openapi 3/3 + e2e 26/26 | 급상승 집계·가격 이력·최근본 색인, 해석 → Q-2-8
2-9 | 통과 | e7fda48 | buyer 18/18 + partner 15/15 + admin 12/12 + openapi 3/3 + e2e 26/26 | 구매자·판매자·관리자 API, d1_61 예외, 해석 → Q-2-9
2-10 | 통과 | 8f89190 | security 88/88 + abuse 5/5 + rehearsal 15쌍 + npm test 전체 | 인증·금액·경합·시산표·RL_WRITE, 관문 조정 → Q-2-10
3-1 | 통과 | c32a8d7 | home_sections 6/6 + test:ui + typecheck + 빌드 | 7구역·무한40·요청6 이하·일시정지, 해석 → Q-3-1
3-2 | 통과 | efa9677 | plp 5/5 + plp_sections 6/6 + test:ui + typecheck | 공용 목록·필터7종·주소왕복·빈화면, 해석 → Q-3-2
3-3 | 통과 | 07bb4f5 | card 7/7 + test:ui + typecheck 2종 | 카드·찜·퀵담기·옵션시트·E2E B04b, 해석 → Q-3-3
3-4 | 통과 | f09f6d1 | detail 6/6 + plp 6/6 + test:ui + typecheck + 빌드 | 7:5·구매패널·단계옵션·쿠폰·하이라이트, 해석 → Q-3-4
3-5 | 통과 | 48781dc | cart 5/5 + plp 7/7 + test:ui + typecheck | 판매자박스·게이지·견적요약·가격표시, 해석 → Q-3-5
3-6 | 통과 | c86a7be | checkout 4/4 + checkout36 3/3 + test:ui + typecheck | 주문자·쿠폰모달·예약일·금칙어·동의2종, 해석 → Q-3-6
3-7 | 통과 | fa74513 | payment_result 4/4 + test:ui + typecheck | 영수증·카드마스킹·주소정리·공유없음, 해석 → Q-3-7
3-8 | 통과 | 95a8698 | order 8/8 + buyer 20/20 + partner 15/15 + admin 12/12 + e2e 26/26 + test:ui + typecheck | 탭3·20개씩·카드·재구매·옵션잠금·회수일·사진·철회, d1_64, 해석 → Q-3-8
3-9 | 통과 | abc67fb | my 12/12 + buyer 23/23 + openapi 3/3 + test:ui + typecheck + 빌드 | /my 7주소·리다이렉트·메뉴200·바로가기9·얇은읽기3·우편검색장착·주문탭연결, 해석 → Q-3-9
3-10 | 통과 | c5295b7 | store 9/9 + buyer 25/25 + openapi 3/3 + browser 13/13 + test:ui + typecheck | 헤더·탭4·채우기·PLP고정·리뷰공개·팔로우E2E·B04b/B06 단계수정, 해석 → Q-3-10
3-11 | 통과 | add8579 | misc 7/7 + flash 9/9 + products 5/5 + buyer 25/25 + openapi 3/3 + test:ui + typecheck + 빌드 | 특가·베스트기간·쿠폰3탭·고객센터·약관3·가입단계·스토어린트0(홀드1)·카카오예외, 해석 → Q-3-11
3-12 | 통과 | e6e8753 | analyze 0 + customer 76/76 + goldens 4동일 + p1phase4 10/10 + npm 전체 | 테마토큰·옵션시트·쿠폰2단·장바구니판매자, 해석 → Q-3-12
G3 | 통과 | 04af54a | browser 16/16 + LCP 최대820 + smoke 68+의도2 + lint 0 | 홀드전환·전여정확장·인벤토리재생성, 해석 → Q-G3a·Q-G3b
4-1 | 통과 | 04af54a | p4a 8/8 + metrics + test:ui + typecheck | KPI8·추이7/30·임박10·장기미답변, 해석 → Q-4-1
4-2 | 통과 | 04af54a | P16·P17 + p4a 8/8 + 핀8이관 | 탭6·서버페이징·일괄·복제·CSV, 해석 → Q-4-2
4-3 | 통과 | 04af54a | P18 + openapi 3/3 + p4a 8/8 | 등록수정·옵션행렬·SKU표·품질점수, 해석 → Q-4-3
4-4 | 통과 | 1258e24 | P19·P20 + p4b 5/5 + test:ui + typecheck | 탭6·검색·일괄확인·발송·지연·연락처열람, 해석 → Q-4-4
4-5 | 통과 | 1258e24 | p4b 5/5 + 핀5이관 | 취소내역·반품·교환재발송, 해석 → Q-4-5
4-6 | 통과 | 1258e24 | S04이관 + p4b 5/5 | 개요·예치금·출금모달·세금계산서, 해석 → Q-4-6
4-7 | 통과 | 79ec6bc | P23 + partner 23/23 + p4c 9/9 | 쿠폰부담·할인합계·특가신청·기획전현황, E2E 정산차감, 해석 → Q-4-7
4-8 | 통과 | 79ec6bc | P22 + p4c 9/9 | 비밀글·24시간강조·템플릿·포토필터·답글·신고, 해석 → Q-4-8
4-9 | 통과 | 79ec6bc | P5 + p4c 9/9 + typecheck + 빌드 | 배송템플릿단일화·꾸미기·설정, 해석 → Q-4-9
4-10 | 통과 | 79ec6bc | p4c 9/9 | 신청단계·진행단계·반려사유·재제출, 해석 → Q-4-10
4-11 | 통과 | 79ec6bc | design_lint 3/3 + p4c 9/9 | 확장5화면 토큰전환·셀러검사0·CAPS제거, 해석 → Q-4-11
\A13 + p4adm 5/5 + typecheck | 대비9카드·대기3종·30일선·카테고리막대·카드별오류, 해석 → Q-4-12
\A14·A15 + openapi 3/3 + p4adm 5/5 | 신청목록상세·셀러상세·수수료·E2E3종, 해석 → Q-4-13
\A16·A17 + openapi 3/3 + p4adm 5/5 | 검수자동5점검·전체필터·CSV, 해석 → Q-4-14
\A18 + p4adm 5/5 | 3단트리·탭4·금칙어·소급불가, d1_65, 해석 → Q-4-15
4-16 | 통과 | PENDING | A19·A20 + p4adm2 5/5 + typecheck | 주문목록상세·3원판정·1만페이징, 해석 → Q-4-16
4-17 | 통과 | PENDING | A21 + openapi 3/3 + p4adm2 5/5 | 배치확정·출금승인·정책이력, 해석 → Q-4-17
4-18 | 통과 | PENDING | A22·A23 + p4adm2 5/5 | 배너위치기간·기획전·타임딜E2E·알림, d1_66, 해석 → Q-4-18
4-19 | 통과 | PENDING | A24 + p4adm2 5/5 | 플랫폼발행·셀러감독·성과분담, 해석 → Q-4-19
