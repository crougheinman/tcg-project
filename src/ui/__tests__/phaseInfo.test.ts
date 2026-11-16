import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { phaseBannerInfo } from '../phaseInfo';
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
