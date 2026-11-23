import { getDef, isToken } from '../cards/cards';
import type { Action, CardInstance, GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { MAX_MULLIGANS } from '../engine/state';
import {
  actorOf,
  canAttack,
  canBlock,
  duel,
  findCreature,
  hasKeyword,
  isCreature,
  isLand,
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

/** Keep a hand with a workable number of lands (2 to all-but-2); otherwise mulligan while allowed. */
function pickMulligan(state: GameState, ai: PlayerId): Action {
  const hand = state.players[ai].hand;
  const lands = hand.filter(isLand).length;
  const fine = lands >= 2 && lands <= hand.length - 2;
  const canMulligan = (state.mulligan?.taken[ai] ?? 0) < MAX_MULLIGANS;
  return fine || !canMulligan ? { type: 'keepHand' } : { type: 'mulligan' };
}

export function pickAction(state: GameState, ai: PlayerId): Action {
  if (state.phase === 'mulligan') return pickMulligan(state, ai);
  if (state.pending?.kind === 'enter') return pickTriggerTarget(state, ai);
  if (state.pending?.kind === 'sacrifice') return pickSacrifice(state, ai);
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
  edict: 77, // the opponent sacrifices: strongest against a thin board, where they cannot give up their worst
  tapAll: 76, // Topple, when it actually catches something
  bounce: 74, // tempo removal on their best creature
  creature: 70, // biggest body we can afford
  rally: 62, // a team pump, worth it when two or more creatures can attack
  token: 60,
  ramp: 58,
  heal: 56, // only when genuinely low
  buff: 50,
  draw: 40,
  cycle: 3, // swap a card we cannot cast soon for a fresh one, when nothing better is left to do
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
  const p = state.players[player];
  return p.hand.find((c) => c.iid === iid) ?? p.graveyard.find((c) => c.iid === iid) ?? null; // (a flashback spell is cast from the graveyard)
}

function scoreAction(state: GameState, ai: PlayerId, a: Action): number {
  switch (a.type) {
    case 'playLand':
      return score(BAND.land);
    case 'castCreature': {
      const card = handCard(state, ai, a.iid);
      if (!card) return score(BAND.never);
      // A flash creature is worth more as a surprise blocker: hold it while the enemy has creatures that
      // can attack next turn (cast it normally when there is nothing to ambush, or it would never be used).
      if (hasKeyword(card, 'flash') && state.phase === 'main1' && opponentCanAttack(state, ai)) {
        return score(BAND.never);
      }
      return score(BAND.creature, getDef(card.def).cost * 10); // biggest first
    }
    case 'castSorcery':
      return scoreSpell(state, ai, a);
    case 'cycle': {
      // Only worth it for a card we cannot cast within the next turn: the lands we have, plus one more if we hold a land
      const card = handCard(state, ai, a.iid);
      if (!card) return score(BAND.never);
      const me = state.players[ai];
      const reach = me.battlefield.filter(isLand).length + (me.hand.some(isLand) ? 1 : 0);
      return getDef(card.def).cost > reach ? score(BAND.cycle, getDef(card.def).cost) : score(BAND.never);
    }
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
      if (hasKeyword(victim, 'indestructible') || toughness(victim) - victim.damage > eff.amount) return score(BAND.never); // wouldn't kill
      return score(BAND.removalKill, power(victim) * 20 + thrift); // biggest threat first
    }
    case 'destroy': {
      if (a.target?.kind !== 'creature') return score(BAND.never);
      const found = findCreature(state, a.target.iid);
      if (!found || found.controller === ai || hasKeyword(found.card, 'indestructible')) return score(BAND.never); // it would survive
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
    case 'rally': {
      // before combat, and only with two or more creatures that will actually attack
      if (state.phase !== 'main1') return score(BAND.never);
      return me.battlefield.filter(canAttack).length >= 2 ? score(BAND.rally, thrift) : score(BAND.never);
    }
    case 'edict': {
      // the fewer creatures they have, the less they can hide behind a worthless one
      const n = opp.battlefield.filter(isCreature).length;
      if (n === 0 || n > 2) return score(BAND.never);
      return score(BAND.edict, (3 - n) * 20 + thrift);
    }
    case 'bounce': {
      if (a.target?.kind !== 'creature') return score(BAND.never);
      const found = findCreature(state, a.target.iid);
      if (!found || found.controller === ai) return score(BAND.never); // never our own
      // a token is simply gone; otherwise the dearer the creature, the more tempo it costs them
      const cost = getDef(found.card.def).cost;
      return score(BAND.bounce, isToken(found.card.def) ? power(found.card) * 10 : cost * 20 + power(found.card));
    }
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

/** Edict: give up the least valuable creature we have: a token first, then the smallest and cheapest. */
function pickSacrifice(state: GameState, ai: PlayerId): Action {
  const mine = legalActions(state, ai).filter((a): a is Extract<Action, { type: 'resolveTrigger' }> => a.type === 'resolveTrigger');
  if (!mine.length) return { type: 'advance' };
  const worth = (iid: string) => {
    const c = findCreature(state, iid)!.card;
    return (isToken(c.def) ? -100 : 0) + power(c) + toughness(c) + getDef(c.def).cost * 2 + (hasKeyword(c, 'indestructible') ? 3 : 0);
  };
  return mine.sort((x, y) => worth(x.target) - worth(y.target))[0];
}

function pickTriggerTarget(state: GameState, ai: PlayerId): Action {
  const oppId = opponentOf(ai);
  const shots = legalActions(state, ai).filter(
    (a): a is Extract<Action, { type: 'resolveTrigger' }> => a.type === 'resolveTrigger',
  );
  if (!shots.length) return { type: 'advance' }; // no legal target (shouldn't happen)

  // A bounce: send the enemy's dearest creature home (a token is simply removed); with no enemy creature to bounce we must still pick one
  // of our own, so give up the one that costs least to replay.
  if (state.pending?.kind === 'enter' && getDef(state.pending.def).onEnter?.type === 'bounce') {
    const value = (iid: string) => {
      const c = findCreature(state, iid)!.card;
      return isToken(c.def) ? power(c) * 10 : getDef(c.def).cost * 20 + power(c);
    };
    const enemy = shots.filter((a) => findCreature(state, a.target)?.controller === oppId);
    if (enemy.length) return enemy.sort((x, y) => value(y.target) - value(x.target))[0];
    return shots.sort((x, y) => value(x.target) - value(y.target))[0];
  }

  // Prefer to kill an enemy, else hit the weakest enemy, else the weakest thing.
  let best: { action: Action; s: number } | null = null;
  for (const a of shots) {
    const found = findCreature(state, a.target);
    if (!found) continue;
    const c = found.card;
    const enemy = found.controller === oppId;
    const kills = !hasKeyword(c, 'indestructible') && toughness(c) - c.damage <= 1;
    const band = enemy ? (kills ? 2 : 1) : 0;
    const s = band * SCALE + (kills && enemy ? power(c) : -toughness(c));
    if (!best || s > best.s) best = { action: a, s };
  }
  return best?.action ?? shots[0];
}

/** A block we actually want: the blocker kills the attacker and lives through it. */
function favorableBlock(blk: CardInstance, atk: CardInstance): boolean {
  const r = duel(atk, blk); // the real combat rules (first strike, deathtouch...), not a stat comparison
  return r.atkDies && !r.blkDies;
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

    // the blocker as it would be after the pump (a throwaway copy)
    const after = { ...blk, buffP: blk.buffP + def.effect.power, buffT: blk.buffT + def.effect.toughness };

    for (const atk of attackers) {
      if (!canBlock(blk, atk)) continue; // illegal block
      if (favorableBlock(blk, atk)) continue; // already winning without it
      if (!favorableBlock(after, atk)) continue; // the pump doesn't get us there
      const gain = power(atk) * 10 - def.cost; // biggest threat first, cheapest trick
      if (!best || gain > best.gain) best = { action: a, gain };
    }
  }
  return best?.action ?? null;
}

/** Could the other player attack with something next turn? (Used to decide whether to hold a flash creature.) */
function opponentCanAttack(state: GameState, ai: PlayerId): boolean {
  return state.players[opponentOf(ai)].battlefield.some(
    (c) => isCreature(c) && !hasKeyword(c, 'defender'),
  );
}

/**
 * Flash in a blocker: worth it when the new creature wins a fight against one of the attackers (kills it
 * and survives), or when the attack would otherwise be lethal and it can at least block something.
 * Each cast spends mana and a card, so repeated calls terminate.
 */
function pickFlashBlocker(state: GameState, ai: PlayerId): Action | null {
  const me = state.players[ai];
  const attackers = (state.combat?.attackers ?? [])
    .map((iid) => findCreature(state, iid)?.card)
    .filter((c): c is CardInstance => !!c);
  if (!attackers.length) return null;
  const incoming = attackers.reduce((n, a) => n + power(a), 0);
  let best: { action: Action; gain: number } | null = null;
  for (const a of legalActions(state, ai)) {
    if (a.type !== 'castCreature') continue;
    const card = handCard(state, ai, a.iid);
    if (!card || !hasKeyword(card, 'flash')) continue;
    const blocker: CardInstance = { ...card, tapped: false }; // as it would be once it has entered
    for (const atk of attackers) {
      if (!canBlock(blocker, atk)) continue;
      const wins = favorableBlock(blocker, atk);
      const saves = incoming >= me.life;
      if (!wins && !saves) continue;
      const gain = (wins ? power(atk) * 10 : 0) + (saves ? 500 : 0) - getDef(card.def).cost;
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
  const ambush = pickFlashBlocker(state, ai);
  if (ambush) return ambush;

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
    const legal = pool.filter((b) => !used.has(b.iid) && canBlock(b, atk));
    if (!legal.length) continue;

    // Judge every candidate with the real combat rules (`duel`): who dies, what tramples over.
    const fights = legal.map((b) => ({ b, r: duel(atk, b) }));
    const killSurvive = fights
      .filter((f) => f.r.atkDies && !f.r.blkDies)
      .sort((x, y) => toughness(x.b) - toughness(y.b));
    const kill = fights.filter((f) => f.r.atkDies).sort((x, y) => power(x.b) - power(y.b));

    let chosen: (typeof fights)[number] | undefined;
    if (killSurvive.length) chosen = killSurvive[0];
    else if (kill.length) chosen = kill[0];
    else if (unblocked >= me.life) {
      // chump: the cheapest blocker, preferring the one that lets the least trample through
      chosen = fights.sort((x, y) => x.r.toFace - y.r.toFace || power(x.b) - power(y.b))[0];
    }

    if (chosen) {
      blocks[chosen.b.iid] = atk.iid;
      used.add(chosen.b.iid);
      unblocked -= power(atk) - chosen.r.toFace; // trample overflow still gets through
    }
  }
  return { type: 'declareBlockers', blocks };
}
