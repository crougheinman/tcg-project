import { BLITZ_BEASTS, getDef } from '../cards/cards';
import type {
  Action,
  CardDef,
  CardInstance,
  Effect,
  GameState,
  PlayerId,
  Keyword,
  PlayerState,
  Target,
} from './types';
import { needsTarget, opponentOf } from './types';
import { MAX_MULLIGANS } from './state';

// ---- Stat helpers (effective power/toughness include permanent buffs) ----

export function power(c: CardInstance): number {
  return (getDef(c.def).power ?? 0) + c.buffP + (c.auraP ?? 0) + (c.tempP ?? 0);
}
export function toughness(c: CardInstance): number {
  return (getDef(c.def).toughness ?? 0) + c.buffT + (c.auraT ?? 0) + (c.tempT ?? 0);
}
/** Threshold: cards in a graveyard that switch on a `when: 'threshold'` static ability. */
export const THRESHOLD = 7;
/**
 * What the static abilities on `p`'s battlefield give creature `c` (one of p's creatures), worked out from scratch. `blitz` is true when a
 * static marked 'blitz' (Beast Blitz) is among them. Pure: the engine writes the result to `auraP` / `auraT` / `blitz` after every action.
 */
export function staticBonus(p: PlayerState, c: CardInstance): { power: number; toughness: number; blitz: boolean } {
  let power = 0;
  let toughness = 0;
  let blitz = false;
  const counted = new Set<string>(); // `unique` statics already applied to this creature, by source card id
  for (const src of p.battlefield) {
    const st = getDef(src.def).static;
    if (!st) continue;
    if (st.when === 'threshold' && p.graveyard.length < THRESHOLD) continue;
    const a = st.affects;
    if (!((a.self && src === c) || (a.others && src !== c) || a.ids?.includes(c.def))) continue;
    if (st.unique) {
      if (counted.has(src.def)) continue;
      counted.add(src.def);
    }
    power += st.power;
    toughness += st.toughness;
    if (st.mark === 'blitz') blitz = true;
  }
  return { power, toughness, blitz };
}
export function hasKeyword(c: CardInstance, kw: Keyword): boolean {
  return (getDef(c.def).keywords ?? []).includes(kw);
}
/**
 * Has `c` taken enough to die? Marked damage at or past its toughness, except that an indestructible creature ignores
 * damage (deathtouch and `destroy` included) and dies only when its toughness has fallen to 0.
 */
export function isLethal(c: CardInstance): boolean {
  return hasKeyword(c, 'indestructible') ? toughness(c) <= 0 : c.damage >= toughness(c);
}
export function isCreature(c: CardInstance): boolean {
  return getDef(c.def).type === 'creature';
}
/**
 * Does casting `card` set Beast Blitz off? Only when Kunoichi and a beast end up on the battlefield
 * together because of it: Kunoichi cast with a beast already there, a beast cast (or made, by a token
 * spell like Call Wolves) with Kunoichi there. Read it BEFORE the card enters. `show` is the card the
 * announcement features: Kunoichi herself, or the spell that made the beasts.
 */
export function blitzCue(p: PlayerState, card: CardInstance): { show: CardInstance } | null {
  const kunoichi = p.battlefield.find((c) => getDef(c.def).static?.mark === 'blitz');
  const def = getDef(card.def);
  if (getDef(card.def).static?.mark === 'blitz') return p.battlefield.some((c) => BLITZ_BEASTS.includes(c.def)) ? { show: card } : null;
  if (!kunoichi) return null;
  if (def.type === 'creature') return BLITZ_BEASTS.includes(card.def) ? { show: kunoichi } : null;
  if (def.effect?.type === 'token' && BLITZ_BEASTS.includes(def.effect.token)) return { show: card };
  return null;
}
/**
 * Is this cast a Flash cast: a flash creature put out at instant speed (the attack or block step) rather than in
 * its owner's main phase, where it is an ordinary creature? Only these casts get the flash cut-in. Read BEFORE the card enters.
 */
export function isFlashCast(state: GameState, card: CardInstance): boolean {
  return hasKeyword(card, 'flash') && state.phase !== 'main1';
}
export function isLand(c: CardInstance): boolean {
  return getDef(c.def).type === 'land';
}

