import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { actorOf, legalActions, power, toughness, validateAction } from '../rules';
import type { CardDef, CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { needsTarget } from '../types';
import { pickAction } from '../../ai/ai';

// Phase 4c: Bounce, Edict, Rally and Cycling, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `s${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}, kws: Keyword[] = [], cost = 1) {
  const id = `sp2_${n++}`;
  CARDS[id] = { id, name: `C${p}/${t}`, type: 'creature', cost, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
function spell(extra: Partial<CardDef>, type: 'sorcery' | 'instant' = 'sorcery', cost = 1) {
  const id = `sp2_${n++}`;
  CARDS[id] = { id, name: 'Spell', type, cost, ...extra } as CardDef;
  return (owner: 'A' | 'B' = 'A') => inst(id, owner);
}
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => inst('aether_well', owner));
function base(): GameState {
  const g = createInitialState(13, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) {
    g.players[p].life = 20;
    g.players[p].battlefield = [];
    g.players[p].hand = [];
    g.players[p].graveyard = [];
  }
  return g;
}
const onBf = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].some((c) => c.iid === iid);

describe('bounce', () => {
  const bounce = () => spell({ effect: { type: 'bounce' } });
  it("returns the target to its owner's hand with every buff and mark gone, summoning sick", () => {
    const g = base();
    const foe = creature(2, 2)('B', { buffP: 2, buffT: 2, damage: 1, tempP: 1, tempT: 1, tapped: true });
    g.players.B.battlefield = [foe];
    g.players.A.battlefield = lands(2);
    const sp = bounce()();
    g.players.A.hand = [sp];
    const after = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: foe.iid } });
    expect(onBf(after, foe.iid)).toBe(false);
    const back = after.players.B.hand.find((c) => c.iid === foe.iid)!;
    expect(back).toBeTruthy();
    expect([back.buffP, back.buffT, back.damage, back.tempP, back.tempT, back.tapped, back.summoningSick]).toEqual([0, 0, 0, 0, 0, false, true]);
    expect(after.log.some((l) => /returned to its owner's hand/.test(l))).toBe(true);
  });
  it('a token just ceases to exist (nothing lands in the hand)', () => {
    const g = base();
    const tok = inst('wolf_token', 'B');
    g.players.B.battlefield = [tok];
    g.players.A.battlefield = lands(2);
    const sp = bounce()();
    g.players.A.hand = [sp];
    const after = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: tok.iid } });
    expect(onBf(after, tok.iid)).toBe(false);
    expect(after.players.B.hand.some((c) => c.iid === tok.iid)).toBe(false);
    expect(after.players.B.graveyard.some((c) => c.iid === tok.iid)).toBe(false);
  });
  it('is not a death: no dies trigger, no Morbid, and it works on an indestructible creature', () => {
    const g = base();
    const foe = creature(2, 2, { onDeath: { type: 'token', token: 'zombie_token', count: 1 } }, ['indestructible'])('B');
    g.players.B.battlefield = [foe];
    g.players.A.battlefield = lands(2);
    const sp = bounce()();
    g.players.A.hand = [sp];
    const after = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: foe.iid } });
    expect(onBf(after, foe.iid)).toBe(false);
    expect(after.players.B.battlefield.some((c) => c.def === 'zombie_token')).toBe(false); // no last breath
    expect(after.diedThisTurn).toBeFalsy();
  });
  it('an attacker bounced in the block step leaves combat, so it deals no damage', () => {
    const g = base();
    const atk = creature(5, 5)('A');
    g.players.A.battlefield = [atk];
    const sp = bounce()('B');
    sp.owner = 'B';
    CARDS[sp.def].type = 'instant';
    g.players.B.battlefield = lands(2, 'B');
    g.players.B.hand = [sp];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    let s = applyAction(g, { type: 'declareAttackers', attackers: [atk.iid] });
    s = applyAction(s, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: atk.iid } });
    expect(s.combat?.attackers).toEqual([]);
    s = applyAction(s, { type: 'declareBlockers', blocks: {} });
    expect(s.players.B.life).toBe(20);
    expect(s.players.A.hand.some((c) => c.iid === atk.iid)).toBe(true);
  });
  it('takes the Kunoichi aura off a beast it bounces and off the beasts when Kunoichi herself is bounced', () => {
    const g = base();
    const k = inst('kunoichi');
    const cub = inst('stoneback_cub');
    g.players.A.battlefield = [...lands(2), k, cub];
    let s = applyAction(g, { type: 'advance' }); // any action recomputes the aura
    expect(s.players.A.battlefield.find((c) => c.iid === cub.iid)!.blitz).toBe(true);
    s = structuredClone(s);
    s.phase = 'main1';
    const sp = bounce()();
    s.players.A.hand = [sp];
    s.players.B.battlefield = [];
    const after = applyAction(s, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: k.iid } });
    const beast = after.players.A.battlefield.find((c) => c.iid === cub.iid)!;
    expect([beast.blitz, beast.buffP, beast.buffT]).toEqual([false, 0, 0]);
  });
  it('needs a creature in play as its target', () => {
    const g = base();
    g.players.A.battlefield = lands(2);
    const sp = bounce()();
    g.players.A.hand = [sp];
    expect(() => validateAction(g, { type: 'castSorcery', iid: sp.iid })).toThrow(/target/);
    expect(() => validateAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'player', player: 'B' } })).toThrow(/creature/);
  });
  it('a creature whose enter effect is a bounce waits for a target, like Whipflash', () => {
    const g = base();
    g.players.A.battlefield = lands(3);
    const foe = creature(3, 3)('B');
    g.players.B.battlefield = [foe];
    const gust = creature(1, 1, { onEnter: { type: 'bounce' } })();
    g.players.A.hand = [gust];
    let s = applyAction(g, { type: 'castCreature', iid: gust.iid });
    expect(s.pending?.kind).toBe('enter');
    s = applyAction(s, { type: 'resolveTrigger', target: foe.iid });
    expect(s.players.B.hand.some((c) => c.iid === foe.iid)).toBe(true);
  });
});

