import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { ActivatedAbility, CardDef, CardInstance, GameState } from '../types';
import { needsTarget } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { availableMana, legalActions, activateError } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4e: activated abilities ({T}: / {N},{T}: untargeted effects, mana abilities and the mana pool), on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `a${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(activated: ActivatedAbility, extra: Partial<CardDef> = {}) {
  const id = `act_${n++}`;
  CARDS[id] = { id, name: 'Actor', type: 'creature', cost: 1, power: 1, toughness: 1, activated, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lands = (k: number, owner: 'A' | 'B' = 'A', tapped = false) => Array.from({ length: k }, () => inst('aether_well', owner, { tapped }));
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; }
  return g;
}
const MANA: ActivatedAbility = { cost: { tap: true }, effect: { type: 'mana', amount: 1 } };
const PING: ActivatedAbility = { cost: { tap: true }, effect: { type: 'damage', amount: 1, targets: 'player' } };
const act = (g: GameState, c: CardInstance) => applyAction(g, { type: 'activate', iid: c.iid });
const mine = (g: GameState, iid: string) => g.players.A.battlefield.find((c) => c.iid === iid)!;

describe('activate: costs and timing', () => {
  it('a tap ability taps the creature and resolves its effect; it cannot be used again', () => {
    const g = base();
    const c = creature(PING)();
    g.players.A.battlefield = [c];
    const a = act(g, c);
    expect(a.players.B.life).toBe(19);
    expect(mine(a, c.iid).tapped).toBe(true);
    expect(() => act(a, mine(a, c.iid))).toThrow(/tapped/);
  });
  it('a summoning-sick creature cannot use a tap ability (and a mana-only ability needs no tap)', () => {
    const g = base();
    const c = creature(PING)('A', { summoningSick: true });
    const free = creature({ cost: {}, effect: { type: 'heal', amount: 2 } })('A', { summoningSick: true });
    g.players.A.battlefield = [c, free];
    expect(() => act(g, c)).toThrow(/summoning sick/);
    g.players.A.life = 10;
    expect(act(g, free).players.A.life).toBe(12);
  });
  it('a mana cost is paid from the lands, and refused without enough', () => {
    const g = base();
    const c = creature({ cost: { tap: true, mana: 2 }, effect: { type: 'draw', amount: 1 } })();
    g.players.A.battlefield = [c, ...lands(1)];
    expect(() => act(g, c)).toThrow(/mana/);
    g.players.A.battlefield.push(...lands(2));
    const handBefore = g.players.A.hand.length;
    const a = act(g, c);
    expect(availableMana(a.players.A)).toBe(1);
    expect(a.players.A.hand.length).toBe(handBefore + 1);
  });
  it('is main-phase only, for your own creatures only, and not while a decision is pending', () => {
    const g = base();
    const c = creature(PING)();
    const theirs = creature(PING)('B');
    g.players.A.battlefield = [c];
    g.players.B.battlefield = [theirs];
    expect(() => act(g, theirs)).toThrow();
    const atk = { ...g, phase: 'combat_attack' as const, combat: { attackers: [], blocks: {} } };
    expect(() => act(atk, c)).toThrow();
    expect(activateError(atk, atk.players.A, c)).toMatch(/main phase/);
  });
  it('is not a cast: no spell count, no prowess', () => {
    const g = base();
    const c = creature(PING)();
    const prowess = creature(PING, { keywords: ['prowess'] })();
    g.players.A.battlefield = [c, prowess];
    const a = act(g, c);
    expect(a.spellsThisTurn?.A ?? 0).toBe(0);
    expect(mine(a, prowess.iid).tempP ?? 0).toBe(0);
  });
  it('legalActions offers it only when it can be used', () => {
    const g = base();
    const c = creature(PING)();
    g.players.A.battlefield = [c];
    const has = (s: GameState) => legalActions(s, 'A').some((x) => x.type === 'activate');
    expect(has(g)).toBe(true);
    expect(has(act(g, c))).toBe(false);
    g.players.A.battlefield = [creature(PING)('A', { summoningSick: true })];
    expect(has(g)).toBe(false);
  });
});

describe('mana abilities and the pool', () => {
  it('adds floating mana that pays for a spell one more than the lands allow', () => {
    const g = base();
    const dork = creature(MANA)();
    const three = creature({ cost: {}, effect: { type: 'heal', amount: 1 } }, { cost: 3 })();
    g.players.A.battlefield = [dork, ...lands(2)];
    g.players.A.hand = [three];
    expect(legalActions(g, 'A').some((x) => x.type === 'castCreature')).toBe(false);
    const a = act(g, dork);
    expect(availableMana(a.players.A)).toBe(3);
    const b = applyAction(a, { type: 'castCreature', iid: three.iid });
    expect(b.players.A.battlefield.some((c) => c.iid === three.iid)).toBe(true);
    expect(availableMana(b.players.A)).toBe(0);
  });
  it('the pool is spent before lands, so lands stay untapped', () => {
    const g = base();
    const dork = creature(MANA)();
    const one = creature({ cost: {}, effect: { type: 'heal', amount: 1 } }, { cost: 1 })();
    g.players.A.battlefield = [dork, ...lands(2)];
    g.players.A.hand = [one];
    const b = applyAction(act(g, dork), { type: 'castCreature', iid: one.iid });
    expect(b.players.A.battlefield.filter((c) => c.def === 'aether_well' && !c.tapped)).toHaveLength(2);
    expect(b.players.A.pool).toBe(0);
  });
  it('floating mana empties when the phase changes', () => {
    const g = base();
    const dork = creature(MANA)();
    g.players.A.battlefield = [dork];
    const a = act(g, dork);
    expect(a.players.A.pool).toBe(1);
    const b = applyAction(a, { type: 'advance' });
    expect(b.players.A.pool).toBe(0);
    expect(availableMana(b.players.A)).toBe(0);
  });
  it('two mana creatures add up', () => {
    const g = base();
    const a1 = creature(MANA)(), a2 = creature(MANA)();
    g.players.A.battlefield = [a1, a2];
    expect(availableMana(act(act(g, a1), a2).players.A)).toBe(2);
  });
});

describe('the AI', () => {
  const castable = (cost: number) => creature({ cost: {}, effect: { type: 'heal', amount: 1 } }, { cost })();
  it('taps a mana creature only when the mana lets it cast something it otherwise could not', () => {
    const g = base();
    const dork = creature(MANA)();
    g.players.A.battlefield = [dork, ...lands(2)];
    g.players.A.hand = [castable(3)];
    expect(pickAction(g, 'A')).toEqual({ type: 'activate', iid: dork.iid });
    g.players.A.hand = [castable(2)]; // affordable already: keep the creature free
    expect(pickAction(g, 'A').type).toBe('castCreature');
    g.players.A.hand = [castable(5)]; // out of reach even with the mana creature
    expect(pickAction(g, 'A').type).not.toBe('activate');
  });
  it('uses a 1-power pinger every turn but keeps a real attacker attacking', () => {
    const g = base();
    const pinger = creature(PING)();
    g.players.A.battlefield = [pinger];
    expect(pickAction(g, 'A')).toEqual({ type: 'activate', iid: pinger.iid });
    const bruiser = creature(PING, { power: 3, toughness: 3 })();
    g.players.A.battlefield = [bruiser];
    expect(pickAction(g, 'A').type).toBe('advance');
  });
  it('never gets stuck: after using every ability it moves on', () => {
    let g = base();
    g.players.A.battlefield = [creature(PING)(), creature(MANA)(), creature(PING)()];
    for (let i = 0; i < 6 && g.phase === 'main1'; i++) g = applyAction(g, pickAction(g, 'A'));
    expect(g.phase).not.toBe('main1');
  });
});

describe('card data', () => {
  it('every real activated ability uses an untargeted effect', () => {
    for (const def of Object.values(CARDS)) {
      if (!def.activated || def.id.startsWith('act_')) continue;
      expect(needsTarget(def.activated.effect), `${def.id}: an activated ability may not need a target`).toBe(false);
      expect(def.type, `${def.id}: only creatures have abilities`).toBe('creature');
      expect(def.activated.cost.tap || def.activated.cost.mana, `${def.id}: an ability must cost something (tap or mana) or it repeats without limit`).toBeTruthy();
      if (def.activated.effect.type === 'mana') expect(def.activated.cost.tap, `${def.id}: a mana ability must tap, or it makes unlimited mana`).toBe(true);
    }
  });
});
