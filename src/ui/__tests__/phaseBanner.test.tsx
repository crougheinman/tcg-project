import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createInitialState } from '../../engine/state';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { CardInstance, GameState } from '../../engine/types';
import { PhaseBanner } from '../PhaseBanner';
import { PHASE_BANNER_MS, PHASE_GAP_MS } from '../fxTiming';

const mk = (def: string, owner: 'A' | 'B', iid: string): CardInstance => ({
  iid, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
});

/** A's turn, A's ashigaru attacking; B has `blockers` creatures. */
function table(phase: GameState['phase'], blockers: string[]): GameState {
  const g = createInitialState(5, DECK_EMBERWOOD, DECK_SKYWARD);
  g.active = 'A';
  g.turn = 5;
  g.phase = phase;
  g.players.A.battlefield = [mk('ashigaru', 'A', 'atk')];
  g.players.B.battlefield = blockers.map((d, i) => mk(d, 'B', `blk${i}`));
  g.players.B.hand = [];
  g.combat = phase === 'combat_block' ? { attackers: ['atk'], blocks: {} } : { attackers: [], blocks: {} };
  return g;
}

describe('the board hold when a block step needs no banner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Board.tsx sets its `hold` on every phase change and only PhaseBanner's onLock(false) releases it. An empty block
  // step shows no banner, so it must release the hold itself, including while the previous banner has already left but
  // its gap (PHASE_GAP_MS) is still running: nothing else will release it then, and the board would stay frozen on the
  // old state until Board's 15 s failsafe (the human's block gesture ignored, the AI's attack not drawn).
  it('releases the hold at once when the previous banner has left but its gap is still running', () => {
    const onLock = vi.fn();
    const view = render(<PhaseBanner game={table('combat_attack', ['stoneback_cub'])} localId="A" guided={false} onLock={onLock} />);
    act(() => { vi.advanceTimersByTime(PHASE_BANNER_MS + 400); }); // the attack banner is gone and its lock has released
    expect(onLock).toHaveBeenLastCalledWith(false);
    onLock.mockClear();
    // inside the gap: the next phase is an empty block step (the defender has nothing that can block)
    act(() => { vi.advanceTimersByTime(PHASE_GAP_MS / 2 - 400 + 400); });
    view.rerender(<PhaseBanner game={table('combat_block', [])} localId="A" guided={false} onLock={onLock} />);
    expect(onLock).toHaveBeenCalledWith(false);
  });

  it('still shows the block banner when something can block', () => {
    const onLock = vi.fn();
    const view = render(<PhaseBanner game={table('combat_attack', ['stoneback_cub'])} localId="A" guided={false} onLock={onLock} />);
    act(() => { vi.advanceTimersByTime(PHASE_BANNER_MS + 400 + PHASE_GAP_MS + 100); });
    onLock.mockClear();
    view.rerender(<PhaseBanner game={table('combat_block', ['stoneback_cub'])} localId="A" guided={false} onLock={onLock} />);
    expect(onLock).toHaveBeenCalledWith(true); // locked for the banner that is about to play
    expect(view.container.textContent).toContain('Block phase');
  });
});
