# 6-0. 48360ae 감사 보고서 (API 배포 전 필수)

- 감사일: 2026-11-25 / 감사자: Muse Spark / 브랜치: `work-order/phase6` (미커밋, 운영자 병합 대기)
- 대상: `git diff fe4e11f 48360ae -- apps/cloudflare-gateway` 5파일(+434/-92) + 프런트·모바일 62파일
- 결론: **운영 배포 가능** — 아래 결함 D1·D2는 본 브랜치에서 수정 + 회귀 테스트 포함. `deploy.yml` API `if:` 제거는 §8안대로 운영자 승인 후 적용
- 규칙 13: 커밋 없이 진행하므로 수정 전 실패 로그를 §5에 원문 보관

## 1. 새 외부 호출 표 (파트너 플로우에서 새로 도달 가능해진 호출)

48360ae는 `fetch()` 호출문을 새로 추가하지 않고, 파트너 4경로(검증·발행·수집·송장)를
기존 실HTTP 어댑터로 연결했다. 아래 7호출이 판매자 키로 새로 도달 가능해졌다.

| # | 호출 (메서드·URL) | 인증 정보 출처 | 실패 시 동작 | 응답 위조 시 동작 |
|---|---|---|---|---|
| N1 | POST `https://api.commerce.naver.com/external/v1/oauth2/token` | 판매자 복호화 키 오버레이(`SMARTSTORE_CLIENT_ID/SECRET`), 운영자 env 아님. 빈 값은 `''`로 덮어써 운영 키 폴백 불가 | 키 공백→409 CREDENTIAL_INCOMPLETE(빈 항목명 표시, D2 수정 후). 401/403→검증은 `verified:false`+BLOCKED_INVALID, 나머지 409 CREDENTIAL_INVALID. 429→503, 그 외→502. 검증프로브이 inconclusive면 throw(키 상태 미변경) | 토큰 없음→CHANNEL_AUTH 취급. 위조 토큰으로 바로 N2~N4 호출이 뒤따르므로 단독 악용 불가 |
| N2 | POST `/external/v1/products` (네이버 발행) | N1 토큰(Bearer) | 호출 전 NEW-04 필수값 검사 선행 → 400 VALIDATION_ERROR(누락명 명시, fetch 0건). 전송 실패는 위 매핑. **모든 실패에서 persist 없음** (검증→호출→저장 순서) | `id`/`productId` 빈 값→502 UPSTREAM_BAD_SHAPE, 저장 없음. 성공 시 `PENDING_REVIEW`로만 저장(플랫폼 노출을 단정하지 않음) |
| N3 | GET `/external/v1/orders/paid` (네이버 수집) | N1 토큰 | 위 매핑(409/502/503). 실패 시 import 0건 | id·total·구매자·수신자·주소 중 하나라도 없으면 해당 행 skip + 응답 메시지에 `불완전 행 N건 제외`(D1 수정 후 total 포함). 상품명 없는 품목은 제거. 전화번호는 마스킹 저장. 수수료는 서버 재계산(채널 bps, half-up) |
| N4 | POST `/external/v1/orders/{id}/tracking` (네이버 송장) | N1 토큰 | 운송장 형식은 라우트에서 선검사(400). 전송 실패는 위 매핑, 상태 미변경 | 플랫폼이 받아도 DB 상태 전이는 `WHERE status IN (...)` 1건 조건이라 중복 전이 불가 |
| C1 | POST `.../marketplace/seller-products` (쿠팡 발행, CEA 서명) | 판매자 키+`seller_account_id`→`COUPANG_VENDOR_ID`. 서명 시각·경로 포함이라 재사용 불가 | vendorId 공백→400 VALIDATION_ERROR(vendor_id 명시). 나머지는 N2와 동일 | N2와 동일. `saleEndedAt 2099`·`AGENT_BUY`·단일 품목 매핑은 코드에 근거 주석 + 판매자에게 고지되는 설계 결정 |
| C2 | GET `.../marketplace/orders?vendorId=&status=PAID` (쿠팡 수집) | C1과 동일. 쿼리의 vendorId는 판매자 본인 계정(비밀 아님) | N3과 동일 | N3과 동일 |
| C3 | POST `.../orders/{id}/tracking` (쿠팡 송장) | C1과 동일 | N4와 동일 | N4와 동일 |

공통: `channelFetch` 8초 타임아웃(지연 플랫폼은 502, 행 아님). 에러 문구에 키 값 없음(빈 항목명만).
URL이 에러에 포함되는 경우는 쿠팡 쿼리(vendorId, 비밀 아님)뿐이며 네이버 토큰 바디는 기록되지 않음.
호스트·경로는 전부 상수 + `encodeURIComponent` 인코딩이라 SSRF 불가.

