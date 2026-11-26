// apps/cloudflare-gateway/src/lib/migration-version.js
// Numeric-aware D1 migration versioning. Migration filenames sort lexically
// wrong once d1_100 lands ('d1_100' < 'd1_77'), which broke MAX(version)
// ordering, remote apply order, and rehearsal order. Every comparison of
// migration versions goes through these helpers: numeric prefix first,
// full-name tiebreak second, unparseable names sink to -1.

export function migrationNum(name) {
  const m = /^d1_(\d+)/.exec(String(name || ''));
  return m ? Number(m[1]) : -1;
}

export function compareMigrationNames(a, b) {
  const d = migrationNum(a) - migrationNum(b);
  if (d !== 0) return d;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxMigrationVersion(names) {
  let best = null;
  for (const n of names || []) {
    if (best === null || compareMigrationNames(n, best) > 0) best = n;
  }
  return best;
}
