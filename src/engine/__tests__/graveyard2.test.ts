import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { availableMana, legalActions, power, toughness } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4g: Undying and Unearth, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `g${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}, kws: Keyword[] = []) {
  const id = `g2_${n++}`;
  CARDS[id] = { id, name: `G${p}/${t}`, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => inst('aether_well', owner));
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; g.players[p].graveyard = []; g.players[p].exile = []; }
  return g;
}
const poke = (g: GameState) => { const l = inst('aether_well', g.active); g.players[g.active].hand.push(l); g.players[g.active].landPlayedThisTurn = false; return applyAction(g, { type: 'playLand', iid: l.iid }); };
const onBf = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((c) => c.iid === iid);

describe('undying', () => {
  it('a creature that dies returns once with a +1/+1 counter, summoning sick, and is gone the second time', () => {
    const g = base();
    const u = creature(2, 2, {}, ['undying'])('A', { damage: 2 });
    g.players.A.battlefield = [u];
    const a = poke(g);
    const back = onBf(a, u.iid)!;
    expect(back).toBeTruthy();
    expect([power(back), toughness(back)]).toEqual([3, 3]);
    expect(back.summoningSick).toBe(true);
    expect(back.damage).toBe(0);
    expect(a.players.A.graveyard.some((c) => c.iid === u.iid)).toBe(false);
    expect(a.log.some((l) => /rises again/.test(l))).toBe(true);
    back.damage = 3; // dies again, now WITH its counter
    const b = poke(a);
    expect(onBf(b, u.iid)).toBeUndefined();
    expect(b.players.A.graveyard.some((c) => c.iid === u.iid)).toBe(true);
  });
  it('still dies: its dies trigger fires, Morbid is on, and a token with undying returns without a card', () => {
    const g = base();
    const u = creature(1, 1, { onDeath: { type: 'token', token: 'zombie_token', count: 1 } }, ['undying'])('A', { damage: 1 });
    g.players.A.battlefield = [u];
    const a = poke(g);
    expect(a.diedThisTurn).toBe(true);
    expect(a.players.A.battlefield.filter((c) => c.def === 'zombie_token')).toHaveLength(1);
    expect(onBf(a, u.iid)).toBeTruthy();
  });
  it('bouncing it and recasting it gives it a fresh undying (the counter is gone with the old copy)', () => {
    const g = base();
    const u = creature(2, 2, {}, ['undying'])('A', { revived: true, buffP: 1, buffT: 1 });
    CARDS.g2_bounce = { id: 'g2_bounce', name: 'B', type: 'sorcery', cost: 0, effect: { type: 'bounce' } };
    const sp = inst('g2_bounce');
    g.players.A.battlefield = [u];
    g.players.A.hand = [sp];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: u.iid } });
    const home = a.players.A.hand.find((c) => c.iid === u.iid)!;
    expect(home.revived).toBe(false);
    expect(home.buffP).toBe(0);
  });
  it('a sacrificed undying creature returns too (an edict does not beat it)', () => {
    const g = base();
    const u = creature(2, 2, {}, ['undying'])('B');
    CARDS.g2_edict = { id: 'g2_edict', name: 'E', type: 'sorcery', cost: 0, effect: { type: 'edict' } };
    const sp = inst('g2_edict');
    g.players.B.battlefield = [u];
    g.players.A.hand = [sp];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(onBf(a, u.iid)).toBeTruthy();
    expect(onBf(a, u.iid)!.revived).toBe(true);
  });
});

describe('undying in combat', () => {
  it('a blocker killed by first strike comes back, but takes no part in the regular damage step', () => {
    const g = base();
    const atk = creature(3, 1, {}, ['firstStrike'])('A');
    const blk = creature(2, 3, {}, ['undying'])('B');
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = [blk];
    let a = applyAction(g, { type: 'advance' });
    a = applyAction(a, { type: 'declareAttackers', attackers: [atk.iid] });
    a = applyAction(a, { type: 'declareBlockers', blocks: { [blk.iid]: atk.iid } });
    expect(onBf(a, atk.iid)).toBeTruthy(); // the first striker is not hit back by the creature it just killed
    const back = onBf(a, blk.iid)!;
    expect(back.revived).toBe(true);
    expect(back.damage).toBe(0);
  });
  it('an attacker with undying killed in the first step returns and does not strike again', () => {
    const g = base();
    const atk = creature(3, 1, {}, ['undying'])('A');
    const blk = creature(1, 3, {}, ['firstStrike'])('B'); // kills the 1-toughness attacker first
    CARDS[blk.def].power = 1;
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = [blk];
    let a = applyAction(g, { type: 'advance' });
    a = applyAction(a, { type: 'declareAttackers', attackers: [atk.iid] });
    a = applyAction(a, { type: 'declareBlockers', blocks: { [blk.iid]: atk.iid } });
    expect(onBf(a, atk.iid)!.revived).toBe(true);
    expect(onBf(a, blk.iid)!.damage).toBe(0); // it never took the returned creature's regular-step blow
  });
});

describe('unearth', () => {
  it('returns a graveyard creature with haste for its cost; it is not a cast', () => {
    const g = base();
    const c = creature(3, 1, { unearth: 2 })('A');
    g.players.A.battlefield = lands(3);
    g.players.A.graveyard = [c];
    const a = applyAction(g, { type: 'unearth', iid: c.iid });
    const u = onBf(a, c.iid)!;
    expect(u.unearthed).toBe(true);
    expect(u.summoningSick).toBe(false);
    expect(a.players.A.graveyard).toHaveLength(0);
    expect(availableMana(a.players.A)).toBe(1);
    expect(a.spellsThisTurn?.A ?? 0).toBe(0);
  });
  it('is main-phase only, needs the mana and a card with unearth in YOUR graveyard', () => {
    const g = base();
    const c = creature(3, 1, { unearth: 2 })('A');
    const plain = creature(3, 1)('A');
    g.players.A.battlefield = lands(1);
    g.players.A.graveyard = [c, plain];
    expect(() => applyAction(g, { type: 'unearth', iid: c.iid })).toThrow(/mana/);
    g.players.A.battlefield = lands(3);
    expect(() => applyAction(g, { type: 'unearth', iid: plain.iid })).toThrow(/unearth/);
    expect(() => applyAction({ ...g, phase: 'combat_attack', combat: { attackers: [], blocks: {} } }, { type: 'unearth', iid: c.iid })).toThrow();
    g.players.B.graveyard = [creature(3, 1, { unearth: 1 })('B')];
    expect(() => applyAction(g, { type: 'unearth', iid: g.players.B.graveyard[0].iid })).toThrow();
  });
  it('is exiled at the end step, quietly, and instead of dying', () => {
    const g = base();
    const c = creature(3, 1, { unearth: 1, onDeath: { type: 'heal', amount: 5 } })('A');
    g.players.A.battlefield = lands(2);
    g.players.A.graveyard = [c];
    let a = applyAction(g, { type: 'unearth', iid: c.iid });
    a = applyAction(a, { type: 'advance' }); // to combat
    a = applyAction(a, { type: 'declareAttackers', attackers: [] });
    expect(a.phase).toBe('end');
    expect(onBf(a, c.iid)).toBeUndefined();
    expect(a.players.A.exile!.some((x) => x.iid === c.iid)).toBe(true);
    expect(a.players.A.graveyard).toHaveLength(0);
    expect(a.players.A.life).toBe(20); // it did not die: no dies trigger
    // and if it dies first, it goes to exile, not the graveyard
    let b = applyAction(g, { type: 'unearth', iid: c.iid });
    onBf(b, c.iid)!.damage = 5;
    b = poke(b);
    expect(b.players.A.graveyard).toHaveLength(0);
    expect(b.players.A.exile!.some((x) => x.iid === c.iid)).toBe(true);
    expect(b.players.A.life).toBe(25); // dying did fire the trigger
  });
  it('legalActions offers it only when affordable, and the AI unearths a hitter but not a weakling', () => {
    const g = base();
    const hit = creature(3, 1, { unearth: 2 })('A');
    g.players.A.battlefield = lands(1);
    g.players.A.graveyard = [hit];
    expect(legalActions(g, 'A').some((x) => x.type === 'unearth')).toBe(false);
    g.players.A.battlefield = lands(2);
    expect(legalActions(g, 'A').some((x) => x.type === 'unearth')).toBe(true);
    expect(pickAction(g, 'A')).toEqual({ type: 'unearth', iid: hit.iid });
    const weak = creature(1, 1, { unearth: 1 })('A');
    g.players.A.graveyard = [weak];
    expect(pickAction(g, 'A').type).toBe('advance');
  });
});

describe('card data', () => {
  it('undying and unearth appear only on creatures; undying creatures need no enter choice', () => {
    for (const d of Object.values(CARDS)) {
      if (/^(g2|ch|trig2|kwtest|kw2test|act|stat|co)_/.test(d.id)) continue;
      if (d.unearth !== undefined) expect(d.type, `${d.id}: only creatures unearth`).toBe('creature');
      if ((d.keywords ?? []).includes('undying')) expect(d.onEnter, `${d.id}: an undying creature returns without an enter effect`).toBeUndefined();
    }
  });
});
