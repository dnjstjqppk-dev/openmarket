<script setup lang="ts">
// Product gallery uploader (4-3): up to 10 own-storage images, first one is
// the cover. Uploads raw FormData (never JSON-stringified).
import { ref } from 'vue'
import { API_BASE_URL, getPartnerAuthHeaders } from '../../config'
import { userErrorMessage, useToast } from '@olmoa/ui'

export interface GalleryImage { image_url: string; alt_text?: string }
const images = defineModel<GalleryImage[]>({ default: () => [] })
const toastApi = useToast()
const uploading = ref(false)
const error = ref('')

function checkPixels(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth >= 500 && img.naturalHeight >= 500) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false) }
    img.src = url
  })
}

async function onFiles(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  if (images.value.length + files.length > 10) {
    error.value = '상품 이미지는 최대 10장까지 등록할 수 있습니다.'
    return
  }
  uploading.value = true
  error.value = ''
  try {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/') && !(await checkPixels(file))) throw new Error(`“${file.name}” 이미지가 작습니다. 500×500 이상으로 올려 주세요.`)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'products')
      const res = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, {
        method: 'POST',
        headers: getPartnerAuthHeaders(),
        body: formData
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success || !json.data?.public_url) throw new Error(json.error || '이미지 업로드에 실패했습니다.')
      images.value = [...images.value, { image_url: json.data.public_url, alt_text: '' }]
    }
  } catch (err: any) {
    error.value = userErrorMessage(err, '이미지 업로드에 실패했습니다.')
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

function removeAt(i: number) { images.value = images.value.filter((_, k) => k !== i) }
function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= images.value.length) return
  const next = [...images.value]
  ;[next[i], next[j]] = [next[j], next[i]]
  images.value = next
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="images.length" class="grid grid-cols-5 gap-2">
      <div v-for="(im, i) in images" :key="`${im.image_url}-${i}`" class="relative">
        <img :src="im.image_url" :alt="im.alt_text || `상품 이미지 ${i + 1}`" loading="lazy" decoding="async" class="aspect-square w-full rounded-lg border object-cover" :class="i === 0 ? 'border-primary' : 'border-line'" />
        <span v-if="i === 0" class="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-2xs font-bold text-primary-on">대표</span>
        <div class="absolute right-1 top-1 flex gap-1">
          <button v-if="i > 0" type="button" aria-label="앞으로 이동" class="rounded bg-overlay/60 px-1.5 py-0.5 text-2xs font-bold text-primary-on" @click="move(i, -1)">‹</button>
          <button v-if="i < images.length - 1" type="button" aria-label="뒤로 이동" class="rounded bg-overlay/60 px-1.5 py-0.5 text-2xs font-bold text-primary-on" @click="move(i, 1)">›</button>
          <button type="button" aria-label="이미지 삭제" class="rounded bg-overlay/60 px-1.5 py-0.5 text-2xs font-bold text-primary-on" @click="removeAt(i)">✕</button>
        </div>
      </div>
    </div>
    <label class="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-xs font-bold text-ink-muted hover:bg-surface-2">
      <input type="file" accept="image/*" multiple class="hidden" :disabled="uploading" @change="onFiles" />
      {{ uploading ? '업로드 중…' : `상품 이미지 추가 (${images.length}/10)` }}
    </label>
    <p v-if="error" role="alert" class="text-xs font-bold text-danger">{{ error }}</p>
  </div>
</template>
