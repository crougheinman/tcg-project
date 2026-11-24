import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState, StaticAbility } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { power, toughness, THRESHOLD } from '../rules';

// Phase 4d: static abilities as data (Beast Blitz, Lords, Threshold), on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `s${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}) {
  const id = `stat_${n++}`;
  CARDS[id] = { id, name: `S${p}/${t}`, type: 'creature', cost: 1, power: p, toughness: t, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lord = (st: StaticAbility, p = 1, t = 1) => creature(p, t, { static: st });
/** Any action makes the engine settle statics; playing a land is the cheapest one. */
function poke(g: GameState): GameState {
  const land = inst('aether_well', g.active);
  g.players[g.active].hand.push(land);
  g.players[g.active].landPlayedThisTurn = false;
  return applyAction(g, { type: 'playLand', iid: land.iid });
}
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) {
    g.players[p].battlefield = [];
    g.players[p].hand = [];
    g.players[p].graveyard = [];
  }
  return g;
}
const find = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((c) => c.iid === iid)!;
const fodder = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => inst('aether_well', owner));

describe('lords (others)', () => {
  const L = { affects: { others: true }, power: 1, toughness: 1 };
  it('lifts every other creature of its controller, not itself and not the opponent', () => {
    const g = base();
    const l = lord(L)();
    const mine = creature(2, 2)();
    const theirs = creature(2, 2)('B');
    g.players.A.battlefield = [l, mine];
    g.players.B.battlefield = [theirs];
    const a = poke(g);
    expect([power(find(a, l.iid)), toughness(find(a, l.iid))]).toEqual([1, 1]);
    expect([power(find(a, mine.iid)), toughness(find(a, mine.iid))]).toEqual([3, 3]);
    expect([power(find(a, theirs.iid)), toughness(find(a, theirs.iid))]).toEqual([2, 2]);
  });
  it('stacks across two lords, and is idempotent over repeated actions', () => {
    const g = base();
    const mine = creature(2, 2)();
    g.players.A.battlefield = [lord(L)(), lord(L)(), mine];
    let a = poke(g);
    expect(power(find(a, mine.iid))).toBe(4);
    a = poke(a);
    a = poke(a);
    expect(power(find(a, mine.iid))).toBe(4);
    expect(toughness(find(a, mine.iid))).toBe(4);
  });
  it('the bonus is separate from permanent buffs and ends with the lord', () => {
    const g = base();
    const l = lord(L)();
    const mine = creature(2, 3)('A', { buffP: 1, buffT: 1 });
    g.players.A.battlefield = [l, mine];
    let a = poke(g);
    expect(power(find(a, mine.iid))).toBe(4);
    a.players.A.battlefield = a.players.A.battlefield.filter((c) => c.iid !== l.iid); // the lord leaves
    a = poke(a);
    expect([power(find(a, mine.iid)), toughness(find(a, mine.iid))]).toEqual([3, 4]); // the +1/+1 buff stays
  });
  it('a lord dying kills the creature its toughness was keeping alive', () => {
    const g = base();
    const l = lord(L)('A', { damage: 1 }); // 1/1 with 1 damage: dead at the next check
    const mine = creature(1, 1)('A', { damage: 1 }); // 1/1 +1/+1 = 2/2 with 1 damage: survives only while the lord lives
    g.players.A.battlefield = [l, mine];
    const a = poke(g);
    expect(a.players.A.battlefield.some((c) => c.iid === l.iid)).toBe(false);
    expect(a.players.A.battlefield.some((c) => c.iid === mine.iid)).toBe(false);
    expect(a.players.A.graveyard).toHaveLength(2);
  });
  it('a lord that leaves by bounce takes its bonus away at once', () => {
    const g = base();
    const l = lord(L)();
    const mine = creature(2, 2)();
    g.players.A.battlefield = [l, mine];
    CARDS.stat_bounce = { id: 'stat_bounce', name: 'Bounce', type: 'sorcery', cost: 0, effect: { type: 'bounce' } };
    const spellCard = inst('stat_bounce');
    g.players.A.hand = [spellCard];
    const a = applyAction(g, { type: 'castSorcery', iid: spellCard.iid, target: { kind: 'creature', iid: l.iid } });
    expect(power(find(a, mine.iid))).toBe(2);
    expect(find(a, mine.iid).auraP ?? 0).toBe(0);
  });
});

