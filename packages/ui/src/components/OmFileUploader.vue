<script setup lang="ts">
// Drag & drop / click upload with type + size validation, per-file progress state, previews and reordering.
// The caller's `upload(file)` does the real request and resolves to the stored URL; nothing is marked done
// until it resolves. v-model is the ordered list of uploaded URLs (first = main image).
import { ref } from 'vue'

interface Pending { key: number; name: string; status: 'uploading' | 'error'; error?: string; preview?: string }
const model = defineModel<string[]>({ default: () => [] })
const props = withDefaults(defineProps<{
  upload: (file: File) => Promise<string>
  accept?: string
  maxSizeMb?: number
  maxFiles?: number
  label?: string
  help?: string
  images?: boolean
}>(), { accept: 'image/jpeg,image/png,image/webp', maxSizeMb: 10, maxFiles: 10, images: true })

const dragging = ref(false)
const pending = ref<Pending[]>([])
const input = ref<HTMLInputElement | null>(null)
let seq = 0

const accepts = (f: File) => props.accept.split(',').some((a) => (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a.trim()))
async function handle(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (model.value.length + pending.value.filter((p) => p.status === 'uploading').length >= props.maxFiles) {
      pending.value.push({ key: ++seq, name: f.name, status: 'error', error: `최대 ${props.maxFiles}개까지 올릴 수 있습니다.` }); continue
    }
    if (!accepts(f)) { pending.value.push({ key: ++seq, name: f.name, status: 'error', error: '지원하지 않는 파일 형식입니다.' }); continue }
    if (f.size > props.maxSizeMb * 1024 * 1024) { pending.value.push({ key: ++seq, name: f.name, status: 'error', error: `${props.maxSizeMb}MB 이하만 올릴 수 있습니다.` }); continue }
    const item: Pending = { key: ++seq, name: f.name, status: 'uploading', preview: props.images ? URL.createObjectURL(f) : undefined }
    pending.value.push(item)
    try {
      const url = await props.upload(f)
      model.value = [...model.value, url]
      pending.value = pending.value.filter((p) => p.key !== item.key)
    } catch (e: any) {
      const p = pending.value.find((x) => x.key === item.key)
      if (p) { p.status = 'error'; p.error = e?.message || '업로드에 실패했습니다.' }
    } finally {
      if (item.preview) URL.revokeObjectURL(item.preview)
    }
  }
}
const onDrop = (e: DragEvent) => { dragging.value = false; if (e.dataTransfer?.files) handle(e.dataTransfer.files) }
const move = (i: number, d: number) => { const a = [...model.value]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; model.value = a }
const remove = (i: number) => { model.value = model.value.filter((_, k) => k !== i) }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="label" class="text-sm font-semibold text-ink">{{ label }}</p>
    <div
      role="button"
      tabindex="0"
      :class="['flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors duration-fast', dragging ? 'border-primary bg-primary-soft' : 'border-line-strong hover:border-ink-subtle']"
      @click="input?.click()"
      @keydown.enter.prevent="input?.click()"
      @keydown.space.prevent="input?.click()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" class="text-ink-subtle" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
      <p class="text-sm font-semibold">파일을 끌어 놓거나 <span class="text-primary underline">선택</span>하세요</p>
      <p class="text-xs text-ink-muted">{{ help || `${accept.replace(/image\//g, '').toUpperCase()} · 최대 ${maxSizeMb}MB · ${maxFiles}개` }}</p>
      <input ref="input" type="file" class="sr-only" :accept="accept" multiple tabindex="-1" @change="handle(($event.target as HTMLInputElement).files || []); ($event.target as HTMLInputElement).value = ''" />
    </div>

    <ul v-if="model.length || pending.length" class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      <li v-for="(url, i) in model" :key="url" class="group relative aspect-square overflow-hidden rounded border border-line bg-surface-2">
        <img v-if="images" :src="url" alt="" class="h-full w-full object-cover" />
        <span v-else class="flex h-full items-center justify-center p-2 text-2xs break-all">{{ url.split('/').pop() }}</span>
        <span v-if="i === 0 && images" class="absolute left-1 top-1 rounded-xs bg-secondary px-1.5 text-2xs font-bold text-secondary-on">대표</span>
        <div class="absolute inset-x-0 bottom-0 flex justify-between bg-overlay/60 p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button type="button" class="h-6 w-6 rounded-xs text-white hover:bg-white/20 disabled:opacity-30" :disabled="i === 0" :aria-label="`${i + 1}번째 앞으로`" @click="move(i, -1)">‹</button>
          <button type="button" class="h-6 w-6 rounded-xs text-white hover:bg-white/20" :aria-label="`${i + 1}번째 삭제`" @click="remove(i)">×</button>
          <button type="button" class="h-6 w-6 rounded-xs text-white hover:bg-white/20 disabled:opacity-30" :disabled="i === model.length - 1" :aria-label="`${i + 1}번째 뒤로`" @click="move(i, 1)">›</button>
        </div>
      </li>
      <li v-for="p in pending" :key="p.key" :class="['relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded border p-2 text-center', p.status === 'error' ? 'border-danger bg-danger-soft' : 'border-line bg-surface-2']">
        <img v-if="p.preview && p.status === 'uploading'" :src="p.preview" alt="" class="absolute inset-0 h-full w-full object-cover opacity-40" />
        <span v-if="p.status === 'uploading'" class="relative text-2xs font-semibold" role="status">업로드 중…</span>
        <template v-else>
          <span class="relative line-clamp-2 text-2xs font-semibold text-danger" role="alert">{{ p.error }}</span>
          <button type="button" class="relative text-2xs underline" @click="pending = pending.filter((x) => x.key !== p.key)">닫기</button>
        </template>
      </li>
    </ul>
  </div>
</template>