describe('edict', () => {
  const edict = () => spell({ effect: { type: 'edict' } }, 'sorcery', 2);
  function cast(foes: CardInstance[]) {
    const g = base();
    g.players.A.battlefield = lands(3);
    g.players.B.battlefield = foes;
    const sp = edict()();
    g.players.A.hand = [sp];
    return { g, sp, after: applyAction(g, { type: 'castSorcery', iid: sp.iid }) };
  }
  it('does nothing when the opponent has no creature', () => {
    const { after } = cast([]);
    expect(after.pending).toBeNull();
    expect(after.log.some((l) => /no creature to sacrifice/.test(l))).toBe(true);
  });
  it('sacrifices the only creature at once (it dies, goes to the graveyard, triggers its last breath)', () => {
    const only = creature(2, 2, { onDeath: { type: 'token', token: 'zombie_token', count: 1 } })('B');
    const { after } = cast([only]);
    expect(after.pending).toBeNull();
    expect(onBf(after, only.iid)).toBe(false);
    expect(after.players.B.graveyard.some((c) => c.iid === only.iid)).toBe(true);
    expect(after.players.B.battlefield.some((c) => c.def === 'zombie_token')).toBe(true);
    expect(after.diedThisTurn).toBe(true);
  });
  it('with a choice, the VICTIM decides: the caster cannot act, the victim may pick only their own creatures', () => {
    const small = creature(1, 1)('B');
    const big = creature(5, 5)('B');
    const mine = creature(2, 2)('A');
    const g = base();
    g.players.A.battlefield = [...lands(3), mine];
    g.players.B.battlefield = [small, big];
    const sp = edict()();
    g.players.A.hand = [sp];
    const s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(s.pending).toMatchObject({ kind: 'sacrifice', controller: 'B' });
    expect(s.pending!.def).toBe(sp.def); // the card behind the choice is named
    expect(actorOf(s)).toBe('B');
    expect(legalActions(s, 'A')).toEqual([]);
    expect(legalActions(s, 'B').map((a) => (a.type === 'resolveTrigger' ? a.target : '')).sort()).toEqual([small.iid, big.iid].sort());
    expect(() => validateAction(s, { type: 'resolveTrigger', target: mine.iid })).toThrow(/your own/); // not the caster's creature
    expect(() => validateAction(s, { type: 'advance' })).toThrow(/pending/);
    const done = applyAction(s, { type: 'resolveTrigger', target: small.iid });
    expect(done.pending).toBeNull();
    expect(onBf(done, small.iid)).toBe(false);
    expect(onBf(done, big.iid)).toBe(true);
    expect(onBf(done, mine.iid)).toBe(true);
    expect(done.players.B.graveyard.some((c) => c.iid === small.iid)).toBe(true);
  });
  it('a sacrificed creature dies even if it is indestructible', () => {
    const wall = creature(1, 4, {}, ['indestructible'])('B');
    const other = creature(1, 1)('B');
    const g = base();
    g.players.A.battlefield = lands(3);
    g.players.B.battlefield = [wall, other];
    const sp = edict()();
    g.players.A.hand = [sp];
    let s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    s = applyAction(s, { type: 'resolveTrigger', target: wall.iid });
    expect(onBf(s, wall.iid)).toBe(false);
  });
  it('a creature whose enter effect is an Edict works the same way and names itself', () => {
    const g = base();
    g.players.A.battlefield = lands(3);
    g.players.B.battlefield = [creature(1, 1)('B'), creature(2, 2)('B')];
    const slayer = creature(1, 1, { onEnter: { type: 'edict' } })();
    g.players.A.hand = [slayer];
    const s = applyAction(g, { type: 'castCreature', iid: slayer.iid });
    expect(s.pending).toMatchObject({ kind: 'sacrifice', controller: 'B', def: slayer.def });
  });
  it('the AI gives up a token first, then its least valuable creature', () => {
    const g = base();
    g.players.A.battlefield = lands(3);
    const tok = inst('wolf_token', 'B');
    const bigOne = creature(5, 5, {}, [], 5)('B');
    g.players.B.battlefield = [bigOne, tok];
    const sp = edict()();
    g.players.A.hand = [sp];
    const s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(pickAction(s, 'B')).toEqual({ type: 'resolveTrigger', target: tok.iid });
    const g2 = base();
    g2.players.A.battlefield = lands(3);
    const cheap = creature(1, 1, {}, [], 1)('B');
    const dear = creature(4, 4, {}, [], 4)('B');
    g2.players.B.battlefield = [dear, cheap];
    const sp2 = edict()();
    g2.players.A.hand = [sp2];
    expect(pickAction(applyAction(g2, { type: 'castSorcery', iid: sp2.iid }), 'B')).toEqual({ type: 'resolveTrigger', target: cheap.iid });
  });
});

