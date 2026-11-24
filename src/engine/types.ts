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
  | 'prowess' // +1/+1 until end of turn whenever its controller casts a spell
  | 'skulk' // cannot be blocked by a creature with greater power
  | 'bushido' // +1/+1 until end of turn when it blocks or becomes blocked
  | 'indestructible' // lethal damage and destroy effects do not kill it (only 0 toughness does)
  | 'battleCry' // when it attacks, each other attacking creature gets +1/+0 until end of turn
  | 'undying' // when it dies without a +1/+1 counter, it returns to the battlefield with one (once: a returned creature that dies again stays dead)
  | 'hexproof' // its opponents' spells and abilities cannot target it (its controller's can)
  | 'exalted'; // when a creature its controller controls attacks alone, it gets +1/+1 until end of turn for each exalted creature

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
  | { type: 'destroy'; targets: 'creature' } // destroy target (tapped) creature
  | { type: 'discard'; amount: number } // the opponent discards N cards chosen at random (deterministic, from the game's rng)
  | { type: 'recall' } // return the creature card that died most recently from your graveyard to your hand
  | { type: 'rally'; power: number; toughness: number } // all your creatures get +P/+T until end of turn (untargeted)
  | { type: 'bounce' } // return target creature to its owner's hand (a token just ceases to exist); needs a target
  | { type: 'mana'; amount: number } // add N mana to your pool until the phase ends (an activated ability's effect)
  | { type: 'scry'; amount: number } // look at the top N cards of your library and put each on the top or the bottom (a `pending` choice)
  | { type: 'loot' } // draw a card, then discard a card of your choice (a `pending` choice)
  | { type: 'bite' } // your creature with the greatest power deals damage equal to its power to target opposing creature (needs a target)
  | { type: 'edict' }; // the opponent sacrifices a creature of THEIR choice (a `pending` decision made by them; automatic when they have one)

/** Which effects need the player to pick a target. */
export function needsTarget(effect: Effect): boolean {
  return effect.type === 'damage' || effect.type === 'buff' || effect.type === 'destroy' || effect.type === 'bounce' || effect.type === 'bite';
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

/**
 * An activated ability: pay a cost at will in your main phase (`activate` action) to get an UNTARGETED effect. `tap` needs the creature
 * untapped and not summoning sick (it stays tapped through the opponent's turn, so it cannot block then); `mana` is paid from lands and pool.
 * Mana abilities add to `PlayerState.pool`, which empties when the phase changes.
 */
export interface ActivatedAbility {
  cost: { tap?: boolean; mana?: number };
  effect: Effect;
}

/**
 * A static ability: while the creature carrying it is on the battlefield (and `when` holds), the creatures it affects, among those its
 * controller controls, get +power/+toughness. The engine recomputes every creature's bonus from scratch after each action (auraP / auraT),
 * so any number of statics stack and nothing is ever added or removed incrementally. Beast Blitz is Kunoichi's static; a Lord is
 * `{ others: true }` or an id list; Threshold is `when: 'threshold'`.
 */
export interface StaticAbility {
  affects: {
    ids?: string[]; // creatures with one of these card ids (including the source itself if its id is listed)
    others?: boolean; // every OTHER creature its controller controls
    self?: boolean; // the source itself
  };
  power: number;
  toughness: number;
  when?: 'threshold'; // only while its controller has THRESHOLD (7) or more cards in their graveyard
  unique?: boolean; // several copies of the same card do not stack: a creature gets the bonus once (Beast Blitz); lords leave it off and do stack
  mark?: 'blitz'; // creatures it lifts wear the Beast Blitz lightning, and its meeting an affected creature is announced
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
  // Cast options (Part 4f2), all chosen with the cast and all costing mana, so they are checked and enumerated through `castCost` / `spellEffect` in rules.ts:
  x?: boolean; // an X spell: its damage / heal / draw effect scales with the X chosen (amount * X) and X is paid on top of the cost
  kicker?: { cost: number; effect: Effect }; // optional extra cost; when paid, this untargeted effect resolves too
  modes?: Effect[]; // modal: choose one (the cast names its index); `effect` must equal modes[0]
  ninjutsu?: number; // creature: after blockers are declared, pay this to put it from your hand into combat in place of an UNBLOCKED attacker, which returns to your hand
  unearth?: number; // creature: cost to return it from your graveyard to the battlefield with haste, in your main phase; it is exiled at the end step, or instead of dying
  ward?: number; // creature: spells your opponent casts that TARGET it cost this much more
  activated?: ActivatedAbility; // creature: an ability its controller can use in their main phase (pingers, mana creatures)
  static?: StaticAbility; // creature: a static ability (Beast Blitz, Lords, Threshold)
  landTrigger?: Effect; // creature: Landfall, resolves whenever a land enters under its controller's control (untargeted effects only)
  onAttack?: Effect; // creature: resolves whenever it attacks (untargeted effects only)
  cycling?: number; // creature or spell: in your main phase, pay this much and discard it from hand to draw a card
  /** Resolves in addition to the card's own effect when the condition holds: a creature when it enters, a spell after its effect. Untargeted effects only. */
  bonus?: { when: 'morbid' | 'secondSpell'; effect: Effect };
  blockOnly?: boolean; // instant that can be cast only during the block step (combat_block)
  flashback?: number; // spell: may be cast from the graveyard for this much mana, and is then exiled (untargeted effects only)
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
  blitz: boolean; // currently lifted by a static marked 'blitz' (Beast Blitz): drives the lightning and the announcement
  // Until-end-of-turn buff (prowess). Optional so older fixtures need no change; cleared when the next turn begins.
  tempP?: number;
  tempT?: number;
  doomed?: boolean; // sacrificed: dies at the next death check even if indestructible
  // The bonus from static abilities (Beast Blitz, Lords, Threshold), recomputed from scratch after every action. Optional so older fixtures need nothing.
  revived?: boolean; // returned by Undying: it carries its +1/+1 counter, so it cannot return again
  unearthed?: boolean; // returned by Unearth: exiled at the end step, or instead of dying
  auraP?: number;
  auraT?: number;
}

export interface PlayerState {
  id: PlayerId;
  life: number;
  library: CardInstance[]; // draw from the front (index 0 = top)
  hand: CardInstance[];
  battlefield: CardInstance[]; // lands + creatures
  graveyard: CardInstance[];
  exile?: CardInstance[]; // cards removed from the game (a flashbacked spell); optional so older fixtures need nothing
  landPlayedThisTurn: boolean;
  pool?: number; // floating mana from mana abilities; empties when the phase changes
}

export type Phase =
  | 'mulligan' // before the game: each player in turn keeps their opening hand or takes a mulligan (opt-in)
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
  kind: 'enter' | 'sacrifice' | 'scry' | 'discard' | 'ninjutsu'; // an enter effect that needs a target, an Edict waiting on the victim's choice, a Scry deciding top or bottom, a Loot choosing a card to discard, or the Ninjutsu window between blocks and damage (the attacker's)
  left?: number; // 'scry': cards still to decide; 'discard': cards still to discard
  seen?: number; // 'scry': cards already decided to stay on top
  source: string; // 'enter': iid of the creature whose trigger this is ('sacrifice': unused)
  def: string; // the card (creature or spell) behind it, so the effect is still known if the source has left play
  controller: PlayerId; // who chooses: the trigger's controller ('enter'), or the player who must sacrifice ('sacrifice')
}

