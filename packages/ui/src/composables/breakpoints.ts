// Framework-free breakpoint core (unit-tested in tests/ui/breakpoints.test.mjs).
// Single source of truth for the 7 responsive cut-offs shared by Vue, Flutter and QA screenshots.
// Thresholds are min-widths: a viewport belongs to the greatest breakpoint it reaches.

export const BREAKPOINTS = {
  phone: 360,
  phoneLg: 390,
  phablet: 480,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
  wide: 1440
} as const

export type BreakpointKey = keyof typeof BREAKPOINTS

export const BREAKPOINT_ORDER: readonly BreakpointKey[] = [
  'phone', 'phoneLg', 'phablet', 'tablet', 'laptop', 'desktop', 'wide'
] as const

/** Device class drives layout redesigns (never mere scaling): phone < 768, tablet 768–1279, desktop ≥ 1280. */
export type DeviceClass = 'phone' | 'tablet' | 'desktop'

export const DEVICE_MIN_WIDTH: Record<DeviceClass, number> = {
  phone: 0,
  tablet: BREAKPOINTS.tablet,
  desktop: BREAKPOINTS.desktop
}

function coerceWidth(width: unknown): number {
  // Unknown viewports (null, undefined, '') fail closed to the desktop layout, never to phone.
  if (width === null || width === undefined || width === '') return BREAKPOINTS.wide
  const w = Number(width)
  if (!Number.isFinite(w)) return BREAKPOINTS.wide
  return Math.max(0, Math.floor(w))
}

/** Greatest breakpoint at or below `width`. Viewports under 360 still report 'phone'. */
export function breakpointOf(width: number): BreakpointKey {
  const w = coerceWidth(width)
  let key: BreakpointKey = 'phone'
  for (const k of BREAKPOINT_ORDER) {
    if (w >= BREAKPOINTS[k]) key = k
    else break
  }
  return key
}

/** Layout family for `width`: bottom-nav phone, two-column tablet, multi-column desktop. */
export function deviceOf(width: number): DeviceClass {
  const w = coerceWidth(width)
  if (w >= BREAKPOINTS.desktop) return 'desktop'
  if (w >= BREAKPOINTS.tablet) return 'tablet'
  return 'phone'
}

/** True when `width` reaches the `key` cut-off (min-width semantics, mirroring Tailwind md:/lg:/…). */
export function matches(width: number, key: BreakpointKey): boolean {
  return coerceWidth(width) >= BREAKPOINTS[key]
}

/** True when `width` is at least the `device` family floor (0 / 768 / 1280). */
export function matchesDevice(width: number, device: DeviceClass): boolean {
  return coerceWidth(width) >= DEVICE_MIN_WIDTH[device]
}