export function untappedLands(p: PlayerState): CardInstance[] {
  return p.battlefield.filter((c) => isLand(c) && !c.tapped);
}
export function availableMana(p: PlayerState): number {
  return untappedLands(p).length + (p.pool ?? 0);
}
/** Why `c` (one of `p`'s creatures) cannot use its activated ability now, or null if it can. The single definition, shared by the validator, `legalActions`, the AI and the UI. */
export function activateError(state: GameState, p: PlayerState, c: CardInstance): string | null {
  const ab = getDef(c.def).activated;
  if (!ab) return 'that card has no ability';
  if (state.phase !== 'main1') return 'abilities are used in your main phase';
  if (ab.cost.tap && c.tapped) return 'it is tapped';
  if (ab.cost.tap && c.summoningSick) return 'it is summoning sick';
  if ((ab.cost.mana ?? 0) > availableMana(p)) return 'not enough mana';
  return null;
}

/**
 * Why `blocker` may NOT block `attacker`, or null if it may. The single definition of
 * the blocking rules for creatures: the validator enforces it and the UI uses it to
 * refuse (and explain) an illegal pairing before the player commits to it.
 */
export function blockError(blocker: CardInstance, attacker: CardInstance): string | null {
  if (!isCreature(blocker)) return 'invalid blocker';
  if (blocker.tapped) return 'tapped creature cannot block';
  if (hasKeyword(attacker, 'flying') && !hasKeyword(blocker, 'flying') && !hasKeyword(blocker, 'reach')) {
    return 'only flyers or reach creatures can block a flyer';
  }
  if (hasKeyword(attacker, 'skulk') && power(blocker) > power(attacker)) {
    return 'a skulking creature cannot be blocked by a creature with greater power';
  }
  return null;
}

export function canBlock(blocker: CardInstance, attacker: CardInstance): boolean {
  return blockError(blocker, attacker) === null;
}

// ---- Combat damage ----
//
// Combat has two damage steps. Creatures with first strike (or double strike) deal damage in
// step 1; the rest deal it in step 2, together with double strikers' second hit. Deaths are
// resolved between the steps, so a first striker can kill its opponent before it strikes back.
// Both the reducer (`resolveCombat`) and the AI's predictor (`duel`) use these helpers, and a
// property test holds `duel` equal to the real resolution, so the AI cannot misjudge a fight.

export type DamageStep = 1 | 2;

/** Does `c` deal combat damage in `step`? */
export function strikesIn(c: CardInstance, step: DamageStep): boolean {
  const fs = hasKeyword(c, 'firstStrike');
  const ds = hasKeyword(c, 'doubleStrike');
  return step === 1 ? fs || ds : ds || !fs;
}

/** Damage still needed for `source` to destroy `target`: 1 if the source has deathtouch. */
export function lethalFor(source: CardInstance, target: CardInstance): number {
  const left = Math.max(0, toughness(target) - target.damage);
  return hasKeyword(source, 'deathtouch') ? Math.min(1, left) : left;
}

/** Mark `amount` combat damage from `source` on `target` (deathtouch makes any damage lethal). */
export function markDamage(source: CardInstance, target: CardInstance, amount: number): void {
  if (amount <= 0) return;
  target.damage += amount;
  if (hasKeyword(source, 'deathtouch')) target.damage = Math.max(target.damage, toughness(target));
}

/** How one attacker's combat damage splits, given whether its blocker is still there. */
export function splitDamage(
  atk: CardInstance,
  blk: CardInstance | null,
  blocked: boolean,
): { toBlocker: number; toFace: number } {
  const dmg = power(atk);
  if (!blocked) return { toBlocker: 0, toFace: dmg };
  const tramples = hasKeyword(atk, 'trample');
  if (!blk) return { toBlocker: 0, toFace: tramples ? dmg : 0 }; // its blocker is already gone
  if (!tramples) return { toBlocker: dmg, toFace: 0 };
  const toBlocker = Math.min(dmg, lethalFor(atk, blk));
  return { toBlocker, toFace: dmg - toBlocker };
}

export interface DuelResult {
  atkDies: boolean;
  blkDies: boolean;
  /** Damage that reaches the defending player (trample overflow). */
  toFace: number;
  /** Life gained by the attacker's / the blocker's controller (lifelink). */
  atkGain: number;
  blkGain: number;
}

/**
 * Predict a single block, attacker vs its one blocker, without touching the state. Works on
 * throwaway copies, so callers may pass a hypothetical blocker (e.g. with a pump applied).
 */
