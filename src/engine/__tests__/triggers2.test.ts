import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState, Keyword } from '../types';
import { needsCreatureChoice } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { power, toughness } from '../rules';

// Phase 4b: Landfall, Morbid / second-spell bonuses, Battle cry, Exalted and attack triggers, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `t${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
/** Register a throwaway creature and return a maker for it. */
function creature(p: number, t: number, extra: Partial<CardDef> = {}, kws: Keyword[] = [], cost = 1) {
  const id = `trig2_${n++}`;
  CARDS[id] = { id, name: `T${p}/${t}`, type: 'creature', cost, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
function spell(extra: Partial<CardDef>, cost = 1) {
  const id = `trig2_${n++}`;
  CARDS[id] = { id, name: 'Spell', type: 'sorcery', cost, ...extra } as CardDef;
  return (owner: 'A' | 'B' = 'A') => inst(id, owner);
}
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => inst('aether_well', owner));

function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  g.players.A.life = 20;
  g.players.B.life = 20;
  g.players.A.battlefield = [];
  g.players.B.battlefield = [];
  g.players.A.hand = [];
  g.players.B.hand = [];
  return g;
}
const life = (g: GameState, p: 'A' | 'B') => g.players[p].life;
const find = (g: GameState, iid: string) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((c) => c.iid === iid)!;

describe('landfall', () => {
  const heal = { type: 'heal', amount: 2 } as const;
  it('triggers when its controller plays a land, once per landfall creature', () => {
    const g = base();
    const a = creature(1, 1, { landTrigger: heal })();
    const b = creature(1, 1, { landTrigger: heal })();
    const land = inst('aether_well');
    g.players.A.battlefield = [a, b];
    g.players.A.hand = [land];
    const after = applyAction(g, { type: 'playLand', iid: land.iid });
    expect(life(after, 'A')).toBe(24);
    expect(after.log.filter((l) => /landfall/.test(l))).toHaveLength(2);
  });
  it("does not trigger on the opponent's land, and a creature without it does nothing", () => {
    const g = base();
    g.players.A.battlefield = [creature(1, 1, { landTrigger: heal })()];
    g.players.B.battlefield = [creature(1, 1, { landTrigger: heal })('B')];
    g.active = 'B';
    const land = inst('aether_well', 'B');
    g.players.B.hand = [land];
    const after = applyAction(g, { type: 'playLand', iid: land.iid });
    expect(life(after, 'B')).toBe(22); // B's own creature triggered
    expect(life(after, 'A')).toBe(20); // A's did not
  });
  it('triggers once per land put onto the battlefield by a ramp effect, and not when none could be moved', () => {
    const g = base();
    g.players.A.battlefield = [...lands(2), creature(1, 1, { landTrigger: heal })()];
    const ramp = spell({ effect: { type: 'ramp', amount: 2 } });
    const sp = ramp();
    g.players.A.hand = [sp, inst('aether_well'), inst('aether_well')];
    const after = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(life(after, 'A')).toBe(24); // two lands entered: two triggers
    const g2 = base();
    g2.players.A.battlefield = [...lands(2), creature(1, 1, { landTrigger: heal })()];
    const sp2 = ramp();
    g2.players.A.hand = [sp2];
    expect(life(applyAction(g2, { type: 'castSorcery', iid: sp2.iid }), 'A')).toBe(20);
  });
  it('a damage trigger aimed at the player burns the opponent', () => {
    const g = base();
    g.players.A.battlefield = [creature(1, 1, { landTrigger: { type: 'damage', amount: 1, targets: 'player' } })()];
    const land = inst('aether_well');
    g.players.A.hand = [land];
    expect(life(applyAction(g, { type: 'playLand', iid: land.iid }), 'B')).toBe(19);
  });
});

