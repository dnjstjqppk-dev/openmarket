<script setup lang="ts">
// Image with a gray loading box and a neutral error icon. Never substitutes an
// external stock photo when the source fails.
import { ref, watch } from 'vue'
import { ImageOff } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  src?: string | null
  srcset?: string | null
  sizes?: string | null
  alt?: string
  eager?: boolean
  ratio?: string
}>(), { srcset: null, sizes: null, alt: '', eager: false, ratio: 'aspect-square' })
const state = ref<'loading' | 'ready' | 'error'>(props.src ? 'loading' : 'error')
watch(() => props.src, () => { state.value = props.src ? 'loading' : 'error' })
</script>

<template>
  <span :class="['relative block overflow-hidden bg-surface-2', ratio]">
    <span v-if="state === 'loading'" class="absolute inset-0 animate-pulse bg-surface-3" aria-hidden="true" />
    <img
      v-if="src && state !== 'error'"
      :src="src"
      :srcset="srcset || undefined"
      :sizes="sizes || undefined"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      class="h-full w-full object-cover"
      @load="state = 'ready'"
      @error="state = 'error'"
    />
    <span v-if="state === 'error'" class="absolute inset-0 flex items-center justify-center text-ink-subtle" role="img" :aria-label="alt || '이미지 없음'">
      <ImageOff class="h-8 w-8" aria-hidden="true" />
    </span>
    <slot />
  </span>
</template>
