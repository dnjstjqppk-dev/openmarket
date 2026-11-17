<script setup lang="ts">
// Legal documents console (5-6): versioned TERMS/PRIVACY/REFUND bodies with
// effective dates, an upcoming list and registration. SUPER_ADMIN only; the
// server refuses backdated effective dates and duplicate versions.
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const KINDS = [
  { value: 'TERMS', label: '이용약관' },
  { value: 'PRIVACY', label: '개인정보처리방침' },
  { value: 'REFUND', label: '취소·반품·환불 안내' }
] as const

// Placeholder shown literally in the help text. Kept in script because a
// nested {{ }} inside the template breaks the Vue compiler.
const OPERATOR_TOKEN = '{{OPERATOR}}'

interface LegalDoc {
  id: string
  kind: string
  version: string
  effective_date: string
  body: string
  author_user_id: string | null
  created_at: string
  status: 'CURRENT' | 'UPCOMING' | 'SUPERSEDED'
  days_until_effective: number | null
}

interface PreviewBlock { type: 'p' | 'ul'; lines: string[] }
interface PreviewSection { id: string; title: string; blocks: PreviewBlock[] }

function parsePreview(body: string): PreviewSection[] {
  const sections: PreviewSection[] = []
  let cur: PreviewSection | null = null
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# ')) {
      if (cur) sections.push(cur)
      cur = { id: `a${sections.length + 1}`, title: line.slice(2).trim(), blocks: [] }
      continue
    }
    if (!cur) cur = { id: `a${sections.length + 1}`, title: '', blocks: [] }
    if (line.startsWith('- ')) {
      const last = cur.blocks[cur.blocks.length - 1]
      if (last && last.type === 'ul') last.lines.push(line.slice(2).trim())
      else cur.blocks.push({ type: 'ul', lines: [line.slice(2).trim()] })
    } else {
      cur.blocks.push({ type: 'p', lines: [line] })
    }
  }
  if (cur) sections.push(cur)
  return sections
}

function renderInline(s: string): Array<{ text: string; bold: boolean }> {
  const parts: Array<{ text: string; bold: boolean }> = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index), bold: false })
    parts.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ text: s.slice(last), bold: false })
  return parts.length ? parts : [{ text: s, bold: false }]
}

const kind = ref<string>('TERMS')
const docs = ref<LegalDoc[]>([])
const loading = ref(true)
const loadError = ref('')

const regKind = ref<string>('TERMS')
const regVersion = ref('')
const regFrom = ref('')
const regBody = ref('')
const saving = ref(false)

const previewOpen = ref(false)
const previewDoc = ref<LegalDoc | null>(null)
const previewDraft = ref(false)

const today = () => new Date().toISOString().slice(0, 10)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/legal-documents')
    if (!r.ok) throw new Error(r.data.error || '약관 문서를 불러오지 못했습니다.')
    docs.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: unknown) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label || k
const ofKind = computed(() => docs.value.filter((d) => d.kind === kind.value))
const upcoming = computed(() =>
  docs.value.filter((d) => d.status === 'UPCOMING').sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1))
)
const draftSections = computed(() => parsePreview(regBody.value))
const previewSections = computed(() => (previewDoc.value ? parsePreview(previewDoc.value.body) : []))

const statusLabel = (d: LegalDoc) =>
  d.status === 'CURRENT' ? '시행중' : d.status === 'UPCOMING' ? `시행예정 (D-${d.days_until_effective})` : '구버전'

function openPreview(d: LegalDoc) {
  previewDoc.value = d
  previewDraft.value = false
  previewOpen.value = true
}

function openDraftPreview() {
  if (!regBody.value.trim()) {
    toastApi.error('미리볼 본문을 입력해 주세요.')
    return
  }
  previewDoc.value = {
    id: '', kind: regKind.value, version: regVersion.value.trim() || '(버전 미입력)',
    effective_date: regFrom.value || '(시행일 미입력)', body: regBody.value,
    author_user_id: null, created_at: '', status: 'UPCOMING', days_until_effective: null
  }
  previewDraft.value = true
  previewOpen.value = true
}