/** The opening-hand decision, while `phase` is 'mulligan'. */
export interface MulliganState {
  deciding: PlayerId; // whose turn it is to keep or mulligan (A, the player on the play, first)
  taken: Record<PlayerId, number>; // mulligans each player has taken (each one means one card fewer)
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
  mulligan?: MulliganState | null; // only present when the game was created with the mulligan option
  nextIid: number; // counter for deterministic instance ids
  diedThisTurn?: boolean; // a creature has died this turn (Morbid); reset as each turn begins. Optional so older fixtures need nothing
  spellsThisTurn?: Record<PlayerId, number>; // spells (creatures included) each player has cast this turn (second-spell bonuses); reset each turn
  winner: PlayerId | 'draw' | null;
  log: string[];
}

export type Action =
  | { type: 'playLand'; iid: string }
  | { type: 'castCreature'; iid: string }
  | { type: 'castSorcery'; iid: string; target?: Target; x?: number; kicked?: boolean; mode?: number } // x / kicked / mode: the cast options of an X, kicker or modal spell
  | { type: 'declareAttackers'; attackers: string[] }
  | { type: 'declareBlockers'; blocks: Record<string, string> }
  | { type: 'resolveTrigger'; target: string } // choose the target of a pending enter effect (Whipflash), or the creature to sacrifice (Edict)
  | { type: 'activate'; iid: string } // use a creature's activated ability (its cost is paid, its effect resolves at once)
  | { type: 'scry'; bottom: boolean } // answer a pending Scry for the next card: put it on the bottom, or leave it on top
  | { type: 'ninjutsu'; ninja: string; attacker: string } // Ninjutsu: swap a ninja from hand for an unblocked attacker (answers the pending Ninjutsu window)
  | { type: 'skipNinjutsu' } // decline the Ninjutsu window: combat damage goes ahead
  | { type: 'unearth'; iid: string } // Unearth: pay a graveyard creature's unearth cost; it returns with haste and is exiled at the end step
  | { type: 'cycle'; iid: string } // Cycling: pay the card's cycling cost, discard it from hand, draw a card
  | { type: 'keepHand' } // mulligan phase: keep this opening hand
  | { type: 'mulligan' } // mulligan phase: shuffle the hand back and draw one card fewer
  | { type: 'advance' }; // main1 -> combat, or end -> next turn

export const opponentOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
