import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState } from '../types';
import { needsCreatureChoice } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { availableMana, castCost, legalActions } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4f2: Modal, X spells, Kicker and Ward, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `o${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function spell(extra: Partial<CardDef>, cost = 1, type: 'sorcery' | 'instant' = 'sorcery') {
  const id = `co_${n++}`;
  CARDS[id] = { id, name: 'Spell', type, cost, ...extra } as CardDef;
  return (owner: 'A' | 'B' = 'A') => inst(id, owner);
}
function creature(extra: Partial<CardDef> = {}) {
  const id = `co_${n++}`;
  CARDS[id] = { id, name: 'Body', type: 'creature', cost: 1, power: 2, toughness: 2, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => inst('aether_well', owner));
function base(landsA = 6): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; g.players[p].graveyard = []; }
  g.players.A.battlefield = lands(landsA);
  return g;
}
const untapped = (g: GameState) => availableMana(g.players.A);
const face = { kind: 'player', player: 'B' } as const;

describe('kicker', () => {
  const BOLT = { type: 'damage', amount: 2, targets: 'any' } as const;
  const K = { cost: 2, effect: { type: 'heal', amount: 3 } } as const;
  it('unkicked costs the base and does only the main effect; kicked pays the kicker and does both', () => {
    const sp = spell({ effect: BOLT, kicker: K })();
    const g = base();
    g.players.A.life = 10;
    g.players.A.hand = [sp];
    const plain = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face });
    expect(untapped(plain)).toBe(5);
    expect(plain.players.A.life).toBe(10);
    const kicked = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, kicked: true });
    expect(untapped(kicked)).toBe(3);
    expect(kicked.players.B.life).toBe(18);
    expect(kicked.players.A.life).toBe(13);
    expect(kicked.log.some((l) => /\(kicked\)/.test(l))).toBe(true);
  });
  it('is refused without the mana, and on a card with no kicker', () => {
    const sp = spell({ effect: BOLT, kicker: { cost: 5, effect: { type: 'draw', amount: 1 } } })();
    const g = base(3);
    g.players.A.hand = [sp];
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, kicked: true })).toThrow(/mana/);
    const plain = spell({ effect: BOLT })();
    g.players.A.hand = [plain];
    expect(() => applyAction(g, { type: 'castSorcery', iid: plain.iid, target: face, kicked: true })).toThrow(/kicker/);
  });
  it('legalActions offers both versions when the kicker is affordable, only the plain one otherwise', () => {
    const sp = spell({ effect: { type: 'draw', amount: 1 }, kicker: { cost: 2, effect: { type: 'heal', amount: 2 } } })();
    const g = base(2);
    g.players.A.hand = [sp];
    const cast = (s: GameState) => legalActions(s, 'A').filter((a) => a.type === 'castSorcery');
    expect(cast(g)).toHaveLength(1); // 2 lands: base 1, kicked 3
    const g2 = base(4);
    g2.players.A.hand = [sp];
    expect(cast(g2)).toHaveLength(2);
  });
  it('the AI pays the kicker when it can', () => {
    const sp = spell({ effect: { type: 'draw', amount: 1 }, kicker: { cost: 1, effect: { type: 'heal', amount: 2 } } })();
    const g = base(4);
    g.players.A.hand = [sp];
    expect(pickAction(g, 'A')).toMatchObject({ type: 'castSorcery', kicked: true });
  });
});

describe('X spells', () => {
  const XB = { type: 'damage', amount: 1, targets: 'any' } as const;
  it('deals X, and costs the base plus X', () => {
    const sp = spell({ effect: XB, x: true }, 1)();
    const g = base();
    g.players.A.hand = [sp];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, x: 4 });
    expect(a.players.B.life).toBe(16);
    expect(untapped(a)).toBe(6 - 5);
    expect(a.log.some((l) => /X=4/.test(l))).toBe(true);
  });
  it('an amount per X multiplies, X is required, and too big an X is refused', () => {
    const sp = spell({ effect: { type: 'damage', amount: 2, targets: 'any' }, x: true }, 0)();
    const g = base(5);
    g.players.A.hand = [sp];
    expect(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, x: 3 }).players.B.life).toBe(14);
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face })).toThrow(/X/);
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, x: 6 })).toThrow(/mana/);
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, x: -1 })).toThrow();
    const plain = spell({ effect: XB })();
    g.players.A.hand = [plain];
    expect(() => applyAction(g, { type: 'castSorcery', iid: plain.iid, target: face, x: 2 })).toThrow(/no X/);
  });
  it('works for draw and heal, and legalActions offers X from 1 up to what the mana allows', () => {
    const dr = spell({ effect: { type: 'draw', amount: 1 }, x: true }, 1)();
    const g = base(4);
    g.players.A.hand = [dr];
    const xs = legalActions(g, 'A').filter((a) => a.type === 'castSorcery').map((a) => (a as { x?: number }).x);
    expect(xs).toEqual([1, 2, 3]);
    const handBefore = g.players.A.hand.length;
    const a = applyAction(g, { type: 'castSorcery', iid: dr.iid, x: 3 });
    expect(a.players.A.hand.length).toBe(handBefore - 1 + 3);
  });
  it('the AI finishes the game with the smallest X that is lethal, and otherwise holds the burn', () => {
    const sp = spell({ effect: XB, x: true }, 0)();
    const g = base(6);
    g.players.B.life = 4;
    g.players.A.hand = [sp];
    expect(pickAction(g, 'A')).toMatchObject({ type: 'castSorcery', x: 4, target: face });
    g.players.B.life = 20;
    expect(pickAction(g, 'A').type).toBe('advance');
  });
});

describe('modal spells', () => {
  const MODES = [{ type: 'damage', amount: 3, targets: 'any' }, { type: 'draw', amount: 2 }] as CardDef['modes'];
  it('resolves only the chosen mode, and each mode needs its own kind of target', () => {
    const sp = spell({ effect: MODES![0], modes: MODES })();
    const g = base();
    g.players.A.hand = [sp];
    const burn = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, mode: 0 });
    expect(burn.players.B.life).toBe(17);
    const handBefore = g.players.A.hand.length;
    const draw = applyAction(g, { type: 'castSorcery', iid: sp.iid, mode: 1 });
    expect(draw.players.B.life).toBe(20);
    expect(draw.players.A.hand.length).toBe(handBefore - 1 + 2);
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, mode: 0 })).toThrow(/target/);
  });
  it('a missing mode means the first (so old saved casts still replay), and a mode that does not exist is refused', () => {
    const sp = spell({ effect: MODES![0], modes: MODES })();
    const g = base();
    g.players.A.hand = [sp];
    expect(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face }).players.B.life).toBe(17);
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, mode: 2 })).toThrow(/mode/);
    const plain = spell({ effect: MODES![0] })();
    g.players.A.hand = [plain];
    expect(() => applyAction(g, { type: 'castSorcery', iid: plain.iid, target: face, mode: 0 })).toThrow(/mode/);
  });
  it('legalActions lists every mode (with its targets)', () => {
    const sp = spell({ effect: MODES![0], modes: MODES })();
    const g = base();
    g.players.A.hand = [sp];
    const acts = legalActions(g, 'A').filter((a) => a.type === 'castSorcery') as { mode?: number; target?: unknown }[];
    expect(acts.filter((a) => a.mode === 0)).toHaveLength(2); // either player
    expect(acts.filter((a) => a.mode === 1)).toHaveLength(1);
  });
});

describe('ward', () => {
  const KILL = { type: 'damage', amount: 9, targets: 'creature' } as const;
  it('a spell that targets an opposing ward creature costs its ward more, and a plain creature or your own costs nothing extra', () => {
    const w = creature({ ward: 2 })('B');
    const plain = creature()('B');
    const mine = creature({ ward: 2 })('A');
    const sp = spell({ effect: KILL }, 1)();
    const g = base();
    g.players.B.battlefield = [w, plain];
    g.players.A.battlefield.push(mine);
    g.players.A.hand = [sp];
    const t = (iid: string) => ({ kind: 'creature', iid } as const);
    expect(untapped(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: t(w.iid) }))).toBe(6 - 3);
    expect(untapped(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: t(plain.iid) }))).toBe(6 - 1);
    expect(untapped(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: t(mine.iid) }))).toBe(6 - 1);
    expect(castCost(g, 'A', CARDS[sp.def], { target: t(w.iid) })).toBe(3);
  });
  it('is refused without the mana and left out of legalActions', () => {
    const w = creature({ ward: 3 })('B');
    const sp = spell({ effect: KILL }, 1)();
    const g = base(3);
    g.players.B.battlefield = [w];
    g.players.A.hand = [sp];
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: w.iid } })).toThrow(/mana/);
    expect(legalActions(g, 'A').some((a) => a.type === 'castSorcery' && a.target?.kind === 'creature')).toBe(false);
  });
  it('does not tax a spell aimed at the player, and stacks with X and kicker', () => {
    const w = creature({ ward: 1 })('B');
    const sp = spell({ effect: { type: 'damage', amount: 1, targets: 'any' }, x: true }, 0)();
    const g = base();
    g.players.B.battlefield = [w];
    g.players.A.hand = [sp];
    expect(untapped(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: face, x: 2 }))).toBe(6 - 2);
    expect(untapped(applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: w.iid }, x: 2 }))).toBe(6 - 3);
  });
});

describe('card data', () => {
  it('real cards use the options consistently', () => {
    for (const d of Object.values(CARDS)) {
      if (d.id.startsWith('co_') || /^(ch|trig2|kwtest|kw2test|act|stat)_/.test(d.id)) continue;
      if (d.modes) {
        expect(d.modes.length, `${d.id}: a modal spell has at least two modes`).toBeGreaterThanOrEqual(2);
        expect(d.effect, `${d.id}: effect must be modes[0]`).toEqual(d.modes[0]);
      }
      if (d.x) {
        const e = d.effect!;
        expect(['damage', 'heal', 'draw'], `${d.id}: an X spell scales damage, heal or draw`).toContain(e.type);
      }
      if (d.kicker) expect(needsCreatureChoice(d.kicker.effect), `${d.id}: a kicker effect needs no choice (damage only at the player)`).toBe(false);
      if (d.flashback !== undefined) expect(!!(d.x || d.kicker || d.modes), `${d.id}: flashback takes no cast options`).toBe(false);
      if (d.ward !== undefined) expect(d.type, `${d.id}: only creatures have ward`).toBe('creature');
      if (d.x || d.kicker || d.modes) expect(['sorcery', 'instant'], `${d.id}: cast options are for spells`).toContain(d.type);
    }
  });
});
