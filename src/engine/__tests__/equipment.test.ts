import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { availableMana, hasKeyword, legalActions, power, toughness } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4i: Equipment, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `q${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}, kws: Keyword[] = []) {
  const id = `eqc_${n++}`;
  CARDS[id] = { id, name: `Q${p}/${t}`, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
function gear(cost: number, equip: NonNullable<CardDef['equip']>) {
  const id = `eqg_${n++}`;
  CARDS[id] = { id, name: `Gear${equip.power}/${equip.toughness}`, type: 'equipment', cost, equip };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lands = (k: number) => Array.from({ length: k }, () => inst('aether_well'));
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; g.players[p].graveyard = []; g.players[p].exile = []; }
  return g;
}
const poke = (g: GameState) => { const l = inst('aether_well', g.active); g.players[g.active].hand.push(l); g.players[g.active].landPlayedThisTurn = false; return applyAction(g, { type: 'playLand', iid: l.iid }); };
const find = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((c) => c.iid === iid);

describe('casting and equipping', () => {
  it('an equipment is cast from hand onto the battlefield unattached, counting as a spell', () => {
    const g = base();
    const e = gear(2, { cost: 1, power: 2, toughness: 1 })('A');
    g.players.A.battlefield = lands(3);
    g.players.A.hand = [e];
    const a = applyAction(g, { type: 'castEquipment', iid: e.iid });
    expect(find(a, e.iid)).toBeTruthy();
    expect(find(a, e.iid)!.attachedTo).toBeUndefined();
    expect(availableMana(a.players.A)).toBe(1);
    expect(a.spellsThisTurn?.A).toBe(1);
    expect(a.players.A.graveyard).toHaveLength(0);
  });
  it('equip pays the equip cost and gives the creature its bonus; the printed stats are untouched', () => {
    const g = base();
    const c = creature(2, 2)('A');
    const e = gear(2, { cost: 1, power: 2, toughness: 1 })('A');
    g.players.A.battlefield = [c, e, ...lands(2)];
    const a = applyAction(g, { type: 'equip', equipment: e.iid, creature: c.iid });
    expect(find(a, e.iid)!.attachedTo).toBe(c.iid);
    expect([power(find(a, c.iid)!), toughness(find(a, c.iid)!)]).toEqual([4, 3]);
    expect(availableMana(a.players.A)).toBe(1);
    expect(a.log.some((l) => /equipped to/.test(l))).toBe(true);
  });
  it('is main-phase only, needs the mana, and only your own creature and equipment', () => {
    const g = base();
    const c = creature(2, 2)('A'), theirs = creature(2, 2)('B');
    const e = gear(2, { cost: 2, power: 1, toughness: 1 })('A');
    g.players.A.battlefield = [c, e, ...lands(1)];
    g.players.B.battlefield = [theirs];
    expect(() => applyAction(g, { type: 'equip', equipment: e.iid, creature: c.iid })).toThrow(/legal equip/);
    g.players.A.battlefield.push(...lands(2));
    expect(() => applyAction(g, { type: 'equip', equipment: e.iid, creature: theirs.iid })).toThrow();
    expect(() => applyAction({ ...g, phase: 'combat_attack', combat: { attackers: [], blocks: {} } }, { type: 'equip', equipment: e.iid, creature: c.iid })).toThrow();
    const cast = gear(5, { cost: 1, power: 1, toughness: 1 })('A');
    g.players.A.hand = [cast];
    expect(() => applyAction(g, { type: 'castEquipment', iid: cast.iid })).toThrow(/mana/);
  });
  it('moving it to another creature pays again and takes the bonus off the first; it cannot be put on the creature it is already on', () => {
    const g = base();
    const c1 = creature(2, 2)('A'), c2 = creature(2, 2)('A');
    const e = gear(1, { cost: 1, power: 3, toughness: 0 })('A');
    g.players.A.battlefield = [c1, c2, e, ...lands(3)];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: c1.iid });
    expect(power(find(a, c1.iid)!)).toBe(5);
    expect(() => applyAction(a, { type: 'equip', equipment: e.iid, creature: c1.iid })).toThrow();
    a = applyAction(a, { type: 'equip', equipment: e.iid, creature: c2.iid });
    expect(power(find(a, c1.iid)!)).toBe(2);
    expect(power(find(a, c2.iid)!)).toBe(5);
  });
  it('two equipment stack on one creature', () => {
    const g = base();
    const c = creature(1, 1)('A');
    const e1 = gear(1, { cost: 0, power: 1, toughness: 1 })('A'), e2 = gear(1, { cost: 0, power: 2, toughness: 0 })('A');
    g.players.A.battlefield = [c, e1, e2];
    const a = applyAction(applyAction(g, { type: 'equip', equipment: e1.iid, creature: c.iid }), { type: 'equip', equipment: e2.iid, creature: c.iid });
    expect([power(find(a, c.iid)!), toughness(find(a, c.iid)!)]).toEqual([4, 2]);
  });
});

describe('what an equipment grants', () => {
  it('keywords, which are gone again when the equipment moves away', () => {
    const g = base();
    const c1 = creature(2, 2)('A'), c2 = creature(2, 2)('A');
    const e = gear(1, { cost: 0, power: 0, toughness: 0, keywords: ['firstStrike', 'lifelink'] })('A');
    g.players.A.battlefield = [c1, c2, e];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: c1.iid });
    expect(hasKeyword(find(a, c1.iid)!, 'firstStrike')).toBe(true);
    expect(hasKeyword(find(a, c2.iid)!, 'firstStrike')).toBe(false);
    a = applyAction(a, { type: 'equip', equipment: e.iid, creature: c2.iid });
    expect(hasKeyword(find(a, c1.iid)!, 'firstStrike')).toBe(false);
    expect(hasKeyword(find(a, c2.iid)!, 'lifelink')).toBe(true);
  });
  it('a granted keyword works in combat (first strike kills before the blocker hits back)', () => {
    const g = base();
    const atk = creature(3, 1)('A'), blk = creature(3, 3)('B');
    const e = gear(1, { cost: 0, power: 0, toughness: 0, keywords: ['firstStrike'] })('A');
    g.players.A.battlefield = [atk, e];
    g.players.B.battlefield = [blk];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: atk.iid });
    a = applyAction(a, { type: 'advance' });
    a = applyAction(a, { type: 'declareAttackers', attackers: [atk.iid] });
    a = applyAction(a, { type: 'declareBlockers', blocks: { [blk.iid]: atk.iid } });
    expect(find(a, atk.iid)).toBeTruthy(); // it struck first, killing the 3/3 before it could answer
    expect(find(a, blk.iid)).toBeUndefined();
  });
});

describe('when the creature leaves', () => {
  it('the equipment stays on the battlefield, unattached, and can be put on another creature', () => {
    const g = base();
    const dying = creature(1, 1)('A', { damage: 1 }), other = creature(1, 1)('A');
    const e = gear(1, { cost: 0, power: 2, toughness: 2 })('A');
    g.players.A.battlefield = [dying, other, e];
    g.players.A.battlefield[0].attachedTo = undefined;
    e.attachedTo = dying.iid; // (equipped at some point; the creature is already lethally damaged: toughness 1, damage 1, +2 toughness from the gear)
    dying.damage = 3;
    const a = poke(g);
    expect(find(a, dying.iid)).toBeUndefined();
    expect(find(a, e.iid)).toBeTruthy();
    expect(find(a, e.iid)!.attachedTo).toBeUndefined();
    expect(a.players.A.graveyard.some((c) => c.iid === dying.iid)).toBe(true);
    const b = applyAction(a, { type: 'equip', equipment: e.iid, creature: other.iid });
    expect(power(find(b, other.iid)!)).toBe(3);
  });
  it('it does not stay attached to a creature that dies and returns through Undying (same id, new arrival)', () => {
    const g = base();
    const u = creature(1, 1, {}, ['undying'])('A');
    const e = gear(1, { cost: 0, power: 0, toughness: 3 })('A');
    g.players.A.battlefield = [u, e];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: u.iid });
    find(a, u.iid)!.damage = 4; // lethal even with the +3 toughness
    a = poke(a);
    expect(find(a, u.iid)).toBeTruthy(); // returned
    expect(find(a, u.iid)!.revived).toBe(true);
    expect(find(a, e.iid)!.attachedTo).toBeUndefined();
  });
  it('an attachment to a creature that is simply not there (a stale save, any odd exit) is cleared by the next action', () => {
    const g = base();
    const e = gear(1, { cost: 0, power: 5, toughness: 5 })('A', { attachedTo: 'ghost' });
    const c = creature(1, 1)('A');
    g.players.A.battlefield = [c, e];
    const a = poke(g);
    expect(find(a, e.iid)!.attachedTo).toBeUndefined();
    expect(power(find(a, c.iid)!)).toBe(1);
  });
  it('a bounced creature drops its equipment too', () => {
    const g = base();
    const c = creature(2, 2)('A');
    const e = gear(1, { cost: 0, power: 1, toughness: 1, keywords: ['flying'] })('A');
    CARDS.eq_bounce = { id: 'eq_bounce', name: 'B', type: 'sorcery', cost: 0, effect: { type: 'bounce' } };
    const sp = inst('eq_bounce');
    g.players.A.battlefield = [c, e];
    g.players.A.hand = [sp];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: c.iid });
    a = applyAction(a, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: c.iid } });
    expect(find(a, e.iid)!.attachedTo).toBeUndefined();
    const home = a.players.A.hand.find((x) => x.iid === c.iid)!;
    expect(hasKeyword(home, 'flying')).toBe(false); // no granted keyword lingers in hand
  });
  it('a granted Undying counts as last known information when the creature dies', () => {
    const g = base();
    const c = creature(1, 1)('A');
    const e = gear(1, { cost: 0, power: 0, toughness: 0, keywords: ['undying'] })('A');
    g.players.A.battlefield = [c, e];
    let a = applyAction(g, { type: 'equip', equipment: e.iid, creature: c.iid });
    find(a, c.iid)!.damage = 5;
    a = poke(a);
    expect(find(a, c.iid)?.revived).toBe(true);
  });
});

describe('legal actions and the AI', () => {
  it('legalActions offers cast and equip only when affordable', () => {
    const g = base();
    const c = creature(2, 2)('A');
    const e = gear(2, { cost: 2, power: 1, toughness: 1 })('A');
    const inHand = gear(3, { cost: 1, power: 1, toughness: 1 })('A');
    g.players.A.battlefield = [c, e, ...lands(2)];
    g.players.A.hand = [inHand];
    const acts = legalActions(g, 'A');
    expect(acts.some((a) => a.type === 'equip')).toBe(true);
    expect(acts.some((a) => a.type === 'castEquipment')).toBe(false); // 3 mana, 2 lands
  });
  it('the AI casts an equipment, then puts it on its strongest creature (and does not shuffle it around)', () => {
    const g = base();
    const small = creature(1, 1)('A'), big = creature(4, 4)('A');
    const e = gear(1, { cost: 1, power: 2, toughness: 2 })('A');
    g.players.A.battlefield = [small, big, ...lands(3)];
    g.players.A.hand = [e];
    let a = g;
    const first = pickAction(a, 'A');
    expect(first).toEqual({ type: 'castEquipment', iid: e.iid });
    a = applyAction(a, first);
    const second = pickAction(a, 'A');
    expect(second).toEqual({ type: 'equip', equipment: e.iid, creature: big.iid });
    a = applyAction(a, second);
    expect(pickAction(a, 'A').type).toBe('advance'); // attached: leave it
  });
});

describe('card data', () => {
  it('equipment cards are data: only type equipment carries equip, and its cost is a number', () => {
    for (const d of Object.values(CARDS)) {
      if (/^(eqc|eqg|nj|g2|ch|trig2|kwtest|kw2test|act|stat|co)_/.test(d.id)) continue;
      if (d.type === 'equipment') expect(d.equip, `${d.id}: an equipment needs equip data`).toBeTruthy();
      if (d.equip) expect(d.type, `${d.id}: only equipment has equip data`).toBe('equipment');
    }
  });
});
