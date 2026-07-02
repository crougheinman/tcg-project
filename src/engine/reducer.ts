import { getDef } from '../cards/cards';
import type { Action, CardInstance, Effect, GameState, PlayerId, PlayerState, Target } from './types';
import { opponentOf } from './types';
import {
  availableMana,
  findCreature,
  hasKeyword,
  isCreature,
  isLand,
  toughness,
  untappedLands,
  validateAction,
  power,
} from './rules';

/**
 * The one rule: apply an action to a state, return the next state.
 * Pure — never mutates the input. Validates first, so illegal (e.g. networked)
 * actions throw instead of corrupting state.
 */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.winner) return state;
  validateAction(state, action);
  const s: GameState = structuredClone(state);
  const active = s.players[s.active];

  switch (action.type) {
    case 'playLand': {
      moveFromHand(active, action.iid, active.battlefield);
      active.landPlayedThisTurn = true;
      s.log.push(`${s.active} plays ${name(action.iid, s)}`);
      break;
    }
    case 'castCreature': {
      const c = takeFromHand(active, action.iid);
      payMana(active, getDef(c.def).cost);
      c.tapped = false;
      c.damage = 0;
      c.summoningSick = !hasKeyword(c, 'haste');
      active.battlefield.push(c);
      s.log.push(`${s.active} casts ${getDef(c.def).name}`);
      if (c.def === 'kunoichi') s.log.push(`✦ Beast Blitz activated!`);
      if (c.def === 'thornwood_brute') {
        const targets = allCreatures(s).filter((x) => x.iid !== c.iid);
        if (targets.length) {
          s.pending = { kind: 'whipflash', source: c.iid };
          s.log.push(`✦ Whipflash! Choose a creature.`);
        } else {
          s.log.push(`Whipflash fizzles — no target.`);
        }
      }
      break;
    }
    case 'whipflash': {
      const found = findCreature(s, action.target);
      if (found) {
        found.card.damage += 1;
        s.log.push(`Whipflash hits ${getDef(found.card.def).name} for 1`);
      }
      s.pending = null;
      break;
    }
    case 'castSorcery': {
      // Handles both sorceries and instants. Instants can be cast off-turn by the
      // defender during combat_block, so the caster is derived from the phase (same
      // model as blocking) rather than always being the active player.
      const casterId = s.phase === 'combat_block' ? opponentOf(s.active) : s.active;
      const caster = s.players[casterId];
      const c = takeFromHand(caster, action.iid);
      const def = getDef(c.def);
      payMana(caster, def.cost);
      caster.graveyard.push(c);
      s.log.push(`${casterId} casts ${def.name}`);
      applyEffect(s, casterId, def.effect!, action.target);
      // Creatures that trigger when their controller casts a spell. By default they
      // fire only on sorceries (e.g. Pyre Adept, Plague Priest); a creature flagged
      // `spellTriggerInstant` (e.g. Grave Necromancer) also fires on instants.
      for (const cr of caster.battlefield) {
        const crDef = getDef(cr.def);
        if (!crDef.spellTrigger) continue;
        if (def.type === 'instant' && !crDef.spellTriggerInstant) continue;
        s.log.push(`✦ ${crDef.name} triggers`);
        applyEffect(s, casterId, crDef.spellTrigger, { kind: 'player', player: opponentOf(casterId) });
      }
      break;
    }
    case 'declareAttackers': {
      for (const iid of action.attackers) {
        const c = active.battlefield.find((x) => x.iid === iid)!;
        c.tapped = true; // no vigilance in MVP
      }
      s.combat = { attackers: [...action.attackers], blocks: {} };
      if (action.attackers.length === 0) toEnd(s);
      else {
        s.phase = 'combat_block';
        s.log.push(`${s.active} attacks with ${action.attackers.length}`);
      }
      break;
    }
    case 'declareBlockers': {
      s.combat = { attackers: s.combat?.attackers ?? [], blocks: { ...action.blocks } };
      resolveCombat(s);
      break;
    }
    case 'advance': {
      if (s.phase === 'main1') {
        s.combat = { attackers: [], blocks: {} };
        s.phase = 'combat_attack';
      } else if (s.phase === 'combat_attack') {
        toEnd(s);
      } else if (s.phase === 'end') {
        beginTurn(s, opponentOf(s.active));
      }
      break;
    }
  }

  checkDeaths(s);
  recomputeAura(s); // (re)apply / remove Beast Blitz
  checkDeaths(s); // aura toughness loss may make a creature lethal
  return s;
}

