import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { pickAction } from '../ai';
import { opponentOf, type GameState } from '../../engine/types';
import { isLand } from '../../engine/rules';
import { DECK_EMBERWOOD, DECK_SKYWARD, DECK_LIST } from '../../cards/decks';

// Drive a full AI-vs-AI game. Both sides use the heuristic AI.
function playOut(seed: number, deckA = DECK_EMBERWOOD, deckB = DECK_SKYWARD): {
  g: GameState;
  steps: number;
  maxLands: number;
} {
  let g = createInitialState(seed, deckA, deckB);
  let steps = 0;
  let maxLands = 0;
  while (!g.winner && steps < 4000) {
    const actor = g.phase === 'combat_block' ? opponentOf(g.active) : g.active;
    g = applyAction(g, pickAction(g, actor));
    for (const pid of ['A', 'B'] as const) {
      maxLands = Math.max(maxLands, g.players[pid].battlefield.filter(isLand).length);
    }
    steps++;
  }
  return { g, steps, maxLands };
}

describe('AI plays a full game', () => {
  it('terminates with a winner and develops the board across many seeds', () => {
    for (const seed of [1, 7, 42, 99, 256, 2026, 31337]) {
      const { g, steps, maxLands } = playOut(seed);
      expect(steps).toBeLessThan(4000); // no infinite loop / stalemate
      expect(g.winner).not.toBeNull(); // someone wins (life or deckout)
      expect(maxLands).toBeGreaterThan(0); // AI actually plays lands
    }
  });

  it('AI casts creatures and deals combat damage over a game', () => {
    // Aggregate across seeds: at least one game should drop a life total well
    // below 20 via creatures/burn (proves the AI attacks, not just decks out).
    let sawRealDamage = false;
    for (const seed of [3, 11, 77, 500, 8123]) {
      const { g } = playOut(seed);
      const loserLife = Math.min(g.players.A.life, g.players.B.life);
      if (loserLife <= 0) sawRealDamage = true;
    }
    expect(sawRealDamage).toBe(true);
  });

  it('every deck pairing plays to completion without errors (new mechanics included)', () => {
    for (let i = 0; i < DECK_LIST.length; i++) {
      const a = DECK_LIST[i].cards;
      const b = DECK_LIST[(i + 1) % DECK_LIST.length].cards;
      const { g, steps } = playOut(909 + i, a, b);
      expect(steps).toBeLessThan(4000); // ramp/token/heal don't stall the AI
      expect(g.winner).not.toBeNull();
    }
  });
});
