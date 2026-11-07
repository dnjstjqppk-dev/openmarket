// Reactive viewport breakpoint for Vue views. Thin wrapper over the framework-free
// breakpoints.ts core (shared cut-offs, unit-tested in tests/ui/breakpoints.test.mjs).
// SSR-safe: without a window it reports the initial width until mounted.
import { ref, computed, onMounted, onUnmounted, getCurrentInstance } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import {
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  breakpointOf,
  deviceOf,
  matches,
  matchesDevice
} from './breakpoints'
import type { BreakpointKey, DeviceClass } from './breakpoints'

export { BREAKPOINTS, BREAKPOINT_ORDER, breakpointOf, deviceOf, matches, matchesDevice }
export type { BreakpointKey, DeviceClass }

export interface BreakpointState {
  width: Ref<number>
  breakpoint: ComputedRef<BreakpointKey>
  device: ComputedRef<DeviceClass>
  isPhone: ComputedRef<boolean>
  isTablet: ComputedRef<boolean>
  isDesktop: ComputedRef<boolean>
  isWide: ComputedRef<boolean>
}

export function useBreakpoint(initialWidth: number = BREAKPOINTS.wide): BreakpointState {
  const width = ref(initialWidth)
  const breakpoint = computed<BreakpointKey>(() => breakpointOf(width.value))
  const device = computed<DeviceClass>(() => deviceOf(width.value))
  const isPhone = computed(() => device.value === 'phone')
  const isTablet = computed(() => device.value === 'tablet')
  const isDesktop = computed(() => device.value !== 'phone')
  const isWide = computed(() => matches(width.value, 'wide'))

  const onResize = () => {
    width.value = window.innerWidth
  }
  // Register listeners only inside a component instance; bare calls (SSR, tests) stay inert.
  if (getCurrentInstance()) {
    onMounted(() => {
      onResize()
      window.addEventListener('resize', onResize, { passive: true })
    })
    onUnmounted(() => {
      window.removeEventListener('resize', onResize)
    })
  }

  return { width, breakpoint, device, isPhone, isTablet, isDesktop, isWide }
}
