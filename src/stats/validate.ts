import type { MatchRecord } from './tracker';

// The same limits the database enforces (supabase/migrations: the CHECK constraints), applied before a record is sent. A record that
// breaks one would be refused by the database for good, so it is dropped here instead of being retried forever from the outbox.
// Keep the two in step: `stats.test.ts` has a test that reads the migration and compares the numbers.

export const LIMITS = {
  maxTurns: 500,
  maxDurationS: 86_400,
  maxCustomCards: 60,
  maxStatsBytes: 30_000,
  maxText: 64,
} as const;

const MODES = ['ai', 'hotseat', 'pvp'];
const REASONS = ['life', 'deck', 'draw', 'forfeit', 'disconnect'];
const intIn = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.maxText;

/** Why a record would be refused (empty = fine). */
export function validateRecord(r: MatchRecord): string[] {
  const bad: string[] = [];
  if (!intIn(r.schema_version, 1, 1000)) bad.push('schema_version');
  for (const k of ['match_key', 'game_version', 'content_hash', 'env', 'deck_a', 'deck_b'] as const) if (!text(r[k])) bad.push(k);
  if (!MODES.includes(r.mode)) bad.push('mode');
  if (!['A', 'B'].includes(r.first_player)) bad.push('first_player');
  if (!['A', 'B', 'draw'].includes(r.winner)) bad.push('winner');
  if (!REASONS.includes(r.end_reason)) bad.push('end_reason');
  if (!intIn(r.turns, 1, LIMITS.maxTurns)) bad.push('turns');
  if (r.duration_s !== null && !intIn(r.duration_s, 0, LIMITS.maxDurationS)) bad.push('duration_s');
  if (!intIn(r.mulligans_a, 0, 3)) bad.push('mulligans_a');
  if (!intIn(r.mulligans_b, 0, 3)) bad.push('mulligans_b');
  if (!intIn(r.life_a, -1000, 1000)) bad.push('life_a');
  if (!intIn(r.life_b, -1000, 1000)) bad.push('life_b');
  for (const k of ['custom_a', 'custom_b'] as const) {
    const v = r[k];
    if (v !== null && !(Array.isArray(v) && v.length <= LIMITS.maxCustomCards && v.every((x) => typeof x === 'string'))) bad.push(k);
  }
  if (!r.stats || typeof r.stats !== 'object' || JSON.stringify(r.stats).length > LIMITS.maxStatsBytes) bad.push('stats');
  return bad;
}
