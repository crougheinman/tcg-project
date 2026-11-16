import { duel, findCreature, hasKeyword, power } from '../engine/rules';
import type { CardInstance, GameState } from '../engine/types';
import { opponentOf } from '../engine/types';

// The combined damage readout for the attack and block steps, as pure functions so the numbers can
// be held equal to what combat really does (see the test that compares them with `applyAction`).

export interface CombatTally {
  mode: 'attack' | 'defend';
  /** Everything the attackers could deal. */
  total: number;
  /** Damage the planned blocks stop (defend mode only). */
  blocked: number;
  /** Damage that gets through. In attack mode: the most the opponent can take (no blocks yet). */
  taking: number;
  /** The defending player's life now, and after `taking` lands. */
  life: number;
  after: number;
  lethal: boolean;
  attackers: number;
}

/** What one attacker deals if nothing blocks it (a double striker hits twice). */
export function strikeDamage(atk: CardInstance): number {
  return power(atk) * (hasKeyword(atk, 'doubleStrike') ? 2 : 1);
}

function make(mode: CombatTally['mode'], total: number, taking: number, life: number, attackers: number): CombatTally {
  const after = life - taking;
  return { mode, total, blocked: total - taking, taking, life, after, lethal: after <= 0 && attackers > 0, attackers };
}

/** The attacker's view while choosing attackers: how much the chosen creatures could deal. */
export function attackTally(game: GameState, attackerIids: Iterable<string>): CombatTally | null {
  const list = [...attackerIids]
    .map((iid) => findCreature(game, iid)?.card)
    .filter((c): c is CardInstance => !!c);
  if (!list.length) return null;
  const total = list.reduce((n, c) => n + strikeDamage(c), 0);
  return make('attack', total, total, game.players[opponentOf(game.active)].life, list.length);
}

/**
 * The defender's view while choosing blocks: what is coming, what the planned blocks stop, and what
 * is left. A blocked attacker's damage past its blocker is whatever `duel` says (trample, first strike).
 */
export function blockTally(game: GameState, blocks: Record<string, string>): CombatTally | null {
  const atks = (game.combat?.attackers ?? [])
    .map((iid) => findCreature(game, iid)?.card)
    .filter((c): c is CardInstance => !!c);
  if (!atks.length) return null;
  const blockerOf: Record<string, string> = {};
  for (const [blk, atk] of Object.entries(blocks)) blockerOf[atk] = blk;
  let total = 0;
  let taking = 0;
  for (const atk of atks) {
    const dmg = strikeDamage(atk);
    total += dmg;
    const blk = blockerOf[atk.iid] ? findCreature(game, blockerOf[atk.iid])?.card : null;
    taking += blk ? duel(atk, blk).toFace : dmg;
  }
  return make('defend', total, taking, game.players[opponentOf(game.active)].life, atks.length);
}
