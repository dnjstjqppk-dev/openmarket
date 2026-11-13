<script setup lang="ts">
// Product image gallery: large image + thumbnail strip, desktop magnifier,
// mobile swipe with 1/N counter, fullscreen viewer.
import { ref } from 'vue'
import { Maximize2, X } from 'lucide-vue-next'

export interface GalleryImage { src: string; alt?: string }
const props = withDefaults(defineProps<{ images: GalleryImage[]; label?: string }>(), { label: '상품 이미지' })
const index = defineModel<number>({ default: 0 })
const full = ref(false)
const zoom = ref(false)
const zoomPos = ref('50% 50%')
let touchX: number | null = null
const go = (n: number) => {
  if (!props.images.length) return
  index.value = (n + props.images.length) % props.images.length
}
const onMove = (e: MouseEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  zoomPos.value = `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}% ${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`
}
const onTouchStart = (e: TouchEvent) => { touchX = e.touches[0]?.clientX ?? null }
const onTouchEnd = (e: TouchEvent) => {
  if (touchX === null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX
  if (Math.abs(dx) > 40) go(index.value + (dx < 0 ? 1 : -1))
  touchX = null
}
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft') go(index.value - 1)
  else if (e.key === 'ArrowRight') go(index.value + 1)
  else if (e.key === 'Escape') full.value = false
}
</script>

<template>
  <div v-if="images.length" @keydown="onKey">
    <div
      class="relative aspect-square cursor-zoom-in overflow-hidden rounded-lg bg-surface-2"
      tabindex="0"
      role="group"
      :aria-label="label"
      @mouseenter="zoom = true"
      @mouseleave="zoom = false"
      @mousemove="onMove"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @click="full = true"
    >
      <img
        :src="images[index]?.src"
        :alt="images[index]?.alt || `${label} ${index + 1}`"
        class="h-full w-full object-cover transition-transform duration-fast"
        :class="zoom ? 'scale-[1.8]' : ''"
        :style="zoom ? { transformOrigin: zoomPos } : undefined"
      />
      <span class="absolute bottom-2 right-2 rounded bg-overlay/60 px-2 py-0.5 text-2xs font-semibold text-white om-num sm:hidden">
        {{ index + 1 }} / {{ images.length }}
      </span>
      <span class="absolute right-2 top-2 hidden rounded bg-overlay/60 p-1.5 text-white sm:block" aria-hidden="true">
        <Maximize2 class="h-4 w-4" />
      </span>
    </div>
    <div class="mt-2 flex gap-2 overflow-x-auto" role="listbox" aria-label="썸네일">
      <button
        v-for="(img, i) in images"
        :key="i"
        type="button"
        role="option"
        :aria-selected="i === index"
        :aria-label="`썸네일 ${i + 1}`"
        class="h-16 w-16 shrink-0 overflow-hidden rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        :class="i === index ? 'border-primary' : 'border-transparent hover:border-line-strong'"
        @click="go(i)"
      >
        <img :src="img.src" :alt="img.alt || `썸네일 ${i + 1}`" loading="lazy" class="h-full w-full object-cover" />
      </button>
    </div>
    <Teleport to="body">
      <div v-if="full" class="fixed inset-0 z-modal flex items-center justify-center bg-overlay/90 p-4" role="dialog" aria-modal="true" aria-label="전체화면 보기" @click.self="full = false">
        <button type="button" aria-label="닫기" class="absolute right-4 top-4 rounded-full bg-surface p-2 text-ink hover:bg-surface-2" @click="full = false">
          <X class="h-5 w-5" aria-hidden="true" />
        </button>
        <img :src="images[index]?.src" :alt="images[index]?.alt || label" class="max-h-full max-w-full rounded-lg object-contain" />
      </div>
    </Teleport>
  </div>
</template>
