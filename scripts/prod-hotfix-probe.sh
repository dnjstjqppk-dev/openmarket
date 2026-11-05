#!/usr/bin/env bash
# Read-only production probes for the v3.2 integrity hotfix (7cad111).
# Every request here is a GET, or a POST that the API rejects before any database write
# (unauthenticated, validation failure, or a handler that never writes). No test accounts are used.
#   usage: scripts/prod-hotfix-probe.sh [base_url]   (prints "id expected_after_fix actual")
B="${1:-https://olmoa-api.dnjstjqppk.workers.dev}/api/v1"
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
body() { curl -s "$@"; }
J='Content-Type: application/json'
P() { printf '%-4s %-58s expect=%-6s got=%s\n' "$1" "$2" "$3" "$4"; }

P H01 "GET  /finance/tax-invoices (no auth)"                 401 "$(code "$B/finance/tax-invoices")"
P H02 "POST /finance/cash-receipts/request (no auth)"        401 "$(code -X POST -H "$J" -d '{}' "$B/finance/cash-receipts/request")"
P H03 "GET  /finance/cash-receipts/x (no auth)"              401 "$(code "$B/finance/cash-receipts/x")"
P H04 "GET  /supplier-orders (no auth)"                      401 "$(code "$B/supplier-orders")"
P H05 "GET  /integrations/health (no auth)"                  401 "$(code "$B/integrations/health")"
P H06 "GET  /deals/lightning (fabricated feed retired)"      410 "$(code "$B/deals/lightning")"
P H07 "POST /search/visual-similarity (no image model)"      501 "$(code -X POST -H "$J" -d '{}' "$B/search/visual-similarity")"
P H08 "POST /channels/pricing/calculate {} (cost required)"  400 "$(code -X POST -H "$J" -d '{}' "$B/channels/pricing/calculate")"
P H09 "GET  /channels/credentials (no auth)"                 401 "$(code "$B/channels/credentials")"
V=$(body -X POST -H "$J" -d '{"business_reg_number":"220-81-62517"}' "$B/onboarding/validate-business" | grep -o '"verification":"[A-Z_]*"')
P H10 "POST /onboarding/validate-business verification"      "CHECKSUM_ONLY|NTS" "$V"
P H11 "GET  /campaigns/lightning (real feed)"                200 "$(code "$B/campaigns/lightning")"
P H12 "GET  /products (catalog)"                             200 "$(code "$B/products")"
P H13 "GET  /admin/dashboard forged token"                   401 "$(code -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' "$B/admin/dashboard")"
P H14 "CORS from foreign origin (no ACAO echo)"              none "$(curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$B/products" | grep -i '^access-control-allow-origin' | tr -d '\r' || true)"
