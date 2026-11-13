# WORK_ORDER 진행 기록

작업 번호 | 판정 | 커밋 해시 | 테스트 이름 | 메모
---|---|---|---|---
1-1 | 통과 | 81d56cc | tests/ui/docs_notice.test.mjs (2/2) | 3문서 안내문 + 상태 정정, test:ui 연결
1-2 | 실패 | ab9e468 | tests/ui/theme.test.mjs (5/5) | 토큰·프리셋은 명시값대로 구현, 4쌍이 4.5 미달이라 완료 기준 미충족 → Q-1-2
1-3 | 통과 | f514645 | tests/ui/type_scale.test.mjs (5/5) | 활자·그리드·행높이 CSS + 직접호출 동결(83), 전환은 3~4단계 → Q-1-3
1-4 | 통과 | PENDING | tests/ui/components_commerce.test.mjs (9/9) | 25종 신규+표 확장+카드 이동, vue-tsc(ui·스토어) 무결함
