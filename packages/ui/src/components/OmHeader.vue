<script setup lang="ts">
// Top bar shell (Meridian 2.0): brand | center (search / title) | actions. `sticky` keeps it on top while scrolling.
withDefaults(defineProps<{ sticky?: boolean; bordered?: boolean; contained?: boolean }>(), { sticky: true, bordered: true, contained: true })
</script>

<template>
  <header
    :class="[
      'z-sticky w-full bg-surface/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-surface/85 transition-shadow duration-fast',
      sticky ? 'sticky top-0' : '',
      bordered ? 'border-b border-line' : ''
    ]"
  >
    <slot name="top" />
    <div :class="['flex h-header items-center gap-3 sm:gap-5', contained ? 'om-container' : 'px-4 sm:px-6']">
      <div class="flex shrink-0 items-center gap-2.5"><slot name="start" /></div>
      <div class="flex min-w-0 flex-1 items-center"><slot /></div>
      <div class="flex shrink-0 items-center gap-1.5"><slot name="end" /></div>
    </div>
    <slot name="bottom" />
  </header>
</template>