## 2. 공격 테스트 (파트너 A → 파트너 B, `tests/channels_live_audit_6_0_test.mjs`)

| 테스트 | 결과 | 증명 내용 |
|---|---|---|
| 6-0.1 크로스 파트너 격리 | PASS | B 자격증명 verify→404·목록 미노출. B 상품 발행→404·저장 0. 수집분은 호출자 partner_id로만 적재, 양쪽 목록 무교집합. B 주문 dispatch-po·fulfill→404·상태 불변 |
| 6-0.2 실경로 키 스코프 | PASS | 운영 env에서 키 없는 A는 B가 실키 보유 중에도 sync·발행 501 + 저장 0 + fetch 0건. B는 정상 실경로(`vendorId=VB` 스코프) |
| 6-0.3 키 없이 501 | PASS | 운영 env 무키: sync·발행·fulfill 전부 501 CONNECTOR_NOT_INTEGRATED, 저장 0, `simulated:true` 없음, fetch 0건. 비위임 플랫폼(eleven_street)은 실키가 있어도 501 |
| 6-0.4 불완전 키 | PASS(수정 후) | vendorId 공백→400 vendor_id 명시·fetch 0·저장 0. secret 공백→409 CREDENTIAL_INCOMPLETE + `Client Secret` 명시(§5 D2) |
| 6-0.5 위조 행 수집 | PASS(수정 후) | 정상 1건만 import, total 누락 행·id 누락 행 skip + `불완전 행 2건 제외`(§5 D1) |

## 3. 501 폴백 확인 (이전 감사 `audit-other-tool-commits` 사례)

- 키 없음 + 운영: 6-0.3이 3개 액션 전부 501 + 저장 0 + fetch 0으로 증명. 기존 테스트 6(coupang 무키 501)도 유지.
- 비위임 16개 플랫폼: 실키 저장 후에도 운영 501(6-0.3 후반). `api_integrated`는 naver/coupang 2곳만 true(기존 테스트 8).
- verify는 읽기 전용프로브이라 501 대신 `verified:false`를 반환하며, 실호출 없이 VERIFIED가 되지 않음(6-0.1A, 기존 테스트 9C).
- 개발 env + 실키 조합은 실호출한다(의도된 Wave I 필드 검증 경로). 시뮬레이션이 필요하면 샌드박스 키를 저장.

## 4. 프런트·모바일 스팟체크 (62파일 중 소스)

- GAP-03 `PolicyView.vue`: 기존 admin PUT 재사용(서버 변경 없음), 확인 대화 + 적용일 클라이언트 가드 + 서버 소급 거부. 통과.
- GAP-02 푸시 라우트: kind 고정 집합(`order`/`product`/`inbox`, `shipment`/`dispatch`), 미지정 페이로드 폴백. 주문번호→ID 서버 해결 후 내비게이션. 임의 라우트 주입 불가. 통과.
- GAP-04: 파트너 샘플 6곳 `example.com` 교체 + I04 회귀핀. 디자인 토큰 17건 전환, 잔여 4건은 테마 고정 크롬으로 상한 문서화(캡 21→4). 통과.
- GAP-05 `RELEASE.md`: 파트너 FCM 배선 완료로 정정. 통과.
- `channels.yaml`: 신규 오류 코드(400/409/502/503) 문서화. `openapi_reconciliation` 3/3 유지.

## 5. 결함 목록 + 수정 (fail-first 로그 포함)

### D1 (중간→수정됨) total 없는 플랫폼 행이 0원 주문으로 저장됨
- 위치: `services/channels/partner-live.js` `mapLiveOrder` (라우트의 `Math.round(NaN || 0)` 강제 변환과 결합)
- 수정 전 실패 로그:
  ```
  [FAIL] 6-0.5 sync skips rows with missing ids and invalid totals
         -> Expected values to be strictly equal: 2 !== 1
  ```
- 수정: total이 안전 정수가 아니면 해당 행 skip(`invalid total amount`), 응답 메시지의 제외 건수에 포함. 검증된 total을 그대로 저장.
- 수정 후: 6-0.5 PASS. 기존 테스트 11(정상·불완전 각 1행)도 PASS 유지.