describe('rally', () => {
  it('gives every creature of the caster +P/+T until end of turn, and nobody else, and not later arrivals', () => {
    const g = base();
    const a = creature(1, 1)(), b = creature(2, 2)();
    const foe = creature(3, 3)('B');
    g.players.A.battlefield = [...lands(2), a, b];
    g.players.B.battlefield = [foe];
    const sp = spell({ effect: { type: 'rally', power: 2, toughness: 1 } })();
    g.players.A.hand = [sp];
    const s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    const get = (iid: string) => s.players.A.battlefield.find((c) => c.iid === iid)!;
    expect([power(get(a.iid)), toughness(get(a.iid))]).toEqual([3, 2]);
    expect([power(get(b.iid)), toughness(get(b.iid))]).toEqual([4, 3]);
    expect(power(s.players.B.battlefield[0])).toBe(3);
    let t = applyAction(s, { type: 'advance' });
    t = applyAction(t, { type: 'advance' });
    t = applyAction(t, { type: 'advance' }); // next turn
    expect([t.players.A.battlefield.find((c) => c.iid === a.iid)!.tempP ?? 0]).toEqual([0]);
  });
  it('a creature entering AFTER the rally does not get it', () => {
    const g = base();
    const sp = spell({ effect: { type: 'rally', power: 1, toughness: 0 } })();
    const later = creature(1, 1)();
    g.players.A.battlefield = lands(3);
    g.players.A.hand = [sp, later];
    let s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    s = applyAction(s, { type: 'castCreature', iid: later.iid });
    expect(power(s.players.A.battlefield.find((c) => c.iid === later.iid)!)).toBe(1);
  });
  it('triggers prowess as any spell does, on top of the rally', () => {
    const g = base();
    const pro = creature(1, 1, {}, ['prowess'])();
    g.players.A.battlefield = [...lands(2), pro];
    const sp = spell({ effect: { type: 'rally', power: 1, toughness: 1 } })();
    g.players.A.hand = [sp];
    const s = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(power(s.players.A.battlefield.find((c) => c.iid === pro.iid)!)).toBe(3); // 1 base + 1 rally + 1 prowess
  });
  it('the AI rallies before combat with two attackers, but not with one', () => {
    const sp = spell({ effect: { type: 'rally', power: 1, toughness: 0 } });
    const two = base();
    two.players.A.battlefield = [...lands(2), creature(1, 1)(), creature(1, 1)()];
    const r = sp();
    two.players.A.hand = [r];
    expect(pickAction(two, 'A').type).toBe('castSorcery');
    const one = base();
    one.players.A.battlefield = [...lands(2), creature(1, 1)()];
    one.players.A.hand = [sp()];
    expect(pickAction(one, 'A').type).toBe('advance');
  });
});

