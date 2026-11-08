import { getDef } from '../cards/cards';
import { isCreature } from '../engine/rules';
import type { Action, GameState, PlayerId } from '../engine/types';

// WHICH sound an action deserves — pure, so it lives in the fast `engine` test
// project. The synth that actually makes noise is in sfx.ts and needs a browser.
// Splitting them keeps the interesting part (the mapping) under test.

export type Cue =
  | 'land'
  | 'creature'
  | 'spell'
  | 'burn'
  | 'heal'
  | 'attack'
  | 'block'
  | 'death'
  | 'turn'
  | 'win'
  | 'lose';

/** Creatures on either battlefield, by instance id. */
function creatureIds(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const c of s.players[pid].battlefield) if (isCreature(c)) out.add(c.iid);
  }
  return out;
}

/**
 * Sounds for one applied action, newest game state compared against the old.
 * `me` decides whether the end of the game is a win or a loss.
 */
export function cuesFor(action: Action, before: GameState, after: GameState, me: PlayerId): Cue[] {
  const cues: Cue[] = [];

  switch (action.type) {
    case 'playLand':
      cues.push('land');
      break;
    case 'castCreature':
      cues.push('creature');
      break;
    case 'whipflash':
      cues.push('burn');
      break;
    case 'castSorcery': {
      // The card's effect, not its type, decides how it should sound.
      const card = [...before.players.A.hand, ...before.players.B.hand].find((c) => c.iid === action.iid);
      const eff = card && getDef(card.def).effect?.type;
      if (eff === 'damage' || eff === 'destroy') cues.push('burn');
      else if (eff === 'heal') cues.push('heal');
      else cues.push('spell');
      break;
    }
    case 'declareAttackers':
      // An empty declaration is a pass, not a charge.
      if (action.attackers.length) cues.push('attack');
      break;
    case 'declareBlockers':
      if (Object.keys(action.blocks).length) cues.push('block');
      break;
    case 'advance':
      // Only the handover between turns is worth a sound; phase steps are silent.
      if (after.turn !== before.turn) cues.push('turn');
      break;
  }

  // Anything that left the battlefield during this action died.
  const was = creatureIds(before);
  const now = creatureIds(after);
  for (const iid of was) {
    if (!now.has(iid)) {
      cues.push('death');
      break; // one thud, however many died at once
    }
  }

  if (after.winner && !before.winner) {
    cues.push(after.winner === me ? 'win' : 'lose');
  }
  return cues;
}
