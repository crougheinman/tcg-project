import { describe, expect, it } from 'vitest';
import { prune, tapAttacker, tapBlocker, liveAttackers, type BlockSel } from '../blockSelection';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { Action, CardInstance, GameState } from '../../engine/types';

let n = 0;
const inst = (def: string, over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `b${n++}_${def}`, def, owner: 'A', tapped: false, summoningSick: false,
  damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});

/** A's creatures all attack; B (the defender / "you") is in the block step. */
function blockStep(attackers: string[], defenders: string[], hand: string[] = []) {
  const s = createInitialState(5, DECK_EMBERWOOD, DECK_SKYWARD);
  const atk = attackers.map((d) => inst(d));
  const def = defenders.map((d) => inst(d, { owner: 'B' }));
  s.players.A.battlefield = atk;
  s.players.B.battlefield = [inst('aether_well', { owner: 'B' }), inst('aether_well', { owner: 'B' }), ...def];
  s.players.B.hand = hand.map((d) => inst(d, { owner: 'B' }));
  let g = applyAction(s, { type: 'advance' });
  g = applyAction(g, { type: 'declareAttackers', attackers: atk.map((c) => c.iid) });
  return { g, atk, def };
}
const empty: BlockSel = { blocks: {}, pending: null };

describe('one attacker', () => {
  it('a tap assigns the blocker at once, and a second tap takes it back', () => {
    const { g, atk, def } = blockStep(['dread_maw'], ['stoneback_cub']);
    const a = tapBlocker(empty, g, def[0].iid);
    expect(a.sel).toEqual({ blocks: { [def[0].iid]: atk[0].iid }, pending: null });
    const b = tapBlocker(a.sel, g, def[0].iid);
    expect(b.sel).toEqual(empty);
  });

  it('refuses a ground blocker against a flyer, and says why', () => {
    const { g, def } = blockStep(['sky_talon'], ['stoneback_cub']);
    const r = tapBlocker(empty, g, def[0].iid);
    expect(r.sel).toEqual(empty); // not assigned and not left half-selected
    expect(r.hint).toMatch(/Stoneback Cub can't block Sky Talon — only flyers or reach creatures can block a flyer/);
  });

  it('lets a flyer block a flyer', () => {
    const { g, atk, def } = blockStep(['storm_drake'], ['sky_talon']);
    expect(tapBlocker(empty, g, def[0].iid).sel.blocks).toEqual({ [def[0].iid]: atk[0].iid });
  });

  it('one blocker per attacker: a second blocker is refused', () => {
    const { g, def } = blockStep(['dread_maw'], ['stoneback_cub', 'granite_sentinel']);
    const first = tapBlocker(empty, g, def[0].iid).sel;
    const second = tapBlocker(first, g, def[1].iid);
    expect(second.sel).toEqual(first);
    expect(second.hint).toMatch(/already blocked/);
  });

  it('a tapped creature is not selectable', () => {
    const { g, def } = blockStep(['dread_maw'], ['stoneback_cub']);
    g.players.B.battlefield.find((c) => c.iid === def[0].iid)!.tapped = true;
    expect(tapBlocker(empty, g, def[0].iid)).toEqual({ sel: empty });
  });
});

describe('several attackers', () => {
  it('tap marks pending; tapping the pending blocker again cancels (as the hint promises)', () => {
    const { g, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub']);
    const p = tapBlocker(empty, g, def[0].iid).sel;
    expect(p).toEqual({ blocks: {}, pending: def[0].iid });
    expect(tapBlocker(p, g, def[0].iid).sel).toEqual(empty);
  });

  it('pending + attacker assigns; tapping the assigned blocker removes just that block', () => {
    const { g, atk, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub', 'granite_sentinel']);
    let sel = tapBlocker(empty, g, def[0].iid).sel;
    sel = tapAttacker(sel, g, atk[0].iid).sel;
    sel = tapBlocker(sel, g, def[1].iid).sel;
    sel = tapAttacker(sel, g, atk[1].iid).sel;
    expect(sel.blocks).toEqual({ [def[0].iid]: atk[0].iid, [def[1].iid]: atk[1].iid });
    sel = tapBlocker(sel, g, def[0].iid).sel; // the old UI could never undo this
    expect(sel).toEqual({ blocks: { [def[1].iid]: atk[1].iid }, pending: null });
  });

  it('a pending ground blocker cannot be pointed at a flyer; it stays pending to try another', () => {
    const { g, atk, def } = blockStep(['sky_talon', 'dread_maw'], ['stoneback_cub']);
    const p = tapBlocker(empty, g, def[0].iid).sel;
    const bad = tapAttacker(p, g, atk[0].iid);
    expect(bad.sel).toEqual(p);
    expect(bad.hint).toMatch(/only flyers or reach creatures can block a flyer/);
    expect(tapAttacker(bad.sel, g, atk[1].iid).sel.blocks).toEqual({ [def[0].iid]: atk[1].iid });
  });

  it('refuses a second blocker on the same attacker, naming how to fix it', () => {
    const { g, atk, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub', 'granite_sentinel']);
    let sel = tapAttacker(tapBlocker(empty, g, def[0].iid).sel, g, atk[0].iid).sel;
    sel = tapBlocker(sel, g, def[1].iid).sel;
    const r = tapAttacker(sel, g, atk[0].iid);
    expect(r.sel).toEqual(sel);
    expect(r.hint).toMatch(/already blocked/);
  });

  it("does not start a selection for a blocker that can't block any attacker", () => {
    const { g, def } = blockStep(['sky_talon', 'storm_drake'], ['stoneback_cub']);
    const r = tapBlocker(empty, g, def[0].iid);
    expect(r.sel).toEqual(empty);
    expect(r.hint).toMatch(/can't block any of these attackers/);
  });

  it('tapping an attacker with nothing pending does nothing', () => {
    const { g, atk } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub']);
    expect(tapAttacker(empty, g, atk[0].iid)).toEqual({ sel: empty });
  });
});

describe('pruning stale plans', () => {
  it('drops a block when its attacker is killed mid-step, and reports it', () => {
    const { g, atk, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub'], ['take_counter']);
    const sel = tapAttacker(tapBlocker(empty, g, def[0].iid).sel, g, atk[0].iid).sel;
    const tc = g.players.B.hand[0];
    const after = applyAction(g, { type: 'castSorcery', iid: tc.iid, target: { kind: 'creature', iid: atk[0].iid } });
    const r = prune(sel, after);
    expect(r.dropped).toBe(1);
    expect(r.sel).toEqual(empty);
  });

  it('keeps the blocks that are still valid', () => {
    const { g, atk, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub', 'granite_sentinel'], ['take_counter']);
    let sel = tapAttacker(tapBlocker(empty, g, def[0].iid).sel, g, atk[0].iid).sel;
    sel = tapAttacker(tapBlocker(sel, g, def[1].iid).sel, g, atk[1].iid).sel;
    const after = applyAction(g, { type: 'castSorcery', iid: g.players.B.hand[0].iid, target: { kind: 'creature', iid: atk[0].iid } });
    const r = prune(sel, after);
    expect(r.sel.blocks).toEqual({ [def[1].iid]: atk[1].iid });
    expect(r.dropped).toBe(1);
  });

  it('returns the SAME object when nothing changed (safe to run from an effect)', () => {
    const { g, atk, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub']);
    const sel = tapAttacker(tapBlocker(empty, g, def[0].iid).sel, g, atk[0].iid).sel;
    expect(prune(sel, g).sel).toBe(sel);
    expect(prune(empty, g).sel).toBe(empty);
  });

  it('clears a pending blocker that has left play', () => {
    const { g, def } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub']);
    const sel = tapBlocker(empty, g, def[0].iid).sel;
    const gone: GameState = structuredClone(g);
    gone.players.B.battlefield = gone.players.B.battlefield.filter((c) => c.iid !== def[0].iid);
    expect(prune(sel, gone).sel.pending).toBeNull();
  });

  it('liveAttackers omits a dead attacker', () => {
    const { g, atk } = blockStep(['dread_maw', 'ember_sprite'], ['stoneback_cub']);
    expect(liveAttackers(g).map((c) => c.iid)).toEqual(atk.map((c) => c.iid));
  });
});

describe('the guarantee: taps can never produce a block the engine rejects', () => {
  // Deterministic random play over many block steps. Whatever sequence of taps (and
  // mid-step removals) happens, Confirm must be acceptable to the reducer.
  const rngOf = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const A = ['dread_maw', 'ember_sprite', 'sky_talon', 'storm_drake', 'stoneback_cub', 'swift_lancer'];
  const B = ['stoneback_cub', 'granite_sentinel', 'sky_talon', 'bulwark', 'kunoichi'];

  it('holds over 400 random block steps with random taps and a kill mid-way', () => {
    let confirmed = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = rngOf(seed * 97);
      const pick = (list: string[], k: number) => [...list].sort(() => r() - 0.5).slice(0, k);
      let { g } = blockStep(pick(A, 1 + Math.floor(r() * 3)), pick(B, 1 + Math.floor(r() * 3)), ['take_counter']);
      let sel: BlockSel = empty;
      for (let step = 0; step < 14; step++) {
        const mine = g.players.B.battlefield.filter((c) => c.def !== 'aether_well');
        const atks = liveAttackers(g);
        // Take Counter destroys a TAPPED creature, and a vigilant attacker stays untapped.
        const tappedAtks = atks.filter((a) => a.tapped);
        if (r() < 0.12 && g.players.B.hand.length && tappedAtks.length) {
          const tc = g.players.B.hand[0];
          const victim = tappedAtks[Math.floor(r() * tappedAtks.length)];
          g = applyAction(g, { type: 'castSorcery', iid: tc.iid, target: { kind: 'creature', iid: victim.iid } });
          sel = prune(sel, g).sel; // exactly what Board's effect does
          continue;
        }
        const pool = r() < 0.5 ? mine : atks;
        if (!pool.length) continue;
        const tap = pool[Math.floor(r() * pool.length)];
        sel = (mine.includes(tap) ? tapBlocker(sel, g, tap.iid) : tapAttacker(sel, g, tap.iid)).sel;
      }
      const act: Action = { type: 'declareBlockers', blocks: sel.blocks };
      expect(() => applyAction(g, act), `seed ${seed}`).not.toThrow();
      confirmed++;
    }
    expect(confirmed).toBe(400);
  });
});
