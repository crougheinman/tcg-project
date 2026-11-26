import { getDef, isToken } from '../cards/cards';
import { actorOf } from '../engine/rules';
import type { Action, CardInstance, GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';

// Match statistics, for balancing the game. A tracker watches every applied action as (before, action, after) and,
// when the match ends, turns what it saw plus the final state into ONE flat record that goes to Supabase
// (`match_stats`, see supabase/migrations). Pure: no clock, no storage, no network, so it is tested against real
// engine games and can never touch the rules (it only reads states the engine already produced).
//
// What is NOT recorded, on purpose: anything about the person (no name, no id, no device), chat, and the action log.

export const STATS_SCHEMA_VERSION = 1;

export type Mode = 'ai' | 'hotseat' | 'pvp';
export type EndReason = 'life' | 'deck' | 'draw' | 'forfeit' | 'disconnect';

/** Everything counted for ONE player over the match. All counts start at 0 and only go up. */
export interface PlayerStats {
  /** Card id -> times cast (creatures, sorceries, instants, equipment; a flashback counts again; tokens are never cast). */
  cast: Record<string, number>;
  /** Card id -> copies that left the library: opening hand, draws, anything that ended up in hand, play or graveyard. Tokens excluded. */
  seen: Record<string, number>;
  /** Card id -> times a non-token creature of theirs died (an Undying return counts). */
  died: Record<string, number>;
  creatures_cast: number;
  spells_cast: number;
  equipment_cast: number;
  lands_played: number;
  attackers: number; // creatures sent into combat, summed over every attack
  blockers: number; // creatures that blocked, summed over every block
  abilities: number;
  equips: number;
  ninjutsu: number;
  unearths: number;
  cycles: number;
  /** Life lost, summed from the net change in life after each action. */
  damage_taken: number;
  /** Life gained, the same way (so 20 - damage_taken + life_gained is always their final life). */
  life_gained: number;
}

export interface MatchStatsBlob {
  A: PlayerStats;
  B: PlayerStats;
  /** [A's life, B's life] as each turn ended, then once more at the end of the match. */
  life_curve: [number, number][];
}

/** One finished match, shaped like the `match_stats` table (one column per field). */
export interface MatchRecord {
  schema_version: number;
  match_key: string;
  game_version: string;
  content_hash: string;
  env: string;
  automated: boolean;
  mode: Mode;
  human_a: boolean;
  human_b: boolean;
  deck_a: string;
  deck_b: string;
  custom_a: string[] | null;
  custom_b: string[] | null;
  first_player: PlayerId;
  winner: PlayerId | 'draw';
  end_reason: EndReason;
  turns: number;
  duration_s: number | null;
  mulligans_a: number;
  mulligans_b: number;
  life_a: number;
  life_b: number;
  stats: MatchStatsBlob;
}

/** What the caller knows about the match before it starts. */
export interface MatchMeta {
  matchKey: string;
  mode: Mode;
  humanA: boolean;
  humanB: boolean;
  deckA: string;
  deckB: string;
  /** Card ids of a custom deck (a built-in deck is identified by its id alone). */
  customA: string[] | null;
  customB: string[] | null;
  gameVersion: string;
  contentHash: string;
  env: string;
  automated: boolean;
  /** Epoch ms when the match began, or null when unknown (a rejoined match). */
  startedAt: number | null;
}

export interface Tracker {
  meta: MatchMeta;
  players: Record<PlayerId, PlayerStats>;
  mulligans: Record<PlayerId, number>;
  curve: [number, number][];
  first: PlayerId | null;
  /** Set once the record has been produced, so a match is reported once. */
  done: boolean;
}

const CURVE_MAX = 120;

const empty = (): PlayerStats => ({
  cast: {}, seen: {}, died: {},
  creatures_cast: 0, spells_cast: 0, equipment_cast: 0, lands_played: 0, attackers: 0, blockers: 0,
  abilities: 0, equips: 0, ninjutsu: 0, unearths: 0, cycles: 0, damage_taken: 0, life_gained: 0,
});

export function newTracker(meta: MatchMeta): Tracker {
  return { meta, players: { A: empty(), B: empty() }, mulligans: { A: 0, B: 0 }, curve: [], first: null, done: false };
}

const bump = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};

function findCard(s: GameState, pid: PlayerId, iid: string): CardInstance | undefined {
  const p = s.players[pid];
  return p.hand.find((c) => c.iid === iid) ?? p.graveyard.find((c) => c.iid === iid) ?? p.battlefield.find((c) => c.iid === iid);
}

