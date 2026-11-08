import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { pickAction } from '../ai';
import type { Action, CardInstance, GameState } from '../../engine/types';
import { actorOf, isLand, legalActions } from '../../engine/rules';
import { DECK_EMBERWOOD, DECK_SKYWARD, DECK_LIST, DECK_GRAVETIDE } from '../../cards/decks';
import { getDef } from '../../cards/cards';

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
    g = applyAction(g, pickAction(g, actorOf(g)));
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

let counter = 0;
function inst(def: string, over: Partial<CardInstance> = {}): CardInstance {
  return {
    iid: `a${counter++}`,
    def,
    owner: 'A',
    tapped: false,
    summoningSick: false,
    damage: 0,
    buffP: 0,
    buffT: 0,
    blitz: false,
    ...over,
  };
}

describe('AI only ever plays legal moves', () => {
  // The AI ranks candidates from `rules.legalActions` instead of generating its
  // own, so the two legality models cannot drift. This asserts that directly:
  // every non-combat-declaration action it picks must be one the rules offered.
  it('every picked action is one legalActions enumerated', () => {
    for (const seed of [5, 61, 404, 1234, 90210]) {
      let g = createInitialState(seed, DECK_GRAVETIDE, DECK_LIST[5].cards);
      let steps = 0;
      while (!g.winner && steps < 4000) {
        const actor = actorOf(g);
        const action = pickAction(g, actor);
        // Attack sets and block assignments are combinatorial and built directly.
        if (action.type !== 'declareAttackers' && action.type !== 'declareBlockers') {
          const legal = legalActions(g, actor);
          expect(
            legal.some((l) => JSON.stringify(l) === JSON.stringify(action)),
            `illegal ${action.type} in ${g.phase}`,
          ).toBe(true);
        }
        g = applyAction(g, action);
        steps++;
      }
      expect(g.winner).not.toBeNull();
    }
  });
});

describe('AI combat tricks', () => {
  it('casts block-only removal to kill an attacker instead of just blocking', () => {
    // B holds Grasp from the Grave (block-only: destroy a tapped creature) and
    // has mana up. A swings with a fat creature; the old AI could only block.
    let g = createInitialState(7, DECK_EMBERWOOD, DECK_GRAVETIDE);
    const attacker = inst('dread_maw', { summoningSick: false }); // 5/4
    g.players.A.battlefield = [attacker];
    g.players.B.battlefield = [
      inst('aether_well', { owner: 'B' }),
      inst('aether_well', { owner: 'B' }),
      inst('aether_well', { owner: 'B' }),
    ];
    g.players.B.hand = [inst('grasp_from_grave', { owner: 'B' })];
    g = applyAction(g, { type: 'advance' });
    g = applyAction(g, { type: 'declareAttackers', attackers: [attacker.iid] });
    expect(g.phase).toBe('combat_block');

    const action = pickAction(g, 'B');
    expect(action.type).toBe('castSorcery');
    g = applyAction(g, action);
    expect(g.players.A.battlefield.some((c) => c.iid === attacker.iid)).toBe(false);

    // Then it finishes the combat normally and takes no damage.
    g = applyAction(g, pickAction(g, 'B'));
    expect(g.players.B.life).toBe(20);
  });

  it('does not burn a face that is not lethal', () => {
    // Cinderbolt in hand, opponent at full life and no creatures to kill: the
    // AI should develop or pass rather than throw the burn away.
    let g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
    g.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    g.players.A.hand = [inst('cinderbolt')];
    g.players.B.battlefield = [];
    g.players.B.life = 20;
    const action = pickAction(g, 'A');
    expect(action.type).not.toBe('castSorcery');
  });

  it('burns the face when it is exactly lethal', () => {
    let g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
    g.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    g.players.A.hand = [inst('cinderbolt')];
    g.players.B.battlefield = [];
    g.players.B.life = getDef('cinderbolt').effect!.type === 'damage'
      ? (getDef('cinderbolt').effect as { amount: number }).amount
      : 1;
    const action = pickAction(g, 'A') as Extract<Action, { type: 'castSorcery' }>;
    expect(action.type).toBe('castSorcery');
    expect(action.target).toEqual({ kind: 'player', player: 'B' });
  });
});
