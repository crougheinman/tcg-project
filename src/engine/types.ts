// Pure data types for the rules engine. No React, no Supabase, no I/O.
// Everything here must be JSON-serializable so game state can be hashed,
// replayed, and (later) validated server-side unchanged.

export type PlayerId = 'A' | 'B';

export type CardType = 'land' | 'creature' | 'sorcery' | 'instant';

export type Keyword =
  | 'haste'
  | 'flying'
  | 'defender'
  | 'reach'
  | 'vigilance'
  | 'firstStrike'
  | 'doubleStrike'
  | 'trample'
  | 'deathtouch'
  | 'lifelink'
  | 'flash' // a creature castable at instant speed (the block step, the attack step, your main phase)
  | 'prowess'; // +1/+1 until end of turn whenever its controller casts a spell

/** What a creature can be targeted as / what an effect targets. */
export type TargetSpec = 'any' | 'creature' | 'player';

export type Target =
  | { kind: 'player'; player: PlayerId }
  | { kind: 'creature'; iid: string };

/** Data-driven sorcery effects. New cards are mostly data, not code. */
export type Effect =
  | { type: 'damage'; amount: number; targets: TargetSpec }
  | { type: 'draw'; amount: number }
  | { type: 'buff'; power: number; toughness: number; targets: 'creature' }
  | { type: 'heal'; amount: number }
  | { type: 'ramp'; amount: number } // put up to N lands from hand onto the battlefield
  | { type: 'token'; token: string; count: number } // create N token creatures
  | { type: 'tapAll'; maxToughness: number } // tap all opponent creatures with toughness <= N
  | { type: 'destroy'; targets: 'creature' }; // destroy target (tapped) creature

/** Which effects need the player to pick a target. */
export function needsTarget(effect: Effect): boolean {
  return effect.type === 'damage' || effect.type === 'buff' || effect.type === 'destroy';
}

/**
 * Does resolving this effect from a TRIGGER need the controller to pick a creature? Damage aimed at the
 * player (a burn trigger) goes to the opponent without asking; damage aimed at a creature, a buff and a
 * destroy need a choice.
 */
export function needsCreatureChoice(effect: Effect): boolean {
  if (effect.type === 'damage') return effect.targets === 'creature';
  return needsTarget(effect);
}

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
  skill?: string; // creature: name of the skill that fires when it enters play (shown in the log and the cast spotlight)
  onEnter?: Effect; // creature: resolves when it enters play (a targeted one waits on a `pending` choice)
  onDeath?: Effect; // creature: resolves when it dies (token creation, draw, heal, or damage to the opponent)
  spellTrigger?: Effect; // creature: fires whenever its controller casts a sorcery
  spellTriggerInstant?: boolean; // creature: its spellTrigger also fires on instant casts
  blockOnly?: boolean; // instant that can be cast only during the block step (combat_block)
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
  // Until-end-of-turn buff (prowess). Optional so older fixtures need no change; cleared when the next turn begins.
  tempP?: number;
  tempT?: number;
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
  kind: 'enter'; // an enter-the-battlefield effect that needs a target
  source: string; // iid of the creature whose trigger this is
  def: string; // its card, so the effect is still known if the source has left play
  controller: PlayerId; // who chooses the target (the defender, when a flash creature enters in the block step)
}

export interface GameState {
  seed: number;
  rngState: number; // current PRNG state — advances deterministically
  turn: number;
  active: PlayerId; // whose turn it is
  phase: Phase;
  players: Record<PlayerId, PlayerState>;
  combat: CombatState | null;
  lastCombat: CombatState | null; // the most recently resolved combat (for UI fx/announce; not rules)
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
  | { type: 'resolveTrigger'; target: string } // choose the target of a pending enter-the-battlefield effect (e.g. Whipflash)
  | { type: 'advance' }; // main1 -> combat, or end -> next turn

export const opponentOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
