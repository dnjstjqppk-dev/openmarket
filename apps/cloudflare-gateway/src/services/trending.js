// apps/cloudflare-gateway/src/services/trending.js
// Work order 2-8: trending search computation and hourly hygiene.

import { getPolicy } from '../lib/ledger.js';

function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.count - a.count || (a.keyword < b.keyword ? -1 : 1));
  const ranks = new Map();
  sorted.forEach((r, i) => ranks.set(r.keyword, i + 1));
  return ranks;
}

/**
 * Top 10 keywords of the last 24h with rank deltas against the prior 24h.
 * Below-minimum and banned keywords stay out. Positive delta means climbed.
 */
export async function computeTrending(env) {
  const minRaw = await getPolicy(env, 'trending.min_count');
  const minCount = minRaw == null ? 0 : Math.max(0, Number(minRaw) || 0);
  const { results: bannedRows } = await env.DB.prepare('SELECT word FROM trending_banned_words').all();
  const banned = new Set(bannedRows.map((r) => r.word));
  const { results: curr } = await env.DB.prepare(
    `SELECT keyword, SUM(search_count) AS count FROM search_keyword_hourly
     WHERE hour >= datetime('now', '-24 hours') GROUP BY keyword`
  ).all();
  const { results: prev } = await env.DB.prepare(
    `SELECT keyword, SUM(search_count) AS count FROM search_keyword_hourly
     WHERE hour >= datetime('now', '-48 hours') AND hour < datetime('now', '-24 hours') GROUP BY keyword`
  ).all();
  const eligible = (rows) => rows.filter((r) => r.count >= minCount && !banned.has(r.keyword));
  const prevRanks = rankRows(eligible(prev));
  const currRows = eligible(curr);
  const currRanks = rankRows(currRows);
  const counts = new Map(currRows.map((r) => [r.keyword, r.count]));
  return [...currRanks.entries()]
      .map(([keyword, rank]) => ({ keyword, count: counts.get(keyword), rank, prev_rank: prevRanks.get(keyword) ?? null }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 10)
      .map((r) => ({ ...r, delta: r.prev_rank == null ? null : r.prev_rank - r.rank }));
}

/** Delete hourly rows older than 7 days. Returns the purged count. */
export async function purgeOldSearchHours(env) {
  const r = await env.DB.prepare(
    "DELETE FROM search_keyword_hourly WHERE hour < datetime('now', '-7 days')"
  ).run();
  return r.meta.changes;
}
