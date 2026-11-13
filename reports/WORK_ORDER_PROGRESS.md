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
2-2 | 통과 | PENDING | shipping_policy 9/9 + migrations + p1 + openapi 3/3 + e2e 26/26 | 배송 템플릿·묶음 그룹·내역 저장, 경계값 해석 → Q-2-2
2-3 | 미실행 | - | - | 구 d41e7f5는 허구(쿠폰 엔진) → 되돌림. 실제 지시(결제·PG추가·위시리스트)로 재구현 예정
