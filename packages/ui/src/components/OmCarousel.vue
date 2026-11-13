<script setup lang="ts">
// Carousel: dots, prev/next, play/pause, arrow keys, swipe, pause on hover.
// Honors prefers-reduced-motion (no autoplay).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ count: number; autoplayMs?: number; label?: string }>(), { autoplayMs: 5000 })
const index = defineModel<number>({ default: 0 })
const playing = ref(true)
const hovering = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let touchX: number | null = null
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const canPlay = computed(() => playing.value && !hovering.value && props.count > 1 && !reduced())
const go = (n: number) => { index.value = (n + props.count) % props.count }
const tick = () => { stop(); if (canPlay.value && props.autoplayMs > 0) timer = setInterval(() => go(index.value + 1), props.autoplayMs) }
const stop = () => { if (timer) { clearInterval(timer); timer = null } }
watch([playing, hovering, () => props.count], tick)
onMounted(tick)
onBeforeUnmount(stop)
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'ArrowLeft') go(index.value - 1)
  else if (e.key === 'ArrowRight') go(index.value + 1)
}
const onTouchStart = (e: TouchEvent) => { touchX = e.touches[0]?.clientX ?? null }
const onTouchEnd = (e: TouchEvent) => {
  if (touchX === null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX
  if (Math.abs(dx) > 40) go(index.value + (dx < 0 ? 1 : -1))
  touchX = null
}
</script>

<template>
  <div
    class="group relative w-full overflow-hidden rounded-lg"
    role="region"
    :aria-label="label || '배너'"
    tabindex="0"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @keydown="onKey"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <div
      class="flex transition-transform duration-slow ease-om"
      :style="{ transform: `translateX(-${index * 100}%)` }"
    >
      <div v-for="i in count" :key="i" class="w-full shrink-0" :aria-hidden="i - 1 !== index">
        <slot :index="i - 1" />
      </div>
    </div>
    <template v-if="count > 1">
      <button type="button" aria-label="이전" class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-overlay/40 p-2 text-white opacity-0 transition-opacity hover:bg-overlay/60 focus-visible:opacity-100 group-hover:opacity-100" @click="go(index - 1)">
        <ChevronLeft class="h-5 w-5" aria-hidden="true" />
      </button>
      <button type="button" aria-label="다음" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-overlay/40 p-2 text-white opacity-0 transition-opacity hover:bg-overlay/60 focus-visible:opacity-100 group-hover:opacity-100" @click="go(index + 1)">
        <ChevronRight class="h-5 w-5" aria-hidden="true" />
      </button>
      <div class="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
        <button
          v-for="i in count"
          :key="i"
          type="button"
          :aria-label="`${i}번으로 이동`"
          class="h-1.5 rounded-full transition-all"
          :class="(i - 1) === index ? 'w-5 bg-white' : 'w-1.5 bg-white/60 hover:bg-white'"
          @click="go(i - 1)"
        />
        <button type="button" :aria-label="playing ? '일시정지' : '재생'" class="ml-1 rounded-full bg-overlay/40 p-1 text-white hover:bg-overlay/60" @click="playing = !playing">
          <Pause v-if="playing" class="h-3.5 w-3.5" aria-hidden="true" />
          <Play v-else class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </template>
  </div>
</template>
