<script setup lang="ts">
// Admin FX Rate Management Console — wires GET/PUT/DELETE /api/v1/admin/fx-rates[/:currency]
// so operators can publish & maintain USD/JPY/TWD/CNY/EUR/SGD reference rates for storefront
// display & JSON-LD without raw SQL.
import { ref, onMounted } from 'vue'
import { Coins, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import { OmButton, OmCard, OmAlert, OmSkeleton, useToast, useConfirm, userErrorMessage, uiT, formatDateTime, formatNumber } from '@olmoa/ui'
import { API_BASE_URL, getAdminHeaders } from '../../config'

interface FxRow {
  currency_code: string
  krw_per_unit: number
  source_note: string | null
  updated_at: string | null
}

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar ($)', sample: 1380 },
  { code: 'JPY', name: 'Japanese Yen (¥)', sample: 9.2 },
  { code: 'TWD', name: 'New Taiwan Dollar (NT$)', sample: 43 },
  { code: 'CNY', name: 'Chinese Yuan (¥)', sample: 192 },
  { code: 'EUR', name: 'Euro (€)', sample: 1500 },
  { code: 'SGD', name: 'Singapore Dollar (S$)', sample: 1030 }
] as const

const toast = useToast()
const { confirm: askConfirm } = useConfirm()

const loading = ref(true)
const loadError = ref('')
const rates = ref<Record<string, FxRow>>({})
const draft = ref<Record<string, { krw: string; note: string }>>({})
const saving = ref<Record<string, boolean>>({})

function initDrafts() {
  const next: Record<string, { krw: string; note: string }> = {}
  for (const c of CURRENCIES) {
    const row = rates.value[c.code]
    next[c.code] = {
      krw: row ? String(row.krw_per_unit) : '',
      note: row?.source_note || ''
    }
  }
  draft.value = next
}