describe('lords (by id) and self', () => {
  it('only lifts the listed card ids', () => {
    const g = base();
    const pup = creature(1, 1)();
    const other = creature(1, 1)();
    const pupId = pup.def;
    const l = lord({ affects: { ids: [pupId] }, power: 2, toughness: 0 })();
    g.players.A.battlefield = [l, pup, other];
    const a = poke(g);
    expect(power(find(a, pup.iid))).toBe(3);
    expect(power(find(a, other.iid))).toBe(1);
    expect(toughness(find(a, pup.iid))).toBe(1);
  });
  it('self applies to the source alone', () => {
    const g = base();
    const l = lord({ affects: { self: true }, power: 1, toughness: 1 })();
    const other = creature(1, 1)();
    g.players.A.battlefield = [l, other];
    const a = poke(g);
    expect(power(find(a, l.iid))).toBe(2);
    expect(power(find(a, other.iid))).toBe(1);
  });
});

describe('threshold', () => {
  const T: StaticAbility = { affects: { self: true }, power: 2, toughness: 2, when: 'threshold' };
  it(`switches on at ${THRESHOLD} cards in the controller's own graveyard and off again below it`, () => {
    const g = base();
    const t = creature(1, 1, { static: T })();
    g.players.A.battlefield = [t];
    g.players.A.graveyard = fodder(THRESHOLD - 1);
    let a = poke(g);
    expect(power(find(a, t.iid))).toBe(1);
    a.players.A.graveyard.push(inst('aether_well'));
    a = poke(a);
    expect([power(find(a, t.iid)), toughness(find(a, t.iid))]).toEqual([3, 3]);
    a.players.A.graveyard.pop();
    a = poke(a);
    expect(power(find(a, t.iid))).toBe(1);
  });
  it("ignores the opponent's graveyard", () => {
    const g = base();
    const t = creature(1, 1, { static: T })();
    g.players.A.battlefield = [t];
    g.players.B.graveyard = fodder(THRESHOLD + 3, 'B');
    expect(power(find(poke(g), t.iid))).toBe(1);
  });
  it('losing the toughness it gave can kill the creature when the graveyard shrinks', () => {
    const g = base();
    const t = creature(1, 1, { static: T })('A', { damage: 2 }); // 3/3 with 2 damage while on
    g.players.A.battlefield = [t];
    g.players.A.graveyard = fodder(THRESHOLD);
    let a = poke(g);
    expect(a.players.A.battlefield.some((c) => c.iid === t.iid)).toBe(true);
    a.players.A.graveyard = [];
    a = poke(a);
    expect(a.players.A.battlefield.some((c) => c.iid === t.iid)).toBe(false);
  });
});

describe('Beast Blitz as data', () => {
  it('Kunoichi carries it, marks the creatures it lifts and leaves a log line when she falls', () => {
    const g = base();
    const k = inst('kunoichi');
    const wolf = inst('wolf_token');
    const plain = inst('ember_sprite');
    g.players.A.battlefield = [k, wolf, plain];
    let a = poke(g);
    expect(find(a, wolf.iid).blitz).toBe(true);
    expect(find(a, plain.iid).blitz).toBe(false);
    expect(find(a, wolf.iid).buffP).toBe(0); // the aura is not a permanent buff
    expect(power(find(a, wolf.iid))).toBe(power({ ...find(a, wolf.iid), auraP: 0 }) + 1);
    find(a, k.iid).damage = 5;
    a = poke(a);
    expect(find(a, wolf.iid).blitz).toBe(false);
    expect(a.log.some((l) => /Beast Blitz fades/.test(l))).toBe(true);
  });
  it('a second Kunoichi adds nothing (unique), while two lords do stack', () => {
    const g = base();
    const wolf = inst('wolf_token');
    g.players.A.battlefield = [inst('kunoichi'), inst('kunoichi'), wolf];
    const a = poke(g);
    expect(power(find(a, wolf.iid))).toBe(CARDS.wolf_token.power! + 1);
  });
  it('stacks with a lord', () => {
    const g = base();
    const wolf = inst('wolf_token');
    g.players.A.battlefield = [inst('kunoichi'), lord({ affects: { others: true }, power: 1, toughness: 0 })(), wolf];
    const a = poke(g);
    expect(power(find(a, wolf.iid))).toBe(CARDS.wolf_token.power! + 1 + 1);
  });
});
