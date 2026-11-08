import { getDef } from '../cards/cards';
import type { Action, CardInstance, GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import {
  actorOf,
  canAttack,
  findCreature,
  hasKeyword,
  isCreature,
  legalActions,
  power,
  toughness,
} from '../engine/rules';

// Heuristic in-browser AI. One decision per call; the driver applies it and
// calls again, so mana/board state are always re-read fresh.
//
// Candidates come from `rules.legalActions` — the AI never generates moves of its
// own, it only RANKS the ones the rules say are available. That removes a whole
// bug class: the AI cannot emit an action the reducer will reject, and the two
// legality models cannot drift apart as cards are added. The only exceptions are
// the combinatorial combat declarations (attack sets, block assignments), which
// are built directly in `pickAttacks` / `pickBlocks`.
//
// ponytail: greedy heuristic, no look-ahead. Swap in minimax later if too weak.

export function aiShouldAct(state: GameState, ai: PlayerId): boolean {
  if (state.winner) return false;
  return actorOf(state) === ai;
}

export function pickAction(state: GameState, ai: PlayerId): Action {
  if (state.pending?.kind === 'whipflash') return pickWhipflash(state, ai);
  if (state.phase === 'combat_block' && state.active !== ai) return pickBlocks(state, ai);
  switch (state.phase) {
    case 'main1':
      return pickMain(state, ai);
    case 'combat_attack':
      return pickAttacks(state, ai);
    default:
      return { type: 'advance' };
  }
}

// ---- Scoring -------------------------------------------------------------
//
// Priority bands, highest first. These reproduce the hand-rolled ladder this AI
// used before it consumed `legalActions`: the preferences are unchanged, they are
// just expressed as a ranking over candidates the AI no longer generates itself.
const BAND = {
  land: 100, // always develop mana
  lethalBurn: 90, // burn that closes the game out
  removalKill: 80, // burn that kills a creature
  destroy: 78, // hard removal on a tapped creature
  tapAll: 76, // Topple, when it actually catches something
  creature: 70, // biggest body we can afford
  token: 60,
  ramp: 58,
  heal: 56, // only when genuinely low
  buff: 50,
  draw: 40,
  advance: 0, // the floor: do nothing else
  never: -1, // legal but never wanted (wasted burn, healing at full life, ...)
} as const;

const SCALE = 1000;

/** Compose a band with a within-band tiebreak (clamped to 0..SCALE-1). */
function score(band: number, tiebreak = 0): number {
  return band * SCALE + Math.max(0, Math.min(SCALE - 1, Math.round(tiebreak)));
}

/** Only cast a trick mid-combat if it removes something — never chip value away. */
const COMBAT_TRICK_MIN = score(BAND.destroy);

function handCard(state: GameState, player: PlayerId, iid: string): CardInstance | null {
  return state.players[player].hand.find((c) => c.iid === iid) ?? null;
}

function scoreAction(state: GameState, ai: PlayerId, a: Action): number {
  switch (a.type) {
    case 'playLand':
      return score(BAND.land);
    case 'castCreature': {
      const card = handCard(state, ai, a.iid);
      if (!card) return score(BAND.never);
      return score(BAND.creature, getDef(card.def).cost * 10); // biggest first
    }
    case 'castSorcery':
      return scoreSpell(state, ai, a);
    case 'advance':
      return score(BAND.advance);
    default:
      return score(BAND.never);
  }
}

function scoreSpell(
  state: GameState,
  ai: PlayerId,
  a: Extract<Action, { type: 'castSorcery' }>,
): number {
  const me = state.players[ai];
  const oppId = opponentOf(ai);
  const opp = state.players[oppId];
  const card = handCard(state, ai, a.iid);
  if (!card) return score(BAND.never);
  const def = getDef(card.def);
  const eff = def.effect;
  if (!eff) return score(BAND.never);
  // Within a band, spend the cheapest card that does the job.
  const thrift = Math.max(0, 20 - def.cost);

  switch (eff.type) {
    case 'damage': {
      if (!a.target) return score(BAND.never);
      if (a.target.kind === 'player') {
        // Only ever point burn at a face to actually finish the game.
        if (a.target.player === oppId && eff.amount >= opp.life)
          return score(BAND.lethalBurn, thrift);
        return score(BAND.never);
      }
      const found = findCreature(state, a.target.iid);
      if (!found || found.controller === ai) return score(BAND.never); // never shoot our own
      const victim = found.card;
      if (toughness(victim) - victim.damage > eff.amount) return score(BAND.never); // wouldn't kill
      return score(BAND.removalKill, power(victim) * 20 + thrift); // biggest threat first
    }
    case 'destroy': {
      if (a.target?.kind !== 'creature') return score(BAND.never);
      const found = findCreature(state, a.target.iid);
      if (!found || found.controller === ai) return score(BAND.never);
      return score(BAND.destroy, power(found.card) * 20 + thrift);
    }
    case 'tapAll': {
      const catches = opp.battlefield.some(
        (c) => isCreature(c) && !c.tapped && toughness(c) <= eff.maxToughness,
      );
      return catches ? score(BAND.tapAll, thrift) : score(BAND.never);
    }
    case 'token':
      return score(BAND.token, thrift);
    case 'ramp':
      return score(BAND.ramp, thrift); // legalActions already checked a land is in hand
    case 'heal':
      return me.life < 12 ? score(BAND.heal, thrift) : score(BAND.never);
    case 'buff': {
      if (a.target?.kind !== 'creature') return score(BAND.never);
      const found = findCreature(state, a.target.iid);
      if (!found || found.controller !== ai) return score(BAND.never); // only pump our own
      // NOTE: `buff` in this engine is PERMANENT (it writes buffP/buffT), not a
      // until-end-of-turn pump. So casting it on your own main phase compounds
      // over every later turn and measurably beats holding it as a combat trick
      // (tested: holding costs Iron Blossom ~9pp of win rate). Cast it early.
      return score(BAND.buff, power(found.card) * 20 + thrift);
    }
    case 'draw':
      return score(BAND.draw, thrift);
    default:
      return score(BAND.never);
  }
}

/** Highest-scoring legal action, or null if there are none. Ties go to the first. */
function bestLegal(state: GameState, ai: PlayerId): { action: Action; score: number } | null {
  let best: { action: Action; score: number } | null = null;
  for (const a of legalActions(state, ai)) {
    const s = scoreAction(state, ai, a);
    if (!best || s > best.score) best = { action: a, score: s };
  }
  return best;
}

// ---- Per-phase decisions -------------------------------------------------

function pickMain(state: GameState, ai: PlayerId): Action {
  // `advance` is always among the legal actions here and scores the floor, so the
  // AI moves to combat exactly when nothing else is worth doing.
  return bestLegal(state, ai)?.action ?? { type: 'advance' };
}

function pickAttacks(state: GameState, ai: PlayerId): Action {
  // Instants are legal in the attack step: clear a blocker (or steal the win)
  // before committing the swing. Anything less decisive waits.
  const trick = bestLegal(state, ai);
  if (trick && trick.score >= COMBAT_TRICK_MIN) return trick.action;

  const me = state.players[ai];
  // Aggressive: swing with everything that can attack.
  // ponytail: ignores unfavorable trades; add board eval before attacking later.
  const attackers = me.battlefield.filter(canAttack).map((c) => c.iid);
  return { type: 'declareAttackers', attackers };
}

function pickWhipflash(state: GameState, ai: PlayerId): Action {
  const oppId = opponentOf(ai);
  const shots = legalActions(state, ai).filter(
    (a): a is Extract<Action, { type: 'whipflash' }> => a.type === 'whipflash',
  );
  if (!shots.length) return { type: 'advance' }; // no legal target (shouldn't happen)

  // Prefer to kill an enemy, else hit the weakest enemy, else the weakest thing.
  let best: { action: Action; s: number } | null = null;
  for (const a of shots) {
    const found = findCreature(state, a.target);
    if (!found) continue;
    const c = found.card;
    const enemy = found.controller === oppId;
    const kills = toughness(c) - c.damage <= 1;
    const band = enemy ? (kills ? 2 : 1) : 0;
    const s = band * SCALE + (kills && enemy ? power(c) : -toughness(c));
    if (!best || s > best.s) best = { action: a, s };
  }
  return best?.action ?? shots[0];
}

/** A block we actually want: the blocker kills the attacker and lives through it. */
function favorableBlock(blk: { p: number; t: number }, atk: CardInstance): boolean {
  return blk.p >= toughness(atk) && blk.t > power(atk);
}

/**
 * A pump held for the block step — the reason instants exist. Worth casting only
 * when it converts a block we would lose into one we win: the blocker kills the
 * attacker AND survives, where it did neither before. Anything less is a
 * main-phase buff, which `scoreAction` already handles at BAND.buff.
 *
 * Self-limiting: once a pair is favorable the condition stops firing for it, and
 * every cast spends mana, so this cannot loop.
 */
function pickCombatBuff(state: GameState, ai: PlayerId): Action | null {
  const attackers = (state.combat?.attackers ?? [])
    .map((iid) => findCreature(state, iid)?.card)
    .filter((c): c is CardInstance => !!c);
  if (!attackers.length) return null;

  let best: { action: Action; gain: number } | null = null;
  for (const a of legalActions(state, ai)) {
    if (a.type !== 'castSorcery' || a.target?.kind !== 'creature') continue;
    const card = handCard(state, ai, a.iid);
    if (!card) continue;
    const def = getDef(card.def);
    if (def.effect?.type !== 'buff') continue;
    const found = findCreature(state, a.target.iid);
    if (!found || found.controller !== ai) continue; // only pump our own
    const blk = found.card;
    if (blk.tapped || !isCreature(blk)) continue; // a tapped creature cannot block

    const before = { p: power(blk), t: toughness(blk) };
    const after = { p: before.p + def.effect.power, t: before.t + def.effect.toughness };

    for (const atk of attackers) {
      if (hasKeyword(atk, 'flying') && !hasKeyword(blk, 'flying')) continue; // illegal block
      if (favorableBlock(before, atk)) continue; // already winning without it
      if (!favorableBlock(after, atk)) continue; // the pump doesn't get us there
      const gain = power(atk) * 10 - def.cost; // biggest threat first, cheapest trick
      if (!best || gain > best.gain) best = { action: a, gain };
    }
  }
  return best?.action ?? null;
}

function pickBlocks(state: GameState, ai: PlayerId): Action {
  // The defender holds priority here, so block-only instants (Take Counter,
  // Grasp from the Grave) are finally live. Killing a tapped attacker outright
  // beats any block assignment, so resolve tricks first and re-enter with a
  // smaller combat. Each cast spends mana, so this always terminates.
  const trick = bestLegal(state, ai);
  if (trick && trick.score >= COMBAT_TRICK_MIN) return trick.action;
  // Removing an attacker always beats pumping through it, so tricks come first.
  const pump = pickCombatBuff(state, ai);
  if (pump) return pump;

  const me = state.players[ai];
  const combat = state.combat!;
  const pool = me.battlefield.filter((c) => isCreature(c) && !c.tapped);
  const used = new Set<string>();
  const blocks: Record<string, string> = {};

  const attackers = combat.attackers
    .map((iid) => findCreature(state, iid)?.card)
    .filter((c): c is CardInstance => !!c)
    .sort((a, b) => power(b) - power(a)); // handle the scariest first

  let unblocked = attackers.reduce((sum, a) => sum + power(a), 0);

  for (const atk of attackers) {
    const flying = hasKeyword(atk, 'flying');
    const legal = pool.filter((b) => !used.has(b.iid) && (!flying || hasKeyword(b, 'flying')));
    if (!legal.length) continue;

    const killSurvive = legal
      .filter((b) => power(b) >= toughness(atk) && toughness(b) > power(atk))
      .sort((x, y) => toughness(x) - toughness(y));
    const kill = legal.filter((b) => power(b) >= toughness(atk)).sort((x, y) => power(x) - power(y));

    let chosen: CardInstance | undefined;
    if (killSurvive.length) chosen = killSurvive[0];
    else if (kill.length) chosen = kill[0];
    else if (unblocked >= me.life) chosen = legal.sort((x, y) => power(x) - power(y))[0]; // chump

    if (chosen) {
      blocks[chosen.iid] = atk.iid;
      used.add(chosen.iid);
      unblocked -= power(atk);
    }
  }
  return { type: 'declareBlockers', blocks };
}
