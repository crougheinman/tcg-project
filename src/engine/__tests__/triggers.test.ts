import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { actorOf, canBlock, legalActions, power, toughness } from '../rules';
import type { CardDef, CardInstance, Effect, GameState, Keyword } from '../types';
import { needsCreatureChoice } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { pickAction } from '../../ai/ai';

// Phase 2: enter-the-battlefield effects, dies triggers, prowess and flash, on throwaway cards so each
// rule stands alone (not on whichever real cards happen to carry it today).

let n = 0;
type Extra = Partial<Pick<CardDef, 'onEnter' | 'onDeath' | 'skill' | 'cost'>>;
/** Register a test-only creature and return a factory for instances of it. */
function creature(p: number, t: number, kws: Keyword[] = [], extra: Extra = {}) {
  const id = `trigtest_${n++}`;
  CARDS[id] = { id, name: `T${p}/${t}`, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
    iid: `g${n++}`, def: id, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
  });
}
const land = (owner: 'A' | 'B' = 'A'): CardInstance => ({ iid: `l${n++}`, def: 'aether_well', owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => land(owner));
const card = (def: string, owner: 'A' | 'B' = 'A'): CardInstance => ({ iid: `h${n++}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });

function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.players.A.life = 20;
  g.players.B.life = 20;
  g.players.A.hand = [];
  g.players.B.hand = [];
  g.players.A.battlefield = [];
  g.players.B.battlefield = [];
  return g;
}
const onField = (g: GameState, c: CardInstance) => [...g.players.A.battlefield, ...g.players.B.battlefield].find((x) => x.iid === c.iid);
const tokensOf = (g: GameState, owner: 'A' | 'B') => g.players[owner].battlefield.filter((c) => c.def === 'zombie_token').length;
const killer = { type: 'damage', amount: 99, targets: 'creature' } as const;

describe('enter-the-battlefield effects (onEnter)', () => {
  it('an untargeted effect resolves at once (a token, a heal, a draw, damage to the opponent)', () => {
    const mkToken = creature(2, 2, [], { onEnter: { type: 'token', token: 'zombie_token', count: 2 } })();
    const g0 = base();
    g0.players.A.battlefield = lands(2);
    g0.players.A.hand = [mkToken];
    const g = applyAction(g0, { type: 'castCreature', iid: mkToken.iid });
    expect(g.pending).toBeNull();
    expect(tokensOf(g, 'A')).toBe(2);

    const heal = creature(1, 1, [], { onEnter: { type: 'heal', amount: 4 } })();
    const g1 = base();
    g1.players.A.life = 10;
    g1.players.A.battlefield = lands(2);
    g1.players.A.hand = [heal];
    expect(applyAction(g1, { type: 'castCreature', iid: heal.iid }).players.A.life).toBe(14);

    const burn = creature(1, 1, [], { onEnter: { type: 'damage', amount: 3, targets: 'player' } })();
    const g2 = base();
    g2.players.A.battlefield = lands(2);
    g2.players.A.hand = [burn];
    expect(applyAction(g2, { type: 'castCreature', iid: burn.iid }).players.B.life).toBe(17);
  });

  it('a targeted effect waits on a pending choice, made by the caster', () => {
    const zap = creature(2, 2, [], { skill: 'Zap', onEnter: { type: 'damage', amount: 2, targets: 'creature' } })();
    const victim = creature(3, 2)('B');
    const g0 = base();
    g0.players.A.battlefield = lands(3);
    g0.players.B.battlefield = [victim];
    g0.players.A.hand = [zap];
    const g = applyAction(g0, { type: 'castCreature', iid: zap.iid });
    expect(g.pending).toMatchObject({ kind: 'enter', source: zap.iid, controller: 'A' });
    expect(actorOf(g)).toBe('A');
    expect(g.log.some((l) => /Zap! Choose a creature/.test(l))).toBe(true);
    // nothing else is legal until it is resolved, and it cannot target its own source
    expect(legalActions(g, 'A').every((a) => a.type === 'resolveTrigger')).toBe(true);
    expect(() => applyAction(g, { type: 'resolveTrigger', target: zap.iid })).toThrow();
    expect(() => applyAction(g, { type: 'advance' })).toThrow();
    const done = applyAction(g, { type: 'resolveTrigger', target: victim.iid });
    expect(done.pending).toBeNull();
    expect(onField(done, victim)).toBeUndefined(); // 2 damage on a 3/2
    expect(done.log.some((l) => /Zap hits .* for 2/.test(l))).toBe(true);
  });

  it('fizzles when there is nothing to target', () => {
    const zap = creature(2, 2, [], { skill: 'Zap', onEnter: { type: 'damage', amount: 2, targets: 'creature' } })();
    const g0 = base();
    g0.players.A.battlefield = lands(3);
    g0.players.A.hand = [zap];
    const g = applyAction(g0, { type: 'castCreature', iid: zap.iid });
    expect(g.pending).toBeNull();
    expect(g.log.some((l) => /Zap fizzles/.test(l))).toBe(true);
  });
});

describe('dies triggers (onDeath)', () => {
  const dieToken: Effect = { type: 'token', token: 'zombie_token', count: 1 };

  it('a creature killed in combat raises its token, and the controller keeps the token', () => {
    const ghoul = creature(2, 2, [], { onDeath: dieToken })('A', { tapped: true });
    const brute = creature(5, 5)('B');
    const g0 = base();
    g0.players.A.battlefield = [ghoul];
    g0.players.B.battlefield = [brute];
    g0.combat = { attackers: [ghoul.iid], blocks: { [brute.iid]: ghoul.iid } };
    g0.phase = 'combat_block';
    const g = applyAction(g0, { type: 'declareBlockers', blocks: { [brute.iid]: ghoul.iid } });
    expect(onField(g, ghoul)).toBeUndefined();
    expect(tokensOf(g, 'A')).toBe(1);
    expect(g.players.A.graveyard.some((c) => c.iid === ghoul.iid)).toBe(true);
    expect(g.log.some((l) => /last breath/.test(l))).toBe(true);
  });

  it('fires from a spell kill too, and for a token that dies (it leaves no card behind)', () => {
    const tokenWithDeath = creature(1, 1, [], { onDeath: dieToken })('A');
    const bolt = card('cinderbolt', 'B');
    const g0 = base();
    g0.active = 'B';
    g0.players.B.battlefield = lands(1, 'B');
    g0.players.B.hand = [bolt];
    g0.players.A.battlefield = [tokenWithDeath];
    const g = applyAction(g0, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'creature', iid: tokenWithDeath.iid } });
    expect(onField(g, tokenWithDeath)).toBeUndefined();
    expect(tokensOf(g, 'A')).toBe(1); // the trigger fired
    // a dying zombie TOKEN that itself carries a trigger still leaves nothing in the graveyard
    CARDS.zombie_token.onDeath = dieToken;
    try {
      const z = card('zombie_token', 'A');
      const bolt2 = card('cinderbolt', 'B');
      const h = base();
      h.active = 'B';
      h.players.B.battlefield = lands(1, 'B');
      h.players.B.hand = [bolt2];
      h.players.A.battlefield = [z];
      const r = applyAction(h, { type: 'castSorcery', iid: bolt2.iid, target: { kind: 'creature', iid: z.iid } });
      expect(r.players.A.graveyard).toHaveLength(0);
      expect(tokensOf(r, 'A')).toBe(1); // a fresh token replaced it (and does not die again)
    } finally {
      delete CARDS.zombie_token.onDeath;
    }
  });

  it('simultaneous deaths resolve active player first, then the other, in a fixed order', () => {
    const a = creature(1, 1, [], { onDeath: dieToken })('A', { tapped: true });
    const b = creature(1, 1, [], { onDeath: dieToken })('B');
    const g0 = base();
    g0.players.A.battlefield = [a];
    g0.players.B.battlefield = [b];
    g0.combat = { attackers: [a.iid], blocks: { [b.iid]: a.iid } };
    g0.phase = 'combat_block';
    const g = applyAction(g0, { type: 'declareBlockers', blocks: { [b.iid]: a.iid } });
    const names = g.log.filter((l) => /last breath/.test(l));
    expect(names).toHaveLength(2);
    expect(tokensOf(g, 'A')).toBe(1);
    expect(tokensOf(g, 'B')).toBe(1);
    // the two token creations appear in the log active-player-first
    const created = g.log.filter((l) => /creates 1/.test(l));
    expect(created.map((l) => l.charAt(0))).toEqual(['A', 'B']);
    // and the same input always gives the same state (determinism, which online play relies on)
    expect(JSON.stringify(applyAction(g0, { type: 'declareBlockers', blocks: { [b.iid]: a.iid } }))).toBe(JSON.stringify(g));
  });

  it('can finish the game: a death that deals damage to the opponent', () => {
    const martyr = creature(1, 1, [], { onDeath: { type: 'damage', amount: 3, targets: 'player' } })('A', { tapped: true });
    const wall = creature(0, 9)('B');
    const g0 = base();
    g0.players.B.life = 3;
    g0.players.A.battlefield = [martyr];
    g0.players.B.battlefield = [wall];
    g0.combat = { attackers: [martyr.iid], blocks: { [wall.iid]: martyr.iid } };
    g0.phase = 'combat_block';
    // the wall has 0 power, so make the martyr die another way: a bolt from B
    const bolt = card('cinderbolt', 'B');
    g0.active = 'B';
    g0.phase = 'main1';
    g0.combat = null;
    g0.players.B.battlefield = [wall, ...lands(1, 'B')];
    g0.players.B.hand = [bolt];
    g0.players.A.battlefield = [{ ...martyr, tapped: false }];
    const g = applyAction(g0, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'creature', iid: martyr.iid } });
    expect(g.players.B.life).toBe(0);
    expect(g.winner).toBe('A');
  });

  it('does not fire for a creature that merely leaves combat alive', () => {
    const ghoul = creature(2, 5, [], { onDeath: dieToken })('A', { tapped: true });
    const g0 = base();
    g0.players.A.battlefield = [ghoul];
    g0.combat = { attackers: [ghoul.iid], blocks: {} };
    g0.phase = 'combat_block';
    const g = applyAction(g0, { type: 'declareBlockers', blocks: {} });
    expect(tokensOf(g, 'A')).toBe(0);
  });
});

describe('prowess', () => {
  const bolt = () => card('cinderbolt', 'A');
  function cast(g: GameState, spell: CardInstance, target = { kind: 'player', player: 'B' } as const) {
    return applyAction(g, { type: 'castSorcery', iid: spell.iid, target });
  }

  it('gets +1/+1 for each spell its controller casts, sorcery or instant', () => {
    const p = creature(1, 2, ['prowess'])();
    const g0 = base();
    g0.players.A.battlefield = [p, ...lands(4)];
    const s1 = bolt();
    const s2 = card('warding_stance', 'A'); // an instant: +0/+3 target creature
    g0.players.A.hand = [s1, s2];
    let g = cast(g0, s1);
    expect([power(onField(g, p)!), toughness(onField(g, p)!)]).toEqual([2, 3]);
    g = applyAction(g, { type: 'castSorcery', iid: s2.iid, target: { kind: 'creature', iid: p.iid } });
    expect(power(onField(g, p)!)).toBe(3); // 1 + 2 prowess triggers
    expect(g.log.filter((l) => /prowess/.test(l))).toHaveLength(2);
  });

  it('is until end of turn: it expires when the next turn begins, and is not permanent', () => {
    const p = creature(1, 2, ['prowess'])();
    const g0 = base();
    g0.players.A.battlefield = [p, ...lands(2)];
    const s1 = bolt();
    g0.players.A.hand = [s1];
    let g = cast(g0, s1);
    expect(power(onField(g, p)!)).toBe(2);
    g = applyAction(g, { type: 'advance' }); // -> combat_attack
    g = applyAction(g, { type: 'advance' }); // -> end
    expect(power(onField(g, p)!)).toBe(2); // still this turn
    g = applyAction(g, { type: 'advance' }); // the enemy's turn begins
    expect([power(onField(g, p)!), toughness(onField(g, p)!)]).toEqual([1, 2]);
  });

  it('does not buff other creatures or the opponent\'s prowess creatures', () => {
    const mine = creature(1, 2, ['prowess'])();
    const plain = creature(1, 2)();
    const theirs = creature(1, 2, ['prowess'])('B');
    const g0 = base();
    g0.players.A.battlefield = [mine, plain, ...lands(2)];
    g0.players.B.battlefield = [theirs];
    const s1 = bolt();
    g0.players.A.hand = [s1];
    const g = cast(g0, s1);
    expect(power(onField(g, plain)!)).toBe(1);
    expect(power(onField(g, theirs)!)).toBe(1);
    expect(power(onField(g, mine)!)).toBe(2);
  });

  it('the extra toughness is real: it lets the creature survive damage it would not have', () => {
    const p = creature(1, 2, ['prowess'])('A', { damage: 2 });
    // damage 2 on a 1/2 would be lethal; with +0/+1 it is not (damage is only checked after the spell)
    const g0 = base();
    g0.players.A.battlefield = [{ ...p, damage: 1 }, ...lands(2)];
    const s1 = bolt();
    g0.players.A.hand = [s1];
    const g = cast(g0, s1);
    expect(onField(g, p)!.damage).toBe(1);
    expect(toughness(onField(g, p)!)).toBe(3);
  });
});

describe('flash creatures', () => {
  const flash = () => creature(1, 4, ['flash'], { cost: 2 })('B');

  /** A attacks with `atk`; B (the defender) holds a flash creature and two lands, in the block step. */
  function blockStep() {
    const atk = creature(3, 3)('A', { tapped: true });
    const f = flash();
    const g = base();
    g.active = 'A';
    g.phase = 'combat_block';
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = lands(2, 'B');
    g.players.B.hand = [f];
    g.combat = { attackers: [atk.iid], blocks: {} };
    return { g, atk, f };
  }

  it('the defender can cast it in the block step and it can block at once', () => {
    const { g, atk, f } = blockStep();
    expect(actorOf(g)).toBe('B');
    expect(legalActions(g, 'B').some((a) => a.type === 'castCreature' && a.iid === f.iid)).toBe(true);
    expect(legalActions(g, 'A')).toEqual([]); // not the attacker's move
    const g2 = applyAction(g, { type: 'castCreature', iid: f.iid });
    const flashed = g2.players.B.battlefield.find((c) => c.iid === f.iid)!;
    expect(flashed.summoningSick).toBe(true); // it cannot attack...
    expect(canBlock(flashed, atk)).toBe(true); // ...but it can block
    // mana was paid by the DEFENDER
    expect(g2.players.B.battlefield.filter((c) => c.def === 'aether_well' && c.tapped)).toHaveLength(2);
    const g3 = applyAction(g2, { type: 'declareBlockers', blocks: { [f.iid]: atk.iid } });
    expect(onField(g3, f)).toBeDefined(); // a 1/4 survives the 3/3
    expect(g3.phase).toBe('end');
  });

  it('a non-flash creature still cannot be cast in the block step', () => {
    const { g } = blockStep();
    const plain = creature(2, 2, [], { cost: 1 })('B');
    g.players.B.hand = [plain];
    expect(() => applyAction(g, { type: 'castCreature', iid: plain.iid })).toThrow(/phase/i);
    expect(legalActions(g, 'B').some((a) => a.type === 'castCreature')).toBe(false);
  });

  it('can be cast in the attack step and in the main phase, but not in the end step', () => {
    const f = creature(1, 4, ['flash'], { cost: 1 })('A');
    const g = base();
    g.players.A.battlefield = lands(1);
    g.players.A.hand = [f];
    expect(legalActions(g, 'A').some((a) => a.type === 'castCreature')).toBe(true); // main
    const atkStep = { ...structuredClone(g), phase: 'combat_attack' as const, combat: { attackers: [], blocks: {} } };
    expect(legalActions(atkStep, 'A').some((a) => a.type === 'castCreature')).toBe(true);
    const end = { ...structuredClone(g), phase: 'end' as const };
    expect(() => applyAction(end, { type: 'castCreature', iid: f.iid })).toThrow();
  });

  it('a flash creature with a targeted enter effect lets the DEFENDER choose the target', () => {
    const f = creature(1, 4, ['flash'], { cost: 1, skill: 'Zap', onEnter: killer })('B');
    const atk = creature(3, 3)('A', { tapped: true });
    const g = base();
    g.phase = 'combat_block';
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = lands(1, 'B');
    g.players.B.hand = [f];
    g.combat = { attackers: [atk.iid], blocks: {} };
    const g2 = applyAction(g, { type: 'castCreature', iid: f.iid });
    expect(g2.pending).toMatchObject({ controller: 'B' });
    expect(actorOf(g2)).toBe('B'); // not the attacker
    const g3 = applyAction(g2, { type: 'resolveTrigger', target: atk.iid });
    expect(onField(g3, atk)).toBeUndefined(); // the attacker is destroyed before blocks
    expect(g3.phase).toBe('combat_block');
    expect(needsCreatureChoice(killer)).toBe(true);
  });
});

describe('card data stays inside what the engine can resolve', () => {
  // A trigger with no human to ask (a dies trigger, a spell trigger, an untargeted enter effect) must
  // not need a target; only a targeted enter effect may, and only damage to a creature.
  it('every real card\'s triggers are resolvable', () => {
    for (const def of Object.values(CARDS)) {
      if (def.id.startsWith('trigtest_') || def.id.startsWith('kwtest_') || def.id.startsWith('tallytest_')) continue;
      for (const eff of [def.onDeath, def.spellTrigger]) {
        if (!eff) continue;
        expect(needsCreatureChoice(eff), `${def.id}: a dies/spell trigger may not need a creature choice`).toBe(false);
      }
      if (def.onEnter && needsCreatureChoice(def.onEnter)) {
        expect(def.onEnter.type === 'damage' && def.onEnter.targets === 'creature', `${def.id}: targeted enter effects must be damage to a creature`).toBe(true);
      }
      if (def.onEnter || def.skill) expect(def.type, def.id).toBe('creature');
    }
  });
});

describe('the AI and flash creatures', () => {
  it('holds a flash creature in its main phase while the enemy has creatures that can attack', () => {
    const f = creature(1, 4, ['flash'], { cost: 2 })('B');
    const g = base();
    g.active = 'B';
    g.players.B.battlefield = lands(2, 'B');
    g.players.B.hand = [f];
    g.players.A.battlefield = [creature(3, 3)('A')];
    expect(pickAction(g, 'B')).toEqual({ type: 'advance' }); // nothing else to do: it keeps the flash creature
    // ...but plays it normally when there is nothing to ambush (otherwise it would never be used)
    g.players.A.battlefield = [];
    expect(pickAction(g, 'B')).toMatchObject({ type: 'castCreature', iid: f.iid });
  });

  it('flashes in a blocker that wins the fight, then blocks with it', () => {
    const wall = creature(3, 5, ['flash'], { cost: 2 })('B'); // kills a 3/3 and survives it
    const atk = creature(3, 3)('A', { tapped: true });
    const g = base();
    g.phase = 'combat_block';
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = lands(2, 'B');
    g.players.B.hand = [wall];
    g.combat = { attackers: [atk.iid], blocks: {} };
    const first = pickAction(g, 'B');
    expect(first).toMatchObject({ type: 'castCreature', iid: wall.iid });
    const g2 = applyAction(g, first);
    const second = pickAction(g2, 'B');
    expect(second).toEqual({ type: 'declareBlockers', blocks: { [wall.iid]: atk.iid } });
  });

  it('does not flash in a creature that would just die for nothing', () => {
    const weak = creature(1, 1, ['flash'], { cost: 1 })('B');
    const atk = creature(5, 5)('A', { tapped: true });
    const g = base();
    g.phase = 'combat_block';
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = lands(1, 'B');
    g.players.B.hand = [weak];
    g.combat = { attackers: [atk.iid], blocks: {} };
    expect(pickAction(g, 'B')).toEqual({ type: 'declareBlockers', blocks: {} }); // life is fine: take it
  });

  it('flashes a chump blocker when the attack would be lethal', () => {
    const weak = creature(1, 1, ['flash'], { cost: 1 })('B');
    const atk = creature(5, 5)('A', { tapped: true });
    const g = base();
    g.phase = 'combat_block';
    g.players.B.life = 4;
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = lands(1, 'B');
    g.players.B.hand = [weak];
    g.combat = { attackers: [atk.iid], blocks: {} };
    expect(pickAction(g, 'B')).toMatchObject({ type: 'castCreature', iid: weak.iid });
  });
});
