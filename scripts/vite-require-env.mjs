// scripts/vite-require-env.mjs
// Build-time guard for the frontend endpoint env (VITE_*). The apps already refuse to
// boot without them (src/config.ts requiredEnv), but a build that omits them still
// succeeds and ships a bundle that throws on load. Cloudflare's Git-connected Workers
// Builds did exactly that on worker `openmarket` (no build env, redeploy on every main
// push — reports/GO_LIVE_CHECKLIST.md G07). This plugin turns that into a failed
// build, which Workers Builds does not deploy.
//
// Enforced only where a build is meant to be deployed: inside Cloudflare Workers
// Builds (WORKERS_CI is set there) or when OLMOA_REQUIRE_BUILD_ENV=1 (deploy.yml).
// Local, CI-verify and dist-local preview builds are unaffected.

export function requireBuildEnv(names) {
  return {
    name: 'olmoa-require-build-env',
    apply: 'build',
    configResolved(config) {
      const enforced = Boolean(process.env.WORKERS_CI) || process.env.OLMOA_REQUIRE_BUILD_ENV === '1';
      if (!enforced) return;
      const missing = names.filter((n) => !String(config.env[n] || process.env[n] || '').trim());
      if (missing.length) {
        throw new Error(`[olmoa] deployable build is missing ${missing.join(', ')} — set them in the build environment (Cloudflare dashboard → Worker → Settings → Build → Variables, or deploy.yml).`);
      }
    }
  };
}