export function duel(attacker: CardInstance, blocker: CardInstance): DuelResult {
  const a = { ...attacker };
  const b = { ...blocker };
  // Bushido: a creature that blocks or becomes blocked gets +1/+1 (here both are in this one fight)
  for (const c of [a, b]) {
    if (hasKeyword(c, 'bushido')) {
      c.tempP = (c.tempP ?? 0) + 1;
      c.tempT = (c.tempT ?? 0) + 1;
    }
  }
  const out: DuelResult = { atkDies: false, blkDies: false, toFace: 0, atkGain: 0, blkGain: 0 };
  let aAlive = true;
  let bAlive = true;
  for (const step of [1, 2] as DamageStep[]) {
    let toA = 0;
    let toB = 0;
    if (aAlive && strikesIn(a, step)) {
      const { toBlocker, toFace } = splitDamage(a, bAlive ? b : null, true);
      toB = toBlocker;
      out.toFace += toFace;
      if (hasKeyword(a, 'lifelink')) out.atkGain += toBlocker + toFace;
    }
    if (bAlive && aAlive && strikesIn(b, step)) {
      toA = power(b);
      if (hasKeyword(b, 'lifelink')) out.blkGain += toA;
    }
    markDamage(b, a, toA);
    markDamage(a, b, toB);
    aAlive = !isLethal(a);
    bAlive = !isLethal(b);
  }
  out.atkDies = !aAlive;
  out.blkDies = !bAlive;
  return out;
}

export function canAttack(c: CardInstance): boolean {
  return isCreature(c) && !c.tapped && !c.summoningSick && !hasKeyword(c, 'defender');
}

/** Find a creature on either battlefield by instance id. */
/** The effect a cast resolves: the chosen mode of a modal spell, with X applied to an X spell's amount. */
export function spellEffect(def: CardDef, o: { x?: number; mode?: number }): Effect | undefined {
  const base = def.modes ? def.modes[o.mode ?? 0] : def.effect;
  if (!base) return undefined;
  if (def.x && (base.type === 'damage' || base.type === 'heal' || base.type === 'draw')) return { ...base, amount: base.amount * (o.x ?? 0) };
  return base;
}
/** What a spell costs to cast with these options: its cost (or flashback cost), plus X, plus the kicker if paid, plus the ward of an opposing creature it targets. The one cost definition (validation, legalActions, payment, AI, UI). */
export function castCost(
  state: GameState,
  caster: PlayerId,
  def: CardDef,
  o: { x?: number; kicked?: boolean; target?: Target },
  fromGrave = false,
): number {
  let cost = fromGrave ? def.flashback! : def.cost;
  if (def.x) cost += o.x ?? 0;
  if (o.kicked && def.kicker) cost += def.kicker.cost;
  if (o.target?.kind === 'creature') {
    const f = findCreature(state, o.target.iid);
    if (f && f.controller !== caster) cost += getDef(f.card.def).ward ?? 0;
  }
  return cost;
}

/** May `caster` target this creature with a spell or ability? Hexproof stops the OPPONENT of its controller; its controller may still target it. */
export function canTargetCreature(caster: PlayerId, card: CardInstance, controller: PlayerId): boolean {
  return controller === caster || !hasKeyword(card, 'hexproof');
}

export function findCreature(
  state: GameState,
  iid: string,
): { card: CardInstance; controller: PlayerId } | null {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const card = state.players[pid].battlefield.find((c) => c.iid === iid);
    if (card) return { card, controller: pid };
  }
  return null;
}

/**
 * The single player who may legally originate an action right now.
 *
 * At every point in the game exactly one player is the actor. During
 * `combat_block` that is the DEFENDER (they declare blocks and cast block-only
 * instants and flash creatures); while a trigger is pending it is the trigger's
 * controller; otherwise it is the active player.
 *
 * The lockstep PvP transport depends on this invariant — a single global `seq`
 * counter is only coherent while one side acts at a time. Reuse this helper
 * everywhere the "who acts now" question is asked; do NOT re-inline the ternary.
 */
export function actorOf(state: GameState): PlayerId {
  if (state.pending) return state.pending.controller; // the trigger's controller chooses its target
  if (state.phase === 'mulligan') return state.mulligan?.deciding ?? state.active; // the opening-hand decision
  return state.phase === 'combat_block' ? opponentOf(state.active) : state.active;
}