// ---- internals ----

function allCreatures(s: GameState) {
  return [...s.players.A.battlefield, ...s.players.B.battlefield].filter(isCreature);
}

// Beast Blitz: while a player controls Kunoichi, their listed creatures get +1/+1.
const BLITZ_TARGETS = ['swift_lancer', 'sky_talon', 'stoneback_cub'];

function recomputeAura(s: GameState): void {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = s.players[pid];
    const hasKunoichi = p.battlefield.some((c) => c.def === 'kunoichi');
    for (const c of p.battlefield) {
      const should = hasKunoichi && BLITZ_TARGETS.includes(c.def);
      if (should && !c.blitz) {
        c.buffP += 1;
        c.buffT += 1;
        c.blitz = true;
      } else if (!should && c.blitz) {
        c.buffP -= 1;
        c.buffT -= 1;
        c.blitz = false;
      }
    }
  }
}

function name(iid: string, s: GameState): string {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const c = s.players[pid].battlefield
      .concat(s.players[pid].hand)
      .find((x) => x.iid === iid);
    if (c) return getDef(c.def).name;
  }
  return iid;
}

function moveFromHand(p: PlayerState, iid: string, dest: PlayerState['battlefield']): void {
  const c = takeFromHand(p, iid);
  dest.push(c);
}

function takeFromHand(p: PlayerState, iid: string) {
  const idx = p.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) throw new Error('card not in hand');
  return p.hand.splice(idx, 1)[0];
}

function payMana(p: PlayerState, cost: number): void {
  const lands = untappedLands(p);
  if (lands.length < cost) throw new Error('not enough mana');
  for (let i = 0; i < cost; i++) lands[i].tapped = true;
}

function drawCard(s: GameState, pid: PlayerId): void {
  const p = s.players[pid];
  if (p.library.length === 0) {
    s.winner = opponentOf(pid);
    s.log.push(`${pid} decks out and loses`);
    return;
  }
  p.hand.push(p.library.shift()!);
}

function applyEffect(s: GameState, controller: PlayerId, effect: Effect, target?: Target): void {
  switch (effect.type) {
    case 'damage': {
      if (target?.kind === 'player') {
        s.players[target.player].life -= effect.amount;
      } else if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) found.card.damage += effect.amount;
      }
      break;
    }
    case 'draw': {
      for (let i = 0; i < effect.amount; i++) drawCard(s, controller);
      break;
    }
    case 'buff': {
      if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) {
          found.card.buffP += effect.power;
          found.card.buffT += effect.toughness;
        }
      }
      break;
    }
    case 'heal': {
      s.players[controller].life += effect.amount;
      break;
    }
    case 'ramp': {
      const p = s.players[controller];
      let moved = 0;
      for (let i = p.hand.length - 1; i >= 0 && moved < effect.amount; i--) {
        if (isLand(p.hand[i])) {
          const land = p.hand.splice(i, 1)[0];
          land.tapped = false;
          p.battlefield.push(land);
          moved++;
        }
      }
      if (moved) s.log.push(`${controller} ramps ${moved} land${moved > 1 ? 's' : ''}`);
      break;
    }
    case 'token': {
      const p = s.players[controller];
      for (let i = 0; i < effect.count; i++) p.battlefield.push(makeToken(s, effect.token, controller));
      s.log.push(`${controller} creates ${effect.count} ${getDef(effect.token).name}`);
      break;
    }
    case 'tapAll': {
      const enemy = s.players[opponentOf(controller)];
      let n = 0;
      for (const c of enemy.battlefield) {
        if (isCreature(c) && !c.tapped && toughness(c) <= effect.maxToughness) {
          c.tapped = true;
          n++;
        }
      }
      s.log.push(`${controller} topples ${n} creature${n === 1 ? '' : 's'}`);
      break;
    }
    case 'destroy': {
      if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) {
          found.card.damage += 9999; // lethal -> checkDeaths removes it (+ destroy VFX)
          s.log.push(`${getDef(found.card.def).name} is destroyed`);
        }
      }
      break;
    }
  }
}

