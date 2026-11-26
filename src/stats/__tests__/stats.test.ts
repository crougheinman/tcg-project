import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pickAction } from '../../ai/ai';
import { CARDS, TOKEN_IDS, getDef } from '../../cards/cards';
import { DECK_LIST } from '../../cards/decks';
import { applyAction } from '../../engine/reducer';
import { actorOf } from '../../engine/rules';
import { createInitialState } from '../../engine/state';
import type { GameState } from '../../engine/types';
import { contentHash, fnv1a } from '../contentHash';
import { isSharing, setSharing } from '../prefs';
import { createStatsSession } from '../session';
import { MAX_OUTBOX, OUTBOX_KEY, flushOutbox, submitMatch, type KV, type StatsClient } from '../send';
import { endReason, finish, newTracker, track, type MatchMeta, type MatchRecord } from '../tracker';
import { LIMITS, validateRecord } from '../validate';

const deck = (id: string) => DECK_LIST.find((d) => d.id === id)!.cards;
const meta = (a: string, b: string, over: Partial<MatchMeta> = {}): MatchMeta => ({
  matchKey: `t-${a}-${b}`, mode: 'ai', humanA: true, humanB: false, deckA: a, deckB: b, customA: null, customB: null,
  gameVersion: '9.9.9', contentHash: 'deadbeef', env: 'production', automated: false, startedAt: 1000, ...over,
});

/** A whole AI-vs-AI game, tracked step by step the way the store does it. */
function play(a: string, b: string, seed: number) {
  let g = createInitialState(seed, deck(a), deck(b), { mulligan: true });
  const t = newTracker(meta(a, b));
  for (let i = 0; i < 6000 && !g.winner; i++) {
    const action = pickAction(g, actorOf(g));
    const next = applyAction(g, action);
    track(t, g, action, next);
    g = next;
  }
  expect(g.winner, 'the game must finish').toBeTruthy();
  return { g, t, rec: finish(t, g, undefined, 61_000) };
}

const GAMES: [string, string, number][] = [
  ['emberwood', 'skyward', 1], ['gravetide', 'ironblossom', 2], ['wildblitz', 'stonewall', 3],
  ['pyromancer', 'wildwood', 4], ['ironblossom', 'skyward', 5], ['gravetide', 'wildblitz', 6],
  ['stonewall', 'emberwood', 7], ['wildwood', 'pyromancer', 8], ['skyward', 'gravetide', 9], ['ironblossom', 'ironblossom', 10],
];
const count = (g: GameState, re: RegExp) => g.log.filter((l) => re.test(l)).length;
const sum = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0);
const tokenNames = new Set([...TOKEN_IDS].map((id) => getDef(id).name));