describe('morbid', () => {
  const draw = { type: 'draw', amount: 1 } as const;
  it('a creature with a morbid bonus gets it only if a creature has died this turn', () => {
    const g = base();
    g.players.A.battlefield = lands(4);
    const m = creature(1, 1, { bonus: { when: 'morbid', effect: { type: 'heal', amount: 3 } } })();
    g.players.A.hand = [m];
    expect(life(applyAction(g, { type: 'castCreature', iid: m.iid }), 'A')).toBe(20); // nothing has died
    const g2 = structuredClone(g);
    g2.diedThisTurn = true;
    const after = applyAction(g2, { type: 'castCreature', iid: m.iid });
    expect(life(after, 'A')).toBe(23);
    expect(after.log.some((l) => /morbid/.test(l))).toBe(true);
  });
  it('a real death turns it on: kill a creature with a spell, then cast the morbid creature in the same turn', () => {
    const g = base();
    g.players.A.battlefield = lands(4);
    g.players.B.battlefield = [creature(1, 1)('B')];
    const shot = spell({ effect: { type: 'damage', amount: 1, targets: 'creature' } });
    const kill = shot();
    const m = creature(1, 1, { bonus: { when: 'morbid', effect: draw } })();
    g.players.A.hand = [kill, m];
    const victim = g.players.B.battlefield[0];
    let s = applyAction(g, { type: 'castSorcery', iid: kill.iid, target: { kind: 'creature', iid: victim.iid } });
    expect(s.diedThisTurn).toBe(true);
    const handBefore = s.players.A.hand.length;
    s = applyAction(s, { type: 'castCreature', iid: m.iid });
    expect(s.players.A.hand.length).toBe(handBefore - 1 + 1); // the creature left the hand and the bonus drew a card
  });
  it('a token that dies counts, and the flag resets when the next turn begins', () => {
    const g = base();
    g.players.A.battlefield = lands(2);
    g.players.B.battlefield = [inst('wolf_token', 'B')];
    const shot = spell({ effect: { type: 'damage', amount: 5, targets: 'creature' } })();
    g.players.A.hand = [shot];
    let s = applyAction(g, { type: 'castSorcery', iid: shot.iid, target: { kind: 'creature', iid: g.players.B.battlefield[0].iid } });
    expect(s.diedThisTurn).toBe(true);
    s = applyAction(s, { type: 'advance' }); // combat
    s = applyAction(s, { type: 'advance' }); // end
    s = applyAction(s, { type: 'advance' }); // next turn
    expect(s.diedThisTurn).toBe(false);
  });
  it('a spell can carry a morbid bonus too, resolved after its own effect', () => {
    const g = base();
    g.players.A.battlefield = lands(2);
    g.diedThisTurn = true;
    const sp = spell({ effect: { type: 'heal', amount: 1 }, bonus: { when: 'morbid', effect: { type: 'heal', amount: 2 } } })();
    g.players.A.hand = [sp];
    expect(life(applyAction(g, { type: 'castSorcery', iid: sp.iid }), 'A')).toBe(23);
  });
});

describe('second spell', () => {
  it("the bonus applies from the caster's second spell of the turn, creatures included, and counts each player separately", () => {
    const g = base();
    g.players.A.battlefield = lands(5);
    const first = spell({ effect: { type: 'heal', amount: 1 } })();
    const second = spell({ effect: { type: 'heal', amount: 1 }, bonus: { when: 'secondSpell', effect: { type: 'heal', amount: 5 } } })();
    g.players.A.hand = [first, second];
    let s = applyAction(g, { type: 'castSorcery', iid: first.iid });
    expect(life(s, 'A')).toBe(21);
    s = applyAction(s, { type: 'castSorcery', iid: second.iid });
    expect(life(s, 'A')).toBe(27); // 21 + 1 + the 5 bonus
    // as the FIRST spell it gets nothing
    const g2 = base();
    g2.players.A.battlefield = lands(5);
    const only = spell({ effect: { type: 'heal', amount: 1 }, bonus: { when: 'secondSpell', effect: { type: 'heal', amount: 5 } } })();
    g2.players.A.hand = [only];
    expect(life(applyAction(g2, { type: 'castSorcery', iid: only.iid }), 'A')).toBe(21);
  });
  it('a creature spell counts as the first spell, so a following spell with the bonus fires', () => {
    const g = base();
    g.players.A.battlefield = lands(5);
    const c = creature(1, 1)();
    const sp = spell({ effect: { type: 'heal', amount: 0 }, bonus: { when: 'secondSpell', effect: { type: 'heal', amount: 4 } } })();
    g.players.A.hand = [c, sp];
    let s = applyAction(g, { type: 'castCreature', iid: c.iid });
    s = applyAction(s, { type: 'castSorcery', iid: sp.iid });
    expect(life(s, 'A')).toBe(24);
  });
  it('the count resets each turn', () => {
    const g = base();
    g.players.A.battlefield = lands(5);
    const a = spell({ effect: { type: 'heal', amount: 0 } })();
    g.players.A.hand = [a];
    let s = applyAction(g, { type: 'castSorcery', iid: a.iid });
    expect(s.spellsThisTurn?.A).toBe(1);
    s = applyAction(s, { type: 'advance' });
    s = applyAction(s, { type: 'advance' });
    s = applyAction(s, { type: 'advance' });
    expect(s.spellsThisTurn).toEqual({ A: 0, B: 0 });
  });
});