function inHand(p: PlayerState, iid: string): CardInstance | null {
  return p.hand.find((c) => c.iid === iid) ?? null;
}

// ---- Legal action enumeration (used by the AI; UI gates via validateAction) ----

/**
 * Every discrete action the given player may legally take right now.
 *
 * This is the AI's single source of candidate moves: it mirrors `validateAction`
 * exactly, so the AI can never emit something the reducer will reject. Keep the
 * two in step — if you add a rule to the validator, add it here.
 *
 * Combat DECLARATIONS are deliberately excluded: `declareAttackers` /
 * `declareBlockers` are combinatorial (every subset / assignment), so enumerating
 * them is exponential. The AI builds those two directly in `pickAttacks` /
 * `pickBlocks`. Everything else — lands, creatures, spells, triggers, advance —
 * is enumerated here.
 */
export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (state.winner) return [];
  if (actorOf(state) !== player) return []; // not this player's move to make

  // A pending trigger must be resolved before anything else is legal.
  if (state.pending) {
    if (state.pending.kind === 'sacrifice') {
      // Edict: the victim's own creatures
      return state.players[state.pending.controller].battlefield
        .filter(isCreature)
        .map((c): Action => ({ type: 'resolveTrigger', target: c.iid }));
    }
    if (state.pending.kind === 'scry') return [{ type: 'scry', bottom: false }, { type: 'scry', bottom: true }];
    if (state.pending.kind === 'discard') {
      return state.players[state.pending.controller].hand.map((c): Action => ({ type: 'resolveTrigger', target: c.iid }));
    }
    const src = state.pending.source;
    const out: Action[] = [];
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of state.players[pid].battlefield) {
        if (isCreature(c) && c.iid !== src && canTargetCreature(state.pending.controller, c, pid)) out.push({ type: 'resolveTrigger', target: c.iid });
      }
    }
    return out;
  }

  const p = state.players[player];
  const actions: Action[] = [];

  if (state.phase === 'mulligan') {
    actions.push({ type: 'keepHand' });
    if ((state.mulligan?.taken[player] ?? 0) < MAX_MULLIGANS) actions.push({ type: 'mulligan' });
    return actions;
  }

  if (state.phase === 'main1') {
    const mana = availableMana(p);
    for (const c of p.hand) {
      const def = getDef(c.def);
      if (def.type === 'land' && !p.landPlayedThisTurn) {
        actions.push({ type: 'playLand', iid: c.iid });
      } else if (def.type === 'creature' && def.cost <= mana) {
        actions.push({ type: 'castCreature', iid: c.iid });
      }
    }
    for (const c of p.hand) {
      const cost = getDef(c.def).cycling;
      if (cost !== undefined && cost <= mana) actions.push({ type: 'cycle', iid: c.iid });
    }
    for (const c of p.battlefield) {
      if (isCreature(c) && getDef(c.def).activated && !activateError(state, p, c)) actions.push({ type: 'activate', iid: c.iid });
    }
    actions.push(...spellActions(state, player));
    actions.push({ type: 'advance' }); // move to combat
  } else if (state.phase === 'combat_attack') {
    // Instants only — sorceries are main-phase. declareAttackers is built by the AI.
    actions.push(...spellActions(state, player));
    actions.push(...flashActions(state, player));
    actions.push({ type: 'advance' });
  } else if (state.phase === 'combat_block') {
    // The defender acts here: block-only instants become available, and
    // declareBlockers itself is built by the AI.
    actions.push(...spellActions(state, player));
    actions.push(...flashActions(state, player));
  } else if (state.phase === 'end') {
    actions.push({ type: 'advance' });
  }
  return actions;
}

/** Flash creatures the caster can afford: castable outside the main phase, like an instant. */
function flashActions(state: GameState, caster: PlayerId): Action[] {
  const p = state.players[caster];
  const mana = availableMana(p);
  return p.hand
    .filter((c) => getDef(c.def).type === 'creature' && hasKeyword(c, 'flash') && getDef(c.def).cost <= mana)
    .map((c) => ({ type: 'castCreature' as const, iid: c.iid }));
}

/**
 * Castable spells in hand for `caster`, with every legal target enumerated.
 * Mirrors the `castSorcery` arm of `validateAction`: sorceries are main-phase
 * only, block-only instants require `combat_block`, and instants are otherwise
 * free-timing for whoever currently holds priority.
 */