describe('the match tracker, against real games (checked against the engine log, which it never reads)', () => {
  it.each(GAMES)('%s v %s (seed %i): every count agrees with an independent source', (a, b, seed) => {
    const { g, rec } = play(a, b, seed);
    for (const [id, side] of [['A', rec.stats.A], ['B', rec.stats.B]] as const) {
      const life = id === 'A' ? rec.life_a : rec.life_b;
      expect(20 - side.damage_taken + side.life_gained, `${id} life identity`).toBe(life);
      expect(side.creatures_cast + side.spells_cast + side.equipment_cast, `${id} casts`).toBe(count(g, new RegExp(`^${id} casts `)));
      expect(sum(side.cast), `${id} cast map`).toBe(side.creatures_cast + side.spells_cast + side.equipment_cast);
      expect(side.lands_played, `${id} lands`).toBe(count(g, new RegExp(`^${id} plays `)));
      expect(side.cycles, `${id} cycles`).toBe(count(g, new RegExp(`^${id} cycles `)));
      expect(side.unearths, `${id} unearths`).toBe(count(g, new RegExp(`^${id} unearths `)));
      // every card seen is in that player's deck, never more copies than the deck holds
      const copies: Record<string, number> = {};
      for (const c of deck(id === 'A' ? a : b)) copies[c] = (copies[c] ?? 0) + 1;
      for (const [card, n] of Object.entries(side.seen)) expect(n, `${id} saw ${card}`).toBeLessThanOrEqual(copies[card] ?? 0);
      // ...and what left the library is exactly what is not in it any more (a token is never in the library)
      expect(sum(side.seen), `${id} seen`).toBe(30 - g.players[id].library.length);
    }
    expect(rec.mulligans_a, 'mulligans A').toBe(count(g, /^A takes a mulligan/));
    expect(rec.mulligans_b, 'mulligans B').toBe(count(g, /^B takes a mulligan/));
    // creatures that died, both sides together, against the log's "X dies" lines (tokens are not counted by the tracker)
    const dies = g.log.filter((l) => l.endsWith(' dies') && !tokenNames.has(l.slice(0, -5))).length;
    expect(sum(rec.stats.A.died) + sum(rec.stats.B.died), 'deaths').toBe(dies);
    expect(rec.turns).toBe(g.turn);
    expect(rec.first_player).toBe('A'); // the game says "A is on the play"
    expect(rec.winner).toBe(g.winner);
    expect(rec.duration_s).toBe(60);
    expect(rec.stats.life_curve[rec.stats.life_curve.length - 1]).toEqual([rec.life_a, rec.life_b]);
    expect(rec.stats.life_curve.length).toBeLessThanOrEqual(rec.turns + 1);
    expect(validateRecord(rec), 'the record passes the database limits').toEqual([]);
  });

  it('records why the game ended: life, deck-out or a draw', () => {
    const g = createInitialState(1, deck('emberwood'), deck('skyward'));
    g.winner = 'A';
    g.players.B.life = 0;
    expect(endReason(g)).toBe('life');
    g.players.B.life = 4; // still alive, so the loss was an empty library
    expect(endReason(g)).toBe('deck');
    g.winner = 'draw';
    expect(endReason(g)).toBe('draw');
  });

  it('a forfeit names the player who stayed, with the reason', () => {
    const g = createInitialState(3, deck('emberwood'), deck('skyward'), { mulligan: true });
    const t = newTracker(meta('emberwood', 'skyward', { mode: 'pvp', humanB: true }));
    const rec = finish(t, g, { winner: 'B', reason: 'disconnect' }, 5000);
    expect(rec.winner).toBe('B');
    expect(rec.end_reason).toBe('disconnect');
    expect(rec.mode).toBe('pvp');
    expect(t.done).toBe(true);
    expect(validateRecord(rec)).toEqual([]);
  });

  it('has no duration when the start time is unknown (a rejoined match)', () => {
    const g = createInitialState(3, deck('emberwood'), deck('skyward'));
    g.winner = 'A';
    expect(finish(newTracker(meta('a', 'b', { startedAt: null })), g, undefined, 99_000).duration_s).toBeNull();
  });

  it('counts a death that Undying undoes, and a plain death, but not a token', () => {
    const inst = (def: string, iid: string, over = {}) => ({ iid, def, owner: 'A' as const, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over });
    const g = createInitialState(5, deck('wildwood'), deck('skyward'), { mulligan: false });
    g.phase = 'main1';
    g.active = 'A';
    // lethal damage already marked: the next action's state-based check kills all three (the Treant comes back through Undying)
    g.players.A.battlefield = [inst('ancient_treant', 'tr', { damage: 99 }), inst('ashigaru', 'as', { damage: 99 }), inst('wolf_token', 'wo', { damage: 99 })];
    const t = newTracker(meta('wildwood', 'skyward'));
    const next = applyAction(g, { type: 'advance' });
    track(t, g, { type: 'advance' }, next);
    expect(next.players.A.battlefield.some((c) => c.iid === 'tr' && c.revived), 'the Treant returned').toBe(true);
    expect(t.players.A.died).toEqual({ ancient_treant: 1, ashigaru: 1 }); // no wolf: a token
  });

  it('never throws, whatever it is fed', () => {
    const g = createInitialState(3, deck('emberwood'), deck('skyward'));
    const t = newTracker(meta('emberwood', 'skyward'));
    expect(() => track(t, g, { type: 'castCreature', iid: 'nope' }, g)).not.toThrow();
    expect(() => track(t, null as unknown as GameState, { type: 'advance' }, g)).not.toThrow();
  });
});

