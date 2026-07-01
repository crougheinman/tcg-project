import { getDef } from '../cards/cards';
import type {
  Action,
  CardInstance,
  GameState,
  PlayerId,
  PlayerState,
  Target,
} from './types';
import { needsTarget, opponentOf } from './types';

// ---- Stat helpers (effective power/toughness include permanent buffs) ----

export function power(c: CardInstance): number {
  return (getDef(c.def).power ?? 0) + c.buffP;
}
export function toughness(c: CardInstance): number {
  return (getDef(c.def).toughness ?? 0) + c.buffT;
}
export function hasKeyword(c: CardInstance, kw: string): boolean {
  return (getDef(c.def).keywords ?? []).includes(kw as never);
}
export function isCreature(c: CardInstance): boolean {
  return getDef(c.def).type === 'creature';
}
export function isLand(c: CardInstance): boolean {
  return getDef(c.def).type === 'land';
}

export function untappedLands(p: PlayerState): CardInstance[] {
  return p.battlefield.filter((c) => isLand(c) && !c.tapped);
}
export function availableMana(p: PlayerState): number {
  return untappedLands(p).length;
}

export function canAttack(c: CardInstance): boolean {
  return isCreature(c) && !c.tapped && !c.summoningSick && !hasKeyword(c, 'defender');
}

/** Find a creature on either battlefield by instance id. */
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

function inHand(p: PlayerState, iid: string): CardInstance | null {
  return p.hand.find((c) => c.iid === iid) ?? null;
}

// ---- Legal action enumeration (used by the AI; UI gates via validateAction) ----

export function legalActions(state: GameState, player: PlayerId): Action[] {
  if (state.winner) return [];
  if (state.active !== player) {
    // Off-turn, the only input is blocking during the active player's combat.
    if (state.phase === 'combat_block') return []; // blocks enumerated separately by AI
    return [];
  }
  const p = state.players[player];
  const actions: Action[] = [];

  if (state.phase === 'main1') {
    const mana = availableMana(p);
    for (const c of p.hand) {
      const def = getDef(c.def);
      if (def.type === 'land' && !p.landPlayedThisTurn) {
        actions.push({ type: 'playLand', iid: c.iid });
      } else if (def.type === 'creature' && def.cost <= mana) {
        actions.push({ type: 'castCreature', iid: c.iid });
      } else if (
        (def.type === 'sorcery' || def.type === 'instant') &&
        !def.blockOnly && // block-only instants aren't castable on your turn
        def.cost <= mana &&
        def.effect
      ) {
        const eff = def.effect;
        if (!needsTarget(eff)) {
          if (eff.type !== 'ramp' || p.hand.some(isLand)) {
            actions.push({ type: 'castSorcery', iid: c.iid });
          }
        } else if (eff.type === 'damage' || eff.type === 'buff') {
          for (const t of legalTargets(state, player, eff.targets)) {
            actions.push({ type: 'castSorcery', iid: c.iid, target: t });
          }
        } else if (eff.type === 'destroy') {
          // only tapped creatures are valid targets
          for (const pid of ['A', 'B'] as PlayerId[]) {
            for (const cc of state.players[pid].battlefield) {
              if (isCreature(cc) && cc.tapped) {
                actions.push({ type: 'castSorcery', iid: c.iid, target: { kind: 'creature', iid: cc.iid } });
              }
            }
          }
        }
      }
    }
    actions.push({ type: 'advance' }); // move to combat
  } else if (state.phase === 'combat_attack' || state.phase === 'end') {
    actions.push({ type: 'advance' });
  }
  return actions;
}

export function legalTargets(
  state: GameState,
  _actor: PlayerId,
  spec: 'any' | 'creature' | 'player',
): Target[] {
  const out: Target[] = [];
  if (spec === 'any' || spec === 'player') {
    out.push({ kind: 'player', player: 'A' }, { kind: 'player', player: 'B' });
  }
  if (spec === 'any' || spec === 'creature') {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of state.players[pid].battlefield) {
        if (isCreature(c)) out.push({ kind: 'creature', iid: c.iid });
      }
    }
  }
  return out;
}

// ---- Validation: throws on illegal actions (defensive for networked input) ----

export function validateAction(state: GameState, action: Action): void {
  if (state.winner) throw new Error('game is over');
  // A pending trigger must be resolved before anything else.
  if (state.pending && action.type !== 'whipflash') {
    throw new Error('resolve the pending trigger first');
  }
  if (!state.pending && action.type === 'whipflash') {
    throw new Error('no trigger to resolve');
  }
  const active = state.players[state.active];

  switch (action.type) {
    case 'whipflash': {
      if (state.pending?.kind !== 'whipflash') throw new Error('no whipflash pending');
      if (action.target === state.pending.source) throw new Error('cannot target the source');
      const found = findCreature(state, action.target);
      if (!found) throw new Error('target creature not found');
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
      requirePhase(state, 'main1');
      const c = inHand(active, action.iid);
      if (!c || getDef(c.def).type !== 'creature') throw new Error('not a creature in hand');
      if (getDef(c.def).cost > availableMana(active)) throw new Error('not enough mana');
      return;
    }
    case 'castSorcery': {
      // Sorceries: your main phase only. Instants: any phase — cast by the active
      // player on their turn, or by the defender during combat_block (off-turn).
      const casterId = state.phase === 'combat_block' ? opponentOf(state.active) : state.active;
      const caster = state.players[casterId];
      const c = inHand(caster, action.iid);
      const type = c && getDef(c.def).type;
      if (!c || (type !== 'sorcery' && type !== 'instant')) throw new Error('not a spell in hand');
      if (type === 'sorcery') requirePhase(state, 'main1');
      if (getDef(c.def).blockOnly && state.phase !== 'combat_block')
        throw new Error('can only be cast while blocking');
      const def = getDef(c.def);
      if (!def.effect) throw new Error('spell has no effect');
      if (def.cost > availableMana(caster)) throw new Error('not enough mana');
      if (needsTarget(def.effect)) {
        if (!action.target) throw new Error('target required');
        if (def.effect.type === 'damage' || def.effect.type === 'buff') {
          validateTarget(state, def.effect.targets, action.target);
        } else if (def.effect.type === 'destroy') {
          if (action.target.kind !== 'creature') throw new Error('must target a creature');
          const found = findCreature(state, action.target.iid);
          if (!found) throw new Error('creature not found');
          if (!found.card.tapped) throw new Error('target must be tapped');
        }
      }
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
        if (blk.tapped) throw new Error('tapped creature cannot block');
        if (!attackers.includes(atkIid)) throw new Error('not attacking');
        const atk = findCreature(state, atkIid)!.card;
        if (hasKeyword(atk, 'flying') && !hasKeyword(blk, 'flying'))
          throw new Error('only flyers can block a flyer');
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
): void {
  if (target.kind === 'player') {
    if (spec === 'creature') throw new Error('must target a creature');
    return;
  }
  if (spec === 'player') throw new Error('must target a player');
  if (!findCreature(state, target.iid)) throw new Error('creature not found');
}
