import { getDef } from '../cards/cards';
import type {
  Action,
  CardInstance,
  GameState,
  PlayerId,
  PlayerState,
  Target,
} from './types';
import { opponentOf } from './types';

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
  return isCreature(c) && !c.tapped && !c.summoningSick;
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
      } else if (def.type === 'sorcery' && def.cost <= mana && def.effect) {
        const eff = def.effect;
        if (eff.type === 'draw') {
          actions.push({ type: 'castSorcery', iid: c.iid });
        } else {
          for (const t of legalTargets(state, player, eff.targets)) {
            actions.push({ type: 'castSorcery', iid: c.iid, target: t });
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
  const active = state.players[state.active];

  switch (action.type) {
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
      requirePhase(state, 'main1');
      const c = inHand(active, action.iid);
      if (!c || getDef(c.def).type !== 'sorcery') throw new Error('not a sorcery in hand');
      const def = getDef(c.def);
      if (!def.effect) throw new Error('sorcery has no effect');
      if (def.cost > availableMana(active)) throw new Error('not enough mana');
      if (def.effect.type !== 'draw') {
        if (!action.target) throw new Error('target required');
        validateTarget(state, def.effect.targets, action.target);
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
