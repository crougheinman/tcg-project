import { describe, it, expect } from 'vitest';
import { createInitialState, MAX_MULLIGANS, OPENING_HAND } from '../state';
import { applyAction } from '../reducer';
import { actorOf, legalActions } from '../rules';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { pickAction } from '../../ai/ai';
import type { CardInstance, GameState } from '../types';

const fresh = (seed = 5) => createInitialState(seed, DECK_EMBERWOOD, DECK_SKYWARD, { mulligan: true });
const ids = (p: GameState['players']['A']) => [...p.hand, ...p.library].map((c) => c.iid).sort();
const land = (): CardInstance => ({ iid: 'ml', def: 'aether_well', owner: 'A', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });
const spell = (i: number): CardInstance => ({ iid: `ms${i}`, def: 'cinderbolt', owner: 'A', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });

describe('mulligan', () => {
  it('is opt-in: without the option a game starts in the main phase, as before', () => {
    const g = createInitialState(5, DECK_EMBERWOOD, DECK_SKYWARD);
    expect(g.phase).toBe('main1');
    expect(g.mulligan).toBeNull();
    expect(() => applyAction(g, { type: 'keepHand' })).toThrow(/not the mulligan phase/);
  });

  it('opens with A deciding; nothing else is legal until both have decided', () => {
    const g = fresh();
    expect(g.phase).toBe('mulligan');
    expect(actorOf(g)).toBe('A');
    expect(legalActions(g, 'A').map((a) => a.type)).toEqual(['keepHand', 'mulligan']);
    expect(legalActions(g, 'B')).toEqual([]);
    expect(() => applyAction(g, { type: 'advance' })).toThrow(/opening hand/);
    expect(() => applyAction(g, { type: 'playLand', iid: g.players.A.hand[0].iid })).toThrow(/opening hand/);
  });

  it('A keeps, then B decides; when B keeps the game begins on A\'s main phase', () => {
    let g = applyAction(fresh(), { type: 'keepHand' });
    expect(g.phase).toBe('mulligan');
    expect(actorOf(g)).toBe('B');
    g = applyAction(g, { type: 'keepHand' });
    expect(g.phase).toBe('main1');
    expect(g.mulligan).toBeNull();
    expect(g.active).toBe('A');
    expect(g.players.A.hand).toHaveLength(OPENING_HAND);
    expect(g.log.some((l) => /The game begins/.test(l))).toBe(true);
  });

  it('a mulligan reshuffles the hand into the deck and draws one card fewer, losing no card', () => {
    const g0 = fresh();
    const before = ids(g0.players.A);
    const g1 = applyAction(g0, { type: 'mulligan' });
    expect(g1.players.A.hand).toHaveLength(OPENING_HAND - 1);
    expect(ids(g1.players.A)).toEqual(before); // the same cards, split differently
    expect(g1.players.A.library).toHaveLength(g0.players.A.library.length + 1);
    expect(g1.players.B.hand).toEqual(g0.players.B.hand); // B is untouched
    expect(actorOf(g1)).toBe('A'); // A decides again on the new hand
    expect(g1.rngState).not.toBe(g0.rngState);
    expect(g1.players.A.hand.map((c) => c.iid)).not.toEqual(g0.players.A.hand.slice(0, 6).map((c) => c.iid)); // really reshuffled
  });

  it('is deterministic: the same actions always produce the same hand (online play relies on it)', () => {
    const run = () => applyAction(applyAction(fresh(9), { type: 'mulligan' }), { type: 'mulligan' });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('can be repeated down to the limit, each time one card fewer, then no further', () => {
    let g = fresh();
    for (let i = 1; i <= MAX_MULLIGANS; i++) {
      g = applyAction(g, { type: 'mulligan' });
      expect(g.players.A.hand).toHaveLength(OPENING_HAND - i);
    }
    expect(legalActions(g, 'A').map((a) => a.type)).toEqual(['keepHand']);
    expect(() => applyAction(g, { type: 'mulligan' })).toThrow(/no more mulligans/);
  });

  it('counts mulligans per player: B still has all of theirs after A used some', () => {
    let g = applyAction(applyAction(fresh(), { type: 'mulligan' }), { type: 'keepHand' }); // A mulls once, keeps; B decides
    expect(g.mulligan!.taken).toEqual({ A: 1, B: 0 });
    g = applyAction(g, { type: 'mulligan' });
    expect(g.players.B.hand).toHaveLength(OPENING_HAND - 1);
    expect(g.players.A.hand).toHaveLength(OPENING_HAND - 1); // A's smaller hand stays
    g = applyAction(g, { type: 'keepHand' });
    expect(g.phase).toBe('main1');
  });
});

describe('the AI\'s opening-hand rule', () => {
  function withHand(lands: number) {
    const g = fresh();
    g.players.B.hand = [...Array.from({ length: lands }, (_, i) => ({ ...land(), iid: `l${i}` })), ...Array.from({ length: OPENING_HAND - lands }, (_, i) => spell(i))];
    g.mulligan = { deciding: 'B', taken: { A: 0, B: 0 } };
    return g;
  }
  it('keeps a workable hand (2 to 5 lands of 7)', () => {
    for (const k of [2, 3, 4, 5]) expect(pickAction(withHand(k), 'B')).toEqual({ type: 'keepHand' });
  });
  it('mulligans a hand with almost no lands or nothing but lands', () => {
    for (const k of [0, 1, 6, 7]) expect(pickAction(withHand(k), 'B')).toEqual({ type: 'mulligan' });
  });
  it('keeps whatever it has once it can mulligan no more', () => {
    const g = withHand(0);
    g.mulligan!.taken.B = MAX_MULLIGANS;
    expect(pickAction(g, 'B')).toEqual({ type: 'keepHand' });
  });
});
