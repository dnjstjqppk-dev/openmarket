# Mobile Release Package (Wave G)

두 Flutter 앱(고객 `olmoa_customer`, 파트너 `olmoa_partner`)의 스토어 제출 패키지.
빌드 3종 실측 통과 (2026-11-11, Flutter 3.47.8, Windows).

## 실측 결과
- 고객 APK release 53.1MB / AAB 52.2MB / 파트너 APK 50.0MB — 전부 exit 0
- iOS 빌드는 macOS 전용이라 미실시 (CI Mac 러너 또는 Mac에서 `flutter build ipa`)

## Wave G에서 고친 출시 블로커
- 앱 이름: `customer_app` → 올모아, `partner_app` → 올모아 파트너
  (Android label + iOS CFBundleDisplayName/BundleName)
- Android INTERNET 권한 추가 (없으면 릴리스에서 API 호출 불가)
- 릴리스 서명 배선: `android/key.properties`(gitignore) + `key.properties.example`
  템플릿. 키 없이 빌드하면 debug 서명으로 폴백 (스토어 업로드 금지)
- 런처 아이콘 교체 (기본 Flutter → 라군 링 + 앰버 도트, 양 앱·전 밀도)
- API 호스트 빌드 주입: `--dart-define API_BASE_URL=...` (미지정 시 운영 기본값)
- Toss 위젯 SDK의 구 AGP/compileSdk 비호환 우회 (아래 참조)

## 알려진 업스트림 문제 (임시 우회 — Toss 수정 시 제거)
1. `tosspayments_widget_sdk_flutter 2.3.0` → `flutter_inappwebview_android 1.1.3`
   이 AGP 9에서 제거된 `getDefaultProguardFile('proguard-android.txt')` 호출.
   → 고객앱만 AGP 8.13.0 고정 (`settings.gradle.kts` 주석 참조).
   파트너앱(위젯 미사용)은 9.1 유지.
2. `tosspayments_webview_flutter 1.0.6`이 compileSdk 31 고정 +
   androidx.window 1.2.0 의존 (34+ 요구) → AAR 메타데이터 실패.
   → 루트 `build.gradle.kts`에서 34 미만 모듈만 34로 상향 (내림 없음).

## 빌드 명령
```bash
# 고객 (Play 업로드용)
cd mobile/customer_app
flutter build appbundle --release --dart-define API_BASE_URL=https://olmoa-api.dnjstjqppk.workers.dev
# 파트너
cd mobile/partner_app
flutter build appbundle --release --dart-define API_BASE_URL=https://olmoa-api.dnjstjqppk.workers.dev
# iOS (Mac)
flutter build ipa --release --dart-define API_BASE_URL=https://olmoa-api.dnjstjqppk.workers.dev
```
버전은 각 `pubspec.yaml`의 `version: 1.0.0+1` (이름+코드) — 스토어 업로드마다
+code 증가. 첫 제출 전 실버전 번호 확정 필요 (PO).

## 서명 키 생성 (최초 1회, 인간 작업)
```bash
keytool -genkeypair -v -storetype JKS -keystore olmoa-upload.keystore \
  -alias olmoa-upload -keyalg RSA -keysize 2048 -validity 10000
# → mobile/customer_app/android/key.properties 작성 (example 참조)
# 파트너도 동일 (별도 alias 권장)
```
키스토어는 분실 시 앱 업데이트 불가 — 오프라인 백업 필수.

## 스토어 제출 체크리스트 (인간 작업)
- [ ] Play Console + App Store Connect 개발자 계정 (§5 인간 항목 10)
- [ ] 앱 ID 확정: Android `com.olmoa.customer_app` / `com.olmoa.partner_app`,
      iOS `com.olmoa.customerApp` / `com.olmoa.partnerApp` — 제출 후 변경 불가
- [ ] 스토어 리스팅 문구·스크린샷·피처 그래픽 (실기기 캡처 §5 항목 12)
- [ ] 개인정보처리방침 URL (도메인 확정 후) + 앱 내 링크 연결
- [ ] 데이터 세이프티 (Play) / Privacy Nutrition (Apple) 답변:
      수집: 이메일·이름·전화·주소·주문·결제·기기 토큰 / 목적: 주문·배송·CS /
      제3자: Cloudflare(API)·Toss(결제)·택배사(배송) / 암호화: 전송 중 TLS,
      저장 시 토큰은 Keychain/Keystore(secure storage), 그 외 평문 캐시 없음
- [ ] 결제 심사: Toss 실가맹 + 스토어 인앱결제 정책 확인 (실물 상품은 외부 PG 허용)
- [ ] `flutter run --release` 실기기 스모크 (로그인→주문→결제위젯→알림)
- [ ] 크래시 리포팅 연동 여부 결정 (현재 없음 — Sentry 모바일은 Wave H 후보)

## 남은 모바일 기능 (Wave G2 — 스토어 심사 전이어도 되는 것부터)
- 파트너: 상품·반품·Q&A·입찰·멀티채널·프로필 화면 (P2-MOB-P5)
- 고객: 소셜 로그인 앱 연동 (서버 Kakao 준비됨, 앱 리다이렉트 미구현)
- 푸시 FCM/APNs (NEW-21, Wave H)