async function loadRates() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/fx-rates`, { headers: getAdminHeaders() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.success) throw new Error(json?.error || '환율 정보를 불러오지 못했습니다.')
    const map: Record<string, FxRow> = {}
    for (const row of Array.isArray(json.data) ? json.data : []) {
      if (row?.currency_code) map[String(row.currency_code).toUpperCase()] = row
    }
    rates.value = map
    initDrafts()
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '환율 정보를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

function previewConverted(code: string, krwAmount: number): string {
  const rate = Number(draft.value[code]?.krw)
  if (!Number.isFinite(rate) || rate <= 0) return '-'
  const val = krwAmount / rate
  const decimals = code === 'JPY' || code === 'TWD' ? 0 : 2
  return `${val.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${code}`
}

async function saveRate(code: string) {
  const krw = Number(draft.value[code]?.krw)
  if (!Number.isFinite(krw) || krw <= 0 || krw > 100000) {
    toast.error('0 초과 100,000 이하의 유효한 KRW 환율을 입력하세요.')
    return
  }
  saving.value[code] = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/fx-rates/${code}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAdminHeaders() },
      body: JSON.stringify({
        krw_per_unit: krw,
        source_note: (draft.value[code]?.note || '').trim() || undefined
      })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.success) throw new Error(json?.error || '환율 저장에 실패했습니다.')
    toast.success(`${code} 환율이 저장되었습니다.`)
    await loadRates()
  } catch (e: any) {
    toast.error(userErrorMessage(e, '환율 저장에 실패했습니다.'))
  } finally {
    saving.value[code] = false
  }
}

async function deleteRate(code: string) {
  const ok = await askConfirm({
    title: '환율 삭제',
    body: `${code} 기준 환율을 삭제합니다. 삭제 후 해당 통화 페이지는 원화(KRW)로 표시됩니다.`,
    danger: true
  })
  if (!ok) return
  saving.value[code] = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/fx-rates/${code}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.success) throw new Error(json?.error || '환율 삭제에 실패했습니다.')
    toast.success(`${code} 환율이 삭제되었습니다.`)
    await loadRates()
  } catch (e: any) {
    toast.error(userErrorMessage(e, '환율 삭제에 실패했습니다.'))
  } finally {
    saving.value[code] = false
  }
}

onMounted(loadRates)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink">
          <Coins class="h-6 w-6 text-primary" aria-hidden="true" />
          {{ uiT('통화별 환율 관리') }}
        </h1>
        <p class="mt-1 text-xs text-ink-muted">
          {{ uiT('스토어프론트 참고 환산가 및 JSON-LD에 적용되는 통화별 기준 환율(1 외화당 KRW)을 관리합니다.') }}
        </p>
      </div>
      <OmButton variant="outline" size="sm" :loading="loading" @click="loadRates">
        <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
        {{ uiT('다시 시도') }}
      </OmButton>
    </div>

    <OmAlert tone="info">
      결제(PG)는 외화 가맹 계약 완료 전까지 원화(KRW)로 유지됩니다. 여기에 등록한 환율은 스토어프론트 표시 통화(/en/usd, /ja/jpy, /zh-tw/twd)와 JSON-LD 가격 환산의 단일 기준(SSOT)으로 사용됩니다.
    </OmAlert>

    <OmAlert v-if="loadError" tone="danger">{{ loadError }}</OmAlert>

    <OmCard v-if="loading">
      <OmSkeleton variant="row" :count="6" />
    </OmCard>

    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <OmCard v-for="c in CURRENCIES" :key="c.code" interactive>
        <template #header>
          <div class="flex w-full items-center justify-between gap-2">
            <div>
              <h2 class="text-md font-extrabold text-ink">{{ c.code }}</h2>
              <p class="text-xs text-ink-muted">{{ c.name }}</p>
            </div>
            <span
              class="rounded-full px-2.5 py-0.5 text-2xs font-bold"
              :class="rates[c.code] ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'"
            >
              {{ rates[c.code] ? `1 ${c.code} = ${formatNumber(rates[c.code].krw_per_unit)}원` : uiT('미등록') }}
            </span>
          </div>
        </template>

        <div class="space-y-3 text-xs">
          <div>
            <label :for="`fx-krw-${c.code}`" class="mb-1 block font-semibold text-ink">{{ uiT('1단위당 원화 (KRW)') }}</label>
            <input
              :id="`fx-krw-${c.code}`"
              v-model="draft[c.code].krw"
              type="number"
              step="0.01"
              min="0.01"
              :placeholder="String(c.sample)"
              class="om-num h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label :for="`fx-note-${c.code}`" class="mb-1 block font-semibold text-ink">{{ uiT('출처 메모') }}</label>
            <input
              :id="`fx-note-${c.code}`"
              v-model="draft[c.code].note"
              type="text"
              maxlength="200"
              placeholder="예: 한국은행 기준환율"
              class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div class="rounded-xl bg-surface-2 px-3 py-2.5 text-2xs text-ink-muted">
            <div class="flex items-center justify-between">
              <span>₩50,000 →</span>
              <span class="om-num font-bold text-ink">{{ previewConverted(c.code, 50000) }}</span>
            </div>
            <div class="mt-1 flex items-center justify-between">
              <span>{{ uiT('최종 수정') }}</span>
              <span class="om-num">{{ rates[c.code]?.updated_at ? formatDateTime(rates[c.code].updated_at!) : '-' }}</span>
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <OmButton variant="primary" size="sm" block :loading="!!saving[c.code]" @click="saveRate(c.code)">
              <Save class="h-3.5 w-3.5" aria-hidden="true" />
              {{ uiT('환율 저장') }}
            </OmButton>
            <OmButton v-if="rates[c.code]" variant="outline" size="sm" :disabled="!!saving[c.code]" :aria-label="`${c.code} ${uiT('환율 삭제')}`" @click="deleteRate(c.code)">
              <Trash2 class="h-3.5 w-3.5 text-danger" aria-hidden="true" />
            </OmButton>
          </div>
        </div>
      </OmCard>
    </div>
  </div>
</template>
