import { getDef } from '../cards/cards';
import type { Action, CardInstance, GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import {
  canAttack,
  findCreature,
  hasKeyword,
  isCreature,
  isLand,
  power,
  toughness,
  availableMana,
} from '../engine/rules';

// Heuristic in-browser AI. One decision per call; the driver applies it and
// calls again, so mana/board state are always re-read fresh.
// ponytail: greedy heuristic, no look-ahead. Swap in minimax later if too weak.

export function aiShouldAct(state: GameState, ai: PlayerId): boolean {
  if (state.winner) return false;
  if (state.pending) return state.active === ai; // the caster resolves their trigger
  if (state.phase === 'combat_block') return state.active !== ai; // AI is defender
  return state.active === ai;
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

function pickMain(state: GameState, ai: PlayerId): Action {
  const me = state.players[ai];
  const oppId = opponentOf(ai);
  const opp = state.players[oppId];
  const mana = availableMana(me);

  // 1. Always develop mana.
  const land = me.hand.find((c) => getDef(c.def).type === 'land');
  if (land && !me.landPlayedThisTurn) return { type: 'playLand', iid: land.iid };

  const burns = me.hand.filter((c) => getDef(c.def).effect?.type === 'damage');

  // 2. Lethal burn to the face.
  for (const b of burns) {
    const def = getDef(b.def);
    const amount = (def.effect as { amount: number }).amount;
    if (def.cost <= mana && amount >= opp.life) {
      return { type: 'castSorcery', iid: b.iid, target: { kind: 'player', player: oppId } };
    }
  }

  // 3. Removal: kill the biggest enemy creature we can.
  const enemyCreatures = opp.battlefield.filter(isCreature);
  for (const b of burns) {
    const def = getDef(b.def);
    if (def.cost > mana) continue;
    const amount = (def.effect as { amount: number }).amount;
    const killable = enemyCreatures
      .filter((c) => toughness(c) - c.damage <= amount)
      .sort((x, y) => power(y) - power(x));
    if (killable.length) {
      return { type: 'castSorcery', iid: b.iid, target: { kind: 'creature', iid: killable[0].iid } };
    }
  }

  // 3b. Take Counter: destroy a tapped enemy creature (biggest first).
  const destroyer = me.hand.find(
    (c) => getDef(c.def).effect?.type === 'destroy' && getDef(c.def).cost <= mana,
  );
  if (destroyer) {
    const tapped = enemyCreatures.filter((c) => c.tapped).sort((x, y) => power(y) - power(x));
    if (tapped.length) {
      return {
        type: 'castSorcery',
        iid: destroyer.iid,
        target: { kind: 'creature', iid: tapped[0].iid },
      };
    }
  }

  // 3c. Topple: tap small attackers if it actually hits something.
  const toppler = me.hand.find(
    (c) => getDef(c.def).effect?.type === 'tapAll' && getDef(c.def).cost <= mana,
  );
  if (toppler) {
    const maxT = (getDef(toppler.def).effect as { maxToughness: number }).maxToughness;
    if (enemyCreatures.some((c) => !c.tapped && toughness(c) <= maxT)) {
      return { type: 'castSorcery', iid: toppler.iid };
    }
  }

  // 4. Cast the biggest creature we can afford.
  const creatures = me.hand
    .filter((c) => getDef(c.def).type === 'creature' && getDef(c.def).cost <= mana)
    .sort((x, y) => getDef(y.def).cost - getDef(x.def).cost);
  if (creatures.length) return { type: 'castCreature', iid: creatures[0].iid };

  // 4b. Utility: tokens (board), ramp (if a land is in hand), heal (only when low).
  const tokener = me.hand.find(
    (c) => getDef(c.def).effect?.type === 'token' && getDef(c.def).cost <= mana,
  );
  if (tokener) return { type: 'castSorcery', iid: tokener.iid };
  const ramper = me.hand.find(
    (c) => getDef(c.def).effect?.type === 'ramp' && getDef(c.def).cost <= mana,
  );
  if (ramper && me.hand.some(isLand)) return { type: 'castSorcery', iid: ramper.iid };
  const healer = me.hand.find(
    (c) => getDef(c.def).effect?.type === 'heal' && getDef(c.def).cost <= mana,
  );
  if (healer && me.life < 12) return { type: 'castSorcery', iid: healer.iid };

  // 5. Buff our best creature.
  const buff = me.hand.find((c) => getDef(c.def).effect?.type === 'buff');
  if (buff && getDef(buff.def).cost <= mana) {
    const own = me.battlefield.filter(isCreature).sort((x, y) => power(y) - power(x));
    if (own.length)
      return { type: 'castSorcery', iid: buff.iid, target: { kind: 'creature', iid: own[0].iid } };
  }

  // 6. Card draw if we have spare mana and nothing better.
  const draw = me.hand.find((c) => getDef(c.def).effect?.type === 'draw');
  if (draw && getDef(draw.def).cost <= mana) return { type: 'castSorcery', iid: draw.iid };

  return { type: 'advance' }; // nothing left to do -> combat
}

function pickAttacks(state: GameState, ai: PlayerId): Action {
  const me = state.players[ai];
  // Aggressive: swing with everything that can attack.
  // ponytail: ignores unfavorable trades; add board eval before attacking later.
  const attackers = me.battlefield.filter(canAttack).map((c) => c.iid);
  return { type: 'declareAttackers', attackers };
}

function pickWhipflash(state: GameState, ai: PlayerId): Action {
  const src = state.pending!.source;
  const oppId = opponentOf(ai);
  const candidates = [...state.players.A.battlefield, ...state.players.B.battlefield].filter(
    (c) => isCreature(c) && c.iid !== src,
  );
  const enemies = state.players[oppId].battlefield.filter(
    (c) => isCreature(c) && c.iid !== src,
  );
  // Prefer to kill an enemy (1 toughness left), else weakest enemy, else weakest anything.
  const kill = enemies.filter((c) => toughness(c) - c.damage <= 1).sort((a, b) => power(b) - power(a));
  const pool = enemies.length ? enemies : candidates;
  const target = kill[0] ?? pool.slice().sort((a, b) => toughness(a) - toughness(b))[0] ?? candidates[0];
  return { type: 'whipflash', target: target.iid };
}

function pickBlocks(state: GameState, ai: PlayerId): Action {
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