function makeToken(s: GameState, defId: string, owner: PlayerId): CardInstance {
  return {
    iid: `c${s.nextIid++}`,
    def: defId,
    owner,
    tapped: false,
    summoningSick: true,
    damage: 0,
    buffP: 0,
    buffT: 0,
    blitz: false,
  };
}

function resolveCombat(s: GameState): void {
  const combat = s.combat!;
  // Snapshot what actually happened so the UI can animate/announce it — `combat`
  // itself is cleared by toEnd() below, and blocks never persist in `combat_block`.
  s.lastCombat = { attackers: [...combat.attackers], blocks: { ...combat.blocks } };
  const defender = s.players[opponentOf(s.active)];
  const blockersByAttacker: Record<string, string[]> = {};
  for (const [blk, atk] of Object.entries(combat.blocks)) {
    (blockersByAttacker[atk] ||= []).push(blk);
  }

  for (const atkIid of combat.attackers) {
    const atk = findCreature(s, atkIid)?.card;
    if (!atk) continue; // died before damage (e.g. removed)
    const blockers = (blockersByAttacker[atkIid] ?? [])
      .map((iid) => findCreature(s, iid)?.card)
      .filter((c): c is NonNullable<typeof c> => !!c);

    if (blockers.length === 0) {
      defender.life -= power(atk); // unblocked -> face
    } else {
      // 1:1 blocking (validated). Trade damage both ways.
      for (const b of blockers) {
        b.damage += power(atk);
        atk.damage += power(b);
      }
    }
  }
  checkDeaths(s); // resolve lethal damage before cleanup wipes it
  toEnd(s);
}

/** Enter the end step: combat over, marked damage wears off (cleanup). */
function toEnd(s: GameState): void {
  s.combat = null;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const c of s.players[pid].battlefield) c.damage = 0;
  }
  s.phase = 'end';
}

function beginTurn(s: GameState, next: PlayerId): void {
  s.active = next;
  s.turn += 1;
  const p = s.players[next];
  for (const c of p.battlefield) {
    c.tapped = false;
    c.summoningSick = false;
  }
  p.landPlayedThisTurn = false;
  s.phase = 'main1';
  drawCard(s, next);
  s.log.push(`Turn ${s.turn}: ${next}'s turn`);
}

/** State-based actions: lethal-damage deaths and life<=0 loss. */
function checkDeaths(s: GameState): void {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = s.players[pid];
    const dead = p.battlefield.filter((c) => isCreature(c) && c.damage >= toughness(c));
    if (dead.length) {
      p.battlefield = p.battlefield.filter((c) => !dead.includes(c));
      for (const c of dead) {
        c.tapped = false;
        c.damage = 0;
        c.buffP = 0;
        c.buffT = 0;
        c.blitz = false;
        c.summoningSick = true;
        s.players[c.owner].graveyard.push(c);
        s.log.push(`${getDef(c.def).name} dies`);
        if (c.def === 'kunoichi' && !p.battlefield.some((x) => x.def === 'kunoichi')) {
          s.log.push(`Beast Blitz fades.`);
        }
      }
    }
  }
  const aDead = s.players.A.life <= 0;
  const bDead = s.players.B.life <= 0;
  if (aDead && bDead) s.winner = 'draw';
  else if (aDead) s.winner = 'B';
  else if (bDead) s.winner = 'A';
}

// re-export for convenience
export { isLand, isCreature, availableMana };