describe('battle cry', () => {
  function attack(attackers: CardInstance[], others: CardInstance[] = []): GameState {
    const g = base();
    g.players.A.battlefield = [...attackers, ...others];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    return applyAction(g, { type: 'declareAttackers', attackers: attackers.map((c) => c.iid) });
  }
  it('each OTHER attacker gets +1/+0 until end of turn; the battle cry creature itself does not', () => {
    const bc = creature(2, 2, {}, ['battleCry'])();
    const a = creature(1, 1)();
    const b = creature(3, 3)();
    const s = attack([bc, a, b]);
    expect([power(find(s, bc.iid)), power(find(s, a.iid)), power(find(s, b.iid))]).toEqual([2, 2, 4]);
    expect(toughness(find(s, a.iid))).toBe(1); // +1/+0 only
  });
  it('two battle cry creatures each pump the other', () => {
    const x = creature(2, 2, {}, ['battleCry'])();
    const y = creature(2, 2, {}, ['battleCry'])();
    const s = attack([x, y]);
    expect([power(find(s, x.iid)), power(find(s, y.iid))]).toEqual([3, 3]);
  });
  it('does nothing for a creature that stays home, and is gone when the next turn begins', () => {
    const bc = creature(2, 2, {}, ['battleCry'])();
    const home = creature(1, 1)();
    const solo = creature(1, 1)();
    const s = attack([bc, solo], [home]);
    expect(power(find(s, home.iid))).toBe(1);
    expect(power(find(s, solo.iid))).toBe(2);
    let t = applyAction(s, { type: 'declareBlockers', blocks: {} });
    t = applyAction(t, { type: 'advance' });
    expect(power(find(t, solo.iid))).toBe(1);
  });
  it('the pump is in place before blocks and so changes the real fight', () => {
    const bc = creature(1, 1, {}, ['battleCry'])();
    const a = creature(1, 3)(); // 2/3 once pumped
    const g = base();
    g.players.A.battlefield = [bc, a];
    const blk = creature(2, 2)('B');
    g.players.B.battlefield = [blk];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    let s = applyAction(g, { type: 'declareAttackers', attackers: [bc.iid, a.iid] });
    s = applyAction(s, { type: 'declareBlockers', blocks: { [blk.iid]: a.iid } });
    expect(s.players.B.battlefield.some((c) => c.iid === blk.iid)).toBe(false); // the pumped 2-power attacker killed the 2/2
  });
});

describe('exalted', () => {
  function attackAlone(attacker: CardInstance, others: CardInstance[]): GameState {
    const g = base();
    g.players.A.battlefield = [attacker, ...others];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    return applyAction(g, { type: 'declareAttackers', attackers: [attacker.iid] });
  }
  it('a creature attacking alone gets +1/+1 for each exalted creature its controller has, even one that stays home', () => {
    const ex = creature(1, 1, {}, ['exalted']);
    const lone = creature(2, 2)();
    const s = attackAlone(lone, [ex(), ex()]);
    expect([power(find(s, lone.iid)), toughness(find(s, lone.iid))]).toEqual([4, 4]);
  });
  it('an exalted creature attacking alone counts itself', () => {
    const e = creature(2, 2, {}, ['exalted'])();
    const s = attackAlone(e, []);
    expect([power(find(s, e.iid)), toughness(find(s, e.iid))]).toEqual([3, 3]);
  });
  it('gives nothing when two creatures attack, and nothing without an exalted creature', () => {
    const e = creature(2, 2, {}, ['exalted'])();
    const o = creature(2, 2)();
    const g = base();
    g.players.A.battlefield = [e, o];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    const s = applyAction(g, { type: 'declareAttackers', attackers: [e.iid, o.iid] });
    expect([power(find(s, e.iid)), power(find(s, o.iid))]).toEqual([2, 2]);
    const lone = creature(2, 2)();
    const t = attackAlone(lone, []);
    expect(power(find(t, lone.iid))).toBe(2);
  });
});

describe('attack triggers', () => {
  it('fire for each creature that attacks, even when it is blocked, and not for one that stays home', () => {
    const burn = { type: 'damage', amount: 1, targets: 'player' } as const;
    const a = creature(1, 1, { onAttack: burn })();
    const b = creature(1, 1, { onAttack: burn })();
    const home = creature(1, 1, { onAttack: burn })();
    const g = base();
    g.players.A.battlefield = [a, b, home];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    const s = applyAction(g, { type: 'declareAttackers', attackers: [a.iid, b.iid] });
    expect(life(s, 'B')).toBe(18);
    expect(s.log.filter((l) => /attack trigger/.test(l))).toHaveLength(2);
  });
  it('a draw trigger draws', () => {
    const a = creature(1, 1, { onAttack: { type: 'draw', amount: 1 } })();
    const g = base();
    g.players.A.battlefield = [a];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    const s = applyAction(g, { type: 'declareAttackers', attackers: [a.iid] });
    expect(s.players.A.hand.length).toBe(1);
  });
});

describe('card data: the new triggers never need a choice', () => {
  it('every real card with a landTrigger, onAttack or bonus uses an untargeted effect (damage only at the player)', () => {
    for (const def of Object.values(CARDS)) {
      if (def.id.startsWith('trig2_') || def.id.startsWith('kwtest_') || def.id.startsWith('kw2test_')) continue;
      const effects = [def.landTrigger, def.onAttack, def.bonus?.effect].filter(Boolean) as NonNullable<CardDef['onEnter']>[];
      for (const e of effects) {
        expect(needsCreatureChoice(e), `${def.id}: ${e.type} needs a creature choice`).toBe(false);
        if (e.type === 'damage') expect(e.targets, `${def.id}: damage must be aimed at the player`).toBe('player');
      }
    }
  });
});