async function submit() {
  if (!regVersion.value.trim() || !regFrom.value || !regBody.value.trim()) {
    toastApi.error('종류·버전·시행일·본문을 모두 입력해 주세요.')
    return
  }
  if (regFrom.value < today()) {
    toastApi.error('시행일은 오늘 이후여야 합니다.')
    return
  }
  const ok = await askConfirm({
    title: '약관 등록',
    body: `[${kindLabel(regKind.value)} ${regVersion.value.trim()}] ${regFrom.value}부터 시행됩니다. 등록 후에는 수정할 수 없고 새 버전으로만 개정됩니다.`
  })
  if (!ok) return
  saving.value = true
  try {
    const r = await adminApi('/api/v1/admin/legal-documents', {
      method: 'POST',
      json: { kind: regKind.value, version: regVersion.value.trim(), effective_date: regFrom.value, body: regBody.value }
    })
    if (!r.ok) throw new Error(r.data.error || '등록에 실패했습니다.')
    toastApi.success('약관이 등록되었습니다.')
    regVersion.value = ''
    regFrom.value = ''
    regBody.value = ''
  } catch (e: unknown) {
    toastApi.error(userErrorMessage(e, '등록에 실패했습니다.'))
  } finally {
    saving.value = false
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">약관 문서</h1>
      <p class="mt-1 text-xs text-ink-muted">이용약관·개인정보처리방침·환불 안내의 버전을 등록하고 시행 예정 목록과 본문을 확인합니다. 등록은 최고관리자만 가능하며 시행일 소급은 거부됩니다.</p>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-else class="space-y-4">
      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">시행 예정 목록</h2>
        <p v-if="!upcoming.length" class="text-xs text-ink-muted">시행 예정인 개정 본문이 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">종류</th><th class="p-1 text-left">버전</th><th class="p-1 text-left">시행일</th><th class="p-1 text-left">남은 기간</th><th></th></tr></thead>
            <tbody>
              <tr v-for="d in upcoming" :key="d.id" class="border-t border-line-divider">
                <td class="p-1 font-bold text-ink">{{ kindLabel(d.kind) }}</td>
                <td class="p-1 text-ink">{{ d.version }}</td>
                <td class="om-num p-1 text-ink-muted">{{ d.effective_date }}</td>
                <td class="om-num p-1 font-bold text-warning">D-{{ d.days_until_effective }}</td>
                <td class="p-1 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openPreview(d)">미리보기</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-bold text-ink">버전 목록</h2>
          <div class="ml-auto flex gap-1" role="tablist" aria-label="약관 종류">
            <button
              v-for="k in KINDS" :key="k.value" type="button" role="tab" :aria-selected="kind === k.value"
              class="rounded-full px-3 py-1.5 text-xs font-bold"
              :class="kind === k.value ? 'bg-primary text-primary-on' : 'bg-surface-2 text-ink-muted hover:text-ink'"
              @click="kind = k.value"
            >{{ k.label }}</button>
          </div>
        </div>
        <p v-if="!ofKind.length" class="text-xs text-ink-muted">등록된 문서가 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">버전</th><th class="p-1 text-left">시행일</th><th class="p-1 text-left">상태</th><th class="p-1 text-left">작성자</th><th class="p-1 text-left">등록 시각</th><th></th></tr></thead>
            <tbody>
              <tr v-for="d in ofKind" :key="d.id" class="border-t border-line-divider">
                <td class="p-1 font-bold text-ink">{{ d.version }}</td>
                <td class="om-num p-1 text-ink-muted">{{ d.effective_date }}</td>
                <td class="p-1 font-bold" :class="d.status === 'CURRENT' ? 'text-primary' : d.status === 'UPCOMING' ? 'text-warning' : 'text-ink-subtle'">{{ statusLabel(d) }}</td>
                <td class="p-1 text-ink-muted">{{ d.author_user_id || '이관' }}</td>
                <td class="om-num p-1 text-ink-subtle">{{ String(d.created_at || '').slice(0, 16).replace('T', ' ') }}</td>
                <td class="p-1 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openPreview(d)">미리보기</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">새 버전 등록</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="block space-y-1 text-xs font-bold text-ink-muted">종류
            <select v-model="regKind" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink">
              <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
            </select>
          </label>
          <label class="block space-y-1 text-xs font-bold text-ink-muted">버전
            <input v-model="regVersion" maxlength="20" placeholder="v1.2" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" />
          </label>
          <label class="block space-y-1 text-xs font-bold text-ink-muted">시행일 (오늘 이후)
            <input v-model="regFrom" type="date" :min="today()" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink" />
          </label>
        </div>
        <label class="block space-y-1 text-xs font-bold text-ink-muted">본문
          <textarea v-model="regBody" rows="10" maxlength="100000" placeholder="# 으로 시작하는 줄은 조항 제목, - 로 시작하는 줄은 목록이 됩니다" class="w-full rounded-lg border border-line bg-surface p-3 font-normal leading-relaxed text-ink" />
        </label>
        <p class="text-2xs text-ink-subtle">작성법: '# 제목'은 조항 제목, '- 항목'은 글머리 목록, 그 외 줄은 문단입니다. **강조**는 굵게 표시됩니다. 이용약관 본문의 {{ OPERATOR_TOKEN }} 자리는 운영 사업자명으로 바뀝니다.</p>
        <div class="flex gap-2">
          <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="openDraftPreview">미리보기</button>
          <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">{{ saving ? '등록 중…' : '등록' }}</button>
        </div>
      </section>
    </div>

    <OmModal v-model:open="previewOpen" :title="`미리보기 · ${previewDoc ? kindLabel(previewDoc.kind) : ''} ${previewDoc?.version || ''}`">
      <div v-if="previewDoc" class="space-y-3 text-xs leading-relaxed text-ink-muted">
        <p class="text-ink-subtle">시행일 {{ previewDoc.effective_date }}{{ previewDraft ? ' · 등록 전 초안' : '' }}</p>
        <section v-for="s in previewSections" :key="s.id" class="space-y-1.5">
          <h3 v-if="s.title" class="text-sm font-bold text-ink">{{ s.title }}</h3>
          <template v-for="(b, i) in s.blocks" :key="i">
            <p v-if="b.type === 'p'"><template v-for="(part, j) in renderInline(b.lines[0])" :key="j"><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></p>
            <ul v-else class="list-inside list-disc space-y-1">
              <li v-for="(line, k) in b.lines" :key="k"><template v-for="(part, j) in renderInline(line)" :key="j"><strong v-if="part.bold">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></li>
            </ul>
          </template>
        </section>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="previewOpen = false">닫기</button>
      </template>
    </OmModal>
  </div>
</template>