function spellActions(state: GameState, caster: PlayerId): Action[] {
  const p = state.players[caster];
  const mana = availableMana(p);
  const out: Action[] = [];

  // A spell can be cast from the hand, or from the graveyard if it has flashback (at its flashback cost).
  const castable = [
    ...p.hand.map((c) => ({ c, fromGrave: false })),
    ...p.graveyard.filter((c) => getDef(c.def).flashback !== undefined).map((c) => ({ c, fromGrave: true })),
  ];
  for (const { c, fromGrave } of castable) {
    const def = getDef(c.def);
    if (def.type !== 'sorcery' && def.type !== 'instant') continue;
    if (def.type === 'sorcery' && state.phase !== 'main1') continue;
    if (def.blockOnly && state.phase !== 'combat_block') continue;
    if (!def.effect) continue;
    const base = fromGrave ? def.flashback! : def.cost;
    if (base > mana) continue;

    // every combination of cast options: a mode, the kicker, an X (from 1: an X of 0 is legal but a blank, so it is not offered)
    const modes: (number | undefined)[] = def.modes ? def.modes.map((_, i) => i) : [undefined];
    const kicks = def.kicker && !fromGrave ? [false, true] : [false];
    for (const mode of modes) {
      for (const kicked of kicks) {
        const afterKick = base + (kicked && def.kicker ? def.kicker.cost : 0);
        if (afterKick > mana) continue;
        const xs: (number | undefined)[] = def.x ? Array.from({ length: Math.min(mana - afterKick, 12) }, (_, i) => i + 1) : [undefined];
        for (const x of xs) {
          const opts = { ...(mode !== undefined ? { mode } : {}), ...(kicked ? { kicked: true } : {}), ...(x !== undefined ? { x } : {}) };
          const eff = spellEffect(def, opts);
          if (!eff) continue;
          const push = (target?: Target) => {
            if (castCost(state, caster, def, { ...opts, target }, fromGrave) <= mana) out.push({ type: 'castSorcery', iid: c.iid, ...(target ? { target } : {}), ...opts });
          };
          if (!needsTarget(eff)) {
            // Ramp with no land in hand is a legal cast but a guaranteed blank.
            if (eff.type !== 'ramp' || p.hand.some(isLand)) push();
          } else if (eff.type === 'damage' || eff.type === 'buff') {
            for (const t of legalTargets(state, caster, eff.targets)) push(t);
          } else if (eff.type === 'bounce') {
            for (const t of legalTargets(state, caster, 'creature')) push(t);
          } else if (eff.type === 'bite') {
            // an opposing creature to bite, and one of ours to do the biting
            if (!p.battlefield.some(isCreature)) continue;
            for (const t of legalTargets(state, caster, 'creature')) {
              if (t.kind === 'creature' && state.players[opponentOf(caster)].battlefield.some((x) => x.iid === t.iid)) push(t);
            }
          } else if (eff.type === 'destroy') {
            // Only tapped creatures are valid targets.
            for (const pid of ['A', 'B'] as PlayerId[]) {
              for (const cc of state.players[pid].battlefield) {
                if (isCreature(cc) && cc.tapped && canTargetCreature(caster, cc, pid)) push({ kind: 'creature', iid: cc.iid });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

export function legalTargets(
  state: GameState,
  actor: PlayerId,
  spec: 'any' | 'creature' | 'player',
): Target[] {
  const out: Target[] = [];
  if (spec === 'any' || spec === 'player') {
    out.push({ kind: 'player', player: 'A' }, { kind: 'player', player: 'B' });
  }
  if (spec === 'any' || spec === 'creature') {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of state.players[pid].battlefield) {
        if (isCreature(c) && canTargetCreature(actor, c, pid)) out.push({ kind: 'creature', iid: c.iid });
      }
    }
  }
  return out;
}

// ---- Validation: throws on illegal actions (defensive for networked input) ----

export function validateAction(state: GameState, action: Action): void {
  if (state.winner) throw new Error('game is over');
  // A pending trigger must be resolved before anything else.
  if (state.pending && action.type !== 'resolveTrigger' && action.type !== 'scry') {
    throw new Error('resolve the pending trigger first');
  }
  if (!state.pending && (action.type === 'resolveTrigger' || action.type === 'scry')) {
    throw new Error('no trigger to resolve');
  }
  const active = state.players[state.active];

  // The opening-hand decision happens before anything else, and only then.
  if (state.phase === 'mulligan') {
    if (action.type !== 'keepHand' && action.type !== 'mulligan') throw new Error('decide on your opening hand first');
    if (action.type === 'mulligan' && (state.mulligan?.taken[state.mulligan.deciding] ?? 0) >= MAX_MULLIGANS) {
      throw new Error('no more mulligans');
    }
    return;
  }
  if (action.type === 'keepHand' || action.type === 'mulligan') throw new Error('not the mulligan phase');

  switch (action.type) {
    case 'resolveTrigger': {
      const pend = state.pending;
      if (pend?.kind === 'scry') throw new Error('a Scry is answered with the scry action');
      if (pend?.kind === 'discard') {
        // Loot: the controller discards a card of their choice from their own hand
        if (!state.players[pend.controller].hand.some((c) => c.iid === action.target)) throw new Error('choose a card from your hand to discard');
        return;
      }
      const found = findCreature(state, action.target);
      if (pend?.kind === 'sacrifice') {
        // Edict: the victim picks one of THEIR OWN creatures
        if (!found || found.controller !== pend.controller) throw new Error('choose one of your own creatures to sacrifice');
        return;
      }
      if (pend?.kind !== 'enter') throw new Error('no trigger pending');
      if (action.target === pend.source) throw new Error('cannot target the source');
      if (!found) throw new Error('target creature not found');
      if (!canTargetCreature(pend.controller, found.card, found.controller)) throw new Error('that creature has hexproof');
      return;
    }
    case 'scry': {
      if (state.pending?.kind !== 'scry') throw new Error('no Scry pending');
      return;
    }
    case 'activate': {
      requirePhase(state, 'main1');
      const c = active.battlefield.find((x) => x.iid === action.iid && isCreature(x));
      if (!c) throw new Error('not your creature');
      const why = activateError(state, active, c);
      if (why) throw new Error(why);
      return;
    }
    case 'cycle': {
      requirePhase(state, 'main1');
      const c = inHand(active, action.iid);
      const cost = c ? getDef(c.def).cycling : undefined;
      if (!c || cost === undefined) throw new Error('that card has no cycling');
      if (cost > availableMana(active)) throw new Error('not enough mana');
      return;
    }
    case 'playLand': {
      requirePhase(state, 'main1');
      const c = inHand(active, action.iid);
      if (!c || !isLand(c)) throw new Error('not a land in hand');
      if (active.landPlayedThisTurn) throw new Error('already played a land');
      return;
    }
    case 'castCreature': {
      // The caster is whoever may act now: the active player, or the defender in the block step (flash).
      const casterId = actorOf(state);
      const caster = state.players[casterId];
      const c = inHand(caster, action.iid);
      if (!c || getDef(c.def).type !== 'creature') throw new Error('not a creature in hand');
      if (hasKeyword(c, 'flash')) {
        if (state.phase === 'end') throw new Error('too late to cast');
      } else {
        requirePhase(state, 'main1');
      }
      if (getDef(c.def).cost > availableMana(caster)) throw new Error('not enough mana');
      return;
    }
    case 'castSorcery': {
      // Sorceries: your main phase only. Instants: any phase — cast by the active
      // player on their turn, or by the defender during combat_block (off-turn).
      const casterId = actorOf(state);
      const caster = state.players[casterId];
      const inGrave = caster.graveyard.find((x) => x.iid === action.iid && getDef(x.def).flashback !== undefined) ?? null;
      const c = inHand(caster, action.iid) ?? inGrave; // flashback: a spell may be cast from the graveyard
      const fromGrave = !!inGrave && !inHand(caster, action.iid);
      const type = c && getDef(c.def).type;
      if (!c || (type !== 'sorcery' && type !== 'instant')) throw new Error('not a spell in hand');
      if (type === 'sorcery') requirePhase(state, 'main1');
      if (getDef(c.def).blockOnly && state.phase !== 'combat_block')
        throw new Error('can only be cast while blocking');
      const def = getDef(c.def);
      if (!def.effect) throw new Error('spell has no effect');
      // cast options must belong to the card, and flashback casts take none
      if (action.x !== undefined && (!def.x || !Number.isInteger(action.x) || action.x < 0)) throw new Error('this spell has no X');
      if (action.kicked && !def.kicker) throw new Error('this spell has no kicker');
      if (action.mode !== undefined && (!def.modes || !Number.isInteger(action.mode) || action.mode < 0 || action.mode >= def.modes.length)) throw new Error('not a mode of this spell');
      if (def.x && action.x === undefined) throw new Error('choose a value for X');
      if (fromGrave && (def.x || def.kicker || def.modes)) throw new Error('a flashback spell takes no cast options');
      const eff = spellEffect(def, action)!;
      if (fromGrave && needsTarget(eff)) throw new Error('only untargeted spells have flashback');
      if (needsTarget(eff)) {
        if (!action.target) throw new Error('target required');
        if (eff.type === 'damage' || eff.type === 'buff') {
          validateTarget(state, eff.targets, action.target, casterId);
        } else if (eff.type === 'bounce') {
          const fb = action.target.kind === 'creature' ? findCreature(state, action.target.iid) : null;
          if (!fb) throw new Error('must target a creature in play');
          if (!canTargetCreature(casterId, fb.card, fb.controller)) throw new Error('that creature has hexproof');
        } else if (eff.type === 'bite') {
          const fb = action.target.kind === 'creature' ? findCreature(state, action.target.iid) : null;
          if (!fb || fb.controller === casterId) throw new Error('must target an opposing creature');
          if (!canTargetCreature(casterId, fb.card, fb.controller)) throw new Error('that creature has hexproof');
          if (!caster.battlefield.some(isCreature)) throw new Error('you need a creature to do the biting');
        } else if (eff.type === 'destroy') {
          if (action.target.kind !== 'creature') throw new Error('must target a creature');
          const found = findCreature(state, action.target.iid);
          if (!found) throw new Error('creature not found');
          if (!found.card.tapped) throw new Error('target must be tapped');
          if (!canTargetCreature(casterId, found.card, found.controller)) throw new Error('that creature has hexproof');
        }
      }
      if (castCost(state, casterId, def, action, fromGrave) > availableMana(caster)) throw new Error('not enough mana');
      return;
    }
    case 'declareAttackers': {
      requirePhase(state, 'combat_attack');
      for (const iid of action.attackers) {
        const found = active.battlefield.find((c) => c.iid === iid);
        if (!found) throw new Error('attacker not controlled');
        if (!canAttack(found)) throw new Error('creature cannot attack');
      }
      if (new Set(action.attackers).size !== action.attackers.length)
        throw new Error('duplicate attacker');
      return;
    }
    case 'declareBlockers': {
      requirePhase(state, 'combat_block');
      const defender = state.players[opponentOf(state.active)];
      const attackers = state.combat?.attackers ?? [];
      const usedBlockers = new Set<string>();
      const blockedAttackers = new Set<string>();
      for (const [blkIid, atkIid] of Object.entries(action.blocks)) {
        if (usedBlockers.has(blkIid)) throw new Error('blocker used twice');
        usedBlockers.add(blkIid);
        if (blockedAttackers.has(atkIid)) throw new Error('attacker blocked twice (1:1 only)');
        blockedAttackers.add(atkIid);
        const blk = defender.battlefield.find((c) => c.iid === blkIid);
        if (!blk || !isCreature(blk)) throw new Error('invalid blocker');
        if (!attackers.includes(atkIid)) throw new Error('not attacking');
        // checkDeaths drops dead attackers from combat.attackers, so this is a
        // belt-and-braces guard: a stale id must be a clean Error, never a TypeError.
        const atkFound = findCreature(state, atkIid);
        if (!atkFound) throw new Error('attacker no longer in play');
        const why = blockError(blk, atkFound.card);
        if (why) throw new Error(why);
      }
      return;
    }
    case 'advance':
      return;
  }
}

function requirePhase(state: GameState, phase: GameState['phase']): void {
  if (state.phase !== phase) throw new Error(`action requires phase ${phase}, got ${state.phase}`);
}

function validateTarget(
  state: GameState,
  spec: 'any' | 'creature' | 'player',
  target: Target,
  caster: PlayerId,
): void {
  if (target.kind === 'player') {
    if (spec === 'creature') throw new Error('must target a creature');
    return;
  }
  if (spec === 'player') throw new Error('must target a player');
  const found = findCreature(state, target.iid);
  if (!found) throw new Error('creature not found');
  if (!canTargetCreature(caster, found.card, found.controller)) throw new Error('that creature has hexproof');
}