describe('the record limits', () => {
  const ok = (): MatchRecord => play('emberwood', 'skyward', 1).rec;
  it.each([
    ['turns', (r: MatchRecord) => ({ ...r, turns: 0 })],
    ['turns', (r: MatchRecord) => ({ ...r, turns: LIMITS.maxTurns + 1 })],
    ['mode', (r: MatchRecord) => ({ ...r, mode: 'cheat' as never })],
    ['winner', (r: MatchRecord) => ({ ...r, winner: 'C' as never })],
    ['end_reason', (r: MatchRecord) => ({ ...r, end_reason: 'x' as never })],
    ['mulligans_a', (r: MatchRecord) => ({ ...r, mulligans_a: 4 })],
    ['duration_s', (r: MatchRecord) => ({ ...r, duration_s: LIMITS.maxDurationS + 1 })],
    ['match_key', (r: MatchRecord) => ({ ...r, match_key: '' })],
    ['custom_a', (r: MatchRecord) => ({ ...r, custom_a: Array(LIMITS.maxCustomCards + 1).fill('x') })],
    ['stats', (r: MatchRecord) => ({ ...r, stats: { ...r.stats, junk: 'y'.repeat(LIMITS.maxStatsBytes) } as never })],
  ])('refuses a bad %s', (field, mutate) => {
    expect(validateRecord(mutate(ok()))).toContain(field);
  });

  it('sends exactly the columns the migration lets the public insert (no more, no fewer)', () => {
    const sql = readFileSync('supabase/migrations/20261126000000_match_stats.sql', 'utf8');
    const granted = /grant insert \(([^)]*)\) on public\.match_stats/.exec(sql)![1].split(',').map((c) => c.trim()).filter(Boolean).sort();
    expect(Object.keys(play('emberwood', 'skyward', 1).rec).sort()).toEqual(granted);
  });

  it('uses the same numbers as the database migration', () => {
    const sql = readFileSync('supabase/migrations/20261126000000_match_stats.sql', 'utf8');
    expect(sql).toContain(`turns between 1 and ${LIMITS.maxTurns}`);
    expect(sql).toContain(`duration_s between 0 and ${LIMITS.maxDurationS}`);
    expect(sql).toContain(`jsonb_array_length(custom_a) <= ${LIMITS.maxCustomCards}`);
    expect(sql).toContain(`pg_column_size(stats) <= ${LIMITS.maxStatsBytes}`);
    expect(sql).toMatch(/mode in \('ai', 'hotseat', 'pvp'\)/);
    expect(sql).toMatch(/end_reason in \('life', 'deck', 'draw', 'forfeit', 'disconnect'\)/);
  });
});

