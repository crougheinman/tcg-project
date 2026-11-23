import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { blockError, canBlock, duel, legalActions } from '../rules';
import type { CardInstance, GameState, Keyword } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { pickAction } from '../../ai/ai';

// Phase 4a keywords (skulk, bushido, indestructible), tested on throwaway creatures with chosen stats.

let n = 0;
function creature(p: number, t: number, kws: Keyword[] = []) {
  const id = `kw2test_${n++}`;
  CARDS[id] = { id, name: `T${p}/${t} ${kws.join('+') || 'vanilla'}`, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws };
  return (over: Partial<CardInstance> = {}, owner: 'A' | 'B' = 'A'): CardInstance => ({
    iid: `q${n++}`, def: id, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
  });
}

/** A attacks with `atk`; B blocks with `blk` (or not). Returns the state after combat and a liveness check. */
function fight(atk: CardInstance, blk: CardInstance | null) {
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
  return { g, alive };
}

describe('skulk', () => {
  it('cannot be blocked by a creature with greater power, but can by equal or lesser power', () => {
    const skulker = creature(2, 2, ['skulk'])();
    expect(blockError(creature(3, 3)({}, 'B'), skulker)).toMatch(/greater power/);
    expect(canBlock(creature(2, 4)({}, 'B'), skulker)).toBe(true);
    expect(canBlock(creature(1, 1)({}, 'B'), skulker)).toBe(true);
  });
  it('compares the CURRENT power: a pumped skulker can be blocked by a bigger creature, a pumped blocker cannot', () => {
    const skulker = creature(2, 2, ['skulk'])({ buffP: 1 }); // now 3 power
    expect(canBlock(creature(3, 3)({}, 'B'), skulker)).toBe(true);
    const blocker = creature(2, 2)({ tempP: 1 }, 'B'); // now 3 power vs a 2-power skulker
    expect(canBlock(blocker, creature(2, 2, ['skulk'])())).toBe(false);
  });
  it('the engine refuses a declared block it forbids', () => {
    const skulker = creature(2, 2, ['skulk'])();
    const big = creature(4, 4)({}, 'B');
    expect(() => fight(skulker, big)).toThrow(/greater power/);
  });
  it('a creature without skulk is unaffected', () => {
    expect(canBlock(creature(5, 5)({}, 'B'), creature(1, 1)())).toBe(true);
  });
});

describe('bushido', () => {
  it('a bushido attacker that is blocked gets +1/+1 for the fight: a 2/2 beats a 3/3 blocker only with the bonus', () => {
    const ronin = creature(2, 2, ['bushido'])();
    const blocker = creature(2, 3)({}, 'B'); // takes 3 (dies), deals 2 to a 3/3 attacker (survives)
    const f = fight(ronin, blocker);
    expect(f.alive(blocker)).toBe(false);
    expect(f.alive(ronin)).toBe(true);
    const plain = creature(2, 2)();
    const g = fight(plain, creature(2, 3)({}, 'B'));
    expect(g.alive(plain)).toBe(false); // without bushido the same fight kills the attacker
  });
  it('a bushido blocker gets the bonus too', () => {
    const attacker = creature(3, 3)();
    const blocker = creature(2, 3, ['bushido'])({}, 'B'); // 3/4 once blocking: survives 3, deals 3 (kills the 3/3)
    const f = fight(attacker, blocker);
    expect(f.alive(blocker)).toBe(true);
    expect(f.alive(attacker)).toBe(false);
  });
  it('an unblocked bushido attacker gets nothing', () => {
    const f = fight(creature(2, 2, ['bushido'])(), null);
    expect(f.g.players.B.life).toBe(28);
  });
  it('the bonus is until end of turn: gone when the next turn begins', () => {
    const ronin = creature(2, 2, ['bushido'])();
    const f = fight(ronin, creature(1, 1)({}, 'B'));
    const now = f.g.players.A.battlefield.find((c) => c.iid === ronin.iid)!;
    expect([now.tempP, now.tempT]).toEqual([1, 1]);
    const next = applyAction(f.g, { type: 'advance' });
    const later = next.players.A.battlefield.find((c) => c.iid === ronin.iid)!;
    expect([later.tempP ?? 0, later.tempT ?? 0]).toEqual([0, 0]);
  });
  it('duel() (the AI and UI predictor) agrees with the real combat', () => {
    const cases: [CardInstance, CardInstance][] = [
      [creature(2, 2, ['bushido'])(), creature(2, 3)({}, 'B')],
      [creature(3, 3)(), creature(2, 3, ['bushido'])({}, 'B')],
      [creature(2, 2, ['bushido'])(), creature(3, 3, ['bushido'])({}, 'B')],
    ];
    for (const [a, b] of cases) {
      const d = duel(a, b);
      const f = fight(a, b);
      expect(d.atkDies, `${a.def} vs ${b.def}`).toBe(!f.alive(a));
      expect(d.blkDies, `${a.def} vs ${b.def}`).toBe(!f.alive(b));
    }
  });
});

