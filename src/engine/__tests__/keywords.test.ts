import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { blockError, canBlock, duel } from '../rules';
import type { CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { pickAction } from '../../ai/ai';
import { KEYWORD_INFO } from '../../cards/keywords';

// Combat keywords, tested on throwaway creatures with chosen stats so each rule stands alone
// (not on whichever real cards happen to carry it today).

let n = 0;
/** Register a test-only creature and return a factory for instances of it. */
function creature(p: number, t: number, kws: Keyword[] = []) {
  const id = `kwtest_${n++}`;
  CARDS[id] = { id, name: `T${p}/${t} ${kws.join('+') || 'vanilla'}`, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws };
  return (over: Partial<CardInstance> = {}, owner: 'A' | 'B' = 'A'): CardInstance => ({
    iid: `k${n++}`, def: id, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
  });
}

interface Fight {
  g: GameState;
  atk: CardInstance;
  blk: CardInstance | null;
  alive: (c: CardInstance) => boolean;
  life: { A: number; B: number };
}

/** A attacks with `atk`; B blocks with `blk` (or does not block). Both players start at 30 life. */
function fight(atk: CardInstance, blk: CardInstance | null): Fight {
  const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
  s.players.A.life = 30;
  s.players.B.life = 30;
  s.players.A.battlefield = [atk];
  s.players.B.battlefield = blk ? [{ ...blk, owner: 'B' }] : [];
  s.phase = 'combat_attack';
  s.combat = { attackers: [], blocks: {} };
  let g = applyAction(s, { type: 'declareAttackers', attackers: [atk.iid] });
  g = applyAction(g, { type: 'declareBlockers', blocks: blk ? { [blk.iid]: atk.iid } : {} });
  const alive = (c: CardInstance) => [...g.players.A.battlefield, ...g.players.B.battlefield].some((x) => x.iid === c.iid);
  return { g, atk, blk, alive, life: { A: g.players.A.life, B: g.players.B.life } };
}

describe('reach', () => {
  it('lets a creature block a flyer; a plain one still cannot', () => {
    const flyer = creature(2, 2, ['flying'])();
    const reach = creature(1, 3, ['reach'])({}, 'B');
    const plain = creature(1, 3)({}, 'B');
    expect(blockError(reach, flyer)).toBeNull();
    expect(canBlock(plain, flyer)).toBe(false);
    expect(blockError(plain, flyer)).toMatch(/flyers or reach creatures/);
    expect(fight(flyer, reach).alive(reach)).toBe(true); // the engine accepts the block and it resolves
  });
  it('does not make a creature able to FLY: a flying blocker rule is unchanged', () => {
    const ground = creature(2, 2)();
    const reach = creature(1, 3, ['reach'])({}, 'B');
    expect(canBlock(reach, ground)).toBe(true);
  });
});

describe('vigilance', () => {
  it('an attacker with vigilance stays untapped; one without taps', () => {
    const v = creature(2, 2, ['vigilance'])();
    const plain = creature(2, 2)();
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.players.A.battlefield = [v, plain];
    s.phase = 'combat_attack';
    s.combat = { attackers: [], blocks: {} };
    const g = applyAction(s, { type: 'declareAttackers', attackers: [v.iid, plain.iid] });
    expect(g.players.A.battlefield.find((c) => c.iid === v.iid)!.tapped).toBe(false);
    expect(g.players.A.battlefield.find((c) => c.iid === plain.iid)!.tapped).toBe(true);
    expect(g.combat!.attackers).toEqual([v.iid, plain.iid]); // still attacking, untapped or not
  });
});

describe('first strike', () => {
  it('kills the blocker before it can strike back', () => {
    const f = fight(creature(3, 2, ['firstStrike'])(), creature(2, 3)());
    expect(f.alive(f.atk)).toBe(true); // took no damage
    expect(f.alive(f.blk!)).toBe(false);
  });
  it('a first striker that does NOT kill its blocker still takes the return damage', () => {
    const f = fight(creature(2, 2, ['firstStrike'])(), creature(3, 3)());
    expect(f.alive(f.atk)).toBe(false);
    expect(f.alive(f.blk!)).toBe(true);
  });
  it('first strike on a blocker kills the attacker first', () => {
    const f = fight(creature(3, 2)(), creature(2, 3, ['firstStrike'])());
    expect(f.alive(f.atk)).toBe(false);
    expect(f.alive(f.blk!)).toBe(true); // never took the attacker's damage
  });
  it('two first strikers trade together in the first step', () => {
    const f = fight(creature(2, 2, ['firstStrike'])(), creature(2, 2, ['firstStrike'])());
    expect(f.alive(f.atk)).toBe(false);
    expect(f.alive(f.blk!)).toBe(false);
  });
  it('an unblocked first striker hits the player', () => {
    expect(fight(creature(3, 3, ['firstStrike'])(), null).life.B).toBe(27);
  });
});

describe('double strike', () => {
  it('hits an unblocked player twice', () => {
    expect(fight(creature(2, 2, ['doubleStrike'])(), null).life.B).toBe(26);
  });
  it('kills a bigger blocker with its two hits, and dies to the blocker in the second step', () => {
    const f = fight(creature(2, 2, ['doubleStrike'])(), creature(3, 4)());
    expect(f.alive(f.blk!)).toBe(false); // 2 + 2 = 4
    expect(f.alive(f.atk)).toBe(false); // the blocker's 3 lands in step 2, alongside the second hit
  });
  it('kills a small blocker in the first step and takes no damage', () => {
    const f = fight(creature(3, 3, ['doubleStrike'])(), creature(2, 2)());
    expect(f.alive(f.blk!)).toBe(false);
    expect(f.alive(f.atk)).toBe(true);
  });
  it('a blocked attacker stays blocked after its blocker dies: nothing reaches the player', () => {
    const f = fight(creature(2, 2, ['doubleStrike'])(), creature(1, 1)());
    expect(f.alive(f.blk!)).toBe(false);
    expect(f.life.B).toBe(30);
  });
});

describe('trample', () => {
  it('assigns lethal to the blocker and the rest to the player', () => {
    const f = fight(creature(5, 5, ['trample'])(), creature(2, 2)());
    expect(f.alive(f.blk!)).toBe(false);
    expect(f.life.B).toBe(27);
  });
  it('counts damage already marked on the blocker', () => {
    const f = fight(creature(5, 5, ['trample'])(), creature(2, 3)({ damage: 2 }));
    expect(f.life.B).toBe(26); // only 1 more was needed for lethal, so 4 of the 5 go over
  });
  it('a blocker bigger than the damage soaks all of it', () => {
    const f = fight(creature(3, 3, ['trample'])(), creature(1, 5)());
    expect(f.life.B).toBe(30);
    expect(f.alive(f.blk!)).toBe(true);
  });
  it('without trample a blocked attacker deals nothing to the player', () => {
    expect(fight(creature(5, 5)(), creature(1, 1)()).life.B).toBe(30);
  });
  it('with deathtouch only 1 damage is needed per blocker', () => {
    const f = fight(creature(4, 4, ['trample', 'deathtouch'])(), creature(1, 6)());
    expect(f.alive(f.blk!)).toBe(false);
    expect(f.life.B).toBe(27);
  });
  it('double strike + trample: all of the second hit goes over once the blocker is dead', () => {
    const f = fight(creature(2, 2, ['doubleStrike', 'trample'])(), creature(1, 1)());
    expect(f.life.B).toBe(27); // 1 over in step 1, 2 in step 2
  });
});

describe('deathtouch', () => {
  it('a 1-power deathtouch blocker kills a big attacker', () => {
    const f = fight(creature(6, 6)(), creature(1, 1, ['deathtouch'])());
    expect(f.alive(f.atk)).toBe(false);
  });
  it('a deathtouch attacker kills any blocker', () => {
    const f = fight(creature(1, 1, ['deathtouch'])(), creature(0, 9)());
    expect(f.alive(f.blk!)).toBe(false);
  });
  it('zero damage is not lethal', () => {
    const f = fight(creature(0, 3, ['deathtouch'])(), creature(0, 3)());
    expect(f.alive(f.blk!)).toBe(true);
  });
  it('first strike + deathtouch kills before the return strike', () => {
    const f = fight(creature(1, 1, ['firstStrike', 'deathtouch'])(), creature(5, 5)());
    expect(f.alive(f.atk)).toBe(true);
    expect(f.alive(f.blk!)).toBe(false);
  });
});

describe('lifelink', () => {
  it('an unblocked lifelinker gains what it deals', () => {
    const f = fight(creature(3, 3, ['lifelink'])(), null);
    expect(f.life).toEqual({ A: 33, B: 27 });
  });
  it('gains the full damage dealt to a creature, even past lethal', () => {
    const f = fight(creature(5, 5, ['lifelink'])(), creature(1, 1)());
    expect(f.life.A).toBe(35);
  });
  it('a lifelink BLOCKER gains its controller life', () => {
    const f = fight(creature(2, 2)(), creature(3, 3, ['lifelink'])());
    expect(f.life.B).toBe(33);
  });
  it('double strike + lifelink gains on both hits', () => {
    expect(fight(creature(2, 2, ['doubleStrike', 'lifelink'])(), null).life).toEqual({ A: 34, B: 26 });
  });
  it('no damage dealt means no life gained (blocker gone, no trample)', () => {
    const f = fight(creature(2, 2, ['doubleStrike', 'lifelink'])(), creature(1, 1)());
    expect(f.life.A).toBe(32); // only the first hit landed
  });
  it('can win the race: the gain lands in the same step as the damage', () => {
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.players.A.life = 1;
    s.players.B.life = 3;
    const atk = creature(3, 3, ['lifelink'])();
    s.players.A.battlefield = [atk];
    s.phase = 'combat_attack';
    s.combat = { attackers: [], blocks: {} };
    let g = applyAction(s, { type: 'declareAttackers', attackers: [atk.iid] });
    g = applyAction(g, { type: 'declareBlockers', blocks: {} });
    expect(g.winner).toBe('A');
    expect(g.players.A.life).toBe(4);
  });
});

// The AI judges a block with `duel`. If it ever disagrees with the real resolution the AI makes
// confidently wrong blocks, so hold the two equal over a large random sample of keyword/stat mixes.
describe('duel (the AI\'s predictor) matches the real combat resolution', () => {
  const KW: Keyword[] = ['firstStrike', 'doubleStrike', 'trample', 'deathtouch', 'lifelink'];
  function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  it('agrees on 3000 random fights', () => {
    const r = rng(2024);
    const pick = (max: number) => Math.floor(r() * (max + 1));
    const kws = (): Keyword[] => KW.filter(() => r() < 0.3);
    for (let i = 0; i < 3000; i++) {
      const atk = creature(pick(6), 1 + pick(5), kws())({ damage: r() < 0.2 ? 1 : 0 });
      const blk = creature(pick(6), 1 + pick(5), kws())({ damage: r() < 0.2 ? 1 : 0 });
      // a creature already at lethal damage would be dead before combat; that is not a fight
      if (atk.damage >= CARDS[atk.def].toughness! || blk.damage >= CARDS[blk.def].toughness!) continue;
      const p = duel(atk, { ...blk, owner: 'B' });
      const f = fight(atk, blk);
      const label = `${CARDS[atk.def].name} (dmg ${atk.damage}) vs ${CARDS[blk.def].name} (dmg ${blk.damage})`;
      expect([label, 'atkDies', !f.alive(f.atk)]).toEqual([label, 'atkDies', p.atkDies]);
      expect([label, 'blkDies', !f.alive(f.blk!)]).toEqual([label, 'blkDies', p.blkDies]);
      expect([label, 'atkLife', f.life.A]).toEqual([label, 'atkLife', 30 + p.atkGain]);
      expect([label, 'defLife', f.life.B]).toEqual([label, 'defLife', 30 - p.toFace + p.blkGain]);
    }
  });
});

describe('the AI uses the real combat rules when it blocks', () => {
  function blockDecision(atkMk: CardInstance, blockers: CardInstance[]) {
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.players.A.life = 30;
    s.players.B.life = 30;
    s.players.A.battlefield = [atkMk];
    s.players.B.battlefield = blockers.map((b) => ({ ...b, owner: 'B' as const }));
    s.phase = 'combat_attack';
    s.combat = { attackers: [], blocks: {} };
    const g = applyAction(s, { type: 'declareAttackers', attackers: [atkMk.iid] });
    const a = pickAction(g, 'B');
    return a.type === 'declareBlockers' ? Object.keys(a.blocks) : [];
  }
  it('blocks a big attacker with the deathtouch creature, not a bigger vanilla one that cannot kill it', () => {
    const dt = creature(1, 1, ['deathtouch'])();
    const big = creature(3, 5)();
    expect(blockDecision(creature(5, 5)(), [dt, big])).toEqual([dt.iid]);
  });
  it('does not feed a creature to a first striker it cannot beat', () => {
    // a 2/2 blocking a 2/2 first striker dies without killing it
    expect(blockDecision(creature(2, 2, ['firstStrike'])(), [creature(2, 2)()])).toEqual([]);
  });
  it('blocks a flyer with a reach creature', () => {
    const reach = creature(2, 4, ['reach'])();
    expect(blockDecision(creature(3, 2, ['flying'])(), [reach])).toEqual([reach.iid]);
  });
});

describe('every keyword is documented', () => {
  it('has a label and rule text, and every keyword a real card carries is a known keyword', () => {
    for (const [k, v] of Object.entries(KEYWORD_INFO)) {
      expect(v.label.length, k).toBeGreaterThan(0);
      expect(v.rule.length, k).toBeGreaterThan(10);
    }
    for (const def of Object.values(CARDS)) {
      if (def.id.startsWith('kwtest_')) continue; // throwaway test creatures
      for (const k of def.keywords ?? []) expect(KEYWORD_INFO[k], `${def.id}: ${k}`).toBeDefined();
    }
  });
});