/** Feed one applied action. `before` / `after` are the states either side of `applyAction`. Never throws. */
export function track(t: Tracker, before: GameState, action: Action, after: GameState): void {
  try {
    const who = actorOf(before);
    const me = t.players[who];
    const cardOf = () => ('iid' in action ? findCard(before, who, action.iid) : undefined);

    switch (action.type) {
      case 'playLand':
        me.lands_played++;
        break;
      case 'castCreature': {
        me.creatures_cast++;
        const c = cardOf();
        if (c) bump(me.cast, c.def);
        break;
      }
      case 'castSorcery': {
        me.spells_cast++;
        const c = cardOf();
        if (c) bump(me.cast, c.def);
        break;
      }
      case 'castEquipment': {
        me.equipment_cast++;
        const c = cardOf();
        if (c) bump(me.cast, c.def);
        break;
      }
      case 'declareAttackers':
        me.attackers += action.attackers.length;
        break;
      case 'declareBlockers':
        me.blockers += Object.keys(action.blocks).length;
        break;
      case 'activate':
        me.abilities++;
        break;
      case 'equip':
        me.equips++;
        break;
      case 'ninjutsu':
        me.ninjutsu++;
        break;
      case 'unearth':
        me.unearths++;
        break;
      case 'cycle':
        me.cycles++;
        break;
      case 'mulligan':
        t.mulligans[who]++;
        break;
      default:
        break;
    }

    for (const pid of ['A', 'B'] as PlayerId[]) {
      const b = before.players[pid];
      const a = after.players[pid];
      // Net life change per action: a loss is damage taken, a rise is life gained.
      if (a.life < b.life) t.players[pid].damage_taken += b.life - a.life;
      else if (a.life > b.life) t.players[pid].life_gained += a.life - b.life;
      // Deaths: a non-token creature that left the battlefield for the graveyard, or one Undying has just brought back.
      for (const c of b.battlefield) {
        if (isToken(c.def) || getDef(c.def).type !== 'creature') continue;
        const now = a.battlefield.find((x) => x.iid === c.iid);
        const died = now ? !c.revived && !!now.revived : a.graveyard.some((g) => g.iid === c.iid);
        if (died) bump(t.players[pid].died, c.def);
      }
    }

    // The player on the play is the active player the moment the opening-hand phase is over.
    if (t.first === null && after.phase !== 'mulligan') t.first = after.active;
    // Life as each turn ends (the turn counter has just moved on).
    if (after.turn !== before.turn && t.curve.length < CURVE_MAX) t.curve.push([before.players.A.life, before.players.B.life]);
  } catch {
    // Statistics must never be able to disturb a game.
  }
}

/** Why a finished game ended, from its final state. */
export function endReason(final: GameState): EndReason {
  if (final.winner === 'draw') return 'draw';
  if (!final.winner) return 'life';
  const loser = final.players[opponentOf(final.winner)];
  return loser.life <= 0 ? 'life' : 'deck';
}

/** Copies of each non-token card that have left the library (drawn, or placed from it). */
function seenCards(s: GameState, pid: PlayerId): Record<string, number> {
  const p = s.players[pid];
  const out: Record<string, number> = {};
  for (const c of [...p.hand, ...p.battlefield, ...p.graveyard, ...(p.exile ?? [])]) if (!isToken(c.def)) bump(out, c.def);
  return out;
}

/**
 * Close the tracker and produce the record. `end` overrides the winner and reason for a match that did not play out
 * (the opponent left); otherwise they come from the final state. Marks the tracker done.
 */
export function finish(t: Tracker, final: GameState, end?: { winner: PlayerId; reason: 'forfeit' | 'disconnect' }, now?: number): MatchRecord {
  t.done = true;
  const m = t.meta;
  const stats: MatchStatsBlob = {
    A: { ...t.players.A, seen: seenCards(final, 'A') },
    B: { ...t.players.B, seen: seenCards(final, 'B') },
    life_curve: [...t.curve, [final.players.A.life, final.players.B.life]].slice(-CURVE_MAX) as [number, number][],
  };
  return {
    schema_version: STATS_SCHEMA_VERSION,
    match_key: m.matchKey,
    game_version: m.gameVersion,
    content_hash: m.contentHash,
    env: m.env,
    automated: m.automated,
    mode: m.mode,
    human_a: m.humanA,
    human_b: m.humanB,
    deck_a: m.deckA,
    deck_b: m.deckB,
    custom_a: m.customA,
    custom_b: m.customB,
    first_player: t.first ?? 'A',
    winner: end ? end.winner : final.winner ?? 'draw',
    end_reason: end ? end.reason : endReason(final),
    turns: Math.max(1, final.turn),
    duration_s: m.startedAt !== null && now !== undefined ? Math.max(0, Math.round((now - m.startedAt) / 1000)) : null,
    mulligans_a: t.mulligans.A,
    mulligans_b: t.mulligans.B,
    life_a: final.players.A.life,
    life_b: final.players.B.life,
    stats,
  };
}