describe('indestructible', () => {
  it('survives lethal combat damage, and deathtouch', () => {
    const wall = creature(1, 2, ['indestructible'])({}, 'B');
    const big = creature(5, 5)();
    const f = fight(big, wall);
    expect(f.alive(wall)).toBe(true);
    const dt = creature(1, 1, ['deathtouch'])();
    const wall2 = creature(1, 2, ['indestructible'])({}, 'B');
    expect(fight(dt, wall2).alive(wall2)).toBe(true);
  });
  it('still deals its damage and can kill what it fights', () => {
    const attacker = creature(2, 2, ['indestructible'])();
    const blocker = creature(1, 2)({}, 'B');
    const f = fight(attacker, blocker);
    expect(f.alive(attacker)).toBe(true);
    expect(f.alive(blocker)).toBe(false);
  });
  it('duel() agrees: an indestructible creature never dies in a fight', () => {
    expect(duel(creature(9, 9)(), creature(1, 1, ['indestructible'])({}, 'B')).blkDies).toBe(false);
    expect(duel(creature(1, 1, ['deathtouch'])(), creature(1, 1, ['indestructible'])({}, 'B')).blkDies).toBe(false);
  });
  it('a destroy effect does nothing to it (and says so)', () => {
    const wall = creature(1, 2, ['indestructible'])({ tapped: true }, 'B');
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.phase = 'main1';
    s.active = 'A';
    s.players.A.battlefield = Array.from({ length: 4 }, (_, i) => ({ iid: `l${i}`, def: 'aether_well', owner: 'A' as const, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false }));
    s.players.B.battlefield = [wall];
    s.players.A.hand = [{ iid: 'cast1', def: 'take_counter', owner: 'A', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false }];
    // take_counter is block-only; use a temporary destroy sorcery instead
    CARDS.kw2_destroy = { id: 'kw2_destroy', name: 'Test Destroy', type: 'sorcery', cost: 1, effect: { type: 'destroy', targets: 'creature' } };
    s.players.A.hand = [{ ...s.players.A.hand[0], def: 'kw2_destroy' }];
    const g: GameState = applyAction(s, { type: 'castSorcery', iid: 'cast1', target: { kind: 'creature', iid: wall.iid } });
    expect(g.players.B.battlefield.some((c) => c.iid === wall.iid)).toBe(true);
    expect(g.log.some((l) => /is indestructible/.test(l))).toBe(true);
    delete CARDS.kw2_destroy;
  });
  it('dies when its toughness falls to 0 (the one thing that still kills it)', () => {
    const c = creature(1, 1, ['indestructible'])({ buffT: -1 }, 'B');
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.phase = 'main1';
    s.players.B.battlefield = [c];
    const g = applyAction(s, { type: 'advance' }); // any action runs the death check
    expect(g.players.B.battlefield.some((x) => x.iid === c.iid)).toBe(false);
  });
  it('the AI never aims destroy or burn at it', () => {
    // pickAction on a board where the only creature target is indestructible must not pick a kill spell for it
    const wall = creature(1, 2, ['indestructible'])({ tapped: true }, 'A');
    const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
    s.phase = 'main1';
    s.active = 'B';
    s.players.A.battlefield = [wall];
    s.players.B.battlefield = Array.from({ length: 4 }, (_, i) => ({ iid: `m${i}`, def: 'aether_well', owner: 'B' as const, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false }));
    CARDS.kw2_destroy = { id: 'kw2_destroy', name: 'Test Destroy', type: 'sorcery', cost: 1, effect: { type: 'destroy', targets: 'creature' } };
    s.players.B.hand = [{ iid: 'cast9', def: 'kw2_destroy', owner: 'B', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false }];
    expect(legalActions(s, 'B').some((a) => a.type === 'castSorcery')).toBe(true); // it is legal...
    const a = pickAction(s, 'B');
    expect(a.type === 'castSorcery').toBe(false); // ...but pointless, so the AI does not do it
    delete CARDS.kw2_destroy;
  });
});
