// Pure data types for the rules engine. No React, no Supabase, no I/O.
// Everything here must be JSON-serializable so game state can be hashed,
// replayed, and (later) validated server-side unchanged.

export type PlayerId = 'A' | 'B';

export type CardType = 'land' | 'creature' | 'sorcery';

export type Keyword = 'haste' | 'flying';

/** What a creature can be targeted as / what an effect targets. */
export type TargetSpec = 'any' | 'creature' | 'player';

export type Target =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'creature'; iid: string };

/** Data-driven sorcery effects. New cards are mostly data, not code. */
export type Effect =
  | { type: 'damage'; amount: number; targets: TargetSpec }
  | { type: 'draw'; amount: number }
  | { type: 'buff'; power: number; toughness: number; targets: 'creature' };

/** Static card definition (the "printed" card). */
export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number; // mana cost; lands are 0
  power?: number; // creatures
  toughness?: number; // creatures
  keywords?: Keyword[];
  effect?: Effect; // sorceries
  text?: string;
  flavor?: string;
  art?: string; // image path served from /public, e.g. '/cards/ember_sprite.png'
}

/** A card in play — one runtime instance of a CardDef. */
export interface CardInstance {
  iid: string; // unique instance id (deterministic, from a counter)
  def: string; // CardDef.id
  owner: PlayerId;
  tapped: boolean;
  summoningSick: boolean; // can't attack/tap the turn it entered (unless haste)
  damage: number; // damage marked this turn (cleared at cleanup)
  buffP: number; // +power from buffs (Wild Growth counters AND active auras)
  buffT: number; // +toughness from buffs
  blitz: boolean; // currently receiving the Beast Blitz aura (+1/+1)
}

export interface PlayerState {
  id: PlayerId;
  life: number;
  library: CardInstance[]; // draw from the front (index 0 = top)
  hand: CardInstance[];
  battlefield: CardInstance[]; // lands + creatures
  graveyard: CardInstance[];
  landPlayedThisTurn: boolean;
}

export type Phase =
  | 'main1'
  | 'combat_attack'
  | 'combat_block'
  | 'end'; // untap/draw/damage are auto-processed, never a resting phase

export interface CombatState {
  attackers: string[]; // attacker iids
  blocks: Record<string, string>; // blockerIid -> attackerIid (1:1 for MVP)
}

/** A triggered ability waiting on the controller to choose a target. */
export interface PendingTrigger {
  kind: 'whipflash';
  source: string; // iid of the creature whose trigger this is
}

export interface GameState {
  seed: number;
  rngState: number; // current PRNG state — advances deterministically
  turn: number;
  active: PlayerId; // whose turn it is
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  combat: CombatState | null;
  pending: PendingTrigger | null; // must be resolved before any other action
  nextIid: number; // counter for deterministic instance ids
  winner: PlayerId | 'draw' | null;
  log: string[];
}

export type Action =
  | { type: 'playLand'; iid: string }
  | { type: 'castCreature'; iid: string }
  | { type: 'castSorcery'; iid: string; target?: Target }
  | { type: 'declareAttackers'; attackers: string[] }
  | { type: 'declareBlockers'; blocks: Record<string, string> }
  | { type: 'whipflash'; target: string } // resolve Thornwood Brute's ETB
  | { type: 'advance' }; // main1 -> combat, or end -> next turn

export const opponentOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
