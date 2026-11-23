import { BLITZ_BEASTS, getDef, isToken } from '../cards/cards';
import type { Action, CardInstance, Effect, GameState, PlayerId, PlayerState, Target } from './types';
import { needsCreatureChoice, opponentOf } from './types';
import { nextRandom, shuffle } from './rng';
import { OPENING_HAND } from './state';
import {
  actorOf,
  availableMana,
  blitzCue,
  findCreature,
  hasKeyword,
  isCreature,
  isLand,
  isLethal,
  markDamage,
  splitDamage,
  strikesIn,
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
      // Whoever may act now casts it: the active player, or the defender when a flash creature
      // is cast in the block step.
      const casterId = actorOf(state);
      const caster = s.players[casterId];
      const c = takeFromHand(caster, action.iid);
      const def = getDef(c.def);
      payMana(caster, def.cost);
      const blitz = blitzCue(caster, c); // Kunoichi + a beast together because of this cast (read before it enters)
      c.tapped = false;
      c.damage = 0;
      c.summoningSick = !hasKeyword(c, 'haste');
      caster.battlefield.push(c);
      s.log.push(`${casterId} casts ${def.name}`);
      const skill = def.skill ?? def.name;
      if (def.onEnter) {
        if (needsCreatureChoice(def.onEnter)) {
          if (allCreatures(s).some((x) => x.iid !== c.iid)) {
            s.pending = { kind: 'enter', source: c.iid, def: c.def, controller: casterId };
            s.log.push(`✦ ${skill}! Choose a creature.`);
          } else {
            s.log.push(`${skill} fizzles — no target.`);
          }
        } else {
          s.log.push(`✦ ${skill}`);
          applyEffect(s, casterId, def.onEnter, { kind: 'player', player: opponentOf(casterId) });
        }
      } else if (def.skill && def.skill !== 'Beast Blitz') {
        s.log.push(`✦ ${def.skill} activated!`); // a static skill: it simply switches on
      }
      // Beast Blitz announces itself only when Kunoichi and a beast meet, whichever arrives second.
      if (blitz) s.log.push('✦ Beast Blitz activated!');
      break;
    }
    case 'keepHand': {
      const m = s.mulligan!;
      const took = m.taken[m.deciding];
      s.log.push(`${m.deciding} keeps ${took ? `${OPENING_HAND - took} cards` : 'their hand'}`);
      if (m.deciding === 'A') {
        m.deciding = 'B';
      } else {
        s.phase = 'main1'; // both have decided: the game begins on A's turn
        s.mulligan = null;
        s.log.push('The game begins. A is on the play.');
      }
      break;
    }
    case 'mulligan': {
      const m = s.mulligan!;
      const pid = m.deciding;
      const p = s.players[pid];
      m.taken[pid] += 1;
      const [mixed, next] = shuffle([...p.hand, ...p.library], s.rngState); // hand back into the deck, reshuffled
      s.rngState = next;
      const size = OPENING_HAND - m.taken[pid];
      p.hand = mixed.slice(0, size);
      p.library = mixed.slice(size);
      s.log.push(`${pid} takes a mulligan: ${size} cards`);
      break;
    }
    case 'resolveTrigger': {
      const pend = s.pending!;
      const def = getDef(pend.def);
      const found = findCreature(s, action.target);
      if (found && def.onEnter) {
        applyEffect(s, pend.controller, def.onEnter, { kind: 'creature', iid: action.target });
        if (def.onEnter.type === 'damage') {
          s.log.push(`${def.skill ?? def.name} hits ${getDef(found.card.def).name} for ${def.onEnter.amount}`);
        }
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
      // Flashback: a spell not in hand is cast from the graveyard for its flashback cost, then exiled.
      const fromGrave = !caster.hand.some((x) => x.iid === action.iid);
      const c = fromGrave ? takeFromGraveyard(caster, action.iid) : takeFromHand(caster, action.iid);
      const def = getDef(c.def);
      payMana(caster, fromGrave ? def.flashback! : def.cost);
      if (fromGrave) (caster.exile ??= []).push(c);
      else caster.graveyard.push(c);
      s.log.push(`${casterId} casts ${def.name}${fromGrave ? ' (flashback)' : ''}`);
      const blitz = blitzCue(caster, c); // a token spell (Call Wolves) making beasts next to Kunoichi
      applyEffect(s, casterId, def.effect!, action.target);
      if (blitz) s.log.push('✦ Beast Blitz activated!');
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
      // Prowess: +1/+1 until end of turn for each such creature, on any spell (sorcery or instant).
      for (const cr of caster.battlefield) {
        if (!isCreature(cr) || !hasKeyword(cr, 'prowess')) continue;
        cr.tempP = (cr.tempP ?? 0) + 1;
        cr.tempT = (cr.tempT ?? 0) + 1;
        s.log.push(`✦ ${getDef(cr.def).name} — prowess`);
      }
      break;
    }
    case 'declareAttackers': {
      for (const iid of action.attackers) {
        const c = active.battlefield.find((x) => x.iid === iid)!;
        if (!hasKeyword(c, 'vigilance')) c.tapped = true; // vigilance: attacking does not tap
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
      // Bushido: a creature that blocks, or is blocked, gets +1/+1 until end of turn (before damage)
      for (const [blk, atk] of Object.entries(s.combat.blocks)) {
        for (const iid of [blk, atk]) {
          const c = findCreature(s, iid)?.card;
          if (c && hasKeyword(c, 'bushido')) {
            c.tempP = (c.tempP ?? 0) + 1;
            c.tempT = (c.tempT ?? 0) + 1;
            s.log.push(`${getDef(c.def).name} — bushido`);
          }
        }
      }
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

// Beast Blitz: while a player controls Kunoichi, their beasts (BLITZ_BEASTS) get +1/+1.
const BLITZ_TARGETS = BLITZ_BEASTS;

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

function takeFromGraveyard(p: PlayerState, iid: string) {
  const idx = p.graveyard.findIndex((c) => c.iid === iid);
  if (idx < 0) throw new Error('card not in graveyard');
  return p.graveyard.splice(idx, 1)[0];
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
    case 'discard': {
      // The opponent discards at random. The pick comes from the game's own rng, so it is deterministic.
      const victimId = opponentOf(controller);
      const victim = s.players[victimId];
      for (let i = 0; i < effect.amount && victim.hand.length > 0; i++) {
        const [r, next] = nextRandom(s.rngState);
        s.rngState = next;
        const gone = victim.hand.splice(Math.floor(r * victim.hand.length), 1)[0];
        victim.graveyard.push(gone);
        s.log.push(`${victimId} discards ${getDef(gone.def).name}`);
      }
      break;
    }
    case 'recall': {
      const p = s.players[controller];
      let idx = -1;
      for (let i = p.graveyard.length - 1; i >= 0; i--) {
        if (isCreature(p.graveyard[i])) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        s.log.push(`${controller} finds no creature to return`);
      } else {
        const back = p.graveyard.splice(idx, 1)[0];
        p.hand.push(back);
        s.log.push(`${controller} returns ${getDef(back.def).name} to hand`);
      }
      break;
    }
    case 'destroy': {
      if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) {
          if (hasKeyword(found.card, 'indestructible')) {
            s.log.push(`${getDef(found.card.def).name} is indestructible`); // destroy does nothing to it
          } else {
            found.card.damage += 9999; // lethal -> checkDeaths removes it (+ destroy VFX)
            s.log.push(`${getDef(found.card.def).name} is destroyed`);
          }
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
  const defenderId = opponentOf(s.active);
  const defender = s.players[defenderId];
  // 1:1 blocking (validated). Taken BEFORE damage: deaths between the two steps prune
  // `s.combat`, but an attacker whose blocker died is still a *blocked* attacker.
  const attackers = [...combat.attackers];
  const blockerOf: Record<string, string> = {};
  for (const [blk, atk] of Object.entries(combat.blocks)) blockerOf[atk] = blk;

  for (const step of [1, 2] as const) {
    for (const atkIid of attackers) {
      const atk = findCreature(s, atkIid)?.card;
      if (!atk) continue; // died in an earlier step (or was removed before damage)
      const blkIid = blockerOf[atkIid];
      const blk = blkIid ? (findCreature(s, blkIid)?.card ?? null) : null;

      if (strikesIn(atk, step)) {
        const { toBlocker, toFace } = splitDamage(atk, blk, !!blkIid);
        if (blk) markDamage(atk, blk, toBlocker);
        defender.life -= toFace;
        if (hasKeyword(atk, 'lifelink')) s.players[s.active].life += toBlocker + toFace;
      }
      if (blk && strikesIn(blk, step)) {
        markDamage(blk, atk, power(blk));
        if (hasKeyword(blk, 'lifelink')) defender.life += power(blk);
      }
    }
    checkDeaths(s); // lethal damage resolves between the steps (first strike), and before cleanup
    if (s.winner) break;
  }
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
  // "Until end of turn" buffs (prowess) end as the next turn begins, for both players' creatures.
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const c of s.players[pid].battlefield) {
      if (c.tempP || c.tempT) {
        c.tempP = 0;
        c.tempT = 0;
      }
    }
  }
  p.landPlayedThisTurn = false;
  s.phase = 'main1';
  drawCard(s, next);
  s.log.push(`Turn ${s.turn}: ${next}'s turn`);
}

/** State-based actions: lethal-damage deaths and life<=0 loss. */
function checkDeaths(s: GameState): void {
  const gone = new Set<string>();
  // Dies triggers can change the board (a token appears), so deaths are processed in rounds until the
  // board is stable. The cap is a safety net: today's triggers cannot kill anything, so it never binds.
  for (let round = 0; round < 8; round++) {
    const fallen: CardInstance[] = [];
    // Simultaneous deaths resolve in a fixed order: the active player's creatures first, then the
    // other player's, each in battlefield order (the order the engine, the log and replays all agree on).
    for (const pid of [s.active, opponentOf(s.active)] as PlayerId[]) {
      const p = s.players[pid];
      const dead = p.battlefield.filter((c) => isCreature(c) && isLethal(c));
      if (!dead.length) continue;
      p.battlefield = p.battlefield.filter((c) => !dead.includes(c));
      for (const c of dead) {
        gone.add(c.iid);
        fallen.push(c);
        c.tapped = false;
        c.damage = 0;
        c.buffP = 0;
        c.buffT = 0;
        c.tempP = 0;
        c.tempT = 0;
        c.blitz = false;
        c.summoningSick = true;
        // A token that dies simply ceases to exist. It is not a card, so it must not
        // pad the graveyard (the count, the viewer and the result screen all read it).
        if (!isToken(c.def)) s.players[c.owner].graveyard.push(c);
        s.log.push(`${getDef(c.def).name} dies`);
        if (c.def === 'kunoichi' && !p.battlefield.some((x) => x.def === 'kunoichi')) {
          s.log.push(`Beast Blitz fades.`);
        }
      }
    }
    if (!fallen.length) break;
    // Dies triggers (tokens trigger too: they die like any creature, they just leave no card behind).
    for (const c of fallen) {
      const trig = getDef(c.def).onDeath;
      if (!trig) continue;
      s.log.push(`✦ ${getDef(c.def).name} — last breath`);
      applyEffect(s, c.owner, trig, { kind: 'player', player: opponentOf(c.owner) });
    }
  }
  // Combat bookkeeping may only name creatures that are still in play. An instant cast
  // during the block step can kill an attacker; leaving it listed made the defender's
  // planned block against it unconfirmable ("attacker no longer in play").
  if (gone.size && s.combat) {
    s.combat.attackers = s.combat.attackers.filter((iid) => !gone.has(iid));
    for (const [blocker, attacker] of Object.entries(s.combat.blocks)) {
      if (gone.has(blocker) || gone.has(attacker)) delete s.combat.blocks[blocker];
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