describe('the content hash', () => {
  const decks = [{ id: 'd', cards: ['a', 'b'] }];
  const cards = { a: { id: 'a', name: 'A', power: 2, toughness: 2, text: 'x', art: '/a.webp' } };
  it('is the same for the same data, in any key order, and ignores words and art', () => {
    const base = contentHash(cards, decks);
    expect(contentHash({ a: { toughness: 2, power: 2, id: 'a', name: 'Renamed', text: 'new words', flavor: 'f', art: '/other.webp' } }, decks)).toBe(base);
  });
  it('changes when a number or a deck list changes', () => {
    const base = contentHash(cards, decks);
    expect(contentHash({ a: { ...cards.a, power: 3 } }, decks)).not.toBe(base);
    expect(contentHash(cards, [{ id: 'd', cards: ['a', 'a'] }])).not.toBe(base);
  });
  it('is 8 hex digits, and the real data hashes to one', () => {
    expect(fnv1a('x')).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(CARDS, DECK_LIST)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('sending', () => {
  const rec = () => ({ ...play('emberwood', 'skyward', 1).rec });
  function fake(results: Array<{ code?: string } | 'throw' | null>) {
    const calls: string[] = [];
    const client: StatsClient = {
      from: () => ({
        insert: async (row: unknown) => {
          calls.push((row as MatchRecord).match_key);
          const r = results.length > 1 ? results.shift()! : results[0];
          if (r === 'throw') throw new Error('network');
          return { error: r ? { code: r.code, message: 'x' } : null };
        },
      }),
    };
    return { client, calls };
  }
  const store = () => {
    const m = new Map<string, string>();
    const kv: KV = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    return { kv, outbox: () => JSON.parse(m.get(OUTBOX_KEY) ?? '[]') as MatchRecord[] };
  };

  it('sends a record', async () => {
    const { client, calls } = fake([null]);
    const s = store();
    expect(await submitMatch(rec(), client, s.kv)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(s.outbox()).toEqual([]);
  });
  it('treats "already there" (the other online player sent it first) as sent', async () => {
    expect(await submitMatch(rec(), fake([{ code: '23505' }]).client, store().kv)).toBe('sent');
  });
  it('keeps a record when the network fails, and sends it with the next match', async () => {
    const s = store();
    const a = { ...rec(), match_key: 'a' };
    expect(await submitMatch(a, fake(['throw']).client, s.kv)).toBe('queued');
    expect(s.outbox().map((r) => r.match_key)).toEqual(['a']);
    const { client, calls } = fake([null]);
    expect(await submitMatch({ ...rec(), match_key: 'b' }, client, s.kv)).toBe('sent');
    expect(calls).toEqual(['b', 'a']); // the new one, then the one that was waiting
    expect(s.outbox()).toEqual([]);
  });
  it('keeps a record when the table or permission is not there yet (a temporary state)', async () => {
    const s = store();
    expect(await submitMatch(rec(), fake([{ code: '42501' }]).client, s.kv)).toBe('queued');
    expect(s.outbox()).toHaveLength(1);
  });
  it('drops a record the database will never accept, instead of retrying it for ever', async () => {
    const s = store();
    expect(await submitMatch(rec(), fake([{ code: '23514' }]).client, s.kv)).toBe('dropped');
    expect(s.outbox()).toEqual([]);
  });
  it('never calls the database for an invalid record', async () => {
    const { client, calls } = fake([null]);
    expect(await submitMatch({ ...rec(), turns: 0 }, client, store().kv)).toBe('dropped');
    expect(calls).toEqual([]);
  });
  it('queues a match once, and caps the outbox', async () => {
    const s = store();
    const down = fake(['throw']);
    await submitMatch({ ...rec(), match_key: 'same' }, down.client, s.kv);
    await submitMatch({ ...rec(), match_key: 'same' }, down.client, s.kv);
    expect(s.outbox()).toHaveLength(1);
    for (let i = 0; i < MAX_OUTBOX + 5; i++) await submitMatch({ ...rec(), match_key: 'k' + i }, down.client, s.kv);
    expect(s.outbox()).toHaveLength(MAX_OUTBOX);
    expect(s.outbox()[s.outbox().length - 1].match_key).toBe('k' + (MAX_OUTBOX + 4)); // the newest survive
  });
  it('flushes what is waiting, and keeps what still fails', async () => {
    const s = store();
    await submitMatch({ ...rec(), match_key: 'w1' }, fake(['throw']).client, s.kv);
    await submitMatch({ ...rec(), match_key: 'w2' }, fake(['throw']).client, s.kv);
    expect(await flushOutbox(fake(['throw']).client, s.kv)).toBe(0);
    expect(s.outbox()).toHaveLength(2);
    expect(await flushOutbox(fake([null]).client, s.kv)).toBe(2);
    expect(s.outbox()).toEqual([]);
  });
});

describe('the sharing switch', () => {
  const kv = (v: string | null) => ({ getItem: () => v });
  it('is on unless the player turned it off', () => {
    expect(isSharing(kv(null))).toBe(true);
    expect(isSharing(kv('1'))).toBe(true);
    expect(isSharing(kv('0'))).toBe(false);
  });
  it('survives storage that throws or is missing', () => {
    expect(isSharing({ getItem: () => { throw new Error('blocked'); } })).toBe(true);
    expect(isSharing(null)).toBe(true);
    expect(() => setSharing(false, { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
  it('remembers the choice', () => {
    const m = new Map<string, string>();
    setSharing(false, { setItem: (k, v) => void m.set(k, v) });
    expect(isSharing({ getItem: (k) => m.get(k) ?? null })).toBe(false);
  });
});

describe('the stats session (what the store drives)', () => {
  const rows: MatchRecord[] = [];
  const mk = (over: Partial<Parameters<typeof createStatsSession>[0]> = {}) => {
    rows.length = 0;
    const m = new Map<string, string>();
    let clock = 1_000;
    return createStatsSession({
      client: { from: () => ({ insert: async (r: unknown) => { rows.push(r as MatchRecord); return { error: null }; } }) },
      kv: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) },
      sharing: () => true, now: () => (clock += 30_000), gameVersion: '1.0.2', contentHash: () => 'feedface',
      env: 'production', automated: false, newKey: () => 'key-' + Math.random(), ...over,
    });
  };
  const run = (s: ReturnType<typeof mk>, a = 'emberwood', b = 'skyward', seed = 1, onStep?: (g: GameState) => void) => {
    let g = createInitialState(seed, deck(a), deck(b), { mulligan: true });
    for (let i = 0; i < 6000 && !g.winner; i++) {
      const action = pickAction(g, actorOf(g));
      const next = applyAction(g, action);
      s.step(action, g, next);
      g = next;
      onStep?.(g);
    }
    return g;
  };
  const settle = () => new Promise((r) => setTimeout(r, 5));

  it('reports a finished match exactly once, with everything the match meta said', async () => {
    const s = mk();
    s.begin({ mode: 'ai', humanA: true, humanB: false, deckA: 'emberwood', deckB: 'skyward' });
    const g = run(s);
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: 'ai', human_a: true, human_b: false, deck_a: 'emberwood', deck_b: 'skyward', winner: g.winner, game_version: '1.0.2', content_hash: 'feedface', env: 'production', automated: false });
    expect(rows[0].duration_s).toBeGreaterThan(0);
    // a stray step after the end (a late network message) must not report it again
    s.step({ type: 'advance' }, g, g);
    await settle();
    expect(rows).toHaveLength(1);
  });

  it('records nothing when the player switched sharing off, or Supabase is not configured', async () => {
    const off = mk({ sharing: () => false });
    off.begin({ mode: 'ai', humanA: true, humanB: false, deckA: 'emberwood', deckB: 'skyward' });
    run(off);
    await settle();
    expect(rows).toHaveLength(0);
    const none = mk({ client: null });
    none.begin({ mode: 'ai', humanA: true, humanB: false, deckA: 'emberwood', deckB: 'skyward' });
    expect(() => run(none)).not.toThrow();
  });

  it('records nothing for a match that was left unfinished, or never begun', async () => {
    const s = mk();
    s.begin({ mode: 'ai', humanA: true, humanB: false, deckA: 'emberwood', deckB: 'skyward' });
    let steps = 0;
    run(s, 'emberwood', 'skyward', 2, () => { if (++steps === 5) s.stop(); });
    await settle();
    expect(rows).toHaveLength(0);
    run(mk(), 'emberwood', 'skyward', 3); // no begin()
    await settle();
    expect(rows).toHaveLength(0);
  });

  it('records an online forfeit for the player who stayed, once', async () => {
    const s = mk();
    s.begin({ mode: 'pvp', humanA: true, humanB: true, deckA: 'emberwood', deckB: 'skyward', matchKey: 'pvp-ABCD-7' });
    const g = createInitialState(7, deck('emberwood'), deck('skyward'), { mulligan: true });
    s.forfeit(g, 'B', 'disconnect');
    s.forfeit(g, 'B', 'disconnect');
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: 'pvp', match_key: 'pvp-ABCD-7', winner: 'B', end_reason: 'disconnect', human_a: true, human_b: true });
  });

  it('does not record a forfeit for a game that had already been decided', async () => {
    const s = mk();
    s.begin({ mode: 'pvp', humanA: true, humanB: true, deckA: 'emberwood', deckB: 'skyward' });
    const g = createInitialState(7, deck('emberwood'), deck('skyward'));
    g.winner = 'A';
    s.forfeit(g, 'B', 'forfeit');
    await settle();
    expect(rows).toHaveLength(0);
  });

  it('has no duration for a rejoined match, and keeps custom deck lists', async () => {
    const s = mk();
    s.begin({ mode: 'pvp', humanA: true, humanB: true, deckA: 'custom_x', deckB: 'skyward', customA: ['ashigaru'], rejoined: true });
    run(s, 'emberwood', 'skyward', 4);
    await settle();
    expect(rows[0].duration_s).toBeNull();
    expect(rows[0].custom_a).toEqual(['ashigaru']);
    expect(rows[0].custom_b).toBeNull();
  });

  it('never lets a failing network reach the game', async () => {
    const s = mk({ client: { from: () => ({ insert: async () => { throw new Error('offline'); } }) } });
    s.begin({ mode: 'ai', humanA: true, humanB: false, deckA: 'emberwood', deckB: 'skyward' });
    expect(() => run(s)).not.toThrow();
    await settle();
  });
});