### D2 (낮음→수정됨) CREDENTIAL_INCOMPLETE이 빈 항목명을 표시하지 못함
- 위치: `services/channels/channel.js` `ChannelConfigError`가 `missing` 배열을 보관하지 않아 `toChannelHttpError`의 라벨이 항상 빈 문자열
- 수정 전 실패 로그:
  ```
  [FAIL] 6-0.4 incomplete credentials fail closed with named fields, never success
         -> blank field is named: [네이버 스마트스토어] 인증정보 항목이 비어 있습니다. 채널 인증정보를 보완해 주세요.
  ```
- 수정: 생성자에 `this.missing = missing` 추가. 기존 사용처는 전부 `instanceof` 판정이라 영향 없음.
- 수정 후: 6-0.4 PASS (`Client Secret` 명시).

## 6. 관찰 사항 (결함 아님, 수정하지 않음)

1. 품목 `unit_price` NaN→0 강제 변환이 남음. 헤더 total이 D1으로 검증되므로 정산 영향은 없으나, Wave I 실키 검증 때 품목 스키마와 함께 확정 권장.
2. 통화 누락 시 `KRW` 기본값. 네이버·쿠팡 주문이 원화라는 전제이며 라우트 공통 동작. 해외 플랫폼 위임 시 재검토.
3. `channel_orders` 중복 키가 `(sales_channel_id, external_order_id)`로 partner_id를 포함하지 않음. 플랫폼 주문번호가 판매자별 고유라는 전제 하에 안전하나, 동일 채널 공유 판매자가 늘면 키 확장 검토.
4. fulfill은 플랫폼 push 후 DB 전이. DB 경합 시 플랫폼에만 송장이 남을 수 있으나 동일 송장 재전송은 benign.
5. 쿠팡 `saleEndedAt 2099`·`AGENT_BUY`·단일 품목 매핑은 코드 주석 + 판매자 고지된 설계 결정. Wave I에서 옵션별 등록 확정.

## 7. 검증

- 신규: `node tests/channels_live_audit_6_0_test.mjs` 5/5 PASS
- 회귀: multichannel 12/12, rotation 8/8, fulfillment 9/9, p1_honesty 16/16 PASS
- 전체: `npm test` 0 FAIL + `npm run typecheck` 0 + `npm run lint` 0 + cspell 0 (아래 §9 실행 기록)

## 8. 배포 가능 판정 + 운영자 승인 요청안 (미적용)

판정: **운영 배포 가능**. 단, 운영 반영은 규칙 14에 따라 운영자가 수행.

1. 본 브랜치(`work-order/phase6`)를 `main`에 병합.
2. 아래 `deploy.yml` 변경으로 API 자동 배포 복원 (현재는 수동 `deploy_api` 체크 시에만 API 배포):
   ```diff
   -      - name: Deploy Edge API Gateway (olmoa-api)
   -        if: github.event_name == 'workflow_dispatch' && inputs.deploy_api
   +      - name: Deploy Edge API Gateway (olmoa-api)
            run: cd apps/cloudflare-gateway && npx wrangler deploy
   ```
   (`workflow_dispatch` 입력 블록은 수동 재배포용으로 유지 가능. 주석 44~46행도 함께 정리.)
3. `tests/domain_proxy_test.mjs` D05의 게이트 고정문을 아래로 교체:
   ```diff
   -  // Until work-order 6-0 clears 48360ae, a push must never deploy the API gateway.
   -  assert.match(deploy, /- name: Deploy Edge API Gateway \(olmoa-api\)\r?\n\s+if: github\.event_name == 'workflow_dispatch' && inputs\.deploy_api\r?\n/);
   +  // 6-0 cleared 48360ae: the API gateway deploys on push like the consoles.
   +  assert.doesNotMatch(deploy, /Deploy Edge API Gateway \(olmoa-api\)\r?\n\s+if:/);
   ```
4. 병합 push 후 CI가 API를 배포하면 `/health` schemaVersion·`platforms` 2곳 `api_integrated` 확인.

## 9. 실행 기록

- `node tests/channels_live_audit_6_0_test.mjs`: 수정 전 3/5(§5 로그) → 수정 후 5/5 PASS
- `npm test` 전체 체인 exit 0 (신규 `test:channels60` 포함, e2e 26/26까지 완주)
- `npm run lint` exit 0, `npm run typecheck` 4워크스페이스 exit 0
- `npx cspell` 변경 4파일 0건 (package.json의 `singlesource` 1건은 기존 행, 본 작업과 무관)
- 변경분: `channel.js` +2, `partner-live.js` +8/-1, `package.json` +2/-1, 신규 테스트 1파일, 본 보고서
- 운영 반영 0건(규칙 14). 커밋·푸시·배포 미실행 — 운영자 병합 대기