describe('cycling', () => {
  it('pays the cycling cost, discards the card to the graveyard and draws one: not a cast, no prowess, no spell count', () => {
    const g = base();
    const pro = creature(1, 1, {}, ['prowess'])();
    const big = creature(6, 6, { cycling: 2 }, [], 6)();
    g.players.A.battlefield = [...lands(3), pro];
    g.players.A.hand = [big];
    const lib = g.players.A.library.length;
    const s = applyAction(g, { type: 'cycle', iid: big.iid });
    expect(s.players.A.hand).toHaveLength(1); // the drawn card
    expect(s.players.A.hand[0].iid).not.toBe(big.iid);
    expect(s.players.A.library).toHaveLength(lib - 1);
    expect(s.players.A.graveyard.some((c) => c.iid === big.iid)).toBe(true);
    expect(s.players.A.battlefield.filter((c) => c.tapped && c.def === 'aether_well')).toHaveLength(2);
    expect(s.log.some((l) => /cycles/.test(l))).toBe(true);
    expect(s.log.some((l) => /discards/.test(l))).toBe(false); // the discard animation is for Rot, not for your own cycling
    expect(power(s.players.A.battlefield.find((c) => c.iid === pro.iid)!)).toBe(1); // no prowess
    expect(s.spellsThisTurn?.A ?? 0).toBe(0);
  });
  it('is only legal in your main phase, for a card with cycling, with the mana', () => {
    const g = base();
    const big = creature(6, 6, { cycling: 2 }, [], 6)();
    const plain = creature(1, 1)();
    g.players.A.battlefield = lands(3);
    g.players.A.hand = [big, plain];
    expect(() => validateAction(g, { type: 'cycle', iid: plain.iid })).toThrow(/no cycling/);
    const poor = structuredClone(g);
    poor.players.A.battlefield = lands(1);
    expect(() => validateAction(poor, { type: 'cycle', iid: big.iid })).toThrow(/mana/);
    const wrong = structuredClone(g);
    wrong.phase = 'combat_attack';
    expect(() => validateAction(wrong, { type: 'cycle', iid: big.iid })).toThrow();
    expect(legalActions(g, 'A').filter((a) => a.type === 'cycle').map((a) => (a as { iid: string }).iid)).toEqual([big.iid]);
  });
  it('a spell can have cycling too', () => {
    const g = base();
    g.players.A.battlefield = lands(2);
    const sp = spell({ effect: { type: 'heal', amount: 1 }, cycling: 1 })();
    g.players.A.hand = [sp];
    const s = applyAction(g, { type: 'cycle', iid: sp.iid });
    expect(s.players.A.graveyard.some((c) => c.iid === sp.iid)).toBe(true);
  });
  it('the AI cycles a card it cannot cast soon, and keeps one it can', () => {
    const g = base();
    g.players.A.battlefield = lands(2);
    const big = creature(6, 6, { cycling: 2 }, [], 6)();
    g.players.A.hand = [big];
    expect(pickAction(g, 'A')).toEqual({ type: 'cycle', iid: big.iid });
    const g2 = base();
    g2.players.A.battlefield = lands(2);
    const cheap = creature(2, 2, { cycling: 2 }, [], 2)();
    g2.players.A.hand = [cheap];
    expect(pickAction(g2, 'A').type).toBe('castCreature');
  });
});

describe('card data for the new mechanics', () => {
  it('every real card with cycling is a non-land with a positive cycling cost', () => {
    for (const def of Object.values(CARDS)) {
      if (def.id.startsWith('sp2_') || def.id.startsWith('trig2_') || def.id.startsWith('kw')) continue;
      if (def.cycling === undefined) continue;
      expect(def.type, def.id).not.toBe('land');
      expect(def.cycling, def.id).toBeGreaterThan(0);
    }
  });
  it('Rally and Edict need no target (a trigger may use them); Bounce does (it waits for a choice like Whipflash)', () => {
    expect(needsTarget({ type: 'rally', power: 1, toughness: 0 })).toBe(false);
    expect(needsTarget({ type: 'edict' })).toBe(false);
    expect(needsTarget({ type: 'bounce' })).toBe(true);
  });
});
