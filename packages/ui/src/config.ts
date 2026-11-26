// Shared boot config guard (P2 consolidation: was triplicated verbatim in the
// storefront, admin and partner configs — an env-policy change could drift).

/** Required endpoint env. Production builds refuse to boot on an implicit
 * host; `vite dev` falls back to the given local default. */
export function requiredEnv(name: string, devFallback: string): string {
  const env = (import.meta as any).env || {}
  if (env[name]) return env[name]
  if (env.DEV === true) return devFallback
  throw new Error(`[config] ${name} is not set — refusing to boot with an implicit endpoint`)
}
