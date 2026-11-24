import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { actorOf, legalActions, legalTargets } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4f: Scry, Loot, Bite and Hexproof, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `c${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}, kws: Keyword[] = [], cost = 1) {
  const id = `ch_${n++}`;
  CARDS[id] = { id, name: `C${p}/${t}`, type: 'creature', cost, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
function spell(extra: Partial<CardDef>, cost = 0, type: 'sorcery' | 'instant' = 'sorcery') {
  const id = `ch_${n++}`;
  CARDS[id] = { id, name: 'Spell', type, cost, ...extra } as CardDef;
  return (owner: 'A' | 'B' = 'A') => inst(id, owner);
}
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; g.players[p].graveyard = []; }
  return g;
}
const lib = (g: GameState, ...defs: string[]) => { g.players.A.library = defs.map((d) => inst(d)); return g.players.A.library.map((c) => c.iid); };
const find = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((c) => c.iid === iid)!;

describe('scry', () => {
  const SCRY2 = { type: 'scry', amount: 2 } as const;
  it('looks at the top N one at a time: top keeps the card there, bottom sends it to the end', () => {
    const g = base();
    const ids = lib(g, 'aether_well', 'cinderbolt', 'scorch', 'insight');
    const sp = spell({ effect: SCRY2 })();
    g.players.A.hand = [sp];
    let a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(a.pending?.kind).toBe('scry');
    expect(actorOf(a)).toBe('A');
    a = applyAction(a, { type: 'scry', bottom: false }); // keep the first
    expect(a.pending?.kind).toBe('scry');
    a = applyAction(a, { type: 'scry', bottom: true }); // bottom the second
    expect(a.pending).toBeNull();
    expect(a.players.A.library.map((c) => c.iid)).toEqual([ids[0], ids[2], ids[3], ids[1]]);
  });
  it('bottoming both rotates them past the rest', () => {
    const g = base();
    const ids = lib(g, 'aether_well', 'cinderbolt', 'scorch');
    const sp = spell({ effect: SCRY2 })();
    g.players.A.hand = [sp];
    let a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    a = applyAction(a, { type: 'scry', bottom: true });
    a = applyAction(a, { type: 'scry', bottom: true });
    expect(a.players.A.library.map((c) => c.iid)).toEqual([ids[2], ids[0], ids[1]]);
  });
  it('looks at no more cards than the library has, and not at all with an empty library', () => {
    const g = base();
    lib(g, 'aether_well');
    const sp = spell({ effect: { type: 'scry', amount: 3 } })();
    g.players.A.hand = [sp];
    let a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(a.pending?.left).toBe(1);
    a = applyAction(a, { type: 'scry', bottom: false });
    expect(a.pending).toBeNull();
    const g2 = base();
    g2.players.A.library = [];
    g2.players.A.hand = [spell({ effect: SCRY2 })()];
    expect(applyAction(g2, { type: 'castSorcery', iid: g2.players.A.hand[0].iid }).pending).toBeNull();
  });
  it('nothing else is legal while it waits, and the log never names the cards', () => {
    const g = base();
    lib(g, 'scorch', 'cinderbolt');
    const sp = spell({ effect: SCRY2 })();
    g.players.A.hand = [sp];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(() => applyAction(a, { type: 'advance' })).toThrow(/pending/);
    expect(() => applyAction(base(), { type: 'scry', bottom: true })).toThrow();
    expect(legalActions(a, 'A')).toEqual([{ type: 'scry', bottom: false }, { type: 'scry', bottom: true }]);
    expect(legalActions(a, 'B')).toEqual([]);
    const b = applyAction(applyAction(a, { type: 'scry', bottom: true }), { type: 'scry', bottom: false });
    expect(b.log.join(' ')).not.toMatch(/Scorch|Cinderbolt/);
  });
  it('works as a creature\'s enter effect', () => {
    const g = base();
    lib(g, 'scorch');
    const c = creature(1, 1, { onEnter: { type: 'scry', amount: 1 }, cost: 0 })();
    g.players.A.hand = [c];
    expect(applyAction(g, { type: 'castCreature', iid: c.iid }).pending?.kind).toBe('scry');
  });
  it('the AI keeps a land it needs and bottoms one it does not', () => {
    const g = base();
    lib(g, 'aether_well');
    g.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    const sp = spell({ effect: { type: 'scry', amount: 1 } })();
    g.players.A.hand = [sp];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(pickAction(a, 'A')).toEqual({ type: 'scry', bottom: false });
    const rich = base();
    lib(rich, 'aether_well');
    rich.players.A.battlefield = Array.from({ length: 6 }, () => inst('aether_well'));
    rich.players.A.hand = [sp];
    expect(pickAction(applyAction(rich, { type: 'castSorcery', iid: sp.iid }), 'A')).toEqual({ type: 'scry', bottom: true });
  });
});

describe('loot', () => {
  it('draws a card, then the controller discards a card of their choice', () => {
    const g = base();
    lib(g, 'scorch', 'cinderbolt');
    const sp = spell({ effect: { type: 'loot' } })();
    const keep = inst('insight'), toss = inst('aether_well');
    g.players.A.hand = [sp, keep, toss];
    let a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(a.pending?.kind).toBe('discard');
    expect(a.players.A.hand).toHaveLength(3); // keep, toss, and the drawn card
    expect(actorOf(a)).toBe('A');
    expect(legalActions(a, 'A')).toHaveLength(3);
    a = applyAction(a, { type: 'resolveTrigger', target: toss.iid });
    expect(a.pending).toBeNull();
    expect(a.players.A.hand.some((c) => c.iid === toss.iid)).toBe(false);
    expect(a.players.A.graveyard.some((c) => c.iid === toss.iid)).toBe(true);
    expect(a.players.A.hand).toHaveLength(2);
  });
  it('refuses a card that is not in the controller\'s hand, and is not logged as a discard (that is Rot\'s show)', () => {
    const g = base();
    lib(g, 'scorch');
    const sp = spell({ effect: { type: 'loot' } })();
    const other = inst('insight', 'B');
    const mine = inst('insight');
    g.players.A.hand = [sp, mine];
    g.players.B.hand = [other];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(() => applyAction(a, { type: 'resolveTrigger', target: other.iid })).toThrow(/hand/);
    const b = applyAction(a, { type: 'resolveTrigger', target: mine.iid });
    expect(b.log.some((l) => /loots away/.test(l))).toBe(true);
    expect(b.log.some((l) => /discards/.test(l))).toBe(false);
  });
  it('with an empty library the controller loses on the draw and nothing is left pending', () => {
    const g = base();
    g.players.A.library = [];
    const sp = spell({ effect: { type: 'loot' } })();
    g.players.A.hand = [sp, inst('insight')];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(a.winner).toBe('B');
  });
  it('the AI discards a spare land before a spell', () => {
    const g = base();
    lib(g, 'scorch');
    g.players.A.battlefield = Array.from({ length: 6 }, () => inst('aether_well'));
    const sp = spell({ effect: { type: 'loot' } })();
    const land = inst('aether_well'), bolt = inst('cinderbolt');
    g.players.A.hand = [sp, bolt, land];
    const a = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(pickAction(a, 'A')).toEqual({ type: 'resolveTrigger', target: land.iid });
  });
});

describe('bite', () => {
  const BITE = { type: 'bite' } as const;
  const cast = (g: GameState, sp: CardInstance, target: string) => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: target } });
  it('the creature with the greatest power deals damage equal to its power; the victim cannot hit back', () => {
    const g = base();
    const small = creature(1, 1)(), big = creature(3, 3)();
    const foe = creature(2, 5)('B');
    const sp = spell({ effect: BITE })();
    g.players.A.battlefield = [small, big];
    g.players.B.battlefield = [foe];
    g.players.A.hand = [sp];
    const a = cast(g, sp, foe.iid);
    expect(find(a, foe.iid).damage).toBe(3);
    expect(find(a, big.iid).damage).toBe(0);
    expect(find(a, small.iid).damage).toBe(0);
  });
  it('kills when the power covers the toughness, and a deathtouch biter kills anything', () => {
    const g = base();
    const big = creature(3, 3)(), foe = creature(1, 3)('B');
    const sp = spell({ effect: BITE })();
    g.players.A.battlefield = [big];
    g.players.B.battlefield = [foe];
    g.players.A.hand = [sp];
    expect(cast(g, sp, foe.iid).players.B.battlefield).toHaveLength(0);
    const g2 = base();
    const dt = creature(1, 1, {}, ['deathtouch'])(), tank = creature(1, 9)('B');
    g2.players.A.battlefield = [dt];
    g2.players.B.battlefield = [tank];
    g2.players.A.hand = [sp];
    expect(cast(g2, sp, tank.iid).players.B.battlefield).toHaveLength(0);
  });
  it('needs an opposing target and a creature of your own', () => {
    const g = base();
    const mine = creature(2, 2)(), foe = creature(1, 1)('B');
    const sp = spell({ effect: BITE })();
    g.players.A.battlefield = [mine];
    g.players.B.battlefield = [foe];
    g.players.A.hand = [sp];
    expect(() => cast(g, sp, mine.iid)).toThrow(/opposing/);
    g.players.A.battlefield = [];
    expect(() => cast(g, sp, foe.iid)).toThrow(/creature/);
    expect(legalActions(g, 'A').some((x) => x.type === 'castSorcery')).toBe(false);
  });
});

describe('hexproof', () => {
  const KILL = { type: 'damage', amount: 9, targets: 'creature' } as const;
  it('the opponent\'s spells cannot target it, in validation or in legalActions', () => {
    const g = base();
    const hp = creature(2, 2, {}, ['hexproof'])('B');
    const plain = creature(2, 2)('B');
    const sp = spell({ effect: KILL })();
    g.players.B.battlefield = [hp, plain];
    g.players.A.hand = [sp];
    expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: hp.iid } })).toThrow(/hexproof/);
    const targets = legalActions(g, 'A').filter((x) => x.type === 'castSorcery').map((x) => (x as { target?: { iid?: string } }).target?.iid);
    expect(targets).toEqual([plain.iid]);
    expect(legalTargets(g, 'A', 'creature').some((t) => t.kind === 'creature' && t.iid === hp.iid)).toBe(false);
  });
  it('its own controller can still target it, and players and combat are unaffected', () => {
    const g = base();
    const hp = creature(2, 2, {}, ['hexproof'])();
    const buff = spell({ effect: { type: 'buff', power: 1, toughness: 1, targets: 'creature' } })();
    g.players.A.battlefield = [hp];
    g.players.A.hand = [buff];
    const a = applyAction(g, { type: 'castSorcery', iid: buff.iid, target: { kind: 'creature', iid: hp.iid } });
    expect(find(a, hp.iid).buffP).toBe(1);
    const burn = spell({ effect: { type: 'damage', amount: 3, targets: 'any' } })();
    const g2 = base();
    g2.players.B.battlefield = [creature(2, 2, {}, ['hexproof'])('B')];
    g2.players.A.hand = [burn];
    expect(applyAction(g2, { type: 'castSorcery', iid: burn.iid, target: { kind: 'player', player: 'B' } }).players.B.life).toBe(17);
  });
  it('bounce, destroy and bite refuse it too', () => {
    for (const effect of [{ type: 'bounce' }, { type: 'destroy', targets: 'creature' }, { type: 'bite' }] as CardDef['effect'][]) {
      const g = base();
      const hp = creature(2, 2, {}, ['hexproof'])('B', { tapped: true });
      const sp = spell({ effect })();
      g.players.A.battlefield = [creature(2, 2)()];
      g.players.B.battlefield = [hp];
      g.players.A.hand = [sp];
      expect(() => applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: hp.iid } }), String(effect?.type)).toThrow(/hexproof/);
      expect(legalActions(g, 'A').some((x) => x.type === 'castSorcery' && x.target?.kind === 'creature' && x.target.iid === hp.iid)).toBe(false);
    }
  });
  it('a targeted enter effect cannot pick it, and fizzles rather than sticking when it is the only creature', () => {
    const g = base();
    const hp = creature(2, 2, {}, ['hexproof'])('B');
    const whip = creature(1, 1, { onEnter: { type: 'damage', amount: 2, targets: 'creature' }, cost: 0 })();
    g.players.B.battlefield = [hp];
    g.players.A.hand = [whip];
    const a = applyAction(g, { type: 'castCreature', iid: whip.iid });
    expect(a.pending).toBeNull(); // nothing it may target
    const plain = creature(2, 2)('B');
    g.players.B.battlefield = [hp, plain];
    const b = applyAction(g, { type: 'castCreature', iid: whip.iid });
    expect(b.pending?.kind).toBe('enter');
    const picks = legalActions(b, 'A').map((x) => (x as { target: string }).target);
    expect(picks).not.toContain(hp.iid);
    expect(picks).toContain(plain.iid);
    expect(() => applyAction(b, { type: 'resolveTrigger', target: hp.iid })).toThrow(/hexproof/);
  });
});

describe('card data', () => {
  it('scry, loot and bite appear only where a pending choice or a target can be asked for', () => {
    for (const def of Object.values(CARDS)) {
      if (def.id.startsWith('ch_') || def.id.startsWith('trig2_') || def.id.startsWith('kwtest_') || def.id.startsWith('kw2test_') || def.id.startsWith('act_') || def.id.startsWith('stat_')) continue;
      for (const [slot, e] of [['landTrigger', def.landTrigger], ['onAttack', def.onAttack], ['onDeath', def.onDeath], ['spellTrigger', def.spellTrigger]] as const) {
        if (e && (e.type === 'scry' || e.type === 'loot' || e.type === 'bite')) throw new Error(`${def.id}: ${e.type} may not be a ${slot} (it waits on a choice or a target)`);
      }
      if (def.onEnter?.type === 'bite') throw new Error(`${def.id}: bite is a spell effect`);
      if (def.activated && ['scry', 'loot', 'bite'].includes(def.activated.effect.type)) throw new Error(`${def.id}: an ability may not scry, loot or bite yet`);
    }
  });
});
