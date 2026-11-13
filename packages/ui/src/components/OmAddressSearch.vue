<script setup lang="ts">
// Postal-code search. When the external script is unavailable the form falls
// back to manual entry instead of blocking the checkout.
import { ref } from 'vue'

export interface PostalPick { zonecode: string; address: string }
const props = withDefaults(defineProps<{
  find?: (query: string) => Promise<PostalPick[]>
  disabled?: boolean
}>(), {})
const emit = defineEmits<{ pick: [PostalPick] }>()
const query = ref('')
const results = ref<PostalPick[]>([])
const manual = ref(false)
const busy = ref(false)
const error = ref('')
const manualZip = defineModel<string>('zip', { default: '' })
const manualAddr = defineModel<string>('address', { default: '' })

const search = async () => {
  error.value = ''
  if (!props.find) { manual.value = true; return }
  busy.value = true
  try {
    results.value = await props.find(query.value.trim())
  } catch {
    error.value = '우편번호 검색에 실패했습니다. 직접 입력해 주세요.'
    manual.value = true
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="!manual" class="flex gap-2">
      <input
        v-model="query"
        type="search"
        aria-label="우편번호 검색어"
        placeholder="도로명·건물명으로 우편번호 검색"
        :disabled="disabled || busy"
        class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus-visible:ring-focus disabled:opacity-50"
        @keydown.enter.prevent="search"
      />
      <button
        type="button"
        :disabled="disabled || busy || !query.trim()"
        class="h-9 shrink-0 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on transition-colors hover:bg-secondary-hover active:bg-secondary-active disabled:cursor-not-allowed disabled:opacity-40"
        @click="search"
      >
        {{ busy ? '검색 중' : '우편번호 검색' }}
      </button>
    </div>
    <p v-if="error" role="alert" class="text-xs font-semibold text-danger">{{ error }}</p>
    <ul v-if="!manual && results.length" class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
      <li v-for="r in results" :key="r.zonecode + r.address">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          @click="emit('pick', r)"
        >
          <span class="om-num font-bold text-ink">{{ r.zonecode }}</span>
          <span class="truncate text-ink-muted">{{ r.address }}</span>
        </button>
      </li>
    </ul>
    <div v-if="manual" class="space-y-2 rounded-lg border border-dashed border-line-strong p-3">
      <p class="text-xs font-bold text-ink">직접 입력</p>
      <div class="flex gap-2">
        <input v-model="manualZip" inputmode="numeric" aria-label="우편번호 직접 입력" placeholder="우편번호" class="om-num h-9 w-28 rounded-lg border border-line bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-focus" />
        <input v-model="manualAddr" aria-label="주소 직접 입력" placeholder="기본 주소" class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-focus" />
      </div>
    </div>
    <button v-if="!manual" type="button" class="text-xs font-semibold text-ink-muted underline hover:text-ink" @click="manual = true">
      검색 없이 직접 입력
    </button>
  </div>
</template>
