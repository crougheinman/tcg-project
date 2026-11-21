import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { blockStepIsEmpty, phaseBannerInfo } from '../phaseInfo';
import type { CardInstance } from '../../engine/types';
import type { GameState } from '../../engine/types';

const game = (active: 'A' | 'B', phase: GameState['phase']): GameState => {
  const g = createInitialState(5, DECK_EMBERWOOD, DECK_SKYWARD);
  g.active = active;
  g.phase = phase;
  g.turn = 4;
  return g;
};

describe('phase banner text', () => {
  it('says whose turn it is, from the local seat', () => {
    expect(phaseBannerInfo(game('A', 'main1'), 'A')).toMatchObject({ mine: true, turnLabel: 'Your turn', title: 'Main phase' });
    expect(phaseBannerInfo(game('B', 'main1'), 'A')).toMatchObject({ mine: false, turnLabel: "Enemy's turn", title: 'Main phase' });
  });
  it('names each phase', () => {
    expect(phaseBannerInfo(game('A', 'combat_attack'), 'A').title).toBe('Attack phase');
    expect(phaseBannerInfo(game('A', 'combat_block'), 'A').title).toBe('Block phase');
    expect(phaseBannerInfo(game('A', 'end'), 'A').title).toBe('End phase');
  });
  it('in the block step the hint follows who must act (the defender), not the turn owner', () => {
    const mineAttacking = phaseBannerInfo(game('A', 'combat_block'), 'A');
    expect(mineAttacking.mine).toBe(true); // still my turn...
    expect(mineAttacking.hint).toBe('Enemy is choosing blockers'); // ...but the enemy decides
    const enemyAttacking = phaseBannerInfo(game('B', 'combat_block'), 'A');
    expect(enemyAttacking.mine).toBe(false);
    expect(enemyAttacking.hint).toBe('Choose your blockers');
  });
  it('has a new key whenever the phase, turn or owner changes (so the banner replays)', () => {
    const keys = new Set([
      phaseBannerInfo(game('A', 'main1'), 'A').key,
      phaseBannerInfo(game('A', 'combat_attack'), 'A').key,
      phaseBannerInfo(game('B', 'main1'), 'A').key,
    ]);
    expect(keys.size).toBe(3);
    expect(phaseBannerInfo(game('A', 'main1'), 'A').key).toBe(phaseBannerInfo(game('A', 'main1'), 'B').key); // seat does not matter
  });
});

describe('a block step with nothing to decide', () => {
  let n = 0;
  const mk = (def: string, owner: 'A' | 'B', over: Partial<CardInstance> = {}): CardInstance => ({
    iid: `b${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
  });
  /** A attacks with `attacker`; B has `blockers` untapped, `hand` in hand and `lands` untapped lands. */
  function step(attacker: string, blockers: string[], hand: string[] = [], lands = 0): GameState {
    const g = game('A', 'combat_block');
    const atk = mk(attacker, 'A', { tapped: true });
    g.players.A.battlefield = [atk];
    g.players.B.battlefield = [...blockers.map((d) => mk(d, 'B')), ...Array.from({ length: lands }, () => mk('aether_well', 'B'))];
    g.players.B.hand = hand.map((d) => mk(d, 'B'));
    g.combat = { attackers: [atk.iid], blocks: {} };
    return g;
  }

  it('is empty when the defender has no creatures at all', () => {
    expect(blockStepIsEmpty(step('ashigaru', []))).toBe(true);
  });
  it('is not empty when a creature can block', () => {
    expect(blockStepIsEmpty(step('ashigaru', ['stoneback_cub']))).toBe(false);
  });
  it('is empty when every creature is tapped', () => {
    const g = step('ashigaru', ['stoneback_cub']);
    g.players.B.battlefield[0].tapped = true;
    expect(blockStepIsEmpty(g)).toBe(true);
  });
  it('is empty when the only attacker flies and nothing can reach it, but not when a flyer or reach creature stands ready', () => {
    expect(blockStepIsEmpty(step('sky_talon', ['stoneback_cub']))).toBe(true);
    expect(blockStepIsEmpty(step('sky_talon', ['sky_talon']))).toBe(false);
  });
  it('is not empty while the defender holds an instant they can afford (a counter-play is possible)', () => {
    expect(blockStepIsEmpty(step('ashigaru', [], ['warding_stance'], 3))).toBe(false);
    expect(blockStepIsEmpty(step('ashigaru', [], ['warding_stance'], 0))).toBe(true); // no mana: nothing to do
  });
  it('is never "empty" outside the block step', () => {
    const g = step('ashigaru', []);
    g.phase = 'combat_attack';
    expect(blockStepIsEmpty(g)).toBe(false);
  });
});
