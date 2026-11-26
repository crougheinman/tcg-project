import type { MatchRecord } from './tracker';
import { validateRecord } from './validate';

// Sends a finished match's record to Supabase and keeps it safe if that fails. Fire-and-forget by design: the game never
// waits on this, never shows an error for it, and never throws into it. The client and storage are passed in, so this
// is tested with fakes and has no hidden global.

export interface StatsClient {
  from(table: string): { insert(row: unknown): PromiseLike<{ error: { code?: string; message?: string } | null }> };
}
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const TABLE = 'match_stats';
export const OUTBOX_KEY = 'matchStatsOutbox';
/** A player who is offline for a long time does not grow storage without bound: the oldest records go first. */
export const MAX_OUTBOX = 25;

export type Outcome = 'sent' | 'queued' | 'dropped';

/** Database errors that will never succeed on retry (a CHECK, a type or a not-null violation): drop the record. */
const PERMANENT = new Set(['23514', '23502', '22P02', '22001', '22003', '23503']);
/** The row is already there: the other PvP client got to it first. That is success. */
const DUPLICATE = '23505';

function readOutbox(kv: KV): MatchRecord[] {
  try {
    const v = JSON.parse(kv.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? (v as MatchRecord[]) : [];
  } catch {
    return [];
  }
}
function writeOutbox(kv: KV, rows: MatchRecord[]): void {
  try {
    kv.setItem(OUTBOX_KEY, JSON.stringify(rows.slice(-MAX_OUTBOX)));
  } catch {
    /* storage full or blocked: this record is lost, which is acceptable for statistics */
  }
}

async function insertOnce(client: StatsClient, rec: MatchRecord): Promise<Outcome> {
  try {
    const { error } = await client.from(TABLE).insert(rec);
    if (!error || error.code === DUPLICATE) return 'sent';
    if (error.code && PERMANENT.has(error.code)) return 'dropped';
    return 'queued'; // network trouble, a missing table, a permission not granted yet: keep it and try again later
  } catch {
    return 'queued';
  }
}

/** Send one finished match. Records that fail for a temporary reason wait in the outbox for the next call. */
export async function submitMatch(rec: MatchRecord, client: StatsClient, kv: KV): Promise<Outcome> {
  if (validateRecord(rec).length) return 'dropped';
  const outcome = await insertOnce(client, rec);
  if (outcome === 'queued') {
    const box = readOutbox(kv);
    if (!box.some((r) => r.match_key === rec.match_key)) writeOutbox(kv, [...box, rec]);
  } else if (outcome === 'sent') {
    await flushOutbox(client, kv); // the connection works: send what was waiting
  }
  return outcome;
}

/** Try every waiting record once; whatever still cannot be sent stays. Returns how many went out. */
export async function flushOutbox(client: StatsClient, kv: KV): Promise<number> {
  const box = readOutbox(kv);
  if (!box.length) return 0;
  const keep: MatchRecord[] = [];
  let sent = 0;
  for (const rec of box) {
    const o = validateRecord(rec).length ? 'dropped' : await insertOnce(client, rec);
    if (o === 'sent') sent++;
    else if (o === 'queued') keep.push(rec);
  }
  writeOutbox(kv, keep);
  return sent;
}
