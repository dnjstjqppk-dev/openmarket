# OpenMarket 기술 스택 감사 보고서 (TECH_STACK_AUDIT.md)

## 1. 감사 개요 및 목적
본 감사는 OpenMarket의 공식 기술 표준인 **Vue 3 + TypeScript (Frontend), Go (Backend), Flutter + Dart (Mobile)** 준수 여부를 전수 조사하고, 비표준 구현을 제거하여 정식 아키텍처로의 전환 계획을 수립하기 위해 수행되었습니다.

---

## 2. 현행 코드베이스 전수 감사 결과

| 디렉터리 / 파일 | 현재 사용 언어 및 기술 | 공식 표준 부합 여부 | 상세 분석 및 조치 계획 |
|---|---|---|---|
| `apps/storefront/` | HTML + CDN (Alpine.js) | **불일치 (전환 대상)** | Vue 3 SFC (`.vue`), TypeScript, Vite, Vue Router 구조로 전면 교체 |
| `apps/admin/` | HTML + CDN (Alpine.js) | **불일치 (전환 대상)** | Vue 3 SFC (`.vue`), TypeScript, Vite, MFA Auth Guard 구조로 전면 교체 |
| `apps/partner/` | HTML + CDN (Alpine.js) | **불일치 (전환 대상)** | Vue 3 SFC (`.vue`), TypeScript, Vite, Tenant Guard 구조로 전면 교체 |
| `apps/api/` | JavaScript (Cloudflare Worker) | **부분 불일치 (조정)** | 핵심 비즈니스 로직을 Go Backend로 이관하고 최소 Edge Gateway로 축소 |
| `backend/` | Go 1.23 (`net/http`, Redis Lua) | **부합 (보존 및 확장)** | Go 1.23 도메인 엔진을 `apps/api/` 코어로 표준화 및 REST API 서버 완성 |
| `mobile/` | 미구현 (빈 디렉터리) | **신규 구현 대상** | `customer_app` 및 `partner_app` Flutter + Dart 신규 구축 |
| `database/` | PostgreSQL 16 DDL 6종 | **부합 (보존)** | 46개 테이블 무결성 스키마 유지 및 Go ORM/드라이버 매핑 |

---

## 3. 비표준 기술 식별 및 제거/전환 내역

1. **Alpine.js / CDN 단일 HTML 파일**:
   - **문제점**: 번들러 빌드 없이 CDN에 의존하여 대규모 엔터프라이즈 컴포넌트 확장성 및 타입 안정성 부재.
   - **조치**: 모든 웹 프론트엔드를 `<script setup lang="ts">` 기반 Vue 3 SFC 및 Vite 빌드 시스템으로 전환.
2. **Node.js/JS 중심 엣지 워커 비즈니스 로직**:
   - **문제점**: 결제 분기 및 재고 연산 등 핵심 비즈니스 로직이 JS 워커에 임시 구현됨.
   - **조치**: 모든 핵심 비즈니스 로직을 Go 표준 라이브러리 및 검증된 Go 패키지로 구현된 Go Backend로 단일화.

---

## 4. 정식 기술 스택 전환 로드맵
- **Frontend**: Vue 3.4+ / TypeScript 5.4+ / Vite 5.2+ / Vue Router 4 / Pinia 2
- **Backend**: Go 1.23+ (`net/http`, `go-redis/v9`, `google/uuid`)
- **Mobile**: Flutter 3.x / Dart 3.x (Clean Architecture: View - ViewModel - Service)
- **Database**: PostgreSQL 16 Relational Engine (BigInt Currency, Double-entry Ledger)
