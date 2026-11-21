import type { GameState, PlayerId } from '../engine/types';
import { actorOf, availableMana, canBlock, hasKeyword, isCreature } from '../engine/rules';
import { getDef } from '../cards/cards';

// What the phase banner says, as a pure function of the game state so it can be tested without a
// browser. `mine` is whose TURN it is from the local player's seat (the banner's colour: cyan for
// you, red for the enemy); the hint line says what the local player is expected to do now.

export interface PhaseBannerInfo {
  /** Changes whenever the phase, the turn or its owner changes: the banner re-plays on a new key. */
  key: string;
  mine: boolean;
  turnLabel: string;
  title: string;
  hint: string;
}

export function phaseBannerInfo(game: GameState, localId: PlayerId): PhaseBannerInfo {
  if (game.phase === 'mulligan') {
    // The opening-hand decision: it belongs to whoever is deciding, not to a turn owner.
    const deciding = game.mulligan?.deciding ?? game.active;
    const mine = deciding === localId;
    return {
      key: `mulligan:${deciding}:${game.mulligan?.taken[deciding] ?? 0}`,
      mine,
      turnLabel: mine ? 'Your decision' : "Enemy's decision",
      title: 'Opening hand',
      hint: mine ? 'Keep this hand, or mulligan' : 'Enemy is deciding',
    };
  }
  const mine = game.active === localId;
  const youAct = actorOf(game) === localId; // in the block step the DEFENDER acts, not the turn owner
  let title: string;
  let hint: string;
  switch (game.phase) {
    case 'main1':
      title = 'Main phase';
      hint = mine ? 'Play lands and cast spells' : 'Enemy is making their plays';
      break;
    case 'combat_attack':
      title = 'Attack phase';
      hint = mine ? 'Choose your attackers' : 'Enemy is choosing attackers';
      break;
    case 'combat_block':
      title = 'Block phase';
      hint = youAct ? 'Choose your blockers' : 'Enemy is choosing blockers';
      break;
    default:
      title = 'End phase';
      hint = mine ? 'Pass the turn' : 'Enemy is wrapping up';
  }
  return {
    key: `${game.turn}:${game.active}:${game.phase}`,
    mine,
    turnLabel: mine ? 'Your turn' : "Enemy's turn",
    title,
    hint,
  };
}

/**
 * The block step with nothing to decide: the defender has no creature that can block any attacker (none untapped, or
 * every attacker flies and they have no flyer or reach) AND no instant or flash card they could afford to cast.
 * The block banner is skipped then, and the Board lets the damage through (it used to wait for a click). Pure.
 */
export function blockStepIsEmpty(game: GameState): boolean {
  if (game.phase !== 'combat_block') return false;
  const defender = game.players[game.active === 'A' ? 'B' : 'A'];
  const attackers = game.players[game.active].battlefield.filter((c) => game.combat?.attackers.includes(c.iid));
  if (defender.battlefield.some((b) => isCreature(b) && attackers.some((a) => canBlock(b, a)))) return false;
  const mana = availableMana(defender);
  return !defender.hand.some((c) => (getDef(c.def).type === 'instant' || hasKeyword(c, 'flash')) && getDef(c.def).cost <= mana);
}
